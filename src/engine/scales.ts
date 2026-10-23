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

/** The MIDI notes of a scale from `low` to `high` inclusive (ascending). Never empty: a range
 * containing no scale note gives the scale note nearest to its middle. */
export function scaleNotes(scaleId: string, root: number, low: number, high: number): number[] {
  const lo = Math.max(0, Math.min(127, Math.round(Math.min(low, high))));
  const hi = Math.max(0, Math.min(127, Math.round(Math.max(low, high))));
  const out: number[] = [];
  for (let p = lo; p <= hi; p++) if (inScale(scaleId, root, p)) out.push(p);
  if (!out.length) out.push(nearestInScale(scaleId, root, (lo + hi) / 2));
  return out;
}

/** The scale note nearest to a pitch (ties go down). */
export function nearestInScale(scaleId: string, root: number, pitch: number): number {
  const p = Math.round(pitch);
  for (let d = 0; d < 12; d++) {
    if (p - d >= 0 && inScale(scaleId, root, p - d)) return p - d;
    if (p + d <= 127 && inScale(scaleId, root, p + d)) return p + d;
  }
  return Math.max(0, Math.min(127, p));
}
