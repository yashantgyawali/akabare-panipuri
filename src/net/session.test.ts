import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession, createSessionStore, listSessions, loadSession, saveSession } from './session.ts';
import type { Session } from './types.ts';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  } as unknown as Storage;
}

const asha: Session = { code: 'ABCDE', playerId: 'pa', token: 'ta', name: 'Asha' };
const bina: Session = { code: 'ABCDE', playerId: 'pb', token: 'tb', name: 'Bina' };
const other: Session = { code: 'QWERT', playerId: 'pq', token: 'tq', name: 'Q' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('session store', () => {
  it('prefers this tab, and offers the browser-wide session to other tabs', () => {
    const local = memoryStorage();
    const tab1 = createSessionStore(() => local, memoryStorage);
    const tab1Storage = memoryStorage();
    const t1 = createSessionStore(() => local, () => tab1Storage);
    const t2Storage = memoryStorage();
    const t2 = createSessionStore(() => local, () => t2Storage);
    expect(tab1.load('ABCDE')).toBeNull();

    t1.save({ ...asha, code: 'abcde' });
    expect(t1.load('abcde')).toEqual({ session: asha, fromOtherTab: false });
    expect(t2.load('ABCDE')).toEqual({ session: asha, fromOtherTab: true });

    // Tab 2 joins as someone else: each tab keeps its own player.
    t2.save(bina);
    expect(t1.load('ABCDE')).toEqual({ session: asha, fromOtherTab: false });
    expect(t2.load('ABCDE')).toEqual({ session: bina, fromOtherTab: false });
    // The browser-wide default is the latest save.
    const t3 = createSessionStore(() => local, memoryStorage);
    expect(t3.load('ABCDE')).toEqual({ session: bina, fromOtherTab: true });
  });

  it('clears only the matching player, and lists newest first', () => {
    vi.useFakeTimers();
    const local = memoryStorage();
    const tab = memoryStorage();
    const s = createSessionStore(() => local, () => tab);
    vi.setSystemTime(1000);
    s.save(asha);
    vi.setSystemTime(2000);
    s.save(other);
    expect(s.list()).toEqual([other, asha]);

    s.clear('ABCDE', 'someone-else');
    expect(s.load('ABCDE')?.session).toEqual(asha);
    s.clear('abcde', 'pa');
    expect(s.load('ABCDE')).toBeNull();
    expect(s.list()).toEqual([other]);
    s.clear('QWERT');
    expect(s.list()).toEqual([]);
  });

  it('keeps another player’s browser-wide session when this tab’s player is cleared', () => {
    const local = memoryStorage();
    const tabA = memoryStorage();
    const a = createSessionStore(() => local, () => tabA);
    const b = createSessionStore(() => local, memoryStorage);
    a.save(asha);
    b.save(bina); // browser-wide now Bina
    a.clear('ABCDE', 'pa');
    expect(a.load('ABCDE')).toEqual({ session: bina, fromOtherTab: true });
  });

  it('never throws on blocked, missing or corrupted storage', () => {
    const throwing = (): Storage => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const broken = {
      getItem: () => {
        throw new Error('nope');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('nope');
      },
    } as unknown as Storage;
    for (const s of [createSessionStore(throwing, throwing), createSessionStore(() => broken, () => null)]) {
      expect(() => s.save(asha)).not.toThrow();
      expect(s.load('ABCDE')).toBeNull();
      expect(() => s.clear('ABCDE')).not.toThrow();
      expect(s.list()).toEqual([]);
    }

    const local = memoryStorage();
    const tab = memoryStorage();
    local.setItem('akabare:sessions', '{not json');
    tab.setItem('akabare:session:ABCDE', JSON.stringify({ code: 'ABCDE', playerId: '', token: 'x', name: 'x' }));
    const s = createSessionStore(() => local, () => tab);
    expect(s.load('ABCDE')).toBeNull();
    local.setItem('akabare:sessions', JSON.stringify({ ABCDE: asha, BAD: { code: 1 } }));
    expect(s.list()).toEqual([asha]);
  });

  it('default functions use the global localStorage and sessionStorage', () => {
    expect(loadSession('ABCDE')).toBeNull(); // no storage in node: nothing, no throw
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    saveSession(asha);
    expect(loadSession('ABCDE')).toEqual({ session: asha, fromOtherTab: false });
    expect(listSessions()).toEqual([asha]);
    vi.stubGlobal('sessionStorage', memoryStorage()); // a new tab
    expect(loadSession('ABCDE')).toEqual({ session: asha, fromOtherTab: true });
    clearSession('ABCDE', 'pa');
    expect(loadSession('ABCDE')).toBeNull();
  });
});
