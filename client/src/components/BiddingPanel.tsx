import { useState } from 'react';
import { SEAT_LABEL, type GameView } from '@hidden-trump/shared';
import { Hand } from './Hand.js';

interface Props {
  view: GameView;
  onAct: (event: string, payload?: unknown) => void;
  busy: boolean;
}

export function BiddingPanel({ view, onAct, busy }: Props) {
  const [value, setValue] = useState<number | null>(null);
  const { bidding } = view;
  const mySeat = view.you?.seat ?? null;
  const hand = view.you?.hand ?? [];
  const isMyTurn = mySeat !== null && bidding.currentSeat === mySeat;
  const minToLead = bidding.valueToLead ?? 1;

  const submit = () => {
    if (value === null) return;
    onAct('place_bid', { value });
    setValue(null);
  };

  return (
    <section className="panel">
      <h2>
        Bidding
        {bidding.highBid !== null ? <span className="pill">high bid {bidding.highBid}</span> : null}
      </h2>

      <p className="muted">
        {isMyTurn
          ? `Bid 1–13. ${minToLead} or more takes the lead.`
          : `Waiting for ${bidding.currentSeat === null ? 'the table' : SEAT_LABEL[bidding.currentSeat]}.`}
      </p>

      <Hand cards={hand} caption="These five cards are all you get to bid on. Nobody else can see them." />

      <ul className="bids">
        {bidding.bids.map((bid) => (
          <li key={`${bid.seat}-${bid.value}`} className={bid.tookLead ? 'took-lead' : ''}>
            <strong>{SEAT_LABEL[bid.seat]}</strong> {bid.value} {bid.tookLead ? '· takes the lead' : ''}
          </li>
        ))}
        {bidding.bids.length === 0 ? <li className="muted">No bids yet.</li> : null}
      </ul>

      {isMyTurn ? (
        <div className="bid-controls">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={13}
            value={value ?? ''}
            onChange={(e) => setValue(e.target.value === '' ? null : Number(e.target.value))}
            placeholder={`${minToLead}+`}
          />
          <button type="button" className="primary" onClick={submit} disabled={busy || value === null}>
            Bid
          </button>
          <div className="quick">
            {[...new Set([minToLead, Math.min(13, minToLead + 2), 13])].map((n) => (
              <button key={n} type="button" onClick={() => setValue(n)} disabled={busy || n > 13}>
                {n === 13 ? '13 (all)' : n}
              </button>
            ))}
          </div>
          <p className="muted small">Bidding 13 takes the deal outright — nobody else gets a turn.</p>
        </div>
      ) : null}
    </section>
  );
}
