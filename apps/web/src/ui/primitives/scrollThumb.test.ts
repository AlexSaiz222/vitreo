import { describe, expect, it } from 'vitest';

import { thumbPlace } from './scrollThumb.ts';

describe('the sheets’ own scrollbar', () => {
  it('is not there when nothing scrolls', () => {
    expect(thumbPlace(0, 500, 500)).toBeNull();
    expect(thumbPlace(0, 500, 0)).toBeNull();
  });

  it('starts at the top, clear of the rounded corner, and ends at the bottom', () => {
    const top = thumbPlace(0, 2000, 800);
    const bottom = thumbPlace(1200, 2000, 800);
    expect(top?.top).toBe(22);
    // In content coordinates: the bottom of the view, minus the same margin.
    expect((bottom?.top ?? 0) + (bottom?.height ?? 0)).toBeCloseTo(1200 + 800 - 22);
  });

  it('is as long as the share of the content in view, never too short to grab', () => {
    expect(thumbPlace(0, 1600, 800)?.height).toBeCloseTo((800 - 44) / 2);
    expect(thumbPlace(0, 100_000, 800)?.height).toBe(32);
  });
});
