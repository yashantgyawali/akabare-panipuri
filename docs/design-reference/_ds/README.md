# Tumlet Design System

> *Two silly friends on a mission to bring more play into the lives of Nepali young adults.*

This is the design system for **Tumlet** — a Nepali board-game company founded by Yashant & Sarina. It powers tumlet.com and all game-specific materials: Bluff Momo, Ganthan, Bichitra, Farak, Thug.

The system is built to feel like the games themselves: **warm, hand-made, a little wonky, proudly Nepali**. Everything leans into nostalgia and street-level playfulness. If it feels too corporate, it's wrong.

---

## CONTENT FOUNDATIONS

### Brand voice

- **Talk like a friend in Thamel, not a brand manager.** First-person plural ("we're Tumlet"), lowercase starts are fine, em-dashes and "heyyyyy" and exclamations are fine.
- **Bilingual is a feature, not a bug.** Nepali devanagari (हन्ते, चोर, मन्त्री) sits next to English without italics or parentheticals. Never "translate in brackets."
- **Mission first.** Every long-form piece touches: *play, connection, Nepali young adults, nostalgia*. "Spreading playfulness" is the phrase of record.
- **Never sell. Always invite.** "DM us to order" > "Buy now." "Learn who we are" > "About us." Commerce is incidental to the game night.

### Writing rules

- Numbers stay numeric (2–6 players, 11 minutes, age 13+) — short, scannable.
- Product names capitalized but the word before them isn't: "play Bluff Momo," not "Play BLUFF MOMO."
- Game mechanics keep original Nepali character names (हन्ते, चोर, भट्टीको दाई, आमा, मन्त्री). Never romanize in primary material.
- Prices in NPR: "Rs. 1490" (space after Rs., no decimals).
- Contact tail: `9851312103 | tumletgames@gmail.com | www.tumlet.com`.
- Signature close: "— Sarina Pantha & Yashant Gyawali" (both names, always in that order on official letters).

### Content types

| Type | Uses |
|---|---|
| **Hero blurb** | 1–2 sentences, sets the game's world. "Bluff momo is a card game based in the street of kathmandu…" |
| **Meta triad** | players / age / time, always in that order, always with icons. |
| **Character line** | Nepali name — action — blocks. Kept as table, never prose. |
| **CTA** | Verb + channel. "DM us to order", "Try Ganthan now", "Spark connection". |
| **Founder's note** | Long, warm, un-slick. Signs off with both names. |

---

## VISUAL FOUNDATIONS

### The three primaries

Everything starts here. 90% of any composition is these three.

- **Tumlet Red `#F16147`** — the momo chilli. CTAs, accents, the Bluff Momo hero.
- **Tumlet Yellow `#F3B952`** — the dalle. Backdrops, hard shadows, tags.
- **Tumlet Beige `#FAF1E4`** — the plate. Default page background. Never pure white except on the logo lockup.

Ink is `#130D01` (warm near-black). Borders and character cards use a warm brown `#5A3A1F`.

### Signature motifs

1. **Hard offset shadows, never blurred.** `8px 8px 0 0` of a color from the palette. This is the most recognizable Tumlet tell.
2. **-0.88° rotation on CTAs.** Every primary button is nudged off-kilter. Don't straighten it.
3. **Border-2 around everything that's a card.** Warm brown on beige, or red on yellow.
4. **Bilingual type mixing.** Devanagari and Latin sitting side by side at matched optical size.
5. **The two T's.** Tumlet's wordmark opens with a red T and a yellow T overlapping — quote this in signature moments.

### Type

- **Baloo 2** — rounded, friendly, Nepali-script-compatible. Body, UI, captions.
- **Outfit** — clean geometric sans. Display headlines, prices, stat numbers.
- **Caveat** — handwritten accent only. Eyebrows, annotations, scribbles on flyers. Never body.

Default line-height is **150%** site-wide. Enforced in `tokens.css`.

### Shape & density

- Cards have **8–12px radii**. Never pill-shaped except for tags.
- CTAs pad 16px × 64px (generous horizontal). Labels never cramped.
- Hero frames on mobile have **no border**; on desktop they get a **4px** one. Responsive stroke is deliberate.

### Game accent system

Each game layers one accent on the base palette:

| Game | Accent | Pattern | Frame feel |
|---|---|---|---|
| **Bluff Momo** | yellow `#F3B952` over red | `pattern.webp` (dotted Kathmandu street) | playful, chaotic |
| **Ganthan** | coral `#F16147` + purple `#7184BE` | `pattern2.png` | warm, conversational |
| **Bichitra** | quiz-blue accents | plain beige | quiet, puzzle-y |
| **Farak** | bright contrast pair | plain beige | imposter-game edge |
| **Thug** | green tint | plain beige | secretive, dark-mode friendly |

---

## CARD INDEX

Open these to see tokens in practice:

- `preview/colors.html` — palette, game accents, shadow system
- `preview/type.html` — families, scale, bilingual pairing
- `preview/components.html` — buttons, tags, character cards, hero frames
- `preview/spacing.html` — radii, strokes, shadow specimens
- `preview/brand.html` — logo, lockups, iconography
- `ui-kit/tumlet-ui.html` — tumlet.com component library in one page
- `ui-kit/bluff-momo-flyer.html` — print-ready Bluff Momo flyer kit

---

## FILES

```
tokens.css                — CSS variables + base utilities (import first)
assets/
  logos/                  — Tumlet wordmark + the two T's
  characters/             — Bluff Momo cast (Aama, Hante, Chor, Mantri, Bhatti-ko-Dai)
  icons/                  — player, age, time, email, insta, youtube, spark, bulb
preview/                  — review cards, one per system surface
ui-kit/                   — ready-to-copy composed screens
SKILL.md                  — how to use this system in new designs
```
