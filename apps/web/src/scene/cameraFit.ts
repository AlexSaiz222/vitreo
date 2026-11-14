import { Vector3 } from 'three';
import type { Box3 } from 'three';

const deg = (value: number) => (value * Math.PI) / 180;

/**
 * docs/02: a low, natural view, the same as the Blender preview camera
 * (direction (1, -1.15, 0.62) in build_greenhouse.py): 23° of elevation and
 * 41° of azimuth (D60; it was 35° and 45°, a steeper isometric view).
 */
export const ELEVATION = deg(23);
export const AZIMUTH = deg(41);

/** From the target towards the camera (unit vector), at the given azimuth. */
export function viewDirection(azimuth = AZIMUTH): Vector3 {
  return new Vector3(
    Math.cos(ELEVATION) * Math.sin(azimuth),
    Math.sin(ELEVATION),
    Math.cos(ELEVATION) * Math.cos(azimuth),
  );
}

/** The default view direction (D60). */
export const VIEW_DIRECTION = viewDirection();

/** On-screen size of a box, in world units, seen along `direction` (orthographic). */
export function projectedSize(
  box: Box3,
  direction: Vector3 = VIEW_DIRECTION,
): { width: number; height: number } {
  const back = direction.clone().normalize();
  const right = new Vector3(0, 1, 0).cross(back).normalize();
  const up = back.clone().cross(right);
  const corner = new Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    );
    const x = corner.dot(right);
    const y = corner.dot(up);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { width: maxX - minX, height: maxY - minY };
}
