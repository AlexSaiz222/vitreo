/**
 * How a layer wanders through its loop (D114), pure so it is tested
 * without audio. Each layer plays as two voices, panned apart; each voice
 * plays a stretch of the loop from a random point and, before it ends,
 * fades into another stretch from another point (equal power). The loop is
 * seamless, so a stretch may run past its end and wrap. Two voices at
 * different points sound like a wide stereo bed, and the stretches never
 * line up the same way twice: no repetition to hear.
 */
export const STRETCH = {
  /** Seconds a stretch lasts, fades included. */
  min: 14,
  max: 28,
  /** Seconds of each crossfade. */
  fade: 4,
} as const;

/** Where each voice sits: wide for what is outside, close for what is inside. */
export const SPREAD = { outside: 0.6, inside: 0.25 } as const;

/** Each voice at 1/√2: two uncorrelated voices add up to the level of one. */
export const VOICE_GAIN = Math.SQRT1_2;

export interface Stretch {
  /** When it starts, in the audio clock (s). */
  at: number;
  /** Where in the loop it starts (s), 0 ≤ offset < loop length. */
  offset: number;
  /** How long it plays (s), fades included. */
  length: number;
}

/** The stretch that follows `previous` (or the first, at `at`), from `random()` ∈ [0, 1). */
export function nextStretch(
  random: () => number,
  loopSeconds: number,
  previous: Stretch | null,
  at = 0,
): Stretch {
  // Short loops (the fan) still crossfade, just less often than they wrap.
  const length = STRETCH.min + (STRETCH.max - STRETCH.min) * random();
  return {
    at: previous ? previous.at + previous.length - STRETCH.fade : at,
    offset: random() * loopSeconds,
    length,
  };
}

/**
 * Every stretch needed after `last` (or from `from`, the first) so that one
 * is still playing at `until` (s): each starts as the previous fades out.
 */
export function stretchesUntil(
  random: () => number,
  loopSeconds: number,
  last: Stretch | null,
  from: number,
  until: number,
): Stretch[] {
  const out: Stretch[] = [];
  let current = last;
  while (current === null || current.at + current.length - STRETCH.fade < until) {
    current = nextStretch(random, loopSeconds, current, from);
    out.push(current);
  }
  return out;
}

/** Equal-power fade curves of `points` samples: in rises as sin, out falls as cos. */
export function fadeCurves(points = 32): { fadeIn: Float32Array; fadeOut: Float32Array } {
  const fadeIn = new Float32Array(points);
  const fadeOut = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    fadeIn[i] = Math.sin((t * Math.PI) / 2);
    fadeOut[i] = Math.cos((t * Math.PI) / 2);
  }
  return { fadeIn, fadeOut };
}

/**
 * A short room for what sounds inside the glass (D114): two channels of
 * decaying noise, a little different each, darker as they fade. Generated,
 * not recorded, so it needs no file and no licence.
 */
export function roomImpulse(
  sampleRate: number,
  random: () => number,
  seconds = 0.9,
  decay = 0.22,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const length = Math.round(seconds * sampleRate);
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [
    new Float32Array(length),
    new Float32Array(length),
  ];
  for (const channel of channels) {
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      // A one-pole low-pass that closes as the tail goes on: glass is bright, then soft.
      const smoothing = Math.min(0.95, 0.15 + t * 1.2);
      low = low * smoothing + (random() * 2 - 1) * (1 - smoothing);
      channel[i] = low * Math.exp(-t / decay);
    }
  }
  return channels;
}

/**
 * The master's soft ceiling (D114), for a WaveShaperNode: straight up to
 * `knee` (−2 dBFS), then rounded towards 1, so a rare peak of the sum is
 * softened instead of clipped. Straight means no change at all below it.
 */
export function softCeiling(points = 2049, knee = 10 ** (-2 / 20)): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const room = 1 - knee;
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const size = Math.abs(x);
    const y = size <= knee ? size : knee + room * Math.tanh((size - knee) / room);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}
