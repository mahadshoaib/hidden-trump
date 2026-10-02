/**
 * End-to-end wiring test: four real socket.io clients play a whole round
 * against a real server. This is what proves the anti-cheat boundary holds on
 * the wire, not just in the view builder.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import { Server as IoServer } from 'socket.io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SEATS,
  type Ack,
  type ClientToServerEvents,
  type GameView,
  type Seat,
  type ServerToClientEvents,
} from '@hidden-trump/shared';
import { registerSockets } from '../src/events.js';
import { RoomStore } from '../src/rooms.js';
import { rigPlaying } from './helpers.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let http: Server;
let io: IoServer<ClientToServerEvents, ServerToClientEvents>;
let store: RoomStore;
let url: string;

const tokens = ['token-alice-0001', 'token-bob-0002', 'token-cleo-0003', 'token-dan-0004'];
const clients: Array<{ token: string; client: Client }> = [];
const views = new Map<string, GameView>();

interface RawClient {
  emit: (event: string, payload: unknown, ack: (res: Ack<unknown>) => void) => void;
}

function call<T>(client: Client, event: keyof ClientToServerEvents, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    (client as unknown as RawClient).emit(event as string, payload, (res) => {
      if (res.ok) resolve(res.data as T);
      else reject(new Error(res.error));
    });
  });
}

/** Wait until every connected client has received a state that satisfies `done`. */
async function settle(done: (view: GameView, token: string) => boolean, attempts = 400): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (clients.every(({ token }) => done(views.get(token) as GameView, token))) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('Timed out waiting for state to settle.');
}

function connect(token: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client: Client = ioClient(url, { transports: ['websocket'], forceNew: true });
    client.on('state', (view) => {
      views.set(token, view);
    });
    client.on('connect', () => resolve(client));
    client.on('connect_error', reject);
  });
}

/**
 * Wait for the next broadcast to `token`. Every mutation appends to the log, so
 * a growing log means fresh state has landed.
 */
async function waitForUpdate(token: string, previousLogLength: number): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if ((views.get(token)?.log.length ?? 0) > previousLogLength) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error(`Timed out waiting for an update for ${token}.`);
}

/** Snapshot every client's log length, so we can wait for the whole table. */
function logSnapshot(): Map<string, number> {
  return new Map(clients.map(({ token }) => [token, views.get(token)?.log.length ?? 0]));
}

async function waitForTable(before: Map<string, number>): Promise<void> {
  for (const [token, length] of before) await waitForUpdate(token, length);
}

beforeAll(async () => {
  http = createServer();
  io = new IoServer<ClientToServerEvents, ServerToClientEvents>(http, { cors: { origin: true } });
  store = new RoomStore();
  registerSockets(io, store);
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const { port } = http.address() as AddressInfo;
  url = `http://localhost:${port}`;
});

afterAll(async () => {
  for (const { client } of clients) client.disconnect();
  await new Promise<void>((resolve) => io.close(() => resolve()));
  http.close();
});

describe('socket wiring', () => {
  it('releases the old seat when the same socket switches rooms', async () => {
    const client = await connect('token-switch-room');
    try {
      await call(client, 'join_room', { roomCode: 'OLD', name: 'Ana', token: 'token-switch-room' });
      await call(client, 'join_room', { roomCode: 'NEW', name: 'Ana', token: 'token-switch-room' });
      expect(store.get('OLD')!.seats[0].token).toBeNull();
      expect(store.get('NEW')!.seats[0].token).toBe('token-switch-room');
      await call(client, 'claim_seat', { seat: 2 });
      expect(store.get('NEW')!.seats[2].token).toBe('token-switch-room');
    } finally { client.disconnect(); }
  });
  it('ignores an old socket disconnect after a newer connection replaces the same token', async () => {
    const token = 'token-race-test';
    const old = await connect(token);
    const fresh = await connect(token);
    try {
      const payload = { roomCode: 'RACE', name: 'Ana', token };
      await call(old, 'join_room', payload);
      await call(fresh, 'join_room', payload);
      await expect(call(old, 'claim_seat', { seat: 2 })).rejects.toThrow(/replaced/);
      const disconnected = new Promise<void>(resolve => io.sockets.sockets.get(old.id!)!.once('disconnect', () => resolve()));
      old.disconnect();
      await disconnected;
      expect(store.get('RACE')!.seats[0].connected).toBe(true);
      const update = new Promise<GameView>(resolve => fresh.once('state', resolve));
      await call(fresh, 'claim_seat', { seat: 1 });
      expect((await update).you!.seat).toBe(1);
    } finally { old.disconnect(); fresh.disconnect(); }
  });

  it('explicit Leave releases the seat and revokes the old session immediately', async () => {
    const client = await connect('token-leave-test');
    const replacement = await connect('token-replacement');
    try {
      await call(client, 'join_room', { roomCode: 'LEFT', name: 'Ana', token: 'token-leave-test' });
      await call(client, 'leave_room', {});
      expect(store.get('LEFT')!.seats[0].name).toBeNull();
      await expect(call(client, 'start_round', {})).rejects.toThrow(/Join a room first/);
      expect(await call(replacement, 'join_room', { roomCode: 'LEFT', name: 'Ben', token: 'token-replacement' })).toEqual({ seat: 0 });
    } finally { client.disconnect(); replacement.disconnect(); }
  });

  it('moves a lobby seat over the wire and uses the new seat for subsequent actions', async () => {
    const client = await connect('token-seat-move');
    try {
      await call(client, 'join_room', { roomCode: 'MOVE', name: 'Ana', token: 'token-seat-move' });
      expect(await call(client, 'claim_seat', { seat: 3 })).toEqual({ seat: 3 });
      expect(store.get('MOVE')!.seats[0].token).toBeNull();
      expect(store.get('MOVE')!.seats[3].token).toBe('token-seat-move');
      expect(await call(client, 'claim_seat', { seat: 2 })).toEqual({ seat: 2 });
      expect(store.get('MOVE')!.seats[3].token).toBeNull();
    } finally { client.disconnect(); }
  });
  it('rejects guessed reveal cards identically until an irreversible reveal is committed', async () => {
    const room = store.open('PROBE');
    Object.assign(room, rigPlaying({ taker: 0, hiddenTrump: 'HK',
      hands: [['S4'], ['H2', 'C3'], ['S5'], ['S6']], plays: [[0, 'S2']], turn: 1 }), { roomCode: 'PROBE' });
    room.seats[1].token = 'token-probe-1';
    const client = await connect('token-probe-1');
    try {
      await call(client, 'join_room', { roomCode: 'PROBE', name: 'Ben', token: 'token-probe-1' });
      for (const cardId of ['H2', 'C3', 'HK', 'D9']) {
        await expect(call(client, 'play_card', { cardId, reveal: true }))
          .rejects.toThrow('Reveal the trump first, then choose a card.');
        expect(room.trump.revealed).toBe(false);
      }
      await call(client, 'reveal_trump', {});
      expect(room.trump.revealed).toBe(true);
      await expect(call(client, 'play_card', { cardId: 'C3', reveal: false })).rejects.toThrow();
      await call(client, 'play_card', { cardId: 'H2', reveal: false });
      expect(room.trick.plays[1]!.viaReveal).toBe(true);
    } finally { client.disconnect(); }
  });
  it('plays a whole round over the wire, redacting every other hand', async () => {    for (const token of tokens) {
      const client = await connect(token);
      clients.push({ token, client });
    }

    const code = 'WIRE';
    for (let i = 0; i < 4; i += 1) {
      const seat = await call<{ seat: number }>(clients[i]!.client, 'join_room', {
        roomCode: code,
        name: `Player${i + 1}`,
        token: tokens[i],
      });
      expect(seat.seat).toBe(i);
    }

    await settle((view) => view.phase === 'lobby' && view.seats.every((s) => s.name !== null));
    // Everybody sees four seated players and an empty own hand in the lobby.
    for (const { token } of clients) {
      const view = views.get(token) as GameView;
      expect(view.seats.every((s) => s.name !== null)).toBe(true);
      expect(view.you?.hand).toHaveLength(0);
    }

    await call(clients[0]!.client, 'start_round', {});
    await settle((view) => view.phase === 'bidding');

    // Nobody has seen anybody else's cards.
    const afterBidStart = store.get(code) as NonNullable<ReturnType<RoomStore['get']>>;
    for (let index = 0; index < 4; index += 1) {
      expect(views.get(tokens[index] as string)?.you?.hand).toHaveLength(5);
      expectNoCrossHandLeak(tokens[index] as string, afterBidStart);
    }

    // Ascending auction: the seat left of the dealer bids first, and each new
    // leading bid has to be strictly higher. Seat 0 bids last, so they take it.
    for (const [i, seat] of [1, 2, 3, 0].entries()) {
      await call(clients[seat]!.client, 'place_bid', { value: i + 1 });
    }
    await settle((view) => view.phase === 'trumpSelection');
    for (const { token } of clients) {
      expect(views.get(token)?.bidding.takerSeat).toBe(0);
      expect(views.get(token)?.bidding.highBid).toBe(4);
    }

    // Only the taker can choose a trump, and it stays secret.
    const takerToken = tokens[0] as string;
    const trumpId = (views.get(takerToken)?.you?.hand ?? [])[0]?.id as string;
    await call(clients[0]!.client, 'choose_trump', { cardId: trumpId });
    await settle((view) => view.phase === 'playing');

    const afterDeal = store.get(code) as NonNullable<ReturnType<RoomStore['get']>>;
    for (let index = 0; index < 4; index += 1) {
      const token = tokens[index] as string;
      const view = views.get(token) as GameView;
      expect(view.trump.revealed).toBe(false);
      expect(view.trump.card).toBeNull();
      // The hidden trump is nobody's business yet, not even the taker's.
      expect(cardIdsInJson(view).has(trumpId)).toBe(false);
      // 12 active cards for the taker, 13 for everyone else.
      expect(view.you?.hand).toHaveLength(index === 0 ? 12 : 13);
      expectNoCrossHandLeak(token, afterDeal);
    }

    // A non-taker cannot choose the trump.
    await expect(call(clients[1]!.client, 'choose_trump', { cardId: trumpId })).rejects.toThrow();

    // Play the round out with a legal policy.
    for (let i = 0; i < 13 * 4 + 4; i += 1) {
      const state = store.get(code);
      if (!state || state.phase !== 'playing') break;
      const seat = state.turn as number;
      const token = tokens[seat] as string;
      const view = views.get(token) as GameView;
      const options = view.playOptions;
      if (!options) throw new Error(`no options for seat ${seat}`);
      if (options.mustDecideReveal && !options.canHide) {
        const before = logSnapshot();
        await call(clients[seat]!.client, 'reveal_trump', {});
        await waitForTable(before);
        continue;
      }
      const id = options.mustDecideReveal
        ? (options.hideCardIds[0] ?? options.revealCardIds[0])
        : options.allowedCardIds[0];
      if (id === undefined) throw new Error(`no legal card for seat ${seat} at trick ${view.trick.number}`);
      const before = logSnapshot();
      await call(clients[seat]!.client, 'play_card', {
        cardId: id,
        reveal: options.mustDecideReveal && !options.hideCardIds.includes(id),
      });
      await waitForTable(before);
    }

    const final = store.get(code);
    expect(final?.phase).toBe('roundEnd');
    expect(final?.result).not.toBeNull();

    // Every client agrees on the outcome, and no hand leaked at any point.
    const results = clients.map(({ token }) => views.get(token)?.result);
    for (const result of results) {
      expect(result?.winnerTeam).toBe(results[0]?.winnerTeam);
      expect(result?.endedAtTrick).toBe(results[0]?.endedAtTrick);
    }
const finalState = store.get(code) as NonNullable<ReturnType<RoomStore['get']>>;
    for (const { token } of clients) {
      // Hands need not be empty: the round can end early on a win threshold.
      // What must hold is that no client can see another player's cards, and
      // that its own hand matches the server's.
      expectNoCrossHandLeak(token, finalState);
      const seat = SEATS.find((s) => finalState.seats[s].token === token) as Seat;
      expect(views.get(token)?.you?.hand.map((c) => c.id).sort()).toEqual(
        finalState.hands[seat].map((c) => c.id).sort(),
      );
    }
  });

  it('keeps a seated player mid-game across a refresh', async () => {
    // This is the promise the landing screen makes: refresh and you keep your
    // seat and your hand. The server binds sessions to the socket, so the
    // client has to re-join and let the token win the seat back.
    const code = 'RSM';
    const resumeTokens = ['token-resume-01', 'token-resume-02', 'token-resume-03', 'token-resume-04'];
    const rc: Client[] = [];
    const watch = resumeTokens[3] as string;

    /**
     * Wait for a predicate on one client's view. Log growth is not a usable
     * signal: `startRound` resets the log to empty.
     */
    const until = async (token: string, done: (view: GameView) => boolean, label: string) => {
      for (let i = 0; i < 400; i += 1) {
        const view = views.get(token);
        if (view && done(view)) return;
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error(`Timed out waiting for ${label} (phase was ${views.get(token)?.phase}).`);
    };

    for (const token of resumeTokens) {
      const client = await connect(token);
      rc.push(client);
      await call<{ seat: number }>(client, 'join_room', { roomCode: code, name: `R${token.slice(-2)}`, token });
    }
    await until(watch, (v) => v.seats.every((s) => s.name !== null), 'all four seats taken');

    // Play into a real round: seat 0 takes the deal at 4, then sets a trump.
    await call(rc[0] as Client, 'start_round', {});
    await until(watch, (v) => v.phase === 'bidding', 'bidding to start');
    for (const [i, seat] of [1, 2, 3, 0].entries()) {
      await call(rc[seat] as Client, 'place_bid', { value: i + 1 });
      await until(watch, (v) => v.bidding.highBid === i + 1, `bid ${i + 1} to lead`);
    }
    await until(watch, (v) => v.phase === 'trumpSelection', 'the auction to close');
    const takerHand = views.get(resumeTokens[0] as string)?.you?.hand ?? [];
    await call(rc[0] as Client, 'choose_trump', { cardId: (takerHand[0] as { id: string }).id });
    await until(watch, (v) => v.phase === 'playing', 'play to begin');

    // Seat 2 refreshes: the old socket goes away first, as in a real reload.
    const target = resumeTokens[2] as string;
    const before = [...(views.get(target)?.you?.hand ?? [])].map((c) => c.id).sort();
    expect(before).toHaveLength(13);
    (rc[2] as Client).disconnect();
    await new Promise((r) => setTimeout(r, 60));

    // The seat is held, not freed: a stranger cannot take it while the round runs.
    const interloper = await connect('token-interloper');
    await expect(
      call(interloper, 'join_room', { roomCode: code, name: 'Intruder', token: 'token-interloper' }),
    ).rejects.toThrow(/four seats/i);
    interloper.disconnect();

    // Rejoining with the original token restores the same seat and the same hand.
    const again = await connect(target);
    const rejoined = await call<{ seat: number }>(again, 'join_room', {
      roomCode: code,
      name: 'R03',
      token: target,
    });
    expect(rejoined.seat).toBe(2);
    await until(target, (v) => v.phase === 'playing', 'the reconnecting player to see the table');
    expect([...(views.get(target)?.you?.hand ?? [])].map((c) => c.id).sort()).toEqual(before);
    expect(views.get(target)?.you?.name).toBe('R03');
    // Still redacted after the reconnect.
    expectNoCrossHandLeak(target, store.get(code) as NonNullable<ReturnType<RoomStore['get']>>);
    // And the round is still intact and playable.
    const state = store.get(code) as NonNullable<ReturnType<RoomStore['get']>>;
    expect(state.phase).toBe('playing');
    expect(state.turn).not.toBeNull();

    for (const client of rc) client.disconnect();
    again.disconnect();
  });

  it('refuses out-of-turn bids, out-of-range bids, and bidding after the short circuit', async () => {
    const code = 'RULE';
    const ruleTokens = ['token-rule-0001', 'token-rule-0002', 'token-rule-0003', 'token-rule-0004'];
    const ruleClients: Client[] = [];
    for (let i = 0; i < 4; i += 1) {
      const client = await connect(ruleTokens[i] as string);
      ruleClients.push(client);
      await call(client, 'join_room', {
        roomCode: code,
        name: `Player${i + 1}`,
        token: ruleTokens[i],
      });
    }
    const [one, two, three, four] = ruleClients as [Client, Client, Client, Client];
    const state = store.get(code) as NonNullable<ReturnType<RoomStore['get']>>;

    await call(one, 'start_round', {});
    expect(state.phase).toBe('bidding');

    // Bidding starts with the seat left of the dealer, so seat 0 is too early.
    await expect(call(one, 'place_bid', { value: 4 })).rejects.toThrow(/not your turn/i);
    await call(two, 'place_bid', { value: 4 });

    // Seat 2's turn: the value must be in range.
    await expect(call(three, 'place_bid', { value: 14 })).rejects.toThrow();
    await expect(call(three, 'place_bid', { value: 0 })).rejects.toThrow();
    await expect(call(three, 'place_bid', { value: 2.5 })).rejects.toThrow();

    // 13 short-circuits the auction, so seat 3 never gets a turn.
    await call(three, 'place_bid', { value: 13 });
    expect(state.phase).toBe('trumpSelection');
    expect(state.bidding.takerSeat).toBe(2);
    await expect(call(four, 'place_bid', { value: 5 })).rejects.toThrow();
    // And the losing bid from seat 1 is on the record but never led.
    expect(state.bidding.bids.map((b) => [b.seat, b.value, b.tookLead])).toEqual([
      [1, 4, true],
      [2, 13, true],
    ]);

    for (const client of ruleClients) client.disconnect();
  });
});

/** Every card id that appears anywhere in a serialized payload. */
function cardIdsInJson(value: unknown): Set<string> {
  const found = new Set<string>();
  JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object') {
      const maybe = val as { id?: unknown; suit?: unknown; rank?: unknown };
      if (typeof maybe.id === 'string' && 'suit' in maybe && 'rank' in maybe) found.add(maybe.id);
    }
    return val;
  });
  return found;
}

/**
 * The anti-cheat assertion: for each client, the set of cards it can see must be
 * exactly its own hand (plus the public trick), and nothing from anyone else.
 */
function expectNoCrossHandLeak(token: string, state: NonNullable<ReturnType<RoomStore['get']>>): void {
  const view = views.get(token) as GameView;
  const visible = cardIdsInJson(view);
  const ownSeat = SEATS.find((seat) => state.seats[seat].token === token);
  for (let other = 0; other < 4; other += 1) {
    if (other === ownSeat) continue;
    for (const card of state.hands[other as 0]) {
      expect(visible.has(card.id)).toBe(false);
    }
  }
}
