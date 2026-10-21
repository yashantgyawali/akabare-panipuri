/** The regulars around the tavern table on the screens before a game. */
import { COLORS, type ColorId } from '../../engine/types.ts';
import type { Guest } from './TavernCanvas.tsx';

const CAST = ['Sita', 'Ramesh', 'Anil', 'Priya'];

/** The regulars in the colours you're not wearing, then you (last, so their looks never change as you type). */
export function castWith(you: { name: string; color: ColorId } | null): Guest[] {
  const taken = you?.color;
  const colors = COLORS.filter((c) => c !== taken);
  const regulars: Guest[] = CAST.map((name, i) => ({ id: `cast-${name}`, name, color: colors[i] }));
  return you ? [...regulars, { id: 'you', name: you.name.trim() || 'You', color: you.color, you: true }] : regulars;
}
