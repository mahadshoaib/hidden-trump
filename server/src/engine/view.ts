/**
 * Per-seat redaction. This is the anti-cheat boundary.
 *
 * A client may only ever receive:
 *   (a) its own hand,
 *   (b) public information (turn order, cards played this trick, bids, the
 *       revealed trump, scores), and
 *   (c) card-back counts for the other hands.
 *
 * `test/view.test.ts` asserts that no other hand and no face-down trump card
 * ever appear in a payload.
 */

import {
  nextSeat,
  SEATS,
  SEAT_LABEL,
  type GameView,
  type RoundResultView,
  type Seat,
  type TrickCardView,
} from '@hidden-trump/shared';
import { valueToLead } from './bidding.js';
import { playOptions } from './game.js';
import { SWEEP_FLOOR_TRICK } from './scoring.js';
import type { GameState, TrickPlay } from './types.js';

/**
 * The taker's "keep hidden" discard stays face down until the trick resolves,
 * so nobody else is told what it was while the trick is still live.
 */
function trickCardView(play: TrickPlay, forSeat: Seat | null): TrickCardView {
  const hidden = play.faceDown && play.seat !== forSeat;
  return {
    seat: play.seat,
    card: hidden ? null : play.card,
    viaReveal: play.viaReveal,
    faceDown: play.faceDown,
  };
}

export function viewFor(state: GameState, forSeat: Seat | null): GameView {
  const options = forSeat === null ? null : playOptions(state, forSeat);
  // Never publish conditional moves or messages derived from the secret suit.
  // The reveal action commits on the server before these become knowable.
  if (options && !state.trump.revealed && options.mustDecideReveal) {
    options.revealCardIds = [];
    options.allowedCardIds = [...options.hideCardIds];
    options.note = options.canHide
      ? 'You are void. Reveal the trump, or keep it hidden and discard.'
      : 'Your remaining card is set aside. Reveal it before playing.';
  }
  const seatViews = SEATS.map((seat) => ({
    seat,
    name: state.seats[seat].name,
    connected: state.seats[seat].connected,
    isYou: seat === forSeat,
    cardCount: state.hands[seat].length,
    trumpSetAside: state.bidding.takerSeat === seat && !state.trump.revealed && state.trump.hiddenCard !== null,
  }));

  const bid = state.bidding.highBid;

  const result: RoundResultView | null = state.result
    ? {
        winnerTeam: state.result.winnerTeam,
        reason: state.result.reason,
        endedAtTrick: state.result.endedAtTrick,
        bid: bid ?? 0,
        takerSeat: state.bidding.takerSeat as Seat,
        teamA: state.scoring.secured.A,
        teamB: state.scoring.secured.B,
        pile: [...state.scoring.pile],
      }
    : null;

  return {
    roomCode: state.roomCode,
    phase: state.phase,
    roundNumber: state.roundNumber,
    dealer: state.dealer,
    seats: seatViews,
    you:
      forSeat === null
        ? null
        : {
            seat: forSeat,
            name: state.seats[forSeat].name ?? SEAT_LABEL[forSeat],
            // Only ever your own cards.
            hand: [...state.hands[forSeat]],
          },
    bidding: {
      bids: state.bidding.bids.map((b) => ({ seat: b.seat, value: b.value, tookLead: b.tookLead })),
      currentSeat: state.bidding.turn,
      highBid: state.bidding.highBid,
      leadingSeat: state.bidding.leadingSeat,
      takerSeat: state.bidding.takerSeat,
      valueToLead: state.phase === 'bidding' ? valueToLead(state.bidding) : null,
      shortCircuited: state.bidding.shortCircuited,
    },
    trump: {
      revealed: state.trump.revealed,
      // Never send the face-down trump card, nor its suit.
      card: state.trump.revealed ? state.trump.hiddenCard : null,
      suit: state.trump.revealed ? state.trump.suit : null,
      revealedAtTrick: state.trump.revealedAtTrick,
    },
    trick: {
      number: state.trick.number,
      cards: state.trick.plays.map((p) => trickCardView(p, forSeat)),
      ledSuit: state.trick.plays[0]?.card.suit ?? null,
      revealIndex: state.trick.revealIndex,
      expectedCards: state.trick.expectedCards,
      complete: state.trick.complete,
      winnerSeat: state.trick.winnerSeat,
    },
    previousLedSuit: state.previousLedSuit,
    turn: state.turn,
    lastTrick: state.lastTrick
      ? {
          number: state.lastTrick.number,
      cards: state.lastTrick.plays.map((p) => trickCardView(p, forSeat)),
          ledSuit: state.lastTrick.plays[0]?.card.suit ?? null,
          revealIndex: state.lastTrick.revealIndex,
          winnerSeat: state.lastTrick.winnerSeat,
          winningCardId: state.lastTrick.winningCardId,
          swept: state.lastTrick.swept,
          blockedBy: state.lastTrick.blockedBy,
        }
      : null,
    playOptions: options,
    scoring: {
      teamA: state.scoring.secured.A,
      teamB: state.scoring.secured.B,
      pileSize: state.scoring.pile.length,
      lastWinnerSeat: state.scoring.lastWinnerSeat,
      sweepFloorTrick: state.scoring.trumpRevealedAtTrick === null ? SWEEP_FLOOR_TRICK : null,
    },
    result,
    history: state.history.map((h) => ({ ...h })),
    log: state.log.map((l) => ({ ...l })),
  };
}

/** Seat order starting from the current turn, for laying out the table. */
export function seatsInTurnOrder(state: GameState): Seat[] {
  const start = state.turn ?? state.dealer;
  return Array.from({ length: 4 }, (_, i) => ((start + i) % 4) as Seat);
}

export { nextSeat };
