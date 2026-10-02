import { useEffect, useRef } from 'react';
import type { GameView } from '@hidden-trump/shared';

export function Log({ view }: { view: GameView }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const entries = view.log.slice(-40);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [view.log.length]);

  return (
    <details className="log">
      <summary>Table log</summary>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.trick !== null ? <span className="muted small">T{entry.trick} </span> : null}
            {entry.text}
          </li>
        ))}
        {entries.length === 0 ? <li className="muted">Nothing yet.</li> : null}
      </ul>
      <div ref={endRef} />
    </details>
  );
}
