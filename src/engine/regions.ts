/**
 * Region geometry: presets and the editing operations (move, resize), all in normalised
 * image coordinates and always kept inside the picture.
 */
import type { RegionSettings } from './types';

export type Rect = { x: number; y: number; w: number; h: number };

export const MIN_SIZE = 0.02;

export const LAYOUTS = ['quadrants', 'bands', 'strips', 'overlap', 'centre'] as const;
export type Layout = (typeof LAYOUTS)[number];
export const LAYOUT_LABEL: Record<Layout, string> = {
  quadrants: 'Four Quadrants',
  bands: 'Four Horizontal Bands',
  strips: 'Four Vertical Strips',
  overlap: 'Full-Image Overlap',
  centre: 'Foreground / Background',
};

export function layoutRects(l: Layout): Rect[] {
  switch (l) {
    case 'quadrants':
      return [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      ];
    case 'bands':
      return [0, 1, 2, 3].map((i) => ({ x: 0, y: i * 0.25, w: 1, h: 0.25 }));
    case 'strips':
      return [0, 1, 2, 3].map((i) => ({ x: i * 0.25, y: 0, w: 0.25, h: 1 }));
    case 'overlap':
      return [
        { x: 0, y: 0, w: 1, h: 1 },
        { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
        { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
        { x: 0.15, y: 0.15, w: 0.7, h: 0.7 },
      ];
    case 'centre':
      // the subject in the middle, the background around it (top, sides, bottom)
      return [
        { x: 0.3, y: 0.25, w: 0.4, h: 0.5 },
        { x: 0, y: 0, w: 1, h: 0.25 },
        { x: 0, y: 0.25, w: 0.3, h: 0.75 },
        { x: 0.7, y: 0.25, w: 0.3, h: 0.75 },
      ];
  }
}

export function clampRect(r: Rect): Rect {
  const w = Math.max(MIN_SIZE, Math.min(1, r.w));
  const h = Math.max(MIN_SIZE, Math.min(1, r.h));
  return { x: Math.max(0, Math.min(1 - w, r.x)), y: Math.max(0, Math.min(1 - h, r.y)), w, h };
}

export function applyRect(region: RegionSettings, r: Rect): void {
  const c = clampRect(r);
  region.x = c.x;
  region.y = c.y;
  region.w = c.w;
  region.h = c.h;
}

/** Move by a normalised offset, staying inside the picture. */
export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return clampRect({ ...r, x: r.x + dx, y: r.y + dy });
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Resize from a handle by a normalised offset; the opposite edge stays put. */
export function resizeRect(r: Rect, handle: Handle, dx: number, dy: number): Rect {
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  if (handle.includes('w')) x0 = Math.min(x1 - MIN_SIZE, Math.max(0, x0 + dx));
  if (handle.includes('e')) x1 = Math.max(x0 + MIN_SIZE, Math.min(1, x1 + dx));
  if (handle.includes('n')) y0 = Math.min(y1 - MIN_SIZE, Math.max(0, y0 + dy));
  if (handle.includes('s')) y1 = Math.max(y0 + MIN_SIZE, Math.min(1, y1 + dy));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The topmost region under a point (later regions are drawn on top). */
export function regionAt(regions: readonly RegionSettings[], x: number, y: number, prefer = -1): number {
  if (prefer >= 0) {
    const r = regions[prefer];
    if (r && r.enabled && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return prefer;
  }
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i]!;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}
