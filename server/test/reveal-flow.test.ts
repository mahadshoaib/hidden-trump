/**
 * The void-and-reveal decision gate.
 *
 * Regression coverage for the bug where tapping a heart showed "Reveal & play",
 * tapping it again showed "Play (keep it hidden)", and deselecting it left the
 * player knowing the trump without having committed to playing it. The fix is
 * that the decision is its own step: nothing is selectable until it is made.
 *
 * These are pure-function tests, no DOM needed.
 */

import { describe, expect, it } from 'vitest';
import type { PlayOptionsView } from '@hidden-trump/shared';
import {
  awaitingDecision,
  canSubmit,
  decisionIsForced,
  isSelectable,
  revealFlag,
  selectableCardIds,
} from '../../client/src/reveal.js';

function options(over: Partial<PlayOptionsView> = {}): PlayOptionsView {
  return {
    isTurn: true,
    allowedCardIds: ['H2', 'H9', 'SA'],
    mustDecideReveal: false,
    canReveal: true,
    canHide: true,
    revealCardIds: ['H9'],
    hideCardIds: ['H2', 'H9', 'SA'],
    note: null,
    ...over,
  } as PlayOptionsView;
}

describe('the decision comes before the card', () => {
  it('selects nothing until the player has decided', () => {
    const opts = options({ mustDecideReveal: true });
    expect(selectableCardIds(opts, null)).toEqual([]);
  });

  it('does not let a selected card imply the decision', () => {
    // The exact reported case: a trump was tapped while undecided.
    const opts = options({ mustDecideReveal: true });
    expect(isSelectable(opts, null, 'H9')).toBe(false);
    expect(isSelectable(opts, null, 'SA')).toBe(false);
  });

  it('will not submit an undecided selection', () => {
    const opts = options({ mustDecideReveal: true });
    expect(canSubmit(opts, null, 'H9')).toBe(false);
    expect(revealFlag(opts, null)).toBe(false);
  });
});

describe('choosing to reveal', () => {
  it('offers only trumps', () => {
    const opts = options({ mustDecideReveal: true });
    expect(selectableCardIds(opts, 'reveal')).toEqual(['H9']);
    expect(isSelectable(opts, 'reveal', 'H9')).toBe(true);
    expect(isSelectable(opts, 'reveal', 'SA')).toBe(false);
  });

  it('sends reveal: true', () => {
    expect(revealFlag(options({ mustDecideReveal: true }), 'reveal')).toBe(true);
    expect(canSubmit(options({ mustDecideReveal: true }), 'reveal', 'H9')).toBe(true);
  });
});

describe('choosing to keep it hidden', () => {
  it('offers every card in hand', () => {
    const opts = options({ mustDecideReveal: true });
    expect(selectableCardIds(opts, 'hide')).toEqual(['H2', 'H9', 'SA']);
  });

  it('sends reveal: false, including for a trump', () => {
    const opts = options({ mustDecideReveal: true });
    expect(revealFlag(opts, 'hide')).toBe(false);
    expect(canSubmit(opts, 'hide', 'H9')).toBe(true);
  });
});

describe('changing the decision', () => {
  it('swaps the legal set in both directions', () => {
    const opts = options({ mustDecideReveal: true });
    // Picked a trump under 'reveal', then switched to 'hide': still legal.
    expect(isSelectable(opts, 'hide', 'H9')).toBe(true);
    // Picked a non-trump under 'hide', then switched to 'reveal': now illegal,
    // so the UI clears the stale selection.
    expect(isSelectable(opts, 'reveal', 'SA')).toBe(false);
  });
});

describe('when no decision is needed', () => {
  it('gates purely on allowedCardIds', () => {
    const opts = options({ mustDecideReveal: false });
    expect(awaitingDecision(opts)).toBe(false);
    expect(selectableCardIds(opts, null)).toEqual(['H2', 'H9', 'SA']);
    expect(revealFlag(opts, null)).toBe(false);
    expect(revealFlag(opts, 'reveal')).toBe(false);
  });

  it('ignores a stray decision that would reveal by accident', () => {
    const opts = options({ mustDecideReveal: false });
    expect(revealFlag(opts, 'reveal')).toBe(false);
  });
});

describe('a forced decision', () => {
  it('forces reveal when the player has no cards left to keep it hidden', () => {
    const opts = options({ mustDecideReveal: true, canHide: false });
    expect(decisionIsForced(opts)).toBe('reveal');
  });

  it('leaves a genuine choice alone', () => {
    expect(decisionIsForced(options({ mustDecideReveal: true, canHide: true }))).toBeNull();
    expect(decisionIsForced(options({ mustDecideReveal: false }))).toBeNull();
  });
});

describe('not my turn', () => {
  it('offers nothing', () => {
    const opts = options({ isTurn: false, mustDecideReveal: true });
    expect(awaitingDecision(opts)).toBe(false);
    expect(selectableCardIds(opts, 'reveal')).toEqual([]);
    expect(canSubmit(opts, 'hide', 'H2')).toBe(false);
  });

  it('tolerates absent options', () => {
    expect(selectableCardIds(null, null)).toEqual([]);
    expect(canSubmit(null, null, 'H2')).toBe(false);
    expect(revealFlag(null, 'reveal')).toBe(false);
    expect(decisionIsForced(null)).toBeNull();
  });
});
