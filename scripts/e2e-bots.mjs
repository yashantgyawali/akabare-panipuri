#!/usr/bin/env node
/**
 * End-to-end check of the deployed `game` edge function, its DB trigger and
 * Realtime. Plays real games over HTTP:
 *
 *   a) 1 human + 4 bots, random legal moves until the game is over; every
 *      snapshot must hide other owners' face-down kinds.
 *   b) 3 humans (joins in parallel) acting concurrently: optimistic
 *      concurrency under load, 'conflict' / 'illegal_action' / 'wrong_status'
 *      races tolerated (any other error fails),
 *      versions strictly monotonic, realtime pings + presence observed.
 *   c) negative cases: wrong/foreign token → unauthorized, non-host start →
 *      forbidden, join a finished game → wrong_status, kicked player → unauthorized, …
 *
 * Env: SUPABASE_URL + SUPABASE_ANON_KEY (falls back to VITE_SUPABASE_* from
 * the environment, .env.local, then .env.supabase.local). GAME_FUNCTION_URL
 * overrides the function endpoint; E2E_SKIP_REALTIME=1 skips realtime checks.
 *
 *   node scripts/e2e-bots.mjs
 *
 * Exit code 0 = all checks passed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function dotenv(file) {
  const path = join(root, file);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const fileEnv = { ...dotenv('.env.supabase.local'), ...dotenv('.env.local') };
const env = (name) => process.env[name] || process.env[`VITE_${name}`] || fileEnv[`VITE_${name}`] || fileEnv[name] || '';
const SUPABASE_URL = env('SUPABASE_URL').replace(/\/+$/, '');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const FUNCTION_URL = process.env.GAME_FUNCTION_URL || `${SUPABASE_URL}/functions/v1/game`;
const SKIP_REALTIME = process.env.E2E_SKIP_REALTIME === '1';

if (!process.env.GAME_FUNCTION_URL && (!SUPABASE_URL || !ANON_KEY)) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (or GAME_FUNCTION_URL).');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Tiny harness
// ---------------------------------------------------------------------------

const results = [];
let calls = 0;

function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  return !!pass;
}

class ApiFail extends Error {
  constructor(code, message, status) {
    super(`${code}: ${message}`);
    this.code = code;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];

async function post(body) {
  calls++;
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiFail('non_json', `HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  return { status: res.status, json };
}

async function api(body) {
  const { status, json } = await post(body);
  if (json && json.ok === true) return json.data;
  if (json && json.ok === false && json.error) throw new ApiFail(json.error.code, json.error.message, status);
  throw new ApiFail('bad_envelope', `HTTP ${status}: ${JSON.stringify(json).slice(0, 200)}`, status);
}

/** Resolves to the error code (or 'ok' if it unexpectedly succeeded). */
async function errorCode(body) {
  try {
    await api(body);
    return 'ok';
  } catch (e) {
    return e instanceof ApiFail ? e.code : `thrown: ${e.message}`;
  }
}

const authOf = (joined) => ({ code: joined.snapshot.code, token: joined.token });

// ---------------------------------------------------------------------------
// Secrecy + random play
// ---------------------------------------------------------------------------

/** Returns a list of leaks in a snapshot (empty = fine). */
function leaks(snap) {
  const out = [];
  if ('state' in snap) out.push('snapshot has raw state');
  const text = JSON.stringify(snap);
  if (/"rng"\s*:/.test(text)) out.push('rng leaked');
  if (/"hand"\s*:\s*\[/.test(text)) out.push('hand card list leaked');
  const v = snap.view;
  if (!v) return out;
  if (v.youId !== snap.youId) out.push('view.youId mismatch');
  for (const p of v.players) {
    for (const c of p.stack) {
      if (!v.revealed && c.owner !== snap.youId && c.kind !== null) out.push(`kind of ${c.owner}'s card on ${p.name}'s stack`);
      if ('id' in c) out.push('card id in stack view');
    }
    const pw = p.power;
    if (pw && !pw.revealed && !v.revealed && p.id !== snap.youId && pw.kind !== null) out.push(`${p.name}'s power kind`);
  }
  return out;
}

function randomAction(view, isHost) {
  const L = view.legal;
  const options = [];
  if (L.setup && !L.setup.submitted) {
    let { panipuri, akabare } = L.setup.hand;
    const stack = [];
    for (let i = 0; i < L.setup.stackSize; i++) {
      const useAkabare = akabare > 0 && (panipuri === 0 || Math.random() < 0.3);
      if (useAkabare) akabare--;
      else panipuri--;
      stack.push(useAkabare ? 'akabare' : 'panipuri');
    }
    options.push({ type: 'SUBMIT_SETUP', stack, power: pick(L.setup.availablePowers) });
  }
  if (L.place && L.place.kinds.length && L.place.targets.length) {
    options.push({ type: 'PLACE_PURI', kind: pick(L.place.kinds), targetPlayerId: pick(L.place.targets) });
  }
  if (L.startBid) options.push({ type: 'START_BID', amount: L.startBid.min + rand(3) });
  if (L.raise) options.push({ type: 'RAISE', amount: L.raise.min + rand(2) });
  if (L.pass) options.push({ type: 'PASS' }, { type: 'PASS' });
  if (L.flipPuri.length) options.push({ type: 'FLIP_PURI', targetPlayerId: pick(L.flipPuri) });
  if (L.flipPower.length) options.push({ type: 'FLIP_POWER', targetPlayerId: pick(L.flipPower) });
  if (L.acceptBust) options.push({ type: 'ACCEPT_BUST' });
  if (L.ready) options.push({ type: 'READY' });
  // A ready host sometimes forces the round on (races with the others' READY).
  if (L.forceContinue && isHost && (L.ready || Math.random() < 0.3)) options.push({ type: 'FORCE_CONTINUE' });
  return options.length ? pick(options) : null;
}

// ---------------------------------------------------------------------------
// Realtime (uses the app's own client when Node can load TypeScript)
// ---------------------------------------------------------------------------

/** Resolves to a factory of independent clients (one socket each), so presence is observed across connections. */
async function loadRealtime() {
  try {
    const { SupabaseGameClient } = await import('../src/net/supabase.ts');
    return { make: () => new SupabaseGameClient(SUPABASE_URL, ANON_KEY), via: 'SupabaseGameClient' };
  } catch (e) {
    const { createClient } = await import('@supabase/supabase-js');
    // Minimal stand-in with the same subscribe() contract.
    const make = () => {
      const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      return {
        subscribe(code, playerId, { onVersion, onPresence }) {
          const ch = sb.channel(`akabare:${code.toUpperCase()}`, { config: { presence: { key: playerId } } });
          ch.on('broadcast', { event: 'update' }, (m) => typeof m.payload?.version === 'number' && onVersion(m.payload.version))
            .on('presence', { event: 'sync' }, () => {
              const ids = new Set([playerId]);
              for (const metas of Object.values(ch.presenceState())) for (const m of metas) if (m.playerId) ids.add(m.playerId);
              onPresence?.([...ids].sort());
            })
            .subscribe((status) => status === 'SUBSCRIBED' && ch.track({ playerId }));
          return () => void sb.removeChannel(ch);
        },
      };
    };
    return { make, via: `raw supabase-js (${e.message.split('\n')[0]})` };
  }
}

async function waitFor(pred, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(100);
  }
  return pred();
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function soloWithBots() {
  console.log('\n(a) 1 human + 4 bots');
  const host = await api({ op: 'create', name: 'E2E Solo' });
  const auth = authOf(host);
  check('create returns token, playerId and lobby snapshot', host.token && host.playerId && host.snapshot.status === 'lobby');
  let snap = await api({ op: 'updateLobby', ...auth, patch: { config: { maxRounds: 3 } } });
  check('host can change the rules', snap.config.maxRounds === 3);
  for (let i = 0; i < 4; i++) snap = await api({ op: 'addBot', ...auth });
  check('4 bots added', snap.players.length === 5 && snap.players.filter((p) => p.isBot).length === 4);
  snap = await api({ op: 'start', ...auth });
  check('start → playing', snap.status === 'playing' && snap.view?.round === 1);

  const leakSet = new Set();
  let acts = 0;
  let idle = 0;
  let unexpected = null;
  for (let step = 0; step < 3000 && snap.status !== 'finished'; step++) {
    for (const l of leaks(snap)) leakSet.add(l);
    const action = randomAction(snap.view, true);
    if (!action) {
      if (++idle > 30) break;
      await sleep(150);
      snap = await api({ op: 'get', ...auth });
      continue;
    }
    idle = 0;
    try {
      snap = await api({ op: 'act', ...auth, action });
      acts++;
    } catch (e) {
      unexpected = `${action.type} → ${e.message}`;
      break;
    }
  }
  for (const l of leaks(snap)) leakSet.add(l);
  check(
    'solo game reaches gameOver',
    snap.status === 'finished' && snap.view?.phase === 'gameOver',
    `${acts} actions, ${snap.view?.results?.length ?? 0} rounds`,
  );
  check('no illegal moves offered by legal actions', !unexpected, unexpected ?? '');
  check('winners declared', Array.isArray(snap.view?.winners) && snap.view.winners.length > 0);
  check('no hidden information in any snapshot', leakSet.size === 0, [...leakSet].slice(0, 3).join('; '));
  return { host, code: auth.code };
}

async function threeHumans(realtime) {
  console.log('\n(b) 3 humans, concurrent');
  const host = await api({ op: 'create', name: 'Host' });
  const code = host.snapshot.code;
  const [p2, p3] = await Promise.all([
    api({ op: 'join', code, name: 'P2' }),
    api({ op: 'join', code: code.toLowerCase(), name: 'P3' }),
  ]);
  const humans = [host, p2, p3];
  let snap = await api({ op: 'get', ...authOf(host) });
  check(
    'parallel joins both land (distinct seats + colors)',
    snap.players.length === 3 &&
      new Set(snap.players.map((p) => p.color)).size === 3 &&
      snap.players.map((p) => p.seat).join() === '0,1,2',
  );

  // Realtime: pings + presence.
  const pings = [];
  const online = new Map();
  const unsubs = [];
  if (realtime) {
    const [hostRt, p2Rt] = [realtime.make(), realtime.make()];
    unsubs.push(hostRt.subscribe(code, host.playerId, { onVersion: (v) => pings.push(v), onPresence: (ids) => online.set('host', ids) }));
    unsubs.push(p2Rt.subscribe(code, p2.playerId, { onVersion: () => {}, onPresence: (ids) => online.set('p2', ids) }));
    const seen = await waitFor(
      () => online.get('host')?.includes(p2.playerId) && online.get('p2')?.includes(host.playerId),
      15_000,
    );
    check(`presence seen both ways across connections (${realtime.via})`, seen, JSON.stringify(Object.fromEntries(online)));
  }

  // Lobby burst: 9 concurrent writes from 3 players.
  const before = snap.version;
  const burst = await Promise.allSettled(
    humans.flatMap((h, i) => [0, 1, 2].map((k) => api({ op: 'updateLobby', ...authOf(h), patch: { name: `P${i + 1}-${k}` } }))),
  );
  const won = burst.filter((r) => r.status === 'fulfilled');
  const lost = burst.filter((r) => r.status === 'rejected');
  const versions = won.map((r) => r.value.version);
  snap = await api({ op: 'get', ...authOf(host) });
  check(
    'concurrent writes: every success is its own version',
    new Set(versions).size === versions.length && snap.version === before + won.length,
    `${won.length} ok, ${lost.length} lost (${[...new Set(lost.map((r) => r.reason.code))].join(',') || '-'}), v${before}→v${snap.version}`,
  );
  check('lost writes only fail with conflict', lost.every((r) => r.reason.code === 'conflict'));

  check('non-host start → forbidden', (await errorCode({ op: 'start', ...authOf(p2) })) === 'forbidden');
  await api({ op: 'updateLobby', ...authOf(host), patch: { config: { maxRounds: 2 } } });
  snap = await api({ op: 'start', ...authOf(host) });
  check('host starts the 3-player game', snap.status === 'playing');

  // Acting on a slightly stale snapshot can lose to another player's move.
  const races = { conflict: 0, illegal_action: 0, wrong_status: 0 };
  const leakSet = new Set();
  let actsTotal = 0;
  const deadline = Date.now() + 240_000;
  async function play(me, isHost) {
    const auth = authOf(me);
    let last = -1;
    while (Date.now() < deadline) {
      const s = await api({ op: 'get', ...auth });
      if (s.version < last) leakSet.add(`version went backwards for ${me.playerId}`);
      last = s.version;
      for (const l of leaks(s)) leakSet.add(l);
      if (s.status === 'finished') return s;
      const action = randomAction(s.view, isHost);
      if (!action) {
        await sleep(100 + rand(150));
        continue;
      }
      try {
        await api({ op: 'act', ...auth, action });
        actsTotal++;
      } catch (e) {
        if (e.code in races) races[e.code]++;
        else throw e;
      }
    }
    throw new Error('timed out');
  }
  let finals;
  try {
    finals = await Promise.all(humans.map((h, i) => play(h, i === 0)));
  } catch (e) {
    check('3-player game completes', false, e.message);
    unsubs.forEach((u) => u());
    return { humans, code, finished: false };
  }
  check('3-player game completes for everyone', finals.every((s) => s.status === 'finished'), `${actsTotal} actions`);
  check(
    'races surface only as conflict / illegal_action / wrong_status',
    true,
    Object.entries(races).map(([k, n]) => `${k} ${n}`).join(', '),
  );
  check('no hidden information / monotonic versions', leakSet.size === 0, [...leakSet].slice(0, 3).join('; '));
  check('all players agree on the final version', new Set(finals.map((s) => s.version)).size === 1);

  if (realtime) {
    const final = finals[0].version;
    const got = await waitFor(() => pings.includes(final), 10_000);
    check('realtime pings arrive (incl. the final version)', got && pings.length > 0, `${pings.length} pings, max v${Math.max(0, ...pings)}, final v${final}`);
  }
  unsubs.forEach((u) => u());
  return { humans, code, finished: true };
}

async function negatives(solo, multi) {
  console.log('\n(c) negative cases');
  const bogus = 'x'.repeat(43);
  check('wrong token → unauthorized', (await errorCode({ op: 'get', code: solo.code, token: bogus })) === 'unauthorized');
  check(
    "another game's token → unauthorized",
    (await errorCode({ op: 'get', code: multi.code, token: solo.host.token })) === 'unauthorized',
  );
  check('join a finished game → wrong_status', (await errorCode({ op: 'join', code: solo.code, name: 'Late' })) === 'wrong_status');
  check('unknown code → not_found', (await errorCode({ op: 'get', code: 'ZZZZZ', token: bogus })) === 'not_found');
  check('unknown op → bad_request', (await errorCode({ op: 'explode' })) === 'bad_request');
  check('non-JSON body → bad_request', (await errorCode('not json')) === 'bad_request');
  check('act without action → bad_request', (await errorCode({ op: 'act', ...authOf(solo.host) })) === 'bad_request');
  const res = await post({ op: 'get', code: solo.code, token: bogus });
  check('error keeps the JSON envelope with HTTP 401', res.status === 401 && res.json.ok === false);

  const pre = await fetch(FUNCTION_URL, {
    method: 'OPTIONS',
    headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'apikey, content-type, authorization, x-client-info' },
  });
  check('CORS preflight', pre.ok && pre.headers.get('access-control-allow-origin') === '*', `HTTP ${pre.status}`);

  // Kick: the removed player's token stops working.
  const host = await api({ op: 'create', name: 'Kicker' });
  const guest = await api({ op: 'join', code: host.snapshot.code, name: 'Guest' });
  check('join with a taken color → color_taken', (await errorCode({ op: 'join', code: host.snapshot.code, name: 'Copy', color: host.snapshot.players[0].color })) === 'color_taken');
  await api({ op: 'removePlayer', ...authOf(host), playerId: guest.playerId });
  check('removed player → unauthorized', (await errorCode({ op: 'get', ...authOf(guest) })) === 'unauthorized');
  // Leaving: the last human's leave deletes the game.
  await api({ op: 'leave', ...authOf(host) });
  check('last human leaving deletes the game', (await errorCode({ op: 'get', ...authOf(host) })) === 'not_found');
}

async function cleanup(solo, multi) {
  const leave = (j) => api({ op: 'leave', ...authOf(j) }).catch(() => undefined);
  await leave(solo.host);
  for (const h of multi?.humans ?? []) await leave(h);
}

// ---------------------------------------------------------------------------

const started = Date.now();
console.log(`Akabare e2e → ${FUNCTION_URL}`);
let solo;
let multi;
try {
  solo = await soloWithBots();
  const realtime = SKIP_REALTIME || !SUPABASE_URL ? null : await loadRealtime();
  multi = await threeHumans(realtime);
  await negatives(solo, multi);
} catch (e) {
  check('scenario ran without unexpected errors', false, e instanceof Error ? e.message : String(e));
} finally {
  if (solo) await cleanup(solo, multi);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: ${results.length - failed.length}/${results.length} checks passed, ${calls} requests, ${((Date.now() - started) / 1000).toFixed(1)}s`);
for (const f of failed) console.log(`  FAIL ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
// Realtime sockets keep the event loop alive.
process.exit(failed.length ? 1 : 0);
