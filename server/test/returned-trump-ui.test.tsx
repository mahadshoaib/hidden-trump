import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Table } from '../../client/src/components/Table.js';
import { canSubmit, isSelectable, revealFlag } from '../../client/src/reveal.js';
import { revealTrump, playCard } from '../src/engine/game.js';
import { viewFor } from '../src/engine/view.js';
import { rigPlaying } from './helpers.js';

describe('returned trump in the actual table view', () => {
  it('renders, selects and plays the only returned card on trick 13', () => {
    const state = rigPlaying({ taker: 0, hiddenTrump: 'HK', trickNumber: 13,
      hands: [[], [], [], []], plays: [[1, 'S2'], [2, 'S3'], [3, 'S4']], turn: 0 });
    const before = viewFor(state, 0);
    expect(before.you!.hand).toEqual([]);
    expect(before.playOptions!.canHide).toBe(false);
    expect(renderToStaticMarkup(<Table view={before} onAct={() => {}} busy={false} />)).toContain('Reveal the trump');

    // The reveal button is its own request, followed by the server's new view.
    revealTrump(state, 0);
    const after = viewFor(state, 0);
    const html = renderToStaticMarkup(<Table view={after} onAct={() => {}} busy={false} />);
    const renderedButton = html.match(/<button[^>]*data-card-id="HK"[^>]*>/)?.[0];
    expect(renderedButton).toBeDefined();
    expect(renderedButton).not.toContain('disabled');
    // Select from the hand the component renders, not a server-only card ID.
    const selected = after.you!.hand.find(c => isSelectable(after.playOptions, null, c.id))!.id;
    expect(canSubmit(after.playOptions, null, selected)).toBe(true);
    playCard(state, 0, selected, revealFlag(after.playOptions, null));
    expect(state.phase).toBe('roundEnd');
    expect(state.result!.endedAtTrick).toBe(13);
    expect(state.lastTrick!.plays).toHaveLength(4);
  });

  it('allows another trump while retaining the returned card for a later trick', () => {
    const state = rigPlaying({ taker: 0, hiddenTrump: 'HK', hands: [['H2', 'C3'], ['S5'], ['S6'], ['S7']],
      plays: [[3, 'S2']], turn: 0 });
    revealTrump(state, 0);
    const view = viewFor(state, 0);
    const html = renderToStaticMarkup(<Table view={view} onAct={() => {}} busy={false} />);
    for (const id of ['H2', 'HK']) {
      expect(html.match(new RegExp(`<button[^>]*data-card-id="${id}"[^>]*>`))![0]).not.toContain('disabled');
      expect(canSubmit(view.playOptions, null, id)).toBe(true);
    }
    expect(canSubmit(view.playOptions, null, 'C3')).toBe(false);
    playCard(state, 0, 'H2', false);
    expect(state.hands[0].map(c => c.id)).toContain('HK');
  });
});
