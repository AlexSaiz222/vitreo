import { describe, expect, it } from 'vitest';

import { effectiveQuality, isQuality } from './settings.ts';

describe('effectiveQuality', () => {
  const base = { quality: 'auto' as const, autoLowered: false, webglFailed: false };

  it('auto is high until frames get slow, then low', () => {
    expect(effectiveQuality(base)).toBe('high');
    expect(effectiveQuality({ ...base, autoLowered: true })).toBe('low');
  });

  it('a chosen quality stays, even if auto would have lowered it', () => {
    expect(effectiveQuality({ ...base, quality: 'high', autoLowered: true })).toBe('high');
    expect(effectiveQuality({ ...base, quality: 'low' })).toBe('low');
    expect(effectiveQuality({ ...base, quality: 'flat' })).toBe('flat');
  });

  it('without WebGL there is no 3D, whatever was chosen', () => {
    expect(effectiveQuality({ ...base, quality: 'high', webglFailed: true })).toBe('flat');
  });
});

describe('isQuality', () => {
  it.each(['auto', 'high', 'low', 'flat'])('accepts %s', (value) => {
    expect(isQuality(value)).toBe(true);
  });

  it.each(['ultra', '', null, 3])('rejects %s', (value) => {
    expect(isQuality(value)).toBe(false);
  });
});
