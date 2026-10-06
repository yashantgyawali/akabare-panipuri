/**
 * One seat card: colour dot, name, big score, a status tag row, then the
 * seat's STACK next to its POWER card.
 * Hidden information: other owners' face-down cards get face={null}; only
 * the viewer's own face-down cards carry a `peek`. Kinds come from the view,
 * which already hides what this viewer may not know.
 */
import type { PlayerView, PublicPlayerView } from '../../engine/types.ts';
import { Card, CardStack, PLAYER_PALETTE, type CardState, type CardStackItem } from '../../cards/index.ts';
import { Icon } from '../common/Icon.tsx';
import { cx } from '../common/hooks.ts';
import { num, powerName, type NameBook } from '../text.ts';

export interface SeatStatus {
  label: string;
  tone: 'turn' | 'eater' | 'passed' | 'high' | 'done' | 'wait' | 'bust' | 'win';
}

export interface Clickable {
  onClick?: () => void;
  state: CardState;
  label: string;
}

export interface SeatProps {
  p: PublicPlayerView;
  view: PlayerView;
  names: NameBook;
  isHost: boolean;
  /** true online, false offline, null = don't show (bots, or still in the presence grace period). */
  online: boolean | null;
  turn: boolean;
  status: SeatStatus | null;
  cardW: number;
  stackMax: number;
  stack: Clickable;
  power: Clickable;
  /** Event cue: which part pulses, keyed by seq (alternating animations restart on every event). */
  cue: { part: 'stack' | 'power' | 'seat'; seq: number; tone?: 'good' | 'bad' } | null;
  compact?: boolean;
}

const pulseClass = (seq: number, tone?: 'good' | 'bad') => cx(seq % 2 ? 'tp-cue-a' : 'tp-cue-b', tone && `tp-cue--${tone}`);

const TAG_FOR: Record<SeatStatus['tone'], string> = {
  turn: 'tp-tag--yellow',
  eater: 'tp-tag--red',
  high: 'tp-tag--red',
  done: 'tp-tag--green',
  wait: '',
  passed: '',
  bust: 'tp-tag--red',
  win: 'tp-tag--yellow',
};

export function stackItems(p: PublicPlayerView, view: PlayerView, names: NameBook): CardStackItem[] {
  return p.stack.map((c, i) => {
    const mine = c.owner === view.youId;
    const shown = view.revealed && c.kind !== null;
    return {
      key: i,
      back: 'puri',
      color: names.color(c.owner),
      badge: names.initial(c.owner),
      face: shown ? c.kind : null,
      faceUp: shown,
      peek: mine && !shown ? c.kind : null,
    };
  });
}

export function stackLabel(p: PublicPlayerView, names: NameBook): string {
  const whose = names.Whose(p.id);
  if (p.stack.length === 0) return `${whose} stack is empty`;
  const top = p.stack[p.stack.length - 1];
  const topOwner = top.owner === names.you ? 'yours' : `${names.name(top.owner)}’s`;
  const known = top.kind ? (top.kind === 'akabare' ? ', an Akabare' : ', a Panipuri') : '';
  return `${whose} stack: ${p.stack.length} card${p.stack.length === 1 ? '' : 's'}, top card ${topOwner}${known}`;
}

export function Seat({ p, view, names, isHost, online, turn, status, cardW, stackMax, stack, power, cue, compact }: SeatProps) {
  const pal = PLAYER_PALETTE[p.color];
  const you = p.id === view.youId;
  const items = stackItems(p, view, names);
  const pw = p.power;
  // Never below 35px: the back's owner badge needs that much room for a wide letter (M, W).
  const powerW = Math.max(35, Math.round(cardW * 0.78));
  const pwUp = !!pw && (pw.revealed || view.revealed) && pw.kind !== null;
  const pwLabel = !pw
    ? ''
    : pwUp
      ? `${names.Whose(p.id)} power, face up: ${powerName(pw.kind!)}`
      : you && pw.kind
        ? `Your power, face down: ${powerName(pw.kind)}`
        : `${names.Whose(p.id)} power, face down`;
  const showHand = (view.phase === 'serving' || view.phase === 'bidding') && p.handCount > 0;
  return (
    <section
      className={cx(
        'tp-seat',
        compact && 'tp-seat--compact',
        turn && 'tp-seat--turn',
        you && 'tp-seat--you',
        p.isBot && 'tp-seat--bot',
        cue?.part === 'seat' && pulseClass(cue.seq, cue.tone),
      )}
      style={{ ['--c' as string]: pal.base }}
      aria-label={`${you ? 'You' : p.name}${turn ? ', to act' : ''}`}
      data-seat={p.id}
    >
      <header className="tp-seat__head">
        <span className="tp-dot" aria-hidden="true" />
        <span className="tp-seat__name">
          {p.name}
          {you ? <span className="tp-seat__you"> (you)</span> : null}
        </span>
        {isHost ? (
          <span className="tp-seat__host">
            <Icon name="crown" size={14} title="host" />
          </span>
        ) : null}
        <span className="tp-seat__score tp-num" aria-label={`${p.score} points`}>
          {num(p.score)}
        </span>
      </header>
      <div className="tp-seat__tags">
        {status ? <span className={cx('tp-tag', TAG_FOR[status.tone], status.tone === 'passed' && 'tp-tag--quiet')}>{status.label}</span> : null}
        {p.isBot ? (
          <span className="tp-tag tp-tag--beige" title={you ? 'A bot is playing for you' : 'Bot'}>
            <Icon name="bot" size={12} /> bot
          </span>
        ) : online === false ? (
          <span className="tp-tag tp-tag--red">offline</span>
        ) : online === true ? (
          <span className="tp-seat__online" title="Online">
            <span className="tp-seat__onlinedot" aria-hidden="true" /> online
          </span>
        ) : null}
        {showHand ? (
          <span className="tp-seat__hand" title="Cards in hand">
            {p.handCount} in hand
          </span>
        ) : null}
        {p.busts > 0 ? (
          <span className="tp-seat__hand" title="Busts this game">
            {p.busts} bust{p.busts === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
      <div className="tp-seat__cards">
        <div className={cx('tp-seat__stack', cue?.part === 'stack' && pulseClass(cue.seq, cue.tone))} data-stack-of={p.id}>
          <CardStack
            cards={items}
            width={cardW}
            maxHeight={stackMax}
            offset={Math.max(12, Math.round(cardW * 0.26))}
            countFrom={3}
            state={stack.state}
            onClick={stack.onClick}
            ariaLabel={stack.label}
          />
        </div>
        <div className={cx('tp-seat__power', cue?.part === 'power' && pulseClass(cue.seq, cue.tone))} data-power-of={p.id}>
          {pw ? (
            <Card
              back="power"
              color={p.color}
              face={pwUp ? pw.kind : null}
              faceUp={pwUp}
              peek={!pwUp && you ? pw.kind : null}
              // A small power card has room for one letter (two would ellipsize to "A…"); it sits in its seat anyway.
              badge={powerW < 40 ? names.initial(p.id).slice(0, 1) : names.initial(p.id)}
              width={powerW}
              state={power.state}
              onClick={power.onClick}
              ariaLabel={power.onClick ? power.label : pwLabel}
            />
          ) : (
            <span className="tp-seat__nopower" style={{ width: powerW, height: Math.round(powerW * (88 / 63)) }} aria-hidden="true" />
          )}
        </div>
      </div>
    </section>
  );
}
