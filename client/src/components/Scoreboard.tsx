import { TEAM_LABEL, teamOf, type GameView } from '@hidden-trump/shared';

export function Scoreboard({ view }: { view: GameView }) {
  const taker = view.bidding.takerSeat;
  const takerTeam = taker === null ? null : teamOf(taker);
  const bid = view.bidding.highBid ?? 0;
  const { teamA, teamB, pileSize, lastWinnerSeat, sweepFloorTrick } = view.scoring;

  const oppositionNeeds = bid === 0 ? null : Math.max(0, 14 - bid);

  return (
    <section className="scoreboard">
      <div className="teams">
        <div className={`team-col a ${takerTeam === 'A' ? 'taking' : ''}`}>
          <span className="team-label">{TEAM_LABEL.A}</span>
          <span className="team-score">{teamA}</span>
          {takerTeam === 'A' ? <span className="team-note">need {bid}</span> : null}
          {takerTeam === 'B' ? (
            <span className="team-note">need {oppositionNeeds ?? 0} to lock out</span>
          ) : null}
        </div>
        <div className={`team-col b ${takerTeam === 'B' ? 'taking' : ''}`}>
          <span className="team-label">{TEAM_LABEL.B}</span>
          <span className="team-score">{teamB}</span>
          {takerTeam === 'B' ? <span className="team-note">need {bid}</span> : null}
          {takerTeam === 'A' ? (
            <span className="team-note">need {oppositionNeeds ?? 0} to lock out</span>
          ) : null}
        </div>
      </div>

      <div className="pile">
        <span>
          Unclaimed pile <strong>{pileSize}</strong>
        </span>
        <span className="muted small">
          {lastWinnerSeat === null
            ? 'No streak yet'
            : `Streak: ${view.seats.find((s) => s.seat === lastWinnerSeat)?.name ?? '—'}`}
        </span>
        <span className="muted small">
          {sweepFloorTrick === null
            ? 'Trump revealed — sweeps possible now'
            : `No sweeps before trick ${sweepFloorTrick}`}
        </span>
      </div>
    </section>
  );
}
