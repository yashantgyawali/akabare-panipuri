/**
 * The plate: every puri the eater has flipped this round, face up, in order.
 * Newly played cards fly in from their stack and flip over; cancelled ones are
 * stamped "cancelled by Vinegar", saved Akabare "saved by Dahi".
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlateCardView } from '../../engine/types.ts';
import { Card } from '../../cards/index.ts';
import { cx } from '../common/hooks.ts';
import type { NameBook } from '../text.ts';

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
    <div ref={ref} className={cx('ak-plate__card', c.cancelled && 'ak-plate__card--cancelled', c.saved && 'ak-plate__card--saved', c.kind === 'akabare' && !c.cancelled && !c.saved && 'ak-plate__card--hot')} role="listitem">
      <Card
        back="puri"
        color={names.color(c.owner)}
        face={c.kind}
        faceUp={up}
        width={width}
        badge={names.initial(c.owner)}
        ariaLabel={label}
        flipMs={560}
        state={c.kind === 'akabare' && !c.cancelled && !c.saved ? 'danger' : 'idle'}
      />
      {c.cancelled ? <span className="ak-stamp ak-stamp--vinegar">cancelled by Vinegar</span> : null}
      {c.saved ? <span className="ak-stamp ak-stamp--dahi">saved by Dahi</span> : null}
    </div>
  );
}

export function Plate({ plate, names, width, reduced, empty }: { plate: PlateCardView[]; names: NameBook; width: number; reduced: boolean; empty?: string }) {
  // Cards beyond what was on the plate at the last render are new: they animate in.
  const seen = useRef(plate.length);
  const prev = seen.current;
  useEffect(() => {
    seen.current = plate.length;
  }, [plate.length]);
  const from = plate.length < prev ? 0 : prev;
  return (
    <div className="ak-plate" aria-label={`The plate: ${plate.length} card${plate.length === 1 ? '' : 's'} eaten`}>
      <div className="ak-plate__rim" role="list" style={{ ['--w' as string]: `${width}px` }}>
        {plate.length === 0 ? <p className="ak-plate__empty">{empty ?? 'Nothing eaten yet'}</p> : null}
        {plate.map((c, i) => (
          <PlateCard key={i} c={c} names={names} width={width} animate={i >= from && plate.length >= prev} reduced={reduced} />
        ))}
      </div>
    </div>
  );
}
