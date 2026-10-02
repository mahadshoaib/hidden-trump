import { SEATS, type Card, type Seat, type Suit } from '@hidden-trump/shared';
import type { Rng } from './types.js';

/** Cap on active trumps after dealing; the set-aside card is excluded. */
export const MAX_TAKER_TRUMPS = 6;
export type Hands = Record<Seat, Card[]>;

export function countSuit(hand: readonly Card[], suit: Suit): number {
  return hand.filter(card => card.suit === suit).length;
}

/** Mutates only the minimum number of card pairs needed to meet the cap. */
export function capActiveTrumps(
  hands: Hands, taker: Seat, suit: Suit, rng: Rng,
  knownCounts: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 },
): void {
  while (countSuit(hands[taker], suit) > MAX_TAKER_TRUMPS) {
    const candidates = hands[taker].flatMap((card, index) => index >= knownCounts[taker] && card.suit === suit ? [index] : []);
    const targets = SEATS.filter(seat => seat !== taker).flatMap(seat =>
      hands[seat].flatMap((card, index) => index >= knownCounts[seat] && card.suit !== suit ? [{ seat, index }] : []));
    if (!targets.length || !candidates.length) throw new Error('Cannot cap trumps: no eligible swap pair.');
    const source = candidates[Math.floor(rng() * candidates.length)]!;
    const target = targets[Math.floor(rng() * targets.length)]!;
    const trump = hands[taker][source]!;
    hands[taker][source] = hands[target.seat][target.index]!;
    hands[target.seat][target.index] = trump;
  }
}

/** Consume the already shuffled deck from the taker, then correct only excess trumps.
 * Returns full active hands. No face-card guarantee, extra shuffle or quota.
 */
export function dealRemainder(
  remaining: readonly Card[], order: readonly Seat[], taker: Seat,
  trumpSuit: Suit, existing: Hands, rng: Rng,
): Hands {
  if (remaining.length !== 32 || order.length !== 4 || new Set(order).size !== 4 || order[0] !== taker) {
    throw new Error('The remainder must contain 32 cards dealt from the taker.');
  }
  const hands: Hands = { 0: [...existing[0]], 1: [...existing[1]], 2: [...existing[2]], 3: [...existing[3]] };
  const deck = [...remaining];
  for (let i = 0; i < 32; i++) hands[order[i % 4]!].push(deck.pop()!);
  // A change to an already-visible card would reveal that a correction took
  // place and constrain the secret suit. Only the eight new cards may move.
  // There are at most four known active trumps, so enough new ones always exist.
  capActiveTrumps(hands, taker, trumpSuit, rng, {
    0: existing[0].length, 1: existing[1].length,
    2: existing[2].length, 3: existing[3].length,
  });
  return hands;
}
