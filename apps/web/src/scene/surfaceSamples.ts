import { Vector3 } from 'three';
import type { BufferGeometry, Matrix4 } from 'three';

/**
 * Points scattered on the diorama's real surfaces (D119): where rain lands,
 * where the gutter drips from. Weighted by area, from a fixed sequence, so
 * the same places every visit (and in captures).
 */

export interface SampleMesh {
  geometry: BufferGeometry;
  matrixWorld: Matrix4;
}

interface Triangle {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  area: number;
}

/** The world-space triangles of some meshes whose facing passes `keep`. */
function trianglesOf(
  meshes: readonly SampleMesh[],
  keep: (normal: Vector3, centre: Vector3) => boolean,
): Triangle[] {
  const triangles: Triangle[] = [];
  const ab = new Vector3();
  const ac = new Vector3();
  const normal = new Vector3();
  const centre = new Vector3();
  for (const { geometry, matrixWorld } of meshes) {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    const vertex = (i: number) =>
      new Vector3()
        .fromBufferAttribute(position, index ? index.getX(i) : i)
        .applyMatrix4(matrixWorld);
    for (let i = 0; i + 2 < count; i += 3) {
      const a = vertex(i);
      const b = vertex(i + 1);
      const c = vertex(i + 2);
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      const twice = normal.length();
      if (twice === 0) continue;
      normal.divideScalar(twice);
      centre.copy(a).add(b).add(c).divideScalar(3);
      if (keep(normal, centre)) triangles.push({ a, b, c, area: twice / 2 });
    }
  }
  return triangles;
}

/** `count` points on those triangles, as x, y, z triples. Empty if there are none. */
export function surfaceSamples(
  meshes: readonly SampleMesh[],
  count: number,
  keep: (normal: Vector3, centre: Vector3) => boolean,
  seed = 13,
): Float32Array {
  const triangles = trianglesOf(meshes, keep);
  const total = triangles.reduce((sum, triangle) => sum + triangle.area, 0);
  if (triangles.length === 0 || total === 0) return new Float32Array(0);
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let left = random() * total;
    let chosen = triangles[triangles.length - 1];
    for (const triangle of triangles) {
      left -= triangle.area;
      if (left <= 0) {
        chosen = triangle;
        break;
      }
    }
    if (!chosen) break;
    // Uniform inside the triangle.
    const r = Math.sqrt(random());
    const s = random();
    const { a, b, c } = chosen;
    points[i * 3] = (1 - r) * a.x + r * (1 - s) * b.x + r * s * c.x;
    points[i * 3 + 1] = (1 - r) * a.y + r * (1 - s) * b.y + r * s * c.y;
    points[i * 3 + 2] = (1 - r) * a.z + r * (1 - s) * b.z + r * s * c.z;
  }
  return points;
}
