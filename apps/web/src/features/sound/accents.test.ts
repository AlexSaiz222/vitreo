import { describe, expect, it } from 'vitest';

import { BIRD_ACCENT, birdGap, DRIP, dripGap, dripHz, nextPhrase } from './accents.ts';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

describe('the bird that sings on its own (D123)', () => {
  it('waits between its limits', () => {
    const random = seeded(1);
    for (let i = 0; i < 200; i++) {
      const gap = birdGap(random);
      expect(gap).toBeGreaterThanOrEqual(BIRD_ACCENT.minGap);
      expect(gap).toBeLessThanOrEqual(BIRD_ACCENT.maxGap);
    }
  });

  it('never sings the same phrase twice in a row, and sings them all', () => {
    const random = seeded(2);
    const sung = new Set<number>();
    let last: number | null = null;
    for (let i = 0; i < 300; i++) {
      const phrase: number = nextPhrase(random, 8, last);
      expect(phrase).toBeGreaterThanOrEqual(0);
      expect(phrase).toBeLessThan(8);
      expect(phrase).not.toBe(last);
      sung.add(phrase);
      last = phrase;
    }
    expect(sung.size).toBe(8);
  });

  it('copes with a single phrase', () => {
    expect(nextPhrase(seeded(3), 1, 0)).toBe(0);
  });
});

describe('the gutter after the rain (D123)', () => {
  const meanGap = (level: number) => {
    const random = seeded(4);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += dripGap(random, level);
    return sum / 4000;
  };

  it('drips faster the wetter it still is', () => {
    expect(meanGap(1)).toBeCloseTo(1 / DRIP.fastest, 1);
    expect(meanGap(0)).toBeCloseTo(1 / DRIP.slowest, 0);
    expect(meanGap(0.5)).toBeLessThan(meanGap(0.1));
  });

  it('always waits a finite, positive time', () => {
    expect(dripGap(() => 0, 1)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(dripGap(() => 0.999999, 0))).toBe(true);
  });

  it('keeps its notes in range', () => {
    const random = seeded(5);
    for (let i = 0; i < 200; i++) {
      const hz = dripHz(random);
      expect(hz).toBeGreaterThanOrEqual(DRIP.minHz);
      expect(hz).toBeLessThanOrEqual(DRIP.maxHz);
    }
  });
});
