import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { paramsFor, tableFit, type SceneParams } from './geometry.ts';

export interface Stage {
  w: number;
  h: number;
  /** Table diameter in px. */
  D: number;
  /** Table centre, px from the stage top. */
  cy: number;
  params: SceneParams;
  phone: boolean;
}

const EMPTY: Stage = { w: 0, h: 0, D: 0, cy: 0, params: paramsFor(1280), phone: false };

/** Measures the stage element and derives the table size from it (re-measured on resize). */
export function useStage(): [RefObject<HTMLDivElement | null>, Stage] {
  const ref = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>(EMPTY);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const params = paramsFor(window.innerWidth);
      const fit = tableFit(w, h, params);
      const next: Stage = { w, h, D: fit.D, cy: fit.cy, params: { ...params, tilt: fit.tilt }, phone: window.innerWidth <= 640 };
      setStage((s) => (s.w === w && s.h === h && s.params.tilt === next.params.tilt && s.D === next.D && s.cy === next.cy ? s : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, stage];
}

/** Card width (px) for the loose piles, by table size and seat count. */
export function pileCardWidth(D: number, n: number, phone: boolean): number {
  const f = phone ? (n <= 4 ? 0.105 : 0.092) : n <= 4 ? 0.1 : 0.088;
  return Math.max(phone ? 34 : 44, Math.min(phone ? 46 : 86, Math.round(D * f)));
}

/**
 * Publishes the header and dock heights as --head-h / --dock-h on `root`, so
 * the (phone) stage can be exactly the visible area between them.
 */
export function useChromeHeights(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const head = el.querySelector<HTMLElement>('.tp-thead');
    const dock = el.querySelector<HTMLElement>('.tp-dock');
    const set = () => {
      el.style.setProperty('--head-h', `${head?.offsetHeight ?? 0}px`);
      el.style.setProperty('--dock-h', `${dock?.offsetHeight ?? 0}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    if (head) ro.observe(head);
    if (dock) ro.observe(dock);
    return () => ro.disconnect();
  });
}
