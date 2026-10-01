# Akabare Panipuri Online

An online version of *Akabare Panipuri* (prototype rules v0.6), a bluffing card game for 3–6 players. Everyone hides puri on the table. Then the highest bidder eats, hoping to dodge the akabare chili.

- **Play together online.** One person creates a table and shares the 5-letter code or link. Friends join from any browser, phones included. Empty seats can be filled with bots.
- **Server-authoritative.** A Supabase Edge Function holds the secret game state and sends each player only what they're allowed to see. Realtime broadcast pings and presence keep every screen in sync.
- **Local mode.** With no backend configured (or `?local` in the URL), the same server runs in the browser. Each tab can be a different player, which is handy for development and pass-and-play.

## Run it

```sh
npm install
npm run dev            # local mode (no backend) → http://localhost:5173
npm run dev:supabase   # live Supabase backend      → http://localhost:5174
```

`npm run dev:supabase` reads `.env.supabase.local`, which holds the public URL and anon key of the `akabare-panipuri` project. To let friends on the same Wi-Fi play, run `npm run dev:supabase -- --host` and share the LAN address it prints.

## Build and host

```sh
npm run build:supabase   # → dist/ (static files, Supabase config baked in)
npx vite preview         # check the production build locally
```

`dist/` is a static site with hash routing, so it works on any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages) with no server config. The backend is already deployed. For backend changes, see [docs/DEPLOY.md](docs/DEPLOY.md).

## Tests

```sh
npm test                    # ~1000 tests: engine rules, audits, fuzzing, server, net, cards, playback
node scripts/e2e-bots.mjs   # 31 end-to-end checks against the live Supabase function
```

## Layout

| Path | What |
|---|---|
| `src/engine/` | Pure rules engine (rules v0.6), bots and per-player views. Shared by the browser and Deno. |
| `src/server/` | Lobby and game server core, shared by the edge function and local mode. |
| `src/net/` | Supabase and local clients, sessions, and the `useGame` React hook. |
| `src/cards/` | Card components, palette, copy, wordmarks, and the card-back generator (`backs.ts`). |
| `src/ui/`, `src/styles/` | The game UI. |
| `supabase/` | Migration and the `game` edge function. |
| `print/backs/` | Print-ready card backs (750×1050 PNG and SVG, 63×88 mm at 300 dpi). |
| `docs/` | Architecture and rules decisions, card-back design notes, deploy guide, rules PDF. |

The card artwork comes from the v0.6 printable asset pack (`source_assets/`). The card backs were redesigned for this version; see `docs/CARD_BACKS.md`.
