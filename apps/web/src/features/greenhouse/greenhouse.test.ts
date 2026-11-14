import { describe, expect, it } from 'vitest';

import { onSpans, valueAt } from '../history/chart.ts';
import type { Series } from '../history/chart.ts';
import { outsideSeries } from './useGreenhouseHistory.ts';

const HOUR = 3600;
const row = (at: number, temp: number | null) => ({
  at,
  station: '3195',
  temp,
  rh: null,
  windSpeed: null,
  windGust: null,
  precip: null,
});

describe('the greenhouse sheet (A11)', () => {
  it("buckets AEMET's hourly readings, never finer than an hour, and keeps its gaps", () => {
    // 24 h in 15-minute buckets inside: outside, hourly.
    const series = outsideSeries(
      [row(0, 10), row(HOUR, 12), row(3 * HOUR, null)],
      (r) => r.temp,
      0,
      4 * HOUR,
      15 * 60,
    );
    expect(series.step).toBe(HOUR);
    expect(series.values).toEqual([10, 12, null, null]);
  });

  it('averages several readings in a longer bucket', () => {
    const series = outsideSeries([row(0, 10), row(HOUR, 14)], (r) => r.temp, 0, 4 * HOUR, 4 * HOUR);
    expect(series.values).toEqual([12]);
  });

  it('reads the value at an instant, and when something was on', () => {
    const fan: Series = { ts: [0, 10, 20, 30], values: [0, 0.5, 1, 0], step: 10, from: 0, to: 40 };
    expect(valueAt(fan, 15)).toBe(0.5);
    expect(valueAt(fan, 99)).toBeNull();
    expect(onSpans(fan)).toEqual([{ start: 10, end: 30 }]);
    expect(onSpans({ ...fan, values: [1, null, 1, 1] })).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 40 },
    ]);
  });
});
