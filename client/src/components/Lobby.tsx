import { SEATS, SEAT_LABEL, teamOf, type GameView, type Seat } from '@hidden-trump/shared';

interface Props {
  view: GameView;
  onAct: (event: string, payload?: unknown) => void;
  busy: boolean;
}

export function Lobby({ view, onAct, busy }: Props) {
  const mySeat = view.you?.seat ?? null;
  const allSeated = view.seats.every((s) => s.name !== null);

  return (
    <main className="lobby">
      <h2>Seats</h2>
      <ul className="seats">
        {SEATS.map((seat) => {
          const info = view.seats.find((s) => s.seat === seat);
          const occupied = info?.name != null;
          const isMe = mySeat === seat;
          return (
            <li key={seat} className={`seat ${occupied ? 'taken' : 'open'} ${isMe ? 'me' : ''}`}>
              <div className="seat-head">
                <strong>{SEAT_LABEL[seat]}</strong>
                <span className={teamOf(seat) === 'A' ? 'team a' : 'team b'}>
                  Team {teamOf(seat) === 'A' ? 'A' : 'B'}
                </span>
              </div>
              <div className="seat-name">{occupied ? info?.name : 'Open seat'}</div>
              {occupied && !info?.connected ? <div className="muted small">disconnected</div> : null}
              {!occupied && isMe === false ? (
                <button type="button" onClick={() => onAct('claim_seat', { seat })} disabled={busy}>
                  Take {SEAT_LABEL[seat]}
                </button>
              ) : null}
              {isMe ? <div className="muted small">You</div> : null}
            </li>
          );
        })}
      </ul>

      {allSeated ? (
        <button type="button" className="primary" onClick={() => onAct('start_round')} disabled={busy}>
          Start round {view.roundNumber}
        </button>
      ) : (
        <p className="muted">Waiting for everyone to take a seat…</p>
      )}
      <p className="muted small">
        Any seated player can start once all four are in. Partners sit across from each other: P1 &amp; P3 versus
        P2 &amp; P4.
      </p>
    </main>
  );
}

export function seatName(view: GameView, seat: Seat | null): string {
  if (seat === null) return '—';
  return view.seats.find((s) => s.seat === seat)?.name ?? SEAT_LABEL[seat];
}
