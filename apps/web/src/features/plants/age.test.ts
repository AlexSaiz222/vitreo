import { describe, expect, it } from 'vitest';

import { plantAge } from './age.ts';

describe('a plant’s age (A12)', () => {
  const now = new Date('2026-10-15T09:00:00').getTime();

  it('in days, then months, then years', () => {
    expect(plantAge('2026-10-15', now)).toBe('Sembrada hoy');
    expect(plantAge('2026-10-14', now)).toBe('Sembrada ayer');
    expect(plantAge('2026-09-22', now)).toBe('Sembrada hace 23 días');
    expect(plantAge('2026-07-01', now)).toBe('Sembrada hace 3 meses');
    expect(plantAge('2025-09-01', now)).toBe('Sembrada hace más de un año');
  });

  it('nothing without a day, or with one still to come', () => {
    expect(plantAge(null, now)).toBeNull();
    expect(plantAge('2026-11-01', now)).toBeNull();
  });
});
