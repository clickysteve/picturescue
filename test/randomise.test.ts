import { describe, expect, it } from 'vitest';
import { randomisePatch, noLocks, RANDOM_CATEGORIES } from '../src/engine/randomise';
import { applyRect, clampRect, layoutRects, LAYOUTS, moveRect, regionAt, resizeRect } from '../src/engine/regions';
import { diceName, hashString, hashUnit, makeRng, seedFromText } from '../src/engine/rng';
import { clonePatch, defaultPatch, sanitisePatch } from '../src/engine/types';

describe('seeds', () => {
  it('turn text into seeds the Slop Factory way', () => {
    expect(seedFromText('1234')).toBe(1234);
    expect(seedFromText(' velvet harbour ')).toBe(hashString('velvet harbour'));
    expect(seedFromText('Velvet Harbour')).toBe(seedFromText('velvet harbour'));
    expect(hashString('')).toBe(0x811c9dc5);
  });

  it('give stable, well-spread values', () => {
    expect(hashUnit(1, 2, 3, 4)).toBe(hashUnit(1, 2, 3, 4));
    expect(hashUnit(1, 2, 3, 4)).not.toBe(hashUnit(1, 2, 3, 5));
    const r = makeRng(7);
    const xs = Array.from({ length: 2000 }, () => r.next());
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(diceName(() => 0)).toBe('amber harbour');
  });
});

describe('randomisation', () => {
  it('is deterministic from its seed', () => {
    const a = defaultPatch();
    const b = defaultPatch();
    randomisePatch(a, 42);
    randomisePatch(b, 42);
    expect(a).toEqual(b);
    const c = defaultPatch();
    randomisePatch(c, 43);
    expect(c).not.toEqual(a);
  });

  it('always gives valid, playable settings', () => {
    for (let s = 0; s < 60; s++) {
      for (const wild of [false, true]) {
        const p = defaultPatch();
        randomisePatch(p, s, noLocks(), wild);
        expect(sanitisePatch(p)).toEqual(p);
        for (const r of p.regions) {
          expect(r.high - r.low).toBeGreaterThanOrEqual(12);
          expect(r.density).toBeGreaterThan(0);
          expect(r.scan).not.toBe('manual');
        }
      }
    }
  });

  it('respects locks and never touches MIDI or the picture', () => {
    for (const cat of RANDOM_CATEGORIES) {
      const p = defaultPatch();
      p.image = { kind: 'demo', id: 'geometry' };
      p.regions.forEach((r, i) => (r.channel = 9 + i));
      const before = clonePatch(p);
      const locks = noLocks();
      locks[cat] = true;
      randomisePatch(p, 1234, locks, true);
      expect(p.image).toEqual(before.image);
      expect(p.regions.map((r) => r.channel)).toEqual([9, 10, 11, 12]);
      p.regions.forEach((r, i) => {
        const o = before.regions[i]!;
        if (cat === 'positions') expect([r.x, r.y, r.w, r.h]).toEqual([o.x, o.y, o.w, o.h]);
        if (cat === 'modes') expect(r.mode).toBe(o.mode);
        if (cat === 'mappings') expect([r.pitchFrom, r.velFrom, r.trigger, r.ccFrom]).toEqual([o.pitchFrom, o.velFrom, o.trigger, o.ccFrom]);
        if (cat === 'scans') expect([r.scan, r.reverse, r.cols, r.rows]).toEqual([o.scan, o.reverse, o.cols, o.rows]);
        if (cat === 'density') expect([r.density, r.rest, r.gate]).toEqual([o.density, o.rest, o.gate]);
        if (cat === 'ranges') expect([r.low, r.high]).toEqual([o.low, o.high]);
        if (cat === 'rates') expect(r.rate).toBe(o.rate);
      });
      if (cat === 'scales') expect([p.scale, p.root]).toEqual([before.scale, before.root]);
    }
  });
});

describe('region geometry', () => {
  it('has the preset layouts', () => {
    for (const l of LAYOUTS) {
      const rs = layoutRects(l);
      expect(rs.length).toBe(4);
      for (const r of rs) expect(clampRect(r)).toEqual(r);
    }
    // quadrants tile the picture
    const q = layoutRects('quadrants');
    expect(q.reduce((s, r) => s + r.w * r.h, 0)).toBeCloseTo(1);
  });

  it('moves and resizes inside the picture', () => {
    const r = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    expect(moveRect(r, 0.9, 0.9)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(moveRect(r, -1, -1)).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    const g = resizeRect(r, 'se', 0.2, 0.1);
    expect(g.w).toBeCloseTo(0.7);
    expect(g.h).toBeCloseTo(0.6);
    expect(resizeRect(r, 'nw', 0.9, 0.9).w).toBeGreaterThanOrEqual(0.02);
    expect(resizeRect(r, 'e', 5, 0).x + resizeRect(r, 'e', 5, 0).w).toBeLessThanOrEqual(1);
    const reg = defaultPatch().regions[0]!;
    applyRect(reg, { x: 0.95, y: 0, w: 0.5, h: 0.2 });
    expect(reg.x + reg.w).toBeLessThanOrEqual(1);
  });

  it('finds the region under the pointer, overlaps included', () => {
    const p = defaultPatch();
    expect(regionAt(p.regions, 0.25, 0.25)).toBe(0);
    expect(regionAt(p.regions, 0.75, 0.75)).toBe(3);
    p.regions[3] = { ...p.regions[3]!, x: 0, y: 0, w: 1, h: 1 };
    expect(regionAt(p.regions, 0.25, 0.25)).toBe(3);
    expect(regionAt(p.regions, 0.25, 0.25, 0)).toBe(0);
  });
});
