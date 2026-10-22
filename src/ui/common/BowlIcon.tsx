/**
 * A puri in its areca-leaf bowl, drawn flat (SVG): the same look as the 3D
 * bowls at the table, for the rules, the setup slots and anywhere else in the
 * UI. Upside down (`up={false}`) it is a dome with the owner's colour on the
 * base, hiding what's inside; open (`up`) it shows the puri printed inside (the
 * card art: the Panipuri's green puri, or the Akabare's red chili), just like
 * the bowls on the 3D table.
 *
 * Hidden information: pass `kind` only for a bowl the viewer may see into.
 */
import { useId } from 'react';
import type { ColorId, PuriKind } from '../../engine/types.ts';
import { PLAYER_PALETTE, artUrl } from '../../cards/index.ts';

const LEAF = '#d9b98a';
const LEAF_DARK = '#b8925f';
const LEAF_LINE = '#a87f4c';
const CHILI = '#c8321a';

export function BowlIcon({
  kind = null,
  up = true,
  color,
  size = 48,
  title,
  peek = null,
}: {
  kind?: PuriKind | null;
  /** true: open, showing the puri; false: upside down (covered). */
  up?: boolean;
  /** Owner colour (the stamp on the base, and the rim band). */
  color?: ColorId;
  size?: number;
  /** Accessible name; without it the icon is decorative. */
  title?: string;
  /** Your own covered bowl: a small reminder letter on the base. */
  peek?: PuriKind | null;
}) {
  const own = color ? PLAYER_PALETTE[color].base : LEAF_DARK;
  // A plain id (no colons) so it works in url(#...) everywhere, server rendering included.
  const clip = `bowl${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" {...a11y}>
      {up ? (
        <>
          {/* the bowl, open, seen a little from above: the puri is a print inside */}
          <defs>
            <clipPath id={clip}>
              <ellipse cx="24" cy="21" rx="17" ry="11" />
            </clipPath>
          </defs>
          <path d="M3 21 Q5 41 24 42 Q43 41 45 21 Z" fill={LEAF} stroke={LEAF_LINE} strokeWidth="1.2" />
          <path d="M10 32 Q24 39 38 32" fill="none" stroke={LEAF_LINE} strokeWidth="0.8" opacity="0.6" />
          <ellipse cx="24" cy="21" rx="21" ry="13" fill={LEAF} stroke={LEAF_LINE} strokeWidth="1.2" />
          <ellipse cx="24" cy="21" rx="21" ry="13" fill="none" stroke={own} strokeWidth="2" />
          <ellipse cx="24" cy="21" rx="17" ry="11" fill={kind ? '#f5e8ca' : LEAF_DARK} />
          {kind ? (
            <image
              href={artUrl(kind, import.meta.env.BASE_URL)}
              x="7"
              y="10"
              width="34"
              height="22"
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${clip})`}
            />
          ) : null}
        </>
      ) : (
        <>
          {/* the bowl, upside down: a dome hiding the puri */}
          <path d="M4 38 Q4 14 24 13 Q44 14 44 38 Z" fill={LEAF} stroke={LEAF_LINE} strokeWidth="1.2" />
          <path d="M11 34 Q12 21 24 19 M37 34 Q36 21 24 19" fill="none" stroke={LEAF_LINE} strokeWidth="0.8" opacity="0.6" />
          <ellipse cx="24" cy="38" rx="20" ry="3.5" fill={LEAF_DARK} />
          <path d="M4 37 h40" stroke={own} strokeWidth="2.4" />
          {/* the base (now on top), stamped in the owner's colour */}
          <ellipse cx="24" cy="14.5" rx="8" ry="2.6" fill={own} stroke={LEAF_LINE} strokeWidth="0.8" />
          {peek ? (
            <text x="24" y="28" textAnchor="middle" fontFamily="Mukta, sans-serif" fontWeight="800" fontSize="11" fill={peek === 'akabare' ? CHILI : '#3a2418'}>
              {peek === 'akabare' ? 'A' : 'P'}
            </text>
          ) : null}
        </>
      )}
    </svg>
  );
}
