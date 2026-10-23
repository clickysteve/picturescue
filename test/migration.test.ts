/** Opening older patches (format v1: a scale and root per region) in the one-global-scale format (v2). */
import { describe, expect, it } from 'vitest';
import { FACTORY } from '../src/engine/factory';
import { renderPerformance } from '../src/engine/performance';
import { inScale } from '../src/engine/scales';
import { scaleNotesStrict } from '../src/engine/scales';
import { defaultPatch, PATCH_VERSION, PPQ } from '../src/engine/types';
import { parsePatch, PatchError, serialisePatch } from '../src/persistence/patchfile';
import { demoAnalysis } from './helpers';

/** A v1 patch as the first release wrote it: every region carried globalScale, scale and root. */
function v1Patch(over: Record<string, unknown> = {}, regionOver: Record<string, unknown>[] = []): string {
  const base = JSON.parse(serialisePatch(defaultPatch())) as Record<string, unknown> & { regions: Record<string, unknown>[] };
  base.version = 1;
  base.name = 'Old Patch';
  base.regions = base.regions.map((r, i) => ({ ...r, globalScale: i % 2 === 0, scale: ['phrygian', 'wholeTone', 'diminished', 'lydian'][i], root: [4, 1, 6, 11][i], ...regionOver[i] }));
  return JSON.stringify({ ...base, ...over });
}

describe('opening older patches', () => {
  it('loads a v1 patch with region scale overrides, keeping the global scale and root', () => {
    const { patch, warnings } = parsePatch(v1Patch({ scale: 'dorian', root: 2 }));
    expect(warnings).toEqual([]);
    expect(patch.scale).toBe('dorian');
    expect(patch.root).toBe(2);
    expect(patch.version).toBe(PATCH_VERSION);
    for (const r of patch.regions) {
      expect(r).not.toHaveProperty('scale');
      expect(r).not.toHaveProperty('root');
      expect(r).not.toHaveProperty('globalScale');
    }
  });

  it('keeps every other region setting, the geometry and the picture', () => {
    const custom = [0, 1, 2, 3].map((i) => ({ x: 0.1 * i, y: 0.05 * i, w: 0.4, h: 0.3, channel: 10 - i, mode: ['drone', 'chaotic', 'ambient', 'rhythmic'][i], low: 40 + i, high: 80 + i, transpose: i - 1, octave: 1 - i, gate: 1.5 + i, sound: ['bell', 'pad', 'sine', 'perc'][i], ccFrom: 'hue', velMin: 20 + i, velMax: 100 + i }));
    const embedded = { kind: 'embedded', name: 'old.png', width: 3, height: 2, encoding: 'rgba-delta-deflate', data: 'eJxjYGBgAAAABAAB', originalW: 900, originalH: 600 };
    const { patch } = parsePatch(v1Patch({ image: embedded, bpm: 99, seed: 4242, seedText: 'old seed', swing: 0.2, loop: false, stepsPerBeat: 3 }, custom));
    expect(patch.image).toEqual(embedded);
    expect([patch.bpm, patch.seed, patch.seedText, patch.swing, patch.loop, patch.stepsPerBeat]).toEqual([99, 4242, 'old seed', 0.2, false, 3]);
    custom.forEach((c, i) => {
      const r = patch.regions[i]!;
      expect({ x: r.x, y: r.y, w: r.w, h: r.h, channel: r.channel, mode: r.mode, low: r.low, high: r.high, transpose: r.transpose, octave: r.octave, gate: r.gate, sound: r.sound, ccFrom: r.ccFrom, velMin: r.velMin, velMax: r.velMax }).toEqual(c);
    });
  });

  it('ignores the obsolete overrides when playing: every region uses the global scale', () => {
    // the old patch's region overrides (phrygian, whole tone, diminished, lydian) must not be heard
    const { patch } = parsePatch(v1Patch({ scale: 'majorPentatonic', root: 0 }));
    const ev = renderPerformance(patch, demoAnalysis('st-lowres'), PPQ * 16).filter((e) => e.type === 'on');
    expect(ev.length).toBeGreaterThan(20);
    expect(new Set(ev.map((e) => (e as { region: number }).region)).size).toBe(4);
    for (const e of ev) expect(inScale('majorPentatonic', 0, (e as { note: number }).note)).toBe(true);
  });

  it('saves new patches without obsolete fields, as v2', () => {
    const { patch } = parsePatch(v1Patch({ scale: 'lydian', root: 5 }));
    const text = serialisePatch(patch);
    expect(text).not.toContain('globalScale');
    const o = JSON.parse(text) as { version: number; scale: string; root: number; regions: Record<string, unknown>[] };
    expect(o.version).toBe(2);
    expect([o.scale, o.root]).toEqual(['lydian', 5]);
    for (const r of o.regions) expect(Object.keys(r).filter((k) => ['scale', 'root', 'globalScale'].includes(k))).toEqual([]);
    // and reads back identically
    expect(parsePatch(text).patch).toEqual(patch);
  });

  it('uses the new defaults (C minor pentatonic) when a patch has no global harmony', () => {
    const o = JSON.parse(v1Patch()) as Record<string, unknown>;
    delete o.scale;
    delete o.root;
    const { patch } = parsePatch(JSON.stringify(o));
    expect([patch.scale, patch.root]).toEqual(['minorPentatonic', 0]);
    expect([defaultPatch().scale, defaultPatch().root]).toEqual(['minorPentatonic', 0]);
    // unusable values fall back to the defaults too
    const bad = parsePatch(v1Patch({ scale: 'klingon', root: 'F' })).patch;
    expect([bad.scale, bad.root]).toEqual(['minorPentatonic', 0]);
  });

  it('keeps an old default-looking global setting (A minor pentatonic) as the user left it', () => {
    const { patch } = parsePatch(v1Patch({ scale: 'minorPentatonic', root: 9 }));
    expect([patch.scale, patch.root]).toEqual(['minorPentatonic', 9]);
  });

  it('does not fail on unknown or future fields, and still refuses a newer format', () => {
    const o = JSON.parse(v1Patch()) as Record<string, unknown> & { regions: Record<string, unknown>[] };
    o.somethingNew = { a: 1 };
    o.regions[0]!.futureKnob = 7;
    expect(() => parsePatch(JSON.stringify(o))).not.toThrow();
    o.version = PATCH_VERSION + 1;
    expect(() => parsePatch(JSON.stringify(o))).toThrow(PatchError);
  });

  it('the preset the app opens with uses the default global scale, C minor pentatonic', () => {
    const p = FACTORY[0]!.make();
    expect(FACTORY[0]!.id).toBe('picture-music');
    expect([p.scale, p.root]).toEqual(['minorPentatonic', 0]);
  });

  it('factory presets carry no region scale, and every region has scale notes in its range', () => {
    for (const f of FACTORY) {
      const p = f.make();
      expect(serialisePatch(p)).not.toContain('globalScale');
      for (const r of p.regions) {
        expect(r).not.toHaveProperty('scale');
        expect(r).not.toHaveProperty('root');
        expect(scaleNotesStrict(p.scale, p.root, r.low, r.high).length, `${f.id}: ${p.scale} root ${p.root} has no note in ${r.low}..${r.high}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
