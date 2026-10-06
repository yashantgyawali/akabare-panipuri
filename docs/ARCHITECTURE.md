# Akabare Panipuri Online: Architecture & Build Brief (rules v0.6)

The source of truth for the rules is `source_assets/Akabare_Panipuri_Rules_v0_6.pdf`.
The contracts are `src/engine/types.ts`, `src/engine/index.ts` (API list),
`src/server/types.ts` and `src/net/types.ts`. Read them before writing code.

## Stack

- **Frontend:** Vite 8 + React 19 + TypeScript (strict). There's no router library. We use hash routes:
  - `#/`: home (create / join)
  - `#/g/<CODE>`: game (lobby, then the table)
  - `#/cards`: card gallery
  - `#/rules`: rules
- **Backend:** Supabase.
  - One Edge Function, `game`, is server-authoritative. It holds the whole secret state and returns only per-player views.
  - One table stores the game records.
  - A DB trigger sends a Realtime **broadcast** ping (`{version, status}`) on every change. Clients refetch their own view.
  - Realtime **presence** on the same channel shows who is online.
- **Identity:** no Supabase Auth.
  - Create/join returns a random secret `token` per player per game.
  - The server stores only `sha256(token)`.
  - The client keeps the session in localStorage, with a sessionStorage override so each browser tab can be a different player.
- **Local mode:** the same server core runs in the browser (`LocalGameClient`). It uses localStorage for persistence, `navigator.locks` for mutual exclusion, and `BroadcastChannel` to sync across tabs.
  - It's used when Supabase env vars are missing or the URL has `?local`.
  - It gives full multiplayer across browser tabs, with no backend. The UI must be fully playable this way.

## Module ownership (parallel build: stay inside your files)

| Area | Files | Notes |
|---|---|---|
| Engine | `src/engine/{rules,engine,view,bot}.ts`, `src/engine/*.test.ts` | Pure TypeScript with no dependencies. It must be Deno-compatible (relative imports end in `.ts`, no Node APIs). Don't change `types.ts` or `index.ts` unless it's unavoidable. If you do, report it. |
| Cards & art | `scripts/extract-art.mjs`, `scripts/export-backs.mjs`, `public/art/*`, `src/cards/*`, `print/*` | |
| Server & net | `src/server/core.ts` (+ tests), `src/net/{index,session,local,supabase}.ts`, `supabase/**`, `scripts/sync-function.mjs`, `scripts/e2e-bots.mjs` | `src/server/*` must be Deno-compatible |
| UI | `index.html`, `src/main.tsx`, `src/App.tsx`, `src/ui/**`, `src/styles/**` | |

To typecheck only your own area, run `npx tsc -p tsconfig.json 2>&1 | grep '<your dir>'`. Other areas may be mid-build.

Tests use Vitest. Run `npx vitest run <your dir>`.

## Rules decisions (the engine MUST implement these exactly)

These resolve ambiguities and bugs in the PDF pseudocode.

**Powers** (4 kinds: `vinegar`, `dahi`, `nayaplate`, `chaat`; the PDF's Khali Puri was replaced by Naya Plate):
- **Vinegar:** the next puri flip is cancelled (`numb`).
- **Dahi:** saves you from a pending Akabare (`saved`); otherwise `wasted`.
- **Naya Plate:** frees the plate (`freePlate`): any non-empty stack, your own included, in any order, for the rest of the round. It never changes `target`. A second flip is `wasted`. Flipped while an Akabare is pending, it is a failed save.
- **Chaat:** adds 2 to `eaten` (`plusTwo`).

1. **Setup**
   - Each player submits `startingStack` (2) puri kinds for their own stack, listed bottom → top, plus 1 power.
   - They can't use more Akabare than they hold, which is 1.
   - A player may resubmit until the last player submits. Then the phase moves to serving.
   - The remaining puri cards stay in hand (4 by default).
2. **Power availability**
   - The used set is cleared at the start of round r when `(r-1) % (powerResetRound-1) === 0`. That means rounds 1, 4, 7, …
   - Available powers are all 4 (Vinegar, Dahi, Naya Plate, Chaat) minus the used set. So round 1 offers 4, round 2 offers 3, round 3 offers 2, round 4 resets to 4, round 5 offers 3.
   - Placing a power marks it used, whether or not it is flipped.
   - This gives the PDF table: R1 all, R2 = 3, R3 = 2, R4 all 4, R5 = the 3 not picked in R4.
3. **First player**
   - Round 1: random, using the seeded PRNG.
   - Later rounds: the next seat clockwise from the previous round's first player.
4. **Serving**
   - Turns go clockwise from the first player.
   - On your turn you do one of two things:
     - `PLACE_PURI`: put 1 card from your hand on top of *any* stack, including your own.
     - `START_BID(amount ≥ minBid)`.
   - If your hand is empty you must start the bid.
   - Nobody can place cards once the bid starts.
5. **Bidding**
   - The starter's amount is the opening high bid.
   - Turns go clockwise from the seat after the starter, skipping players who have passed.
   - `RAISE(amount > highBid)` or `PASS`. A player who passes is out for the round.
   - When only one player hasn't passed, that player is the **eater** at the high bid.
   - There's no max bid. If everyone else passes straight away, the starter eats at their opening bid.
6. **Eating**
   - By default the eater must flip their own stack from the top until it's empty.
   - After that, each flip picks any *other* non-empty stack.
   - **Naya Plate exception:** once a Naya Plate has been flipped (`EatingState.freePlate`), the own-stack-first rule is off for the rest of the round. The eater may flip the top card of ANY non-empty stack, their own included, in any order. `legal.flipPuri` then lists every non-empty stack.
   - At any time the eater may flip up to `powerFlipsMax` (2) face-down powers, beside any stack, including their own.
7. **FLIP_PURI** resolution:
   - Pop the top card and put it on the plate.
   - If `skipNext` is set, clear it. The card is **cancelled**: it doesn't count, and an Akabare doesn't hurt. Then run `checkEnd`. The PDF returns early here, which could leave the game stuck on an empty table.
   - A Panipuri adds 1 to `eaten`.
   - For an Akabare:
     - If `powersFlipped < max` and some power is still face down, set `pendingAkabare`.
     - Otherwise, **bust** on that Akabare.
   - Run `checkEnd`.
8. **FLIP_POWER** resolution:
   - Add 1 to `powersFlipped` and reveal the power.
   - If an Akabare is pending:
     - Dahi saves you (effect `saved`, plate card marked `saved`). Then run `checkEnd`.
     - Any other power busts you on the pending Akabare (effect `failedSave`). Chaat and Naya Plate effects do NOT apply, so flipping Naya Plate here is a failed save and a bust like any other non-Dahi.
   - Otherwise:
     - Vinegar sets `skipNext` (effect `numb`). If it's already set, the effect is `wasted`. Two Vinegars don't stack.
     - Dahi does nothing (`wasted`).
     - Naya Plate sets `freePlate` (effect `freePlate`). If it's already set, the effect is `wasted`. It costs one of the power flips like any power. `target` is not changed: it always equals the bid.
     - Chaat adds 2 to `eaten` (`plusTwo`).
   - Then run `checkEnd`.
9. **checkEnd**
   - If `eaten ≥ target`, it's a SUCCESS. The eater scores `+target`, even if they overshot.
   - Otherwise, if every stack is empty:
     - If flips are left and some power is face down, wait. The legal actions are `FLIP_POWER` or `ACCEPT_BUST`.
     - Otherwise, it's a **bust** with reason `emptyTable`.
10. **ACCEPT_BUST** is legal only when an Akabare is pending, or when the table is empty and the eater is short with flips still available.
11. **Bust**
    - The eater loses `target` and their bust count goes up by 1.
    - If the bust was on an Akabare whose owner ≠ eater, that owner gets `+trapReward`. This applies even if the Akabare was sitting on the eater's own stack.
    - There's no trap reward for:
      - an empty-table bust
      - the eater's own Akabare
      - a cancelled Akabare
      - a saved Akabare
12. **Round end**
    - Phase `roundEnd` shows the result.
    - Bots are ready immediately. The next round starts when every human is `READY`, or on `FORCE_CONTINUE`. Only the host can send `FORCE_CONTINUE`; the server enforces that.
    - The next round:
      - returns every player's full set
      - clears stacks and powers
      - rotates the first player
    - The game-over check runs *before* the next round:
      - If anyone has ≥ `targetScore`, the game is over.
      - Otherwise, if `round === maxRounds`, the game is over.
      - Winners are the players with the highest score. Ties go to fewer busts. If still tied, the players share the win (multiple winners).
    - `targetScore` or `maxRounds` may be null (a variant), but not both.
13. **Secrecy**
    - Face-down puri cards show only their owner (the back color). The owner also sees the kind. That is the "private reminder of what I placed and where".
    - Powers show their kind only to their owner until they're flipped.
    - Hand contents are private. Hand *counts* are public.
    - Used-power history is private.
    - Leftover cards stay secret at `roundEnd` unless `config.revealOnRoundEnd` is set. At `gameOver` everything left on the table is revealed.
14. **Soft bid warning:** `tableMax = face-down puri cards on the table + 2 × powerFlipsMax`.
    - This uses public information only. The PDF's "Panipuri on the table + 4" would leak how many Akabare are down.
    - The UI warns but lets the player confirm.
15. **Bots** decide ONLY from `projectView(state, botId)`, never from the secret state. They should play plausibly:
    - plant their Akabare on others' stacks
    - bid near a sensible estimate
    - use known-own Vinegar before a known-own Akabare
    - flip Chaat when it's useful
    - flip a known-own Naya Plate to walk around a dangerous top card on their own stack (e.g. a planted Akabare)
    - try Dahi when they've bitten an Akabare
    - prefer stacks whose top card they own when they know it's a Panipuri

## Server semantics (`src/server/core.ts`, shared by the edge function and local mode)

`core.ts` is pure logic over a `GameRecord`. Storage, tokens, and HTTP live in the wrappers. It exposes functions like:

- `newRecord(code, host, now)`
- `joinPlayer(rec, name, color?)`
- `updateLobby(rec, playerId, patch)`
- `addBot(rec, actorId)`
- `removePlayer(rec, actorId, targetId)`
- `startGame(rec, actorId, seed)`
- `act(rec, actorId, action)`
- `setBot(rec, actorId, targetId, isBot)`
- `rematch(rec, actorId)`
- `leave(rec, actorId)`
- `snapshot(rec, playerId)`

Each mutation returns a new record with `version + 1` or throws a `ServerError(code, message)`.

What each operation does:

- **create:** the host takes seat 0 with the first free color (or the requested one).
- **join:**
  - Only in the lobby, and only if there are fewer than 6 players.
  - Names are trimmed to 1–20 characters.
  - The color is optional. Without one, the player gets the first free color. A color someone already has returns `color_taken`.
- **updateLobby:**
  - Any player can change their own name or color.
  - Only the host can change the config, which must pass `validateConfig`.
- **addBot:**
  - Host only, lobby only, fewer than 6 players.
  - The bot gets a name from `Sita, Ramesh, Anil, Priya, Maya, Hari, Gita, Bikash` that isn't already used, and the first free color.
- **removePlayer:** host only, lobby only, and the host can't remove themselves.
- **start:**
  - Host only, lobby only, 3–6 players.
  - Calls `createGame(players by seat, config, seed)`, then `runBots`.
  - Sets status to `playing`.
- **act:**
  - Only while playing. `FORCE_CONTINUE` is host only.
  - Calls `applyAction`, then `runBots`.
  - When the game reaches `gameOver`, status becomes `finished`.
- **setBot:**
  - The host may set any player's bot flag.
  - A player may flip their own flag, to go away or to come back.
  - Then `runBots`.
- **rematch:** host only, when finished. Returns to the lobby with the same players and config, and clears the state.
- **leave:**
  - In the lobby: remove the player. If the host leaves, the next human becomes host. If no humans are left, the record is deleted.
  - During play: the leaver becomes a bot.
- **snapshot:** `{code, status, hostId, version, config, players, youId, view: state ? projectView(state, youId) : null}`. It NEVER includes the raw state.

### Supabase layout

- The migration lives in `supabase/migrations/0001_akabare.sql`. Table names are prefixed so the schema can share a project.
  - `akabare_games(id uuid pk, code text unique, status text, record jsonb, version int, created_at, updated_at)`
  - `akabare_tokens(token_hash text pk, game_id uuid fk on delete cascade, player_id text, created_at)`
  - RLS is enabled with **no policies**, and anon and authenticated have everything revoked. Only the service role (the edge function) can touch these tables.
- Trigger `after insert or update on akabare_games`: `perform realtime.send(jsonb_build_object('version', NEW.version, 'status', NEW.status), 'update', 'akabare:' || NEW.code, false);`
- The edge function `supabase/functions/game/index.ts` runs on Deno.
  - Calls use `POST {op,...}` and get back a `ServerResponse`. It handles CORS.
  - It uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
  - Concurrency is optimistic: `update … where id = $id and version = $old`, retried up to 5 times on conflict.
  - The engine and server core are copied into `supabase/functions/game/_lib/` by `scripts/sync-function.mjs`. Deploy from that folder.
  - Games older than 3 days are pruned opportunistically on `create`.
- Client env: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## UI design brief

**Mood:** a Kathmandu street-food stall at dusk: warm, hand-made, lively. The cards are hand-painted gouache with folk-art flourishes, and the UI should feel like the same world. Think paper textures, cream (#F4E7C8-ish) on deep masala brown/ink, chili red and turmeric accents, and a dark cloth table surface the cards pop against. It shouldn't look like generic flat SaaS.

**Type:** load from Google Fonts.
- A display face with Latin + Devanagari, e.g. *Rozha One* or *Yatra One*, for titles and big numbers.
- *Mukta* for body text and UI (Latin + Devanagari).

**Cards:** always render with the components in `src/cards` (`<Card>`).
- Puri backs use the owner's color, per the rules' UI note.
- Power backs are a *different design*, also in the owner's color.
- Always add a small owner-name/initial badge next to face-down cards, so the UI isn't color-only.

**The table:**
- Seats sit around the table in clockwise seat order, with you at the bottom.
- Each seat shows:
  - name, color, score, hand count, and bot/online indicators
  - the stack: card backs fanned with a vertical offset, top card on top, count visible
  - the power card beside the stack
- Your own face-down cards show a subtle "you know this: Panipuri/Akabare" peek marker.
- Your hand appears as actual card faces at the bottom.

**Phases:**
- **Setup:** fill 2 stack slots (bottom/top) from your hand and pick 1 available power. Unavailable powers are greyed out with the reason ("used in round 2"). Show a waiting list with checkmarks.
- **Serving:** on your turn, pick a hand card and then click a stack, or "Start the bid" with a stepper. Show the soft warning above `tableMax`.
- **Bidding:** show the high bid, a raise stepper (at least high + 1), Pass, and history chips.
- **Eating:**
  - The eater's HUD shows: eaten / target, flips left, a Vinegar "numb" indicator, and which stacks can be flipped (highlighted and clickable), including powers.
  - **The Akabare bite is its own full-screen dramatic moment.** Show the chili art with a shake and red vignette.
    - The eater gets two choices:
      - "Flip a power and pray for Dahi": pick a face-down power, with its owner shown.
      - "Accept the bust".
    - Everyone else sees a suspense overlay.
- **Event playback:** after each snapshot, diff `view.log` by `seq` and play new events one at a time: card flips of about 700ms, toasts. Bots' moves arrive in batches, so pacing matters. The player's own action applies immediately. Respect `prefers-reduced-motion`.
- **Round end:** show the result (success/bust, deltas, trap reward), the scoreboard, a Ready button, and "Continue now" for the host.
- **Game over:** show the winners with a celebration, the final scores, and "Rematch" for the host.
- **Always available:**
  - a rules drawer (condensed rules + power table)
  - a scoreboard
  - a log
  - a share link/code in the lobby and header
  - host controls to "replace with bot" for players who are offline

**Responsive:** it must work at 375px width (phones are the main device for a party game) and scale up nicely to desktop.

**Other requirements:**
- Keyboard accessible.
- `aria-label`s on cards.
- Visible focus.
- No horizontal page scroll.

## Card art brief

**Source art:**
- The 6 unique illustrations are identical across player colors and across panipuri 1–5.
- The source files are the 750×1050 PNGs in `source_assets/print_sheets`. The art square is at about x 65–685, y 145–765.
- Extract them to `public/art/{panipuri,akabare,vinegar,dahi,nayaplate,chaat}.webp`, keeping them crisp at a retina card size.
- Sample the exact frame colors per player into `src/cards/palette.ts`.

**Fronts** are rebuilt in HTML/CSS:
- owner-color field with the double cream rounded border (same proportions as the PNGs)
- title in the display font, with a small Devanagari subtitle:
  - अकबरे
  - पानीपुरी
  - सिर्का (Vinegar)
  - दही
  - नयाँ प्लेट (Naya Plate)
  - चाट
- the art square
- **rule text in the empty lower third** (the PDF power table wording, shortened)
- the index circle at bottom-right

**Backs** (the user said "the back of the card needs a lot of work"). They are generated as pure SVG strings in `src/cards/backs.ts`, so the app and the print exports share the same code. They should be hand-made and folk-art in feel, to match the gouache fronts:
- painterly texture using SVG noise/turbulence, not flat fill
- wobbly hand-drawn line quality
- corner flourishes echoing the fronts' leaf motifs
- a rich central emblem
- a wordmark (text converted to paths or robust fonts, so print PNGs render correctly)

There are two designs:

- **Puri back:**
  - The owner color is dominant.
  - The central emblem is a golden puri with a round akabare chili (the Nepali cherry chili) peeking out, in an ornamental medallion.
  - The wordmark is "AKABARE PANIPURI".
  - It must be identical for Panipuri and Akabare. It's the bluff surface.
- **Power back:**
  - Still in the owner color, but clearly different at a glance, even at 40px wide. For example, invert the balance: a cream/parchment field with an owner-color woven Dhaka-style lattice, and an owner-color medallion with a spice-box / four-petal emblem hinting at the four powers.
  - The label is "POWER".

The print exports are 12 PNGs (750×1050) plus SVGs in `print/backs/`, plus a contact sheet for review.
