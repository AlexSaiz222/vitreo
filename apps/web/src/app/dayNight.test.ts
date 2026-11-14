import { describe, expect, it } from 'vitest';

import { nightAmount, themeAt } from './dayNight.ts';

const MADRID = { lat: 40.42, lng: -3.7 };

describe('themeAt', () => {
  it('is day at noon and night at midnight in Madrid', () => {
    expect(themeAt(new Date('2026-09-30T12:00:00Z'), MADRID)).toBe('day');
    expect(themeAt(new Date('2026-09-30T23:00:00Z'), MADRID)).toBe('night');
  });

  it('switches around the real sunset (≈ 17:59 UTC on 30 Sep in Madrid)', () => {
    expect(themeAt(new Date('2026-09-30T17:45:00Z'), MADRID)).toBe('day');
    expect(themeAt(new Date('2026-09-30T18:15:00Z'), MADRID)).toBe('night');
  });

  it('depends on the location', () => {
    const date = new Date('2026-09-30T20:30:00Z');
    expect(themeAt(date, MADRID)).toBe('night');
    expect(themeAt(date, { lat: 19.43, lng: -99.13 })).toBe('day'); // Mexico City
  });
});

describe('nightAmount', () => {
  it('is full day at noon and full night at midnight', () => {
    expect(nightAmount(new Date('2026-09-30T12:00:00Z'), MADRID)).toBe(0);
    expect(nightAmount(new Date('2026-09-30T23:00:00Z'), MADRID)).toBe(1);
  });

  it('blends through the sunset instead of switching', () => {
    const at = (time: string) => nightAmount(new Date(`2026-09-30T${time}:00Z`), MADRID);
    const sunset = at('17:59');
    expect(sunset).toBeGreaterThan(0.2);
    expect(sunset).toBeLessThan(0.8);
    expect(at('17:30')).toBeLessThan(sunset);
    expect(at('18:20')).toBeGreaterThan(sunset);
  });
});
