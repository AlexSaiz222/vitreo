import { describe, expect, it } from 'vitest';

import { dailyCurve, MADRID_LATE_OCTOBER } from './outside.ts';
import { ACCELERATED_WEEK_START } from './week.ts';

const HOUR_MS = 3_600_000;
const curve = dailyCurve(ACCELERATED_WEEK_START, MADRID_LATE_OCTOBER);
const weather = (ms: number) => {
  if (!curve.weather) throw new Error('dailyCurve gives the weather');
  return curve.weather(ms);
};
/** Every ten minutes of the week. */
const instants = Array.from({ length: 7 * 24 * 6 }, (_, i) => ACCELERATED_WEEK_START + i * 600_000);
const hourOf = (ms: number) => ((ms - ACCELERATED_WEEK_START) % (24 * HOUR_MS)) / HOUR_MS;

describe('the week outside (D104, D111)', () => {
  it('has clouds, rain, early fog and wind', () => {
    expect(MADRID_LATE_OCTOBER.some((day) => day.cloud >= 0.8)).toBe(true);
    const wet = instants.filter((ms) => weather(ms).rainMmH > 0);
    // At least one rain episode of over an hour.
    expect(wet.length * 10).toBeGreaterThanOrEqual(60);
    const foggy = instants.filter((ms) => (weather(ms).visibilityKm ?? Infinity) < 1);
    expect(foggy.length).toBeGreaterThan(0);
    // Fog in the early morning only.
    expect(foggy.every((ms) => hourOf(ms) >= 4 && hourOf(ms) < 11)).toBe(true);
    // Some wind every day, a breezy front; never as strong as the window rule's (A10).
    const winds = instants.map((ms) => weather(ms).wind);
    expect(Math.max(...winds.map((wind) => wind.mean))).toBeGreaterThanOrEqual(5);
    expect(Math.max(...winds.map((wind) => wind.gust))).toBeLessThan(50 / 3.6);
  });

  it('rains only on cloudy days: the greenhouse reads its light from the clouds alone', () => {
    for (const day of MADRID_LATE_OCTOBER) {
      if (day.rain) expect(day.cloud).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('lifts the fog by mid-morning, and calms the wind at night', () => {
    const fogDay = ACCELERATED_WEEK_START + 5 * 24 * HOUR_MS;
    expect(weather(fogDay + 6 * HOUR_MS).visibilityKm).toBe(0.3);
    expect(weather(fogDay + 11 * HOUR_MS).visibilityKm).toBeNull();
    const front = ACCELERATED_WEEK_START + 3 * 24 * HOUR_MS;
    expect(weather(front + 3 * HOUR_MS).wind.mean).toBeLessThan(
      weather(front + 15 * HOUR_MS).wind.mean,
    );
    expect(weather(front + 10 * HOUR_MS).rainMmH).toBe(2.5);
    expect(weather(front + 14 * HOUR_MS).rainMmH).toBe(0);
  });
});
