/**
 * Scales. Slop Factory Core has no shared scale module, so PICTURESCUE keeps its own small
 * table (the same pitch-class sets and ids as emmm's, so names match across the family).
 *
 * A scale is a set of pitch classes above a root. `scaleNotes` lists the MIDI notes of a scale
 * inside a range; the mapping layer picks from that list, so every note is in the scale by
 * construction (scale locking) and a value always maps to the same note (determinism).
 */

export interface Scale {
  id: string;
  name: string;
  short: string;
  /** semitone offsets from the root, ascending, starting with 0 */
  steps: readonly number[];
}

export const SCALES: readonly Scale[] = [
  { id: 'chromatic', name: 'Chromatic', short: 'CHROM', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'major', name: 'Major', short: 'MAJOR', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Natural Minor', short: 'MINOR', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'majorPentatonic', name: 'Pentatonic Major', short: 'PENT MAJ', steps: [0, 2, 4, 7, 9] },
  { id: 'minorPentatonic', name: 'Pentatonic Minor', short: 'PENT MIN', steps: [0, 3, 5, 7, 10] },
  { id: 'dorian', name: 'Dorian', short: 'DORIAN', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygian', short: 'PHRYG', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', short: 'LYDIAN', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian', short: 'MIXOLYD', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'harmonicMinor', name: 'Harmonic Minor', short: 'HARM MIN', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'wholeTone', name: 'Whole Tone', short: 'WHOLE T', steps: [0, 2, 4, 6, 8, 10] },
  { id: 'diminished', name: 'Diminished (half-whole)', short: 'DIMIN', steps: [0, 1, 3, 4, 6, 7, 9, 10] },
];

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function scaleById(id: string): Scale {
  return SCALES.find((s) => s.id === id) ?? SCALES[0]!;
}

/** "C4" for 60 (middle C = C4). */
export function noteName(n: number): string {
  const p = Math.round(n);
  return NOTE_NAMES[((p % 12) + 12) % 12] + String(Math.floor(p / 12) - 1);
}

export function inScale(scaleId: string, root: number, pitch: number): boolean {
  const pc = (((pitch - root) % 12) + 12) % 12;
  return scaleById(scaleId).steps.includes(pc);
}

/** Equal-tempered frequency of a MIDI note: 440 Hz at 69 (A4), so 60 is middle C (261.63 Hz). */
export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * The scale note nearest to a pitch (any integer, including outside 0..127 unless `min` / `max`
 * bound it). A pitch already in the scale is returned as it is. When two scale notes are equally
 * near, the tie goes in the direction of travel: up for `dir > 0` (the pitch was shifted up),
 * down for `dir < 0`, and for `dir = 0` toward middle C. So shifting a contour up never lands
 * lower than shifting it down, and no tie rule leans one way overall.
 */
export function quantiseToScale(pitch: number, scaleId: string, root: number, dir = 0, min = -Infinity, max = Infinity): number {
  const p = Math.round(pitch);
  const ok = (n: number) => n >= min && n <= max && inScale(scaleId, root, n);
  if (ok(p)) return p;
  for (let d = 1; d <= 12; d++) {
    const lo = ok(p - d);
    const hi = ok(p + d);
    if (lo && hi) return dir > 0 ? p + d : dir < 0 ? p - d : p < 60 ? p + d : p - d;
    if (lo) return p - d;
    if (hi) return p + d;
  }
  return Math.max(min, Math.min(max, p));
}

/** The scale notes inside [low, high] (inclusive, either order, limited to 0..127), ascending. May be empty. */
export function scaleNotesStrict(scaleId: string, root: number, low: number, high: number): number[] {
  const lo = Math.max(0, Math.min(127, Math.round(Math.min(low, high))));
  const hi = Math.max(0, Math.min(127, Math.round(Math.max(low, high))));
  const out: number[] = [];
  for (let p = lo; p <= hi; p++) if (inScale(scaleId, root, p)) out.push(p);
  return out;
}

/**
 * The MIDI notes of a scale from `low` to `high` inclusive (ascending). Never empty: a range
 * with no scale note in it (a very narrow range between two scale notes) gives the one scale
 * note nearest to its middle, just outside the range.
 */
export function scaleNotes(scaleId: string, root: number, low: number, high: number): number[] {
  const out = scaleNotesStrict(scaleId, root, low, high);
  if (out.length) return out;
  return [quantiseToScale((Math.min(low, high) + Math.max(low, high)) / 2, scaleId, root, 0, 0, 127)];
}
