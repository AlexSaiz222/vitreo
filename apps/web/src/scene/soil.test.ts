import { Color } from 'three';
import { describe, expect, it } from 'vitest';

import { soilColor } from './soil.ts';
import { wiltAmount } from './wilt.ts';

const dry = new Color('#b39a7c');
const wet = new Color('#3a281e');

describe('soilColor', () => {
  it('is the dry colour at 0 and the wet colour at 1', () => {
    expect(soilColor(dry, wet, 0).getHexString()).toBe('b39a7c');
    expect(soilColor(dry, wet, 1).getHexString()).toBe('3a281e');
  });

  it('gets darker as moisture rises', () => {
    const l = (m: number) => soilColor(dry, wet, m).getHSL({ h: 0, s: 0, l: 0 }).l;
    expect(l(0.2)).toBeGreaterThan(l(0.5));
    expect(l(0.5)).toBeGreaterThan(l(0.8));
  });

  it('shows an unknown reading greyed, unlike any real value', () => {
    const unknown = soilColor(dry, wet, null).getHSL({ h: 0, s: 0, l: 0 });
    const half = soilColor(dry, wet, 0.5).getHSL({ h: 0, s: 0, l: 0 });
    expect(unknown.s).toBeLessThan(half.s / 2);
  });
});

describe('wiltAmount', () => {
  it('does not wilt above the threshold or without data', () => {
    expect(wiltAmount(0.6, 0.4)).toBe(0);
    expect(wiltAmount(null, 0.4)).toBe(0);
  });

  it('wilts progressively below the threshold', () => {
    expect(wiltAmount(0.3, 0.4)).toBeGreaterThan(0);
    expect(wiltAmount(0.2, 0.4)).toBeGreaterThan(wiltAmount(0.3, 0.4));
    expect(wiltAmount(0.05, 0.4)).toBe(1);
  });
});
