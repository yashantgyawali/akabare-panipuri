import { describe, expect, test } from 'vitest';
import { DEFAULT_CONFIG, POWER_KINDS, type GameConfig } from './types.ts';
import {
  fullSet,
  isPowerResetRound,
  mulberry32,
  POWER_LABELS,
  randomInt,
  randStream,
  resolveConfig,
  validateConfig,
} from './rules.ts';

const cfg = (patch: Partial<GameConfig>): GameConfig => ({ ...DEFAULT_CONFIG, ...patch });

describe('resolveConfig', () => {
  test('applies defaults', () => {
    expect(resolveConfig({})).toEqual(DEFAULT_CONFIG);
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(resolveConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  test('overrides only known, defined keys (null is a real value)', () => {
    const c = resolveConfig({ targetScore: null, trapReward: 3, minBid: undefined, bogus: 1 } as Partial<GameConfig>);
    expect(c.targetScore).toBeNull();
    expect(c.trapReward).toBe(3);
    expect(c.minBid).toBe(DEFAULT_CONFIG.minBid);
    expect('bogus' in c).toBe(false);
  });

  test('does not share the default object', () => {
    const c = resolveConfig({});
    c.trapReward = 99;
    expect(DEFAULT_CONFIG.trapReward).toBe(2);
  });
});

describe('validateConfig', () => {
  test('defaults are valid', () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
  });

  test('targetScore and maxRounds may be null, but not both', () => {
    expect(validateConfig(cfg({ targetScore: null }))).toEqual([]);
    expect(validateConfig(cfg({ maxRounds: null }))).toEqual([]);
    const errors = validateConfig(cfg({ targetScore: null, maxRounds: null }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/both be null/);
  });

  test.each([
    ['targetScore', 0],
    ['targetScore', 2.5],
    ['maxRounds', -1],
    ['trapReward', -1],
    ['startingStack', 0],
    ['panipuriPerPlayer', 0],
    ['powerFlipsMax', 0],
    ['powerResetRound', 1],
    ['powerResetRound', 6],
    ['minBid', 0],
    ['minBid', '1'],
  ] as const)('rejects %s = %s', (key, value) => {
    const errors = validateConfig(cfg({ [key]: value } as Partial<GameConfig>));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain(key);
  });

  test('trapReward 0 is a valid variant', () => {
    expect(validateConfig(cfg({ trapReward: 0 }))).toEqual([]);
  });

  test('startingStack is at most the set size (panipuriPerPlayer + 1)', () => {
    expect(validateConfig(cfg({ startingStack: 6 }))).toEqual([]);
    expect(validateConfig(cfg({ startingStack: 7 }))[0]).toMatch(/startingStack/);
    expect(validateConfig(cfg({ panipuriPerPlayer: 2, startingStack: 3 }))).toEqual([]);
    expect(validateConfig(cfg({ panipuriPerPlayer: 2, startingStack: 4 }))).toHaveLength(1);
  });

  test('powerResetRound 2..5 keeps at least one power available every round', () => {
    for (const r of [2, 3, 4, 5]) expect(validateConfig(cfg({ powerResetRound: r }))).toEqual([]);
  });

  test('revealOnRoundEnd must be boolean', () => {
    expect(validateConfig(cfg({ revealOnRoundEnd: 'yes' as unknown as boolean }))).toHaveLength(1);
  });

  test('non-object config', () => {
    expect(validateConfig(null as unknown as GameConfig)).toHaveLength(1);
  });
});

describe('power reset cycle', () => {
  test('default (4): rounds 1, 4, 7, 10', () => {
    const resets = Array.from({ length: 12 }, (_, i) => i + 1).filter((r) => isPowerResetRound(r, 4));
    expect(resets).toEqual([1, 4, 7, 10]);
  });

  test('2: every round; 5: rounds 1, 5, 9', () => {
    expect([1, 2, 3, 4].every((r) => isPowerResetRound(r, 2))).toBe(true);
    const resets = Array.from({ length: 10 }, (_, i) => i + 1).filter((r) => isPowerResetRound(r, 5));
    expect(resets).toEqual([1, 5, 9]);
  });
});

describe('mulberry32 PRNG', () => {
  test('pure and deterministic', () => {
    expect(mulberry32(42)).toEqual(mulberry32(42));
    const [a, s1] = mulberry32(42);
    const [b] = mulberry32(s1);
    expect(a).not.toBe(b);
  });

  test('values in [0, 1) and state is uint32', () => {
    let s = 0xffffffff;
    for (let i = 0; i < 1000; i++) {
      const [v, next] = mulberry32(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Number.isInteger(next) && next >= 0 && next <= 0xffffffff).toBe(true);
      s = next;
    }
  });

  test('randomInt is roughly uniform', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    let s = 7;
    for (let i = 0; i < 6000; i++) {
      const [v, next] = randomInt(s, 6);
      counts[v]++;
      s = next;
    }
    for (const c of counts) expect(c).toBeGreaterThan(850);
  });

  test('randStream matches the pure steps and exposes its state', () => {
    const stream = randStream(99);
    const [v1, s1] = mulberry32(99);
    const [v2, s2] = mulberry32(s1);
    expect(stream.rand()).toBe(v1);
    expect(stream.rand()).toBe(v2);
    expect(stream.state()).toBe(s2);
  });
});

test('fullSet deals N Panipuri + 1 Akabare with stable ids', () => {
  expect(fullSet('sita', DEFAULT_CONFIG).map((c) => c.id)).toEqual([
    'sita:p1',
    'sita:p2',
    'sita:p3',
    'sita:p4',
    'sita:p5',
    'sita:a',
  ]);
  expect(fullSet('x', cfg({ panipuriPerPlayer: 2 })).map((c) => c.kind)).toEqual(['panipuri', 'panipuri', 'akabare']);
});

describe('power kinds', () => {
  test('the four powers are Vinegar, Dahi, Naya Plate and Chaat; there is no Khali Puri', () => {
    expect([...POWER_KINDS].sort()).toEqual(['chaat', 'dahi', 'nayaplate', 'vinegar']);
    expect(POWER_LABELS.nayaplate).toBe('Naya Plate');
    expect(Object.values(POWER_LABELS).sort()).toEqual(['Chaat', 'Dahi', 'Naya Plate', 'Vinegar']);
    expect(Object.keys(POWER_LABELS).sort()).toEqual([...POWER_KINDS].sort());
  });
});
