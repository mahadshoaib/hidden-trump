/**
 * The card-count invariant. This is the arithmetic the whole round depends on:
 * if it does not balance, the round cannot produce 13 full four-card tricks.
 *
 *   initial deal ....... 5 x 4 = 20 cards in hands, 32 left undealt
 *   trump selection .... the taker's trump comes OUT OF THEIR OWN 5-CARD HAND,
 *                       so the taker is left with 4 active cards and the
 *                       undealt deck is untouched at 32
 *   deal-out ........... 32 cards, 8 to each seat, starting from the taker:
 *                         taker 4 + 8 = 12 active
 *                         others 5 + 8 = 13 active each
 *   balance ............ 12 + 13 + 13 + 13 + 1 hidden = 52
 */

import { describe, expect, it } from 'vitest';
import { makeDeck, mulberry32 } from '../src/engine/deck.js';
import { chooseTrump, claimSeat, placeBid, startRound } from '../src/engine/game.js';
import type { Seat } from '../src/engine/types.js';
import { table } from './helpers.js';

function dealFullRound(seed: number) {
  const state = table();
  startRound(state, mulberry32(seed));

  // After the opening deal: 5 each, 32 undealt.
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    expect(state.hands[seat]).toHaveLength(5);
  }
  expect(state.deck).toHaveLength(32);

  // Seat 1 opens the auction and takes it outright with a bid of 13.
  placeBid(state, 1, 13);
  const taker = state.bidding.takerSeat as Seat;
  expect(taker).toBe(1);

  // The trump card is lifted out of the taker's hand, not off the deck.
  const trumpCard = state.hands[taker][0];
  expect(trumpCard).toBeDefined();
  chooseTrump(state, taker, trumpCard!.id);

  return { state, taker, trumpCard: trumpCard! };
}

describe('the deal balances exactly', () => {
  it('leaves zero cards undealt and 12/13/13/13 in active hands', () => {
    const { state, taker } = dealFullRound(1);

    expect(state.deck).toHaveLength(0);
    expect(state.hands[taker]).toHaveLength(12);
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      if (seat === taker) continue;
      expect(state.hands[seat]).toHaveLength(13);
    }
  });

  it('accounts for all 52 cards exactly once: 51 active + 1 hidden trump', () => {
    const { state, trumpCard } = dealFullRound(2);

    const active = ([0, 1, 2, 3] as Seat[]).flatMap((seat) => state.hands[seat]);
    expect(active).toHaveLength(51);

    const all = [...active, state.trump.hiddenCard!];
    expect(all).toHaveLength(52);
    expect(state.trump.hiddenCard).toEqual(trumpCard);

    // No duplicates, none missing: exactly the ids of a fresh 52-card deck.
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(52);
    expect([...ids].sort()).toEqual(makeDeck().map((c) => c.id).sort());
  });

  it('holds across many seeds, and every seat can be the taker', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const state = table();
      startRound(state, mulberry32(seed));
      // Dealer is seat 0, so the auction opens with P2; let each seed's opener
      // take it at 13 and then walk the deal.
      const opener = state.bidding.turn as Seat;
      placeBid(state, opener, 13);
      const taker = state.bidding.takerSeat as Seat;
      chooseTrump(state, taker, state.hands[taker][0]!.id);

      expect(state.deck, `seed ${seed}: undealt deck`).toHaveLength(0);
      expect(state.hands[taker], `seed ${seed}: taker active hand`).toHaveLength(12);
      for (const seat of [0, 1, 2, 3] as Seat[]) {
        if (seat === taker) continue;
        expect(state.hands[seat], `seed ${seed}: seat ${seat} hand`).toHaveLength(13);
      }
      const total =
        state.hands[0].length + state.hands[1].length + state.hands[2].length + state.hands[3].length + 1;
      expect(total, `seed ${seed}: total`).toBe(52);
    }
  });

  it('deals the remainder starting from the taker, going around the table', () => {
    const state = table();
    startRound(state, mulberry32(7));
    // Auction opens with P2 (left of the dealer at P1). Let P4 take it, so the
    // taker is seat 0 and the rotation is observable from the first seat.
    placeBid(state, 1, 5);
    placeBid(state, 2, 3);
    placeBid(state, 3, 4);
    const last = placeBid(state, 0, 6);
    const taker = 0 as Seat;
    expect(state.bidding.takerSeat).toBe(taker);
    expect(state.phase).toBe('trumpSelection');

    const before = ([0, 1, 2, 3] as Seat[]).map((s) => state.hands[s].length) as [number, number, number, number];
    expect(before).toEqual([5, 5, 5, 5]);

    chooseTrump(state, taker, state.hands[taker][0]!.id);
    void last;

    // 8 each, dealt in the order taker, +1, +2, +3, repeating.
    expect(state.hands[taker]).toHaveLength(4 + 8);
    expect(state.hands[1]).toHaveLength(5 + 8);
    expect(state.hands[2]).toHaveLength(5 + 8);
    expect(state.hands[3]).toHaveLength(5 + 8);
    expect(state.deck).toHaveLength(0);
  });

  it('rejects a trump card that is not in the taker\'s hand', () => {
    const state = table();
    startRound(state, mulberry32(3));
    placeBid(state, 1, 13);
    const taker = state.bidding.takerSeat as Seat;
    const foreignCard = state.hands[0][0]!;
    expect(() => chooseTrump(state, taker, foreignCard.id)).toThrow(/not in your hand/);
  });
});

describe('seat claiming', () => {
  it('assigns open seats in order and reclaims by token', () => {
    const state = table(['A', 'B', 'C', 'D']);
    // All four are already taken by the helper, so a fifth player is refused.
    expect(() => claimSeat(state, { name: 'Eve', token: 'tok-eve' })).toThrow(/All four seats/);
  });

  it('reconnecting with the same token returns the same seat', () => {
    const state = table();
    state.seats[2].connected = false;
    const again = claimSeat(state, { name: 'Cleo', token: 'token-2' });
    expect(again).toEqual({ seat: 2, reconnected: true });
    expect(state.seats[2].connected).toBe(true);
  });
});
