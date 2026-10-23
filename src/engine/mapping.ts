/**
 * Mapping: from a cell's measurements to musical values. Small pure functions, each
 * deterministic: the same features and settings always give the same note.
 */
import type { Features } from './analysis';
import { quantiseToScale, scaleById, scaleNotes, scaleNotesStrict } from './scales';
import type { CcSource, Patch, PitchSource, RegionSettings, VelSource } from './types';

/** Below this saturation a colour has no meaningful hue: HUE falls back to brightness. */
export const GREY_SAT = 0.08;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** Edge strength as felt: average Sobel magnitudes are small, so they are scaled up. */
export const edgeAmount = (f: Features): number => clamp01(f.edge * 3);

/** The 0..1 value a pitch source reads from a cell. */
export function sourceValue(src: PitchSource, f: Features, paletteSize: number): number {
  switch (src) {
    case 'brightness':
      return clamp01(f.lum);
    case 'saturation':
      return clamp01(f.sat);
    case 'hue':
      return f.sat < GREY_SAT ? clamp01(f.lum) : clamp01(f.hue / 360);
    case 'colour':
      return paletteSize > 1 ? clamp01(f.index / (paletteSize - 1)) : 0;
  }
}

export function velocitySource(src: VelSource, f: Features): number {
  switch (src) {
    case 'saturation':
      return clamp01(f.sat);
    case 'brightness':
      return clamp01(f.lum);
    case 'edges':
      return edgeAmount(f);
    case 'fixed':
      return 0.75;
  }
}

export function ccSource(src: CcSource, f: Features): number | null {
  switch (src) {
    case 'off':
      return null;
    case 'hue':
      return f.sat < GREY_SAT ? 0 : clamp01(f.hue / 360);
    case 'brightness':
      return clamp01(f.lum);
    case 'saturation':
      return clamp01(f.sat);
    case 'edges':
      return edgeAmount(f);
  }
}

/**
 * Everything the final pitch stage needs for one region, from the ONE global scale and root
 * (`Patch.scale`, `Patch.root`) and the region's own LOW / HIGH, TRANSPOSE and OCTAVE.
 */
export interface PitchSetup {
  scale: string;
  root: number;
  /** playable range, 0..127, low <= high (a reversed range is swapped) */
  lo: number;
  hi: number;
  /** TRANSPOSE + 12 * OCTAVE, in semitones */
  shift: number;
  /** the scale notes inside [lo, hi], ascending, never empty */
  notes: number[];
  /** false only when no scale note lies inside [lo, hi]: `notes` is then the one nearest note, just outside */
  inRange: boolean;
}

export function pitchSetup(p: Pick<Patch, 'scale' | 'root'>, r: Pick<RegionSettings, 'low' | 'high' | 'transpose' | 'octave'>): PitchSetup {
  const lo = clamp(Math.round(Math.min(r.low, r.high)), 0, 127);
  const hi = clamp(Math.round(Math.max(r.low, r.high)), 0, 127);
  const strict = scaleNotesStrict(p.scale, p.root, lo, hi);
  return { scale: p.scale, root: p.root, lo, hi, shift: r.transpose + 12 * r.octave, notes: strict.length ? strict : scaleNotes(p.scale, p.root, lo, hi), inRange: strict.length > 0 };
}

/** The notes a region may play: the global scale's notes between LOW and HIGH. */
export function regionNotes(p: Pick<Patch, 'scale' | 'root'>, r: Pick<RegionSettings, 'low' | 'high'>): number[] {
  return pitchSetup(p, { low: r.low, high: r.high, transpose: 0, octave: 0 }).notes;
}

/** Circular distance between two pitch classes, 0..6. */
const pcDistance = (a: number, b: number): number => {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
};

/**
 * Bring a scale note into [lo, hi] by whole octaves (which keeps it in the scale). If the range
 * is narrower than an octave and has no octave of this note, take the in-range scale note whose
 * pitch class is nearest (ties: the one nearer the middle of the range, then the lower), so a
 * contour spreads over the range instead of piling on one boundary note.
 */
function foldIntoRange(note: number, s: PitchSetup): number {
  if (!s.inRange) return s.notes[0]!;
  if (note >= s.lo && note <= s.hi) return note;
  let n = note;
  while (n > s.hi) n -= 12;
  while (n < s.lo) n += 12;
  if (n >= s.lo && n <= s.hi) return n;
  const mid = (s.lo + s.hi) / 2;
  let best = s.notes[0]!;
  for (const c of s.notes) {
    const d = pcDistance(c, note);
    const bd = pcDistance(best, note);
    if (d < bd || (d === bd && Math.abs(c - mid) < Math.abs(best - mid))) best = c;
  }
  return best;
}

/**
 * THE final pitch stage: every note PICTURESCUE plays (live, exported, internal sounds) is
 * made here, from the pitch a mapping or mode picked (`raw`, a note of the region's range):
 *
 *   1. shift      raw + TRANSPOSE + 12 * OCTAVE semitones (the contour moves as a whole)
 *   2. quantise   to the nearest note of the global scale (ties follow the shift's direction)
 *   3. fold       into LOW..HIGH by whole octaves (never a clamp onto one boundary note)
 *
 * so the result is always a note of the global scale inside the region's range. Only if the
 * range holds no scale note at all is the result (the nearest scale note) outside it.
 */
export function resolvePitch(raw: number, s: PitchSetup): number {
  const q = quantiseToScale(raw + s.shift, s.scale, s.root, Math.sign(s.shift));
  return clamp(foldIntoRange(q, s), 0, 127);
}

/** Index into a list of n items for a 0..1 value (1 maps to the last). */
export const pickIndex = (v: number, n: number): number => clamp(Math.floor(clamp01(v) * n), 0, n - 1);

/**
 * A pitch for a cell. Brightness, saturation and ST colour run up the region's notes; HUE
 * chooses the scale degree from the hue (the colour wheel goes once round the scale) and the
 * octave from the brightness, so red and orange are neighbouring degrees and light colours
 * sound higher.
 */
export function mapPitch(src: PitchSource, f: Features, notes: readonly number[], scaleId: string, root: number, paletteSize: number): number {
  if (src === 'hue' && f.sat >= GREY_SAT) {
    const steps = scaleById(scaleId).steps;
    const deg = pickIndex(f.hue / 360, steps.length);
    const pc = (root + steps[deg]!) % 12;
    const candidates = notes.filter((n) => n % 12 === pc);
    if (candidates.length) return candidates[pickIndex(f.lum, candidates.length)]!;
  }
  return notes[pickIndex(sourceValue(src, f, paletteSize), notes.length)]!;
}

/** Velocity inside the region's range. */
export function mapVelocity(r: RegionSettings, v: number): number {
  return clamp(Math.round(r.velMin + clamp01(v) * (r.velMax - r.velMin)), 1, 127);
}

/** The note in `notes` nearest to `target` (ties go down). */
export function nearestNote(notes: readonly number[], target: number): number {
  let best = notes[0]!;
  for (const n of notes) if (Math.abs(n - target) < Math.abs(best - target)) best = n;
  return best;
}

/** Mapping presets: named combinations of the four mapping choices. */
export interface MappingPreset {
  id: string;
  label: string;
  tip: string;
  set: Pick<RegionSettings, 'pitchFrom' | 'velFrom' | 'trigger' | 'ccFrom'>;
}

export const MAPPING_PRESETS: MappingPreset[] = [
  { id: 'bright-pitch', label: 'BRIGHTNESS → PITCH', tip: 'Light is high, dark is low; saturation is loudness', set: { pitchFrom: 'brightness', velFrom: 'saturation', trigger: 'every', ccFrom: 'off' } },
  { id: 'hue-pitch', label: 'HUE → PITCH', tip: 'The colour wheel goes round the scale; brightness picks the octave', set: { pitchFrom: 'hue', velFrom: 'saturation', trigger: 'every', ccFrom: 'off' } },
  { id: 'st-colours', label: 'EACH COLOUR A NOTE', tip: 'The original idea: the 16-colour palette climbs the scale, darkest colour lowest (colours share a note when the range has fewer than 16)', set: { pitchFrom: 'colour', velFrom: 'fixed', trigger: 'every', ccFrom: 'off' } },
  { id: 'edges-rhythm', label: 'EDGES → RHYTHM', tip: 'Notes where the picture has edges; edge strength is loudness', set: { pitchFrom: 'brightness', velFrom: 'edges', trigger: 'edges', ccFrom: 'off' } },
  { id: 'colour-changes', label: 'COLOUR CHANGES → NOTES', tip: 'A note whenever the colour changes noticeably', set: { pitchFrom: 'hue', velFrom: 'edges', trigger: 'change', ccFrom: 'off' } },
  { id: 'detail-density', label: 'DETAIL → DENSITY', tip: 'Busy areas play often, plain areas rarely', set: { pitchFrom: 'brightness', velFrom: 'edges', trigger: 'detail', ccFrom: 'off' } },
  { id: 'bright-velocity', label: 'BRIGHTNESS → VELOCITY', tip: 'The ST colour chooses the note, brightness how hard it is played', set: { pitchFrom: 'colour', velFrom: 'brightness', trigger: 'every', ccFrom: 'off' } },
  { id: 'hue-cc', label: 'HUE → CC', tip: 'Brightness plays the notes while hue sweeps a controller (cutoff, CC 74)', set: { pitchFrom: 'brightness', velFrom: 'saturation', trigger: 'every', ccFrom: 'hue' } },
];

/** The preset a region's mapping matches, if any. */
export function matchingPreset(r: RegionSettings): string {
  return MAPPING_PRESETS.find((m) => m.set.pitchFrom === r.pitchFrom && m.set.velFrom === r.velFrom && m.set.trigger === r.trigger && m.set.ccFrom === r.ccFrom)?.id ?? '';
}
