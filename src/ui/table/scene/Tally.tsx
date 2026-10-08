/**
 * The eater's tally board: who is eating, eaten / target with a bar, power
 * flips left, and the Numb / Naya Plate notes. Read-only for everybody;
 * actions live in the dock and on the table.
 */
import type { PlayerView } from '../../../engine/types.ts';
import { cx } from '../../common/hooks.ts';
import type { NameBook } from '../../text.ts';

export function Tally({ view, names }: { view: PlayerView; names: NameBook }) {
  const e = view.eating;
  if (!e) return null;
  const max = view.config.powerFlipsMax;
  const left = Math.max(0, max - e.powersFlipped);
  const you = e.eaterId === view.youId;
  const pct = Math.min(100, Math.round((e.eaten / Math.max(1, e.target)) * 100));
  const r = view.phase === 'roundEnd' || view.phase === 'gameOver' ? view.results.find((x) => x.round === view.round) : null;
  const who = r
    ? `${you ? 'You' : names.name(e.eaterId)} ${r.outcome === 'success' ? `ate ${r.target}` : 'went bust'}`
    : you
      ? 'You are eating'
      : `${names.name(e.eaterId)} is eating`;
  return (
    <section className="tp-tally" aria-label="Eating progress">
      <span className="tp-tally__who">{who}</span>
      <div className="tp-tally__count" role="img" aria-label={`Eaten ${e.eaten} of ${e.target}`}>
        <span className="tp-num tp-tally__eaten">{e.eaten}</span>
        <span className="tp-num tp-tally__target">/ {e.target}</span>
      </div>
      <div className="tp-tally__bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="tp-tally__flips" aria-label={`${left} of ${max} power flips left`}>
        {left} of {max} power flips left
      </span>
      <div className={cx('tp-tally__notes', !e.skipNext && !e.freePlate && 'is-empty')}>
        {e.skipNext ? (
          <span className="tp-tag tp-tag--yellow" role="note">
            Numb: the next puri is cancelled
          </span>
        ) : null}
        {e.freePlate ? (
          <span className="tp-tag tp-tag--yellow" role="note">
            Naya Plate: any stack, any order
          </span>
        ) : null}
      </div>
    </section>
  );
}
