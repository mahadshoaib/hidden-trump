/**
 * The void-and-reveal flow, as pure logic.
 *
 * Being void in the suit led is the one moment in the round where a player makes
 * a decision *and then* picks a card. Those have to be separate steps: if the
 * decision were inferred from the selected card, tapping a trump would silently
 * mean "reveal" and tapping it again would silently mean "keep it hidden", so the
 * player would never actually choose anything. That is exactly what happened
 * before this existed.
 */

import type { PlayOptionsView } from '@hidden-trump/shared';

export type RevealDecision = 'reveal' | 'hide';

/** Whether the player still has to choose, or has already chosen. */
export function awaitingDecision(options: PlayOptionsView | null): boolean {
  return options !== null && options.isTurn && options.mustDecideReveal;
}

/**
 * True when there is only one possible answer, so the choice is not really a
 * choice. This happens when a player has run out of active cards: their only
 * legal move is playing the face-down trump, which reveals it.
 */
export function decisionIsForced(options: PlayOptionsView | null): RevealDecision | null {
  if (!awaitingDecision(options) || options === null) return null;
  if (options.canHide) return null;
  return 'reveal';
}

/**
 * The cards a player may currently select.
 *
 * Before the decision is made this is empty — that is the whole point: no card
 * can be picked until the choice is locked in. Afterwards it is exactly the set
 * the chosen branch allows, so revealing exposes only trumps and keeping the
 * trump hidden exposes anything.
 */
export function selectableCardIds(options: PlayOptionsView | null, decision: RevealDecision | null): string[] {
  if (options === null || !options.isTurn) return [];
  if (!options.mustDecideReveal) return options.allowedCardIds;
  if (decision === 'reveal') return options.revealCardIds;
  if (decision === 'hide') return options.hideCardIds;
  return [];
}

export function isSelectable(options: PlayOptionsView | null, decision: RevealDecision | null, cardId: string): boolean {
  return selectableCardIds(options, decision).includes(cardId);
}

/** Whether a selection may be submitted, and what to tell the server. */
export function canSubmit(
  options: PlayOptionsView | null,
  decision: RevealDecision | null,
  selected: string | null,
): boolean {
  if (options === null || !options.isTurn || selected === null) return false;
  if (!options.mustDecideReveal) return options.allowedCardIds.includes(selected);
  if (decision === null) return false;
  return selectableCardIds(options, decision).includes(selected);
}

/**
 * The `reveal` flag sent with play_card. Deliberately a plain boolean derived
 * from the explicit decision, never from the card that was clicked.
 */
export function revealFlag(options: PlayOptionsView | null, decision: RevealDecision | null): boolean {
  if (options === null || !options.mustDecideReveal) return false;
  return decision === 'reveal';
}
