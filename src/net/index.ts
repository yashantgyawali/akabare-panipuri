/**
 * Transport entry point for the UI: one GameClient per tab, plus URL helpers.
 * Supabase when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set and the
 * URL has no `?local`; otherwise the in-browser LocalGameClient.
 */
import { LocalGameClient } from './local.ts';
import { SupabaseGameClient } from './supabase.ts';
import type { GameClient } from './types.ts';

export * from './types.ts';
export { clearSession, listSessions, loadSession, saveSession, type LoadedSession } from './session.ts';

let client: GameClient | null = null;

function env(): { url: string; key: string } {
  // Written out literally so Vite can substitute them at build time.
  const url: unknown = import.meta.env.VITE_SUPABASE_URL;
  const key: unknown = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return { url: typeof url === 'string' ? url.trim() : '', key: typeof key === 'string' ? key.trim() : '' };
}

/** `?local` in the URL (before the hash) forces local mode. */
function localForced(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('local');
  } catch {
    return false;
  }
}

export function isLocalMode(): boolean {
  const { url, key } = env();
  return !url || !key || localForced();
}

export function getGameClient(): GameClient {
  if (!client) {
    const { url, key } = env();
    client = isLocalMode() ? new LocalGameClient() : new SupabaseGameClient(url, key);
  }
  return client;
}

/**
 * Link that opens the game. Keeps `?local` when it forced local mode, since a
 * link without it would look for the game on the server.
 */
export function shareUrl(code: string): string {
  const search = localForced() ? '?local' : '';
  return `${location.origin}${location.pathname}${search}#/g/${code.toUpperCase()}`;
}
