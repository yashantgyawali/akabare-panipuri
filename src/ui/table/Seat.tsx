/**
 * One seat at the table: nameplate (colour, name, score, busts, hand count,
 * online/bot/host, status chip) plus the seat's STACK and its POWER card.
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
  variant: 'opp' | 'me';
  compact?: boolean;
}

const pulseClass = (seq: number, tone?: 'good' | 'bad') => cx(seq % 2 ? 'ak-cue-a' : 'ak-cue-b', tone && `ak-cue--${tone}`);

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

export function Seat({ p, view, names, isHost, online, turn, status, cardW, stackMax, stack, power, cue, variant, compact }: SeatProps) {
  const pal = PLAYER_PALETTE[p.color];
  const you = p.id === view.youId;
  const items = stackItems(p, view, names);
  const pw = p.power;
  // Never below 35px: the back's owner badge needs that much room for a wide letter (M, W).
  const powerW = Math.max(35, Math.round(cardW * 0.86));
  const pwUp = !!pw && (pw.revealed || view.revealed) && pw.kind !== null;
  const pwLabel = !pw
    ? ''
    : pwUp
      ? `${names.Whose(p.id)} power, face up: ${powerName(pw.kind!)}`
      : you && pw.kind
        ? `Your power, face down: ${powerName(pw.kind)}`
        : `${names.Whose(p.id)} power, face down`;
  return (
    <section
      className={cx(
        'ak-seat',
        `ak-seat--${variant}`,
        compact && 'ak-seat--compact',
        turn && 'ak-seat--turn',
        you && 'ak-seat--you',
        p.isBot && 'ak-seat--bot',
        cue?.part === 'seat' && pulseClass(cue.seq, cue.tone),
      )}
      style={{ ['--c' as string]: pal.base, ['--c-deep' as string]: pal.deep, ['--c-light' as string]: pal.light, ['--c-ink' as string]: pal.ink }}
      aria-label={`${you ? 'You' : p.name}${turn ? ', to act' : ''}`}
      data-seat={p.id}
    >
      <header className="ak-seat__plate">
        <span className="ak-seat__avatar" aria-hidden="true">
          {names.initial(p.id)}
        </span>
        <span className="ak-seat__who">
          <span className="ak-seat__name">
            <span className="ak-seat__nametext">{you ? 'You' : p.name}</span>
            {isHost ? (
              <span className="ak-seat__icon" title="Host">
                <Icon name="crown" size={13} title="host" />
              </span>
            ) : null}
            {p.isBot ? (
              <span className="ak-seat__bot" title={you ? 'A bot is playing for you' : 'Bot'}>
                <Icon name="bot" size={13} /> bot
              </span>
            ) : online !== null ? (
              <span className={cx('ak-dot', online ? 'ak-dot--on' : 'ak-dot--off')} title={online ? 'Online' : 'Offline'}>
                <span className="ak-sr">{online ? 'online' : 'offline'}</span>
              </span>
            ) : null}
          </span>
          <span className="ak-seat__meta">
            <span title="Cards in hand">
              <Icon name="hand" size={13} /> {p.handCount}
              <span className="ak-sr"> in hand</span>
            </span>
            {p.busts > 0 ? (
              <span title="Busts this game" className="ak-seat__busts">
                <Icon name="chili" size={13} /> {p.busts}
                <span className="ak-sr"> busts</span>
              </span>
            ) : null}
          </span>
        </span>
        <span className="ak-seat__score" aria-label={`${p.score} points`}>
          {num(p.score)}
        </span>
      </header>
      {status ? <span className={cx('ak-seat__status', `ak-seat__status--${status.tone}`)}>{status.label}</span> : null}
      <div className="ak-seat__cards">
        <div
          className={cx('ak-seat__stack', cue?.part === 'stack' && pulseClass(cue.seq, cue.tone))}
          data-stack-of={p.id}
        >
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
        <div className={cx('ak-seat__power', cue?.part === 'power' && pulseClass(cue.seq, cue.tone))} data-power-of={p.id}>
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
            <span className="ak-seat__nopower" style={{ width: powerW, height: Math.round(powerW * (88 / 63)) }} aria-hidden="true" />
          )}
        </div>
      </div>
    </section>
  );
}
