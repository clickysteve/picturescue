/**
 * Seeded randomness. PICTURESCUE's stochastic decisions (rests, random walks, chaotic jumps,
 * pointillist scattering, randomisation) are drawn from the patch's seed, so the same image,
 * patch and seed always give the same performance.
 *
 * Two kinds of draws:
 * - `hashUnit(seed, a, b, c)`: a stateless value for one (region, step, purpose). A step's
 *   decision never depends on what happened before it, so changing one control never shifts
 *   the random choices of every later step.
 * - `makeRng(seed)`: a sequential stream (random-walk paths, randomisation), Mulberry32.
 *
 * Text seeds follow the Slop Factory convention (The Breakery): a typed name is hashed with
 * 32-bit FNV-1a; a plain number is used as it is.
 */

/** 32-bit FNV-1a hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** SplitMix32-style mixing so nearby inputs give unrelated outputs. */
export function mix32(x: number): number {
  x = (x + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** A stateless uniform value in [0, 1) for a seed and up to three integers. */
export function hashUnit(seed: number, a: number, b = 0, c = 0): number {
  let h = mix32(seed >>> 0);
  h = mix32(h ^ Math.imul(a | 0, 0x27d4eb2d));
  h = mix32(h ^ Math.imul(b | 0, 0x165667b1));
  h = mix32(h ^ Math.imul(c | 0, 0x61c88647));
  return h / 4294967296;
}

export interface Rng {
  /** uniform in [0, 1) */
  next(): number;
  /** integer in [0, n) */
  int(n: number): number;
  /** uniform in [a, b) */
  range(a: number, b: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** Mulberry32: small, fast, good enough for music. */
export function makeRng(seed: number): Rng {
  let a = mix32(seed >>> 0);
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + next() * (hi - lo),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)]!,
  };
}

/** An independent stream for one named purpose, derived from a seed. */
export function stream(seed: number, name: string): Rng {
  return makeRng(mix32((seed >>> 0) ^ hashString(name)));
}

/** The seed a typed text stands for: a whole number as it is, anything else hashed. */
export function seedFromText(text: string): number {
  const t = text.trim();
  if (/^\d{1,10}$/.test(t)) return Number(t) >>> 0;
  return hashString(t.toLowerCase());
}

/** A new random seed (UI only: never used inside the engine). */
export function freshSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) % 1000000;
}

const ADJ = ['amber', 'quiet', 'broken', 'velvet', 'electric', 'faded', 'neon', 'paper', 'hollow', 'silver', 'drifting', 'crooked', 'pale', 'restless', 'glass', 'rusty', 'midnight', 'lunar', 'dusty', 'bright'];
const NOUN = ['harbour', 'window', 'orchard', 'signal', 'portrait', 'meadow', 'tower', 'canal', 'pixel', 'lantern', 'mosaic', 'horizon', 'garden', 'circuit', 'skyline', 'quarry', 'forest', 'station', 'mirror', 'ribbon'];

/** A two-word seed name ("velvet harbour"), as The Breakery's DICE gives. */
export function diceName(random: () => number = Math.random): string {
  return `${ADJ[Math.floor(random() * ADJ.length)]} ${NOUN[Math.floor(random() * NOUN.length)]}`;
}
