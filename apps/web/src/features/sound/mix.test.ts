import { describe, expect, it } from 'vitest';

import { LEVELS, mixFor, rainWeights } from './mix.ts';
import type { MixInput } from './mix.ts';

const calm: MixInput = {
  night: 0,
  vent: 0,
  fan: false,
  watering: false,
  live: true,
  weather: null,
};

describe('the ambient mix (A9, A10)', () => {
  it('has birds by day and crickets at night, crossing through twilight', () => {
    expect(mixFor(calm).gains).toMatchObject({ birds: LEVELS.birds, crickets: 0 });
    const night = mixFor({ ...calm, night: 1 }).gains;
    expect(night.birds).toBeCloseTo(0);
    expect(night.crickets).toBeCloseTo(LEVELS.crickets);
    // Twilight: both, softly, never a silent gap.
    const dusk = mixFor({ ...calm, night: 0.5 }).gains;
    expect(dusk.birds).toBeGreaterThan(0.25 * LEVELS.birds);
    expect(dusk.crickets).toBeGreaterThan(0.25 * LEVELS.crickets);
  });

  it('hums with the fan and trickles while watering, only with live data', () => {
    expect(mixFor({ ...calm, fan: true, watering: true }).gains).toMatchObject({
      fan: LEVELS.fan,
      water: LEVELS.water,
    });
    // Stale or disconnected: we do not know they run, so they are not heard.
    expect(mixFor({ ...calm, fan: true, watering: true, live: false }).gains).toMatchObject({
      fan: 0,
      water: 0,
    });
  });

  it('lets the outside in with the window open: louder wind, clearer sound', () => {
    const shut = mixFor(calm);
    const open = mixFor({ ...calm, vent: 1 });
    expect(open.gains.wind).toBeGreaterThan(shut.gains.wind);
    expect(shut.glass).toBe(1);
    expect(open.glass).toBe(0);
    expect(mixFor({ ...calm, vent: 0.5 }).glass).toBeCloseTo(0.5);
    // Not live: the window's state is not known, so the glass stays.
    expect(mixFor({ ...calm, vent: 1, live: false }).glass).toBe(1);
  });

  it('blows louder on a windy day (A10)', () => {
    const windy = mixFor({ ...calm, weather: { wind: 1, rain: 0 } });
    expect(windy.gains.wind).toBeCloseTo(LEVELS.windBase + LEVELS.windOpen);
  });

  it('rains only when AEMET says so, a drizzle softer than a downpour (A10)', () => {
    const dry = mixFor({ ...calm, weather: { wind: 0, rain: 0 } }).gains;
    for (const gains of [mixFor(calm).gains, dry]) {
      expect(gains).toMatchObject({ rainLight: 0, rain: 0, rainHeavy: 0, rainGlass: 0 });
    }
    const drizzle = mixFor({ ...calm, weather: { wind: 0, rain: 0.1 } }).gains;
    const downpour = mixFor({ ...calm, weather: { wind: 0, rain: 1 } }).gains;
    expect(drizzle.rainLight).toBeGreaterThan(0);
    expect(downpour.rainHeavy).toBeCloseTo(LEVELS.rain);
    expect(drizzle.rainLight).toBeLessThan(downpour.rainHeavy);
  });
});

describe('the three rains (D123)', () => {
  const power = (rain: number) => {
    const w = rainWeights(rain);
    return w.light ** 2 + w.steady ** 2 + w.heavy ** 2;
  };

  it('is one recording at each end and the steady one in the middle', () => {
    expect(rainWeights(0.1)).toMatchObject({ light: 1, steady: 0, heavy: 0 });
    expect(rainWeights(1).heavy).toBeCloseTo(1);
    expect(rainWeights(1).light).toBeCloseTo(0);
    expect(rainWeights(0.52).steady).toBeCloseTo(1);
  });

  it('keeps the level through every crossing', () => {
    for (let rain = 0; rain <= 1; rain += 0.02) expect(power(rain)).toBeCloseTo(1);
  });

  it('adds the rain on the glass, in proportion and only while it rains', () => {
    const gains = mixFor({ ...calm, weather: { wind: 0, rain: 1 } }).gains;
    expect(gains.rainGlass).toBeCloseTo(LEVELS.rain * LEVELS.rainGlass);
  });
});

describe('what sounds on its own (D123)', () => {
  const rainy = (rain: number, wetness = 0) => ({
    ...calm,
    weather: { wind: 0, rain },
    wetness,
  });

  it('has the blackbird by day, not at night nor when it rains hard', () => {
    expect(mixFor(calm).accents.bird).toBe(1);
    expect(mixFor({ ...calm, night: 1 }).accents.bird).toBeCloseTo(0);
    expect(mixFor(rainy(0.1)).accents.bird).toBe(1);
    expect(mixFor(rainy(0.8)).accents.bird).toBe(0);
  });

  it('drips only once it has stopped and the gauge says it is still wet', () => {
    expect(mixFor(rainy(0, 0.6)).accents.drips).toBe(1);
    expect(mixFor(rainy(0, 0.3)).accents.drips).toBeCloseTo(0.5);
    // Still raining: the rain covers it. Dry, or no weather known: never.
    expect(mixFor(rainy(0.4, 0.6)).accents.drips).toBe(0);
    expect(mixFor(rainy(0, 0.02)).accents.drips).toBe(0);
    expect(mixFor({ ...calm, wetness: 0.6 }).accents.drips).toBe(0);
  });

  it('does not drip on old data', () => {
    expect(mixFor({ ...rainy(0, 0.6), live: false }).accents.drips).toBe(0);
  });
});
