/**
 * The Hidden Trump game engine.
 *
 * Deliberately free of Socket.IO, Express and React: it manipulates a
 * GameState and throws GameError on illegal actions. The server is the only
 * thing that talks to it, and the server is the only thing that decides what a
 * player is allowed to see (see `view.ts`).
 *
 * State is mutated in place — there is exactly one authoritative copy per room
 * and it is single-threaded inside the Node event loop. The rule-critical parts
 * (bidding, trick winner, scoring) live in their own pure modules.
 */

import {
  describeCard,
  formatCard,
  nextSeat,
  SEATS,
  SEAT_LABEL,
  SUIT_NAME,
  SUIT_SYMBOL,
  teamOf,
  type Card,
  type Seat,
  type Suit,
} from '@hidden-trump/shared';
import { applyBid, createBiddingState, isValidBidValue, validateBid, valueToLead } from './bidding.js';
import { makeDeck, randomRng, shuffle } from './deck.js';
import { countSuit, dealRemainder, MAX_TAKER_TRUMPS } from './fairness.js';
import { applyTrickWin, checkRoundEnd, createScoringState, oppositionLockoutThreshold, TOTAL_TRICKS } from './scoring.js';
import { determineTrickWinner } from './trick.js';
import type { GameState, PlayOptionsView, Rng, TrickPlay, TrickState } from './types.js';

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameError';
  }
}

/* ------------------------------------------------------------------ setup */

function emptySlot(seat: Seat) {
  return { seat, name: null, token: null, connected: false };
}

export function createGameState(roomCode: string, dealer: Seat = 0): GameState {
  return {
    roomCode,
    phase: 'lobby',
    roundNumber: 1,
    dealer,
    seats: {
      0: emptySlot(0),
      1: emptySlot(1),
      2: emptySlot(2),
      3: emptySlot(3),
    },
    bidding: createBiddingState(nextSeat(dealer)),
    trump: { hiddenCard: null, suit: null, revealed: false, revealedAtTrick: null },
    hands: { 0: [], 1: [], 2: [], 3: [] },
    deck: [],
    trick: emptyTrick(1, 4),
    previousLedSuit: null,
    turn: null,
    scoring: createScoringState(),
    lastTrick: null,
    result: null,
    history: [],
    log: [],
    logSeq: 0,
    updatedAt: Date.now(),
  };
}

function emptyTrick(number: number, expectedCards: number): TrickState {
  return { number, plays: [], revealIndex: null, expectedCards, complete: false, winnerSeat: null };
}

/**
 * The seat `offset` places round the table from `from`. Turn order is
 * P1 -> P2 -> P3 -> P4 -> P1.
 *
 * Note: `nextSeat(x + y)` is NOT the same thing and advances twice. Use this
 * helper wherever an offset into the rotation is meant.
 */
function seatAfter(from: Seat, offset: number): Seat {
  return ((from + offset) % 4) as Seat;
}

/* -------------------------------------------------------------- log / text */

function log(state: GameState, text: string, trick: number | null = state.phase === 'playing' ? state.trick.number : null): void {
  const id = state.logSeq++;
  state.log.push({ id, text, trick });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

function nameOf(state: GameState, seat: Seat): string {
  return state.seats[seat].name ?? SEAT_LABEL[seat];
}

/* ----------------------------------------------------------------- seats */

export interface ClaimSeatResult {
  seat: Seat;
  reconnected: boolean;
}

export function seatForToken(state: GameState, token: string): Seat | null {
  for (const seat of SEATS) {
    if (state.seats[seat].token === token) return seat;
  }
  return null;
}

export function claimSeat(state: GameState, input: { name: string; token: string; preferredSeat?: Seat }): ClaimSeatResult {
  const name = input.name.trim().slice(0, 20);
  if (name.length === 0) throw new GameError('Please enter a display name.');
  const token = input.token.trim();
  if (token.length === 0) throw new GameError('Missing player token.');

  const existing = seatForToken(state, token);
  if (existing !== null) {
    if (input.preferredSeat !== undefined && input.preferredSeat !== existing) {
      if (state.phase !== 'lobby' && state.phase !== 'roundEnd') {
        throw new GameError('Seats cannot change during a round.');
      }
      const target = input.preferredSeat;
      if (!SEATS.includes(target) || state.seats[target].name !== null) {
        throw new GameError('That seat is already taken or invalid.');
      }
      state.seats[target] = { seat: target, name, token, connected: true };
      state.seats[existing] = emptySlot(existing);
      log(state, `${name} moved to ${SEAT_LABEL[target]}.`);
      return { seat: target, reconnected: false };
    }
    const slot = state.seats[existing];
    if (slot.name && slot.name !== name) slot.name = name;
    slot.connected = true;
    delete slot.disconnectedAt;
    log(state, `${nameOf(state, existing)} reconnected.`);
    return { seat: existing, reconnected: true };
  }

  // Fallback for players who lost their localStorage token: match a
  // disconnected seat by name.
  const byName = SEATS.find((seat) => state.seats[seat].name === name && !state.seats[seat].connected);
  if (byName !== undefined) {
    const slot = state.seats[byName];
    slot.token = token;
    slot.connected = true;
    delete slot.disconnectedAt;
    log(state, `${name} reconnected.`);
    return { seat: byName, reconnected: true };
  }

  if (input.preferredSeat !== undefined) {
    const preferred = state.seats[input.preferredSeat];
    if (preferred.name === null) {
      preferred.name = name;
      preferred.token = token;
      preferred.connected = true;
      log(state, `${name} took seat ${SEAT_LABEL[input.preferredSeat]} (${teamOf(input.preferredSeat) === 'A' ? 'Team A' : 'Team B'}).`);
      return { seat: input.preferredSeat, reconnected: false };
    }
  }

  const open = SEATS.find((seat) => state.seats[seat].name === null);
  if (open === undefined) throw new GameError('All four seats are taken.');
  const slot = state.seats[open];
  slot.name = name;
  slot.token = token;
  slot.connected = true;
  log(state, `${name} took seat ${SEAT_LABEL[open]} (${teamOf(open) === 'A' ? 'Team A' : 'Team B'}).`);
  return { seat: open, reconnected: false };
}

export function setConnected(state: GameState, token: string, connected: boolean, now = Date.now()): void {
  const seat = seatForToken(state, token);
  if (seat === null) return;
  const slot = state.seats[seat];
  if (slot.connected === connected) return;
  slot.connected = connected;
  if (connected) delete slot.disconnectedAt;
  else slot.disconnectedAt = now;
  if (!connected) {
    log(state, `${nameOf(state, seat)} disconnected — seat held open.`);
  }
}

/** Release identity, preserving an unfinished seat's cards for a replacement. */
export function releaseSeat(state: GameState, token: string): void {
  const seat = seatForToken(state, token);
  if (seat === null) return;
  const name = nameOf(state, seat);
  state.seats[seat] = emptySlot(seat);
  log(state, `${name} left ${SEAT_LABEL[seat]}; the seat is open.`);
}

/* ----------------------------------------------------------------- rounds */

export function startRound(state: GameState, rng: Rng): void {
  if (state.phase !== 'lobby' && state.phase !== 'roundEnd') {
    throw new GameError('A round is already in progress.');
  }
  if (SEATS.some((seat) => state.seats[seat].name === null)) {
    throw new GameError('All four seats must be filled before a round can start.');
  }

  state.phase = 'bidding';
  state.trump = { hiddenCard: null, suit: null, revealed: false, revealedAtTrick: null };
  state.hands = { 0: [], 1: [], 2: [], 3: [] };  state.deck = shuffle(makeDeck(), rng);
  state.trick = emptyTrick(1, 4);
  state.previousLedSuit = null;
  state.turn = null;
  state.scoring = createScoringState();
  state.lastTrick = null;
  state.result = null;
  state.log = [];
  state.bidding = createBiddingState(nextSeat(state.dealer));

  // Five cards each, dealt one at a time starting from the seat left of the dealer.
  for (let round = 0; round < 5; round++) {
    for (let offset = 1; offset <= 4; offset++) {
      const seat = seatAfter(state.dealer, offset);
      const card = state.deck.pop();
      if (card) state.hands[seat].push(card);
    }
  }

  log(state, `Round ${state.roundNumber} — five cards each. Bidding starts with ${nameOf(state, state.bidding.turn as Seat)}.`);
}

export function nextRound(state: GameState, rng: Rng): void {
  if (state.phase !== 'roundEnd') throw new GameError('The round has not finished yet.');
  state.roundNumber += 1;
  state.dealer = nextSeat(state.dealer);
  startRound(state, rng);
}

/* ---------------------------------------------------------------- bidding */

export function placeBid(state: GameState, seat: Seat, value: unknown): void {
  if (state.phase !== 'bidding') throw new GameError('It is not the bidding phase.');
  const check = validateBid(state.bidding, seat, value);
  if (!check.ok) throw new GameError(check.error);

  const bid = value as number;
  const outcome = applyBid(state.bidding, seat, bid);
  const leadText = outcome.tookLead ? ' — new highest bid' : '';
  log(state, `${nameOf(state, seat)} bids ${bid}${leadText}.`);

  if (outcome.takerSeat === null) return;

  state.phase = 'trumpSelection';
  const taker = outcome.takerSeat;
  const contract = state.bidding.highBid as number;
  if (outcome.shortCircuited) {
    log(state, `Bid of 13 short-circuits the auction — ${nameOf(state, taker)} takes the contract.`);
  } else {
    log(state, `${nameOf(state, taker)} takes the contract on ${contract}.`);
  }
  log(
    state,
    `${teamOf(taker) === 'A' ? 'Team A' : 'Team B'} (${nameOf(state, taker)}) is the taker; ${
      teamOf(taker) === 'A' ? 'Team B' : 'Team A'
    } is the opposition. They need ${oppositionLockoutThreshold(contract)} trick${
      oppositionLockoutThreshold(contract) === 1 ? '' : 's'
    } to lock the taker out.`,
  );
  log(state, `${nameOf(state, taker)} must now choose a trump card, face down.`);
}

/* ------------------------------------------------------------------ trump */

export function chooseTrump(state: GameState, seat: Seat, cardId: string, rng: Rng = randomRng()): void {
  if (state.phase !== 'trumpSelection') throw new GameError('It is not time to set the trump.');
  if (state.bidding.takerSeat !== seat) throw new GameError('Only the taker may set the trump.');

  const hand = state.hands[seat];
  const index = hand.findIndex((c) => c.id === cardId);
  if (index < 0) throw new GameError('That card is not in your hand.');

  const [trumpCard] = hand.splice(index, 1);
  if (!trumpCard) throw new GameError('That card is not in your hand.');
  state.trump.hiddenCard = trumpCard;
  state.trump.suit = trumpCard.suit;
  state.trump.revealed = false;
  state.trump.revealedAtTrick = null;

  // Deal the rest of the deck, starting from the taker's seat and going round
  // the table: taker, +1, +2, +3, repeat. The trump card came out of the
  // taker's own 5-card hand, so the 32 undealt cards remain untouched and
  // divide out as exactly 8 each: taker 4 + 8 = 12 active, others 5 + 8 = 13.
  //
  // Deal normally, then swap only excess active trumps above the cap.
  const order = SEATS.map((_, index) => seatAfter(seat, index));
  state.hands = dealRemainder(state.deck, order, seat, state.trump.suit as Suit, state.hands, rng);
  state.deck = [];

  assertDealIntegrity(state, seat);

  state.phase = 'playing';
  state.trick = emptyTrick(1, 4);
  state.previousLedSuit = null;
  state.turn = seat;

  log(state, `${nameOf(state, seat)} turns a card face down as the secret trump. Nobody knows the suit yet.`);
  log(state, `${nameOf(state, seat)} leads the first trick.`);
}

/* ----------------------------------------------------------------- play */

/**
 * Hard invariant check, run after every deal-out. The whole round depends on
 * this arithmetic: 12 + 13 + 13 + 13 active cards plus the one hidden trump
 * card is exactly 52, which is what allows 13 full four-card tricks.
 *
 * Kept as an explicit assertion rather than implicit behaviour so that any
 * future change to the dealing order fails loudly.
 */
export function assertDealIntegrity(state: GameState, taker: Seat): void {
  const problems: string[] = [];
  if (state.deck.length !== 0) problems.push(`${state.deck.length} cards left undealt (expected 0)`);

  for (const seat of SEATS) {
    const expected = seat === taker ? 12 : 13;
    if (state.hands[seat].length !== expected) {
      problems.push(`${SEAT_LABEL[seat]} has ${state.hands[seat].length} active cards (expected ${expected})`);
    }
  }

  const active = SEATS.flatMap((seat) => state.hands[seat]);
  const total = active.length + (state.trump.hiddenCard ? 1 : 0);
  if (total !== 52) problems.push(`52-card balance broken: ${active.length} active + ${(state.trump.hiddenCard ? 1 : 0)} hidden = ${total}`);

  const ids = [...active, ...(state.trump.hiddenCard ? [state.trump.hiddenCard] : [])].map((c) => c.id);
  if (new Set(ids).size !== ids.length) problems.push('the same card appears in more than one place');

  assertFairDeal(state, taker, problems);

  if (problems.length > 0) {
    throw new GameError(`Deal integrity check failed: ${problems.join('; ')}.`);
  }
}

/**
 * The fairness rules, checked on every deal so a regression in the allocation
 * fails loudly instead of quietly producing an unplayable round.
 *
 * Only the twelve active cards count. The set-aside trump is excluded.
 */
export function assertFairDeal(state: GameState, taker: Seat, problems: string[] = []): string[] {
  const trumpSuit = state.trump.suit as Suit;
  const trumpCount = countSuit(state.hands[taker], trumpSuit);
  if (trumpCount > MAX_TAKER_TRUMPS) {
    problems.push(
      `${SEAT_LABEL[taker]} holds ${trumpCount} active ${SUIT_NAME[trumpSuit]} (max ${MAX_TAKER_TRUMPS})`,
    );
  }

  if (problems.length > 0) throw new GameError(`Deal integrity check failed: ${problems.join('; ')}.`);
  return problems;
}

export function isTaker(state: GameState, seat: Seat): boolean {
  return state.bidding.takerSeat === seat;
}

function cardsOfSuit(hand: readonly Card[], suit: Suit): Card[] {
  return hand.filter((c) => c.suit === suit);
}

/**
 * Whether this seat still has a card to put on the table. The taker counts even
 * with an empty active hand, because their face-down trump card is theirs to
 * play — that is what completes trick 13 (and lets them lead it).
 */
function canPlay(state: GameState, seat: Seat): boolean {
  if (state.hands[seat].length > 0) return true;
  return isTaker(state, seat) && state.trump.hiddenCard !== null && !state.trump.revealed;
}

function seatsThatPlay(state: GameState): Seat[] {
  return SEATS.filter((seat) => canPlay(state, seat));
}

/**
 * Everything a player is allowed to do right now. The server validates against
 * exactly this, so a hostile client gains nothing by not calling it first.
 */
export function playOptions(state: GameState, seat: Seat): PlayOptionsView {
  const isTurn = state.phase === 'playing' && state.turn === seat;
  const hand = state.hands[seat];
  const sitsOut = hand.length === 0 && !canPlay(state, seat);
  const base = {
    isTurn,
    leading: false,
    mustDecideReveal: false,
    canReveal: false,
    canHide: false,
    revealCardIds: [] as string[],
    hideCardIds: [] as string[],
    allowedCardIds: [] as string[],
    handEmpty: sitsOut,
    note: '',
  };

  if (state.phase !== 'playing') {
    return { ...base, note: 'Cards cannot be played right now.' };
  }
  if (!isTurn) {
    return { ...base, note: `Waiting for ${nameOf(state, state.turn as Seat)}.` };
  }
  if (sitsOut) {
    return { ...base, note: 'You have no cards left. You sit out the rest of this trick.' };
  }

  // Out of active cards but still holding the secret trump: playing it is the
  // only move, and playing it means revealing it.
  if (hand.length === 0) {
    const trumpCard = state.trump.hiddenCard as Card;
    return {
      ...base,
      mustDecideReveal: true,
      canReveal: true,
      canHide: false,
      revealCardIds: [trumpCard.id],
      hideCardIds: [],
      allowedCardIds: [trumpCard.id],
      note: 'You have no cards left — you must turn your secret trump face up and play it.',
    };
  }

  const leading = state.trick.plays.length === 0;
  if (state.trump.pendingSeat === seat) {
    const trumps = cardsOfSuit(hand, state.trump.suit as Suit);
    return {
      ...base,
      leading,
      allowedCardIds: (trumps.length ? trumps : hand).map((c) => c.id),
      note: trumps.length ? 'Trump revealed — you must play a trump.' : 'Trump revealed — you have none, so play any card.',
    };
  }
  if (leading) {
    let allowed = hand;
    let note = 'Lead any card.';
    if (!state.trump.revealed && state.previousLedSuit !== null) {
      const filtered = hand.filter((c) => c.suit !== state.previousLedSuit);
      if (filtered.length > 0) {
        allowed = filtered;
        note = `You may not lead ${SUIT_SYMBOL[state.previousLedSuit]} again while the trump is hidden.`;
      } else {
        note = `You have nothing but ${SUIT_SYMBOL[state.previousLedSuit]}, so you may lead it again.`;
      }
    }
    return { ...base, leading: true, allowedCardIds: allowed.map((c) => c.id), note };
  }

  const ledSuit = (state.trick.plays[0] as TrickPlay).card.suit;
  const inSuit = cardsOfSuit(hand, ledSuit);
  if (inSuit.length > 0) {
    return {
      ...base,
      allowedCardIds: inSuit.map((c) => c.id),
      note: `You must follow ${SUIT_NAME[ledSuit]}.`,
    };
  }

  // Void in the led suit.
  if (state.trump.revealed) {
    return {
      ...base,
      allowedCardIds: hand.map((c) => c.id),
      note: `Trump is already revealed (${SUIT_SYMBOL[state.trump.suit as Suit]}) — you are void, play anything.`,
    };
  }

  // Void, and the trump is still a secret: the player must decide.
  const trumpSuit = state.trump.suit as Suit;
  const trumpsInHand = cardsOfSuit(hand, trumpSuit);
  const returnedTrump = isTaker(state, seat) && state.trump.hiddenCard ? [state.trump.hiddenCard] : [];
  const revealPool = [...trumpsInHand, ...returnedTrump];
  const revealCardIds = revealPool.length > 0 ? revealPool.map((c) => c.id) : hand.map((c) => c.id);
  const note = returnedTrump.length > 0
    ? 'You are void. Reveal the trump to pull your hidden card back into your hand — then you must play a trump.'
    : revealPool.length > 0
      ? 'You are void. Reveal the trump (then you must play a trump) or keep it hidden and discard anything.'
      : 'You are void. You can still reveal the trump, but you hold none, so any card is allowed.';

  return {
    ...base,
    mustDecideReveal: true,
    canReveal: true,
    canHide: hand.length > 0,
    revealCardIds,
    hideCardIds: hand.map((c) => c.id),
    allowedCardIds: Array.from(new Set([...revealCardIds, ...hand.map((c) => c.id)])),
    note,
  };
}

function illegalPlayMessage(state: GameState, seat: Seat, card: Card): string {
  if (state.phase !== 'playing') return 'Cards cannot be played right now.';
  if (state.turn !== seat) return `It is not your turn — ${nameOf(state, state.turn as Seat)} is playing.`;
  if (state.trick.plays.length === 0) {
    if (!state.trump.revealed && state.previousLedSuit !== null && card.suit === state.previousLedSuit) {
      return `You may not lead ${SUIT_NAME[card.suit]} again while the trump is hidden.`;
    }
    return 'That card is not in your hand.';
  }
  const ledSuit = (state.trick.plays[0] as TrickPlay).card.suit;
  if (!state.trump.revealed && cardsOfSuit(state.hands[seat], ledSuit).length > 0) {
    return `You must follow ${SUIT_NAME[ledSuit]} — you still hold one.`;
  }
  return 'That card cannot be played right now.';
}

/**
 * The card a player named, including the taker's face-down trump card when they
 * reveal (it does not rejoin the hand until that moment).
 */
function resolveCandidate(state: GameState, seat: Seat, cardId: string, options: PlayOptionsView): Card {
  const inHand = state.hands[seat].find((c) => c.id === cardId);
  if (inHand) return inHand;
  if (isTaker(state, seat) && state.trump.hiddenCard && !state.trump.revealed && options.revealCardIds.includes(cardId)) {
    return state.trump.hiddenCard;
  }
  if (isTaker(state, seat) && state.trump.hiddenCard && state.trump.hiddenCard.id === cardId) {
    return state.trump.hiddenCard;
  }
  throw new GameError('That card is not in your hand.');
}

/** Commit the reveal before revealing any suit-dependent options to a client. */
export function revealTrump(state: GameState, seat: Seat): void {
  const options = playOptions(state, seat);
  if (state.trump.revealed || !options.isTurn || !options.canReveal) {
    throw new GameError('You cannot reveal the trump right now.');
  }
  applyReveal(state, seat);
  state.trump.pendingSeat = seat;
}

export function playCard(state: GameState, seat: Seat, cardId: string, reveal: boolean): void {
  if (state.phase !== 'playing') throw new GameError('Cards cannot be played right now.');
  if (state.turn !== seat) throw new GameError(`It is not your turn — ${nameOf(state, state.turn as Seat)} is playing.`);

  const options = playOptions(state, seat);
  if (options.handEmpty) throw new GameError('You have no cards left to play.');

  if (options.mustDecideReveal) {
    if (typeof reveal !== 'boolean') {
      throw new GameError('You are void — you must choose to reveal the trump or keep it hidden.');
    }
    if (reveal) {
      if (!options.canReveal) throw new GameError('You cannot reveal the trump right now.');
      if (!options.revealCardIds.includes(cardId)) {
        throw new GameError(
          isTaker(state, seat)
            ? 'Having revealed, you must play a trump card — either your hidden trump card or another trump from your hand.'
            : 'Having revealed, you must play a card of the trump suit.',
        );
      }
    } else if (!options.hideCardIds.includes(cardId)) {
      throw new GameError(
        options.canHide ? 'That card is not in your hand.' : 'You have no cards left — you must turn your secret trump face up and play it.',
      );
    }
  } else {
    if (reveal) throw new GameError('You can only reveal the trump when void in the suit led.');
    if (!options.allowedCardIds.includes(cardId)) {
      const candidate = state.hands[seat].find((c) => c.id === cardId);
      throw new GameError(candidate ? illegalPlayMessage(state, seat, candidate) : 'That card is not in your hand.');
    }
  }

  const card = resolveCandidate(state, seat, cardId, options);
  const voidPlay = options.mustDecideReveal;
  const takerKeptHidden = voidPlay && !reveal && isTaker(state, seat);

  if (voidPlay && reveal) {
    applyReveal(state, seat);
  }

  const index = state.hands[seat].findIndex((c) => c.id === card.id);
  if (index >= 0) state.hands[seat].splice(index, 1);

  const leading = state.trick.plays.length === 0;
  const committedReveal = state.trump.pendingSeat === seat;
  const play: TrickPlay = { seat, card, viaReveal: (voidPlay && reveal) || committedReveal, faceDown: takerKeptHidden };
  state.trump.pendingSeat = null;
  state.trick.plays.push(play);

  if (leading) {
    state.previousLedSuit = card.suit;
    log(state, `${nameOf(state, seat)} leads ${SUIT_NAME[card.suit]}.`, state.trick.number);
  } else if (takerKeptHidden) {
    log(state, `${nameOf(state, seat)} keeps the trump hidden and discards face down.`, state.trick.number);
  } else if (voidPlay && !reveal) {
    log(state, `${nameOf(state, seat)} is void and keeps the trump hidden, discarding ${formatCard(card)} face up.`, state.trick.number);
  } else {
    log(state, `${nameOf(state, seat)} plays ${formatCard(card)}.`, state.trick.number);
  }

  if (state.trick.plays.length >= state.trick.expectedCards) {
    resolveTrick(state);
    return;
  }
  state.turn = nextActiveSeat(state, seat);
}

function applyReveal(state: GameState, seat: Seat): void {
  const trump = state.trump;
  const wasHidden = !trump.revealed;
  trump.revealed = true;
  trump.revealedAtTrick = state.trick.number;
  state.trick.revealIndex = state.trick.plays.length;

  const taker = state.bidding.takerSeat;
  // Whoever flipped it, the secret trump goes to the taker's hand. When the
  // taker is the revealer that is the original rule; when somebody else reveals,
  // the card is still theirs to play, and taking it back is what keeps the round
  // at 12/13/13/13 dealt cards — otherwise the taker would be a card short for
  // the rest of the round and one trick would resolve with only three cards.
  const returnsToTaker = wasHidden && taker !== null && trump.hiddenCard !== null;
  if (returnsToTaker) {
    state.hands[taker].push(trump.hiddenCard as Card);
  }

  log(
    state,
    `${nameOf(state, seat)} reveals the trump: ${describeCard(trump.hiddenCard as Card)} (${SUIT_NAME[trump.suit as Suit]}).`,
    state.trick.number,
  );
  if (returnsToTaker && taker !== seat) {
    log(state, `The ${describeCard(trump.hiddenCard as Card)} returns to ${nameOf(state, taker)}'s hand.`, state.trick.number);
  }
}

/** The next seat in turn order that still has a card to play. */
function nextActiveSeat(state: GameState, from: Seat): Seat {
  for (let offset = 1; offset <= 4; offset++) {
    const candidate = seatAfter(from, offset);
    if (canPlay(state, candidate)) return candidate;
  }
  return from;
}

function resolveTrick(state: GameState): void {
  const trick = state.trick;
  const winner = determineTrickWinner({
    plays: trick.plays,
    revealIndex: trick.revealIndex,
    trumpSuit: state.trump.suit,
    trumpRevealed: state.trump.revealed,
  });
  if (!winner) throw new GameError('A trick with no led-suit card cannot be resolved.');
  trick.complete = true;
  trick.winnerSeat = winner.seat;

  const outcome = applyTrickWin(state.scoring, {
    trickNumber: trick.number,
    winnerSeat: winner.seat,
    winningCard: winner.card,
    trumpRevealed: state.trump.revealed,
  });
  state.scoring = outcome.state;
  state.lastTrick = {
    number: trick.number,
    plays: [...trick.plays],
    revealIndex: trick.revealIndex,
    winnerSeat: winner.seat,
    winningCardId: winner.card.id,
    swept: outcome.swept,
    blockedBy: outcome.blockedBy,
  };

  log(
    state,
    `Trick ${trick.number} won by ${nameOf(state, winner.seat)} with ${formatCard(winner.card)}.`,
    trick.number,
  );
  if (outcome.swept !== null) {
    log(
      state,
      `SWEEP! ${nameOf(state, winner.seat)} took the whole pile — ${
        teamOf(winner.seat) === 'A' ? 'Team A' : 'Team B'
      } secures ${outcome.swept} trick${outcome.swept === 1 ? '' : 's'}.`,
      trick.number,
    );
  } else if (outcome.blockedBy === 'ace') {
    log(state, `No sweep: the winning card is an Ace. The pile keeps growing.`, trick.number);
  }

  const takerSeat = state.bidding.takerSeat as Seat;
  const result = checkRoundEnd({
    scoring: state.scoring,
    bid: state.bidding.highBid as number,
    takerSeat,
    trickNumber: trick.number,
  });

  if (result) {
    finishRound(state, result);
    return;
  }

  if (trick.number >= TOTAL_TRICKS) {
    throw new GameError(`Round failed to resolve after trick ${trick.number}.`);
  }

  startNextTrick(state, winner.seat);
}

function startNextTrick(state: GameState, leader: Seat): void {
  const number = state.trick.number + 1;
  // Every seat holds exactly one card for each of the 13 tricks, so this is 4
  // every time. The taker's face-down trump counts as their card for trick 13.
  const expected = seatsThatPlay(state).length;
  state.trick = emptyTrick(number, expected);
  state.turn = leader;
  if (expected < 4) {
    // Safety net: the deal invariant makes this unreachable, but a silent
    // soft-lock here would be much worse than a log line.
    const idle = SEATS.filter((s) => !canPlay(state, s));
    log(state, `${idle.map((s) => nameOf(state, s)).join(' and ')} ${idle.length > 1 ? 'have' : 'has'} no cards left.`, number);
  }
  log(state, `Trick ${number} — ${nameOf(state, leader)} to lead.`, number);
}

function finishRound(state: GameState, result: NonNullable<GameState['result']>): void {
  state.result = result;
  state.phase = 'roundEnd';
  state.turn = null;
  const takerSeat = state.bidding.takerSeat as Seat;
  const bid = state.bidding.highBid as number;
  state.history.push({
    round: state.roundNumber,
    winnerTeam: result.winnerTeam,
    bid,
    takerSeat,
    endedAtTrick: result.endedAtTrick,
    teamA: state.scoring.secured.A,
    teamB: state.scoring.secured.B,
    pileSize: state.scoring.pile.length,
  });

  const winner = result.winnerTeam === 'A' ? 'Team A' : 'Team B';
  if (result.reason === 'bid-met') {
    log(state, `${winner} wins the round — bid of ${bid} made after trick ${result.endedAtTrick}.`);
  } else if (result.reason === 'opposition-nullified') {
    log(state, `${winner} wins the round — the taker's team can no longer reach ${bid}.`);
  } else {
    log(state, `${winner} wins the round on the final tally. ${nameOf(state, takerSeat)}'s team fell short of ${bid}.`);
  }
  if (state.scoring.pile.length > 0) {
    log(state, `Tricks ${state.scoring.pile.join(', ')} were never claimed and count for nobody.`);
  }
}

/* -------------------------------------------------------------- accessors */

/** Cards in a seat's active hand. */
export function handSize(state: GameState, seat: Seat): number {
  return state.hands[seat].length;
}

/** Whether a seat has any card left to put on the table (taker's trump counts). */
export function seatCanPlay(state: GameState, seat: Seat): boolean {
  return canPlay(state, seat);
}

export function takerSeat(state: GameState): Seat | null {
  return state.bidding.takerSeat;
}

export { isValidBidValue, valueToLead };
