import { describe, expect, it } from 'vitest';

import { dropTile, mistTile } from './dropTile.ts';

const SIZE = 256;

/** How many texels have water, at each wetness (a drop's threshold is in A). */
function wetShare(tile: Uint8Array, wetness: number): number {
  let wet = 0;
  for (let i = 0; i < tile.length; i += 4) {
    if ((tile[i + 2] ?? 0) > 0 && (tile[i + 3] ?? 0) / 255 <= wetness) wet++;
  }
  return wet / (tile.length / 4);
}

describe('dropTile', () => {
  const tile = dropTile(SIZE);

  it('is the same every time (captures can compare it)', () => {
    expect(dropTile(SIZE)).toEqual(tile);
    expect(dropTile(SIZE, 12)).not.toEqual(tile);
  });

  it('covers some of the glass, not all of it', () => {
    const share = wetShare(tile, 1);
    expect(share).toBeGreaterThan(0.04);
    expect(share).toBeLessThan(0.3);
  });

  it('gets wetter as the wetness rises: a drizzle shows few drops', () => {
    const drizzle = wetShare(tile, 0.3);
    const rain = wetShare(tile, 0.6);
    expect(drizzle).toBeGreaterThan(0);
    expect(drizzle).toBeLessThan(rain);
    expect(rain).toBeLessThan(wetShare(tile, 1));
  });

  it('leaves dry glass flat', () => {
    for (let i = 0; i < tile.length; i += 4) {
      if (tile[i + 2] === 0) {
        expect(Math.abs((tile[i] ?? 0) - 128)).toBeLessThanOrEqual(1);
        expect(Math.abs((tile[i + 1] ?? 0) - 128)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('wraps round its edges: some drops cross them, with no seam', () => {
    const wetAt = (x: number, y: number) => (tile[(y * SIZE + x) * 4 + 2] ?? 0) > 0;
    let crossing = 0;
    for (let i = 0; i < SIZE; i++) {
      if (wetAt(0, i) && wetAt(SIZE - 1, i)) crossing++;
      if (wetAt(i, 0) && wetAt(i, SIZE - 1)) crossing++;
    }
    expect(crossing).toBeGreaterThan(0);
  });

  it('is not laid on a grid: drops are at uneven distances along a row', () => {
    const rows = new Set<number>();
    for (let y = 0; y < SIZE; y += 8) {
      let runs = 0;
      let wet = false;
      for (let x = 0; x < SIZE; x++) {
        const now = (tile[(y * SIZE + x) * 4 + 2] ?? 0) > 0;
        if (now && !wet) runs++;
        wet = now;
      }
      rows.add(runs);
    }
    expect(rows.size).toBeGreaterThan(3);
  });
});

describe('mistTile', () => {
  const size = 64;
  const tile = mistTile(size);

  it('fills the whole range', () => {
    expect(Math.min(...tile)).toBe(0);
    expect(Math.max(...tile)).toBe(255);
  });

  it('repeats without a seam', () => {
    let jump = 0;
    let inside = 0;
    for (let y = 0; y < size; y++) {
      jump = Math.max(jump, Math.abs((tile[y * size] ?? 0) - (tile[y * size + size - 1] ?? 0)));
      inside = Math.max(inside, Math.abs((tile[y * size + 20] ?? 0) - (tile[y * size + 21] ?? 0)));
    }
    // The step across the edge is no bigger than a step anywhere else.
    expect(jump).toBeLessThanOrEqual(inside * 2);
  });
});
