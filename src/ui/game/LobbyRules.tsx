/**
 * The game mode: the host picks Classic / Quick / Marathon; everyone else sees
 * which one is on. An info button opens a short card (under the row) saying what
 * each mode means.
 */
import { useId, useState } from 'react';
import type { GameConfig } from '../../engine/types.ts';
import type { UseGame } from '../../net/useGame.ts';
import { Icon } from '../common/Icon.tsx';
import { cx, useRunner } from '../common/hooks.ts';

export const PRESETS: { id: string; label: string; sub: string; rule: string; config: Pick<GameConfig, 'targetScore' | 'maxRounds' | 'trapReward'> }[] = [
  {
    id: 'classic',
    label: 'Classic',
    sub: '30 pts or 5 rounds',
    rule: 'First to 30 points wins. If nobody gets there, the most points after 5 rounds wins.',
    config: { targetScore: 30, maxRounds: 5, trapReward: 2 },
  },
  { id: 'quick', label: 'Quick', sub: 'First to 15, no round limit', rule: 'First to 15 points wins. Play as many rounds as it takes.', config: { targetScore: 15, maxRounds: null, trapReward: 2 } },
  { id: 'marathon', label: 'Marathon', sub: '30 pts, no round limit', rule: 'First to 30 points wins. Play as many rounds as it takes.', config: { targetScore: 30, maxRounds: null, trapReward: 2 } },
];

/** The info button (toggles the card below the mode row). */
function InfoButton({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button
      type="button"
      className={cx('tp-iconbtn tp-modeinfo__btn', open && 'is-on')}
      aria-label="What the modes mean"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <Icon name="info" size={20} />
    </button>
  );
}

/** What each mode means, with the one that's on highlighted. */
function ModeCard({ id, activeId }: { id: string; activeId: string | null }) {
  return (
    <div className="tp-modeinfo__card" id={id} role="region" aria-label="Game modes">
      <dl>
        {PRESETS.map((p) => (
          <div key={p.id} className={cx('tp-modeinfo__row', activeId === p.id && 'is-on')}>
            <dt>{p.label}</dt>
            <dd>{p.rule}</dd>
          </div>
        ))}
      </dl>
      <p className="tp-modeinfo__note">In every mode, if your Akabare busts someone else, you get 2 points.</p>
    </div>
  );
}

export function Presets({ game }: { game: UseGame }) {
  const c = game.snapshot!.config;
  const { pending, run } = useRunner();
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const toggle = () => setOpen((o) => !o);
  const active = PRESETS.find((p) => p.config.targetScore === c.targetScore && p.config.maxRounds === c.maxRounds && p.config.trapReward === c.trapReward);
  if (!game.isHost) {
    return (
      <div className="tp-modes">
        <div className="tp-lobby-presets tp-lobby-presets--guest">
          <span className="tp-lobby-mode">{active ? active.label : 'Custom rules'}</span>
          <InfoButton open={open} onToggle={toggle} controls={cardId} />
        </div>
        {open ? <ModeCard id={cardId} activeId={active?.id ?? null} /> : null}
      </div>
    );
  }
  return (
    <div className="tp-modes">
    <div className="tp-lobby-presets" role="group" aria-label="Game mode">
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
      <InfoButton open={open} onToggle={toggle} controls={cardId} />
    </div>
    {open ? <ModeCard id={cardId} activeId={active?.id ?? null} /> : null}
    </div>
  );
}
