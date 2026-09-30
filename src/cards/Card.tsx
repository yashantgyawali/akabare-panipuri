/**
 * Akabare Panipuri — the React card components. The UI draws every card with these.
 *
 *   import { Card, CardStack, CardFront, CardBack, backImageUrl } from '../cards';
 *
 * ─── <Card> ──────────────────────────────────────────────────────────────────────────
 *   back        'puri' | 'power'           REQUIRED. Which back design (puri for Panipuri/Akabare).
 *   color       ColorId                    REQUIRED. Owner colour (drives the back and the front field).
 *   face        FaceKind | null            What the card is, if the viewer knows it. Default null.
 *   faceUp      boolean                    Default !!face. Toggling it plays a 3D flip (rotateY);
 *                                          prefers-reduced-motion gets a short cross-fade instead.
 *                                          faceUp without a face shows the back.
 *   width       number (px)                Default 120. Height is always width × 88/63 (poker size).
 *   showRule    boolean                    Print the rule text in the lower third. Default width >= 150
 *                                          (and CSS hides it below 110 px wide regardless).
 *   peek        FaceKind | null            Owner-only reminder on a FACE-DOWN card: a small chip in the
 *                                          top-right corner with the card's initial (P/A/V/D/K/C) and,
 *                                          from 100 px wide, its mini art. Readable at 56 px.
 *   badge       string                     Owner initial / short name chip in the top-left corner of the
 *                                          back, so ownership is never colour-only. Long names ellipsize.
 *   state       'idle' | 'selectable' | 'selected' | 'danger' | 'dim'   Default 'idle'.
 *                 selectable → turmeric glow (gentle pulse), lifts on hover/focus when clickable
 *                 selected   → cream + gold ring, lifted
 *                 danger     → chili-red ring and glow (e.g. the Akabare bite)
 *                 dim        → darkened and desaturated (unavailable / not your turn)
 *   onClick     (e) => void                Renders a <button type="button"> (keyboard focusable,
 *                                          visible focus ring; aria-pressed for selectable/selected).
 *                                          Without it the card is a <span role="img">.
 *   ariaLabel   string                     Overrides the default label, e.g. "Face-down puri card owned
 *                                          by Red", "Vinegar power card, Blue".
 *   className, style                       Passed to the root element.
 *   instance    number 1–5                 Which Panipuri (the index numeral printed bottom-right).
 *   flipMs      number                     Flip duration, default 650.
 *   onFlipEnd   (faceUp: boolean) => void  Called when a flip animation finishes (event playback pacing).
 *   decorative  boolean                    aria-hidden, no role (for cards inside a labelled control).
 *
 *   Face-down cards of other players: pass face={null}. Only pass `face` for cards the viewer is
 *   allowed to know (their own, or revealed ones) — the front is in the DOM whenever face is set.
 *
 * ─── <CardStack> ─────────────────────────────────────────────────────────────────────
 *   cards       { back, color, badge?, peek?, face?, faceUp?, state?, key? }[]   bottom → top (top last)
 *   width       number (px)                Card width, default 56.
 *   offset      number (px)                Vertical step between cards; default max(17, 0.2 × width),
 *                                          enough to show each lower card's badge + peek strip.
 *   maxHeight   number (px)                Optional: shrink the offset so the whole pile fits.
 *   countFrom   number                     Show the count bubble when cards.length > countFrom (default 4).
 *   state       CardState                  Ring round the whole pile (selectable/selected/danger) or dim.
 *   onClick, ariaLabel, className, style   onClick makes the whole pile one <button>.
 *   An empty pile renders a dashed slot of the same size (still clickable).
 *
 * ─── <CardFront kind color width? showRule? instance? /> and <CardBack kind color width? badge? peek? />
 *   The two faces on their own (no flip). Omit `width` to fill the parent's width (fluid): every
 *   length inside is in container-query units (1 card unit = 100cqw / 750), so a card looks the
 *   same at 56 px and at 360 px. The Devanagari subtitle hides below 80 px wide, the rule below 110.
 *
 * ─── backImageUrl(type, color, hiDpi = false) → string
 *   URL of the pre-rendered back webp (375×525, or 750×1050 with hiDpi), cache-busted with the
 *   export's content hash. <CardBack> uses both through srcset/sizes. Regenerate with
 *   `node scripts/export-backs.mjs` whenever src/cards/backs.ts changes.
 *
 * Also exported: cardHeight(width), CARD_ASPECT, cardName(kind), defaultCardLabel(...).
 * Styles: ./cards.css (plain CSS, every class prefixed `ak-card`). Fonts: the page must load
 * 'Rozha One' (titles, Devanagari) and 'Mukta' 500/700 (rule text, chips) from Google Fonts.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode, TransitionEvent } from 'react';
import type { ColorId, PowerKind, PuriKind } from '../engine/types.ts';
import { CARD_INFO, artUrl, cardIndex } from './content.ts';
import { CREAM_BRIGHT, INK, PLAYER_PALETTE } from './palette.ts';
import { BACK_IMAGE_REV, BACK_IMAGE_SIZES } from './backImages.ts';
import './cards.css';

export type FaceKind = PuriKind | PowerKind;
export type BackKind = 'puri' | 'power';
export type CardState = 'idle' | 'selectable' | 'selected' | 'danger' | 'dim';

/** height / width of every card (63 × 88 mm poker size). */
export const CARD_ASPECT = 88 / 63;
/** Card height in px for a width in px. */
export const cardHeight = (width: number): number => width * CARD_ASPECT;

const ENV = (import.meta as { env?: { BASE_URL?: string; DEV?: boolean } }).env;
const BASE: string = ENV?.BASE_URL ?? '/';
const withBase = (p: string): string => BASE.replace(/\/?$/, '/') + p;

/** URL of a pre-rendered back (public/backs), 375×525 or (hiDpi) 750×1050. */
export function backImageUrl(type: BackKind, color: ColorId, hiDpi = false): string {
  return withBase(`backs/${type}-${color}${hiDpi ? '-2x' : ''}.webp?v=${BACK_IMAGE_REV}`);
}

/** "Khali Puri", "Akabare", … (title-cased CARD_INFO title). */
export function cardName(kind: FaceKind): string {
  return CARD_INFO[kind].title.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** The label <Card> uses when no ariaLabel is given. */
export function defaultCardLabel(o: {
  back: BackKind;
  color: ColorId;
  face?: FaceKind | null;
  faceUp?: boolean;
  peek?: FaceKind | null;
  badge?: string;
}): string {
  const colorName = PLAYER_PALETTE[o.color].name;
  const owner = o.badge && o.badge.trim().length > 1 ? `${o.badge.trim()} (${colorName})` : colorName;
  if (o.face && o.faceUp) {
    const info = CARD_INFO[o.face];
    return `${cardName(o.face)} ${info.family === 'power' ? 'power card' : 'card'}, ${owner}`;
  }
  const peek = o.peek ? `; you know it is ${cardName(o.peek)}` : '';
  return `Face-down ${o.back} card owned by ${owner}${peek}`;
}

const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ');

/** Owner colour + texture custom properties (inherited by both faces and the chips). */
function cardVars(color: ColorId, width?: number): CSSProperties {
  const p = PLAYER_PALETTE[color];
  const vars: Record<string, string> = {
    '--ak-base': p.base,
    '--ak-deep': p.deep,
    '--ak-darker': p.darker,
    '--ak-light': p.light,
    // Rule text: cream on the dark owners, the owner's own ink on yellow / orange (WCAG).
    '--ak-text': p.onBase === INK ? p.ink : CREAM_BRIGHT,
    '--ak-wash': `url("${withBase('art/front-wash.webp')}")`,
    '--ak-grain': `url("${withBase('art/front-grain.webp')}")`,
  };
  if (width !== undefined) vars['--ak-card-w'] = `${width}px`;
  return vars as CSSProperties;
}

const sizeStyle = (width?: number): CSSProperties | undefined =>
  width === undefined ? undefined : { width, height: cardHeight(width) };

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

export interface CardFrontProps {
  kind: FaceKind;
  color: ColorId;
  /** px; omit to fill the parent's width. */
  width?: number;
  /** Default width >= 150 (fluid: true; CSS still hides it below 110 px). */
  showRule?: boolean;
  /** Which Panipuri 1–5 (index numeral). */
  instance?: number;
  /** Accessible name (role img). null = decorative (aria-hidden). Default: "<Name> card". */
  ariaLabel?: string | null;
  className?: string;
  style?: CSSProperties;
}

/** Height of the 750-unit-wide card in card units (88/63 aspect → 1047.62, not 1050). */
const VB_H = 750 * CARD_ASPECT;
const FRAME_SVG = (() => {
  const f = (n: number) => +n.toFixed(2);
  const h = VB_H;
  // Measured on the v0.6 print sheets (src/cards/geometry.ts): 8 px cream band at 24–32 px from
  // each edge, 3 px line at 38–41 px, index circle centred 71 px from the right / 91 px from the
  // bottom edge. Bottom-anchored y values are taken from the (slightly shorter) 88/63 box's bottom.
  return (
    `<rect x="28" y="28" width="694" height="${f(h - 56)}" rx="29" fill="none" stroke="currentColor" stroke-width="8"/>` +
    `<rect x="39.5" y="39.5" width="671" height="${f(h - 79)}" rx="31" fill="none" stroke="currentColor" stroke-width="3"/>` +
    `<circle cx="679" cy="${f(h - 91)}" r="28" fill="none" stroke="currentColor" stroke-width="3"/>`
  );
})();

export function CardFront({ kind, color, width, showRule, instance, ariaLabel, className, style }: CardFrontProps) {
  const info = CARD_INFO[kind];
  const rule = showRule ?? (width === undefined ? true : width >= 150);
  const label = ariaLabel === undefined ? `${cardName(kind)} card` : ariaLabel;
  return (
    <span
      className={cx('ak-card-front', `ak-card-front--${info.family}`, rule && 'ak-card-front--rule', className)}
      style={{ ...cardVars(color, width), ...sizeStyle(width), ...style }}
      data-kind={kind}
      data-color={color}
      {...(label === null ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      <svg className="ak-card-front__frame" viewBox={`0 0 750 ${VB_H.toFixed(2)}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: FRAME_SVG }} />
      <span className="ak-card-front__title">{info.title}</span>
      <span className="ak-card-front__art">
        <img src={artUrl(kind, BASE)} alt="" draggable={false} decoding="async" />
      </span>
      <span className="ak-card-front__lower">
        <span className="ak-card-front__deva" lang="ne">
          {info.devanagari}
        </span>
        {rule && (
          <span className="ak-card-front__rule">
            <span className="ak-card-front__label">{info.label}</span>
            <span className="ak-card-front__body">{info.body}</span>
          </span>
        )}
      </span>
      <span className="ak-card-front__index">{cardIndex(kind, instance)}</span>
    </span>
  );
}

export interface CardBackProps {
  kind: BackKind;
  color: ColorId;
  /** px; omit to fill the parent's width (then pass `sizes` for the best image choice). */
  width?: number;
  badge?: string;
  peek?: FaceKind | null;
  /** <img sizes>, default `${width}px` (fluid: 120px). */
  sizes?: string;
  ariaLabel?: string | null;
  className?: string;
  style?: CSSProperties;
}

/** Owner-only "you know this" chip (top-right corner of a face-down card). */
function Peek({ kind }: { kind: FaceKind }) {
  return (
    <span className={cx('ak-card-peek', `ak-card-peek--${kind}`, `ak-card-peek--${CARD_INFO[kind].family}`)} aria-hidden="true">
      <img className="ak-card-peek__art" src={artUrl(kind, BASE)} alt="" draggable={false} decoding="async" />
      <span className="ak-card-peek__letter">{CARD_INFO[kind].title[0]}</span>
    </span>
  );
}

export function CardBack({ kind, color, width, badge, peek, sizes, ariaLabel, className, style }: CardBackProps) {
  const [w1] = BACK_IMAGE_SIZES.x1;
  const [w2] = BACK_IMAGE_SIZES.x2;
  const label =
    ariaLabel === undefined ? defaultCardLabel({ back: kind, color, peek, badge }) : ariaLabel;
  return (
    <span
      className={cx('ak-card-back', `ak-card-back--${kind}`, className)}
      style={{ ...cardVars(color, width), ...sizeStyle(width), ...style }}
      data-back={kind}
      data-color={color}
      {...(label === null ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      <img
        className="ak-card-back__img"
        src={backImageUrl(kind, color)}
        srcSet={`${backImageUrl(kind, color)} ${w1}w, ${backImageUrl(kind, color, true)} ${w2}w`}
        sizes={sizes ?? (width !== undefined ? `${Math.round(width)}px` : '120px')}
        alt=""
        draggable={false}
        decoding="async"
      />
      {badge ? <span className="ak-card-back__badge">{badge}</span> : null}
      {peek ? <Peek kind={peek} /> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// <Card>
// ---------------------------------------------------------------------------

export interface CardProps {
  back: BackKind;
  color: ColorId;
  face?: FaceKind | null;
  faceUp?: boolean;
  width?: number;
  showRule?: boolean;
  peek?: FaceKind | null;
  badge?: string;
  state?: CardState;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  instance?: number;
  flipMs?: number;
  onFlipEnd?: (faceUp: boolean) => void;
  decorative?: boolean;
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Card({
  back,
  color,
  face = null,
  faceUp: faceUpProp,
  width = 120,
  showRule,
  peek = null,
  badge,
  state = 'idle',
  onClick,
  ariaLabel,
  className,
  style,
  instance,
  flipMs = 650,
  onFlipEnd,
  decorative = false,
}: CardProps) {
  const wantUp = !!face && (faceUpProp ?? true);
  // `shownUp` trails `wantUp` by one commit. When a front mounts together with the flip (a card
  // revealed to everyone: face null → kind and faceUp at once), it is first committed in its
  // face-down pose; the layout effect flushes that style and only then turns the card, so the
  // transition always has a "from" state. No rAF: it must also work in background tabs.
  const [shownUp, setShownUp] = useState(wantUp);
  const rootRef = useRef<HTMLElement | null>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (wantUp === shownUp) return;
    const front = rootRef.current?.querySelector('.ak-card__face--front');
    if (front) void getComputedStyle(front).transform;
    setShownUp(wantUp);
  }, [wantUp, shownUp]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = rootRef.current;
    if (!el || reducedMotion() || typeof el.animate !== 'function') return;
    // Lift off the table while turning (separate `scale` property: composes with state translate).
    el.animate([{ scale: '1' }, { scale: '1.08', offset: 0.45 }, { scale: '1' }], {
      duration: flipMs,
      easing: 'cubic-bezier(.3,.1,.3,1)',
    });
  }, [shownUp, flipMs]);

  if (ENV?.DEV && face && CARD_INFO[face].family !== back) {
    console.warn(`<Card>: face "${face}" is a ${CARD_INFO[face].family} card but back="${back}"`);
  }

  const onTransitionEnd = (e: TransitionEvent<HTMLElement>) => {
    // (the state ring's ::after opacity transition also bubbles here: skip pseudo-elements)
    if (!e.pseudoElement && (e.propertyName === 'transform' || e.propertyName === 'opacity')) {
      if ((e.target as HTMLElement).classList.contains('ak-card__face--front')) onFlipEnd?.(shownUp);
    }
  };

  const label = ariaLabel ?? defaultCardLabel({ back, color, face, faceUp: shownUp, peek, badge });
  const cls = cx(
    'ak-card',
    `ak-card--${state}`,
    shownUp && 'ak-card--up',
    onClick && 'ak-card--button',
    className,
  );
  const rootStyle: CSSProperties = {
    ...cardVars(color, width),
    ...({ '--ak-card-flip-ms': `${flipMs}ms` } as CSSProperties),
    width,
    height: cardHeight(width),
    perspective: `${Math.round(width * 4)}px`,
    ...style,
  };
  const faces: ReactNode = (
    <>
      {face ? (
        <CardFront
          kind={face}
          color={color}
          showRule={showRule ?? width >= 150}
          instance={instance}
          ariaLabel={null}
          className="ak-card__face ak-card__face--front"
        />
      ) : null}
      <CardBack
        kind={back}
        color={color}
        badge={badge}
        peek={peek}
        sizes={`${Math.round(width)}px`}
        ariaLabel={null}
        className="ak-card__face ak-card__face--back"
      />
    </>
  );

  if (onClick) {
    return (
      <button
        ref={(el) => {
          rootRef.current = el;
        }}
        type="button"
        className={cls}
        style={rootStyle}
        onClick={onClick}
        onTransitionEnd={onTransitionEnd}
        aria-label={decorative ? undefined : label}
        aria-hidden={decorative || undefined}
        tabIndex={decorative ? -1 : undefined}
        aria-pressed={state === 'selected' ? true : state === 'selectable' ? false : undefined}
        data-color={color}
        data-back={back}
      >
        {faces}
      </button>
    );
  }
  return (
    <span
      ref={(el) => {
        rootRef.current = el;
      }}
      className={cls}
      style={rootStyle}
      onTransitionEnd={onTransitionEnd}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      data-color={color}
      data-back={back}
    >
      {faces}
    </span>
  );
}

// ---------------------------------------------------------------------------
// <CardStack>
// ---------------------------------------------------------------------------

export interface CardStackItem {
  back: BackKind;
  color: ColorId;
  badge?: string;
  peek?: FaceKind | null;
  face?: FaceKind | null;
  faceUp?: boolean;
  state?: CardState;
  /** React key (defaults to the index). */
  key?: string | number;
}

export interface CardStackProps {
  /** Bottom → top: the top card is LAST and drawn on top. */
  cards: readonly CardStackItem[];
  width?: number;
  offset?: number;
  maxHeight?: number;
  countFrom?: number;
  state?: CardState;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

export function CardStack({
  cards,
  width = 56,
  offset,
  maxHeight,
  countFrom = 4,
  state = 'idle',
  onClick,
  ariaLabel,
  className,
  style,
}: CardStackProps) {
  const n = cards.length;
  const h = cardHeight(width);
  // default: the top strip of each lower card shows its badge + peek chips in full
  let step = offset ?? Math.max(17, Math.round(width * 0.2));
  if (maxHeight !== undefined && n > 1) step = Math.max(2, Math.min(step, (maxHeight - h) / (n - 1)));
  const total = n > 0 ? h + step * (n - 1) : h;
  const top = cards[n - 1];
  const label =
    ariaLabel ??
    (n === 0
      ? 'Empty stack'
      : `Stack of ${n} card${n === 1 ? '' : 's'}, top card owned by ${PLAYER_PALETTE[top.color].name}${top.badge && top.badge.length > 1 ? ` (${top.badge})` : ''}`);
  const cls = cx('ak-card-stack', `ak-card-stack--${state}`, onClick && 'ak-card-stack--button', n === 0 && 'ak-card-stack--empty', className);
  const rootStyle: CSSProperties = {
    ...({ '--ak-card-w': `${width}px` } as CSSProperties),
    width,
    height: total,
    ...style,
  };
  const body = (
    <>
      {n === 0 ? <span className="ak-card-stack__slot" style={{ height: h }} /> : null}
      {cards.map((c, i) => (
        <Card
          key={c.key ?? i}
          back={c.back}
          color={c.color}
          face={c.face}
          faceUp={c.faceUp}
          badge={c.badge}
          peek={c.peek}
          state={c.state ?? (state === 'dim' ? 'dim' : 'idle')}
          width={width}
          decorative
          className="ak-card-stack__card"
          style={{ position: 'absolute', left: 0, top: i * step }}
        />
      ))}
      {n > countFrom ? (
        <span className="ak-card-stack__count" aria-hidden="true">
          {n}
        </span>
      ) : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} style={rootStyle} onClick={onClick} aria-label={label}>
        {body}
      </button>
    );
  }
  return (
    <span className={cls} style={rootStyle} role="img" aria-label={label}>
      {body}
    </span>
  );
}
