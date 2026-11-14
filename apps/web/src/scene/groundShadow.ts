import { CanvasTexture, Vector3 } from 'three';
import type { Box3 } from 'three';

/** Texture pixels per metre of ground: enough for a soft, blurred shadow. */
const PIXELS_PER_METRE = 220;

/** A point on the ground (x, z), in metres. */
export type GroundPoint = readonly [x: number, z: number];

/** Shapes drawn with one blur and one strength. */
export interface ShadowLayer {
  polygons: readonly (readonly GroundPoint[])[];
  /** Metres. */
  blur: number;
  /** 0–1, on top of the material's opacity. */
  strength: number;
}

/** A box's footprint on the ground. */
export function footprint(box: Box3): GroundPoint[] {
  return [
    [box.min.x, box.min.z],
    [box.max.x, box.min.z],
    [box.max.x, box.max.z],
    [box.min.x, box.max.z],
  ];
}

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points: readonly GroundPoint[]): GroundPoint[] {
  const sorted = [...points].sort(([ax, az], [bx, bz]) => ax - bx || az - bz);
  const cross = (o: GroundPoint, a: GroundPoint, b: GroundPoint) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: GroundPoint[]) => {
    const out: GroundPoint[] = [];
    for (const point of list) {
      while (out.length >= 2) {
        const a = out[out.length - 2];
        const b = out[out.length - 1];
        if (!a || !b || cross(a, b, point) > 0) break;
        out.pop();
      }
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * The shadow a box casts on the ground under a sun coming from `towardsSun`:
 * its footprint swept along the light up to `height` (blurred later, so a
 * box is a good enough stand-in for the greenhouse).
 */
export function castShadow(box: Box3, towardsSun: Vector3, height: number): GroundPoint[] {
  const sun = towardsSun.clone().normalize();
  const reach = height / Math.max(sun.y, 0.1);
  const dx = -sun.x * reach;
  const dz = -sun.z * reach;
  const base = footprint(box);
  return convexHull([...base, ...base.map(([x, z]): GroundPoint => [x + dx, z + dz])]);
}

/**
 * The soft shadows where the diorama meets the page, drawn once: nothing on
 * the page moves, so there is no shadow map to render every frame. White
 * texture with the shadow in its alpha, to be tinted by the material.
 *
 * `area` is the ground the texture covers (x and z).
 */
export function createGroundShadowTexture(
  layers: readonly ShadowLayer[],
  area: Box3,
): CanvasTexture | null {
  const width = Math.ceil((area.max.x - area.min.x) * PIXELS_PER_METRE);
  const height = Math.ceil((area.max.z - area.min.z) * PIXELS_PER_METRE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  // Draw the shapes off the canvas and keep only their blurred shadow
  // (canvas `filter` is not available everywhere; shadows are).
  const away = width + height + 4 * PIXELS_PER_METRE;
  context.shadowOffsetX = away;
  context.fillStyle = '#ffffff';
  for (const layer of layers) {
    context.shadowColor = `rgba(255, 255, 255, ${layer.strength.toFixed(3)})`;
    context.shadowBlur = layer.blur * PIXELS_PER_METRE;
    for (const polygon of layer.polygons) {
      context.beginPath();
      polygon.forEach(([x, z], i) => {
        const px = (x - area.min.x) * PIXELS_PER_METRE - away;
        const pz = (z - area.min.z) * PIXELS_PER_METRE;
        if (i === 0) context.moveTo(px, pz);
        else context.lineTo(px, pz);
      });
      context.closePath();
      context.fill();
    }
  }
  // Laid flat (rotated -90° about x), the plane's top edge points to -z: with
  // the default flipY, the canvas's first row lands on the lowest z, as drawn.
  return new CanvasTexture(canvas);
}

/** The area a set of polygons covers, plus `margin` metres. */
export function areaOf(polygons: readonly (readonly GroundPoint[])[], margin: number, into: Box3) {
  into.makeEmpty();
  for (const polygon of polygons) {
    for (const [x, z] of polygon) into.expandByPoint(new Vector3(x, 0, z));
  }
  return into.expandByScalar(margin);
}
