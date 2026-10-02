/**
 * In-memory room registry.
 *
 * Everything lives in a `Map<roomCode, GameState>` for v1. Nothing in here
 * imports Express or Socket.IO, so a Redis/Postgres implementation can be
 * swapped in behind the same surface later.
 */

import { SEATS, type Seat } from '@hidden-trump/shared';
import { createGameState, releaseSeat } from './engine/index.js';
import type { GameState } from './engine/types.js';

const CODE_LENGTH = 4;
export const SEAT_GRACE_MS = 5 * 60 * 1000;
export const IDLE_ROOM_MS = 6 * 60 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomStore {
  private readonly rooms = new Map<string, GameState>();

  /** Find a room, or create it if the code is free. */
  open(code: string): GameState {
    const key = normalizeCode(code);
    const existing = this.rooms.get(key);
    if (existing) return existing;
    const created = createGameState(key);
    this.rooms.set(key, created);
    return created;
  }

  get(code: string): GameState | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  has(code: string): boolean {
    return this.rooms.has(normalizeCode(code));
  }

  delete(code: string): void {
    this.rooms.delete(normalizeCode(code));
  }

  get size(): number {
    return this.rooms.size;
  }

  /** A code nobody is using, for the "create" button. */
  freshCode(): string {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length)),
      ).join('');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Could not allocate a free room code.');
  }

  /**
   * Drop rooms that nobody is connected to. A room with history is kept for a
   * while so a player can refresh and still see the scoreboard.
   */
  sweepIdle(now: number, maxIdleMs = IDLE_ROOM_MS): GameState[] {
    const changed: GameState[] = [];
    for (const [code, state] of this.rooms) {
      const anyoneHere = SEATS.some((s) => state.seats[s].connected);
      if (!anyoneHere && now - state.updatedAt >= maxIdleMs) {
        this.rooms.delete(code);
        continue;
      }
      let released = false;
      for (const seat of SEATS) {
        const slot = state.seats[seat];
        if (!slot.connected && slot.token && slot.disconnectedAt !== undefined && now - slot.disconnectedAt >= SEAT_GRACE_MS) {
          releaseSeat(state, slot.token);
          released = true;
        }
      }
      if (released) changed.push(state);
    }
    return changed;
  }
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function isValidCode(code: string): boolean {
  const normalized = normalizeCode(code);
  return normalized.length >= 3 && normalized.length <= 8;
}

/** The lowest-numbered seat that is still free. */
export function firstOpenSeat(state: GameState): Seat | null {
  for (const seat of SEATS) if (state.seats[seat].name === null) return seat;
  return null;
}
