import type { Card, Phase, PlayOptionsView, Rank, Seat, Suit, Team } from '@hidden-trump/shared';
import type { RoundEndReason } from '@hidden-trump/shared';

export type { Card, Phase, PlayOptionsView, Rank, RoundEndReason, Seat, Suit, Team };

/** Deterministic random source, injected so tests can shuffle reproducibly. */
export type Rng = () => number;

export interface PlayerSlot {
  disconnectedAt?: number;
  seat: Seat;
  name: string | null;
  token: string | null;
  connected: boolean;
}

export interface BidRecord {
  seat: Seat;
  value: number;
  /** Did this bid take the lead at the time it was made? */
  tookLead: boolean;
}

export interface BiddingState {
  /** Seat whose turn to bid; null once the auction is over. */
  turn: Seat | null;
  bids: BidRecord[];
  highBid: number | null;
  leadingSeat: Seat | null;
  takerSeat: Seat | null;
  /** Bidding stopped early because somebody bid the maximum. */
  shortCircuited: boolean;
}

export interface TrickPlay {
  seat: Seat;
  card: Card;
  /** This play flipped the secret trump card face up. */
  viaReveal: boolean;
  /** Cosmetic only — the taker discarding while keeping the trump hidden. */
  faceDown: boolean;
}

export interface TrickState {
  number: number;
  plays: TrickPlay[];
  /** Index into `plays` at which the trump was revealed, or null. */
  revealIndex: number | null;
  /** How many cards this trick will collect. 4 for tricks 1-12, 3 for trick 13. */
  expectedCards: number;
  complete: boolean;
  winnerSeat: Seat | null;
}

/**
 * A trick that has finished resolving. Kept around after the live trick is
 * cleared so the table can show what just happened, and so a round can be
 * audited after the fact.
 */
export interface CompletedTrick {
  number: number;
  plays: TrickPlay[];
  revealIndex: number | null;
  winnerSeat: Seat;
  winningCardId: string;
  /** Size of the pile this win swept, or null. */
  swept: number | null;
  blockedBy: 'ace' | 'below-floor' | null;
}

export interface ScoringState {
  /** Trick numbers sitting in the shared, ever-growing unclaimed pile. */
  pile: number[];
  secured: Record<Team, number>;
  /** The player who won the immediately preceding trick. */
  lastWinnerSeat: Seat | null;
  /** Trick on which the trump was revealed; null while it is still hidden. */
  trumpRevealedAtTrick: number | null;
}

export interface RoundResult {
  winnerTeam: Team;
  reason: RoundEndReason;
  endedAtTrick: number;
}

export interface HistoryEntry {
  round: number;
  winnerTeam: Team;
  bid: number;
  takerSeat: Seat;
  endedAtTrick: number;
  teamA: number;
  teamB: number;
  pileSize: number;
}

export interface LogEntry {
  id: number;
  text: string;
  trick: number | null;
}

export interface TrumpState {
  /** Revealer must finish their play; survives refresh and cannot be undone. */
  pendingSeat?: Seat | null;
  /** The secret trump card. Server-only until `revealed` flips. */
  hiddenCard: Card | null;
  /** Server-only until `revealed` flips. */
  suit: Suit | null;
  revealed: boolean;
  revealedAtTrick: number | null;
}

/**
 * Authoritative game state for one room. Nothing in here is ever sent to a
 * client verbatim — `view.ts` builds a redacted per-seat projection.
 */
export interface GameState {
  roomCode: string;
  phase: Phase;
  roundNumber: number;
  dealer: Seat;
  seats: Record<Seat, PlayerSlot>;
  bidding: BiddingState;
  trump: TrumpState;
  /** Active hands. The taker's face-down trump card is *not* in here. */
  hands: Record<Seat, Card[]>;
  /** Undealt remainder. */
  deck: Card[];
  trick: TrickState;
  previousLedSuit: Suit | null;
  turn: Seat | null;
  scoring: ScoringState;
  lastTrick: CompletedTrick | null;
  result: RoundResult | null;
  history: HistoryEntry[];
  log: LogEntry[];
  logSeq: number;
  /** Epoch ms of the last mutation, used to reap abandoned rooms. */
  updatedAt: number;
}
