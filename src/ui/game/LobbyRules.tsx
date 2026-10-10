/** Host-only preset row: Classic / Quick / Marathon. */
import type { GameConfig } from '../../engine/types.ts';
import type { UseGame } from '../../net/useGame.ts';
import { cx, useRunner } from '../common/hooks.ts';

export const PRESETS: { id: string; label: string; sub: string; config: Pick<GameConfig, 'targetScore' | 'maxRounds' | 'trapReward'> }[] = [
  { id: 'classic', label: 'Classic', sub: '30 pts or 5 rounds', config: { targetScore: 30, maxRounds: 5, trapReward: 2 } },
  { id: 'quick', label: 'Quick', sub: 'First to 15, no round limit', config: { targetScore: 15, maxRounds: null, trapReward: 2 } },
  { id: 'marathon', label: 'Marathon', sub: '30 pts, no round limit', config: { targetScore: 30, maxRounds: null, trapReward: 2 } },
];

export function Presets({ game }: { game: UseGame }) {
  const c = game.snapshot!.config;
  const { pending, run } = useRunner();
  const active = PRESETS.find((p) => p.config.targetScore === c.targetScore && p.config.maxRounds === c.maxRounds && p.config.trapReward === c.trapReward);
  return (
    <div className="tp-lobby-presets" role="group" aria-label="Rules">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={cx('tp-lobby-preset', active?.id === p.id && 'tp-lobby-preset--on')}
          aria-pressed={active?.id === p.id}
          aria-label={`${p.label}: ${p.sub}`}
          title={p.sub}
          disabled={game.busy}
          onClick={() => void run(p.id, () => game.updateLobby({ config: p.config }))}
        >
          {pending === p.id ? <span className="tp-spinner" aria-hidden="true" /> : null}
          {p.label}
        </button>
      ))}
    </div>
  );
}
