import { BufferAttribute, BufferGeometry, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';

import { surfaceSamples } from './surfaceSamples.ts';

/** A square at height y, 1 m a side, facing up, and one facing down below it. */
function plates(y: number) {
  const geometry = new BufferGeometry();
  // prettier-ignore
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0, y, 1,  1, y, 1,  1, y, 0,
    0, y, 1,  1, y, 0,  0, y, 0,
    0, y - 1, 0,  1, y - 1, 0,  1, y - 1, 1,
  ]), 3));
  return { geometry, matrixWorld: new Matrix4() };
}

const atHeights = (points: Float32Array) => {
  const heights = new Set<number>();
  for (let i = 1; i < points.length; i += 3) heights.add(points[i] ?? NaN);
  return heights;
};

describe('surfaceSamples', () => {
  it('keeps only the triangles it is told to', () => {
    const up = surfaceSamples([plates(2)], 50, (normal) => normal.y > 0.5);
    expect(atHeights(up)).toEqual(new Set([2]));
    const down = surfaceSamples([plates(2)], 50, (normal) => normal.y < -0.5);
    expect(atHeights(down)).toEqual(new Set([1]));
  });

  it('stays on the surface, in world space', () => {
    const mesh = plates(0);
    mesh.matrixWorld.makeTranslation(5, 0, 0);
    const points = surfaceSamples([mesh], 40, (normal) => normal.y > 0.5);
    for (let i = 0; i < points.length; i += 3) {
      expect(points[i]).toBeGreaterThanOrEqual(5);
      expect(points[i]).toBeLessThanOrEqual(6);
      expect(points[i + 2]).toBeGreaterThanOrEqual(0);
      expect(points[i + 2]).toBeLessThanOrEqual(1);
    }
  });

  it('spreads by area: a surface twice as big gets about twice the points', () => {
    const small = plates(1);
    const big = plates(3);
    big.matrixWorld.makeScale(Math.SQRT2, 1, Math.SQRT2);
    const points = surfaceSamples([small, big], 3000, (normal) => normal.y > 0.5);
    let high = 0;
    for (let i = 1; i < points.length; i += 3) if (points[i] === 3) high++;
    expect(high / 3000).toBeGreaterThan(0.62);
    expect(high / 3000).toBeLessThan(0.72);
  });

  it('is the same every time, and empty with nothing to land on', () => {
    const keep = (normal: { y: number }) => normal.y > 0.5;
    expect(surfaceSamples([plates(1)], 10, keep)).toEqual(surfaceSamples([plates(1)], 10, keep));
    expect(surfaceSamples([plates(1)], 10, () => false)).toHaveLength(0);
    expect(surfaceSamples([], 10, () => true)).toHaveLength(0);
  });
});
