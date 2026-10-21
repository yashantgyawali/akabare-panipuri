/**
 * The live tavern behind the screens before the game. The warm CSS tavern shows
 * at once (and stays when WebGL is missing or fails); the 3D scene loads lazily
 * and fades in over it.
 */
import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { cx, usePhone, useReducedMotion } from '../common/hooks.ts';
import { hasWebGL } from '../table/three/webgl.ts';
import type { Guest } from './TavernCanvas.tsx';

const TavernCanvas = lazy(() => import('./TavernCanvas.tsx'));

export type { Guest };

/** A failed download of the 3D code just leaves the CSS tavern. */
class ChunkBoundary extends Component<{ onFail: (e: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    this.props.onFail(e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function TavernBackdrop({
  mode,
  guests,
  labels,
  slots,
  still = false,
  className,
}: {
  mode: 'orbit' | 'seat';
  guests: Guest[];
  labels?: boolean;
  slots?: number;
  /** Just the warm CSS tavern, no live scene (pages for reading). */
  still?: boolean;
  className?: string;
}) {
  const phone = usePhone();
  const reduced = useReducedMotion();
  // The still backdrop never needs WebGL, so don't even probe for it.
  const [glOk, setGl] = useState(() => !still && hasWebGL());
  const gl = glOk && !still;
  return (
    <div className={cx('tv-backdrop', className)}>
      <div className="tv-backdrop__glow" aria-hidden="true" />
      {gl ? (
        <ChunkBoundary onFail={(e) => (console.warn('[akabare] tavern backdrop could not load:', e), setGl(false))}>
        <Suspense fallback={null}>
          <TavernCanvas
            mode={mode}
            guests={guests}
            phone={phone}
            reduced={reduced}
            labels={labels}
            slots={slots}
            onFail={(why) => {
              console.warn('[akabare] tavern backdrop failed:', why);
              setGl(false);
            }}
          />
        </Suspense>
        </ChunkBoundary>
      ) : null}
      <div className="tv-backdrop__vignette" aria-hidden="true" />
    </div>
  );
}
