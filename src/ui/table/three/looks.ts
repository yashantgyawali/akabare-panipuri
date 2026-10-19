/**
 * The Nepali characters at the table: who wears what. Every look is built in
 * code (Villager.tsx); the player's colour goes on the main garment (waistcoat,
 * kurta, sari, cholo, shawl), so you can tell players apart at a glance.
 */

export type Hat = 'dhaka' | 'bhadgaule' | null;
export type HairStyle = 'short' | 'side' | 'bun' | 'braid';
export type Top = 'daura' | 'kurta' | 'jacket' | 'sari' | 'kurtaF' | 'cholo' | 'shawl';

export interface Look {
  key: string;
  female: boolean;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  hat: Hat;
  top: Top;
  /** Waistcoat over the daura (men). */
  vest?: boolean;
  mustache?: string;
  glasses?: boolean;
  /** Red tika on the forehead. */
  tika?: boolean;
  /** Green bead pote necklace with a gold tilhari. */
  pote?: boolean;
  /** Gold nose stud (phuli). */
  phuli?: boolean;
  bangles?: boolean;
  earrings?: boolean;
  /** An older face: a few lines, rounder cheeks. */
  old?: boolean;
}

const SKIN = { light: '#d9a57b', mid: '#c98e62', warm: '#b8784f', deep: '#9c6440' } as const;

export const LOOKS: Look[] = [
  // Dai: daura-suruwal, a waistcoat in the player's colour, Dhaka topi, moustache.
  { key: 'dai', female: false, skin: SKIN.mid, hair: '#1b1410', hairStyle: 'short', hat: 'dhaka', top: 'daura', vest: true, mustache: '#1b1410' },
  // Didi: sari with a gold border and pallu, bun, tika, pote, nose stud, bangles.
  { key: 'didi', female: true, skin: SKIN.light, hair: '#140f0c', hairStyle: 'bun', hat: null, top: 'sari', tika: true, pote: true, phuli: true, bangles: true, earrings: true },
  // Bhai: kurta in the player's colour, Dhaka topi, clean shaven.
  { key: 'bhai', female: false, skin: SKIN.warm, hair: '#16110d', hairStyle: 'short', hat: 'dhaka', top: 'kurta' },
  // Bahini: kurta-suruwal with a dupatta, long braid with a red dhago, tika, earrings.
  { key: 'bahini', female: true, skin: SKIN.mid, hair: '#120d0a', hairStyle: 'braid', hat: null, top: 'kurtaF', tika: true, earrings: true, bangles: true },
  // Hajurba: black Bhadgaule topi, daura, coat in the player's colour, grey moustache, glasses.
  { key: 'hajurba', female: false, skin: SKIN.warm, hair: '#9a948c', hairStyle: 'short', hat: 'bhadgaule', top: 'daura', vest: true, mustache: '#c9c3ba', glasses: true, old: true },
  // Hajurama: grey bun, shawl in the player's colour, glasses, tika, pote.
  { key: 'hajurama', female: true, skin: SKIN.mid, hair: '#b9b3aa', hairStyle: 'bun', hat: null, top: 'shawl', tika: true, pote: true, glasses: true, phuli: true, old: true },
  // Kancha: jacket over a tee, side-parted hair.
  { key: 'kancha', female: false, skin: SKIN.deep, hair: '#130e0b', hairStyle: 'side', hat: null, top: 'jacket' },
  // Maya: gunyu-cholo with the crossed tie, patuka sash, braid, tika, pote, bangles.
  { key: 'cholo', female: true, skin: SKIN.warm, hair: '#130e0b', hairStyle: 'braid', hat: null, top: 'cholo', tika: true, pote: true, bangles: true, phuli: true },
];

const FEMALE_NAMES = new Set(
  ['sita', 'priya', 'maya', 'gita', 'rita', 'sunita', 'anita', 'puja', 'pooja', 'sarita', 'kamala', 'laxmi', 'lakshmi', 'radha', 'asha', 'nisha', 'sabina', 'srijana', 'sushma', 'bimala', 'parbati', 'durga', 'shanti', 'manisha', 'sapana', 'sangita', 'samjhana', 'roshani', 'anjali', 'kabita', 'kavita', 'pratima', 'binita', 'yashoda'],
);
const MALE_NAMES = new Set(['ramesh', 'anil', 'hari', 'bikash', 'ram', 'shyam', 'krishna', 'suresh', 'rajesh', 'dipak', 'deepak', 'prakash', 'santosh', 'bishnu', 'gopal', 'kiran', 'sanjay', 'yashant', 'yash']);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A stable look for a player: men's looks for known male names, women's for
 * known female names (the bots are Sita, Ramesh, Anil, Priya, Maya, Hari, Gita,
 * Bikash), otherwise by a hash of the player id. Looks already taken at the
 * table are skipped when possible, so no two players look the same.
 */
export function lookFor(player: { id: string; name: string }, taken: Set<string>): Look {
  const first = player.name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const pool = FEMALE_NAMES.has(first) ? LOOKS.filter((l) => l.female) : MALE_NAMES.has(first) ? LOOKS.filter((l) => !l.female) : LOOKS;
  const h = hash(player.id + first);
  for (let k = 0; k < pool.length; k++) {
    const l = pool[(h + k) % pool.length];
    if (!taken.has(l.key)) return l;
  }
  return pool[h % pool.length];
}

/** Looks for everyone at the table, in seat order, without repeats while possible. */
export function looksForTable(players: { id: string; name: string; seat: number }[]): Map<string, Look> {
  const taken = new Set<string>();
  const out = new Map<string, Look>();
  for (const p of [...players].sort((a, b) => a.seat - b.seat)) {
    const l = lookFor(p, taken);
    taken.add(l.key);
    out.set(p.id, l);
  }
  return out;
}
