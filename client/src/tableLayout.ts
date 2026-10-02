/**
 * Where each seat sits around the table.
 *
 * Turn order is P1 -> P2 -> P3 -> P4 -> P1, but the table is drawn from the
 * player's own point of view, so "where is P2" depends on who is asking. Each
 * client rotates the circle so the seat *you* are in is always at the bottom.
 *
 * The one subtlety is the direction. Clockwise on a clock face runs
 * 12 -> 3 -> 6 -> 9, so from the bottom (6 o'clock) clockwise travels to the
 * *left* (7, 8, 9), not the right. Getting this backwards would make the table
 * look right while the highlight actually ran anticlockwise, which is the sort
 * of thing nobody can unsee once they have noticed it. `slotsInTurnOrder`
 * pins the whole cycle down so a regression is a failing test, not a shrug.
 */

import type { Seat } from '@hidden-trump/shared';

/** Where a seat box sits, relative to the viewer. */
export type SeatSlot = 'bottom' | 'left' | 'top' | 'right';

/** Clockwise from the bottom: bottom -> left -> top -> right -> bottom. */
const SLOTS_CLOCKWISE: SeatSlot[] = ['bottom', 'left', 'top', 'right'];

/**
 * The slot for `seat`, given the seat the viewer is sitting in.
 *
 * Offset 0 is always the viewer's own seat, at the bottom, and each further
 * offset is one step clockwise from there.
 */
export function slotForSeat(seat: Seat, mySeat: Seat | null): SeatSlot {
  if (mySeat === null) return SLOTS_CLOCKWISE[seat] as SeatSlot;
  const offset = (((seat - mySeat) % 4) + 4) % 4;
  return SLOTS_CLOCKWISE[offset] as SeatSlot;
}

/** CSS modifier class, e.g. `seat-slot-bottom`. */
export function slotClassName(slot: SeatSlot): string {
  return `seat-slot-${slot}`;
}

/**
 * Every seat paired with its slot, in clockwise turn order starting from the
 * viewer. Rendering in this order keeps the DOM in turn order too, which makes
 * the tab order match the turn order rather than fighting it.
 */
export function slotsInTurnOrder(mySeat: Seat | null): { seat: Seat; slot: SeatSlot }[] {
  return [0, 1, 2, 3].map((offset) => {
    const seat =
      mySeat === null ? (offset as Seat) : (((mySeat + offset) % 4) + 4) % 4 as Seat;
    return { seat, slot: slotForSeat(seat, mySeat) };
  });
}