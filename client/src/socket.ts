import { io, type Socket } from 'socket.io-client';
import { newSessionToken, type Ack, type ClientToServerEvents, type GameView, type ServerToClientEvents } from '@hidden-trump/shared';

const TOKEN_KEY = 'hidden-trump:token';
const NAME_KEY = 'hidden-trump:name';
const ROOM_KEY = 'hidden-trump:room';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * A stable per-tab id. The server uses it to hand the same seat back after a
 * refresh or a dropped connection, which is what keeps a hand alive.
 *
 * The token deliberately lives in sessionStorage rather than localStorage.
 * localStorage is shared by every tab of an origin, so four tabs would present
 * one identity and fight over a single seat instead of filling four. And
 * sessionStorage still survives a reload in the same tab, so refreshing keeps
 * your seat and your hand - the promise the landing screen makes.
 *
 * The name and room go in localStorage on purpose: they belong to the person,
 * not the tab, so a second tab picks them up and drops straight into the same
 * room as a different player.
 *
 * Minting lives in shared so it can be tested outside a browser: see the note
 * on newSessionToken about secure contexts.
 */
export function sessionToken(): string {
  const existing = window.sessionStorage.getItem(TOKEN_KEY);
  if (existing && existing.length >= 8) return existing;
  const minted = newSessionToken();
  window.sessionStorage.setItem(TOKEN_KEY, minted);
  return minted;
}

export function rememberedName(): string {
  return window.localStorage.getItem(NAME_KEY) ?? '';
}

export function rememberIdentity(name: string, roomCode: string): void {
  window.localStorage.setItem(NAME_KEY, name);
  window.localStorage.setItem(ROOM_KEY, roomCode);
}

export function rememberedRoom(): string {
  return window.localStorage.getItem(ROOM_KEY) ?? '';
}

/** Forget the room but keep the display name, for switching rooms. */
export function forgetRoom(): void {
  window.localStorage.removeItem(ROOM_KEY);
}

export function connect(): GameSocket {
  // Same-origin in production (HTTPS also gives secure WebSockets). Start with
  // polling and upgrade when available, so restrictive networks still work.
  return io();
}

/** Promise wrapper around one request/ack round trip. */
export function request<T = undefined>(socket: GameSocket, event: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('The server did not respond.')), 10000);
    (socket.emit as unknown as (e: string, p: unknown, ack: (res: Ack<T>) => void) => void)(
      event,
      payload,
      (res) => {
        window.clearTimeout(timeout);
        if (res.ok) resolve(res.data);
        else reject(new Error(res.error));
      },
    );
  });
}

export type { GameView };
