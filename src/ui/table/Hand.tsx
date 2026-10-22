/** Your hand as open bowls (you know what's in your own), in a flat row. */
import type { ColorId, PuriKind } from '../../engine/types.ts';
import { BowlIcon } from '../common/BowlIcon.tsx';
import { cx } from '../common/hooks.ts';

export interface HandCard {
  kind: PuriKind;
  /** Which Panipuri numeral to print (1–5). */
  instance: number;
}

export function handCards(hand: { panipuri: number; akabare: number }): HandCard[] {
  return [
    ...Array.from({ length: hand.panipuri }, (_, i) => ({ kind: 'panipuri' as const, instance: i + 1 })),
    ...Array.from({ length: hand.akabare }, () => ({ kind: 'akabare' as const, instance: 1 })),
  ];
}

export function Hand({
  cards,
  color,
  width,
  selected,
  onPick,
  pickable,
  label = 'Your hand',
  emptyText = 'Your hand is empty.',
  className,
}: {
  cards: HandCard[];
  color: ColorId;
  width: number;
  /** Selected index, or null. */
  selected: number | null;
  onPick?: (index: number, card: HandCard) => void;
  /** Kinds that may be picked (others are dimmed). null = none pickable. */
  pickable: readonly PuriKind[] | null;
  label?: string;
  emptyText?: string;
  className?: string;
}) {
  const n = cards.length;
  return (
    <div className={cx('tp-hand-row', className)} role="group" aria-label={`${label}: ${n} bowl${n === 1 ? '' : 's'}`}>
      {n === 0 ? <p className="tp-hand-row__empty">{emptyText}</p> : null}
      {cards.map((c, i) => {
        const can = !!pickable && pickable.includes(c.kind) && !!onPick;
        const state = selected === i ? 'selected' : can ? 'selectable' : pickable ? 'dim' : 'idle';
        return (
          <div key={`${c.kind}-${c.instance}-${i}`} className="tp-hand-row__card">
            <button
              type="button"
              className={cx('tp-handbowl', `is-${state}`)}
              disabled={!can}
              onClick={can ? () => onPick!(i, c) : undefined}
              aria-pressed={selected === i ? true : undefined}
              aria-label={`${c.kind === 'akabare' ? 'Akabare' : 'Panipuri'} in your hand${selected === i ? ', selected' : ''}`}
            >
              <BowlIcon kind={c.kind} color={color} size={Math.round(width * 1.15)} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
