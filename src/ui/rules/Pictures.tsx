/**
 * Small pictures for the rules: stacks of upside-down bowls, open bowls, power
 * cards, speech bubbles, arrows and score chips, plus the mini table used by
 * each panel of the worked example. They read on the dark tavern page and on
 * the light in-game drawer alike (colours come from CSS variables, see rules.css).
 */
import type { CSSProperties, ReactNode } from 'react';
import type { ColorId, PowerKind, PuriKind } from '../../engine/types.ts';
import { Card } from '../../cards/index.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import { BowlIcon } from '../common/BowlIcon.tsx';
import { cx } from '../common/hooks.ts';
import { CAST, SEATS, type ExBowl, type ExPanel } from './data.ts';

export interface StackBowl {
  color: ColorId;
  /** What's inside, shown as a lettered chip only when `inside` is set on the stack. */
  kind?: PuriKind;
  fresh?: boolean;
}

/**
 * What's inside a covered bowl, for the reader: a bold chip on the dome ("A" on
 * dark red for an Akabare, "P" on dark brown for a Panipuri). Larger and higher
 * contrast than BowlIcon's own peek letter, which is too small to read in the
 * example's stacks.
 */
function Inside({ kind }: { kind: PuriKind }) {
  return (
    <span className={cx('rp-inside', kind === 'akabare' ? 'rp-inside--hot' : 'rp-inside--puri')} aria-hidden="true">
      {kind === 'akabare' ? 'A' : 'P'}
    </span>
  );
}

/** A stack of upside-down bowls, bottom -> top (the top bowl is drawn last, highest). */
export function Stack({
  bowls,
  size = 48,
  step = 0.42,
  inside = false,
  label,
  className,
}: {
  bowls: StackBowl[];
  size?: number;
  /** How far each bowl sits above the one under it, as a share of `size`. */
  step?: number;
  /** Show what's inside each bowl (a lettered chip on the dome): for the owner, or the reader of an example. */
  inside?: boolean;
  /** Accessible name; without it the picture is decorative. */
  label?: string;
  className?: string;
}) {
  const style = { '--s': `${size}px`, '--step': step } as CSSProperties;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <span className={cx('rp-stack', className)} style={style} {...a11y}>
      {bowls.length === 0 ? (
        <span className="rp-stack__empty" />
      ) : (
        bowls.map((b, i) => (
          <span key={i} className={cx('rp-stack__bowl', b.fresh && 'is-fresh')}>
            <BowlIcon up={false} color={b.color} size={size} />
            {inside && b.kind ? <Inside kind={b.kind} /> : null}
          </span>
        ))
      )}
    </span>
  );
}

/** One open bowl, showing its puri. */
export function OpenBowl({ kind, color, size = 48, title }: { kind: PuriKind; color: ColorId; size?: number; title?: string }) {
  return <BowlIcon up kind={kind} color={color} size={size} title={title} />;
}

/** A power card, face down (no kind) or face up. */
export function Power({ kind, color, width = 56 }: { kind?: PowerKind | null; color: ColorId; width?: number }) {
  return kind ? (
    <Card back="power" color={color} face={kind} faceUp width={width} decorative />
  ) : (
    <Card back="power" color={color} width={width} decorative />
  );
}

/** Speech bubble ("3", "Pass"). */
export function Say({ children, color, className }: { children: ReactNode; color?: ColorId; className?: string }) {
  const style = color ? ({ '--who': PLAYER_PALETTE[color].base } as CSSProperties) : undefined;
  return (
    <span className={cx('rp-say', color && 'rp-say--who', className)} style={style}>
      {children}
    </span>
  );
}

/** A plain arrow (decorative). */
export function Arrow({ dir = 'right', size = 28, className }: { dir?: 'right' | 'down' | 'left'; size?: number; className?: string }) {
  const rot = dir === 'down' ? 90 : dir === 'left' ? 180 : 0;
  return (
    <svg className={cx('rp-arrow', className)} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M3 12h15M12 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "+4", "−4", "+2". */
export function Delta({ value, className }: { value: string; className?: string }) {
  const bad = value.startsWith('−') || value.startsWith('-');
  return <span className={cx('rp-delta', bad ? 'rp-delta--bad' : 'rp-delta--good', className)}>{value}</span>;
}

/** A name with the owner's colour dot (so ownership is never colour-only). */
export function Who({ name, color, className }: { name: string; color: ColorId; className?: string }) {
  return (
    <span className={cx('rp-who', className)}>
      <span className="rp-who__dot" style={{ background: PLAYER_PALETTE[color].base }} aria-hidden="true" />
      {name}
    </span>
  );
}

const exColor = (b: ExBowl): StackBowl => ({ color: CAST[b.owner].color, kind: b.kind, fresh: b.fresh });

/** One panel of the worked example: three seats (bubble or incoming bowl, stack, power card, name), and the eater's plate. */
export function MiniTable({ panel, size = 34 }: { panel: ExPanel; size?: number }) {
  const seats = SEATS.map((id) => panel.seats[id]);
  const over = seats.some((seat) => seat.incoming || seat.says);
  const tallest = Math.max(1, ...seats.map((seat) => seat.stack.length));
  const style = { '--s': `${size}px`, '--rows': tallest - 1 } as CSSProperties;
  return (
    <div className={cx('rp-mini', !over && 'rp-mini--flat')} role="img" aria-label={panel.alt} style={style}>
      <div className="rp-mini__seats">
        {SEATS.map((id) => {
          const seat = panel.seats[id];
          const who = CAST[id];
          return (
            <div key={id} className="rp-mini__seat">
              <div className="rp-mini__over">
                {seat.incoming ? (
                  <span className="rp-mini__incoming">
                    <Stack bowls={[{ ...exColor(seat.incoming), fresh: true }]} size={size} inside />
                    <Arrow dir="down" size={Math.round(size * 0.5)} />
                  </span>
                ) : seat.says ? (
                  <Say color={who.color}>{seat.says}</Say>
                ) : null}
              </div>
              <div className="rp-mini__stack">
                <Stack bowls={seat.stack.map(exColor)} size={size} step={0.44} inside />
              </div>
              <div className="rp-mini__foot">
                <Power kind={seat.power ?? null} color={who.color} width={Math.round(size * 0.8)} />
                <Who name={who.name} color={who.color} />
                {seat.delta ? <Delta value={seat.delta} /> : null}
              </div>
            </div>
          );
        })}
      </div>
      {panel.plate ? (
        <div className="rp-mini__plate">
          <span className="rp-mini__platelabel">Asha ate</span>
          <span className="rp-mini__bowls">
            {panel.plate.map((b, i) => (
              <OpenBowl key={i} kind={b.kind} color={CAST[b.owner].color} size={size} />
            ))}
          </span>
          {panel.tally ? <span className={cx('rp-mini__tally', panel.tally === 'Bitten' && 'is-bad')}>{panel.tally}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
