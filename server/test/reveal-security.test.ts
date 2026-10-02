import { describe, expect, it } from 'vitest';
import { SUITS } from '@hidden-trump/shared';
import { makeDeck, mulberry32, shuffle } from '../src/engine/deck.js';
import { playCard, revealTrump } from '../src/engine/game.js';
import { viewFor } from '../src/engine/view.js';
import { rigPlaying } from './helpers.js';

describe('pre-reveal inference attacks', () => {
  it('cannot reconstruct the secret suit by comparing entire payloads across 256 seeded hands', () => {
    for (let seed = 1; seed <= 256; seed++) {
      const deck = shuffle(makeDeck().filter(c => c.id !== 'S2'), mulberry32(seed));
      const own = deck.filter(c => c.suit !== 'S').slice(0, 13);
      const pool = deck.filter(c => !own.includes(c));
      const worlds = SUITS.map(suit => {
        const hidden = pool.find(c => c.suit === suit)!;
        const rest = pool.filter(c => c !== hidden);
        return rigPlaying({ taker: 0, hiddenTrump: hidden.id,
          hands: [rest.slice(0, 11).map(c => c.id), own.map(c => c.id),
            rest.slice(11, 24).map(c => c.id), rest.slice(24).map(c => c.id)],
          plays: [[0, 'S2']], turn: 1 });
      });
      const payloads = worlds.map(s => JSON.stringify(viewFor(s, 1)));
      // A cheating client enumerates every candidate secret, including legal
      // move IDs, notes, counts and logs, and eliminates mismatching payloads.
      for (const observed of payloads) {
        const possibleSuits = SUITS.filter((_, index) => payloads[index] === observed);
        expect(possibleSuits, `seed ${seed}: candidate reconstruction`).toEqual(SUITS);
      }
      const options = viewFor(worlds[0]!, 1).playOptions!;
      // The original attack: infer trump from the suit of offered reveal IDs.
      expect(new Set(options.revealCardIds.map(id => id[0])).size).toBe(0);
    }
  });

  it('commits revelation before sending legal trumps and preserves the obligation across views', () => {
    const state = rigPlaying({ taker: 0, hiddenTrump: 'HK',
      hands: [['S4'], ['H2', 'C3'], ['S5'], ['S6']], plays: [[0, 'S2']], turn: 1 });
    expect(viewFor(state, 1).playOptions!.revealCardIds).toEqual([]);
    revealTrump(state, 1);
    for (const seat of [0, 1, 2, 3] as const) expect(viewFor(state, seat).trump.suit).toBe('H');
    expect(viewFor(state, 1).playOptions!.allowedCardIds).toEqual(['H2']);
    expect(() => playCard(state, 1, 'C3', false)).toThrow();
    expect(state.trump.revealed).toBe(true);
    expect(() => revealTrump(state, 1)).toThrow();
    playCard(state, 1, 'H2', false);
    expect(state.trick.revealIndex).toBe(1);
    expect(state.trick.plays[1]!.viaReveal).toBe(true);
  });
});
