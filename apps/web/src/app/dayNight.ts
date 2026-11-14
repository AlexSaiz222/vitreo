import { getPosition } from 'suncalc';

import { now as nowMs } from './clock.ts';
import { IN_DEMO } from './demo.ts';
import { useThemeSetting } from './themeChoice.ts';
import { useHub } from '../data/hub.ts';
import { useReplay } from '../data/replay.ts';

export type ThemeMode = 'day' | 'night';

export interface Location {
  lat: number;
  lng: number;
}

/** Sunrise and sunset are defined at this apparent solar altitude (degrees). */
const HORIZON = -0.833;
/** How often "auto" re-checks the sun; every second in the demo, whose day can last a minute (D112). */
const CHECK_EVERY_MS = IN_DEMO ? 1000 : 60_000;

/**
 * The light fades from day to night through twilight: fully day with the
 * sun this high (degrees), fully night once it is this far below (end of
 * civil twilight). The theme still switches at the horizon.
 */
const TWILIGHT = { day: 6, night: -6 } as const;

/**
 * How much of the night lighting to use (0 day, 1 night), from the real sun:
 * a smooth blend through twilight, for the baked lightmaps (docs/04, part 5).
 */
export function nightAmount(date: Date, location: Location): number {
  // suncalc 2 gives the altitude in degrees (as HORIZON).
  const altitude = getPosition(date, location.lat, location.lng).altitude;
  const t = Math.min(1, Math.max(0, (TWILIGHT.day - altitude) / (TWILIGHT.day - TWILIGHT.night)));
  return t * t * (3 - 2 * t);
}

/**
 * The night blend in effect (0 day, 1 night), as the scene's light uses it:
 * forced by Ajustes › Apariencia, or the real sun now (or at the rewound
 * instant). For what follows the time of day outside the scene (sound, A9).
 */
export function nightNow(location: Location, now = new Date(nowMs())): number {
  const { setting } = useThemeSetting.getState();
  if (setting !== 'auto') return setting === 'night' ? 1 : 0;
  const replay = useReplay.getState();
  return nightAmount(replay.mode === 'replay' ? new Date(replay.at * 1000) : now, location);
}

/** Day while the sun is above the horizon at `location`, night otherwise. */
export function themeAt(date: Date, location: Location): ThemeMode {
  return getPosition(date, location.lat, location.lng).altitude > HORIZON ? 'day' : 'night';
}

/** How long `data-theme-changing` stays (a little over --duration-theme). */
const THEME_FADE_MS = 2800;
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

/** Marks the root while the theme changes, so CSS fades every colour. */
function fadeTheme(root: HTMLElement) {
  root.dataset['themeChanging'] = '';
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    delete root.dataset['themeChanging'];
  }, THEME_FADE_MS);
}

/**
 * Keeps `<html data-theme>` in sync with the real sun (docs/02: day and night
 * follow the real sunrise and sunset), or with the setting chosen in the HUD
 * (`useThemeSetting`), which applies at once. Also updates the browser's
 * theme colour so the PWA chrome matches. Returns a function that stops it.
 */
export function startDayNightClock(
  location: () => Location,
  root: HTMLElement = document.documentElement,
): () => void {
  const apply = () => {
    const { setting } = useThemeSetting.getState();
    // Rewound (A5), the sun of that instant.
    const replay = useReplay.getState();
    const when = replay.mode === 'replay' ? new Date(replay.at * 1000) : new Date(nowMs());
    const theme = setting === 'auto' ? themeAt(when, location()) : setting;
    if (root.dataset['theme'] !== theme) {
      // A slow fade of the interface (A9), except the first time and while
      // scrubbing the past (that should follow the finger).
      if (root.dataset['theme'] && replay.mode !== 'replay') fadeTheme(root);
      root.dataset['theme'] = theme;
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    }
  };
  apply();
  const unsubscribe = useThemeSetting.subscribe(apply);
  // The location can change (Ajustes › Ubicación, or the hub answering).
  const unsubscribeHub = useHub.subscribe((state, previous) => {
    if (state.settings !== previous.settings) apply();
  });
  const unsubscribeReplay = useReplay.subscribe((state, previous) => {
    if (state.mode !== previous.mode || state.at !== previous.at) apply();
  });
  const timer = setInterval(apply, CHECK_EVERY_MS);
  return () => {
    unsubscribe();
    unsubscribeHub();
    unsubscribeReplay();
    clearInterval(timer);
  };
}
