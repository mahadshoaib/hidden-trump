import { describe, expect, it } from 'vitest';
import {
  applyTrickWin,
  checkRoundEnd,
  createScoringState,
  oppositionLockoutThreshold,
  SWEEP_FLOOR_TRICK,
  TOTAL_TRICKS,
} from '../src/engine/scoring.js';
import type { ScoringState, Seat } from '../src/engine/types.js';
import { card, scoring } from './helpers.js';

const P1 = 0 as Seat; // Team A
const P2 = 1 as Seat; // Team B
const P3 = 2 as Seat; // Team A
const P4 = 3 as Seat; // Team B

function win(
  state: ScoringState,
  trickNumber: number,
  winnerSeat: Seat,
  winningCard = 'S5',
  trumpRevealed = false,
) {
  const result = applyTrickWin(state, { trickNumber, winnerSeat, winningCard: card(winningCard), trumpRevealed });
  return { state: result.state, swept: result.swept, blockedBy: result.blockedBy };
}

describe('worked example 1 — three different winners, pile grows, nothing secured', () => {
  it('leaves three tricks in the pile and both teams on zero', () => {
    let s = createScoringState();
    s = win(s, 1, P1).state;
    s = win(s, 2, P2).state;
    s = win(s, 3, P3).state;

    expect(s.pile).toEqual([1, 2, 3]);
    expect(s.secured).toEqual({ A: 0, B: 0 });
    expect(s.lastWinnerSeat).toBe(P3);
  });
});

describe('worked example 2 — sweep on tricks 4-5-6', () => {
  it('awards the entire pile to the sweeping team and resets the streak', () => {
    let s = createScoringState();
    s = win(s, 1, P1).state;
    s = win(s, 2, P2).state;
    s = win(s, 3, P3).state;

    const fourth = win(s, 4, P1); // different player from P3 -> no sweep
    expect(fourth.swept).toBeNull();
    s = fourth.state;
    expect(s.pile).toEqual([1, 2, 3, 4]);

    const fifth = win(s, 5, P2); // P2 last won trick 2, so not consecutive
    expect(fifth.swept).toBeNull();
    s = fifth.state;
    expect(s.pile).toEqual([1, 2, 3, 4, 5]);
    expect(s.lastWinnerSeat).toBe(P2);

    const sixth = win(s, 6, P2); // consecutive, trick 6 >= 5, not an Ace -> SWEEP
    expect(sixth.swept).toBe(6);
    expect(sixth.state.secured).toEqual({ A: 0, B: 6 });
    expect(sixth.state.pile).toEqual([]);
    expect(sixth.state.lastWinnerSeat).toBeNull();
  });
});

describe('worked example 3 — Ace blocks the sweep but the streak survives', () => {
  it('sweeps tricks 7, 8 and 9 together once the Ace no longer wins', () => {
    let s = win(createScoringState(), 7, P3).state; // pile [7], streak P3

    const aceWin = win(s, 8, P3, 'HA');
    expect(aceWin.swept).toBeNull();
    expect(aceWin.blockedBy).toBe('ace');
    s = aceWin.state;
    expect(s.pile).toEqual([7, 8]);
    // The streak is deliberately *not* reset.
    expect(s.lastWinnerSeat).toBe(P3);

    const third = win(s, 9, P3, 'H7');
    expect(third.swept).toBe(3);
    expect(third.state.secured).toEqual({ A: 3, B: 0 });
    expect(third.state.pile).toEqual([]);
    expect(third.state.lastWinnerSeat).toBeNull();
  });
});

describe('worked example 4 — a reveal lifts the trick-5 sweep floor', () => {
  it('allows a sweep on tricks 3 and 4 that would otherwise be illegal', () => {
    let s = createScoringState();
    s = win(s, 1, P1).state;
    s = win(s, 2, P2).state;

    // Trump revealed during trick 3, won by P3. Nobody swept: P3 did not win trick 2.
    const third = win(s, 3, P3, 'H5', true);
    expect(third.swept).toBeNull();
    s = third.state;
    expect(s.trumpRevealedAtTrick).toBe(3);

    // P3 wins again on trick 4 — below the trick-5 floor, but the floor is gone.
    const fourth = win(s, 4, P3, 'H9');
    expect(fourth.swept).toBe(4);
    expect(fourth.state.secured).toEqual({ A: 4, B: 0 });
  });

  it('the identical sequence without a reveal does not sweep on trick 4', () => {
    let s = createScoringState();
    s = win(s, 1, P1).state;
    s = win(s, 2, P2).state;
    s = win(s, 3, P3).state;
    const fourth = win(s, 4, P3, 'H9');
    expect(fourth.swept).toBeNull();
    expect(fourth.blockedBy).toBe('below-floor');
    expect(fourth.state.pile).toEqual([1, 2, 3, 4]);
  });
});

describe('the trick-5 floor', () => {
  it.each([
    [1, 2],
    [2, 3],
    [3, 4],
  ])('blocks a back-to-back pair finishing on trick %i', (first: number, second: number) => {
    let s = createScoringState();
    if (first === 2) s = win(s, 1, P4).state;
    s = win(s, first, P1).state;
    const result = win(s, second, P1, 'H3');
    expect(result.swept).toBeNull();
    expect(result.blockedBy).toBe('below-floor');
  });

  it('allows the earliest legal pair, tricks 4 then 5', () => {
    let s = createScoringState();
    s = win(s, 1, P2).state;
    s = win(s, 2, P3).state;
    s = win(s, 3, P4).state;
    s = win(s, 4, P1).state;
    const result = win(s, 5, P1, 'H3');
    expect(result.swept).toBe(5);
    expect(SWEEP_FLOOR_TRICK).toBe(5);
  });

  it('requires the same seat, not merely the same team', () => {
    let s = createScoringState();
    s = win(s, 4, P1).state; // Team A
    const result = win(s, 5, P3, 'H3'); // P3 is also Team A
    expect(result.swept).toBeNull();
    expect(result.state.pile).toEqual([4, 5]);
    expect(result.state.lastWinnerSeat).toBe(P3);
  });

  it('a sweep resets the streak, so a third win in a row cannot chain another sweep', () => {
    let s = createScoringState();
    s = win(s, 1, P2).state;
    s = win(s, 2, P3).state;
    s = win(s, 3, P4).state;
    s = win(s, 4, P1).state;
    // Consecutive with trick 4, trick 5 clears the floor: sweep of 4 + the 5 itself.
    s = win(s, 5, P1, 'H3').state;
    expect(s.secured.A).toBe(5);
    expect(s.pile).toEqual([]);
    expect(s.lastWinnerSeat).toBeNull();

    // A third consecutive win: the streak was reset by the sweep, so this only
    // piles up instead of sweeping again.
    const sixth = win(s, 6, P1, 'H4');
    expect(sixth.swept).toBeNull();
    expect(sixth.state.pile).toEqual([6]);

    // The next win pairs with trick 6 and sweeps those two.
    const seventh = win(sixth.state, 7, P1, 'H5');
    expect(seventh.swept).toBe(2);
    expect(seventh.state.secured.A).toBe(7);
    expect(seventh.state.pile).toEqual([]);
  });
});

describe('worked example 5 — the trick-12 exception (takers side)', () => {
  const taker = P1; // Team A

  it('a bid met on trick 11 ends the round immediately', () => {
    const result = checkRoundEnd({
      scoring: scoring({ secured: { A: 8, B: 0 }, pile: [11] }),
      bid: 8,
      takerSeat: taker,
      trickNumber: 11,
    });
    expect(result).toEqual({ winnerTeam: 'A', reason: 'bid-met', endedAtTrick: 11 });
  });

  it('the same threshold crossing on trick 12 is deferred to trick 13', () => {
    const deferred = checkRoundEnd({
      scoring: scoring({ secured: { A: 8, B: 0 }, pile: [12] }),
      bid: 8,
      takerSeat: taker,
      trickNumber: 12,
    });
    expect(deferred).toBeNull();

    const final = checkRoundEnd({
      scoring: scoring({ secured: { A: 8, B: 0 }, pile: [13] }),
      bid: 8,
      takerSeat: taker,
      trickNumber: 13,
    });
    expect(final).toEqual({ winnerTeam: 'A', reason: 'bid-met', endedAtTrick: 13 });
  });

  it('never ends at trick 12 even when the opposition has also locked things out', () => {
    const result = checkRoundEnd({
      scoring: scoring({ secured: { A: 0, B: 7 } }),
      bid: 7,
      takerSeat: taker,
      trickNumber: 12,
    });
    expect(result).toBeNull();
  });
});

describe('worked example 6 — opposition nullification', () => {
  const taker = P1; // Team A

  it('locks the taker out as soon as the opposition secures 14 - bid', () => {
    const bid = 11;
    expect(oppositionLockoutThreshold(bid)).toBe(3);

    const before = checkRoundEnd({
      scoring: scoring({ secured: { A: 0, B: 2 } }),
      bid,
      takerSeat: taker,
      trickNumber: 8,
    });
    expect(before).toBeNull();

    const locked = checkRoundEnd({
      scoring: scoring({ secured: { A: 0, B: 3 } }),
      bid,
      takerSeat: taker,
      trickNumber: 9,
    });
    expect(locked).toEqual({ winnerTeam: 'B', reason: 'opposition-nullified', endedAtTrick: 9 });
  });

  it('defers a trick-12 lockout to trick 13', () => {
    const deferred = checkRoundEnd({
      scoring: scoring({ secured: { A: 0, B: 3 } }),
      bid: 11,
      takerSeat: taker,
      trickNumber: 12,
    });
    expect(deferred).toBeNull();

    const final = checkRoundEnd({
      scoring: scoring({ secured: { A: 0, B: 3 } }),
      bid: 11,
      takerSeat: taker,
      trickNumber: 13,
    });
    expect(final).toEqual({ winnerTeam: 'B', reason: 'opposition-nullified', endedAtTrick: 13 });
  });
});

describe('final tally', () => {
  it('gives the round to the opposition when the bid falls short', () => {
    const result = checkRoundEnd({
      scoring: scoring({ secured: { A: 4, B: 2 }, pile: [1, 2, 3, 4, 5, 6, 13] }),
      bid: 6,
      takerSeat: P1,
      trickNumber: TOTAL_TRICKS,
    });
    expect(result).toEqual({ winnerTeam: 'B', reason: 'final-tally', endedAtTrick: 13 });
  });

  it('unswept pile tricks never help the taker', () => {
    const result = checkRoundEnd({
      // 7 tricks in the pile are worthless; only 3 are actually secured.
      scoring: scoring({ secured: { A: 3, B: 3 }, pile: [1, 2, 3, 4, 5, 6, 7] }),
      bid: 4,
      takerSeat: P1,
      trickNumber: TOTAL_TRICKS,
    });
    expect(result?.winnerTeam).toBe('B');
  });

  it('the two thresholds can never both fire on 13 tricks', () => {
    for (let bid = 1; bid <= 13; bid++) {
      for (let a = 0; a <= TOTAL_TRICKS; a++) {
        for (let b = 0; b <= TOTAL_TRICKS; b++) {
          if (a + b > TOTAL_TRICKS) continue;
          const takerMadeBid = a >= bid;
          const oppositionLockedOut = b >= oppositionLockoutThreshold(bid);
          expect(takerMadeBid && oppositionLockedOut).toBe(false);
        }
      }
    }
  });
});
