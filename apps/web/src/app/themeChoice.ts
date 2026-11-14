import { create } from 'zustand';

import { IN_DEMO } from './demo.ts';
import { viewOptions } from './viewOptions.ts';

/**
 * How the scene is lit: following the real sun, or forced to day or night
 * (the HUD button, to see how each looks; docs/03 plans it for Ajustes).
 * Interface state, not device state.
 */
export type ThemeSetting = 'auto' | 'day' | 'night';

/** localStorage key; the boot script in index.html reads it too. */
export const THEME_SETTING_KEY = 'vitreo.theme';

const ORDER: readonly ThemeSetting[] = ['auto', 'day', 'night'];

/** The next setting when the button is pressed: auto → day → night → auto. */
export function nextSetting(setting: ThemeSetting): ThemeSetting {
  return ORDER[(ORDER.indexOf(setting) + 1) % ORDER.length] ?? 'auto';
}

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'auto' || value === 'day' || value === 'night';
}

/**
 * Where the choice is kept. In the demo, only for this visit: every visitor
 * arrives by day, whatever they chose last time (the index.html boot script
 * reads the same storage).
 */
function storage(): Storage {
  return IN_DEMO ? sessionStorage : localStorage;
}

/** The remembered setting, if storage works (it may not: private windows). */
function stored(): ThemeSetting | null {
  try {
    const value = storage().getItem(THEME_SETTING_KEY);
    return isThemeSetting(value) ? value : null;
  } catch {
    return null;
  }
}

function remember(setting: ThemeSetting) {
  try {
    storage().setItem(THEME_SETTING_KEY, setting);
  } catch {
    // Not remembered; it still applies for this visit.
  }
}

interface ThemeSettingState {
  setting: ThemeSetting;
  set: (setting: ThemeSetting) => void;
}

/**
 * ?theme= wins (captures), then what the person chose last, then day
 * (D116): the greenhouse at its best until someone asks for night or for
 * the real sun (Ajustes › Apariencia › Auto).
 */
export const DEFAULT_THEME_SETTING: ThemeSetting = 'day';

export const useThemeSetting = create<ThemeSettingState>()((set) => ({
  setting: viewOptions.theme ?? stored() ?? DEFAULT_THEME_SETTING,
  set: (setting) => {
    remember(setting);
    set({ setting });
  },
}));
