/**
 * The 3D room: dark tavern, one lamp, a round table seen from behind the
 * viewer's seat. The table is a set of discs in a plane tilted with rotateX;
 * `children(stage)` renders the seats and the plate INSIDE that plane (they
 * are positioned in table-radius units, see geometry.ts).
 */
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../../common/hooks.ts';
import { useStage, type Stage } from './useStage.ts';

const SIDE_LAYERS = 11;

export function TableScene({
  children,
  lamp,
  flash,
  overlay,
  className,
}: {
  children: (stage: Stage) => ReactNode;
  /** Screen-space content on top of the scene (ticker, tally board). */
  overlay?: ReactNode;
  /** Where the lamp leans (table radii, plane coordinates); null = centred. */
  lamp?: { x: number; y: number } | null;
  /** Brief red tint of the light (bite, bust). */
  flash?: boolean;
  className?: string;
}) {
  const [ref, stage] = useStage();
  const { D, params } = stage;
  const style = {
    '--D': `${D}px`,
    '--R': `${D / 2}px`,
    '--cy': `${stage.cy}px`,
    '--tilt': `${params.tilt}deg`,
    '--persp': `${params.perspective}px`,
    '--lamp-x': `${(lamp?.x ?? 0) * 0.35}`,
    '--lamp-y': `${(lamp?.y ?? 0) * 0.35}`,
  } as CSSProperties;
  return (
    <div ref={ref} className={cx('tp-room', flash && 'is-flash', className)} style={style}>
      <div className="tp-room__glow" aria-hidden="true" />
      {D > 0 ? (
        <div className="tp-world">
          <div className="tp-table" aria-hidden="true">
            <div className="tp-table__floor" />
            {Array.from({ length: SIDE_LAYERS }, (_, i) => (
              <div key={i} className="tp-table__side" style={{ transform: `translateZ(${-(i + 1) * 3}px)`, background: `hsl(26 52% ${26 - i * 1.6}%)` }} />
            ))}
            <div className="tp-table__top" />
            <div className="tp-table__inset" />
            <div className="tp-table__pool" />
            <div className="tp-table__brass" />
          </div>
          {children(stage)}
        </div>
      ) : null}
      <div className="tp-room__vignette" aria-hidden="true" />
      {overlay ? <div className="tp-room__overlay">{overlay}</div> : null}
    </div>
  );
}
