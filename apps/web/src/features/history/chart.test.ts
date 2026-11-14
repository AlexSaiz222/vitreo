import { describe, expect, it } from 'vitest';

import {
  gapSpans,
  indexAt,
  linePath,
  niceDomain,
  normalized,
  readings,
  xOf,
  yOf,
} from './chart.ts';
import type { Series } from './chart.ts';

const series = (values: (number | null)[]): Series => ({
  ts: values.map((_, i) => 1000 + i * 100),
  values,
  step: 100,
  from: 1000,
  to: 1000 + values.length * 100,
});

describe('history chart geometry', () => {
  it('places time across and moisture up', () => {
    const s = series([0.5, 0.5]);
    expect(xOf(s, 1000)).toBe(0);
    expect(xOf(s, 1200)).toBe(100);
    expect(yOf(1)).toBe(0);
    expect(yOf(0)).toBe(100);
    expect(yOf(1.5)).toBe(0);
  });

  it('breaks the line at a gap instead of bridging it', () => {
    const path = linePath(series([0.5, 0.6, null, 0.4, 0.3]));
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).toBe('M10 50 L30 40 M70 60 L90 70');
  });

  it('draws a reading alone between gaps as a dot', () => {
    expect(linePath(series([null, 0.5, null]))).toBe('M50 50 h0.01');
    expect(linePath(series([null, null]))).toBe('');
  });

  it('finds the gaps, but not the time before history began', () => {
    const s = series([null, null, 0.5, null, null, 0.4, null]);
    expect(gapSpans(s, 1200)).toEqual([
      { start: 1300, end: 1500 },
      { start: 1600, end: 1700 },
    ]);
    // No history at all: nothing yet, not gaps.
    expect(gapSpans(s, null)).toEqual([]);
  });

  it('picks the bucket under a finger, and counts readings', () => {
    const s = series([0.1, 0.2, 0.3, 0.4]);
    expect(indexAt(s, 0)).toBe(0);
    expect(indexAt(s, 60)).toBe(2);
    expect(indexAt(s, 100)).toBe(3);
    expect(readings(series([0.1, null, 0.2]))).toBe(2);
  });
});

describe('scales for the greenhouse charts (A11)', () => {
  const series: Series = { ts: [0, 10, 20], values: [10, null, 30], step: 10, from: 0, to: 30 };

  it('maps values into 0–1 and keeps gaps', () => {
    expect(normalized(series, [10, 30]).values).toEqual([0, null, 1]);
  });

  it('rounds the axis to whole units, wide enough, never below the floor', () => {
    expect(niceDomain([18.4, 26.1], { unit: 5, minSpan: 10, fallback: [0, 40] })).toEqual([15, 30]);
    expect(niceDomain([21, 22], { unit: 5, minSpan: 10, fallback: [0, 40] })).toEqual([15, 30]);
    expect(niceDomain([0, 800], { unit: 1000, minSpan: 1000, floor: 0, fallback: [0, 1] })).toEqual(
      [0, 1000],
    );
    expect(niceDomain([2, 3], { unit: 5, minSpan: 20, floor: 0, fallback: [0, 1] })).toEqual([
      0, 25,
    ]);
    expect(niceDomain([null], { unit: 5, minSpan: 10, fallback: [0, 40] })).toEqual([0, 40]);
  });
});
