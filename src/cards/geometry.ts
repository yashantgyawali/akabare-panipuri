/**
 * Card geometry measured from the 750×1050 v0.6 print sheets (px @ 300 dpi,
 * 63×88 mm poker size). Use these to rebuild fronts in HTML/CSS and to keep
 * the SVG backs' double border identical to the fronts'. All values are in the
 * 750×1050 card coordinate space; divide by CARD.width for CSS percentages.
 */

export const CARD = { width: 750, height: 1050, aspect: 750 / 1050 } as const;

/**
 * The double cream rounded border. `x/y/w/h` describe the stroke centre-line
 * (SVG <rect> semantics), `r` its corner radius, `stroke` the stroke width.
 * Outer: 8px band spanning 24–31 px from each edge. Inner: 3px line at 38–40.
 */
export const FRAME = {
  outer: { x: 28, y: 28, w: 694, h: 994, r: 29, stroke: 8 },
  inner: { x: 39, y: 39, w: 672, h: 972, r: 31, stroke: 3 },
} as const;

/** The illustration square (exact: first/last art pixel, inclusive of the deckled paper edge). */
export const ART_BOX = { x: 65, y: 145, w: 620, h: 620 } as const;

/** Title line: all-caps, centred; cap top y≈82, baseline y≈124 (cap height 42, ≈58px bold sans). */
export const TITLE = { cx: 375, capTop: 82, baseline: 124, capHeight: 42 } as const;

/** The empty lower third available for rule text (between art and index circle / inner border). */
export const RULE_BOX = { x: 70, y: 782, w: 560, h: 200 } as const;

/** Index circle at the bottom-right: centre, stroke-centre radius, stroke width; numeral ≈ 20px regular. */
export const INDEX_CIRCLE = { cx: 679, cy: 959, r: 28, stroke: 3 } as const;
