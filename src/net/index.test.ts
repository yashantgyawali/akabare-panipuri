import { afterEach, describe, expect, it, vi } from 'vitest';

const at = (search: string) => ({ origin: 'https://akabare.test', pathname: '/play/', search });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getGameClient / shareUrl', () => {
  it('uses the local client when Supabase is not configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.stubGlobal('location', at(''));
    const net = await import('./index.ts');
    expect(net.isLocalMode()).toBe(true);
    const client = net.getGameClient();
    expect(client.mode).toBe('local');
    expect(net.getGameClient()).toBe(client);
    expect(net.shareUrl('abcde')).toBe('https://akabare.test/play/#/g/ABCDE');
  });

  it('uses Supabase when configured, unless ?local forces local mode', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubGlobal('location', at('?x=1'));
    const net = await import('./index.ts');
    expect(net.isLocalMode()).toBe(false);
    expect(net.getGameClient().mode).toBe('supabase');
    expect(net.shareUrl('ABCDE')).toBe('https://akabare.test/play/#/g/ABCDE');

    vi.stubGlobal('location', at('?local'));
    expect(net.isLocalMode()).toBe(true);
    // Keeps ?local so the link opens the same (local) game.
    expect(net.shareUrl('ABCDE')).toBe('https://akabare.test/play/?local#/g/ABCDE');
  });
});
