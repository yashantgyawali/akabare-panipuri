/**
 * The eater's tally: eaten / target, a bar and power-flip pips. Read-only.
 */
import type { PlayerView } from '../../../engine/types.ts';
import { cx } from '../../common/hooks.ts';

export function Tally({ view }: { view: PlayerView }) {
  const e = view.eating;
  if (!e) return null;
  const max = view.config.powerFlipsMax;
  const left = Math.max(0, max - e.powersFlipped);
  const pct = Math.min(100, Math.round((e.eaten / Math.max(1, e.target)) * 100));
  return (
    <section className="tp-tally" aria-label="Eating progress">
      <div className="tp-tally__count" role="img" aria-label={`Eaten ${e.eaten} of ${e.target}`}>
        <span className="tp-num tp-tally__eaten">{e.eaten}</span>
        <span className="tp-num tp-tally__target">/ {e.target}</span>
      </div>
      <div className="tp-tally__bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="tp-tally__flips" role="img" aria-label={`${left} of ${max} power flips left`}>
        {Array.from({ length: max }, (_, i) => (
          <i key={i} className={cx(i < left && 'is-on')} />
        ))}
      </span>
      {e.skipNext ? <span className="tp-sr" role="note">Numb: the next puri is cancelled</span> : null}
      {e.freePlate ? <span className="tp-sr" role="note">Naya Plate: any stack, any order</span> : null}
    </section>
  );
}
