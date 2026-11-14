/**
 * What sounds on its own over the bed (D123), pure so it is tested without
 * audio: a blackbird's phrase now and then, and the gutter dripping after the
 * rain. Nothing repeats on a beat: every gap, position and pitch is drawn.
 */
export const BIRD_ACCENT = {
  /** Seconds between one phrase and the next. */
  minGap: 16,
  maxGap: 52,
  /** How far to either side it may sit (−1…1). */
  pan: 0.8,
  /** Its level varies this much, as a bird nearer or further away. */
  quietest: 0.55,
} as const;

export const DRIP = {
  /** Drops a second with the ground just soaked (level 1) … */
  fastest: 1.4,
  /** … and just before it stops, with the ground almost dry. */
  slowest: 0.18,
  /** The drop's note at its start (Hz); it rises as the bubble closes. */
  minHz: 900,
  maxHz: 2600,
  rise: 1.5,
  /** Seconds it rings. */
  seconds: 0.09,
  /** Peak gain: a drop is small. */
  peak: 0.14,
  pan: 0.9,
} as const;

/** Seconds until the next phrase. */
export const birdGap = (random: () => number) =>
  BIRD_ACCENT.minGap + (BIRD_ACCENT.maxGap - BIRD_ACCENT.minGap) * random();

/** A phrase picked at random, never the one that has just sung. */
export function nextPhrase(random: () => number, count: number, last: number | null): number {
  if (count < 2 || last === null) return Math.floor(random() * count);
  // One of the others: a shift of 1…count−1 from the last.
  return (last + 1 + Math.floor(random() * (count - 1))) % count;
}

/**
 * Seconds until the next drop: exponential, as drops that do not wait for
 * each other. `level` is how wet it still is, 0–1.
 */
export function dripGap(random: () => number, level: number): number {
  const rate = DRIP.slowest + (DRIP.fastest - DRIP.slowest) * Math.min(1, Math.max(0, level));
  return -Math.log(1 - random() * 0.999) / rate;
}

/** A drop's starting note: most are small and high; a few fall heavier. */
export const dripHz = (random: () => number) =>
  DRIP.minHz + (DRIP.maxHz - DRIP.minHz) * Math.sqrt(random());
