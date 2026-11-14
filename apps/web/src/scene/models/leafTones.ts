import { BufferAttribute } from 'three';
import type { BufferGeometry, Color } from 'three';

/**
 * Plant colours: Blender paints each leaf, petal or fruit with COLOR_0 (the
 * "tone" attribute), using the palette tokens. The tokens stay the source of
 * truth, so every exported colour is replaced by the current colour of its
 * nearest token (`pnpm models` warns when an export drifts from them). A
 * small change of a token follows without a new export; a large one needs
 * the model re-exported with the new colour.
 */
export function retintLeaves(geometry: BufferGeometry, tokens: readonly Color[]): BufferGeometry {
  const source = geometry.getAttribute('color');
  const [first] = tokens;
  if (!(source instanceof BufferAttribute) || !first) return geometry;

  const nearest = new Map<string, Color>();
  const colourOf = (i: number): Color => {
    const r = source.getX(i);
    const g = source.getY(i);
    const b = source.getZ(i);
    const key = `${r.toFixed(3)},${g.toFixed(3)},${b.toFixed(3)}`;
    const known = nearest.get(key);
    if (known) return known;
    const distance = (c: Color) => (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
    let token = first;
    for (const candidate of tokens) {
      if (distance(candidate) < distance(token)) token = candidate;
    }
    nearest.set(key, token);
    return token;
  };

  const colors = new Float32Array(source.count * 3);
  for (let i = 0; i < source.count; i++) {
    const token = colourOf(i);
    colors.set([token.r, token.g, token.b], i * 3);
  }
  const result = geometry.clone();
  result.setAttribute('color', new BufferAttribute(colors, 3));
  return result;
}
