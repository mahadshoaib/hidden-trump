import type { Card, Rank, Seat, Suit } from '@hidden-trump/shared';
import { chooseTrump, createGameState, placeBid, startRound } from '../src/engine/game.js';
import { createScoringState } from '../src/engine/scoring.js';
import type { GameState, ScoringState, TrickPlay } from '../src/engine/types.js';

/** "HA" -> Heart Ace. Keeps test fixtures readable. */
export function card(id: string): Card {
  const suit = id.charAt(0) as Suit;
  const rank = id.slice(1) as Rank;
  return { id, suit, rank };
}

export function cards(...ids: string[]): Card[] {
  return ids.map(card);
}

export function table(names: string[] = ['Ana', 'Ben', 'Cleo', 'Dan']): GameState {
  const state = createGameState('TEST');
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    state.seats[seat] = { seat, name: names[seat] as string, token: `token-${seat}`, connected: true };
  }
  return state;
}

export interface RigOptions {
  taker: Seat;
  bid?: number;
  /** The face-down trump card. */
  hiddenTrump: string;
  hands: [string[], string[], string[], string[]];
  /** Set true when the trump has already been flipped face up. */
  revealed?: boolean;
  trickNumber?: number;
  previousLedSuit?: Suit | null;
  turn?: Seat;
  scoring?: ScoringState;
  /** Cards already on the table for this trick, in play order. */
  plays?: Array<[Seat, string]>;
}

/**
 * Build a mid-round state with exact hands, bypassing the shuffle. This is the
 * workhorse for exercising the rule interactions (reveal, return, forced plays).
 */
export function rigPlaying(options: RigOptions): GameState {
  const state = table();
  const trump = card(options.hiddenTrump);
  const bid = options.bid ?? 6;
  state.phase = 'playing';
  state.roundNumber = 1;
  state.bidding = {
    turn: null,
    bids: [],
    highBid: bid,
    leadingSeat: options.taker,
    takerSeat: options.taker,
    shortCircuited: false,
  };
  state.trump = {
    hiddenCard: trump,
    suit: trump.suit,
    revealed: options.revealed ?? false,
    revealedAtTrick: options.revealed ? Math.max(1, (options.trickNumber ?? 1) - 1) : null,
  };
  state.hands = {
    0: cards(...options.hands[0]),
    1: cards(...options.hands[1]),
    2: cards(...options.hands[2]),
    3: cards(...options.hands[3]),
  };
  state.deck = [];
  const trickNumber = options.trickNumber ?? 1;
  const plays = (options.plays ?? []).map(([seat, id]) => ({ seat, card: card(id), viaReveal: false, faceDown: false }));
  state.trick = {
    number: trickNumber,
    plays,
    revealIndex: null,
    expectedCards: 4,
    complete: false,
    winnerSeat: null,
  };
  state.previousLedSuit = options.previousLedSuit ?? (plays[0] ? plays[0].card.suit : null);
  state.turn = options.turn ?? options.taker;
  state.scoring = options.scoring ?? createScoringState();
  return state;
}

export function play(seat: Seat, id: string, viaReveal = false, faceDown = false): TrickPlay {
  return { seat, card: card(id), viaReveal, faceDown };
}

/** A scoring state with a pre-baked pile/secured count, for win-check tests. */
export function scoring(partial: Partial<ScoringState>): ScoringState {
  return { ...createScoringState(), ...partial };
}

/** Run a full round from a freshly dealt table using the real code paths. */
export function dealAndStart(state: GameState, rng: () => number): void {
  state.phase = 'roundEnd';
  state.roundNumber = 1;
  startRound(state, rng);
}

export { startRound, placeBid, chooseTrump };
