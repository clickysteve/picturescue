/**
 * Image analysis: turns pixels into the measurements the music is made from.
 *
 * Pure and deterministic. The input is plain RGBA data (from a canvas in the browser, or
 * built in tests); everything after that is PICTURESCUE's own arithmetic, never the browser's
 * image scaling, so the same source pixels always give the same analysis on any machine.
 *
 *   source RGBA  ->  box-filter downsample to the ANALYSIS SIZE (longest side, aspect kept)
 *                ->  per pixel: brightness, saturation, hue, alpha, edge strength
 *                ->  a 16-colour palette (ST COLOUR, after the Atari ST's 16-colour low resolution)
 *                ->  summed-area tables, so any rectangle's average costs four lookups
 *
 * Transparency: colour is averaged weighted by alpha (a half-transparent red stays red), and
 * alpha itself is a feature: cells that are mostly transparent are silent.
 */

export interface Analysis {
  /** analysis width and height in pixels */
  w: number;
  h: number;
  /** source dimensions the analysis was made from */
  sourceW: number;
  sourceH: number;
  /** per pixel, 0..1 */
  lum: Float32Array;
  sat: Float32Array;
  /** hue in degrees 0..360 (meaningless where sat is ~0) */
  hue: Float32Array;
  alpha: Float32Array;
  edge: Float32Array;
  /** ST COLOUR palette index per pixel (0 = darkest) */
  index: Uint8Array;
  /** the palette, darkest first, as [r, g, b] 0..255 (at most 16 entries) */
  palette: [number, number, number][];
  /** summed-area tables, (w + 1) * (h + 1) each */
  sums: Record<SumKey, Float64Array>;
  /** whether any pixel is not fully opaque */
  hasAlpha: boolean;
  /** whether the picture is (practically) without colour */
  greyscale: boolean;
}

type SumKey = 'a' | 'lum' | 'sat' | 'hx' | 'hy' | 'edge' | 'r' | 'g' | 'b';
const SUM_KEYS: SumKey[] = ['a', 'lum', 'sat', 'hx', 'hy', 'edge', 'r', 'g', 'b'];

export interface Features {
  /** 0..1 */
  lum: number;
  sat: number;
  /** degrees 0..360 */
  hue: number;
  alpha: number;
  edge: number;
  r: number;
  g: number;
  b: number;
  /** ST COLOUR index at the cell centre */
  index: number;
}

/** Dimensions of the analysis grid for a source and a longest-side size (never upscaled). */
export function analysisDims(sourceW: number, sourceH: number, size: number): { w: number; h: number } {
  const longest = Math.max(sourceW, sourceH);
  if (longest <= size) return { w: Math.max(1, sourceW), h: Math.max(1, sourceH) };
  const k = size / longest;
  return { w: Math.max(1, Math.round(sourceW * k)), h: Math.max(1, Math.round(sourceH * k)) };
}

/**
 * Area-average (box filter) downsampling with alpha-weighted colour. Exact for integer
 * ratios; for others each target pixel averages the source pixels whose centres fall in it.
 */
export function downsample(src: Uint8ClampedArray | Uint8Array, sw: number, sh: number, tw: number, th: number): Float32Array {
  const out = new Float32Array(tw * th * 4);
  if (tw === sw && th === sh) {
    for (let i = 0; i < sw * sh * 4; i++) out[i] = src[i]!;
    return out;
  }
  const acc = new Float64Array(tw * th * 5); // r*a, g*a, b*a, a, count
  for (let y = 0; y < sh; y++) {
    const ty = Math.min(th - 1, Math.floor(((y + 0.5) * th) / sh));
    for (let x = 0; x < sw; x++) {
      const tx = Math.min(tw - 1, Math.floor(((x + 0.5) * tw) / sw));
      const s = (y * sw + x) * 4;
      const a = src[s + 3]!;
      const t = (ty * tw + tx) * 5;
      acc[t] += src[s]! * a;
      acc[t + 1] += src[s + 1]! * a;
      acc[t + 2] += src[s + 2]! * a;
      acc[t + 3] += a;
      acc[t + 4] += 1;
    }
  }
  for (let i = 0; i < tw * th; i++) {
    const t = i * 5;
    const n = acc[t + 4]!;
    const a = acc[t + 3]!;
    if (n === 0) continue;
    if (a > 0) {
      out[i * 4] = acc[t]! / a;
      out[i * 4 + 1] = acc[t + 1]! / a;
      out[i * 4 + 2] = acc[t + 2]! / a;
    }
    out[i * 4 + 3] = a / n;
  }
  return out;
}

/** HSV-style hue (degrees) and saturation (0..1) of an RGB colour (0..255). */
export function hueSat(r: number, g: number, b: number): { hue: number; sat: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const sat = max <= 0 ? 0 : d / max;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = 60 * (((g - b) / d + 6) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  return { hue, sat };
}

/** Perceived brightness 0..1 (Rec. 709 weights on the stored values). */
export const luma = (r: number, g: number, b: number): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Snap a channel to the Atari ST's 8 levels (3 bits per channel, 512 colours). */
export const stLevel = (v: number): number => Math.round((Math.round((v / 255) * 7) * 255) / 7);

/**
 * A palette of at most `n` colours by median cut over a 5-bit-per-channel histogram, snapped
 * to the ST's 512 colours and sorted darkest first. Deterministic (ties broken by channel order).
 */
export function medianCutPalette(rgba: Float32Array, count: number, n = 16): [number, number, number][] {
  const hist = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    if (rgba[i * 4 + 3]! < 128) continue;
    const key = ((Math.round(rgba[i * 4]!) >> 3) << 10) | ((Math.round(rgba[i * 4 + 1]!) >> 3) << 5) | (Math.round(rgba[i * 4 + 2]!) >> 3);
    hist.set(key, (hist.get(key) ?? 0) + 1);
  }
  type Bin = { c: [number, number, number]; w: number };
  const bins: Bin[] = [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, w]) => ({ c: [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4], w }));
  if (!bins.length) return [[0, 0, 0]];
  let boxes: Bin[][] = [bins];
  while (boxes.length < n) {
    // split the box with the widest channel range (ties: the heavier box, then the first)
    let best = -1;
    let bestRange = 0;
    let bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255;
        let hi = 0;
        for (const b of box) {
          lo = Math.min(lo, b.c[ch]!);
          hi = Math.max(hi, b.c[ch]!);
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo;
          best = i;
          bestCh = ch;
        }
      }
    });
    if (best < 0) break;
    const box = boxes[best]!.slice().sort((a, b) => a.c[bestCh]! - b.c[bestCh]! || a.c[0] - b.c[0] || a.c[1] - b.c[1] || a.c[2] - b.c[2]);
    const total = box.reduce((s, b) => s + b.w, 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i]!.w;
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
      cut = i + 1;
    }
    boxes = [...boxes.slice(0, best), box.slice(0, cut), box.slice(cut), ...boxes.slice(best + 1)];
  }
  const cols = boxes.map((box) => {
    const w = box.reduce((s, b) => s + b.w, 0);
    const avg = [0, 1, 2].map((ch) => box.reduce((s, b) => s + b.c[ch]! * b.w, 0) / w);
    return [stLevel(avg[0]!), stLevel(avg[1]!), stLevel(avg[2]!)] as [number, number, number];
  });
  // de-duplicate (snapping can merge colours), then darkest first
  const seen = new Set<string>();
  const uniq = cols.filter((c) => {
    const k = c.join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return uniq.sort((a, b) => luma(...a) - luma(...b) || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

export function nearestIndex(palette: [number, number, number][], r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i]!;
    const d = (p[0] - r) ** 2 * 0.3 + (p[1] - g) ** 2 * 0.59 + (p[2] - b) ** 2 * 0.11;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function integral(values: (i: number) => number, w: number, h: number): Float64Array {
  const W = w + 1;
  const s = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += values(y * w + x);
      s[(y + 1) * W + x + 1] = s[y * W + x + 1]! + row;
    }
  }
  return s;
}

/** Analyse source pixels at a longest-side analysis size. */
export function analyse(src: Uint8ClampedArray | Uint8Array, sourceW: number, sourceH: number, size = 320): Analysis {
  const { w, h } = analysisDims(sourceW, sourceH, size);
  const px = downsample(src, sourceW, sourceH, w, h);
  const n = w * h;
  const lum = new Float32Array(n);
  const sat = new Float32Array(n);
  const hue = new Float32Array(n);
  const alpha = new Float32Array(n);
  let hasAlpha = false;
  let satSum = 0;
  let opaque = 0;
  for (let i = 0; i < n; i++) {
    const r = px[i * 4]!;
    const g = px[i * 4 + 1]!;
    const b = px[i * 4 + 2]!;
    const a = px[i * 4 + 3]! / 255;
    alpha[i] = a;
    if (a < 0.999) hasAlpha = true;
    lum[i] = luma(r, g, b);
    const hs = hueSat(r, g, b);
    sat[i] = hs.sat;
    hue[i] = hs.hue;
    if (a > 0.5) {
      satSum += hs.sat;
      opaque++;
    }
  }
  // Sobel edge strength on brightness × alpha (so the outline of a cut-out is an edge)
  const edge = new Float32Array(n);
  const L = (x: number, y: number) => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
    const i = cy * w + cx;
    return lum[i]! * alpha[i]!;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1);
      const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1);
      edge[y * w + x] = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 2);
    }
  }
  const palette = medianCutPalette(px, n);
  const index = new Uint8Array(n);
  for (let i = 0; i < n; i++) index[i] = nearestIndex(palette, px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!);
  const rad = Math.PI / 180;
  const getters: Record<SumKey, (i: number) => number> = {
    a: (i) => alpha[i]!,
    lum: (i) => lum[i]! * alpha[i]!,
    sat: (i) => sat[i]! * alpha[i]!,
    hx: (i) => Math.cos(hue[i]! * rad) * sat[i]! * alpha[i]!,
    hy: (i) => Math.sin(hue[i]! * rad) * sat[i]! * alpha[i]!,
    edge: (i) => edge[i]!,
    r: (i) => px[i * 4]! * alpha[i]!,
    g: (i) => px[i * 4 + 1]! * alpha[i]!,
    b: (i) => px[i * 4 + 2]! * alpha[i]!,
  };
  const sums = {} as Record<SumKey, Float64Array>;
  for (const k of SUM_KEYS) sums[k] = integral(getters[k], w, h);
  return { w, h, sourceW, sourceH, lum, sat, hue, alpha, edge, index, palette, sums, hasAlpha, greyscale: opaque > 0 ? satSum / opaque < 0.04 : true };
}

/** Sum of a table over pixels [x0, x1) × [y0, y1). */
function rect(s: Float64Array, W: number, x0: number, y0: number, x1: number, y1: number): number {
  return s[y1 * W + x1]! - s[y0 * W + x1]! - s[y1 * W + x0]! + s[y0 * W + x0]!;
}

/** Pixel rectangle of a normalised rectangle (at least one pixel). */
export function pixelRect(an: { w: number; h: number }, x: number, y: number, w: number, h: number): [number, number, number, number] {
  let x0 = Math.floor(x * an.w);
  let y0 = Math.floor(y * an.h);
  let x1 = Math.ceil((x + w) * an.w);
  let y1 = Math.ceil((y + h) * an.h);
  x0 = Math.max(0, Math.min(an.w - 1, x0));
  y0 = Math.max(0, Math.min(an.h - 1, y0));
  x1 = Math.max(x0 + 1, Math.min(an.w, x1));
  y1 = Math.max(y0 + 1, Math.min(an.h, y1));
  return [x0, y0, x1, y1];
}

/** Average features of a normalised rectangle of the picture. */
export function areaFeatures(an: Analysis, x: number, y: number, w: number, h: number): Features {
  const [x0, y0, x1, y1] = pixelRect(an, x, y, w, h);
  const W = an.w + 1;
  const count = (x1 - x0) * (y1 - y0);
  const a = rect(an.sums.a, W, x0, y0, x1, y1);
  const cx = Math.min(an.w - 1, Math.floor((x0 + x1 - 1) / 2));
  const cy = Math.min(an.h - 1, Math.floor((y0 + y1 - 1) / 2));
  const edge = rect(an.sums.edge, W, x0, y0, x1, y1) / count;
  if (a <= 1e-9) return { lum: 0, sat: 0, hue: 0, alpha: 0, edge, r: 0, g: 0, b: 0, index: an.index[cy * an.w + cx]! };
  const hx = rect(an.sums.hx, W, x0, y0, x1, y1) / a;
  const hy = rect(an.sums.hy, W, x0, y0, x1, y1) / a;
  let hue = (Math.atan2(hy, hx) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return {
    lum: rect(an.sums.lum, W, x0, y0, x1, y1) / a,
    sat: rect(an.sums.sat, W, x0, y0, x1, y1) / a,
    hue,
    alpha: a / count,
    edge,
    r: rect(an.sums.r, W, x0, y0, x1, y1) / a,
    g: rect(an.sums.g, W, x0, y0, x1, y1) / a,
    b: rect(an.sums.b, W, x0, y0, x1, y1) / a,
    index: an.index[cy * an.w + cx]!,
  };
}

/** Distance between two colours, 0..1. */
export function colourDistance(a: Features, b: Features): number {
  return Math.min(1, Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2) / 441.7 + Math.abs(a.alpha - b.alpha));
}

export const VIEWS = ['picture', 'brightness', 'hue', 'saturation', 'edges', 'stcolour'] as const;
export type View = (typeof VIEWS)[number];
export const VIEW_LABEL: Record<View, string> = { picture: 'PICTURE', brightness: 'BRIGHTNESS', hue: 'HUE', saturation: 'SATURATION', edges: 'EDGES', stcolour: 'ST COLOUR' };

/** An RGBA picture of one measurement at the analysis size (what the regions "see"). */
export function renderView(an: Analysis, view: Exclude<View, 'picture'>): Uint8ClampedArray {
  const n = an.w * an.h;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let g = 0;
    let b = 0;
    if (view === 'brightness') r = g = b = an.lum[i]! * 255;
    else if (view === 'saturation') r = g = b = an.sat[i]! * 255;
    else if (view === 'edges') r = g = b = an.edge[i]! * 255;
    else if (view === 'hue') {
      // full-saturation hue, faded to grey where the picture has no colour
      const h = an.hue[i]! / 60;
      const c = [0, 0, 0];
      const k = (nn: number) => (nn + h) % 6;
      const f = (nn: number) => 1 - Math.max(0, Math.min(k(nn), 4 - k(nn), 1));
      c[0] = f(5);
      c[1] = f(3);
      c[2] = f(1);
      const s = Math.min(1, an.sat[i]! * 1.5);
      r = (c[0]! * s + 0.5 * (1 - s)) * 255;
      g = (c[1]! * s + 0.5 * (1 - s)) * 255;
      b = (c[2]! * s + 0.5 * (1 - s)) * 255;
    } else {
      const p = an.palette[an.index[i]!] ?? [0, 0, 0];
      [r, g, b] = p;
    }
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = Math.round(an.alpha[i]! * 255);
  }
  return out;
}
