import { describe, expect, it } from 'vitest';
import { applyBid, createBiddingState, isValidBidValue, valueToLead } from '../src/engine/bidding.js';
import type { Seat } from '../src/engine/types.js';

const P1 = 0 as Seat;
const P2 = 1 as Seat;
const P3 = 2 as Seat;
const P4 = 3 as Seat;

describe('worked example 9 — the ascending auction with a 13 short-circuit', () => {
  it('records a low bid without handing over the lead, then short-circuits on 13', () => {
    const bidding = createBiddingState(P1);

    const first = applyBid(bidding, P1, 6);
    expect(first.tookLead).toBe(true);
    expect(bidding.highBid).toBe(6);
    expect(bidding.leadingSeat).toBe(P1);
    expect(first.takerSeat).toBeNull();
    expect(bidding.turn).toBe(P2);

    // P2 bids 4 — recorded, but it does not take the lead.
    const second = applyBid(bidding, P2, 4);
    expect(second.tookLead).toBe(false);
    expect(bidding.highBid).toBe(6);
    expect(bidding.leadingSeat).toBe(P1);
    expect(bidding.turn).toBe(P3);
    expect(bidding.bids).toEqual([
      { seat: P1, value: 6, tookLead: true },
      { seat: P2, value: 4, tookLead: false },
    ]);

    // P3 bids 9 — strictly higher, so P3 takes the lead.
    const third = applyBid(bidding, P3, 9);
    expect(third.tookLead).toBe(true);
    expect(bidding.leadingSeat).toBe(P3);
    expect(bidding.turn).toBe(P4);

    // P4 bids 13 — bidding stops on the spot; P4 is the taker even though P4's
    // "turn" is happening and the cycle would have ended here anyway.
    const fourth = applyBid(bidding, P4, 13);
    expect(fourth.shortCircuited).toBe(true);
    expect(fourth.takerSeat).toBe(P4);
    expect(bidding.takerSeat).toBe(P4);
    expect(bidding.turn).toBeNull();
  });

  it('contrast: bidding 10 instead ends the auction normally with P4 the taker', () => {
    const bidding = createBiddingState(P1);
    applyBid(bidding, P1, 6);
    applyBid(bidding, P2, 4);
    applyBid(bidding, P3, 9);
    const fourth = applyBid(bidding, P4, 10);

    expect(fourth.shortCircuited).toBe(false);
    expect(fourth.takerSeat).toBe(P4);
    expect(bidding.bids).toHaveLength(4);
  });

  it('a 13 from an earlier seat ends the auction before the others bid', () => {
    const bidding = createBiddingState(P1);
    applyBid(bidding, P1, 13);
    expect(bidding.takerSeat).toBe(P1);
    expect(bidding.bids).toHaveLength(1);
    expect(bidding.turn).toBeNull();
  });
});

describe('auction rules', () => {
  it('the taker is whoever holds the highest bid once all four have bid', () => {
    const bidding = createBiddingState(P1);
    applyBid(bidding, P1, 3);
    applyBid(bidding, P2, 7);
    applyBid(bidding, P3, 5);
    const last = applyBid(bidding, P4, 6);
    expect(last.takerSeat).toBe(P2);
    expect(bidding.takerSeat).toBe(P2);
  });

  it('ties among leading bids cannot happen, because a new lead must be strictly higher', () => {
    const bidding = createBiddingState(P1);
    applyBid(bidding, P1, 8);
    const repeat = applyBid(bidding, P2, 8);
    expect(repeat.tookLead).toBe(false);
    expect(bidding.leadingSeat).toBe(P1);
  });

  it('valueToLead reports the cheapest bid that takes the lead', () => {
    const bidding = createBiddingState(P1);
    expect(valueToLead(bidding)).toBe(1);
    applyBid(bidding, P1, 5);
    expect(valueToLead(bidding)).toBe(6);
    applyBid(bidding, P2, 13);
    expect(valueToLead(bidding)).toBeNull();
  });
});

describe('bid validation', () => {
  it.each([1, 2, 7, 13])('accepts %i', (value) => {
    expect(isValidBidValue(value)).toBe(true);
  });

  it.each([0, -1, 14, 6.5, Number.NaN, '7', null, undefined])('rejects %p', (value) => {
    expect(isValidBidValue(value)).toBe(false);
  });
});
