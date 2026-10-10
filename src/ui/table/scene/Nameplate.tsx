/** The upright nameplate at the rim: avatar, name, score, one short status. Billboarded by CSS. */
import { Icon } from '../../common/Icon.tsx';
import { cx } from '../../common/hooks.ts';
import { num } from '../../text.ts';
import type { SeatStatus } from './seatData.ts';

export interface NameplateProps {
  name: string;
  initial: string;
  score: number;
  you: boolean;
  isHost: boolean;
  isBot: boolean;
  /** true online, false offline, null = don't show. */
  online: boolean | null;
  turn: boolean;
  status: SeatStatus | null;
  /** Event cue class (a quick outline flash). */
  pulse?: string;
}

export function Nameplate(p: NameplateProps) {
  return (
    <div className={cx('tp-np', p.turn && 'is-turn', p.you && 'is-you')}>
      <div className={cx('tp-np__card', p.pulse)}>
        <span className="tp-np__avatar" aria-hidden="true">
          {p.initial}
        </span>
        <span className="tp-np__text">
          <span className="tp-np__name">
            {p.name}
            {p.you ? <span className="tp-np__you"> (you)</span> : null}
            {p.isHost ? <Icon name="crown" size={13} title="host" /> : null}
            {p.isBot ? (
              <span className="tp-np__bot">
                <Icon name="bot" size={13} title={p.you ? 'A bot is playing for you' : 'Bot'} />
              </span>
            ) : p.online === false ? <span className="tp-np__off" role="img" aria-label="offline" title="Offline" /> : null}
          </span>
          {p.status ? <span className={cx('tp-np__tag', `is-${p.status.tone}`)}>{p.status.label}</span> : null}
        </span>
        <span className="tp-np__score tp-num" aria-label={`${p.score} points`}>
          {num(p.score)}
        </span>
      </div>
    </div>
  );
}
