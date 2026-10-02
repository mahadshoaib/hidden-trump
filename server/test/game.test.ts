import { describe, expect, it } from 'vitest';
import type { Seat } from '../src/engine/types.js';
import { GameError, playCard, playOptions } from '../src/engine/game.js';
import { mulberry32 } from '../src/engine/deck.js';
import { chooseTrump, placeBid, startRound } from '../src/engine/game.js';
import { createScoringState } from '../src/engine/scoring.js';
import { rigPlaying, scoring, table } from './helpers.js';
import { viewFor } from '../src/engine/view.js';

const P1 = 0 as Seat;
const P2 = 1 as Seat;
const P3 = 2 as Seat;
const P4 = 3 as Seat;

describe('turn order', () => {
  it('goes P1 -> P2 -> P3 -> P4 -> P1 around the table', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [
        ['S2', 'H9'],
        ['H3', 'S9'],
        ['C2', 'C3'],
        ['D2', 'D3'],
      ],
    });
    const order: Seat[] = [];
    for (let i = 0; i < 4; i++) {
      order.push(state.turn as Seat);
      const seat = state.turn as Seat;
      const options = playOptions(state, seat);
      const reveal = options.mustDecideReveal && !options.canHide;
      const pool = reveal ? options.revealCardIds : options.mustDecideReveal ? options.hideCardIds : options.allowedCardIds;
      playCard(state, seat, pool[0] as string, reveal);
    }
    expect(order).toEqual([P1, P2, P3, P4]);
  });

  it('wraps back around to the first seat after P4', () => {
    const state = rigPlaying({
      taker: P4,
      hiddenTrump: 'DK',
      hands: [
        ['S2', 'H9'],
        ['H3', 'S9'],
        ['C2', 'C3'],
        ['D2', 'D3'],
      ],
    });
    expect(state.turn).toBe(P4);
    playCard(state, P4, 'D2', false);
    expect(state.turn).toBe(P1);
    playCard(state, P1, 'S2', false);
    expect(state.turn).toBe(P2);
    playCard(state, P2, 'H3', false);
    expect(state.turn).toBe(P3);
    playCard(state, P3, 'C2', false);
    expect(state.turn).toBe(P4);
  });

  it('skips a seat that has run out of cards rather than soft-locking', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [
        ['S2', 'S3'],
        ['H3'], // P2 has exactly one card
        ['C2', 'C3'],
        ['D2', 'D3'],
      ],
    });
    // Take the whole trick so P2 is left empty afterwards.
    playCard(state, P1, 'S2', false);
    playCard(state, P2, 'H3', false);
    playCard(state, P3, 'C2', false);
    playCard(state, P4, 'D2', false);
    expect(state.trick.number).toBe(2);
    expect(state.hands[P2]).toHaveLength(0);
    // P1 led again, so the order must not stall on P2.
    playCard(state, P1, 'S3', false);
    expect(state.turn).toBe(P3);
  });
});

describe('following suit', () => {
  it('forces a player who still holds the led suit to follow it', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [['S2', 'H9'], ['H3', 'S9'], ['C2'], ['D2']],
    });
    // P1 leads a Spade, so P2 is not void and must play a Spade.
    playCard(state, P1, 'S2', false);
    expect(state.turn).toBe(P2);
    const options = playOptions(state, P2);
    expect(options.mustDecideReveal).toBe(false);
    expect(options.allowedCardIds).toEqual(['S9']);
    expect(() => playCard(state, P2, 'H3', false)).toThrow(/must follow/);
  });

  it('offers a void player the reveal choice', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [['S2', 'H9'], ['H3', 'C9'], ['C2'], ['D2']],
    });
    playCard(state, P1, 'S2', false);
    const options = playOptions(state, P2);
    expect(options.mustDecideReveal).toBe(true);
    expect(options.canReveal).toBe(true);
    expect(options.canHide).toBe(true);
    expect(options.hideCardIds).toEqual(['H3', 'C9']);
  });

  it('refuses to reveal when the player is not void', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [['S2', 'H9'], ['S3', 'D9'], ['C2'], ['D2']],
    });
    playCard(state, P1, 'S2', false);
    expect(() => playCard(state, P2, 'S3', true)).toThrow(/only reveal the trump when void/);
  });

  it('lets a void player keep the trump hidden and discard anything', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [['S2', 'H9'], ['H3', 'C9'], ['C2'], ['D2']],
    });
    playCard(state, P1, 'S2', false);
    playCard(state, P2, 'H3', false);
    expect(state.trump.revealed).toBe(false);
    expect(state.trick.revealIndex).toBeNull();
    expect(state.trick.plays[1]?.viaReveal).toBe(false);
  });
});

describe('the trump returns to the taker whoever reveals it', () => {
  /**
   * Hearts led; P1 is the taker and next, but it is P3 who is void. The trump
   * is the King of Diamonds, face down and not the P1's to hold yet.
   */
  function nonTakerReveals(takerHand: string[], revealerHand: string[], hiddenTrump: string) {
    return rigPlaying({
      taker: P1,
      hiddenTrump,
      bid: 8,
      trickNumber: 6,
      previousLedSuit: 'H',
      turn: P3,
      plays: [
        [P1, 'H4'],
        [P2, 'H8'],
      ],
      hands: [takerHand, ['S3'], revealerHand, ['D3']],
    });
  }

  it('puts the trump in the taker\'s hand when somebody else reveals', () => {
    const state = nonTakerReveals(['S9'], ['D10'], 'DK');

    expect(viewFor(state, P1).you?.hand.map((c) => c.id)).toEqual(['S9']);

    playCard(state, P3, 'D10', true);

    expect(state.trump.revealed).toBe(true);
    // Not the revealer's hand - the taker's.
    expect(state.hands[P3].map((c) => c.id)).toEqual([]);
    expect(state.hands[P1].map((c) => c.id)).toEqual(['S9', 'DK']);
  });

  it('lets the taker play the returned card in the very same trick, as a normal card', () => {
    // P4 is the taker, so they play after the reveal and can use it right away.
    const state = rigPlaying({
      taker: P4,
      hiddenTrump: 'DK',
      bid: 8,
      trickNumber: 6,
      previousLedSuit: 'H',
      turn: P3,
      plays: [
        [P1, 'H4'],
        [P2, 'H8'],
      ],
      hands: [['C4'], ['S3'], ['D10'], ['S9']],
    });

    playCard(state, P3, 'D10', true);
    expect(state.hands[P4].map((c) => c.id)).toEqual(['S9', 'DK']);

    // Once the trump is out, later players in the trick are not asked to decide
    // anything - the returned card is just a card.
    const options = playOptions(state, P4);
    expect(options.mustDecideReveal).toBe(false);
    expect(options.allowedCardIds).toEqual(['S9', 'DK']);
    playCard(state, P4, 'DK', false);

    // The King beats the Ten revealed a moment earlier.
    expect(state.lastTrick?.winnerSeat).toBe(P4);
    expect(state.lastTrick?.winningCardId).toBe('DK');
    expect(state.hands[P4].map((c) => c.id)).toEqual(['S9']);
  });

  it('puts exactly one copy in the hand', () => {
    const state = nonTakerReveals(['S9'], ['D10'], 'DK');
    playCard(state, P3, 'D10', true);
    expect(state.hands[P1].filter((c) => c.id === 'DK')).toHaveLength(1);
    // And the trump is now out, so nobody is asked to decide again.
    expect(playOptions(state, P1).mustDecideReveal).toBe(false);
  });

  it('shows the returned card to the taker and clears the set-aside marker', () => {
    const state = nonTakerReveals(['S9'], ['D10'], 'DK');
    expect(viewFor(state, P1).seats.find((s) => s.seat === P1)?.trumpSetAside).toBe(true);

    playCard(state, P3, 'D10', true);

    const view = viewFor(state, P1);
    expect(view.you?.hand.map((c) => c.id)).toEqual(['S9', 'DK']);
    expect(view.seats.find((s) => s.seat === P1)?.trumpSetAside).toBe(false);
    expect(view.seats.find((s) => s.seat === P1)?.cardCount).toBe(2);
    expect(view.trump.revealed).toBe(true);
    expect(view.trump.card?.id).toBe('DK');
  });

  it('still obliges the revealer to produce a trump of their own', () => {
    // P3 reveals but holds no Diamonds; the returned card is the taker's, so it
    // cannot be used to satisfy P3's obligation.
    const state = nonTakerReveals(['S9'], ['C7'], 'DK');
    const options = playOptions(state, P3);
    expect(options.canReveal).toBe(true);
    // No trumps in hand, so the spec's no-dead-end rule lets them play anything.
    expect(options.revealCardIds).toEqual(['C7']);
    playCard(state, P3, 'C7', true);
    expect(state.hands[P1].map((c) => c.id)).toEqual(['S9', 'DK']);
  });
});

describe('worked example 8 — the taker\'s returned trump card', () => {
  /** Hearts led around the table; the taker is next with no Hearts at all. */
  function takerVoidOnHearts(takerHand: string[], hiddenTrump: string) {
    return rigPlaying({
      taker: P1,
      hiddenTrump,
      bid: 8,
      trickNumber: 6,
      previousLedSuit: 'H',
      turn: P1,
      plays: [
        [P2, 'H5'],
        [P3, 'H7'],
        [P4, 'H9'],
      ],
      hands: [takerHand, ['S3'], ['C2'], ['D3']],
    });
  }

  it('rejoins the taker\'s hand and can be played to satisfy the obligation', () => {
    // The taker holds no Diamonds at all, yet revealing is still legal and the
    // returned card is the only trump they can produce.
    const state = takerVoidOnHearts(['S9'], 'DK');
    const options = playOptions(state, P1);
    expect(options.mustDecideReveal).toBe(true);
    expect(options.revealCardIds).toEqual(['DK']);

    playCard(state, P1, 'DK', true);
    expect(state.trump.revealed).toBe(true);
    expect(state.trump.hiddenCard?.id).toBe('DK');
    // 1 card in hand + 1 returned - 1 played.
    expect(state.hands[P1]).toHaveLength(1);
    // The trick completed, so the outcome lives on `lastTrick`.
    expect(state.lastTrick?.revealIndex).toBe(3);
    expect(state.lastTrick?.plays[3]?.viaReveal).toBe(true);
    // The revealing player's own card counts, so the returned King of Diamonds
    // is a live trump from the reveal onward and beats every Heart.
    expect(state.lastTrick?.winnerSeat).toBe(P1);
    expect(state.lastTrick?.winningCardId).toBe('DK');
  });

  it('lets the taker hold the returned card back and play another trump instead', () => {
    const state = takerVoidOnHearts(['D9'], 'DK');
    const options = playOptions(state, P1);
    expect(options.revealCardIds).toEqual(['D9', 'DK']);

    playCard(state, P1, 'D9', true);
    // D5 came back to the hand and is a perfectly normal playable card now.
    expect(state.hands[P1].map((c) => c.id)).toEqual(['DK']);
    expect(state.trump.suit).toBe('D');
    expect(state.trump.revealed).toBe(true);
  });

  it('sends the returned card to the taker\'s own client', () => {
    // The engine pushing the card into the hand is not the same as the taker
    // being able to see and play it, which is what the view has to carry.
    const state = takerVoidOnHearts(['D9'], 'DK');

    // Before the reveal it is face down on the table, not in the hand.
    const before = viewFor(state, P1);
    expect(before.you?.hand.map((c) => c.id)).toEqual(['D9']);
    expect(before.seats.find((s) => s.seat === P1)?.trumpSetAside).toBe(true);
    expect(before.trump.revealed).toBe(false);
    expect(before.trump.card).toBeNull();

    playCard(state, P1, 'D9', true);

    const after = viewFor(state, P1);
    expect(after.you?.hand.map((c) => c.id)).toEqual(['DK']);
    // Set-aside is over, so the client stops showing a placeholder.
    expect(after.seats.find((s) => s.seat === P1)?.trumpSetAside).toBe(false);
    expect(after.trump.revealed).toBe(true);
    expect(after.trump.card?.id).toBe('DK');
    expect(after.trump.suit).toBe('D');

    // And it is genuinely playable next trick, not just displayed.
    const winner = state.lastTrick?.winnerSeat as Seat;
    expect(playOptions(state, winner).allowedCardIds).toContain('DK');
  });

  it('refuses to let the taker dodge the obligation with a non-trump', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [['S9', 'S4'], ['S3'], ['C2'], ['D3']],
      previousLedSuit: 'H',
      turn: P1,
      plays: [
        [P2, 'H5'],
        [P3, 'H7'],
        [P4, 'H9'],
      ],
    });
    expect(() => playCard(state, P1, 'S4', true)).toThrow(/must play a trump card/);
  });

  it('a non-taker who reveals with no trumps may still play any card', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [['D3'], ['S3'], ['C2'], ['C9']],
      previousLedSuit: 'H',
      turn: P4,
      plays: [
        [P1, 'H5'],
        [P2, 'H7'],
        [P3, 'H9'],
      ],
    });
    const options = playOptions(state, P4);
    // P4 holds no Diamonds, so the reveal falls back to the whole hand.
    expect(options.mustDecideReveal).toBe(true);
    expect(options.revealCardIds).toEqual(['C9']);
    expect(options.canReveal).toBe(true);

    expect(() => playCard(state, P4, 'C9', true)).not.toThrow();
    expect(state.trump.revealed).toBe(true);
    expect(state.lastTrick?.plays[3]?.viaReveal).toBe(true);
    // No trump was played after the reveal, so the led suit decides and P3's
    // Nine of Hearts takes it.
    expect(state.lastTrick?.winnerSeat).toBe(P3);
  });
});

describe('the leading restriction while the trump is hidden', () => {
  it('forbids repeating the previous led suit, then lifts once revealed', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [
        ['SK', 'S3', 'H5'],
        ['S4', 'H9', 'C4'],
        ['D5', 'D6', 'C2'],
        ['H7', 'H8', 'C3'],
      ],
    });

    playCard(state, P1, 'SK', false);
    playCard(state, P2, 'S4', false);
    playCard(state, P3, 'D5', false); // void in Spades, keeps the trump hidden
    playCard(state, P4, 'H7', false);
    // P1's King of Spades was the highest Spade, so P1 leads again — but may
    // not lead Spades while the trump is hidden.
    expect(state.scoring.lastWinnerSeat).toBe(P1);
    expect(state.turn).toBe(P1);
    expect(state.previousLedSuit).toBe('S');
    const options = playOptions(state, P1);
    expect(options.allowedCardIds).toEqual(['H5']);
    expect(() => playCard(state, P1, 'S3', false)).toThrow(/may not lead/);
  });

  it('is lifted permanently once the trump is face up', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      revealed: true,
      trickNumber: 2,
      hands: [
        ['S2', 'S3', 'H5'],
        ['S8', 'H9', 'C4'],
        ['D5', 'D6', 'C2'],
        ['H7', 'H8', 'C3'],
      ],
    });
    const options = playOptions(state, P1);
    expect(options.allowedCardIds).toEqual(['S2', 'S3', 'H5']);
  });

  it('does not soft-lock a player who holds nothing but the previous suit', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      previousLedSuit: 'H',
      hands: [['H5', 'H6'], ['S8'], ['D5'], ['C3']],
    });
    const options = playOptions(state, P1);
    expect(options.allowedCardIds).toEqual(['H5', 'H6']);
  });
});

describe('trick resolution drives the turn and the scoring', () => {
  it('hands the lead to the trick winner and applies the sweep rules', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      bid: 3,
      scoring: createScoringState(),
      hands: [
        ['S2', 'S3'],
        ['S8', 'S9'],
        ['D5', 'D6'],
        ['C5', 'C6'],
      ],
    });
    playCard(state, P1, 'S2', false);
    playCard(state, P2, 'S8', false);
    playCard(state, P3, 'D5', false);
    playCard(state, P4, 'C5', false);
    // P2's Eight of Spades is the highest Spade, so P2 leads the next trick.
    expect(state.scoring.lastWinnerSeat).toBe(P2);
    expect(state.scoring.pile).toEqual([1]);
    expect(state.turn).toBe(P2);
    expect(state.trick.number).toBe(2);
    expect(state.trick.plays).toHaveLength(0);
  });
});

describe('trick 13 — the taker must turn the secret trump face up', () => {
  function trickThirteenState() {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'D2',
      bid: 4,
      trickNumber: 13,
      scoring: scoring({ pile: [12], secured: { A: 2, B: 1 }, lastWinnerSeat: P2 }),
      hands: [[], ['S2'], ['H3'], ['C4']],
    });
    state.turn = P1;
    return state;
  }

  it('offers only the hidden card, with revealing forced', () => {
    const state = trickThirteenState();
    const options = playOptions(state, P1);
    expect(options.handEmpty).toBe(false);
    expect(options.mustDecideReveal).toBe(true);
    expect(options.canReveal).toBe(true);
    expect(options.canHide).toBe(false);
    expect(options.revealCardIds).toEqual(['D2']);
    expect(options.hideCardIds).toEqual([]);
  });

  it('refuses any other card and refuses to keep it hidden', () => {
    const state = trickThirteenState();
    expect(() => playCard(state, P1, 'D2', false)).toThrow(/no cards left/);
  });

  it('completes the round when the taker plays it', () => {
    const state = trickThirteenState();
    playCard(state, P1, 'D2', true);
    expect(state.trump.revealed).toBe(true);
    playCard(state, P2, 'S2', false);
    playCard(state, P3, 'H3', false);
    expect(state.trick.expectedCards).toBe(4);
    playCard(state, P4, 'C4', false);
    expect(state.phase).toBe('roundEnd');
    expect(state.result).not.toBeNull();
    expect(state.result?.endedAtTrick).toBe(13);
  });

  it('lets the taker lead trick 13 with the revealed card when they won trick 12', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'D2',
      bid: 4,
      trickNumber: 13,
      scoring: scoring({ pile: [12], secured: { A: 2, B: 1 }, lastWinnerSeat: P1 }),
      hands: [[], ['S2'], ['H3'], ['C4']],
    });
    state.turn = P1;
    const options = playOptions(state, P1);
    expect(options.mustDecideReveal).toBe(true);
    expect(options.revealCardIds).toEqual(['D2']);
  });
});

describe('illegal moves are rejected', () => {
  it('rejects playing out of turn', () => {
    const state = rigPlaying({ taker: P1, hiddenTrump: 'DK', hands: [['S2'], ['S3'], ['C2'], ['D2']] });
    expect(() => playCard(state, P2, 'S3', false)).toThrow(/not your turn/);
  });

  it('rejects a card the player does not hold', () => {
    const state = rigPlaying({ taker: P1, hiddenTrump: 'DK', hands: [['S2'], ['S3'], ['C2'], ['D2']] });
    expect(() => playCard(state, P1, 'HA', false)).toThrow(/not in your hand/);
  });

  it('rejects the trump obligation being dodged after a reveal', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [['S2'], ['H3', 'DK'], ['C2'], ['D2']],
    });
    playCard(state, P1, 'S2', false);
    expect(() => playCard(state, P2, 'H3', true)).toThrow(/must play a card of the trump suit/);
  });

  it('rejects a missing reveal decision', () => {
    const state = rigPlaying({
      taker: P1,
      hiddenTrump: 'DK',
      hands: [['S2'], ['H3', 'C9'], ['C2'], ['D2']],
    });
    playCard(state, P1, 'S2', false);
    expect(() => playCard(state, P2, 'C9', undefined as unknown as boolean)).toThrow(/must choose/);
  });
});

describe('a complete round can be played through end to end', () => {
  interface Played {
    played: string[];
    tricksPlayed: number;
  }

  /** Drive the round to its natural conclusion with a simple legal policy. */
  function playOut(state: ReturnType<typeof table>): Played {
    const taker = state.bidding.takerSeat as Seat;
    chooseTrump(state, taker, state.hands[taker][0]!.id);

    const played: string[] = [];
    let tricksPlayed = 0;
    let guard = 0;
    let seenTrick = state.trick.number;
    while (state.phase === 'playing' && guard < 800) {
      guard += 1;
      const seat = state.turn as Seat;
      const options = playOptions(state, seat);
      if (options.handEmpty) {
        throw new Error(`turn handed to a cardless seat at trick ${state.trick.number}`);
      }
      const reveal = options.mustDecideReveal && !options.canHide;
      const pool = reveal
        ? options.revealCardIds
        : options.mustDecideReveal
          ? options.hideCardIds
          : options.allowedCardIds;
      playCard(state, seat, pool[0] as string, reveal);
      played.push(pool[0] as string);
      // `state.phase` is re-read: playing it can end the round outright.
      const phaseAfter: string = state.phase;
      if (state.trick.number !== seenTrick) {
        tricksPlayed += 1;
        seenTrick = state.trick.number;
      } else if (phaseAfter === 'roundEnd') {
        tricksPlayed += 1;
      }
    }
    return { played, tricksPlayed };
  }

  it('keeps every invariant across many seeds, whether the round ends early or not', () => {
    let fullRounds = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const state = table();
      startRound(state, mulberry32(seed));
      placeBid(state, state.bidding.turn as Seat, 5);
      placeBid(state, state.bidding.turn as Seat, 4);
      placeBid(state, state.bidding.turn as Seat, 6);
      placeBid(state, state.bidding.turn as Seat, 3);

      const { played, tricksPlayed } = playOut(state);

      expect(state.phase, `seed ${seed}: the round must finish`).toBe('roundEnd');
      expect(state.result, `seed ${seed}: needs a result`).not.toBeNull();
      expect(state.result?.endedAtTrick, `seed ${seed}: tricks played`).toBe(tricksPlayed);
      expect(played, `seed ${seed}: four cards per trick`).toHaveLength(4 * tricksPlayed);
      expect(new Set(played).size, `seed ${seed}: no card played twice`).toBe(played.length);

      // Every trick is either secured by a team or still in the pile.
      const accounted = state.scoring.secured.A + state.scoring.secured.B + state.scoring.pile.length;
      expect(accounted, `seed ${seed}: every trick accounted for`).toBe(tricksPlayed);

      if (tricksPlayed === 13) {
        fullRounds += 1;
        // All 52 cards used, every hand empty.
        expect(played, `seed ${seed}: all 52 cards played`).toHaveLength(52);
        expect(new Set(played).size, `seed ${seed}: 52 distinct cards`).toBe(52);
        for (const seat of [0, 1, 2, 3] as Seat[]) {
          expect(state.hands[seat], `seed ${seed}: seat ${seat} hand is empty`).toHaveLength(0);
        }
        expect(state.trump.revealed, `seed ${seed}: the trump is face up by trick 13`).toBe(true);
      }
    }
    // Sanity check that the 13-trick path really is exercised here.
    expect(fullRounds, 'at least some seeds should play all 13 tricks').toBeGreaterThan(0);
  });

  it('never offers or accepts an illegal move', () => {
    const state = table();
    startRound(state, mulberry32(99));
    placeBid(state, state.bidding.turn as Seat, 13);
    const taker = state.bidding.takerSeat as Seat;
    chooseTrump(state, taker, state.hands[taker][0]!.id);

    const illegal: string[] = [];
    let guard = 0;
    while (state.phase === 'playing' && guard < 800) {
      guard += 1;
      const seat = state.turn as Seat;
      const options = playOptions(state, seat);

      // Every card outside the advertised set must be rejected, with no state
      // change — rejected plays are the ones that must not mutate anything.
      for (const candidate of state.hands[seat]) {
        if (options.allowedCardIds.includes(candidate.id)) continue;
        try {
          playCard(state, seat, candidate.id, false);
          illegal.push(`${candidate.id} was wrongly allowed`);
        } catch (error) {
          if (!(error instanceof GameError)) illegal.push(`${candidate.id} threw ${String(error)}`);
        }
      }
      // A reveal must be a trump card whenever one is held.
      if (options.mustDecideReveal && options.revealCardIds.length > 0) {
        const nonTrump = state.hands[seat].find((c) => !options.revealCardIds.includes(c.id));
        if (nonTrump) {
          try {
            playCard(state, seat, nonTrump.id, true);
            illegal.push(`${nonTrump.id} was wrongly allowed with a reveal`);
          } catch (error) {
            if (!(error instanceof GameError)) illegal.push(`${nonTrump.id} threw ${String(error)}`);
          }
        }
      }

      const reveal = options.mustDecideReveal && !options.canHide;
      const pool = reveal
        ? options.revealCardIds
        : options.mustDecideReveal
          ? options.hideCardIds
          : options.allowedCardIds;
      playCard(state, seat, pool[0] as string, reveal);
    }
    expect(illegal).toEqual([]);
    expect(state.phase).toBe('roundEnd');
  });
});
