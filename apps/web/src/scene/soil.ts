import { Color } from 'three';

/**
 * Soil colour for a moisture reading: a continuous blend from dry to wet
 * (docs/06). An unknown reading (sensor failure, no data) is shown greyed,
 * never as a plausible value.
 */
export function soilColor(dry: Color, wet: Color, moisture: number | null, target = new Color()) {
  if (moisture === null) {
    target.copy(dry).lerp(wet, 0.5);
    const hsl = { h: 0, s: 0, l: 0 };
    target.getHSL(hsl);
    return target.setHSL(hsl.h, hsl.s * 0.25, hsl.l);
  }
  return target.copy(dry).lerp(wet, Math.min(1, Math.max(0, moisture)));
}
