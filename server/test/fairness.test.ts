import { describe, expect, it, vi } from 'vitest';
import { SEATS, type Seat } from '@hidden-trump/shared';
import { chooseTrump, placeBid, startRound } from '../src/engine/game.js';
import { makeDeck, mulberry32 } from '../src/engine/deck.js';
import { capActiveTrumps, countSuit, dealRemainder, type Hands } from '../src/engine/fairness.js';
import { card, table } from './helpers.js';

describe('random dealing with an active-hand cap', () => {
  it('never leaks cap corrections by removing cards from a visible bidding hand', () => {
    let corrected = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const state = table();
      startRound(state, mulberry32(seed));
      const taker = state.bidding.turn!;
      placeBid(state, taker, 13);
      // Pick the strongest opening suit to exercise cap corrections frequently.
      const hidden = [...state.hands[taker]].sort((a, b) =>
        countSuit(state.hands[taker], b.suit) - countSuit(state.hands[taker], a.suit))[0]!;
      const opening = SEATS.map(seat => state.hands[seat].filter(c => c.id !== hidden.id));
      const ordinaryTrumps = state.deck.filter((_, index) => (state.deck.length - 1 - index) % 4 === 0)
        .filter(c => c.suit === hidden.suit).length + countSuit(opening[taker]!, hidden.suit);
      if (ordinaryTrumps > 6) corrected++;
      chooseTrump(state, taker, hidden.id, mulberry32(seed + 2000));
      for (const seat of SEATS) {
        const missingKnownCards = opening[seat]!.filter(c => !state.hands[seat].some(after => after.id === c.id));
        expect(missingKnownCards, `seed ${seed}, seat ${seat}: observable cap swap`).toEqual([]);
      }
    }
    expect(corrected).toBeGreaterThan(5);
  });
  it('has genuine spread over 2,000 seeded deals, never exceeds six, and preserves all 52 cards', () => {
    const frequencies = Array<number>(7).fill(0);
    for (let seed = 1; seed <= 2000; seed++) {
      const state = table();
      state.dealer = (seed % 4) as Seat;
      const rng = mulberry32(seed);
      startRound(state, rng);
      const taker = state.bidding.turn!;
      placeBid(state, taker, 13);
      chooseTrump(state, taker, state.hands[taker][0]!.id, rng);
      const count = countSuit(state.hands[taker], state.trump.suit!);
      expect(count).toBeLessThanOrEqual(6);
      frequencies[count]!++;
      expect(state.hands[taker]).toHaveLength(12);
      for (const seat of SEATS.filter(s => s !== taker)) expect(state.hands[seat]).toHaveLength(13);
      const all = [...SEATS.flatMap(s => state.hands[s]), state.trump.hiddenCard!];
      expect(all.map(c => c.id).sort()).toEqual(makeDeck().map(c => c.id).sort());
    }
    expect(frequencies.every(n => n > 0), JSON.stringify(frequencies)).toBe(true);
    expect(Math.max(...frequencies) / 2000).toBeLessThan(0.45);
    expect(frequencies[6]! / 2000).toBeLessThan(0.15);
    const mean = frequencies.reduce((sum, n, count) => sum + n * count, 0) / 2000;
    const variance = frequencies.reduce((sum, n, count) => sum + n * (count - mean) ** 2, 0) / 2000;
    expect(variance).toBeGreaterThan(1);
    console.info('Active-trump counts 0–6 over 2,000 seeds:', frequencies);
  });

  it('leaves an unconstrained deal unchanged below the cap, including exact deal direction', () => {
    const remaining = makeDeck().filter(c => c.suit !== 'S').slice(0, 32);
    const existing: Hands = { 0: [], 1: [], 2: [], 3: [] };
    const rng = vi.fn(() => 0.5);
    const order: Seat[] = [2, 3, 0, 1];
    const actual = dealRemainder(remaining, order, 2, 'S', existing, rng);
    for (let i = 0; i < 32; i++) expect(actual[order[i % 4]!][Math.floor(i / 4)]).toEqual(remaining[31 - i]);
    expect(existing).toEqual({ 0: [], 1: [], 2: [], 3: [] });
    expect(rng).not.toHaveBeenCalled();
  });

  function overfull(): Hands {
    const own = ['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'C2', 'C3', 'C4', 'C5'].map(card);
    const rest = makeDeck().filter(c => c.id !== 'SA' && !own.some(o => o.id === c.id));
    return { 0: own, 1: rest.slice(0, 13), 2: rest.slice(13, 26), 3: rest.slice(26) };
  }

  it('swaps exactly two excess cards, preserving hand sizes and every other position', () => {
    const hands = overfull();
    const before = structuredClone(hands);
    capActiveTrumps(hands, 0, 'S', mulberry32(42));
    expect(countSuit(hands[0], 'S')).toBe(6);
    const changed = SEATS.flatMap(s => hands[s].filter((c, i) => c.id !== before[s][i]!.id));
    expect(changed).toHaveLength(4);
    expect(SEATS.flatMap(s => hands[s]).map(c => c.id).sort()).toEqual(SEATS.flatMap(s => before[s]).map(c => c.id).sort());
    expect(SEATS.map(s => hands[s].length)).toEqual([12, 13, 13, 13]);
  });

  it('randomizes both removed trumps and non-trump targets', () => {
    const removed = new Set<string>();
    const targets = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const hands = overfull();
      const before = [...hands[0]];
      capActiveTrumps(hands, 0, 'S', mulberry32(seed));
      before.filter(c => !hands[0].includes(c)).forEach(c => removed.add(c.id));
      hands[0].filter(c => !before.includes(c)).forEach(c => targets.add(c.id));
    }
    expect(removed.size).toBe(8);
    expect(targets.size).toBeGreaterThan(20);
  });

  it('allows six active trumps plus the hidden seventh without changing a card', () => {
    const hands = overfull();
    capActiveTrumps(hands, 0, 'S', mulberry32(1));
    const before = structuredClone(hands);
    const rng = vi.fn(() => 0.5);
    capActiveTrumps(hands, 0, 'S', rng);
    expect(hands).toEqual(before);
    expect(rng).not.toHaveBeenCalled();
  });
});
