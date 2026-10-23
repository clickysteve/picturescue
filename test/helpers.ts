/** Test pictures. */
import { analyse, type Analysis } from '../src/engine/analysis';

export type RGBA = [number, number, number, number];

export function solid(w: number, h: number, c: RGBA): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(c, i * 4);
  return d;
}

export function paint(w: number, h: number, f: (x: number, y: number) => RGBA): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4);
  return d;
}

/** A left-to-right brightness ramp. */
export function ramp(w = 64, h = 32): Analysis {
  return analyse(paint(w, h, (x) => [Math.round((x / (w - 1)) * 255), Math.round((x / (w - 1)) * 255), Math.round((x / (w - 1)) * 255), 255]), w, h, 320);
}

/** Vertical black and white stripes `k` pixels wide. */
export function stripes(w = 64, h = 32, k = 4): Analysis {
  return analyse(paint(w, h, (x) => (Math.floor(x / k) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])), w, h, 320);
}

/** A hue wheel across x, full saturation. */
export function hues(w = 72, h = 16): Analysis {
  return analyse(
    paint(w, h, (x) => {
      const hh = (x / w) * 6;
      const f = (n: number) => {
        const k = (n + hh) % 6;
        return Math.round((1 - Math.max(0, Math.min(k, 4 - k, 1))) * 255);
      };
      return [f(5), f(3), f(1), 255];
    }),
    w,
    h,
    320,
  );
}

import { demoPixels } from '../src/engine/demos';

const analyses = new Map<string, Analysis>();
/** A demo picture's analysis (made once per test file). */
export function demoAnalysis(id: string, size = 320): Analysis {
  const key = `${id}@${size}`;
  let a = analyses.get(key);
  if (!a) {
    const px = demoPixels(id)!;
    a = analyse(px.data, px.w, px.h, size);
    analyses.set(key, a);
  }
  return a;
}
