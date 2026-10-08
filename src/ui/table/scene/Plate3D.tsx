/**
 * The brass plate in the middle of the table: every puri the eater has flipped
 * this round lands on it face up (a short 3D drop, then the flip), then the
 * power cards flipped. Cancelled cards are dimmed and marked, saved Akabare
 * marked. Cards sit in a loose spiral; their tilt comes from the INDEX only.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PlateCardView, PlayerId, PowerEffect, PowerKind } from '../../../engine/types.ts';
import { Card } from '../../../cards/index.ts';
import { cx } from '../../common/hooks.ts';
import { EFFECT_TEXT, powerName, type NameBook } from '../../text.ts';

export interface PlatePower {
  kind: PowerKind;
  owner: PlayerId;
  effect: PowerEffect;
}

/** Card centre i of n on the plate, in px from its middle (phyllotaxis: no two cards stack exactly). */
export function platePos(i: number, n: number, radius: number): { x: number; y: number; rot: number } {
  const total = Math.max(n, 5);
  const r = (radius * Math.sqrt(i + 0.6)) / Math.sqrt(total + 0.6);
  const a = i * 2.399963;
  return { x: Math.round(r * Math.cos(a)), y: Math.round(r * Math.sin(a)), rot: ((i * 53) % 25) - 12 };
}

function PlateCard({ children, pos, drop, mark, markCls, dim, delay }: { children: ReactNode; pos: { x: number; y: number; rot: number }; drop: boolean; mark?: string; markCls?: string; dim?: boolean; delay?: number }) {
  const style = { ['--x' as string]: `${pos.x}px`, ['--y' as string]: `${pos.y}px`, ['--r' as string]: `${pos.rot}deg`, animationDelay: delay ? `${delay}ms` : undefined } as CSSProperties;
  return (
    <div className={cx('tp-pl__card', drop && 'is-drop', dim && 'is-cancelled')} style={style} role="listitem">
      {children}
      {mark ? <span className={cx('tp-pl__mark', markCls)}>{mark}</span> : null}
    </div>
  );
}

function EatenCard({ c, names, width, animate: animateProp, reduced, pos }: { c: PlateCardView; names: NameBook; width: number; animate: boolean; reduced: boolean; pos: { x: number; y: number; rot: number } }) {
  // Only the value at mount matters: later renders must not cancel the flip.
  const [animate] = useState(animateProp);
  const [up, setUp] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => setUp(true), reduced ? 0 : 380);
    return () => clearTimeout(t);
  }, [animate, reduced]);
  const label = `${c.kind === 'akabare' ? 'Akabare' : 'Panipuri'} from ${names.name(c.owner)}${c.cancelled ? ', cancelled by Vinegar' : ''}${c.saved ? ', saved by Dahi' : ''}`;
  return (
    <PlateCard pos={pos} drop={animate && !reduced} dim={c.cancelled} mark={c.cancelled ? 'cancelled' : c.saved ? 'saved' : undefined} markCls={c.saved ? 'is-saved' : undefined}>
      <Card back="puri" color={names.color(c.owner)} face={c.kind} faceUp={up} width={width} badge={names.initial(c.owner)} ariaLabel={label} flipMs={520} state={c.cancelled ? 'dim' : 'idle'} />
    </PlateCard>
  );
}

export function Plate3D({ plate, powers = [], names, width, radius, reduced }: { plate: PlateCardView[]; powers?: PlatePower[]; names: NameBook; width: number; radius: number; reduced: boolean }) {
  // Cards beyond what was on the plate at the last render are new: they drop in.
  const seen = useRef(plate.length);
  const prev = seen.current;
  useEffect(() => {
    seen.current = plate.length;
  }, [plate.length]);
  const from = plate.length < prev ? 0 : prev;
  const n = plate.length + powers.length;
  return (
    <div className="tp-pl" role="list" aria-label={`The plate: ${plate.length} card${plate.length === 1 ? '' : 's'} eaten`}>
      {plate.map((c, i) => (
        <EatenCard key={i} c={c} names={names} width={width} animate={i >= from && plate.length >= prev} reduced={reduced} pos={platePos(i, n, radius)} />
      ))}
      {powers.map((p, j) => {
        const faded = p.effect === 'wasted' || p.effect === 'failedSave';
        return (
          <PlateCard key={`p${j}`} pos={platePos(plate.length + j, n, radius)} drop={false} dim={faded} mark={powerName(p.kind)} markCls="is-power">
            <Card back="power" color={names.color(p.owner)} face={p.kind} faceUp width={width} badge={names.initial(p.owner)} state={faded ? 'dim' : 'idle'} ariaLabel={`${names.Whose(p.owner)} ${powerName(p.kind)}: ${EFFECT_TEXT[p.effect]}`} />
          </PlateCard>
        );
      })}
    </div>
  );
}
