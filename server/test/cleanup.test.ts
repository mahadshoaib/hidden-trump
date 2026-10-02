import { describe, expect, it } from 'vitest';
import { RoomStore, IDLE_ROOM_MS, SEAT_GRACE_MS } from '../src/rooms.js';
import { claimSeat, setConnected, releaseSeat } from '../src/engine/game.js';
import { card } from './helpers.js';

describe('disconnect grace and room cleanup', () => {
  it('retains a first-round room for the full six-hour idle grace', () => {
    const store = new RoomStore();
    const state = store.open('IDLE');
    state.updatedAt = 100;
    expect(state.history).toEqual([]);
    store.sweepIdle(100 + IDLE_ROOM_MS - 1);
    expect(store.get('IDLE')).toBe(state);
    store.sweepIdle(100 + IDLE_ROOM_MS);
    expect(store.get('IDLE')).toBeUndefined();
  });

  it('expires only the disconnected identity after five minutes and preserves the hand', () => {
    const store = new RoomStore();
    const state = store.open('SEAT');
    claimSeat(state, { name: 'Ana', token: 'token-ana' });
    state.hands[0] = [card('H2')];
    setConnected(state, 'token-ana', false, 100);
    store.sweepIdle(100 + SEAT_GRACE_MS - 1);
    expect(state.seats[0].token).toBe('token-ana');
    expect(store.sweepIdle(100 + SEAT_GRACE_MS)).toEqual([state]);
    expect(state.seats[0].token).toBeNull();
    expect(state.hands[0]).toEqual([card('H2')]);
    expect(claimSeat(state, { name: 'Ben', token: 'token-ben' }).seat).toBe(0);
  });

  it('a reconnect cancels expiry and preserves the same seat', () => {
    const store = new RoomStore();
    const state = store.open('BACK');
    claimSeat(state, { name: 'Ana', token: 'token-ana' });
    setConnected(state, 'token-ana', false, 100);
    expect(claimSeat(state, { name: 'Ana', token: 'token-ana' }).reconnected).toBe(true);
    store.sweepIdle(100 + SEAT_GRACE_MS);
    expect(state.seats[0].token).toBe('token-ana');
    expect(state.seats[0].disconnectedAt).toBeUndefined();
  });

  it('explicit release is immediate and a later stale disconnect is harmless', () => {
    const state = new RoomStore().open('LEAVE');
    claimSeat(state, { name: 'Ana', token: 'token-ana' });
    releaseSeat(state, 'token-ana');
    claimSeat(state, { name: 'Ben', token: 'token-ben' });
    setConnected(state, 'token-ana', false);
    expect(state.seats[0].token).toBe('token-ben');
    expect(state.seats[0].connected).toBe(true);
  });

  it('never reaps a room while a player is connected', () => {
    const store = new RoomStore();
    const state = store.open('LIVE');
    claimSeat(state, { name: 'Ana', token: 'token-ana' });
    store.sweepIdle(state.updatedAt + IDLE_ROOM_MS * 2);
    expect(store.get('LIVE')).toBe(state);
  });
});
