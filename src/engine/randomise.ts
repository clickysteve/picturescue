/**
 * Controlled randomisation. Every draw comes from a seed, so a randomisation can be replayed;
 * the categories a user locks are never touched; hardware settings (MIDI ports, channels) and
 * the picture are never randomised.
 *
 * Draws are musically weighted rather than uniform: ranges stay playable (at least an octave,
 * inside MIDI), rates favour the transport's own, densities avoid both silence and note spam,
 * and each interpretation mode gets a scan and trigger that suit it.
 */
import { layoutRects, LAYOUTS, clampRect } from './regions';
import { stream, type Rng } from './rng';
import { SCALES } from './scales';
import { MODES, PITCH_SOURCES, SCAN_MODES, TRIGGERS, VEL_SOURCES, type InterpMode, type Patch, type RegionSettings, type ScanMode, type Trigger } from './types';

export const RANDOM_CATEGORIES = ['positions', 'mappings', 'scans', 'density', 'ranges', 'rates', 'modes', 'scales'] as const;
export type RandomCategory = (typeof RANDOM_CATEGORIES)[number];
export const RANDOM_LABEL: Record<RandomCategory, string> = {
  positions: 'REGION POSITIONS',
  mappings: 'MAPPINGS',
  scans: 'SCAN DIRECTIONS',
  density: 'DENSITY',
  ranges: 'NOTE RANGES',
  rates: 'SCAN RATES',
  modes: 'MODES',
  scales: 'SCALE / ROOT',
};
export type Locks = Record<RandomCategory, boolean>;
export const noLocks = (): Locks => Object.fromEntries(RANDOM_CATEGORIES.map((c) => [c, false])) as Locks;

/** Scans and triggers that suit each mode (drawn from first; any is still possible). */
const SUITS: Record<InterpMode, { scans: ScanMode[]; triggers: Trigger[] }> = {
  melodic: { scans: ['horizontal', 'serpentine', 'pingpong'], triggers: ['every', 'threshold', 'detail'] },
  rhythmic: { scans: ['horizontal', 'vertical', 'serpentine'], triggers: ['edges', 'change'] },
  ambient: { scans: ['vertical', 'spiral', 'randomwalk'], triggers: ['every', 'change'] },
  pointillist: { scans: ['randomwalk', 'spiral', 'horizontal'], triggers: ['detail', 'every'] },
  drone: { scans: ['spiral', 'vertical', 'randomwalk'], triggers: ['every'] },
  chaotic: { scans: ['randomwalk', 'pingpong', 'serpentine'], triggers: ['every', 'detail'] },
};

const weighted = <T>(rng: Rng, preferred: readonly T[], all: readonly T[], p = 0.75): T => (rng.chance(p) ? rng.pick(preferred) : rng.pick(all));

function randomRegion(r: RegionSettings, i: number, rng: Rng, locks: Locks, wild: boolean): void {
  if (!locks.modes) r.mode = rng.pick(MODES);
  const suit = SUITS[r.mode];
  if (!locks.positions) {
    if (rng.chance(wild ? 0.6 : 0.4)) {
      const w = rng.range(0.2, 0.7);
      const h = rng.range(0.2, 0.7);
      Object.assign(r, clampRect({ x: rng.range(0, 1 - w), y: rng.range(0, 1 - h), w, h }));
    } else Object.assign(r, layoutRects(LAYOUTS[0])[i]!);
  }
  if (!locks.mappings) {
    r.pitchFrom = rng.pick(PITCH_SOURCES);
    r.velFrom = weighted(rng, ['saturation', 'brightness', 'edges'], VEL_SOURCES, 0.85);
    r.trigger = weighted(rng, suit.triggers, TRIGGERS);
    r.ccFrom = rng.chance(0.3) ? rng.pick(['hue', 'brightness', 'saturation', 'edges'] as const) : 'off';
  }
  if (!locks.scans) {
    r.scan = weighted(rng, suit.scans, SCAN_MODES.filter((s) => s !== 'manual'));
    r.reverse = rng.chance(0.25);
    r.cols = rng.pick([4, 8, 8, 12, 16, 16, 24, 32]);
    r.rows = rng.pick([2, 4, 4, 6, 8, 8, 12]);
    r.offset = wild && rng.chance(0.3) ? rng.int(r.cols * r.rows) : 0;
  }
  if (!locks.density) {
    const base = r.mode === 'chaotic' ? 0.6 : r.mode === 'pointillist' || r.mode === 'drone' ? 0.35 : 0.55;
    r.density = Math.round(Math.max(0.1, Math.min(1, base + rng.range(-0.25, 0.3))) * 100) / 100;
    r.threshold = Math.round(rng.range(0.1, 0.6) * 100) / 100;
    r.rest = Math.round(rng.range(0, 0.3) * 100) / 100;
    r.gate = r.mode === 'ambient' || r.mode === 'drone' ? rng.pick([2, 4, 8]) : rng.pick([0.25, 0.5, 1, 1, 2]);
  }
  if (!locks.ranges) {
    const low = r.mode === 'drone' ? 36 + rng.int(12) : 36 + rng.int(36);
    const span = 12 + rng.int(r.mode === 'pointillist' ? 37 : 25);
    r.low = low;
    r.high = Math.min(120, low + span);
  }
  if (!locks.rates) r.rate = rng.chance(0.55) ? 2 : rng.pick([0, 1, 1, 3]);
}

/**
 * Randomise a patch in place from a seed. WILDCARD also draws the one global scale and root
 * (unless SCALE / ROOT is locked) and the swing.
 */
export function randomisePatch(p: Patch, seed: number, locks: Locks = noLocks(), wild = false): void {
  const rng = stream(seed, wild ? 'wildcard' : 'randomise');
  if (!locks.scales && wild) {
    p.scale = rng.pick(SCALES.filter((s) => s.id !== 'chromatic')).id;
    p.root = rng.int(12);
  }
  if (wild && !locks.rates) p.swing = rng.chance(0.35) ? Math.round(rng.range(0.05, 0.3) * 100) / 100 : 0;
  p.regions.forEach((r, i) => {
    randomRegion(r, i, stream(seed, `${wild ? 'wild' : 'rnd'}-region-${i}`), locks, wild);
  });
}
