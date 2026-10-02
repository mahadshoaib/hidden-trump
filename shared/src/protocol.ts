/**
 * The wire protocol: the *redacted* per-player projection of game state that the
 * server is allowed to send, plus the Socket.IO event signatures.
 *
 * The single most important rule in this file: nothing here may ever expose
 * another player's hand, or the identity of the face-down trump card, before it
 * is legitimately revealed. See `server/src/engine/view.ts` for enforcement.
 */

import type { Card, Seat, Suit, Team } from './cards.js';

export type Phase = 'lobby' | 'bidding' | 'trumpSelection' | 'playing' | 'roundEnd';

export type RoundEndReason = 'bid-met' | 'opposition-nullified' | 'final-tally';

export interface SeatView {
  seat: Seat;
  name: string | null;
  connected: boolean;
  isYou: boolean;
  /** Cards left in that seat's *active* hand. Public information. */
  cardCount: number;
  /** True for the taker while the trump card is still face down. */
  trumpSetAside: boolean;
}

export interface BidView {
  seat: Seat;
  value: number;
  /** Did this bid take the lead at the time it was made? */
  tookLead: boolean;
}

export interface BiddingView {
  bids: BidView[];
  /** Whose turn to bid, or null once the auction is over. */
  currentSeat: Seat | null;
  highBid: number | null;
  leadingSeat: Seat | null;
  takerSeat: Seat | null;
  /** Lowest bid that would take the lead right now (null before bidding starts). */
  valueToLead: number | null;
  /** True when bidding stopped early because somebody bid 13. */
  shortCircuited: boolean;
}

export interface TrumpView {
  revealed: boolean;
  /** Only ever set once revealed. */
  card: Card | null;
  /** Only ever set once revealed. */
  suit: Suit | null;
  revealedAtTrick: number | null;
}

export interface TrickCardView {
  seat: Seat;
  /** Null for another player's card while it is still face down. */
  card: Card | null;
  /** True when this play flipped the secret trump card face up. */
  viaReveal: boolean;
  /** The taker's "keep hidden" discard, still hidden from everyone else. */
  faceDown: boolean;
}

export interface TrickView {
  number: number;
  cards: TrickCardView[];
  ledSuit: Suit | null;
  /** Index into `cards` at which the trump was revealed, or null. */
  revealIndex: number | null;
  /** How many cards this trick will collect. Always 4 — the deal balances. */
  expectedCards: number;
  complete: boolean;
  winnerSeat: Seat | null;
}

export interface CompletedTrickView {
  number: number;
  cards: TrickCardView[];
  ledSuit: Suit | null;
  revealIndex: number | null;
  winnerSeat: Seat;
  winningCardId: string;
  swept: number | null;
  blockedBy: 'ace' | 'below-floor' | null;
}

export interface PlayOptionsView {
  isTurn: boolean;
  leading: boolean;
  /** True when you must send an explicit reveal/keep-hidden decision with your play. */
  mustDecideReveal: boolean;
  canReveal: boolean;
  canHide: boolean;
  /** Legal card ids *if* you reveal. */
  revealCardIds: string[];
  /** Legal card ids *if* you keep the trump hidden. */
  hideCardIds: string[];
  /** Union of the two, for simple highlighting. */
  allowedCardIds: string[];
  handEmpty: boolean;
  note: string;
}

export interface ScoringView {
  teamA: number;
  teamB: number;
  pileSize: number;
  lastWinnerSeat: Seat | null;
  sweepFloorTrick: number | null;
}

export interface RoundResultView {
  winnerTeam: Team;
  reason: RoundEndReason;
  endedAtTrick: number;
  bid: number;
  takerSeat: Seat;
  teamA: number;
  teamB: number;
  /** Tricks still sitting unclaimed when the round ended. Worthless to both sides. */
  pile: number[];
}

export interface HistoryEntryView {
  round: number;
  winnerTeam: Team;
  bid: number;
  takerSeat: Seat;
  endedAtTrick: number;
  teamA: number;
  teamB: number;
  pileSize: number;
}

export interface LogEntryView {
  id: number;
  text: string;
  trick: number | null;
}

export interface GameView {
  roomCode: string;
  phase: Phase;
  roundNumber: number;
  dealer: Seat;
  seats: SeatView[];
  you: { seat: Seat; name: string; hand: Card[] } | null;
  bidding: BiddingView;
  trump: TrumpView;
  trick: TrickView;
  previousLedSuit: Suit | null;
  turn: Seat | null;
  /** The trick that finished most recently, kept for the table and the log. */
  lastTrick: CompletedTrickView | null;
  playOptions: PlayOptionsView | null;
  scoring: ScoringView;
  result: RoundResultView | null;
  history: HistoryEntryView[];
  log: LogEntryView[];
}

export interface JoinRoomPayload {
  roomCode: string;
  name: string;
  /** Client-generated, persisted in localStorage. Used to reclaim a seat. */
  token: string;
  preferredSeat?: Seat;
}

export type Ack<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ClientToServerEvents {
  leave_room: (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  reveal_trump: (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  join_room: (payload: JoinRoomPayload, ack: (res: Ack<{ seat: Seat }>) => void) => void;
  claim_seat: (payload: { seat: Seat }, ack: (res: Ack<{ seat: Seat }>) => void) => void;
  start_round: (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  place_bid: (payload: { value: number }, ack: (res: Ack) => void) => void;
  choose_trump: (payload: { cardId: string }, ack: (res: Ack) => void) => void;
  play_card: (payload: { cardId: string; reveal: boolean }, ack: (res: Ack) => void) => void;
  next_round: (payload: Record<string, never>, ack: (res: Ack) => void) => void;
}

export interface ServerToClientEvents {
  state: (view: GameView) => void;
  error: (payload: { message: string }) => void;
}
