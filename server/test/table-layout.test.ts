/**
 * Seat positions around the table.
 *
 * The direction is the whole point of these tests. Clockwise on a clock face is
 * 12 -> 3 -> 6 -> 9, so from the bottom of the table clockwise runs to the
 * *left*. A test that only checked "everyone gets a different slot" would pass
 * just as happily with the circle mirrored, which would leave the turn
 * highlight running the wrong way round the table while everything looked
 * superficially fine. These pin the actual direction for every seat.
 */

import { describe, expect, it } from 'vitest';
import type { Seat } from '@hidden-trump/shared';
import { nextSeat } from '@hidden-trump/shared';
import { slotClassName, slotForSeat, slotsInTurnOrder } from '../../client/src/tableLayout.js';

const P1 = 0 as Seat;
const P2 = 1 as Seat;
const P3 = 2 as Seat;
const P4 = 3 as Seat;

describe('your own seat is always at the bottom', () => {
  it.each([
    ['P1', P1],
    ['P2', P2],
    ['P3', P3],
    ['P4', P4],
  ])('%s sits at the bottom', (_label, seat: Seat) => {
    expect(slotForSeat(seat, seat)).toBe('bottom');
  });

  it('uses absolute P1..P4 slots when there is no seat of your own', () => {
    expect(slotForSeat(P1, null)).toBe('bottom');
    expect(slotForSeat(P2, null)).toBe('left');
    expect(slotForSeat(P3, null)).toBe('top');
    expect(slotForSeat(P4, null)).toBe('right');
  });
});

describe('turn order runs clockwise', () => {
  it('walks bottom -> left -> top -> right for P1', () => {
    expect(slotsInTurnOrder(P1).map((s) => s.slot)).toEqual(['bottom', 'left', 'top', 'right']);
  });

  it.each([
    ['P1', P1, ['bottom', 'left', 'top', 'right']],
    ['P2', P2, ['bottom', 'left', 'top', 'right']],
    ['P3', P3, ['bottom', 'left', 'top', 'right']],
    ['P4', P4, ['bottom', 'left', 'top', 'right']],
  ])('%s sees the same clockwise cycle from their own seat', (_label, seat: Seat, expected: string[]) => {
    expect(slotsInTurnOrder(seat).map((s) => s.slot)).toEqual(expected);
  });

  it('puts the next player clockwise of you, for every seat', () => {
    // Clockwise from bottom is left; from left is top; from top is right.
    const clockwiseFrom: Record<string, string> = {
      bottom: 'left',
      left: 'top',
      top: 'right',
      right: 'bottom',
    };
    for (const me of [P1, P2, P3, P4]) {
      const order = slotsInTurnOrder(me);
      for (let i = 0; i < 4; i += 1) {
        const current = order[i] as { seat: Seat; slot: string };
        const next = order[(i + 1) % 4] as { seat: Seat; slot: string };
        expect(current.slot, `${me} at ${current.slot}`).not.toBe(next.slot);
        expect(clockwiseFrom[current.slot]).toBe(next.slot);
        // And the engine agrees on who is next.
        expect(next.seat).toBe(nextSeat(current.seat));
      }
    }
  });

  it('never puts two seats in the same slot', () => {
    for (const me of [P1, P2, P3, P4]) {
      const slots = slotsInTurnOrder(me).map((s) => s.slot);
      expect(new Set(slots).size).toBe(4);
    }
  });
});

describe('the circle is rotated per viewer', () => {
  it('places each absolute seat differently depending on who is looking', () => {
    expect(slotForSeat(P2, P1)).toBe('left');
    expect(slotForSeat(P2, P2)).toBe('bottom');
    expect(slotForSeat(P2, P3)).toBe('right');
    expect(slotForSeat(P2, P4)).toBe('top');
  });

  it('lists all four seats exactly once for every viewer', () => {
    for (const me of [P1, P2, P3, P4]) {
      const seats = slotsInTurnOrder(me).map((s) => s.seat);
      expect([...seats].sort()).toEqual([0, 1, 2, 3]);
    }
  });

  it('emits a class name for each slot', () => {
    expect(slotClassName('bottom')).toBe('seat-slot-bottom');
    expect(slotClassName('left')).toBe('seat-slot-left');
    expect(slotClassName('top')).toBe('seat-slot-top');
    expect(slotClassName('right')).toBe('seat-slot-right');
  });
});