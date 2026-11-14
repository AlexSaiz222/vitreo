/**
 * The ambient mix (A9, D96): how loud each loop plays for what the twin
 * shows. Pure, so it is tested without audio. Levels are gains on loops of
 * equal loudness (pnpm audio evens them out).
 *
 * - birds by day and crickets at night, crossing through twilight;
 * - wind outside, louder with the roof window open or a windy day (AEMET, A10);
 * - rain when AEMET says it rains (A10), never otherwise: three recordings
 *   that cross by how hard it rains, and the rain on the glass, close (D123);
 * - a soft hum while the fan runs, a trickle while a pot is watered;
 * - the outside reaches in through the glass: softer and less bright with
 *   the window shut, as thin glass does (D114), open with it open;
 * - over the bed (D123): a blackbird now and then by day, and the gutter
 *   dripping while the ground the gauge wet is still wet and it has stopped.
 *
 * Honesty: what comes from data (fan, water, the window, the rain, the
 * dripping) is only heard while the data is live; birds and crickets follow
 * the clock, not data.
 */
export type Layer =
  | 'birds'
  | 'crickets'
  | 'wind'
  | 'fan'
  | 'water'
  | 'rainLight'
  | 'rain'
  | 'rainHeavy'
  | 'rainGlass';
export const LAYERS: readonly Layer[] = [
  'birds',
  'crickets',
  'wind',
  'fan',
  'water',
  'rainLight',
  'rain',
  'rainHeavy',
  'rainGlass',
];
/** Only downloaded the first time it rains (D123): most days it does not. */
export const ON_DEMAND: ReadonlySet<Layer> = new Set(['rainLight', 'rain', 'rainHeavy', 'rainGlass']);

export interface MixInput {
  /** 0 day … 1 night (the same blend the scene's light uses). */
  night: number;
  /** Roof window opening, 0–1. */
  vent: number;
  fan: boolean;
  /** A pot is being watered now. */
  watering: boolean;
  /** Fresh data (live, or a rewound instant that has readings). */
  live: boolean;
  /** Outside weather (A10, AEMET), 0–1 each; null when none is known. */
  weather: { wind: number; rain: number } | null;
  /** How wet the ground is by the gauge (D120), 0–1; 0 when not known. */
  wetness?: number;
}

export interface Mix {
  gains: Record<Layer, number>;
  /** How much of the glass stands between the outside and you: 1 shut, 0 open. */
  glass: number;
  /** What sounds on its own over the bed (D123): 0 is never, 1 is as much as it gets. */
  accents: { bird: number; drips: number };
}

export const LEVELS = {
  /** 0.42 in A9; lower since the glass stopped muffling them (D114). */
  birds: 0.32,
  crickets: 0.36,
  /** Wind: always a little; more with the window open. */
  windBase: 0.1,
  windOpen: 0.2,
  fan: 0.22,
  water: 0.45,
  /** Rain at its heaviest; a drizzle is quieter. */
  rain: 0.4,
  /** The rain on the glass, as a share of the rain outside. */
  rainGlass: 0.5,
  /** A blackbird's phrase, at its nearest. */
  accentBird: 0.26,
} as const;

/** How hard it rains (0–1) where one recording gives way to the next. */
export const RAIN_CROSS = { lightToSteady: [0.2, 0.5], steadyToHeavy: [0.55, 0.9] } as const;
/** Birds stop singing their own phrases when it rains harder than this. */
const BIRD_RAIN_LIMIT = 0.3;
/** Wetter than this (by the gauge), it still drips. */
const DRIP_FROM = 0.06;
/** At this wetness the gutter drips as fast as it can. */
const DRIP_FULL = 0.6;

/**
 * What closed glass does to the outside (D114): a little quieter and less
 * bright, never muffled. (A9's low-pass at 1.4 kHz took away everything
 * the rain and the birds are made of.) The engine eases these with
 * `glass`: all of it shut, none of it open.
 */
export const GLASS = {
  /** High shelf from 2.5 kHz, in dB. */
  shelfHz: 2500,
  shelfDb: -9,
  /** A gentle low-pass, in Hz (shut) up to 20 kHz (open). */
  lowpassHz: 7000,
  /** Overall, in dB. */
  levelDb: -2,
} as const;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** How far `value` has crossed from `from` to `to`, as an equal-power fade: 0…π/2. */
const crossing = (value: number, [from, to]: readonly [number, number]) =>
  (clamp((value - from) / (to - from)) * Math.PI) / 2;

/** How much of each recording at this rain: equal power, so the crossing keeps the level. */
export function rainWeights(rain: number): { light: number; steady: number; heavy: number } {
  const first = crossing(rain, RAIN_CROSS.lightToSteady);
  const second = crossing(rain, RAIN_CROSS.steadyToHeavy);
  return {
    light: Math.cos(first),
    steady: Math.sin(first) * Math.cos(second),
    heavy: Math.sin(first) * Math.sin(second),
  };
}

export function mixFor(input: MixInput): Mix {
  const night = clamp(input.night);
  const vent = input.live ? clamp(input.vent) : 0;
  // A smooth cross through twilight: both quiet at the midpoint, no gap.
  const day = Math.cos((night * Math.PI) / 2);
  const dark = Math.sin((night * Math.PI) / 2);
  const outsideWind = input.weather ? clamp(input.weather.wind) : 0;
  const rain = input.weather ? clamp(input.weather.rain) : 0;
  // Even a drizzle is heard; heavier rain, louder.
  const rainLevel = rain > 0 ? LEVELS.rain * (0.45 + 0.55 * rain) : 0;
  const weights = rainWeights(rain);
  const wetness = input.live && input.weather ? clamp(input.wetness ?? 0) : 0;
  return {
    gains: {
      birds: LEVELS.birds * day,
      crickets: LEVELS.crickets * dark,
      wind: LEVELS.windBase + LEVELS.windOpen * Math.max(vent, outsideWind),
      fan: input.live && input.fan ? LEVELS.fan : 0,
      water: input.live && input.watering ? LEVELS.water : 0,
      rainLight: rainLevel * weights.light,
      rain: rainLevel * weights.steady,
      rainHeavy: rainLevel * weights.heavy,
      rainGlass: rainLevel * LEVELS.rainGlass,
    },
    // Half open lets half the outside in: the window is a big part of the roof.
    glass: 1 - vent,
    accents: {
      bird: rain > BIRD_RAIN_LIMIT ? 0 : day * day,
      drips: rain === 0 && wetness > DRIP_FROM ? clamp(wetness / DRIP_FULL) : 0,
    },
  };
}

/** How quickly each layer follows (seconds, the time constant of the fade). */
export const FADE_SECONDS: Record<Layer, number> = {
  birds: 4,
  crickets: 4,
  wind: 3,
  fan: 1.2,
  water: 0.5,
  rainLight: 5,
  rain: 5,
  rainHeavy: 5,
  rainGlass: 5,
};
