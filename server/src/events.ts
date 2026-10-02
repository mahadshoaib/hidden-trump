/**
 * Socket.IO wiring. Every mutation goes through the engine, which is
 * authoritative, and is then broadcast per seat so no client can ever see
 * another hand.
 */

import type { Server, Socket } from 'socket.io';
import {
  SEATS,
  type Ack,
  type ClientToServerEvents,
  type GameView,
  type JoinRoomPayload,
  type Seat,
  type ServerToClientEvents,
} from '@hidden-trump/shared';
import {
  GameError,
  chooseTrump,
  claimSeat,
  nextRound,
  placeBid,
  playCard,
  revealTrump,
  releaseSeat,
  setConnected,
  startRound,
  viewFor,
} from './engine/index.js';
import type { GameState } from './engine/types.js';
import { randomRng } from './engine/deck.js';
import { isValidCode, normalizeCode, RoomStore } from './rooms.js';

type ClientToServer = ClientToServerEvents;
type ServerToClient = ServerToClientEvents;
type ClientSocket = Socket<ClientToServer, ServerToClient, never, SocketData>;
type AnyAck = (res: Ack<never>) => void;

interface SocketData {
  roomCode: string | null;
  seat: Seat | null;
  token: string | null;
}

interface Session {
  roomCode: string;
  seat: Seat | null;
  token: string;
  name: string;
}

/** Room code + token -> socket id, so we can push a per-seat view. */
const listeners = new Map<string, string>();
const sessions = new WeakMap<ClientSocket, Session>();

function listenerKey(roomCode: string, token: string): string {
  return `${roomCode}:${token}`;
}

export function registerSockets(io: Server<ClientToServer, ServerToClient>, store: RoomStore): void {
  io.on('connection', (raw) => {
    const client = raw as ClientSocket;
    const ack = (fn: unknown) => (fn as AnyAck | undefined) ?? (() => undefined);

    const ok = (reply: AnyAck | undefined, data?: unknown): void => {
      const fn = reply as ((res: Ack<unknown>) => void) | undefined;
      if (typeof fn !== 'function') return;
      if (data === undefined) fn({ ok: true, data: undefined });
      else fn({ ok: true, data });
    };

    const bad = (reply: AnyAck | undefined, error: unknown): void => {
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      const fn = reply as ((res: Ack<never>) => void) | undefined;
      if (typeof fn === 'function') fn({ ok: false, error: message });
      else client.emit('error', { message });
    };

    /**
     * Wrap a mutation: resolve the caller's room and seat from the session,
     * run the engine, then push fresh per-seat views to the room.
     */
    const handle =
      (mutate: (state: GameState, session: Session) => unknown) =>
      (reply: AnyAck | undefined): void => {
        try {
          const session = requireSession(client);
          const state = requireRoom(store, session);
          const data = mutate(state, session);
          ok(reply, data);
          broadcast(io, state);
        } catch (error) {
          bad(reply, error);
        }
      };

    client.on('join_room', (payload, reply) => {
      try {
        const session = join(client, payload, store, io);
        ok(reply as AnyAck, { seat: session.seat });
        const state = store.get(session.roomCode);
        if (state) broadcast(io, state);
      } catch (error) {
        bad(reply as AnyAck, error);
      }
    });

    client.on('claim_seat', (payload, reply) => {
      const fn = reply as AnyAck | undefined;
      try {
        const session = requireSession(client);
        const state = requireRoom(store, session);
        if (!isSeat(payload?.seat)) throw new GameError('That is not a valid seat.');
        if (state.seats[payload.seat].name !== null && state.seats[payload.seat].token !== session.token) {
          throw new GameError(`Seat ${payload.seat + 1} is already taken.`);
        }
        const result = claimSeat(state, { name: session.name, token: session.token, preferredSeat: payload.seat });
        session.seat = result.seat;
        client.data.seat = result.seat;
        ok(fn, { seat: result.seat });
        broadcast(io, state);
      } catch (error) {
        bad(fn, error);
      }
    });

    client.on('start_round', (_payload, reply) => {
      handle((state, session) => {
        if (session.seat === null) throw new GameError('Claim a seat first.');
        if (state.phase === 'roundEnd') nextRound(state, randomRng());
        else startRound(state, randomRng());
      })(reply as AnyAck);
    });

    client.on('place_bid', (payload, reply) => {
      handle((state, session) => {
        placeBid(state, requireSeat(session), payload?.value);
      })(reply as AnyAck);
    });

    client.on('choose_trump', (payload, reply) => {
      handle((state, session) => {
        chooseTrump(state, requireSeat(session), payload?.cardId);
      })(reply as AnyAck);
    });

    client.on('reveal_trump', (_payload, reply) => {
      handle((state, session) => revealTrump(state, requireSeat(session)))(reply as AnyAck);
    });

    client.on('play_card', (payload, reply) => {
      handle((state, session) => {
        // Reject every pre-commit probe identically; never validate a guessed
        // trump card and accidentally turn rejection messages into an oracle.
        if (payload?.reveal === true) throw new GameError('Reveal the trump first, then choose a card.');
        playCard(state, requireSeat(session), payload?.cardId, false);
      })(reply as AnyAck);
    });

    client.on('next_round', (_payload, reply) => {
      handle((state, session) => {
        if (session.seat === null) throw new GameError('Claim a seat first.');
        nextRound(state, randomRng());
      })(reply as AnyAck);
    });

    client.on('leave_room', (_payload, reply) => {
      try {
        const session = requireSession(client);
        const state = requireRoom(store, session);
        releaseSeat(state, session.token);
        listeners.delete(listenerKey(session.roomCode, session.token));
        sessions.delete(client);
        void client.leave(session.roomCode);
        ok(reply as AnyAck);
        broadcast(io, state);
      } catch (error) { bad(reply as AnyAck, error); }
    });

    client.on('disconnect', () => {
      const session = sessions.get(client);
      if (!session) return;
      const key = listenerKey(session.roomCode, session.token);
      sessions.delete(client);
      if (listeners.get(key) !== client.id) return;
      listeners.delete(key);
      const state = store.get(session.roomCode);
      if (!state) return;
      // The seat is held open rather than freed, so the token can reclaim it.
      setConnected(state, session.token, false);
      broadcast(io, state);
    });

    void ack;
  });
}

function requireSession(client: ClientSocket): Session {
  const session = sessions.get(client);
  if (!session) throw new GameError('Join a room first.');
  if (listeners.get(listenerKey(session.roomCode, session.token)) !== client.id) {
    throw new GameError('This connection has been replaced. Rejoin the room.');
  }
  return session;
}

function requireRoom(store: RoomStore, session: Session): GameState {
  const state = store.get(session.roomCode);
  if (!state) throw new GameError('That room no longer exists.');
  if (session.seat === null || state.seats[session.seat].token !== session.token) {
    throw new GameError('Your seat has been released. Rejoin the room.');
  }
  return state;
}

function requireSeat(session: Session): Seat {
  if (session.seat === null) throw new GameError('Claim a seat first.');
  return session.seat;
}

/**
 * Join or rejoin. The engine's `claimSeat` owns the rules: a returning token
 * reclaims its seat, a matching disconnected name is a fallback for players who
 * lost localStorage, otherwise the first open seat is taken.
 */
function join(client: ClientSocket, payload: JoinRoomPayload, store: RoomStore, io: Server<ClientToServer, ServerToClient>): Session {
  if (typeof payload !== 'object' || payload === null) throw new GameError('Nothing to join.');

  const name = cleanName(payload.name);
  if (name === null) throw new GameError('Pick a display name between 1 and 20 characters.');
  const token = cleanToken(payload.token);
  if (token === null) throw new GameError('Missing session token — reload the page.');

  // An empty or unknown code means "make me a room".
  const code = isValidCode(payload.roomCode ?? '') ? normalizeCode(payload.roomCode) : store.freshCode();
  const state = store.open(code);

  const result = claimSeat(state, {
    name,
    token,
    ...(payload.preferredSeat !== undefined && isSeat(payload.preferredSeat) ? { preferredSeat: payload.preferredSeat } : {}),
  });

  const session: Session = { roomCode: state.roomCode, seat: result.seat, token, name };
  const previous = sessions.get(client);
  if (previous && (previous.roomCode !== session.roomCode || previous.token !== token)) {
    const key = listenerKey(previous.roomCode, previous.token);
    if (listeners.get(key) === client.id) {
      listeners.delete(key);
      const oldRoom = store.get(previous.roomCode);
      if (oldRoom) { releaseSeat(oldRoom, previous.token); broadcast(io, oldRoom); }
    }
    void client.leave(previous.roomCode);
  }
  sessions.set(client, session);
  client.data.roomCode = state.roomCode;
  client.data.seat = result.seat;
  client.data.token = token;
  listeners.set(listenerKey(state.roomCode, token), client.id);
  void client.join(state.roomCode);
  return session;
}

/**
 * Send every connected client the view built for its own seat. This is the only
 * path state leaves the server, and it is per-seat by construction.
 */
export function broadcast(io: Server<ClientToServer, ServerToClient>, state: GameState, touch = true): void {
  if (touch) state.updatedAt = Date.now();
  for (const seat of SEATS) {
    const occupant = state.seats[seat];
    if (!occupant.token || !occupant.connected || occupant.name === null) continue;
    const socketId = listeners.get(listenerKey(state.roomCode, occupant.token));
    if (!socketId) continue;
    const view: GameView = viewFor(state, seat);
    io.to(socketId).emit('state', view);
  }
}

function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().replace(/\s+/g, ' ').slice(0, 20);
  return trimmed.length > 0 ? trimmed : null;
}

function cleanToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  return trimmed.length >= 8 && trimmed.length <= 64 ? trimmed : null;
}

function isSeat(value: unknown): value is Seat {
  return value === 0 || value === 1 || value === 2 || value === 3;
}
