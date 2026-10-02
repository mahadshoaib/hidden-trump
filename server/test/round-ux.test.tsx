import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RoundEndReason } from '@hidden-trump/shared';
import { Lobby } from '../../client/src/components/Lobby.js';
import { RoundEnd } from '../../client/src/components/RoundEnd.js';
import { startRound, nextRound, placeBid, playCard, revealTrump } from '../src/engine/game.js';
import { mulberry32 } from '../src/engine/deck.js';
import { viewFor } from '../src/engine/view.js';
import { table, rigPlaying } from './helpers.js';

describe('round numbering and explanations', () => {
  it('starts round 1 in the lobby, engine and log, then rotates to round 2', () => {
    const state = table();
    expect(state.roundNumber).toBe(1);
    expect(renderToStaticMarkup(<Lobby view={viewFor(state, 0)} onAct={() => {}} busy={false} />)).toContain('Start round 1');
    startRound(state, mulberry32(1));
    expect(state.log[0]!.text).toContain('Round 1');
    state.phase = 'roundEnd';
    nextRound(state, mulberry32(2));
    expect(state.roundNumber).toBe(2);
    expect(state.dealer).toBe(1);
    expect(state.log[0]!.text).toContain('Round 2');
  });

  it('uses the standing contract and lockout threshold after a final underbid', () => {
    const state = table();
    startRound(state, mulberry32(1));
    for (const bid of [11, 4, 7, 2]) placeBid(state, state.bidding.turn!, bid);
    expect(state.bidding.highBid).toBe(11);
    expect(state.log.map(e => e.text).join('\n')).toContain('takes the contract on 11.');
    expect(state.log.map(e => e.text).join('\n')).toContain('They need 3 tricks');
  });

  it.each([false, true])('never describes a reveal as keeping hidden (committed=%s)', committed => {
    const state = rigPlaying({ taker: 0, hiddenTrump: 'HK', hands: [['S4'], ['H2', 'C3'], ['S5'], ['S6']],
      plays: [[0, 'S2']], turn: 1 });
    if (committed) revealTrump(state, 1);
    playCard(state, 1, 'H2', !committed);
    const log = state.log.map(e => e.text).join('\n');
    expect(log).toContain('reveals the trump');
    expect(log).not.toContain('keeps the trump hidden');
  });

  it.each<[RoundEndReason, string]>([
    ['bid-met', 'reached their bid'],
    ['opposition-nullified', 'locked the taker out'],
    ['final-tally', 'All thirteen tricks are played'],
  ])('renders the real explanation for %s', (reason, expected) => {
    const state = rigPlaying({ taker: 0, hiddenTrump: 'HK', hands: [[], [], [], []] });
    state.phase = 'roundEnd';
    state.result = { winnerTeam: 'A', reason, endedAtTrick: 13 };
    const html = renderToStaticMarkup(<RoundEnd view={viewFor(state, 0)} onAct={() => {}} busy={false} />);
    expect(html).toContain(expected);
    expect(html).not.toContain('The round is over.');
  });
});
