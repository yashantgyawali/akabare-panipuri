/** Lobby right column: presets, custom rules (host) and the Goal / Trap / Leftovers summary. */
import { useEffect, useId, useState } from 'react';
import type { GameConfig } from '../../engine/types.ts';
import type { UseGame } from '../../net/useGame.ts';
import { Stepper } from '../common/Stepper.tsx';
import { cx, useRunner } from '../common/hooks.ts';
import { goalText } from '../text.ts';

export const PRESETS: { id: string; label: string; sub: string; config: Pick<GameConfig, 'targetScore' | 'maxRounds' | 'trapReward'> }[] = [
  { id: 'classic', label: 'Classic v0.6', sub: '30 pts or 5 rounds', config: { targetScore: 30, maxRounds: 5, trapReward: 2 } },
  { id: 'quick', label: 'Quick', sub: 'First to 15, no round limit', config: { targetScore: 15, maxRounds: null, trapReward: 2 } },
  { id: 'marathon', label: 'Marathon', sub: '30 pts, no round limit', config: { targetScore: 30, maxRounds: null, trapReward: 2 } },
];

function Summary({ c }: { c: GameConfig }) {
  return (
    <dl className="tp-lobby-summary">
      <div>
        <dt>Goal</dt>
        <dd>{goalText(c)}</dd>
      </div>
      <div>
        <dt>Trap</dt>
        <dd>{c.trapReward > 0 ? `+${c.trapReward} to the owner of the Akabare that busts the eater` : 'No trap reward'}</dd>
      </div>
      <div>
        <dt>Leftovers</dt>
        <dd>{c.revealOnRoundEnd ? 'Revealed at the end of each round' : 'Stay secret until the game ends'}</dd>
      </div>
    </dl>
  );
}

function CustomRow({
  label,
  value,
  min,
  max,
  onChange,
  off,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  off?: { isOff: boolean; locked: boolean; toggle: () => void };
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="tp-lobby-custom__row">
      <span id={id} className="tp-lobby-custom__label">
        {label}
      </span>
      {off ? (
        <button
          type="button"
          className={cx('tp-lobby-pill', !off.isOff && 'tp-lobby-pill--on')}
          aria-pressed={!off.isOff}
          aria-label={`${label}: ${off.isOff ? 'off' : 'on'}`}
          disabled={off.locked || disabled}
          onClick={off.toggle}
        >
          {off.isOff ? 'off' : 'on'}
        </button>
      ) : null}
      <Stepper label={label} value={value} min={min} max={max} onChange={onChange} disabled={disabled || off?.isOff} />
    </div>
  );
}

export function RulesColumn({ game }: { game: UseGame }) {
  const snap = game.snapshot!;
  const c = snap.config;
  const [custom, setCustom] = useState(false);
  const [lastTarget, setLastTarget] = useState(c.targetScore ?? 30);
  const [lastRounds, setLastRounds] = useState(c.maxRounds ?? 5);
  useEffect(() => {
    if (c.targetScore !== null) setLastTarget(c.targetScore);
    if (c.maxRounds !== null) setLastRounds(c.maxRounds);
  }, [c.targetScore, c.maxRounds]);
  const { pending, run } = useRunner();
  const set = (key: string, patch: Partial<GameConfig>) => void run(key, () => game.updateLobby({ config: patch }));
  const active = PRESETS.find((p) => p.config.targetScore === c.targetScore && p.config.maxRounds === c.maxRounds && p.config.trapReward === c.trapReward);

  return (
    <section className="tp-lobby-col" aria-labelledby="rules-h">
      <h2 className="tp-h2" id="rules-h">
        House rules
      </h2>
      {game.isHost ? (
        <div className="tp-lobby-rules">
          <div className="tp-lobby-presets" role="group" aria-label="Presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={cx('tp-lobby-preset', active?.id === p.id && 'tp-lobby-preset--on')}
                aria-pressed={active?.id === p.id}
                disabled={game.busy}
                onClick={() => set(p.id, p.config)}
              >
                <span className="tp-lobby-preset__label">
                  {pending === p.id ? <span className="tp-spinner" aria-hidden="true" /> : null}
                  {p.label}
                </span>
                <span className="tp-lobby-preset__sub">{p.sub}</span>
              </button>
            ))}
          </div>
          <button type="button" className="tp-link tp-link--quiet tp-lobby-disclose" aria-expanded={custom} aria-controls="lobby-custom" onClick={() => setCustom((v) => !v)}>
            {custom ? 'Hide custom rules' : 'Custom rules…'}
          </button>
          {custom ? (
            <div className="tp-panel tp-lobby-custom" id="lobby-custom">
              <CustomRow
                label="Target score"
                value={c.targetScore ?? lastTarget}
                min={1}
                max={1000}
                onChange={(n) => set('target', { targetScore: n })}
                off={{ isOff: c.targetScore === null, locked: c.maxRounds === null, toggle: () => set('target', { targetScore: c.targetScore === null ? lastTarget : null }) }}
              />
              <CustomRow
                label="Rounds"
                value={c.maxRounds ?? lastRounds}
                min={1}
                max={100}
                onChange={(n) => set('rounds', { maxRounds: n })}
                off={{ isOff: c.maxRounds === null, locked: c.targetScore === null, toggle: () => set('rounds', { maxRounds: c.maxRounds === null ? lastRounds : null }) }}
              />
              <CustomRow label="Trap reward" value={c.trapReward} min={0} max={100} onChange={(n) => set('trap', { trapReward: n })} />
              <label className="tp-check">
                <input type="checkbox" checked={c.revealOnRoundEnd} onChange={(e) => set('reveal', { revealOnRoundEnd: e.target.checked })} />
                <span>Reveal leftover cards at the end of each round</span>
              </label>
              <p className="tp-field__hint">The game needs a target score or a round limit, so both can’t be off. Trap reward is paid to the owner of the Akabare that busts someone else.</p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="tp-small tp-muted">Set by the host.{active ? ` Preset: ${active.label}.` : ''}</p>
      )}
      <Summary c={c} />
    </section>
  );
}
