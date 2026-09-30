/** The eater's HUD: eaten / target, power flips left, numb, flipped powers. Everyone sees it (read-only). */
import type { PlayerView } from '../../engine/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import { cx } from '../common/hooks.ts';
import { EFFECT_TEXT, powerName, type NameBook } from '../text.ts';

export function EatingHud({ view, names, compact }: { view: PlayerView; names: NameBook; compact?: boolean }) {
  const e = view.eating;
  if (!e) return null;
  const max = view.config.powerFlipsMax;
  const left = Math.max(0, max - e.powersFlipped);
  const you = e.eaterId === view.youId;
  const khali = e.target - e.bid;
  const pct = Math.min(100, Math.round((e.eaten / Math.max(1, e.target)) * 100));
  return (
    <section className={cx('ak-hud', compact && 'ak-hud--compact')} aria-label="Eating progress" style={{ ['--c' as string]: PLAYER_PALETTE[names.color(e.eaterId)].base }}>
      <div className="ak-hud__who">
        <span className="ak-hud__avatar" aria-hidden="true">
          {names.initial(e.eaterId)}
        </span>
        <span>
          {(() => {
            const r = view.phase === 'roundEnd' || view.phase === 'gameOver' ? view.results.find((x) => x.round === view.round) : null;
            if (r) return `${you ? 'You' : names.name(e.eaterId)} ${r.outcome === 'success' ? `ate ${r.target}` : you ? 'bust' : 'busted'}`;
            return you ? 'You are eating' : `${names.name(e.eaterId)} is eating`;
          })()}
        </span>
      </div>
      <div className="ak-hud__count" aria-label={`Eaten ${e.eaten} of ${e.target}`}>
        <span className="ak-hud__eaten">{e.eaten}</span>
        <span className="ak-hud__slash">/</span>
        <span className="ak-hud__target">{e.target}</span>
      </div>
      <div className="ak-hud__bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="ak-hud__bid">
        {khali > 0 ? (
          <>
            Bid {e.bid} <span aria-hidden="true">→</span>
            <span className="ak-sr"> raised to</span> <strong>{e.target}</strong> (Khali Puri)
          </>
        ) : (
          <>Bid {e.bid}</>
        )}
      </p>
      <div className="ak-hud__flips" aria-label={`${left} of ${max} power flips left`}>
        <span className="ak-hud__flipdots" aria-hidden="true">
          {Array.from({ length: max }, (_, i) => (
            <i key={i} className={i < e.powersFlipped ? 'is-used' : ''} />
          ))}
        </span>
        <span>
          {left} power flip{left === 1 ? '' : 's'} left
        </span>
      </div>
      {e.skipNext ? (
        <p className="ak-hud__numb" role="note">
          Numb: the next puri is cancelled
        </p>
      ) : null}
      {e.powers.length > 0 ? (
        <ul className="ak-hud__powers" aria-label="Powers flipped">
          {e.powers.map((p, i) => (
            <li key={i} className={cx('ak-pchip', `ak-pchip--${p.effect}`)} style={{ ['--c' as string]: PLAYER_PALETTE[names.color(p.owner)].base }}>
              <strong>
                {p.owner === view.youId ? 'Your' : `${names.name(p.owner)}’s`} {powerName(p.kind)}
              </strong>
              <span>{EFFECT_TEXT[p.effect]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
