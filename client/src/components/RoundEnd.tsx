import { SEAT_LABEL, TEAM_LABEL, type GameView, type RoundEndReason } from '@hidden-trump/shared';
import { CardFace } from './CardFace.js';

interface Props {
  view: GameView;
  onAct: (event: string, payload?: unknown) => void;
  busy: boolean;
}

const REASON: Record<RoundEndReason, string> = {
  'bid-met': 'The taker’s team reached their bid.',
  'opposition-nullified': 'The opposition locked the taker out — the bid is out of reach.',
  'final-tally': 'All thirteen tricks are played.',
};

export function RoundEnd({ view, onAct, busy }: Props) {
  const result = view.result;
  if (!result) return null;

  return (
    <section className="panel result">
      <h2>{result.winnerTeam === 'A' ? TEAM_LABEL.A : TEAM_LABEL.B} wins the round</h2>
      <p className="muted">{REASON[result.reason]}</p>

      <div className="breakdown">
        <div>
          <span className="muted small">Bid</span>
          <strong>{result.bid}</strong>
        </div>
        <div>
          <span className="muted small">{TEAM_LABEL.A} secured</span>
          <strong>{result.teamA}</strong>
        </div>
        <div>
          <span className="muted small">{TEAM_LABEL.B} secured</span>
          <strong>{result.teamB}</strong>
        </div>
        <div>
          <span className="muted small">Ended on trick</span>
          <strong>{result.endedAtTrick}</strong>
        </div>
        <div>
          <span className="muted small">Taker</span>
          <strong>{SEAT_LABEL[result.takerSeat]}</strong>
        </div>
        <div>
          <span className="muted small">Unclaimed pile</span>
          <strong>{result.pile.length}</strong>
        </div>
      </div>

      {result.pile.length > 0 ? (
        <p className="muted small">
          Tricks {result.pile.join(', ')} were never swept, so they count for nobody.
        </p>
      ) : null}

      {view.trump.revealed && view.trump.card ? (
        <div className="final-trump">
          <span className="muted small">The trump was</span>
          <CardFace card={view.trump.card} small />
        </div>
      ) : null}

      <button type="button" className="primary big" onClick={() => onAct('next_round')} disabled={busy}>
        Next round (dealer rotates)
      </button>
    </section>
  );
}
