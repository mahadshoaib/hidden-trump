import { describe, expect, it } from 'vitest';
import { claimSeat, createGameState, seatForToken, startRound } from '../src/engine/game.js';
import { mulberry32 } from '../src/engine/deck.js';
import { table } from './helpers.js';

describe('seat selection', () => {
  it('moves an auto-seated player and frees the original seat', () => {
    const state = createGameState('MOVE');
    const player = { name: 'Ana', token: 'token-ana' };
    expect(claimSeat(state, player).seat).toBe(0);
    expect(claimSeat(state, { ...player, preferredSeat: 2 }).seat).toBe(2);
    expect(state.seats[0]).toEqual({ seat: 0, name: null, token: null, connected: false });
    expect(seatForToken(state, player.token)).toBe(2);
    expect(claimSeat(state, player)).toEqual({ seat: 2, reconnected: true });
    expect(claimSeat(state, { name: 'Ben', token: 'token-ben' }).seat).toBe(0);
  });
  it('rejects an occupied target without losing the original seat', () => {
    const state = table();
    const before = structuredClone(state.seats);
    expect(() => claimSeat(state, { name: 'Ana', token: 'token-0', preferredSeat: 1 })).toThrow(/taken/);
    expect(state.seats).toEqual(before);
  });
  it('rejects changing partnerships during a round', () => {
    const state = table();
    startRound(state, mulberry32(1));
    expect(() => claimSeat(state, { name: 'Ana', token: 'token-0', preferredSeat: 1 })).toThrow(/during a round/);
    expect(seatForToken(state, 'token-0')).toBe(0);
  });
});
