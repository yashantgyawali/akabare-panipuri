# Deploying Akabare Panipuri Online

The Supabase project is `akabare-panipuri`: ref `ibayovdptlrvoepwrqpz`, URL `https://ibayovdptlrvoepwrqpz.supabase.co`, region ap-south-1.

The backend has three parts:

- one migration (the tables, RLS, and a broadcast trigger)
- one edge function, `game`
- Realtime public channels

## 1. Apply the migration

`supabase/migrations/0001_akabare.sql` is idempotent, so running it again is safe. Apply it with one of these:

- the Supabase MCP `apply_migration` tool (name `akabare_0001`, query = the file's contents)
- `supabase db push`
- the SQL editor

It creates:

- `public.akabare_games`: `code` is unique, `record` is the secret GameRecord (jsonb), `version` is the compare-and-set key, and `updated_at` is maintained by a trigger.
- `public.akabare_tokens`: `sha256(token)` → `(game_id, player_id)`, cascading on game delete.
- RLS enabled with **no policies**, and every privilege revoked from `anon` and `authenticated`. Only the service role, used by the edge function, can read or write these tables.
- the `akabare_games_broadcast` trigger. After every insert or update it calls `realtime.send({version, status}, 'update', 'akabare:<CODE>', false)`. The payload carries no secrets. The function is `SECURITY DEFINER` with `search_path = ''`, and it swallows broadcast errors so a lost ping never rolls back a game write.

To check it worked:

- The only Database advisor note you should see for the `akabare_*` tables (`get_advisors`) is "RLS enabled, no policy", which is intentional.
- `select * from realtime.messages order by inserted_at desc limit 5` should show `akabare:` topics after a game is played.

**Realtime setting:** the client subscribes to **public** channels. If Realtime settings disable public access ("private channels only"), clients stop getting pings. They then fall back to a 20s poll.

## 2. Sync and deploy the function

```sh
npm run sync:function        # copies src/engine + src/server/{types,core,crypto} into supabase/functions/game/_lib/
npx -y deno@2 check supabase/functions/game/index.ts   # optional typecheck
supabase functions deploy game --no-verify-jwt --project-ref ibayovdptlrvoepwrqpz
```

With the MCP `deploy_edge_function` tool instead (this is how the live function was deployed), upload one bundled file instead of 11 sources. That's 60 KB instead of 106 KB, and one file is less likely to stall the upload:

```sh
npm run build:function       # sync:function + rolldown → supabase/.build/game/index.js (types stripped, npm: import kept external)
```

Then deploy with:

- name `game`
- entrypoint `index.js`
- `verify_jwt: true`
- one file, `index.js` = the contents of `supabase/.build/game/index.js`

You can smoke-test the bundle locally first with `PORT=8787 npx -y deno@2 run --allow-net --allow-env --allow-read supabase/.build/game/index.js`. It should answer `{"ok":false,"error":{"code":"internal","message":"The game server is not configured."}}`.

Always run `sync:function` first (`build:function` does it for you). `_lib/` and `.build/` are generated and gitignored: edit `src/`, not `_lib/`.

The hosted runtime injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically, so there are no secrets to set.

### verify_jwt

The function does its own auth: it hashes the per-game token and looks it up in `akabare_tokens`. It doesn't use Supabase Auth. The live deployment uses `verify_jwt = true`, which works because the app uses the legacy anon JWT. **Switch to `verify_jwt = false`** if you move the client to a `sb_publishable_…` key.

- The client sends `apikey: <anon key>` and `Authorization: Bearer <anon key>`. That means `verify_jwt = true` also works while the anon key is the legacy JWT (`eyJ…`).
- New-style publishable keys (`sb_publishable_…`) aren't JWTs. The gateway rejects them when `verify_jwt = true`.
- Either way, the client reports gateway rejections as `internal` ("The game server is unavailable (HTTP 401 …)"). They're never reported as `unauthorized`, so the UI doesn't drop the player's session.

## 3. Point the app at Supabase

```sh
cp .env.supabase.local .env.local   # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev                          # restart after changing env
```

Both files are gitignored (`*.local`). Without these vars, or with `?local` in the URL, the app runs in local mode (in-browser server) instead.

## 4. Run the end-to-end check

```sh
node scripts/e2e-bots.mjs
```

It reads `SUPABASE_URL` / `SUPABASE_ANON_KEY` from the environment. If they aren't set, it falls back to the `VITE_*` values in `.env.local` or `.env.supabase.local`. It plays:

- (a) a full game with 1 human and 4 bots, checking that no snapshot ever leaks another player's hidden cards
- (b) 3 concurrent humans, covering parallel joins, a burst of concurrent lobby writes (each success gets exactly one version), a full game with races, realtime pings (including the final version), and presence
- (c) negative cases, such as a wrong or foreign token, a non-host start, joining a finished game, a kicked player, the last human leaving, and the CORS preflight

It prints `PASS`/`FAIL` with each failure and exits non-zero on failure. It takes about 1–2 minutes and removes its games afterwards.

Environment knobs:

- `E2E_SKIP_REALTIME=1` skips the realtime checks.
- `GAME_FUNCTION_URL=…` targets a different endpoint, for example a local harness.

## Notes

- **Keys:**
  - The anon key is public and ships in the browser bundle. It can only call the function and join public Realtime channels, because the tables are closed to it.
  - The service-role key lives only inside the edge function runtime. Never put it in `.env*` or client code.
- **Concurrency:** every mutation reads `(record, version)`, applies the pure core op, and writes with `… where id = $id and version = $old`. On a lost race it re-reads and re-applies, up to 5 retries with jittered backoff, then returns `conflict` (HTTP 409).
- **HTTP status codes:** `bad_request` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404, `full`/`color_taken`/`wrong_status`/`illegal_action`/`conflict` 409, `internal` 500. The body is always the JSON `ServerResponse` envelope.
- **Pruning:** games not updated for 3 days are deleted, best-effort, on each `create`. Their tokens cascade.
- **Logging:** the function logs only the op name, error codes and messages. It never logs tokens, token hashes, or state.
- **Troubleshooting:**
  - HTTP 404 "Requested function was not found" means the function isn't deployed.
  - "HTTP 401 … Invalid JWT" means `verify_jwt` is on with a non-JWT key.
  - No realtime pings: check the trigger exists, check `realtime.messages`, and check that public channels are allowed.
