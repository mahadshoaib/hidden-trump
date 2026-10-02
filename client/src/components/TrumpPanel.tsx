import { SEAT_LABEL, type GameView } from '@hidden-trump/shared';
import { CardFace } from './CardFace.js';
import { Hand } from './Hand.js';

interface Props {
  view: GameView;
  onAct: (event: string, payload?: unknown) => void;
  busy: boolean;
}

export function TrumpPanel({ view, onAct, busy }: Props) {
  const mySeat = view.you?.seat ?? null;
  const isTaker = view.bidding.takerSeat === mySeat;
  const hand = view.you?.hand ?? [];
  const bid = view.bidding.highBid ?? 0;

  return (
    <section className="panel">
      <h2>{isTaker ? 'Choose your secret trump' : 'Setting the trump'}</h2>
      {isTaker ? (
        <>
          <p className="muted">
            You took the deal at <strong>{bid}</strong>. Pick one card to set face down as the trump. Nobody —
            not even your partner — sees it until somebody reveals it.
          </p>
          <div className="hand">
            {hand.map((card) => (
              <button
                key={card.id}
                type="button"
                className="card-button"
                onClick={() => onAct('choose_trump', { cardId: card.id })}
                disabled={busy}
              >
                <CardFace card={card} />
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            {SEAT_LABEL[view.bidding.takerSeat ?? 0]} is choosing the trump. It stays face down until somebody
            reveals it.
          </p>
          <Hand cards={hand} caption="Your five cards, for reference." />
        </>
      )}
    </section>
  );
}
