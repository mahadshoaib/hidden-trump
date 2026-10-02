import { useEffect, useState } from 'react';
import {
  SEAT_LABEL,
  SUIT_SYMBOL,
  teamOf,
  type GameView,
} from '@hidden-trump/shared';
import { CardFace } from './CardFace.js';
import { slotClassName, slotsInTurnOrder } from '../tableLayout.js';
import {
  awaitingDecision,
  canSubmit,
  decisionIsForced,
  isSelectable,
  revealFlag,
  type RevealDecision,
} from '../reveal.js';

interface Props {
  view: GameView;
  onAct: (event: string, payload?: unknown) => void;
  busy: boolean;
}

export function Table({ view, onAct, busy }: Props) {
  const mySeat = view.you?.seat ?? null;
  const hand = view.you?.hand ?? [];
  const options = view.playOptions ?? null;
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * The reveal decision, made *before* a card is chosen. Previously the
   * decision was inferred from whichever card happened to be selected, so
   * selecting a trump implied "reveal" and deselecting it silently reverted to
   * "keep hidden" — the player never actually chose anything.
   */
  const [decision, setDecision] = useState<RevealDecision | null>(null);

  const isMyTurn = options?.isTurn === true;
  const mustReveal = awaitingDecision(options);

  // A new turn means a new decision. Clear both as soon as the turn moves on.
  useEffect(() => {
    setSelected(null);
    setDecision(null);
  }, [view.turn, view.trick.number, view.you?.seat]);

  // Even a forced reveal is committed before selecting the returned card.
  // The next server view includes it in `you.hand`, just like every other card.
  const forced = decisionIsForced(options);

  // Drop a selection that stops being legal — e.g. the choice was flipped.
  useEffect(() => {
    if (selected === null) return;
    if (!hand.some((card) => card.id === selected) || !isSelectable(options, decision, selected)) {
      setSelected(null);
    }
  });

  const legal = (cardId: string): boolean => isSelectable(options, decision, cardId);

  const canPlaySelected = canSubmit(options, decision, selected);

  const play = () => {
    if (selected === null || !canPlaySelected) return;
    onAct('play_card', { cardId: selected, reveal: revealFlag(options, decision) });
    setSelected(null);
    setDecision(null);
  };

  const chooseDecision = (choice: RevealDecision) => {
    if (choice === 'reveal') {
      onAct('reveal_trump');
      setDecision(null);
    } else {
      setDecision(choice);
    }
    // The two choices allow different cards, so any selection is now stale.
    setSelected(null);
  };

  return (
    <section className="panel table-area">
      <div className="trick-head">
        <h2>
          Trick {view.trick.number} of 13
          {view.trump.revealed && view.trump.suit ? (
            <span className="pill trump">Trump {SUIT_SYMBOL[view.trump.suit]}</span>
          ) : (
            <span className="pill secret">Trump hidden</span>
          )}
        </h2>
      </div>

      <div className="table-circle">
        <div className="felt" aria-hidden="true" />

        <div className="trick-centre">
          {view.trick.cards.length === 0 ? (
            <p className="muted small centre-hint">
              {view.turn === null ? 'Round over.' : `Trick ${view.trick.number} — nobody has played yet.`}
            </p>
          ) : (
            view.trick.cards.map((played, index) => (
              <div key={`${played.seat}-${index}`} className="centre-card">
                <span className="muted small">{SEAT_LABEL[played.seat]}</span>
                <CardFace
                  card={played.card}
                  hidden={played.card === null}
                  small
                  winning={view.trick.winnerSeat === played.seat}
                />
                {played.viaReveal ? <span className="muted small">revealed</span> : null}
              </div>
            ))
          )}
        </div>

        {slotsInTurnOrder(mySeat).map(({ seat, slot }) => {
          const info = view.seats.find((s) => s.seat === seat);
          const isMe = seat === mySeat;
          return (
            <div
              key={seat}
              className={[
                'seat-box',
                slotClassName(slot),
                isMe ? 'me' : '',
                view.turn === seat ? 'acting' : '',
                info?.connected === false ? 'away' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="seat-info">
                <span className={teamOf(seat) === 'A' ? 'team a' : 'team b'}>
                  {SEAT_LABEL[seat]}
                  {isMe ? ' · you' : ''}
                </span>
                <span className="muted small">{info?.name ?? '—'}</span>
                <span className="muted small">
                  {info?.trumpSetAside ? 'trump set aside · ' : ''}
                  {info?.cardCount ?? 0} cards
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {view.trump.revealed ? (
        <p className="reveal-note">
          The trump was turned face up on trick {view.trump.revealedAtTrick} and stays live for the rest of the
          round.
        </p>
      ) : null}

      {view.lastTrick ? (
        <p className="muted small last-trick">
          Trick {view.lastTrick.number} went to{' '}
          <strong>{view.seats.find((s) => s.seat === view.lastTrick?.winnerSeat)?.name ?? SEAT_LABEL[view.lastTrick.winnerSeat]}</strong>
          {view.lastTrick.swept !== null ? ` — SWEEP, ${view.lastTrick.swept} tricks secured` : ''}
          {view.lastTrick.blockedBy === 'ace' ? ' (Ace: no sweep)' : ''}
          {view.lastTrick.blockedBy === 'below-floor' ? ' (too early to sweep)' : ''}
        </p>
      ) : null}

      <div className="hand">
        {hand.map((card) => {
          const playable = legal(card.id);
          return (
            <button
              key={card.id}
              data-card-id={card.id}
              type="button"
              className={`card-button ${selected === card.id ? 'selected' : ''}`}
              onClick={() => setSelected(selected === card.id ? null : card.id)}
              // Cards stay locked until the reveal decision is made, so the
              // choice can never be implied by the card that gets clicked.
              disabled={busy || !isMyTurn || !playable}
              aria-pressed={selected === card.id}
            >
              <CardFace
                card={card}
                disabled={isMyTurn && !playable}
                winning={false}
              />
            </button>
          );
        })}
        {hand.length === 0 ? <p className="muted">No cards in hand.</p> : null}
      </div>

      {isMyTurn ? (
        <div className="play-controls">
          {mustReveal ? (
            <>
              <p className="note">{options?.note}</p>
              {decision === null ? (
                <div className="reveal-choice">
                  <p className="muted small">Choose first — this cannot be undone.</p>
                  <button
                    type="button"
                    className="primary big"
                    onClick={() => chooseDecision('reveal')}
                    disabled={busy || options?.canReveal === false}
                  >
                    Reveal the trump
                  </button>
                  <button
                    type="button"
                    className="big"
                    onClick={() => chooseDecision('hide')}
                    disabled={busy || forced !== null || options?.canHide === false}
                  >
                    Play, keep it hidden
                  </button>
                </div>
              ) : (
                <>
                  <p className="note">
                    {decision === 'reveal'
                      ? 'Revealing — you must now play a trump card.'
                      : 'Keeping it hidden — play any card.'}
                  </p>
                  <button type="button" className="primary big" onClick={play} disabled={busy || !canPlaySelected}>
                    Play card
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => chooseDecision(decision === 'reveal' ? 'hide' : 'reveal')}
                    disabled={busy}
                  >
                    Reveal instead
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {options?.note ? <p className="note">{options.note}</p> : null}
              <button type="button" className="primary big" onClick={play} disabled={busy || !canPlaySelected}>
                Play card
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="muted waiting play-controls">
          {view.turn === null
            ? 'Round over.'
            : `Waiting for ${view.seats.find((s) => s.seat === view.turn)?.name ?? SEAT_LABEL[view.turn]}…`}
        </p>
      )}
    </section>
  );
}
