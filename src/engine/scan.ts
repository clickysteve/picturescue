/**
 * Scanning: the order in which a region's grid of cells is visited.
 *
 * A region is divided into `cols × rows` cells. A scan mode gives one PASS as a list of cell
 * indices (row-major: index = row * cols + col). The performance steps through the pass, one
 * cell per musical step, and starts again when it ends (if looping).
 *
 *   HORIZONTAL  left to right, then the next row down (the original's documented scan)
 *   VERTICAL    top to bottom, then the next column
 *   PING-PONG   horizontal there and back (the end cells are not repeated)
 *   SERPENTINE  rows alternate direction (boustrophedon)
 *   RANDOM WALK a seeded walk to neighbouring cells, preferring to keep its direction
 *   SPIRAL      from the outside inwards (reverse: from the centre outwards)
 *   MANUAL      no path: the cell under the manual cursor
 *
 * `reverse` plays any path backwards. Everything is a pure function of its inputs.
 */
import { hashUnit, makeRng, mix32 } from './rng';
import type { ScanMode } from './types';

export function horizontalPath(cols: number, rows: number): number[] {
  return Array.from({ length: cols * rows }, (_, i) => i);
}

export function verticalPath(cols: number, rows: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) out.push(r * cols + c);
  return out;
}

export function pingPongPath(cols: number, rows: number): number[] {
  const f = horizontalPath(cols, rows);
  if (f.length <= 2) return f;
  return [...f, ...f.slice(1, -1).reverse()];
}

export function serpentinePath(cols: number, rows: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) out.push(r * cols + (r % 2 === 0 ? k : cols - 1 - k));
  }
  return out;
}

/** Outside inwards, clockwise from the top-left corner; visits every cell once. */
export function spiralPath(cols: number, rows: number): number[] {
  const out: number[] = [];
  let top = 0;
  let left = 0;
  let bottom = rows - 1;
  let right = cols - 1;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) out.push(top * cols + c);
    top++;
    for (let r = top; r <= bottom; r++) out.push(r * cols + right);
    right--;
    if (top <= bottom) {
      for (let c = right; c >= left; c--) out.push(bottom * cols + c);
      bottom--;
    }
    if (left <= right) {
      for (let r = bottom; r >= top; r--) out.push(r * cols + left);
      left++;
    }
  }
  return out;
}

const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * A seeded random walk of `cols × rows` steps through neighbouring cells. It keeps its
 * direction with probability 0.55 (so it draws lines, which sound like phrases), turns
 * otherwise, and never leaves the grid.
 */
export function randomWalkPath(cols: number, rows: number, seed: number): number[] {
  const rng = makeRng(mix32(seed ^ 0x51ed270b) ^ Math.imul(cols, 7919) ^ Math.imul(rows, 104729));
  let x = rng.int(cols);
  let y = rng.int(rows);
  let d = rng.int(4);
  const out: number[] = [];
  const n = cols * rows;
  for (let i = 0; i < n; i++) {
    out.push(y * cols + x);
    if (cols === 1 && rows === 1) continue;
    const options: number[] = [];
    for (let k = 0; k < 4; k++) {
      const nx = x + DIRS[k]![0];
      const ny = y + DIRS[k]![1];
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) options.push(k);
    }
    if (!(options.includes(d) && rng.chance(0.55))) d = options[rng.int(options.length)]!;
    x += DIRS[d]![0];
    y += DIRS[d]![1];
  }
  return out;
}

/** One pass of a scan mode (MANUAL has a single-cell path at the manual cursor). */
export function scanPath(mode: ScanMode, cols: number, rows: number, reverse: boolean, seed: number, manual: { x: number; y: number } = { x: 0.5, y: 0.5 }): number[] {
  const c = Math.max(1, Math.round(cols));
  const r = Math.max(1, Math.round(rows));
  let p: number[];
  switch (mode) {
    case 'horizontal':
      p = horizontalPath(c, r);
      break;
    case 'vertical':
      p = verticalPath(c, r);
      break;
    case 'pingpong':
      p = pingPongPath(c, r);
      break;
    case 'serpentine':
      p = serpentinePath(c, r);
      break;
    case 'randomwalk':
      p = randomWalkPath(c, r, seed);
      break;
    case 'spiral':
      p = spiralPath(c, r);
      break;
    case 'manual':
      p = [manualCell(c, r, manual.x, manual.y)];
      break;
  }
  return reverse ? p.slice().reverse() : p;
}

export function manualCell(cols: number, rows: number, x: number, y: number): number {
  const cx = Math.max(0, Math.min(cols - 1, Math.floor(x * cols)));
  const cy = Math.max(0, Math.min(rows - 1, Math.floor(y * rows)));
  return cy * cols + cx;
}

/** Steps in one pass: the path length, or the region's own LENGTH when set. */
export function passLength(pathLength: number, length: number): number {
  return length > 0 ? length : Math.max(1, pathLength);
}

/** The cell a step lands on: offset into the path, wrapping, within a pass of `len` steps. */
export function cellAt(path: readonly number[], step: number, len: number, offset: number): number {
  const s = ((step % len) + len) % len;
  return path[(s + offset) % path.length]!;
}

/** A seeded cell anywhere in the grid (CHAOTIC jumps). */
export function jumpCell(cols: number, rows: number, seed: number, region: number, step: number): number {
  return Math.floor(hashUnit(seed, region, step, 0x1a7) * cols * rows);
}
