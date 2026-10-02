/**
 * Who wins a trick. This is the sequencing rule, and it is the easiest place in
 * the whole game to get an off-by-one-style bug, so it lives in one small pure
 * function with a very explicit contract.
 */

import { rankValue, type Card, type Seat, type Suit } from '@hidden-trump/shared';
import type { TrickPlay } from './types.js';

export interface TrickWinner {
  seat: Seat;
  card: Card;
}

function highest(candidates: readonly TrickPlay[]): TrickWinner | null {
  if (candidates.length === 0) return null;
  let best = candidates[0] as TrickPlay;
  for (const play of candidates) {
    if (rankValue(play.card.rank) > rankValue(best.card.rank)) best = play;
  }
  return { seat: best.seat, card: best.card };
}

export interface WinnerInput {
  /** Cards in the exact order they were played. */
  plays: readonly TrickPlay[];
  /** Index into `plays` at which the trump was flipped, or null if it was not. */
  revealIndex: number | null;
  /** The secret trump suit. Only meaningful once `trumpRevealed` is true. */
  trumpSuit: Suit | null;
  /** True when the trump is face up, whether or not it flipped during this trick. */
  trumpRevealed: boolean;
}

/**
 * Rules:
 *
 *  - Trump revealed *during* this trick: only cards played from the reveal
 *    onward can win, and only trump-suit cards among them. Cards played
 *    earlier are excluded even when they are secretly the trump suit.
 *    If that filter leaves nothing, fall back to the highest led-suit card
 *    across the whole trick, pre- and post-reveal alike.
 *  - Trump already revealed before this trick: fully live. Any trump in the
 *    trick beats every card of the led suit; without one, the led suit decides.
 *  - Trump never revealed: highest card of the led suit wins. That covers the
 *    common case where the led suit happens to secretly *be* the trump suit
 *    but nobody triggered a reveal — those cards are just their ordinary suit.
 */
export function determineTrickWinner(input: WinnerInput): TrickWinner | null {
  const { plays, revealIndex, trumpSuit, trumpRevealed } = input;
  if (plays.length === 0) return null;
  const first = plays[0] as TrickPlay;
  const ledSuit = first.card.suit;
  const trump = trumpRevealed ? trumpSuit : null;

  if (revealIndex !== null && trump !== null) {
    const afterReveal = plays.slice(revealIndex);
    const trumpsAfterReveal = afterReveal.filter((p) => p.card.suit === trump);
    if (trumpsAfterReveal.length > 0) {
      return highest(trumpsAfterReveal);
    }
    return highest(plays.filter((p) => p.card.suit === ledSuit));
  }

  if (trump !== null) {
    const trumps = plays.filter((p) => p.card.suit === trump);
    if (trumps.length > 0) {
      return highest(trumps);
    }
  }

  return highest(plays.filter((p) => p.card.suit === ledSuit));
}
