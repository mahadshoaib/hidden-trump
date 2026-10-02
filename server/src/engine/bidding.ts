/**
 * The ascending bidding auction.
 *
 * Unlike a normal auction, every bid is heard by the table. A bid only takes
 * the lead if it is *strictly* higher than the standing high bid, and a bid of
 * 13 ends everything on the spot.
 */

import { nextSeat, type Seat } from '@hidden-trump/shared';
import type { BidRecord, BiddingState } from './types.js';

export const MIN_BID = 1;
export const MAX_BID = 13;

export function createBiddingState(firstSeat: Seat): BiddingState {
  return {
    turn: firstSeat,
    bids: [],
    highBid: null,
    leadingSeat: null,
    takerSeat: null,
    shortCircuited: false,
  };
}

export function isValidBidValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_BID && value <= MAX_BID;
}

/** The lowest bid that would currently take the lead. */
export function valueToLead(bidding: BiddingState): number | null {
  if (bidding.highBid === null) return MIN_BID;
  return bidding.highBid >= MAX_BID ? null : bidding.highBid + 1;
}

export type BidRejection = { ok: false; error: string } | { ok: true };

export function validateBid(bidding: BiddingState, seat: Seat, value: unknown): BidRejection {
  if (bidding.takerSeat !== null) {
    return { ok: false, error: 'Bidding has already finished.' };
  }
  if (bidding.turn !== seat) {
    return { ok: false, error: 'It is not your turn to bid.' };
  }
  if (!isValidBidValue(value)) {
    return { ok: false, error: `A bid must be a whole number from ${MIN_BID} to ${MAX_BID}.` };
  }
  return { ok: true };
}

export interface BidOutcome {
  /** Null while the auction is still running. */
  takerSeat: Seat | null;
  shortCircuited: boolean;
  /** False when the bid was recorded but did not take the lead. */
  tookLead: boolean;
}

/**
 * Record a bid on the bidding state (mutating it) and advance the auction.
 * Assumes `validateBid` has already passed.
 */
export function applyBid(bidding: BiddingState, seat: Seat, value: number): BidOutcome {
  const tookLead = bidding.highBid === null || value > bidding.highBid;
  const record: BidRecord = { seat, value, tookLead };
  bidding.bids.push(record);

  if (tookLead) {
    bidding.highBid = value;
    bidding.leadingSeat = seat;
  }

  // Short-circuit: nothing can legally beat 13, so the rest of the seats lose
  // their turn entirely.
  if (value === MAX_BID) {
    bidding.takerSeat = seat;
    bidding.turn = null;
    bidding.shortCircuited = true;
    return { takerSeat: seat, shortCircuited: true, tookLead };
  }

  if (bidding.bids.length === 4) {
    const taker = bidding.leadingSeat as Seat;
    bidding.takerSeat = taker;
    bidding.turn = null;
    return { takerSeat: taker, shortCircuited: false, tookLead };
  }

  bidding.turn = nextSeat(seat);
  return { takerSeat: null, shortCircuited: false, tookLead };
}
