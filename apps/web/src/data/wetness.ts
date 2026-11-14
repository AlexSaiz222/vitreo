const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * How wet the ground is (0-1, D120): the rain gauge's last hours, each
 * reading worth less the longer ago it fell, so it dries slowly and by the
 * data, never by eye. It takes `WET.fullMm` to soak it; what falls now wets
 * it at once, without waiting for the next reading. Nothing known: dry.
 * `precip` is mm over the hour before the reading (AEMET's gauge, the demo's),
 * so a reading stands for the time since the one before it, an hour at most.
 *
 * Here and not in the scene because the sound reads it too (D123), and the
 * sound also runs with the 3D off.
 */
export const WET = { fullMm: 2, dryingHours: 2.5, fromRainNow: 0.75 } as const;

export function wetnessFor(
  readings: readonly { at: number; precip: number | null }[],
  nowSeconds: number,
  rainNow: number,
): number {
  let water = 0;
  readings.forEach((reading, i) => {
    if (reading.precip === null || reading.at > nowSeconds) return;
    // The first one: as far back as its neighbour is ahead, or a whole hour.
    const next = readings[i + 1]?.at;
    const before =
      readings[i - 1]?.at ?? reading.at - (next === undefined ? 3600 : next - reading.at);
    const hours = Math.min(1, Math.max(0, reading.at - before) / 3600);
    const age = (nowSeconds - reading.at) / 3600 + hours / 2;
    water += reading.precip * hours * Math.exp(-age / WET.dryingHours);
  });
  return Math.max(clamp(water / WET.fullMm), clamp(rainNow) * WET.fromRainNow);
}
