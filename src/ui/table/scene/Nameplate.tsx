/** The upright nameplate at the rim: avatar disc, name, big score, status tags. Billboarded by CSS. */
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
  handCount: number | null;
  busts: number;
  /** Event cue class (a quick outline flash). */
  pulse?: string;
}

export function Nameplate(p: NameplateProps) {
  const tags: { text: string; cls: string; title?: string }[] = [];
  if (p.status) tags.push({ text: p.status.label, cls: `is-${p.status.tone}` });
  if (p.isBot) tags.push({ text: 'bot', cls: 'is-bot', title: p.you ? 'A bot is playing for you' : 'Bot' });
  else if (p.online === false) tags.push({ text: 'offline', cls: 'is-offline' });
  if (p.handCount) tags.push({ text: `${p.handCount} in hand`, cls: 'is-quiet' });
  if (p.busts > 0) tags.push({ text: `${p.busts} bust${p.busts === 1 ? '' : 's'}`, cls: 'is-quiet', title: 'Busts this game' });
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
          </span>
          {tags.length ? (
            <span className="tp-np__tags">
              {tags.map((t) => (
                <span key={t.text} className={cx('tp-np__tag', t.cls)} title={t.title}>
                  {t.text}
                </span>
              ))}
            </span>
          ) : null}
        </span>
        <span className="tp-np__score tp-num" aria-label={`${p.score} points`}>
          {num(p.score)}
        </span>
      </div>
    </div>
  );
}
