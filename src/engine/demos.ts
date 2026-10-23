/**
 * Demonstration pictures, drawn by code. All original (no third-party artwork) and fully
 * deterministic, so factory presets can refer to them by id and every patch that uses one is
 * small and reproducible. Pure: they return RGBA pixels and need no browser.
 */
import { makeRng } from './rng';

export interface Pixels {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

export interface Demo {
  id: string;
  name: string;
  about: string;
  make(): Pixels;
}

type RGB = [number, number, number];

class Raster implements Pixels {
  data: Uint8ClampedArray;
  constructor(
    public w: number,
    public h: number,
    bg: RGB | [number, number, number, number] = [0, 0, 0],
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
    const a = bg.length === 4 ? bg[3] : 255;
    for (let i = 0; i < w * h; i++) this.data.set([bg[0], bg[1], bg[2], a], i * 4);
  }
  set(x: number, y: number, c: RGB, a = 255): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data.set([c[0], c[1], c[2], a], (y * this.w + x) * 4);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let j = Math.max(0, Math.floor(y)); j < Math.min(this.h, Math.floor(y + h)); j++) for (let i = Math.max(0, Math.floor(x)); i < Math.min(this.w, Math.floor(x + w)); i++) this.set(i, j, c);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.set(x, y, c);
  }
  poly(pts: [number, number][], c: RGB): void {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(this.h - 1, Math.ceil(Math.max(...ys))); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i]!;
        const [x2, y2] = pts[(i + 1) % pts.length]!;
        const yy = y + 0.5;
        if ((y1 <= yy && y2 > yy) || (y2 <= yy && y1 > yy)) xs.push(x1 + ((yy - y1) * (x2 - x1)) / (y2 - y1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]! - 0.5); x < xs[k + 1]! - 0.5; x++) this.set(x, y, c);
    }
  }
  each(f: (x: number, y: number) => RGB | null): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = f(x, y);
        if (c) this.set(x, y, c);
      }
  }
}

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** 4×4 ordered dither threshold (Bayer). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;

function hsv(h: number, s: number, v: number): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

/** A 16-colour, 320×200 pixel picture in the spirit of the ST's low resolution. */
function stLowres(): Pixels {
  const P: RGB[] = [
    [0, 0, 0],
    [36, 36, 109],
    [36, 73, 182],
    [73, 146, 219],
    [146, 182, 255],
    [255, 219, 109],
    [255, 146, 36],
    [219, 73, 36],
    [36, 109, 36],
    [73, 146, 36],
    [109, 73, 36],
    [182, 182, 182],
    [255, 255, 255],
    [109, 36, 109],
    [0, 73, 109],
    [146, 109, 73],
  ];
  const r = new Raster(320, 200);
  // dithered sky: three bands, blended with an ordered dither
  const sky = [P[1]!, P[2]!, P[3]!, P[4]!];
  r.each((x, y) => {
    if (y >= 120) return null;
    const t = (y / 120) * (sky.length - 1);
    const k = Math.floor(t);
    return bayer(x, y) < t - k ? sky[Math.min(sky.length - 1, k + 1)]! : sky[k]!;
  });
  r.ellipse(240, 70, 26, 26, P[5]!);
  r.ellipse(240, 70, 20, 20, P[6]!);
  // mountains
  r.poly([[0, 120], [40, 70], [90, 110], [150, 50], [215, 112], [260, 85], [320, 118], [320, 121], [0, 121]], P[13]!);
  r.poly([[132, 66], [150, 50], [168, 66], [158, 62], [150, 68], [142, 61]], P[12]!);
  // sea with a reflection of the sun
  r.rect(0, 120, 320, 80, P[14]!);
  for (let y = 124; y < 200; y += 5) for (let x = 200; x < 280; x++) if ((x * 7 + y * 3) % 11 < 5 && Math.abs(x - 240) < 30 - (y - 124) / 4) r.set(x, y, P[6]!);
  for (let y = 126; y < 200; y += 9) for (let x = (y * 13) % 17; x < 320; x += 23) r.rect(x, y, 6, 1, P[3]!);
  // an island with a house and a tree
  r.ellipse(70, 150, 60, 14, P[9]!);
  r.ellipse(70, 154, 56, 10, P[8]!);
  r.rect(55, 120, 30, 22, P[11]!);
  r.poly([[50, 121], [70, 104], [90, 121]], P[7]!);
  r.rect(66, 130, 8, 12, P[10]!);
  r.rect(58, 125, 6, 6, P[5]!);
  r.rect(100, 122, 4, 20, P[10]!);
  r.ellipse(102, 116, 12, 10, P[9]!);
  r.ellipse(98, 112, 7, 6, P[8]!);
  // a pier
  r.rect(120, 146, 70, 3, P[15]!);
  for (let x = 124; x < 190; x += 12) r.rect(x, 149, 2, 10, P[10]!);
  return r;
}

function monochrome(): Pixels {
  const r = new Raster(320, 240, [255, 255, 255]);
  // concentric rings on the left: brightness goes up and down like a melody
  r.each((x, y) => {
    const d = Math.hypot(x - 90, y - 120);
    if (d > 85) return null;
    const v = (Math.sin(d / 6) + 1) / 2;
    const g = v > 0.5 ? 0 : 255;
    return [g, g, g];
  });
  // a staircase silhouette: rising steps
  for (let i = 0; i < 8; i++) r.rect(190 + i * 15, 220 - i * 22, 15, 20 + i * 22, [0, 0, 0]);
  // grey tones bar along the top
  for (let i = 0; i < 16; i++) r.rect(i * 20, 0, 20, 14, [i * 17, i * 17, i * 17]);
  // diagonal hatching
  r.each((x, y) => (y > 200 && y < 240 && x < 180 && (x + y) % 12 < 3 ? [0, 0, 0] : null));
  return r;
}

function fourColours(): Pixels {
  const r = new Raster(320, 240, [245, 242, 232]);
  const red: RGB = [214, 40, 30];
  const yellow: RGB = [250, 210, 30];
  const blue: RGB = [20, 60, 170];
  const black: RGB = [15, 15, 15];
  r.rect(0, 0, 150, 130, red);
  r.rect(240, 160, 80, 80, blue);
  r.rect(0, 200, 90, 40, yellow);
  r.rect(260, 0, 60, 60, yellow);
  r.rect(170, 160, 50, 80, black);
  // the black lines
  for (const x of [150, 220, 240, 90]) r.rect(x, x === 90 ? 130 : 0, 8, 240, black);
  for (const y of [130, 152, 200, 60]) r.rect(y === 60 ? 240 : 0, y, y === 60 ? 80 : 320, 8, black);
  return r;
}

function cityLights(): Pixels {
  const r = new Raster(400, 250);
  const rng = makeRng(77);
  r.each((x, y) => mixRGB([8, 10, 40], [40, 20, 70], y / 250));
  for (let i = 0; i < 90; i++) r.set(rng.int(400), rng.int(120), [255, 255, 230]);
  r.ellipse(330, 45, 16, 16, [250, 245, 210]);
  r.ellipse(336, 41, 14, 14, [20, 14, 50]);
  let x = 0;
  while (x < 400) {
    const bw = 18 + rng.int(34);
    const bh = 60 + rng.int(150);
    const shade = 12 + rng.int(18);
    r.rect(x, 250 - bh, bw, bh, [shade, shade, shade + 8]);
    const warm = rng.chance(0.5);
    for (let wy = 250 - bh + 6; wy < 244; wy += 9) {
      for (let wx = x + 3; wx < x + bw - 4; wx += 7) {
        if (!rng.chance(0.45)) continue;
        const c: RGB = warm ? [255, 200 + rng.int(40), 90 + rng.int(60)] : rng.chance(0.3) ? [120, 230, 255] : [255, 240, 170];
        r.rect(wx, wy, 4, 5, c);
      }
    }
    if (rng.chance(0.25)) r.rect(x + bw / 2, 250 - bh - 12, 1, 12, [200, 40, 40]);
    x += bw + rng.int(4);
  }
  // street lights
  for (let i = 10; i < 400; i += 37) r.ellipse(i, 243, 3, 3, [255, 170, 60]);
  return r;
}

function landscape(): Pixels {
  const r = new Raster(480, 270);
  r.each((x, y) => {
    const t = y / 150;
    return t < 1 ? mixRGB([60, 90, 170], [250, 180, 120], t ** 1.5) : null;
  });
  r.ellipse(150, 140, 22, 22, [255, 230, 170]);
  const hills: [number, number, number, RGB][] = [
    [150, 18, 0.011, [120, 110, 150]],
    [175, 22, 0.017, [90, 120, 110]],
    [205, 18, 0.023, [70, 110, 70]],
    [235, 14, 0.031, [50, 90, 50]],
  ];
  for (const [base, amp, f, c] of hills) {
    r.each((x, y) => (y > base + amp * Math.sin(x * f + base) + amp * 0.5 * Math.sin(x * f * 2.7) ? mixRGB(c, [30, 40, 30], ((y - base) / 120) * 0.6) : null));
  }
  // a river winding down
  r.each((x, y) => (y > 180 && Math.abs(x - (240 + 60 * Math.sin(y / 25))) < (y - 175) / 3 ? mixRGB([150, 180, 220], [90, 120, 180], (y - 180) / 90) : null));
  return r;
}

function portrait(): Pixels {
  const r = new Raster(300, 360, [30, 24, 40]);
  const rng = makeRng(4242);
  const sites = Array.from({ length: 70 }, () => [rng.int(300), rng.int(360), rng.next()] as [number, number, number]);
  r.each((x, y) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < sites.length; i++) {
      const d = (x - sites[i]![0]) ** 2 + (y - sites[i]![1]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const s = sites[best]!;
    const inFace = ((x - 150) / 95) ** 2 + ((y - 170) / 125) ** 2 < 1;
    const inHair = ((x - 150) / 110) ** 2 + ((y - 120) / 105) ** 2 < 1 && y < 150;
    if (inHair) return hsv(20 + s[2] * 20, 0.6, 0.25 + s[2] * 0.2);
    if (inFace) return hsv(18 + s[2] * 25, 0.35 + s[2] * 0.2, 0.6 + s[2] * 0.35);
    return hsv(200 + s[2] * 80, 0.5, 0.2 + s[2] * 0.25);
  });
  r.ellipse(112, 160, 16, 9, [250, 250, 245]);
  r.ellipse(188, 160, 16, 9, [250, 250, 245]);
  r.ellipse(112, 160, 7, 7, [40, 80, 120]);
  r.ellipse(188, 160, 7, 7, [40, 80, 120]);
  r.poly([[150, 175], [138, 222], [162, 222]], [190, 120, 100]);
  r.poly([[115, 250], [150, 262], [185, 250], [150, 272]], [170, 40, 50]);
  // fracture lines
  for (let k = 0; k < 6; k++) {
    let x = rng.int(300);
    for (let y = 0; y < 360; y++) {
      x += rng.int(3) - 1;
      r.set(x, y, [235, 230, 220]);
    }
  }
  return r;
}

function colourDrift(): Pixels {
  const r = new Raster(360, 240);
  r.each((x, y) => {
    const v = Math.sin(x / 31) + Math.sin(y / 23) + Math.sin((x + y) / 47) + Math.sin(Math.hypot(x - 180, y - 120) / 19);
    const h = ((v + 4) / 8) * 360;
    return hsv((h + x * 0.4) % 360, 0.75, 0.6 + 0.35 * Math.sin(v));
  });
  return r;
}

function geometry(): Pixels {
  const r = new Raster(320, 320, [240, 240, 240]);
  r.each((x, y) => {
    const cx = Math.floor(x / 40);
    const cy = Math.floor(y / 40);
    const lx = x % 40;
    const ly = y % 40;
    const k = (cx * 3 + cy * 5) % 4;
    const tri = k === 0 ? lx > ly : k === 1 ? lx + ly < 40 : k === 2 ? lx < 20 : ly < 20 === lx < 20;
    if (!tri) return null;
    return (cx + cy) % 3 === 0 ? [220, 60, 50] : (cx + cy) % 3 === 1 ? [20, 20, 20] : [40, 110, 200];
  });
  return r;
}

function cutout(): Pixels {
  const r = new Raster(300, 300, [0, 0, 0, 0]);
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? 140 : 60;
    pts.push([150 + rr * Math.cos(a), 155 + rr * Math.sin(a)]);
  }
  r.poly(pts, [255, 200, 40]);
  r.ellipse(150, 155, 40, 40, [230, 80, 40]);
  // a half-transparent halo
  for (let y = 0; y < 300; y++)
    for (let x = 0; x < 300; x++) {
      const d = Math.hypot(x - 150, y - 155);
      const i = (y * 300 + x) * 4;
      if (r.data[i + 3] === 0 && d < 150 && d > 120) r.data.set([120, 200, 255, 110], i);
    }
  return r;
}

export const DEMOS: Demo[] = [
  { id: 'st-lowres', name: 'ST LOW-RES', about: '320×200 in 16 colours: an island at sunset', make: stLowres },
  { id: 'monochrome', name: 'MONOCHROME', about: 'black and white rings, steps and greys', make: monochrome },
  { id: 'four-colours', name: 'FOUR COLOURS', about: 'four flat colours and black lines', make: fourColours },
  { id: 'city-lights', name: 'CITY LIGHTS', about: 'a night skyline with lit windows', make: cityLights },
  { id: 'landscape', name: 'SLOW LANDSCAPE', about: 'dawn over rolling hills and a river', make: landscape },
  { id: 'portrait', name: 'FRACTURED PORTRAIT', about: 'a face of shards', make: portrait },
  { id: 'drift', name: 'COLOUR DRIFT', about: 'a plasma of drifting hues', make: colourDrift },
  { id: 'geometry', name: 'GEOMETRY', about: 'triangles and squares on a grid', make: geometry },
  { id: 'cutout', name: 'CUT-OUT STAR', about: 'a star on a transparent background', make: cutout },
];

export function demoById(id: string): Demo | undefined {
  return DEMOS.find((d) => d.id === id);
}

const cache = new Map<string, Pixels>();
/** A demo's pixels (made once). */
export function demoPixels(id: string): Pixels | null {
  const d = demoById(id);
  if (!d) return null;
  let p = cache.get(id);
  if (!p) {
    p = d.make();
    cache.set(id, p);
  }
  return p;
}
