/**
 * The plate: every puri the eater has flipped this round, face up, in order,
 * then the power cards flipped. Newly played cards fly in from their stack and
 * flip over; cancelled ones are marked "cancelled by Vinegar", saved Akabare
 * "saved by Dahi".
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlateCardView, PowerEffect, PowerKind, PlayerId } from '../../engine/types.ts';
import { Card } from '../../cards/index.ts';
import { cx } from '../common/hooks.ts';
import { EFFECT_TEXT, powerName, type NameBook } from '../text.ts';

function PlateCard({ c, names, width, animate: animateProp, reduced }: { c: PlateCardView; names: NameBook; width: number; animate: boolean; reduced: boolean }) {
  // Only the value at mount matters: later renders must not cancel the flip.
  const [animate] = useState(animateProp);
  const [up, setUp] = useState(!animate);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!animate || reduced) return;
    const el = ref.current;
    const src = document.querySelector(`[data-stack-of="${CSS.escape(c.fromStackOf)}"]`);
    if (!el || !src || typeof el.animate !== 'function') return;
    const a = src.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + Math.min(a.height, b.height) / 2 - (b.top + b.height / 2);
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(1.05)`, opacity: 0.6 },
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      ],
      { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' },
    );
  }, [animate, reduced, c.fromStackOf]);
  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => setUp(true), reduced ? 0 : 300);
    return () => clearTimeout(t);
  }, [animate, reduced]);
  const who = names.name(c.owner);
  const label = `${c.kind === 'akabare' ? 'Akabare' : 'Panipuri'} from ${who}${c.cancelled ? ', cancelled by Vinegar' : ''}${c.saved ? ', saved by Dahi' : ''}`;
  return (
    <div ref={ref} className={cx('tp-plate__card', c.cancelled && 'is-cancelled', c.saved && 'is-saved')} role="listitem">
      <Card
        back="puri"
        color={names.color(c.owner)}
        face={c.kind}
        faceUp={up}
        width={width}
        badge={names.initial(c.owner)}
        ariaLabel={label}
        flipMs={560}
        state={c.cancelled ? 'dim' : 'idle'}
      />
      {c.cancelled ? <span className="tp-plate__mark">cancelled</span> : null}
      {c.saved ? <span className="tp-plate__mark tp-plate__mark--saved">saved</span> : null}
    </div>
  );
}

export interface PlatePower {
  kind: PowerKind;
  owner: PlayerId;
  effect: PowerEffect;
}

export function Plate({
  plate,
  powers = [],
  names,
  width,
  reduced,
  empty,
}: {
  plate: PlateCardView[];
  powers?: PlatePower[];
  names: NameBook;
  width: number;
  reduced: boolean;
  empty?: string;
}) {
  // Cards beyond what was on the plate at the last render are new: they animate in.
  const seen = useRef(plate.length);
  const prev = seen.current;
  useEffect(() => {
    seen.current = plate.length;
  }, [plate.length]);
  const from = plate.length < prev ? 0 : prev;
  return (
    <div className="tp-plate" role="list" aria-label={`The plate: ${plate.length} card${plate.length === 1 ? '' : 's'} eaten`}>
      {plate.length === 0 && powers.length === 0 ? <p className="tp-plate__empty">{empty ?? 'Nothing eaten yet.'}</p> : null}
      {plate.map((c, i) => (
        <PlateCard key={i} c={c} names={names} width={width} animate={i >= from && plate.length >= prev} reduced={reduced} />
      ))}
      {powers.map((p, i) => {
        const faded = p.effect === 'wasted' || p.effect === 'failedSave';
        return (
          <div key={`p${i}`} className={cx('tp-plate__card', faded && 'is-cancelled')} role="listitem">
            <Card
              back="power"
              color={names.color(p.owner)}
              face={p.kind}
              faceUp
              width={width}
              badge={names.initial(p.owner)}
              state={faded ? 'dim' : 'idle'}
              ariaLabel={`${names.Whose(p.owner)} ${powerName(p.kind)}: ${EFFECT_TEXT[p.effect]}`}
            />
            <span className="tp-plate__mark tp-plate__mark--power">{powerName(p.kind)}</span>
          </div>
        );
      })}
    </div>
  );
}
