import { describe, expect, it } from 'vitest';
import { cellAt, horizontalPath, manualCell, passLength, pingPongPath, randomWalkPath, scanPath, serpentinePath, spiralPath, verticalPath } from '../src/engine/scan';

const isPermutation = (p: number[], n: number) => p.length === n && new Set(p).size === n && p.every((c) => c >= 0 && c < n);

describe('scanning', () => {
  it('HORIZONTAL reads left to right, row by row', () => {
    expect(horizontalPath(3, 2)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('VERTICAL reads top to bottom, column by column', () => {
    expect(verticalPath(3, 2)).toEqual([0, 3, 1, 4, 2, 5]);
  });

  it('REVERSE plays any path backwards', () => {
    expect(scanPath('horizontal', 3, 2, true, 1)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(scanPath('vertical', 3, 2, true, 1)).toEqual([5, 2, 4, 1, 3, 0]);
  });

  it('PING-PONG goes there and back without repeating the ends', () => {
    expect(pingPongPath(4, 1)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(pingPongPath(2, 1)).toEqual([0, 1]);
    // looping a ping-pong pass: ... 2, 1, 0, 1, 2 ...
    const p = pingPongPath(3, 1);
    const seq = Array.from({ length: 8 }, (_, s) => cellAt(p, s, passLength(p.length, 0), 0));
    expect(seq).toEqual([0, 1, 2, 1, 0, 1, 2, 1]);
  });

  it('SERPENTINE alternates the direction of each row', () => {
    expect(serpentinePath(3, 3)).toEqual([0, 1, 2, 5, 4, 3, 6, 7, 8]);
  });

  it('SPIRAL goes from the outside in and visits every cell once', () => {
    expect(spiralPath(3, 3)).toEqual([0, 1, 2, 5, 8, 7, 6, 3, 4]);
    for (const [c, r] of [
      [1, 1],
      [4, 1],
      [1, 5],
      [5, 4],
      [8, 8],
      [7, 3],
    ] as const)
      expect(isPermutation(spiralPath(c, r), c * r)).toBe(true);
    // reversed: from the centre outwards
    expect(scanPath('spiral', 3, 3, true, 0)[0]).toBe(4);
  });

  it('every full-grid mode covers the grid', () => {
    for (const m of ['horizontal', 'vertical', 'serpentine', 'spiral'] as const) expect(isPermutation(scanPath(m, 7, 5, false, 3), 35)).toBe(true);
  });

  it('RANDOM WALK moves only to neighbours, stays inside, and is reproducible from its seed', () => {
    const cols = 9;
    const rows = 6;
    const p = randomWalkPath(cols, rows, 42);
    expect(p.length).toBe(cols * rows);
    for (let i = 1; i < p.length; i++) {
      const dx = Math.abs((p[i]! % cols) - (p[i - 1]! % cols));
      const dy = Math.abs(Math.floor(p[i]! / cols) - Math.floor(p[i - 1]! / cols));
      expect(dx + dy).toBe(1);
      expect(p[i]).toBeGreaterThanOrEqual(0);
      expect(p[i]).toBeLessThan(cols * rows);
    }
    expect(randomWalkPath(cols, rows, 42)).toEqual(p);
    expect(randomWalkPath(cols, rows, 43)).not.toEqual(p);
    expect(randomWalkPath(1, 1, 5)).toEqual([0]);
    expect(randomWalkPath(1, 4, 5).every((c) => c >= 0 && c < 4)).toBe(true);
  });

  it('MANUAL is the cell under the cursor', () => {
    expect(manualCell(4, 4, 0, 0)).toBe(0);
    expect(manualCell(4, 4, 0.99, 0.99)).toBe(15);
    expect(manualCell(4, 4, 1, 1)).toBe(15);
    expect(manualCell(4, 2, 0.6, 0.6)).toBe(6);
    expect(scanPath('manual', 4, 4, false, 0, { x: 0.3, y: 0.8 })).toEqual([13]);
  });

  it('loop boundaries: LENGTH, OFFSET and wrapping', () => {
    const p = horizontalPath(4, 2); // 8 cells
    expect(passLength(p.length, 0)).toBe(8);
    expect(passLength(p.length, 3)).toBe(3);
    // a pass of 3 steps loops 0 1 2 0 1 2
    expect([0, 1, 2, 3, 4, 5].map((s) => cellAt(p, s, 3, 0))).toEqual([0, 1, 2, 0, 1, 2]);
    // offset starts later in the path and wraps round its end
    expect([0, 1, 2, 3].map((s) => cellAt(p, s, 4, 6))).toEqual([6, 7, 0, 1]);
    // a LENGTH longer than the path keeps wrapping through it
    expect([8, 9].map((s) => cellAt(p, s, 10, 0))).toEqual([0, 1]);
    // the end of a full pass returns to the start
    expect(cellAt(p, 8, 8, 0)).toBe(0);
  });
});
