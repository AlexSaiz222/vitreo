import { BufferAttribute, BufferGeometry, Color } from 'three';
import { describe, expect, it } from 'vitest';

import { retintLeaves } from './leafTones.ts';

const deep = new Color('#687a3f');
const mid = new Color('#849050');
const leafNew = new Color('#97a05a');
const light = new Color('#abac68');
const fruit = new Color('#c4604f');
const tokens = [deep, mid, leafNew, light, fruit] as const;

/** A geometry whose vertices carry the given exported colours (as COLOR_0 arrives). */
function leaves(colours: Color[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(colours.length * 3), 3));
  const data = new Float32Array(colours.length * 4);
  colours.forEach((c, i) => {
    data.set([c.r, c.g, c.b, 1], i * 4);
  });
  geometry.setAttribute('color', new BufferAttribute(data, 4));
  return geometry;
}

const colourAt = (geometry: BufferGeometry, i: number) => {
  const color = geometry.getAttribute('color');
  return new Color(color.getX(i), color.getY(i), color.getZ(i)).getHexString();
};

describe('retintLeaves', () => {
  it('keeps each plant its own greens (two greens stay deep and mid)', () => {
    // The parsley only uses two greens: ranking them would turn mid into light.
    const result = retintLeaves(leaves([deep, mid, mid]), tokens);
    expect([0, 1, 2].map((i) => colourAt(result, i))).toEqual(['687a3f', '849050', '849050']);
  });

  it('keeps flowers and fruit their colour, not a green', () => {
    const result = retintLeaves(leaves([mid, fruit]), tokens);
    expect(colourAt(result, 1)).toBe('c4604f');
  });

  it('snaps a slightly drifted colour to its token', () => {
    const drifted = new Color('#99a25c');
    const result = retintLeaves(leaves([drifted]), tokens);
    expect(colourAt(result, 0)).toBe('97a05a');
  });

  it('follows a token that changes a little', () => {
    const warmer = new Color('#6a7c3c');
    const result = retintLeaves(leaves([deep]), [warmer, mid, leafNew, light]);
    expect(colourAt(result, 0)).toBe('6a7c3c');
  });

  it('keeps the shape keys and leaves the original geometry untouched', () => {
    const original = leaves([deep, mid]);
    original.morphAttributes.position = [new BufferAttribute(new Float32Array(6), 3)];
    const result = retintLeaves(original, tokens);
    expect(result.morphAttributes.position).toHaveLength(1);
    expect(original.getAttribute('color').itemSize).toBe(4);
  });

  it('returns the geometry as is when it has no colours', () => {
    const geometry = new BufferGeometry();
    expect(retintLeaves(geometry, tokens)).toBe(geometry);
  });
});
