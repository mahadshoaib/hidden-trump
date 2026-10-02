import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RANKS, SUIT_SYMBOL, type Card, type GameView, type Seat, type Suit } from '@hidden-trump/shared';
import { BiddingPanel } from '../../client/src/components/BiddingPanel.js';
import { TrumpPanel } from '../../client/src/components/TrumpPanel.js';

const SUITS: Suit[] = ['S', 'H', 'D', 'C', 'S'];

/** Five opening cards, as the engine deals them. */
function hand(prefix: string): Card[] {
  return SUITS.map((suit, i) => ({ id: `${prefix}${i}`, suit, rank: RANKS[i] as Card['rank'] }));
}

/** What CardFace actually puts on screen, e.g. "♠ 2". */
function label(card: Card): string {
  return `${SUIT_SYMBOL[card.suit]} ${card.rank}`;
}

/** The rendered card faces, in order. */
function renderedCards(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1] as string);
}

function baseView(overrides: Partial<GameView>): GameView {
  return {
    roomCode: 'REND',
    phase: 'bidding',
    roundNumber: 1,
    dealer: 0,
    seats: [0, 1, 2, 3].map((seat) => ({
      seat: seat as Seat,
      name: `P${(seat as number) + 1}`,
      connected: true,
      isYou: seat === 0,
      cardCount: 5,
      trumpSetAside: false,
    })),
    you: { seat: 0, name: 'Alex', hand: hand('a') },
    bidding: {
      bids: [],
      highBid: null,
      currentSeat: 0,
      leadingSeat: null,
      takerSeat: null,
      valueToLead: 1,
      shortCircuited: false,
    },
    trump: { revealed: false, card: null, suit: null, revealedAtTrick: null },
    trick: {
      number: 1,
      cards: [],
      ledSuit: null,
      revealIndex: null,
      expectedCards: 4,
      complete: false,
      winnerSeat: null,
    },
    previousLedSuit: null,
    turn: null,
    lastTrick: null,
    playOptions: null,
    scoring: { teamA: 0, teamB: 0, pileSize: 0, lastWinnerSeat: null, sweepFloorTrick: null },
    result: null,
    history: [],
    log: [],
    ...overrides,
  };
}

/**
 * Bidding is decided purely off the five opening cards, so the hand has to be
 * on screen while it happens. This shipped broken once because the cards were
 * in the payload the whole time and no test ever looked at the rendered output.
 */
describe('the hand is visible during bidding', () => {
  it('renders all five opening cards', () => {
    const html = renderToStaticMarkup(
      <BiddingPanel view={baseView({})} onAct={() => undefined} busy={false} />,
    );
    expect(renderedCards(html)).toEqual(hand('a').map(label));
    expect(html).toContain('bid on');
  });

  it('renders the hand even when it is not your turn', () => {
    const html = renderToStaticMarkup(
      <BiddingPanel
        view={baseView({ bidding: { ...baseView({}).bidding, currentSeat: 2 } })}
        onAct={() => undefined}
        busy={false}
      />,
    );
    expect(renderedCards(html)).toEqual(hand('a').map(label));
    // And it is not offering you the bid controls.
    expect(html).not.toContain('>Bid<');
  });

  it('shows the taker their cards while choosing the trump', () => {
    const html = renderToStaticMarkup(
      <TrumpPanel
        view={baseView({ phase: 'trumpSelection', bidding: { ...baseView({}).bidding, highBid: 4, takerSeat: 0 } })}
        onAct={() => undefined}
        busy={false}
      />,
    );
    expect(renderedCards(html)).toEqual(hand('a').map(label));
  });

  it('shows a non-taker their cards while they wait', () => {
    const html = renderToStaticMarkup(
      <TrumpPanel
        view={baseView({
          phase: 'trumpSelection',
          you: { seat: 1, name: 'Sam', hand: hand('b') },
          bidding: { ...baseView({}).bidding, highBid: 4, takerSeat: 0 },
        })}
        onAct={() => undefined}
        busy={false}
      />,
    );
    expect(renderedCards(html)).toEqual(hand('b').map(label));
  });
});
