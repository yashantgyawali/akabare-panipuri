/**
 * A seat's cards lying on the table: the loose stack (every card a touch
 * rotated by its INDEX, never by its kind) and the face-down power card beside
 * it. Rotated so the bottom of the cards faces the seat. Click targets keep
 * the `[data-stack-of] > button` / `[data-power-of] > button` hooks Table.tsx
 * restores focus with.
 */
import type { CSSProperties } from 'react';
import type { PlayerView, PublicPlayerView } from '../../../engine/types.ts';
import { Card, CardStack } from '../../../cards/index.ts';
import { cx } from '../../common/hooks.ts';
import { powerName, type NameBook } from '../../text.ts';
import { stackItems, type Clickable, type SeatCue } from './seatData.ts';

const pulseClass = (seq: number, tone?: 'good' | 'bad') => cx(seq % 2 ? 'tp-cue-a' : 'tp-cue-b', tone && `tp-cue--${tone}`);

export function Pile3D({
  p,
  view,
  names,
  rot,
  cardW,
  stackMax,
  stack,
  power,
  cue,
}: {
  p: PublicPlayerView;
  view: PlayerView;
  names: NameBook;
  rot: number;
  cardW: number;
  stackMax: number;
  stack: Clickable;
  power: Clickable;
  cue: SeatCue | null;
}) {
  const you = p.id === view.youId;
  const pw = p.power;
  const powerW = Math.max(36, Math.round(cardW * 0.8));
  const pwUp = !!pw && (pw.revealed || view.revealed) && pw.kind !== null;
  const pwLabel = !pw
    ? ''
    : pwUp
      ? `${names.Whose(p.id)} power, face up: ${powerName(pw.kind!)}`
      : you && pw.kind
        ? `Your power, face down: ${powerName(pw.kind)}`
        : `${names.Whose(p.id)} power, face down`;
  return (
    <div className="tp-pile" style={{ ['--rot' as string]: `${rot}deg` } as CSSProperties}>
      <div className={cx('tp-pile__stack', cue?.part === 'stack' && pulseClass(cue.seq, cue.tone))} data-stack-of={p.id}>
        <CardStack
          cards={stackItems(p, view, names)}
          width={cardW}
          maxHeight={stackMax}
          offset={Math.max(8, Math.round(cardW * 0.2))}
          countFrom={3}
          state={stack.state}
          onClick={stack.onClick}
          ariaLabel={stack.label}
        />
      </div>
      <div className={cx('tp-pile__power', cue?.part === 'power' && pulseClass(cue.seq, cue.tone))} data-power-of={p.id}>
        {pw ? (
          <Card
            back="power"
            color={p.color}
            face={pwUp ? pw.kind : null}
            faceUp={pwUp}
            peek={!pwUp && you ? pw.kind : null}
            badge={powerW < 44 ? names.initial(p.id).slice(0, 1) : names.initial(p.id)}
            width={powerW}
            state={power.state}
            onClick={power.onClick}
            ariaLabel={power.onClick ? power.label : pwLabel}
          />
        ) : (
          <span className="tp-pile__nopower" style={{ width: powerW, height: Math.round(powerW * (88 / 63)) }} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
