# Minimal UI pass: cut everything that is not required

The user's words: "Remove everything and anything that is not required from all the screens. Still so many text and buttons."

The app works and looks right. This pass only REMOVES. Every screen should show the least text and the fewest buttons that still let a player play. If something can be understood from the cards, the layout, or the state, delete the words. When in doubt, cut it.

## What to cut

- Taglines, eyebrows, kickers, subtitles, hints, helper sentences, "tips", footers, "Set by the host.", "Friends join from their own phones.", counters like "4 in hand", repeated status text, anything that restates what is already visible.
- Labels above controls that are obvious from context ("1 · Your hand", "2 · Stack", "3 · Power", "Your hand · 4", "Everyone else is set.", "Fill 2 more slots and pick a power.").
- Secondary and duplicate buttons: where two controls do the same thing, keep one; text links like "Look at the table", "Continue now", "Change setup" only if the action is truly needed (see below); icon-only is fine for small utilities if it keeps an `aria-label`.
- Long explanatory prose. Rules text lives on the Rules page only, and that page is also cut down.
- Decorative extras: badges, tooltips that repeat visible text, ornamental headings.

## What must stay (do not break)

- Every action a player needs to play: create/join, set name + colour (join form), add bots (host), start (host), pick presets (host), lock in setup, place/serve, bid (stepper + raise/pass/open), eat (flip stacks and powers), accept the bust, ready for next round, rematch, leave, take seat back / replace with bot (the only way to unblock an offline player, keep it but as small as possible).
- The turn/phase indicator (one short phrase), scores, who is eating and progress (eaten/target), the high bid, the plate, the Akabare bite moment's essentials (the card, who bit whose, the power choices, accept).
- Accessibility: removing VISIBLE text must not remove screen-reader text. Keep or add `aria-label`s and `tp-sr` text, the aria-live announcer, keyboard focus handling, focus rings. Controls remain >= 44px on phones.
- Hidden-information rules, layout stability (the dock has a fixed height; nothing may shift), the event banner/arrow/bid disc on the table, online play, the minimize handle.
- Behaviour and logic. No engine/server/net changes. Delete only UI.

## How to write what remains (copy rules)

One to three words wherever possible ("Start", "Join", "Lock in", "Pass", "Ready", "Rematch", "Leave"). Sentence case, plain words, no filler ("Please", "You can", "Now"), no em dashes or en dashes, no exclamation marks, no emojis, straight quotes. Prefer the active, shortest form: "Sita raised to 5", not "Sita has raised the bid to 5".

## Process

For each screen you own: (1) list every visible text node and button, (2) mark each REQUIRED or CUT with a one-line reason, (3) delete the CUT items together with their now-unused CSS, components, props and tests, (4) check the screen at 1280x800 and 375x812 in a real browser and LOOK at it: nothing should look empty or broken, spacing should be re-balanced after the cuts, nothing may overlap or shift, (5) typecheck (`npx tsc -p tsconfig.json`) and run `npx vitest run` (update tests that asserted removed copy), (6) report exactly what was removed per screen.
