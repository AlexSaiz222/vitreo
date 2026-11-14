import { describe, expect, it } from 'vitest';

import type { WeatherNow } from '@vitreo/shared';

import {
  CALM,
  condensationFor,
  decorSwayFor,
  dustFor,
  firefliesFor,
  overcastLight,
  PARTICLES,
  WET,
  wetnessFor,
  particleCounts,
  weatherLook,
  windFor,
} from './atmosphere.ts';

describe('atmosphere mappings (A9)', () => {
  it('mists the glass only with high humidity, never with an unknown reading', () => {
    expect(condensationFor(null)).toBe(0);
    expect(condensationFor(70)).toBe(0);
    expect(condensationFor(82)).toBe(0);
    expect(condensationFor(89)).toBeGreaterThan(0.3);
    expect(condensationFor(89)).toBeLessThan(0.7);
    expect(condensationFor(99)).toBe(1);
  });

  it('moves the leaves more with the fan and the open window, only with live data', () => {
    const still = windFor({ fan: false, vent: 0, live: true });
    expect(still).toEqual({ strength: 1, speed: 1 });
    const fan = windFor({ fan: true, vent: 0, live: true });
    expect(fan.strength).toBeGreaterThan(2);
    expect(fan.speed).toBeGreaterThan(1);
    expect(windFor({ fan: false, vent: 1, live: true }).strength).toBeGreaterThan(1);
    expect(windFor({ fan: true, vent: 1, live: false })).toEqual(still);
  });

  it('shows dust in the sunlight by day only, and none without a light reading', () => {
    expect(dustFor({ night: 0, lux: 20_000 })).toBe(1);
    expect(dustFor({ night: 0, lux: 500 })).toBe(0);
    expect(dustFor({ night: 1, lux: 20_000 })).toBe(0);
    expect(dustFor({ night: 0, lux: null })).toBe(0);
  });

  it('brings fireflies once it is really night', () => {
    expect(firefliesFor(0)).toBe(0);
    expect(firefliesFor(0.5)).toBe(0);
    expect(firefliesFor(1)).toBe(1);
  });

  it('draws fewer particles in Auto and none in Baja, without 3D or with reduced motion', () => {
    expect(particleCounts({ quality: 'high', auto: false, reducedMotion: false })).toEqual(
      PARTICLES.high,
    );
    expect(particleCounts({ quality: 'high', auto: true, reducedMotion: false })).toEqual(
      PARTICLES.auto,
    );
    for (const quality of ['low', 'flat'] as const) {
      expect(particleCounts({ quality, auto: false, reducedMotion: false })).toEqual(
        PARTICLES.none,
      );
    }
    expect(particleCounts({ quality: 'high', auto: false, reducedMotion: true })).toEqual(
      PARTICLES.none,
    );
  });
});

describe('weather in the scene (A10)', () => {
  const rainy: WeatherNow = {
    temp: 12,
    observedAt: null,
    clouds: 0.8,
    rain: 0.5,
    snow: 0,
    fog: 0,
    wind: 0.6,
    wet: true,
    windy: false,
    rainFrom: 'gauge',
    windValue: null,
    windFrom: null,
    precipValue: 0.4,
  };

  it('is calm and neutral when no weather is known', () => {
    expect(weatherLook(null)).toEqual(CALM);
    expect(overcastLight(0)).toEqual({ sun: 1, shadow: 1, flatten: 0 });
  });

  it('shows what AEMET says, within 0–1', () => {
    expect(weatherLook(rainy)).toEqual({ clouds: 0.8, rain: 0.5, snow: 0, fog: 0, wind: 0.6 });
  });

  it('softens the light under clouds, never to darkness', () => {
    const overcast = overcastLight(1);
    expect(overcast.sun).toBeGreaterThan(0.3);
    expect(overcast.shadow).toBeLessThan(0.3);
  });

  it('lets the wind outside reach the leaves only through the open window', () => {
    const shut = windFor({ fan: false, vent: 0, live: true, outside: 1 });
    expect(shut).toEqual(windFor({ fan: false, vent: 0, live: true }));
    const open = windFor({ fan: false, vent: 1, live: true, outside: 1 });
    expect(open.strength).toBeGreaterThan(windFor({ fan: false, vent: 1, live: true }).strength);
  });

  it('sways the plants outside with the wind outside', () => {
    expect(decorSwayFor(0)).toEqual({ strength: 1, speed: 1 });
    expect(decorSwayFor(1).strength).toBeGreaterThan(2);
  });

  it('draws fewer raindrops and flakes in Auto, none in Baja or with reduced motion', () => {
    expect(PARTICLES.auto.rain).toBeLessThan(PARTICLES.high.rain);
    expect(PARTICLES.auto.snow).toBeLessThan(PARTICLES.high.snow);
    expect(particleCounts({ quality: 'low', auto: false, reducedMotion: false }).rain).toBe(0);
    expect(particleCounts({ quality: 'high', auto: false, reducedMotion: true }).snow).toBe(0);
  });
});

describe('wetnessFor', () => {
  const NOW = 1_000_000;
  const HOUR = 3600;
  const fell = (hoursAgo: number, precip: number | null) => ({
    at: NOW - hoursAgo * HOUR,
    precip,
  });

  it('is dry with nothing known, and with no rain measured', () => {
    expect(wetnessFor([], NOW, 0)).toBe(0);
    expect(wetnessFor([fell(2, null), fell(1, null)], NOW, 0)).toBe(0);
    expect(wetnessFor([fell(2, 0), fell(1, 0)], NOW, 0)).toBe(0);
  });

  it('soaks with enough rain, and never goes past 1', () => {
    expect(wetnessFor([fell(1, 30), fell(0, 0)], NOW, 0)).toBe(1);
    expect(wetnessFor([fell(1, WET.fullMm / 4), fell(0, 0)], NOW, 0)).toBeLessThan(0.25);
  });

  it('dries slowly: less the longer ago it fell, but not at once', () => {
    const at = (hoursAgo: number) => wetnessFor([fell(hoursAgo + 1, 1), fell(hoursAgo, 0)], NOW, 0);
    expect(at(1)).toBeLessThan(at(0));
    expect(at(4)).toBeLessThan(at(1));
    expect(at(1)).toBeGreaterThan(at(0) * 0.5);
    expect(at(8)).toBeLessThan(0.05);
  });

  it('counts a reading for the time it stands for, an hour at most', () => {
    // The demo reads the same gauge every minute; AEMET every hour.
    const minutes = Array.from({ length: 60 }, (_, i) => ({
      at: NOW - HOUR + (i + 1) * 60,
      precip: 1,
    }));
    expect(wetnessFor(minutes, NOW, 0)).toBeCloseTo(wetnessFor([fell(0, 1)], NOW, 0), 2);
    // A gap in the readings does not stretch the last one.
    expect(wetnessFor([fell(6, 1), fell(0, 0)], NOW, 0)).toBeLessThan(
      wetnessFor([fell(1, 1), fell(0, 0)], NOW, 0),
    );
  });

  it('wets at once with what falls now, before the next reading', () => {
    expect(wetnessFor([], NOW, 1)).toBe(WET.fromRainNow);
    expect(wetnessFor([fell(1, 30)], NOW, 0.2)).toBe(1);
  });
});
