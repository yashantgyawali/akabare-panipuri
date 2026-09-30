# Card backs: toolkit and constraints

This file covers the toolkit for designing the two card backs. The design brief is in
`docs/ARCHITECTURE.md` under "Card art brief". Record the design itself (motifs and
rationale) in a new section at the end of this file.

## Direction from the user

- The current backs (`source_assets/print_sheets/player*_back.png`) "need a lot of work".
- **"Power cards will have a different colored back as well."** The power back has its
  own colour treatment, not just a different emblem on the same owner-colour field. It
  must still read as the owner's (a player's power sits face down beside their stack).
  The brief suggests inverting the balance: a cream/parchment field with owner-colour
  lattice and medallion. Puri vs power must be obvious at **44px wide**.
- The puri back is identical for Panipuri and Akabare (it's the bluff surface), and the
  owner colour dominates it.

## Building blocks (all in `src/cards/`, framework-free, importable from Node and Vite)

| Module | What it gives you |
|---|---|
| `palette.ts` | `PLAYER_PALETTE[color]` → `{ name, base, deep, darker, light, ink, onBase }`, plus `CREAM #F5E8CA`, `CREAM_BRIGHT #F9EFD3`, `PAPER #EEE1C9`, `INK #3A2418`, `INK_SOFT`, `GOLD #D99A22` (turmeric), `CHILI #C8321A` (akabare), `LEAF`, `PURI_GOLD {light, mid, deep}`, and the OKLCH helpers `hexToOklch`, `oklchToHex`, `mixOklab`, `adjustOklch`, `withAlpha`, `contrastRatio`. Each `base` is the exact frame fill sampled from the print sheets. |
| `geometry.ts` | Measured print-sheet geometry in the 750×1050 space: `FRAME.outer` (8px cream band, r 29) and `FRAME.inner` (3px line, r 31), `ART_BOX` (65,145 620×620), `TITLE`, `RULE_BOX`, `INDEX_CIRCLE`. Reuse the double border so the backs match the fronts. |
| `wordmarks.ts` | HarfBuzz-shaped, outlined Rozha One paths for every string on the cards (`'AKABARE PANIPURI'`, `'अकबरे पानीपुरी'`, `'POWER'`, `'शक्ति'`, the six titles and their Devanagari). `wordmarkSvg(id, { x, y, height, anchor, valign, tracking, maxWidth, fill, stroke, strokeWidth, attrs })` returns one `<path/>`, where `height` is the cap height in output units. `wordmarkMetrics()` is for layout. Tracking spaces Latin letters, and only whole words for Devanagari, so the headline never breaks. |
| `content.ts` | `CARD_INFO`, `BACK_COPY` (`puri: AKABARE PANIPURI / अकबरे पानीपुरी`, `power: POWER / शक्ति`). |

Art: `public/art/{panipuri,akabare,vinegar,dahi,khali,chaat}.webp` (620×620). Fonts in
`assets/fonts/` (OFL): Rozha One, Yatra One, Tiro Devanagari Hindi, Mukta 400–800.

## Scripts

```sh
node scripts/render-backs.mjs src/cards/backs.ts print/backs         # 12 SVG+PNG, contact.png, strip-44.png
node scripts/render-backs.mjs src/cards/backs.ts /tmp/x --colors=red,blue   # quick iteration
node scripts/render-backs.mjs src/cards/backs.ts /tmp/x --renderer=resvg    # cross-check a second renderer
node scripts/build-wordmarks.mjs                                     # regenerate wordmarks.ts + print/wordmark-check.png
node scripts/build-wordmarks.mjs --font=yatra --out=/tmp/wm.ts --png=/tmp/wm.png   # try Yatra One
node scripts/extract-art.mjs [--check]                               # re-extract/verify the art squares
node scripts/render-palette.mjs                                      # print/palette-check.png
```

Look at `contact.png` for the overall design, and at `strip-44.png` at 1:1 for the
phone-size puri/power test. That strip shows the 12 backs shuffled, plus fanned stacks
with each owner's power card beside them.

## Constraints for `src/cards/backs.ts`

- Export `puriBackSvg(color: ColorId): string` and `powerBackSvg(color: ColorId): string`.
  Each returns a standalone `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 1050">`.
  The file must use erasable TS only (no enums or namespaces), because Node imports it
  directly.
- Don't use `<text>`. Use `wordmarkSvg()` paths so print PNGs don't depend on installed fonts.
  Don't use external `href`s either: keep everything inline so the SVG works as a data URI.
- The UI may inline several backs in one document. Keep filter, gradient and pattern ids
  unique per colour and kind (for example `pb-red-grain`), or render them via `<img>` or
  CSS `background-image` data URIs. Otherwise the ids collide.
- Painterly texture comes from `feTurbulence`/`feDisplacementMap`/`feColorMatrix`. Check
  both renderers (librsvg is the default, resvg is closer to Chrome). Keep the filter
  region explicit (`x/y/width/height` on `<filter>`) so edges don't clip.
- Heavy filters are slow on phones when many cards are on screen. The UI shows backs at
  about 44–120px wide, so a cheaper variant, or the rendered PNG/WebP, may serve small
  sizes.
