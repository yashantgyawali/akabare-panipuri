/**
 * Your bowls at the 3D table: a tray in the bottom-left corner of the screen
 * (not on the table), open so you can see what's in each. Tap one to pick it:
 * into your stack while setting up (it shows the slot number it went into), or
 * to put on a stack on your turn.
 */
import type { ColorId, PuriKind } from '../../engine/types.ts';
import { BowlIcon } from '../common/BowlIcon.tsx';
import { cx } from '../common/hooks.ts';
import type { HandCard } from './Hand.tsx';

export interface TrayHand {
  cards: HandCard[];
  selected: number | null;
  /** Kinds that may be picked now (others dim). null = none (just showing your hand). */
  pickable: readonly PuriKind[] | null;
  onPick: (i: number) => void;
  /** Setup: the slot number each picked bowl went into. */
  orders?: (number | null)[];
}

export function BowlTray({ hand, color, phone }: { hand: TrayHand; color: ColorId; phone: boolean }) {
  const n = hand.cards.length;
  return (
    <div className="tp-tray" role="group" aria-label={`Your bowls: ${n}`}>
      <span className="tp-tray__label" aria-hidden="true">
        Your bowls
      </span>
      <div className="tp-tray__row">
        {hand.cards.map((c, i) => {
          const order = hand.orders?.[i] ?? null;
          const on = hand.selected === i || order != null;
          const can = !!hand.pickable?.includes(c.kind) || order != null;
          const name = c.kind === 'akabare' ? 'Akabare' : 'Panipuri';
          return (
            <button
              key={i}
              type="button"
              className={cx('tp-tray__bowl', on && 'is-on', can && 'is-can', !can && hand.pickable && 'is-off')}
              disabled={!can}
              aria-pressed={can ? on : undefined}
              aria-label={`${name} in your hand${order != null ? `, picked ${order}` : ''}`}
              onClick={() => hand.onPick(i)}
            >
              <BowlIcon kind={c.kind} color={color} size={phone ? 40 : 52} />
              {order != null ? (
                <span className="tp-tray__badge" aria-hidden="true">
                  {order}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
