import { describe, expect, it } from 'vitest';
import type { Features } from '../src/engine/analysis';
import { mapPitch, mapVelocity, regionNotes, sourceValue } from '../src/engine/mapping';
import { inScale, noteName, quantiseToScale, scaleNotes, SCALES } from '../src/engine/scales';
import { defaultPatch, defaultRegion } from '../src/engine/types';

const feat = (o: Partial<Features>): Features => ({ lum: 0.5, sat: 0, hue: 0, alpha: 1, edge: 0, r: 0, g: 0, b: 0, index: 0, ...o });

describe('scales', () => {
  it('has every scale the instrument promises', () => {
    const ids = SCALES.map((s) => s.id);
    for (const id of ['chromatic', 'major', 'minor', 'majorPentatonic', 'minorPentatonic', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'harmonicMinor', 'wholeTone', 'diminished']) expect(ids).toContain(id);
  });

  it('lists scale notes inside a range', () => {
    expect(scaleNotes('major', 0, 60, 72)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(scaleNotes('minorPentatonic', 9, 57, 69)).toEqual([57, 60, 62, 64, 67, 69]);
    // reversed bounds are accepted, out-of-range bounds are clamped
    expect(scaleNotes('chromatic', 0, 2, 0)).toEqual([0, 1, 2]);
    expect(scaleNotes('chromatic', 0, 126, 200)).toEqual([126, 127]);
    // a range with no scale note still gives one
    expect(scaleNotes('majorPentatonic', 0, 65, 65)).toHaveLength(1);
  });

  it('names notes and finds the nearest scale note', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
    expect(quantiseToScale(61, 'major', 0)).toBe(60);
    expect(inScale('dorian', 2, 71)).toBe(true);
  });
});

describe('mapping', () => {
  const notes = scaleNotes('major', 0, 48, 72);

  it('keeps every pitch in range and in the scale (scale locking)', () => {
    for (let v = 0; v <= 1; v += 0.01) {
      for (const src of ['brightness', 'saturation', 'hue', 'colour'] as const) {
        const n = mapPitch(src, feat({ lum: v, sat: v, hue: v * 360, index: Math.floor(v * 15) }), notes, 'major', 0, 16);
        expect(n).toBeGreaterThanOrEqual(48);
        expect(n).toBeLessThanOrEqual(72);
        expect(inScale('major', 0, n)).toBe(true);
      }
    }
  });

  it('brightness runs up the scale: dark is low, light is high, monotonic', () => {
    expect(mapPitch('brightness', feat({ lum: 0 }), notes, 'major', 0, 16)).toBe(48);
    expect(mapPitch('brightness', feat({ lum: 1 }), notes, 'major', 0, 16)).toBe(72);
    let last = -1;
    for (let v = 0; v <= 1; v += 0.05) {
      const n = mapPitch('brightness', feat({ lum: v }), notes, 'major', 0, 16);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });

  it('hue picks the scale degree, brightness the octave; grey falls back to brightness', () => {
    const red = mapPitch('hue', feat({ hue: 0, sat: 1, lum: 0 }), notes, 'major', 0, 16);
    expect(red % 12).toBe(0);
    const blue = mapPitch('hue', feat({ hue: 240, sat: 1, lum: 0 }), notes, 'major', 0, 16);
    expect(blue % 12).not.toBe(0);
    const redLight = mapPitch('hue', feat({ hue: 0, sat: 1, lum: 1 }), notes, 'major', 0, 16);
    expect(redLight).toBeGreaterThan(red);
    expect(redLight % 12).toBe(0);
    const grey = mapPitch('hue', feat({ hue: 200, sat: 0, lum: 1 }), notes, 'major', 0, 16);
    expect(grey).toBe(72);
  });

  it('ST COLOUR gives each palette colour its own note, darkest lowest', () => {
    const seen = new Set<number>();
    let last = -1;
    for (let i = 0; i < 16; i++) {
      const n = mapPitch('colour', feat({ index: i }), notes, 'major', 0, 16);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
      seen.add(n);
    }
    expect(seen.size).toBe(notes.length < 16 ? notes.length : 16);
    expect(sourceValue('colour', feat({ index: 3 }), 1)).toBe(0);
  });

  it('keeps velocity inside its range', () => {
    const r = { ...defaultRegion(0), velMin: 40, velMax: 90 };
    expect(mapVelocity(r, 0)).toBe(40);
    expect(mapVelocity(r, 1)).toBe(90);
    expect(mapVelocity(r, 5)).toBe(90);
    expect(mapVelocity(r, -1)).toBe(40);
    expect(mapVelocity({ ...r, velMin: 1, velMax: 1 }, 0.5)).toBe(1);
  });

  it('a region plays the notes of the global scale between LOW and HIGH', () => {
    const p = defaultPatch();
    const r = { ...p.regions[0]!, low: 60, high: 72 };
    p.scale = 'major';
    p.root = 0;
    expect(regionNotes(p, r)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    p.scale = 'wholeTone';
    p.root = 1;
    expect(regionNotes(p, r)).toEqual([61, 63, 65, 67, 69, 71]);
  });
});
