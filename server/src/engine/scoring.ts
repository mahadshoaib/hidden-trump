/**
 * The double-sweep scoring engine and the round win conditions.
 *
 * Pure functions: they take a ScoringState and return a new one. Nothing here
 * knows about sockets, rooms or React, which is exactly why it is easy to test.
 */

import { isAce, otherTeam, teamOf, type Seat } from '@hidden-trump/shared';
import type { Card } from './types.js';
import type { RoundEndReason, RoundResult, ScoringState } from './types.js';

/** Total tricks in a round. Bids run 1..13 and the maths below depends on it. */
export const TOTAL_TRICKS = 13;

/**
 * A personal back-to-back win only sweeps from this trick onward — unless the
 * trump has been revealed, which lifts the floor immediately.
 */
export const SWEEP_FLOOR_TRICK = 5;

export function createScoringState(): ScoringState {
  return {
    pile: [],
    secured: { A: 0, B: 0 },
    lastWinnerSeat: null,
    trumpRevealedAtTrick: null,
  };
}

export interface TrickOutcome {
  trickNumber: number;
  winnerSeat: Seat;
  winningCard: Card;
  /**
   * True if the trump was revealed at any point up to and including this trick.
   * This is what lifts the trick-5 sweep floor.
   */
  trumpRevealed: boolean;
}

export interface TrickScoringResult {
  state: ScoringState;
  /** Size of the pile the winner's team just claimed, or null if there was no sweep. */
  swept: number | null;
  /** Why there was no sweep — surfaced in the log. */
  blockedBy: 'ace' | 'below-floor' | null;
}

/**
 * Fold one resolved trick into the scoring state.
 *
 * A sweep requires the *same individual seat* (not merely the same team) to win
 * two tricks in a row, from trick 5 onward (or from the reveal trick, whichever
 * is earlier), and the second win must not be an Ace.
 */
export function applyTrickWin(prev: ScoringState, outcome: TrickOutcome): TrickScoringResult {
  const state: ScoringState = {
    pile: [...prev.pile],
    secured: { A: prev.secured.A, B: prev.secured.B },
    lastWinnerSeat: prev.lastWinnerSeat,
    trumpRevealedAtTrick: prev.trumpRevealedAtTrick,
  };

  if (outcome.trumpRevealed && state.trumpRevealedAtTrick === null) {
    state.trumpRevealedAtTrick = outcome.trickNumber;
  }

  const floorLifted = state.trumpRevealedAtTrick !== null;
  const isConsecutive = prev.lastWinnerSeat !== null && prev.lastWinnerSeat === outcome.winnerSeat;
  const clearsFloor = floorLifted || outcome.trickNumber >= SWEEP_FLOOR_TRICK;

  if (isConsecutive && !clearsFloor) {
    state.pile.push(outcome.trickNumber);
    state.lastWinnerSeat = outcome.winnerSeat;
    return { state, swept: null, blockedBy: 'below-floor' };
  }

  if (isConsecutive && isAce(outcome.winningCard)) {
    // The Ace trick joins the pile and the streak is deliberately *kept*, so the
    // very next win can still complete the sweep.
    state.pile.push(outcome.trickNumber);
    state.lastWinnerSeat = outcome.winnerSeat;
    return { state, swept: null, blockedBy: 'ace' };
  }

  if (isConsecutive) {
    const total = state.pile.length + 1;
    const team = teamOf(outcome.winnerSeat);
    state.secured[team] += total;
    state.pile = [];
    // A fresh streak must be built from scratch — no chaining onto a swept pair.
    state.lastWinnerSeat = null;
    return { state, swept: total, blockedBy: null };
  }

  state.pile.push(outcome.trickNumber);
  state.lastWinnerSeat = outcome.winnerSeat;
  return { state, swept: null, blockedBy: null };
}

/** Opposition locks the taker's team out once they secure this many tricks. */
export function oppositionLockoutThreshold(bid: number): number {
  return TOTAL_TRICKS + 1 - bid;
}

export interface WinCheckInput {
  scoring: ScoringState;
  bid: number;
  takerSeat: Seat;
  trickNumber: number;
}

/**
 * Live win check, run after every trick resolves.
 *
 * Returns null while the round is still going. Never fires on trick 12 — the
 * trick-12 exception forces trick 13 to be played out first.
 */
export function checkRoundEnd(input: WinCheckInput): RoundResult | null {
  const { scoring, bid, takerSeat, trickNumber } = input;
  const takerTeam = teamOf(takerSeat);
  const opposition = otherTeam(takerTeam);
  const takerSecured = scoring.secured[takerTeam];
  const oppositionSecured = scoring.secured[opposition];
  const takerMadeBid = takerSecured >= bid;
  const oppositionLockedOut = oppositionSecured >= oppositionLockoutThreshold(bid);

  if (trickNumber === TOTAL_TRICKS) {
    // Natural resolution, or the deferred read of a threshold met on trick 12.
    const winnerTeam = takerMadeBid ? takerTeam : opposition;
    const reason: RoundEndReason = takerMadeBid
      ? 'bid-met'
      : oppositionLockedOut
        ? 'opposition-nullified'
        : 'final-tally';
    return { winnerTeam, reason, endedAtTrick: trickNumber };
  }

  if (trickNumber === TOTAL_TRICKS - 1) {
    // The trick-12 exception: never end here, even when a threshold is met.
    return null;
  }

  if (takerMadeBid) {
    return { winnerTeam: takerTeam, reason: 'bid-met', endedAtTrick: trickNumber };
  }
  if (oppositionLockedOut) {
    return { winnerTeam: opposition, reason: 'opposition-nullified', endedAtTrick: trickNumber };
  }
  return null;
}
