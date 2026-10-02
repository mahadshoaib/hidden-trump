/**
 * Card + seat primitives. Pure data + tiny helpers shared by the server engine
 * and the React client. No networking, no React, no game rules in here.
 */

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

export const SUIT_SYMBOL: Record<Suit, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

export const SUIT_NAME: Record<Suit, string> = {
  S: 'Spades',
  H: 'Hearts',
  D: 'Diamonds',
  C: 'Clubs',
};

/** Low -> high. Ace is the highest rank. */
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  readonly id: string;
  readonly suit: Suit;
  readonly rank: Rank;
}

export const RANK_VALUE: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export function makeCard(suit: Suit, rank: Rank): Card {
  return { id: `${suit}${rank}`, suit, rank };
}

export function rankValue(rank: Rank): number {
  return RANK_VALUE[rank];
}

export function isAce(card: Card): boolean {
  return card.rank === 'A';
}

/** e.g. "♥A" */
export function formatCard(card: Card): string {
  return `${SUIT_SYMBOL[card.suit]}${card.rank}`;
}

/** e.g. "Ace of Hearts" */
export function describeCard(card: Card): string {
  const rank =
    card.rank === 'A' ? 'Ace' : card.rank === 'K' ? 'King' : card.rank === 'Q' ? 'Queen' : card.rank === 'J' ? 'Jack' : card.rank;
  return `${rank} of ${SUIT_NAME[card.suit]}`;
}

export function findCard(haystack: readonly Card[], id: string): Card | undefined {
  return haystack.find((c) => c.id === id);
}

/* ------------------------------------------------------------------ seats */

/** Seats are 0-indexed internally; players see P1..P4. */
export type Seat = 0 | 1 | 2 | 3;

export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export const SEAT_LABEL: Record<Seat, string> = { 0: 'P1', 1: 'P2', 2: 'P3', 3: 'P4' };

export type Team = 'A' | 'B';

export const TEAM_LABEL: Record<Team, string> = { A: 'Team A', B: 'Team B' };

/** P1 & P3 are Team A, P2 & P4 are Team B (partners sit across the table). */
export function teamOf(seat: Seat): Team {
  return seat % 2 === 0 ? 'A' : 'B';
}

export function otherTeam(team: Team): Team {
  return team === 'A' ? 'B' : 'A';
}

export function seatsOfTeam(team: Team): Seat[] {
  return SEATS.filter((s) => teamOf(s) === team);
}

/** Turn order around the table: P1 -> P2 -> P3 -> P4 -> P1. */
export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % 4) as Seat;
}

export function seatName(seat: Seat, names: Record<Seat, string | null>): string {
  return names[seat] ?? SEAT_LABEL[seat];
}
