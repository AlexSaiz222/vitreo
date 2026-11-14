import { describe, expect, it } from 'vitest';

import { isThemeSetting, nextSetting } from './themeChoice.ts';

describe('theme setting', () => {
  it('cycles auto → day → night → auto', () => {
    expect(nextSetting('auto')).toBe('day');
    expect(nextSetting('day')).toBe('night');
    expect(nextSetting('night')).toBe('auto');
  });

  it('only accepts the three settings from storage', () => {
    expect(isThemeSetting('night')).toBe(true);
    expect(isThemeSetting('dusk')).toBe(false);
    expect(isThemeSetting(null)).toBe(false);
  });
});
