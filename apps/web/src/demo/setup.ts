import type { ConfigMessage, ConfigUpdate } from '@vitreo/shared';

/**
 * The public demo's greenhouse (D66, D103): nothing of the real one but its
 * rules. Its own device id, and Madrid centre for the sun (the repository's
 * generic location, D79), never the home location.
 */
export const DEMO_DEVICE_ID = 'demo';
export const DEMO_LOCATION = { lat: 40.42, lng: -3.7 } as const;

const QUIET = { from: '22:00', to: '08:00' } as const;
const rule = (zone: string, threshold: number, seconds: number, maxPerDay: number) => ({
  zone,
  enabled: true,
  threshold,
  seconds,
  maxPerDay,
  cooldownMinutes: 60,
  quiet: QUIET,
});

/** Madrid's, like its place. */
export const DEMO_TIME_ZONE = 'Europe/Madrid';

/**
 * The rules, as in the week run (rev 3, 2026-10-14): every pot watered on
 * its own, ventilation and the grow light on, quiet nights from 22:00 to
 * 08:00. The demo's hub starts with them, as its first revision.
 */
export function demoRules(): ConfigUpdate {
  return {
    watering: [
      rule('basil_01', 0.4, 5, 2),
      rule('parsley_01', 0.4, 5, 2),
      rule('lettuce_01', 0.45, 6, 3),
      rule('strawberry_01', 0.35, 5, 2),
      rule('chives_01', 0.4, 4, 2),
      rule('tomato_01', 0.4, 8, 3),
    ],
    light: { enabled: true, mode: 'schedule', on: '07:00', off: '21:00', belowLux: 3000 },
    ventilation: { enabled: true, fanAbove: 28, windowAbove: 31, hysteresis: 2, maxRh: 85 },
  };
}

/**
 * What the hub publishes with those rules: for the device on its own, if
 * the demo's hub could not start (its WebAssembly did not load).
 */
export function demoConfig(nowMs: number): ConfigMessage {
  return {
    v: 2,
    rev: 1,
    ts: Math.floor(nowMs / 1000),
    tz: 'CET-1CEST,M3.5.0,M10.5.0/3',
    location: { ...DEMO_LOCATION },
    ...demoRules(),
  };
}
