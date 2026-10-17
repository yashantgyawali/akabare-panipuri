# Real 3D table (WebGL): build brief

The user wants "a proper 3D version of the game, just like Liar's Bar, with characters and everything, to make it feel like they are actually playing." Decisions already made by the user:

- **Characters:** free **CC0** (public domain, no attribution needed) rigged + animated 3D characters, downloaded into the repo, seated around the table, clothing tinted in each player's colour, using their idle / reaction animations.
- **Camera:** **first person**, like Liar's Bar: you sit at the table, your own cards (your hand) are held at the bottom of the screen, the other players sit across and around the table, the brass plate is in the middle. The camera turns slightly towards whoever is acting.
- **Phones:** the same 3D scene everywhere, lighter on phones (lower resolution, cheaper shadows/effects). If WebGL is unavailable, fall back to the existing CSS round table (`src/ui/table/scene/**`), which must keep working.

Only the **table screen** changes. Home, lobby, rules, the header bar, the bottom action dock (fixed height, no layout shift), the overlays (bite, result, game over), drawers and the event banner stay as they are, as DOM on top of the canvas. Game logic, engine, server, net, cards art: unchanged.

## Stack

- `three`, `@react-three/fiber` (v9, React 19), `@react-three/drei` (useGLTF, useAnimations, Html, ContactShadows, useTexture...). No postprocessing library unless cheap; a CSS vignette over the canvas is fine.
- The 3D table is **lazy-loaded** (its own chunk) so home/lobby stay light.
- Assets live in `public/models/` (GLB, Draco/meshopt-compressed where possible, target <= 2-3 MB per character, ideally less) and `public/textures/` (CC0 wood/cloth from ambientCG or Poly Haven, compressed, small). Every asset's source URL + licence is recorded in `docs/ASSETS.md`.

## The scene (Liar's Bar feel, our game)

- Dim tavern room: dark wood walls/floor hints, one warm hanging lamp over the table casting a soft shadowed pool of light, some fill light, dust motes; the room falls off to near black.
- Round wooden table with grain and a worn rim; the **brass plate** in the centre; each seat's **stack** of face-down puri cards (backs in the OWNER's colour, from `public/backs/puri-<color>.webp`) and its **power card** (`public/backs/power-<color>.webp`) lie in front of that seat. Card fronts (when revealed: eaten cards on the plate, revealed powers, reveal at round end/game over, your own peeks) are textures generated at runtime from our art (`public/art/<kind>.webp`) + the player colour frame + title, matching the HTML `<CardFront>` look closely enough (a canvas texture is fine).
- **Characters** seated around the table (3-6), upper bodies above the table edge, legs hidden; each tinted in the player's colour; idle breathing/looking animation, small randomised offsets so they don't move in sync; a floating **nameplate** above each head (name + score + one short status, as today).
- **Your seat**: no full body; you see your own **hands/cards**: the puri cards in your hand fanned at the bottom of the view during serving/bidding (like Liar's Bar), tilting toward the camera. Your stack and power lie on the table in front of you.
- **Moves come alive** (driven by the existing playback events `current` / `view.log`, see `src/ui/playback`):
  - `place`: a card flies from the actor's hands (or from your hand) and lands on top of the target stack; the actor plays a reach/throw gesture.
  - `bidStart` / `raise` / `pass`: the actor raises a hand / leans forward / waves off; the high bid shows on the plate (as today's BidDisc, now in 3D).
  - eating: the eater picks the top card of a stack, it flips and lands on the plate face up; power flips flip in place.
  - `bite`: red flash of the lamp, the eater flinches; `bust` the eater slumps; `success` cheers; trap reward owner reacts.
  - The camera gently turns/leans toward the acting seat, returning to centre.
- **Interaction**: clicking/tapping a stack or power in 3D performs exactly what the current CSS scene does (driven by `view.legal`: place selected card, eat top card, flip power); hover/selectable highlight (yellow rim glow); invalid targets do nothing. Keyboard and screen-reader users get an equivalent **visually hidden DOM control layer** (buttons for each stack/power with the same aria-labels as `scene/Pile3D.tsx`) so the table stays fully accessible; focus restore keeps working.

## Rules that must hold

- **Hidden information**: a face-down card of another owner may only ever be rendered with its BACK texture; no mesh, material, texture key, userData, aria-label or random seed may depend on that card's kind. Your own face-down cards show a small peek marker (as today).
- **Performance**: 60 fps on a laptop, smooth on a mid-range phone: clamp DPR (<=2 desktop, <=1.5 phone), one shadow-casting light (cheaper or baked contact shadows on phones), instanced/shared geometries and materials for cards, `frameloop` on demand when idle if possible, dispose textures. Lazy-load models with a nice loading state.
- **No layout shift**: the canvas fills the stage between header and dock; the dock keeps its fixed height.
- **Fallback**: `WebGL unavailable` or a load error -> the existing CSS scene. Respect `prefers-reduced-motion` (no camera sway, shorter animations).
- Online play, playback pacing, overlays, event banner, minimize handle: unchanged and working.
