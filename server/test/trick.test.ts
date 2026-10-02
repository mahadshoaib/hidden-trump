import { describe, expect, it } from 'vitest';
import { determineTrickWinner } from '../src/engine/trick.js';
import { play } from './helpers.js';

describe('trick winner — trump never revealed', () => {
  it('is simply the highest card of the led suit', () => {
    const winner = determineTrickWinner({
      plays: [play(0, 'H5'), play(1, 'HK'), play(2, 'H3'), play(3, 'H8')],
      revealIndex: null,
      trumpSuit: 'H', // secretly Hearts, but nobody knows
      trumpRevealed: false,
    });
    // The King of Hearts beats everything, because the trump is not live yet.
    expect(winner).toEqual({ seat: 1, card: expect.objectContaining({ id: 'HK' }) });
  });

  it('ignores off-suit cards even when they are higher', () => {
    const winner = determineTrickWinner({
      plays: [play(0, 'S7'), play(1, 'S4'), play(2, 'HA'), play(3, 'D9')],
      revealIndex: null,
      trumpSuit: 'H',
      trumpRevealed: false,
    });
    expect(winner?.card.id).toBe('S7');
  });
});

describe('worked example 7 — the led suit is secretly the trump suit', () => {
  it('excludes cards played before the reveal, even though they are the trump suit', () => {
    // P1 leads H5, P2 follows with HK, P3 is void and reveals playing H3,
    // P4 also holds no Hearts and plays H8.
    const winner = determineTrickWinner({
      plays: [play(0, 'H5'), play(1, 'HK'), play(2, 'H3', true), play(3, 'H8')],
      revealIndex: 2,
      trumpSuit: 'H',
      trumpRevealed: true,
    });
    // The King was played before the reveal, so it cannot win: the best of
    // P3 and P4's Hearts is the Eight.
    expect(winner?.seat).toBe(3);
    expect(winner?.card.id).toBe('H8');
  });

  it('falls back to the whole trick when nobody plays a trump after the reveal', () => {
    // P3 is void with no Hearts and has to fall back, P4 has none either.
    const winner = determineTrickWinner({
      plays: [play(0, 'H5'), play(1, 'HK'), play(2, 'S3', true), play(3, 'D9')],
      revealIndex: 2,
      trumpSuit: 'H',
      trumpRevealed: true,
    });
    expect(winner?.seat).toBe(1);
    expect(winner?.card.id).toBe('HK');
  });

  it('lets the revealing player win with a low trump when the leader is higher but played earlier', () => {
    const winner = determineTrickWinner({
      plays: [play(0, 'HA'), play(1, 'HK'), play(2, 'H2', true), play(3, 'H3', true)],
      revealIndex: 2,
      trumpSuit: 'H',
      trumpRevealed: true,
    });
    expect(winner?.seat).toBe(3);
    expect(winner?.card.id).toBe('H3');
  });

  it('a reveal on the fourth and last card still only counts itself', () => {
    const winner = determineTrickWinner({
      plays: [play(0, 'H9'), play(1, 'HK'), play(2, 'C2'), play(3, 'H4', true)],
      revealIndex: 3,
      trumpSuit: 'H',
      trumpRevealed: true,
    });
    expect(winner?.seat).toBe(3);
    expect(winner?.card.id).toBe('H4');
  });
});

describe('trick winner — trump already revealed on a later trick', () => {
  it('is fully live: any trump beats the led suit', () => {
    const winner = determineTrickWinner({
      plays: [play(0, 'SA'), play(1, 'SK'), play(2, 'H2'), play(3, 'H3')],
      revealIndex: null, // no reveal this trick — the trump was live already
      trumpSuit: 'H',
      trumpRevealed: true,
    });
    expect(winner?.seat).toBe(3);
    expect(winner?.card.id).toBe('H3');
  });

  it('a trump played by a void player still wins the trick once the trump is live', () => {
    const winner = determineTrickWinner({
      plays: [play(0, 'SA'), play(1, 'SK'), play(2, 'H2'), play(3, 'C7')],
      revealIndex: null,
      trumpSuit: 'H',
      trumpRevealed: true,
    });
    expect(winner?.seat).toBe(2);
    expect(winner?.card.id).toBe('H2');
  });

  it('falls back to the led suit when the trick genuinely contains no trump', () => {
    const winner = determineTrickWinner({
      plays: [play(0, 'S4'), play(1, 'S9'), play(2, 'H2'), play(3, 'C7')].filter((p) => p.card.suit !== 'H'),
      revealIndex: null,
      trumpSuit: 'H',
      trumpRevealed: true,
    });
    expect(winner?.card.id).toBe('S9');
  });
});

describe('trick winner — safety rails', () => {
  it('returns null for an empty trick', () => {
    expect(
      determineTrickWinner({ plays: [], revealIndex: null, trumpSuit: 'H', trumpRevealed: false }),
    ).toBeNull();
  });
});
