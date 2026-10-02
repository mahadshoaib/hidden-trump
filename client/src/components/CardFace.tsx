import { SUIT_SYMBOL, type Card } from '@hidden-trump/shared';

interface Props {
  card?: Card | null;
  /** Show the back of the card instead of its face. */
  hidden?: boolean;
  /** Dim the card and mark it unplayable. */
  disabled?: boolean;
  /** Highlight a card that wins the trick. */
  winning?: boolean;
  small?: boolean;
}

export function CardFace({ card, hidden, disabled, winning, small }: Props) {
  if (hidden || !card) {
    return <div className={`card back ${small ? 'small' : ''}`} aria-label="Face-down card" />;
  }
  return (
    <div
      className={`card face suit-${card.suit} ${disabled ? 'disabled' : ''} ${winning ? 'winning' : ''} ${
        small ? 'small' : ''
      }`}
      aria-label={`${SUIT_SYMBOL[card.suit]} ${card.rank}`}
    >
      <span className="rank">{card.rank}</span>
      <span className="suit">{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}
