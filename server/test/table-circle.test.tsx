import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RANKS, SUIT_SYMBOL, type Card, type GameView, type Seat } from '@hidden-trump/shared';
import { Table } from '../../client/src/components/Table.js';

function hand(prefix: string): Card[] {
  return (['S', 'H', 'D', 'C', 'S'] as const).map((suit, i) => ({
    id: `${prefix}${i}`,
    suit,
    rank: RANKS[i] as Card['rank'],
  }));
}

function playingView(overrides: Partial<GameView> = {}): GameView {
  return {
    roomCode: 'CIRC',
    phase: 'playing',
    roundNumber: 1,
    dealer: 0,
    seats: [0, 1, 2, 3].map((seat) => ({
      seat: seat as Seat,
      name: `P${(seat as number) + 1}`,
      connected: true,
      isYou: seat === 0,
      cardCount: 13,
      trumpSetAside: false,
    })),
    you: { seat: 0, name: 'Alex', hand: hand('a') },
    bidding: {
      bids: [],
      highBid: 8,
      currentSeat: null,
      leadingSeat: 0,
      takerSeat: 0,
      valueToLead: 9,
      shortCircuited: false,
    },
    trump: { revealed: false, card: null, suit: null, revealedAtTrick: null },
    trick: {
      number: 3,
      cards: [
        { seat: 0, card: hand('a')[0] as Card, viaReveal: false, faceDown: false },
        { seat: 1, card: hand('b')[0] as Card, viaReveal: false, faceDown: false },
        { seat: 2, card: null, viaReveal: true, faceDown: false },
      ],
      ledSuit: 'S',
      revealIndex: 2,
      expectedCards: 4,
      complete: false,
      winnerSeat: null,
    },
    previousLedSuit: null,
    turn: 3,
    lastTrick: null,
    playOptions: {
      isTurn: false,
      leading: false,
      mustDecideReveal: false,
      canReveal: false,
      canHide: false,
      revealCardIds: [],
      hideCardIds: [],
      allowedCardIds: [],
      handEmpty: false,
      note: '',
    },
    scoring: { teamA: 0, teamB: 0, pileSize: 2, lastWinnerSeat: 1, sweepFloorTrick: 5 },
    result: null,
    history: [],
    log: [],
    ...overrides,
  };
}

/** The slot class for each seat label, in DOM order. */
function seatSlots(html: string): string[] {
  return [...html.matchAll(/seat-slot-(bottom|left|top|right)/g)].map((m) => m[1] as string);
}

function seatLabels(html: string): string[] {
  return [...html.matchAll(/seat-slot-\w+[^>]*>[\s\S]*?class="team [ab]">P(\d)/g)].map((m) => m[1] as string);
}

describe('the table is drawn as a circle around you', () => {
  it('puts every seat in a slot, one per position', () => {
    const html = renderToStaticMarkup(
      <Table view={playingView()} onAct={() => undefined} busy={false} />,
    );
    expect(seatSlots(html)).toEqual(['bottom', 'left', 'top', 'right']);
  });

  it('renders all four seats, including your own', () => {
    const html = renderToStaticMarkup(
      <Table view={playingView()} onAct={() => undefined} busy={false} />,
    );
    expect(seatLabels(html)).toEqual(['1', '2', '3', '4']);
    expect(html).toContain('you');
  });

  it('rotates the circle so your own seat is the one at the bottom', () => {
    // Now viewing as P3: P3 must be bottom, and turn order P3 -> P4 -> P1 -> P2
    // must still run bottom -> left -> top -> right.
    const html = renderToStaticMarkup(
      <Table
        view={playingView({
          you: { seat: 2, name: 'Sam', hand: hand('b') },
          seats: [0, 1, 2, 3].map((seat) => ({
            seat: seat as Seat,
            name: `P${(seat as number) + 1}`,
            connected: true,
            isYou: seat === 2,
            cardCount: 13,
            trumpSetAside: false,
          })),
        })}
        onAct={() => undefined}
        busy={false}
      />,
    );
    expect(seatSlots(html)).toEqual(['bottom', 'left', 'top', 'right']);
    // DOM order follows turn order, so P3 is first and bottom.
    expect(seatLabels(html)).toEqual(['3', '4', '1', '2']);
  });

  it('shows the played cards in the middle of the table, in play order', () => {
    const html = renderToStaticMarkup(
      <Table view={playingView()} onAct={() => undefined} busy={false} />,
    );
    expect(html).toContain('trick-centre');
    // P1's card and P2's card are real; P2's is a face-down unknown discard.
    const centre = html.slice(html.indexOf('trick-centre'), html.indexOf('seat-slot-bottom'));
    expect(centre).toContain(`${SUIT_SYMBOL.S} ${RANKS[0]}`);
    expect(centre).toContain('revealed');
    // The revealer is flagged so a player can see why their card is missing.
    expect(centre).toContain('P3');
  });

  it('marks the seat whose turn it is', () => {
    const html = renderToStaticMarkup(
      <Table view={playingView({ turn: 0 })} onAct={() => undefined} busy={false} />,
    );
    // Class order is "seat-box seat-slot-X [me] acting", so match loosely.
    expect(html).toMatch(/seat-slot-\w+[^"]*\bacting\b/);
    // P1 is the seat on turn, and P1 is at the bottom here.
    expect(html).toMatch(/seat-slot-bottom[^"]*\bacting\b/);
  });

  it('says so when nobody has played yet', () => {
    const empty = playingView();
    const html = renderToStaticMarkup(
      <Table
        view={playingView({ trick: { ...empty.trick, cards: [], revealIndex: null } })}
        onAct={() => undefined}
        busy={false}
      />,
    );
    expect(html).toContain('nobody has played yet');
  });
});