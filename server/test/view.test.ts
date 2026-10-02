import { describe, expect, it } from 'vitest';
import { SEATS, type Card, type GameView, type Seat, type SeatView } from '@hidden-trump/shared';
import { viewFor } from '../src/engine/view.js';
import { chooseTrump, playCard, placeBid, startRound, revealTrump } from '../src/engine/game.js';
import { mulberry32 } from '../src/engine/deck.js';
import { rigPlaying, table } from './helpers.js';

const P1 = 0 as Seat, P2 = 1 as Seat, P3 = 2 as Seat, P4 = 3 as Seat;

function seatOf(view: GameView, seat: Seat): SeatView {
  const found = view.seats.find((s) => s.seat === seat);
  if (!found) throw new Error(`view is missing seat ${seat}`);
  return found;
}

function allCardIds(value: unknown): string[] {
  const found: string[] = [];
  JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && typeof (val as Card).id === 'string' && 'suit' in val && 'rank' in val) {
      found.push((val as Card).id);
    }
    return val;
  });
  return found;
}

describe('view redaction — the anti-cheat boundary', () => {
  it('shows a client its own hand and card-back counts for everyone else', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [
        ['SA', 'S3', 'H5'],
        ['S8', 'H9', 'C4'],
        ['DQ', 'D6', 'C2'],
        ['H7', 'H8', 'C3'],
      ],
    });

    for (const seat of SEATS) {
      const view = viewFor(state, seat);
      expect(view.you?.hand.map((c) => c.id)).toEqual(state.hands[seat].map((c) => c.id));
      expect(seatOf(view, seat).cardCount).toBe(3);
      for (const other of SEATS) {
        if (other === seat) continue;
        // No card object from another hand may appear anywhere in the payload.
        for (const id of state.hands[other].map((c) => c.id)) {
          expect(allCardIds(view)).not.toContain(id);
        }
      }
    }
  });

  it('never sends the face-down trump card before it is revealed', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [
        ['SA', 'S3', 'H5'],
        ['S8', 'H9', 'C4'],
        ['DQ', 'D6', 'C2'],
        ['H7', 'H8', 'C3'],
      ],
    });

    for (const seat of SEATS) {
      const view = viewFor(state, seat);
      expect(view.trump.revealed).toBe(false);
      expect(view.trump.card).toBeNull();
      // Nobody — not even the taker — is told what the hidden card is.
      expect(allCardIds(view)).not.toContain('DK');
    }

    // The taker can still see that they have a card set aside.
    expect(seatOf(viewFor(state, P1), P1).trumpSetAside).toBe(true);
    expect(seatOf(viewFor(state, P2), P1).trumpSetAside).toBe(true);
  });

  it('sends the trump card once it has legitimately been revealed', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      revealed: true,
      hands: [
        ['SA', 'S3', 'H5'],
        ['S8', 'H9', 'C4'],
        ['DQ', 'D6', 'C2'],
        ['H7', 'H8', 'C3'],
      ],
    });

    const view = viewFor(state, P3);
    expect(view.trump.revealed).toBe(true);
    expect(view.trump.card?.id).toBe('DK');
    expect(view.trump.suit).toBe('D');
    expect(seatOf(view, P1).trumpSetAside).toBe(false);
  });

  it('keeps the taker\'s "keep hidden" discard face down for everyone else', () => {
    // P1 is the taker and is void in the suit P4 leads, but still holds cards,
    // so they get a real keep-hidden choice.
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [
        ['S3', 'H7', 'H8'],
        ['S2', 'C2', 'D2'],
        ['S4', 'C3', 'D3'],
        ['SK', 'C4', 'D4'],
      ],
    });

    // P1 leads, P4's King of Spades takes the trick, and P4 may not lead Spades
    // again while the trump is hidden — so P4 leads Clubs, which P1 is void in.
    playCard(state, P1, 'S3', false);
    playCard(state, P2, 'S2', false);
    playCard(state, P3, 'S4', false);
    playCard(state, P4, 'SK', false);
    expect(state.turn).toBe(P4);

    playCard(state, P4, 'C4', false);
    playCard(state, P1, 'H7', false); // void in Clubs, keeps the trump hidden
    expect(state.turn).toBe(P2);
    expect(state.trick.plays).toHaveLength(2);

    const live = viewFor(state, P2).trick.cards;
    expect(live[1]?.faceDown).toBe(true);
    expect(live[1]?.card).toBeNull();
    // The owner still knows what they played.
    expect(viewFor(state, P1).trick.cards[1]?.card?.id).toBe('H7');
    // And the log never spells it out either.
    for (const entry of viewFor(state, P3).log) expect(entry.text).not.toContain('H7');
  });

  it('only ever exposes play options for the seat they were requested for', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [
        ['SA', 'S3', 'H5'],
        ['S8', 'H9', 'C4'],
        ['DQ', 'D6', 'C2'],
        ['H7', 'H8', 'C3'],
      ],
    });

    const forP1 = viewFor(state, P1);
    expect(forP1.playOptions?.isTurn).toBe(true);
    expect(forP1.playOptions?.allowedCardIds).toEqual(['SA', 'S3', 'H5']);
    for (const other of SEATS) {
      if (other === P1) continue;
      const view = viewFor(state, other);
      expect(view.playOptions?.isTurn).toBe(false);
      expect(view.playOptions?.allowedCardIds).toEqual([]);
    }
    // An observer payload carries no play options and no hand at all.
    const observer = viewFor(state, null);
    expect(observer.playOptions).toBeNull();
    expect(observer.you).toBeNull();
  });

  it('leaks nothing during bidding, before the trump is even chosen', () => {
    const state = table();
    startRound(state, mulberry32(7));
    // Bidding starts with the seat left of the dealer (P2 here).
    for (const seat of [P2, P3, P4]) placeBid(state, seat, 4);
    placeBid(state, P1, 13);

    for (const seat of SEATS) {
      const view = viewFor(state, seat);
      expect(view.you?.hand).toHaveLength(5);
      for (const other of SEATS) {
        if (other === seat) continue;
        for (const id of state.hands[other].map((c) => c.id)) {
          expect(allCardIds(view)).not.toContain(id);
        }
      }
      // Nobody knows the trump yet, and nobody knows who holds what.
      expect(view.trump.card).toBeNull();
      expect(view.trump.revealed).toBe(false);
    }
  });

  it('exposes no other hand even at the end of a full round', () => {
    const state = table();
    startRound(state, mulberry32(99));
    placeBid(state, P2, 13);
    chooseTrump(state, P2, state.hands[P2][0]!.id, mulberry32(100));

    // Play out all 13 tricks, always leading the lowest legal card. When the
    // only legal option is the forced reveal we take it.
    for (let i = 0; i < 13 * 4 + 1; i += 1) {
      const seat = state.turn;
      if (seat === null) break;
      const options = viewFor(state, seat).playOptions;
      if (options === null) break;
      if (options.mustDecideReveal && !options.canHide) {
        revealTrump(state, seat);
        continue;
      }
      // Void players keep the trump hidden when they can; the reveal is only
      // forced when the taker has nothing else left to play.
      const id = options.mustDecideReveal
        ? (options.hideCardIds[0] ?? options.revealCardIds[0])
        : options.allowedCardIds[0];
      if (id === undefined) break;
      playCard(state, seat, id, options.mustDecideReveal && !options.hideCardIds.includes(id));
    }
    expect(state.phase).toBe('roundEnd');

    for (const seat of SEATS) {
      const view = viewFor(state, seat);
      expect(view.result).not.toBeNull();
      if (seat !== P2) {
        for (const id of state.hands[P2].map((c) => c.id)) {
          expect(allCardIds(view)).not.toContain(id);
        }
      }
    }
  });
});
