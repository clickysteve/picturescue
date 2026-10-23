import { describe, expect, it } from 'vitest';
import { analyse, analysisDims, areaFeatures, colourDistance, downsample, hueSat, medianCutPalette, renderView, stLevel } from '../src/engine/analysis';
import { paint, ramp, solid, stripes } from './helpers';

describe('analysis: measurements', () => {
  it('measures brightness', () => {
    const black = analyse(solid(8, 8, [0, 0, 0, 255]), 8, 8);
    const white = analyse(solid(8, 8, [255, 255, 255, 255]), 8, 8);
    const grey = analyse(solid(8, 8, [128, 128, 128, 255]), 8, 8);
    expect(areaFeatures(black, 0, 0, 1, 1).lum).toBeCloseTo(0, 5);
    expect(areaFeatures(white, 0, 0, 1, 1).lum).toBeCloseTo(1, 5);
    expect(areaFeatures(grey, 0, 0, 1, 1).lum).toBeCloseTo(128 / 255, 3);
    // green looks brighter than blue
    const g = analyse(solid(4, 4, [0, 255, 0, 255]), 4, 4);
    const b = analyse(solid(4, 4, [0, 0, 255, 255]), 4, 4);
    expect(areaFeatures(g, 0, 0, 1, 1).lum).toBeGreaterThan(areaFeatures(b, 0, 0, 1, 1).lum);
  });

  it('measures hue and saturation', () => {
    expect(hueSat(255, 0, 0)).toEqual({ hue: 0, sat: 1 });
    expect(hueSat(0, 255, 0).hue).toBeCloseTo(120);
    expect(hueSat(0, 0, 255).hue).toBeCloseTo(240);
    expect(hueSat(128, 128, 128).sat).toBe(0);
    expect(hueSat(255, 128, 128).sat).toBeCloseTo(127 / 255, 3);
    const yellow = analyse(solid(6, 6, [255, 255, 0, 255]), 6, 6);
    const f = areaFeatures(yellow, 0, 0, 1, 1);
    expect(f.hue).toBeCloseTo(60, 3);
    expect(f.sat).toBeCloseTo(1, 5);
  });

  it('averages hue around the colour wheel (red either side of 0°)', () => {
    const an = analyse(paint(2, 1, (x) => (x === 0 ? [255, 0, 20, 255] : [255, 20, 0, 255])), 2, 1);
    const h = areaFeatures(an, 0, 0, 1, 1).hue;
    expect(Math.min(h, 360 - h)).toBeLessThan(5);
  });

  it('finds edges (contrast) and none in a flat picture', () => {
    const flat = analyse(solid(16, 16, [90, 30, 200, 255]), 16, 16);
    expect(areaFeatures(flat, 0, 0, 1, 1).edge).toBe(0);
    const st = stripes(32, 16, 4);
    expect(areaFeatures(st, 0, 0, 1, 1).edge).toBeGreaterThan(0.3);
    // a soft ramp has far less edge than hard stripes
    expect(areaFeatures(ramp(64, 16), 0, 0, 1, 1).edge).toBeLessThan(areaFeatures(st, 0, 0, 1, 1).edge / 5);
  });

  it('handles transparency: colour weighted by alpha, alpha as a feature', () => {
    const half = paint(4, 2, (x) => (x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 0]));
    const an = analyse(half, 4, 2);
    expect(an.hasAlpha).toBe(true);
    const f = areaFeatures(an, 0, 0, 1, 1);
    expect(f.alpha).toBeCloseTo(0.5, 5);
    // the invisible blue does not tint the visible red
    expect(f.r).toBeCloseTo(255, 3);
    expect(f.b).toBeCloseTo(0, 3);
    const clear = analyse(solid(4, 4, [10, 200, 10, 0]), 4, 4);
    expect(areaFeatures(clear, 0, 0, 1, 1).alpha).toBe(0);
  });

  it('detects greyscale pictures', () => {
    expect(ramp().greyscale).toBe(true);
    expect(analyse(solid(4, 4, [255, 0, 0, 255]), 4, 4).greyscale).toBe(false);
  });
});

describe('analysis: scaling', () => {
  it('keeps the aspect ratio and never upscales', () => {
    expect(analysisDims(1000, 500, 320)).toEqual({ w: 320, h: 160 });
    expect(analysisDims(300, 900, 320)).toEqual({ w: 107, h: 320 });
    expect(analysisDims(100, 50, 320)).toEqual({ w: 100, h: 50 });
    const an = analyse(solid(1280, 720, [1, 2, 3, 255]), 1280, 720, 160);
    expect([an.w, an.h]).toEqual([160, 90]);
    expect([an.sourceW, an.sourceH]).toEqual([1280, 720]);
  });

  it('box-filters exactly for integer ratios', () => {
    const src = paint(4, 2, (x) => (x % 2 ? [200, 0, 0, 255] : [0, 0, 100, 255]));
    const d = downsample(src, 4, 2, 2, 1);
    expect(Array.from(d.slice(0, 4))).toEqual([100, 0, 50, 255]);
  });

  it('gives the same measurements for a picture and its scaled-down copy (area averages)', () => {
    const big = analyse(paint(320, 160, (x, y) => [x % 256, y, 128, 255]), 320, 160, 320);
    const small = analyse(paint(320, 160, (x, y) => [x % 256, y, 128, 255]), 320, 160, 80);
    const a = areaFeatures(big, 0.25, 0.25, 0.5, 0.5);
    const b = areaFeatures(small, 0.25, 0.25, 0.5, 0.5);
    expect(a.lum).toBeCloseTo(b.lum, 2);
    expect(a.r).toBeCloseTo(b.r, 0);
  });

  it('copes with a 1×1 picture and very thin regions', () => {
    const an = analyse(solid(1, 1, [50, 60, 70, 255]), 1, 1);
    const f = areaFeatures(an, 0.4, 0.4, 0.001, 0.001);
    expect(f.lum).toBeGreaterThan(0);
    expect(Number.isFinite(f.hue)).toBe(true);
  });
});

describe('analysis: region sampling', () => {
  it('samples exactly the region it is given', () => {
    const an = ramp(100, 10);
    const left = areaFeatures(an, 0, 0, 0.1, 1);
    const right = areaFeatures(an, 0.9, 0, 0.1, 1);
    expect(left.lum).toBeLessThan(0.1);
    expect(right.lum).toBeGreaterThan(0.9);
    const mid = areaFeatures(an, 0.45, 0, 0.1, 1);
    expect(mid.lum).toBeCloseTo(0.5, 1);
  });

  it('measures colour change between two cells', () => {
    const an = analyse(paint(2, 1, (x) => (x ? [255, 255, 255, 255] : [0, 0, 0, 255])), 2, 1);
    const a = areaFeatures(an, 0, 0, 0.5, 1);
    const b = areaFeatures(an, 0.5, 0, 0.5, 1);
    expect(colourDistance(a, b)).toBeGreaterThan(0.99);
    expect(colourDistance(a, a)).toBe(0);
  });
});

describe('analysis: ST COLOUR palette', () => {
  it('snaps to the ST 512-colour space, at most 16 colours, darkest first', () => {
    expect(stLevel(0)).toBe(0);
    expect(stLevel(255)).toBe(255);
    expect([0, 36, 73, 109, 146, 182, 219, 255]).toContain(stLevel(100));
    const an = analyse(
      paint(64, 64, (x, y) => [x * 4, y * 4, (x * y) % 256, 255]),
      64,
      64,
    );
    expect(an.palette.length).toBeLessThanOrEqual(16);
    expect(an.palette.length).toBeGreaterThan(8);
    for (let i = 1; i < an.palette.length; i++) {
      const l = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
      expect(l(an.palette[i]!)).toBeGreaterThanOrEqual(l(an.palette[i - 1]!));
    }
  });

  it('keeps a limited-colour picture to its own colours', () => {
    const an = analyse(paint(8, 8, (x) => (x < 4 ? [0, 0, 0, 255] : [255, 255, 255, 255])), 8, 8);
    expect(an.palette).toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
    expect(an.index[0]).toBe(0);
    expect(an.index[7]).toBe(1);
  });

  it('is deterministic', () => {
    const src = paint(40, 30, (x, y) => [(x * 37) % 256, (y * 53) % 256, (x * y * 7) % 256, 255]);
    expect(medianCutPalette(downsample(src, 40, 30, 40, 30), 1200)).toEqual(medianCutPalette(downsample(src, 40, 30, 40, 30), 1200));
  });

  it('renders analysis views', () => {
    const an = ramp(10, 2);
    const v = renderView(an, 'brightness');
    expect(v.length).toBe(10 * 2 * 4);
    expect(v[0]).toBe(0);
    expect(v[9 * 4]).toBe(255);
    expect(renderView(an, 'stcolour').length).toBe(80);
  });
});
