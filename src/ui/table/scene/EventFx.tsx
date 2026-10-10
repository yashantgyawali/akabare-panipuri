/**
 * Event spotlight: makes a placed card and a bid impossible to miss.
 *  - EventBanner: a plaque saying who did what, big, for as long as that move is the current one.
 *  - EventTrail: an animated arrow from the player to the stack they placed on (or a bubble over a bidder).
 *  - BidDisc: the current high bid painted on the brass plate.
 * Screen-space / presentation only (aria-hidden): the announcer already reads each move.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { GameEvent, PlayerId } from '../../../engine/types.ts';
import { PLAYER_PALETTE } from '../../../cards/index.ts';
import type { NameBook } from '../../text.ts';

export type FxEvent = Extract<GameEvent, { type: 'place' | 'bidStart' | 'raise' | 'pass' }>;

export function fxEvent(e: GameEvent | null): FxEvent | null {
  return e && (e.type === 'place' || e.type === 'bidStart' || e.type === 'raise' || e.type === 'pass') ? e : null;
}

const colorVar = (names: NameBook, id: PlayerId) => ({ ['--c' as string]: PLAYER_PALETTE[names.color(id)].base }) as CSSProperties;

export function EventBanner({ e, names }: { e: FxEvent; names: NameBook }) {
  const who = names.who(e.playerId);
  let body;
  if (e.type === 'place') {
    const own = e.onStackOf === e.playerId;
    const target = own ? (e.playerId === names.you ? 'your own stack' : 'their own stack') : `${names.whose(e.onStackOf)} stack`;
    body = (
      <>
        <b>{who}</b> put a card on <b>{target}</b>
      </>
    );
  } else if (e.type === 'bidStart') {
    body = (
      <>
        <b>{who}</b> opened the bid at <em>{e.amount}</em>
      </>
    );
  } else if (e.type === 'raise') {
    body = (
      <>
        <b>{who}</b> raised to <em>{e.amount}</em>
      </>
    );
  } else {
    body = (
      <>
        <b>{who}</b> passed
      </>
    );
  }
  return (
    <div className="tp-fx-banner" key={e.seq} style={colorVar(names, e.playerId)} aria-hidden="true">
      <span className="tp-fx-banner__avatar">{names.initial(e.playerId)}</span>
      <span className="tp-fx-banner__text">{body}</span>
    </div>
  );
}

interface Geo {
  from: { x: number; y: number } | null;
  to: { x: number; y: number; rx: number; ry: number } | null;
}

export function EventTrail({ e, names }: { e: FxEvent; names: NameBook }) {
  const ref = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const rel = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, rx: Math.max(34, r.width / 2 + 12), ry: Math.max(26, r.height / 2 + 12) };
    };
    const seat = rel(document.querySelector(`[data-seat="${CSS.escape(e.playerId)}"] .tp-seat3d__foot`));
    const stack = e.type === 'place' ? rel(document.querySelector(`[data-stack-of="${CSS.escape(e.onStackOf)}"]`)) : null;
    setGeo({ from: seat ? { x: seat.x, y: seat.y } : null, to: stack });
  }, [e]);
  const c = colorVar(names, e.playerId);
  const far = geo?.from && geo.to && Math.hypot(geo.from.x - geo.to.x, geo.from.y - geo.to.y) > 70;
  const bubble = e.type === 'place' ? null : e.type === 'pass' ? 'Pass' : e.type === 'bidStart' ? `Opens at ${e.amount}` : `Raises to ${e.amount}`;
  return (
    <div className="tp-fx" key={e.seq} ref={ref} style={c} aria-hidden="true">
      {geo ? (
        <svg className="tp-fx__svg" width="100%" height="100%">
          <defs>
            <marker id={`fxa${e.seq}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10z" fill="var(--c)" />
            </marker>
          </defs>
          {far && geo.from && geo.to ? (
            <path
              className="tp-fx__arrow"
              d={`M${geo.from.x} ${geo.from.y} Q${(geo.from.x + geo.to.x) / 2} ${Math.min(geo.from.y, geo.to.y) - 70} ${geo.to.x} ${geo.to.y}`}
              markerEnd={`url(#fxa${e.seq})`}
              fill="none"
            />
          ) : null}
          {geo.to ? <ellipse className="tp-fx__ring" cx={geo.to.x} cy={geo.to.y} rx={geo.to.rx} ry={geo.to.ry} fill="none" /> : null}
        </svg>
      ) : null}
      {geo?.from && bubble ? (
        <div className="tp-fx__bubble" style={{ left: geo.from.x, top: geo.from.y }}>
          {bubble}
        </div>
      ) : null}
    </div>
  );
}

/** The current high bid, painted on the brass plate in the middle of the table. */
export function BidDisc({ amount, by, color }: { amount: number; by: string; color: string }) {
  return (
    <div className="tp-bid3d" key={`${amount}:${by}`} style={{ ['--c' as string]: color } as CSSProperties}>
      <small>high bid</small>
      <b>{amount}</b>
      <small>{by}</small>
    </div>
  );
}
