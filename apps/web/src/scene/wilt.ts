// No three.js here: the UI uses this too and must not pull the 3D bundle.

/** How wilted a plant looks (0–1): nothing above its threshold, fully wilted when dry. */
export function wiltAmount(moisture: number | null, threshold: number): number {
  if (moisture === null || moisture >= threshold) return 0;
  return Math.min(1, (threshold - moisture) / (threshold * 0.75));
}
