import type { WeatherNow } from '@vitreo/shared';
import { Vector3 } from 'three';

import type { EffectiveQuality } from '../app/settings.ts';

/**
 * Atmosphere (A9, D96): how the twin's data turns into small, quiet
 * effects. Pure functions, tested without a browser. Everything here is
 * subtle on purpose: the cozy diorama, not a game (docs/02).
 */

/** Towards the sun of the bake: the lights, and the glint on wet glass (D118). */
export const SUN_DIRECTION = new Vector3(-0.25, 0.85, 1).normalize();

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** Condensation on the glass (0–1) from relative humidity (%). Unknown: none. */
export const CONDENSATION_RH = { from: 82, full: 96 } as const;
export function condensationFor(rh: number | null): number {
  return rh === null ? 0 : smoothstep(CONDENSATION_RH.from, CONDENSATION_RH.full, rh);
}

/**
 * Wind on the leaves inside, from the data: the fan blows on them and the
 * open window lets a draught in. `strength` multiplies how far a tip moves,
 * `speed` how fast it sways. The wind outside (AEMET, A10) only reaches in
 * through the open window: more open, more of it.
 */
export function windFor(input: { fan: boolean; vent: number; live: boolean; outside?: number }): {
  strength: number;
  speed: number;
} {
  const fan = input.live && input.fan ? 1 : 0;
  const vent = input.live ? clamp(input.vent) : 0;
  const draught = clamp(input.outside ?? 0) * vent;
  return {
    strength: 1 + 1.6 * fan + 0.5 * vent + 1.2 * draught,
    speed: 1 + 0.7 * fan + 0.5 * draught,
  };
}

/**
 * The plants outside (decor) sway with the wind outside (A10): calm air,
 * the gentle sway they always had; a strong wind, about twice as far and
 * a little faster. No weather known: calm.
 */
export function decorSwayFor(outside: number): { strength: number; speed: number } {
  const wind = clamp(outside);
  return { strength: 1 + 1.2 * wind, speed: 1 + 0.6 * wind };
}

/**
 * The weather the scene shows (A10), 0–1 each; all 0 with no weather known
 * (the hub silent, no key, old data, or rewinding): a neutral scene,
 * never a guess.
 */
export interface SceneWeather {
  clouds: number;
  rain: number;
  snow: number;
  fog: number;
  wind: number;
}

export const CALM: SceneWeather = { clouds: 0, rain: 0, snow: 0, fog: 0, wind: 0 };

export function weatherLook(now: WeatherNow | null): SceneWeather {
  if (!now) return CALM;
  return {
    clouds: clamp(now.clouds),
    rain: clamp(now.rain),
    snow: clamp(now.snow),
    fog: clamp(now.fog),
    wind: clamp(now.wind),
  };
}

export { WET, wetnessFor } from '../data/wetness.ts';

/**
 * How the clouds change the light (A10): softer and a little dimmer, the
 * sun's shadow on the page fading. Never dark: a grey day in a diorama.
 */
export function overcastLight(clouds: number): { sun: number; shadow: number; flatten: number } {
  const c = clamp(clouds);
  return { sun: 1 - 0.6 * c, shadow: 1 - 0.8 * c, flatten: 0.55 * c };
}

/**
 * Dust motes in the sunlight (0–1): by day, more with more light. No
 * reading of the light, no motes (they would claim sunshine we do not know).
 */
export const DUST_LUX = { from: 1500, full: 20_000 } as const;
export function dustFor(input: { night: number; lux: number | null }): number {
  if (input.lux === null) return 0;
  return (1 - clamp(input.night)) * smoothstep(DUST_LUX.from, DUST_LUX.full, input.lux);
}

/** A few soft fireflies once it is really night (0–1). */
export function firefliesFor(night: number): number {
  return smoothstep(0.6, 1, night);
}

/**
 * How many particles each quality draws. Alta: all; Auto: fewer (it may be
 * a slow device); Baja or Auto lowered: none; Sin 3D: no scene at all.
 * Reduced motion: none either (still motes would read as dirt).
 */
export const PARTICLES = {
  high: { dust: 70, fireflies: 12, rain: 420, splashes: 170, drips: 26, snow: 170 },
  auto: { dust: 35, fireflies: 7, rain: 200, splashes: 80, drips: 12, snow: 80 },
  none: { dust: 0, fireflies: 0, rain: 0, splashes: 0, drips: 0, snow: 0 },
} as const;

export type ParticleCounts = Record<keyof typeof PARTICLES.high, number>;

export function particleCounts(input: {
  quality: EffectiveQuality;
  auto: boolean;
  reducedMotion: boolean;
}): ParticleCounts {
  if (input.reducedMotion || input.quality !== 'high') return PARTICLES.none;
  return input.auto ? PARTICLES.auto : PARTICLES.high;
}

/**
 * The wind the plants share this frame: advanced once per frame by the
 * atmosphere, read by every plant's material (no React render).
 */
export const sceneWind = { time: 0, strength: 1 };

/**
 * The weather this frame (A10), eased by the atmosphere (it changes over
 * tens of seconds, like the real sky), read by the lights, the glass, the
 * lightmaps and the decor. `time` drives the drops on the glass; `wet` is how
 * wet the ground is (`wetnessFor`); `snowCover` how much snow lies on the
 * roof and the ground, which gathers and melts slowly behind what falls.
 */
export const sceneWeather: SceneWeather & { time: number; wet: number; snowCover: number } = {
  ...CALM,
  time: 0,
  wet: 0,
  snowCover: 0,
};
