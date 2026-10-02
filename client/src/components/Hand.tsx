import type { Card } from '@hidden-trump/shared';
import { CardFace } from './CardFace.js';

interface Props {
  cards: Card[];
  caption?: string;
}

/**
 * A read-only hand. Bidding and trump selection are both decided by looking at
 * the cards you hold, so these phases have to show them even though no card is
 * playable yet. Card *play* stays interactive in Table.
 */
export function Hand({ cards, caption }: Props) {
  return (
    <>
      {caption ? <p className="muted small">{caption}</p> : null}
      <div className="hand">
        {cards.map((card) => (
          <span key={card.id} className="card-button">
            <CardFace card={card} />
          </span>
        ))}
        {cards.length === 0 ? <p className="muted">No cards in hand.</p> : null}
      </div>
    </>
  );
}
