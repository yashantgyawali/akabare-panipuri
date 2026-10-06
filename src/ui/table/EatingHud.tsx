/**
 * The eating HUD: who is eating, eaten / target with a red bar, power flips
 * left, note pills (Numb, Naya Plate), and "the plate". Everyone sees it
 * (read-only); actions live in the dock and on the seats.
 */
import type { PlayerView } from '../../engine/types.ts';
import { cx } from '../common/hooks.ts';
import type { NameBook } from '../text.ts';
import { Plate } from './Plate.tsx';

export function EatingHud({ view, names, plateW, reduced }: { view: PlayerView; names: NameBook; plateW: number; reduced: boolean }) {
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
    <section className="tp-panel tp-panel--ink tp-panel--shadow-red tp-hud" aria-label="Eating progress">
      <div className="tp-hud__main">
        <span className="tp-hud__who">{who}</span>
        <div className="tp-hud__count" role="img" aria-label={`Eaten ${e.eaten} of ${e.target}`}>
          <span className="tp-num tp-hud__eaten">{e.eaten}</span>
          <span className="tp-num tp-hud__target">/ {e.target}</span>
        </div>
        <div className="tp-hud__bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="tp-hud__flips" aria-label={`${left} of ${max} power flips left`}>
          {left} of {max} power flips left
        </span>
        <div className={cx('tp-hud__notes', !e.skipNext && !e.freePlate && 'is-empty')}>
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
      </div>
      <div className="tp-hud__plate">
        <span className="tp-hand tp-hud__plate-label">the plate</span>
        <Plate plate={e.plate} powers={e.powers} names={names} width={plateW} reduced={reduced} empty="Nothing eaten yet." />
      </div>
    </section>
  );
}
