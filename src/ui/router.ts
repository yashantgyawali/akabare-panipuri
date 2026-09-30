/**
 * Hash routes (no router library):
 *   #/            home
 *   #/g/<CODE>    game (lobby, then the table)
 *   #/rules       rules
 *   #/cards       card gallery
 * Anything else is home.
 */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'game'; code: string }
  | { name: 'rules' }
  | { name: 'cards' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const game = /^\/g\/([A-Za-z0-9]{1,12})\/?$/.exec(h);
  if (game) return { name: 'game', code: game[1].toUpperCase() };
  if (/^\/rules\/?$/.test(h)) return { name: 'rules' };
  if (/^\/cards\/?$/.test(h)) return { name: 'cards' };
  return { name: 'home' };
}

const currentRoute = (): Route => parseHash(typeof location === 'undefined' ? '' : location.hash);

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const on = () => setRoute(currentRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const HOME = '#/';
export const RULES = '#/rules';
export const gameHref = (code: string): string => `#/g/${code.toUpperCase()}`;

export function navigate(href: string): void {
  if (location.hash === href) return;
  location.hash = href;
}
