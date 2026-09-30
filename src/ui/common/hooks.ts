/** Small shared hooks and helpers for the UI. */
import { useCallback, useEffect, useRef, useState } from 'react';

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ');

export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export const useReducedMotion = (): boolean => useMediaQuery('(prefers-reduced-motion: reduce)');
/** The compact phone layout (≤ 640px wide). */
export const usePhone = (): boolean => useMediaQuery('(max-width: 640px)');

/**
 * Tracks which button's request is in flight, so only that button shows a
 * spinner while every action button is disabled via useGame().busy.
 */
export function useRunner(): { pending: string | null; run: (key: string, fn: () => Promise<unknown>) => Promise<void> } {
  const [pending, setPending] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setPending(key);
    try {
      await fn();
    } finally {
      if (alive.current) setPending((k) => (k === key ? null : k));
    }
  }, []);
  return { pending, run };
}

/** localStorage for per-viewer conveniences only (remembered name/colour). Never throws. */
export const prefs = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`akabare:pref:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(`akabare:pref:${key}`);
      else localStorage.setItem(`akabare:pref:${key}`, value);
    } catch {
      // blocked storage: it's only a convenience
    }
  },
};

/** Milliseconds since mount (re-rendered once after `ms`), for grace periods like presence. */
export function useAfter(ms: number): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return done;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
