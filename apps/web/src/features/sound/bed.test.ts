import { describe, expect, it } from 'vitest';

import {
  fadeCurves,
  nextStretch,
  roomImpulse,
  softCeiling,
  STRETCH,
  stretchesUntil,
  VOICE_GAIN,
} from './bed.ts';

/** A repeatable random(): the same stretches on every run. */
function seeded(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

describe('a layer wandering through its loop (D114)', () => {
  it('covers the whole time with no gap: each stretch starts as the previous fades out', () => {
    const stretches = stretchesUntil(seeded(), 48, null, 0, 600);
    expect(stretches[0]?.at).toBe(0);
    for (let i = 1; i < stretches.length; i++) {
      const before = stretches[i - 1];
      const stretch = stretches[i];
      if (!before || !stretch) continue;
      expect(stretch.at).toBeCloseTo(before.at + before.length - STRETCH.fade, 9);
    }
    const last = stretches.at(-1);
    expect(last && last.at + last.length - STRETCH.fade).toBeGreaterThanOrEqual(600);
  });

  it('starts each stretch somewhere in the loop, and lasts between the limits', () => {
    for (const stretch of stretchesUntil(seeded(3), 10, null, 5, 2000)) {
      expect(stretch.offset).toBeGreaterThanOrEqual(0);
      expect(stretch.offset).toBeLessThan(10);
      expect(stretch.length).toBeGreaterThanOrEqual(STRETCH.min);
      expect(stretch.length).toBeLessThanOrEqual(STRETCH.max);
      // Long enough that the fade in and the fade out never overlap.
      expect(stretch.length).toBeGreaterThan(2 * STRETCH.fade);
    }
  });

  it('never repeats: in ten minutes, no two stretches start at the same point', () => {
    const offsets = stretchesUntil(seeded(11), 48, null, 0, 600).map((s) => s.offset.toFixed(2));
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it('carries on after what is already scheduled, and adds nothing if it is enough', () => {
    const random = seeded(5);
    const first = stretchesUntil(random, 48, null, 0, 30);
    const last = first.at(-1) ?? null;
    const more = stretchesUntil(random, 48, last, 0, 90);
    expect(more[0]?.at).toBeCloseTo((last?.at ?? 0) + (last?.length ?? 0) - STRETCH.fade, 9);
    expect(stretchesUntil(random, 48, more.at(-1) ?? null, 0, 10)).toEqual([]);
  });

  it('crossfades at equal power, and two voices add up to the level of one', () => {
    const { fadeIn, fadeOut } = fadeCurves(65);
    for (let i = 0; i < fadeIn.length; i++) {
      expect((fadeIn[i] ?? 0) ** 2 + (fadeOut[i] ?? 0) ** 2).toBeCloseTo(1, 6);
    }
    expect(fadeIn[0]).toBe(0);
    expect(fadeIn.at(-1)).toBeCloseTo(1, 6);
    expect(2 * VOICE_GAIN ** 2).toBeCloseTo(1, 9);
    expect(nextStretch(seeded(), 48, null, 12).at).toBe(12);
  });
});

describe('the master and the room (D114)', () => {
  it('leaves everything below −2 dBFS untouched and never goes past full scale', () => {
    const curve = softCeiling(2049);
    const knee = 10 ** (-2 / 20);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      const y = curve[i] ?? 0;
      if (Math.abs(x) <= knee) expect(y).toBeCloseTo(x, 9);
      expect(Math.abs(y)).toBeLessThan(1);
      if (i > 0) expect(y).toBeGreaterThanOrEqual(curve[i - 1] ?? -1);
    }
  });

  it('makes a short room that fades away, a little different on each side', () => {
    const [left, right] = roomImpulse(48_000, seeded(2));
    expect(left.length).toBe(Math.round(0.9 * 48_000));
    const energy = (from: number, to: number) =>
      left.slice(from, to).reduce((sum, v) => sum + v * v, 0);
    expect(energy(0, 4800)).toBeGreaterThan(100 * energy(38_400, 43_200));
    expect(left.slice(0, 1000)).not.toEqual(right.slice(0, 1000));
  });
});
