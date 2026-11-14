import { z } from 'zod';

import { schemaVersion, unixSeconds } from './common.ts';

/**
 * Outdoor weather (A10, D97): AEMET's latest observation at the station
 * nearest the greenhouse and this hour of the municipality's hourly
 * forecast, as the hub last fetched them. Retained on
 * `vitreo/<deviceId>/weather`, published by the hub only. In the public
 * demo (D111) the same message comes from a simulated sky, and says so:
 * `source: 'simulated'`, never attributed to AEMET.
 *
 * Never invented: a value AEMET did not give is `null`; when AEMET is down
 * the hub publishes again what it had, with its own times, so the age is
 * always visible. SI units: °C, %, m/s, mm, km.
 */

const reading = z.number().nullable();

/** AEMET's sky code: `11`…`83`, with `n` at night (e.g. `12n`). */
export const skyCode = z.string().regex(/^\d{2}n?$/, 'expected an AEMET sky code');

export const weatherObservation = z.object({
  /** AEMET's station id (idema) and name. */
  station: z.object({ id: z.string().min(1).max(16), name: z.string().max(80) }),
  /** When it was observed (Unix s, UTC). */
  at: unixSeconds,
  temp: reading,
  rh: reading,
  /** Mean wind over the last 10 minutes, m/s. */
  windSpeed: reading,
  /** Strongest gust in the last hour, m/s. */
  windGust: reading,
  /** Where the wind comes from, degrees. */
  windDir: reading,
  /** Rain gauge, mm in the last hour. */
  precip: reading,
  /** Visibility, km (not every station measures it). */
  visibility: reading,
});

export const weatherForecastHour = z.object({
  /** The municipality (INE code, e.g. 28079) and its name. */
  municipality: z.object({ id: z.string().min(1).max(8), name: z.string().max(80) }),
  /** When AEMET made this forecast (Unix s). */
  issuedAt: unixSeconds,
  /** The hour it describes (its start, Unix s). */
  hour: unixSeconds,
  sky: skyCode.nullable(),
  /** AEMET's words for it: "Poco nuboso". */
  skyText: z.string().max(80).nullable(),
  temp: reading,
  /** mm in that hour. */
  precip: reading,
  snow: reading,
  /** m/s (AEMET gives km/h). */
  windSpeed: reading,
  windGust: reading,
});

/** `vitreo/<deviceId>/weather` — retained, published by the hub (A10). */
export const weatherMessage = z.object({
  v: schemaVersion,
  /** When the hub published this (Unix s): it does so every few minutes. */
  ts: unixSeconds,
  /** AEMET at home; the demo's simulated sky (D111). */
  source: z.enum(['aemet', 'simulated']),
  observation: weatherObservation.nullable(),
  forecast: weatherForecastHour.nullable(),
  /** Tonight's lowest forecast temperature and its hour, or null if unknown. */
  tonight: z.object({ min: z.number(), at: unixSeconds }).nullable(),
});

export type WeatherObservation = z.infer<typeof weatherObservation>;
export type WeatherForecastHour = z.infer<typeof weatherForecastHour>;
export type WeatherMessage = z.infer<typeof weatherMessage>;
export type WeatherSource = WeatherMessage['source'];

// ───────────────────────────────────────────── what it means (hub and app)

/** The hub publishes every 10–15 min: silent longer than this, it is down. */
export const WEATHER_SILENT_AFTER_S = 40 * 60;
/** An observation older than this says nothing about now. */
export const OBSERVATION_FRESH_S = 3 * 3600;
/** At or below this (°C) tonight, a frost warning (A10). */
export const FROST_WARNING_C = 2;
/**
 * Strong wind (m/s): the window closes (A10). 30 km/h mean or 50 km/h
 * gusts, about where AEMET's "fuerte" begins and a roof window rattles.
 */
export const STRONG_WIND = { mean: 30 / 3.6, gust: 50 / 3.6 } as const;
/** Rain worth closing the window for: any measurable amount (mm in an hour). */
export const RAIN_MM = 0.1;

export type SkyKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';

/**
 * AEMET's sky codes, read (their table "estado del cielo"): the tens say
 * what falls, the units how cloudy. 11–17 clouds only; 2x rain, 4x light
 * rain, 3x snow, 7x light snow, 5x storm, 6x storm with light rain; 81 fog,
 * 82 mist, 83 haze.
 */
export function readSky(code: string | null): {
  kind: SkyKind;
  /** 0 clear … 1 overcast. */
  clouds: number;
  /** 0 none … 1 heavy. */
  falling: number;
  /** 0 clear … 1 thick fog. */
  fog: number;
} | null {
  if (code === null) return null;
  const n = Number.parseInt(code, 10);
  if (!Number.isFinite(n)) return null;
  const tens = Math.floor(n / 10);
  const units = n % 10;
  if (n === 81) return { kind: 'fog', clouds: 0.6, falling: 0, fog: 1 };
  if (n === 82) return { kind: 'fog', clouds: 0.4, falling: 0, fog: 0.55 };
  if (n === 83) return { kind: 'fog', clouds: 0.2, falling: 0, fog: 0.35 };
  if (tens === 1) {
    const clouds = { 1: 0, 2: 0.2, 3: 0.4, 4: 0.6, 5: 0.8, 6: 1, 7: 0.3 }[units];
    return clouds === undefined
      ? null
      : { kind: clouds >= 0.6 ? 'cloudy' : 'clear', clouds, falling: 0, fog: 0 };
  }
  // 2x/3x/4x go 3–6 in cloudiness; 5x/6x/7x go 1–4.
  const cover = tens <= 4 ? (units - 2) / 4 : units / 4;
  const clouds = Math.min(1, Math.max(0.4, cover));
  switch (tens) {
    case 2:
      return { kind: 'rain', clouds, falling: 0.65, fog: 0 };
    case 4:
      return { kind: 'rain', clouds, falling: 0.35, fog: 0 };
    case 3:
      return { kind: 'snow', clouds, falling: 0.6, fog: 0 };
    case 7:
      return { kind: 'snow', clouds, falling: 0.3, fog: 0 };
    case 5:
      return { kind: 'storm', clouds: Math.max(clouds, 0.8), falling: 0.8, fog: 0 };
    case 6:
      return { kind: 'storm', clouds: Math.max(clouds, 0.8), falling: 0.45, fog: 0 };
    default:
      return null;
  }
}

/** Above this (°C, measured) nothing falls as snow, whatever was forecast. */
const SNOW_BELOW_C = 3;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The weather now, as the scene, the sound and the hub's rules read it
 * (A10). Null when there is nothing current to say: the hub silent, no
 * fresh observation and no forecast for this hour.
 *
 * - Rain: the rain gauge if it measured any in the last hour, else this
 *   hour's forecast. Snow only from the forecast, and never above 3 °C
 *   measured (then it is rain).
 * - Wind: measured; the forecast only without an observation.
 * - Clouds and fog: the forecast's sky (stations do not see clouds); a
 *   station that sees under 1 km adds fog.
 */
export interface WeatherNow {
  /** Outdoor temperature (°C), measured; null if unknown. */
  temp: number | null;
  /** When the station measured it (Unix s; AEMET runs 1–2 h behind), or null. */
  observedAt: number | null;
  clouds: number;
  rain: number;
  snow: number;
  fog: number;
  /** 0 calm … 1 strong (12 m/s). */
  wind: number;
  /** Measurable rain (or snow) now, for the window rule. */
  wet: boolean;
  /** Strong wind now, for the window rule. */
  windy: boolean;
  /** Where the rain comes from, for honest words. */
  rainFrom: 'gauge' | 'forecast' | null;
  /** Gust (or mean) in m/s behind `windy`, for the reason shown. */
  windValue: number | null;
  /** Whether that strong wind was measured or is forecast for this hour. */
  windFrom: 'station' | 'forecast' | null;
  precipValue: number | null;
}

export function weatherNow(message: WeatherMessage | null, nowS: number): WeatherNow | null {
  if (!message || nowS - message.ts > WEATHER_SILENT_AFTER_S) return null;
  const observation =
    message.observation && nowS - message.observation.at <= OBSERVATION_FRESH_S
      ? message.observation
      : null;
  const forecast =
    message.forecast &&
    nowS >= message.forecast.hour - 1800 &&
    nowS < message.forecast.hour + 2 * 3600
      ? message.forecast
      : null;
  if (!observation && !forecast) return null;

  const sky = readSky(forecast?.sky ?? null);
  const measuredTemp = observation?.temp ?? null;
  const gauge = observation?.precip ?? null;
  let rain = 0;
  let snow = 0;
  let rainFrom: WeatherNow['rainFrom'] = null;
  let precipValue: number | null = null;
  if (gauge !== null && gauge >= RAIN_MM) {
    rain = clamp(0.3 + 0.7 * Math.min(1, gauge / 4));
    rainFrom = 'gauge';
    precipValue = gauge;
  } else if (sky && sky.falling > 0) {
    const amount = sky.kind === 'snow' ? (forecast?.snow ?? null) : (forecast?.precip ?? null);
    // A forecast of rain with 0 mm ("Ip", inappreciable) is the lightest.
    const strength = amount === null ? sky.falling : clamp(Math.max(0.25, amount / 4));
    if (sky.kind === 'snow' && (measuredTemp === null || measuredTemp <= SNOW_BELOW_C)) {
      snow = strength;
    } else {
      rain = strength;
    }
    rainFrom = 'forecast';
    precipValue = amount;
  }
  // Snow in the gauge: colder than the limit and the forecast says snow.
  if (
    rainFrom === 'gauge' &&
    sky?.kind === 'snow' &&
    measuredTemp !== null &&
    measuredTemp <= SNOW_BELOW_C
  ) {
    snow = rain;
    rain = 0;
  }

  const mean = observation ? observation.windSpeed : (forecast?.windSpeed ?? null);
  // Strong wind, measured or forecast for this hour: the station's hour is
  // 1–2 h old, so the forecast can tell first (a false alarm only means the
  // fan instead of the window).
  const strong = (speed: number | null, gust: number | null): number | null =>
    gust !== null && gust >= STRONG_WIND.gust
      ? gust
      : speed !== null && speed >= STRONG_WIND.mean
        ? speed
        : null;
  const measuredWind = observation ? strong(observation.windSpeed, observation.windGust) : null;
  const forecastWind = forecast ? strong(forecast.windSpeed, forecast.windGust) : null;
  const windValue = measuredWind ?? forecastWind;
  const visibility = observation?.visibility ?? null;
  const fog = Math.max(
    sky?.fog ?? 0,
    visibility === null ? 0 : clamp((2 - visibility) / 1.5) * 0.9,
  );

  return {
    temp: measuredTemp,
    observedAt: observation?.at ?? null,
    clouds: Math.max(sky?.clouds ?? 0, rain > 0 || snow > 0 ? 0.6 : 0, fog * 0.6),
    rain,
    snow,
    fog,
    wind: mean === null ? 0 : clamp((mean - 2) / 10),
    wet: rain > 0 || snow > 0,
    windy: windValue !== null,
    rainFrom,
    windValue,
    windFrom: measuredWind !== null ? 'station' : forecastWind !== null ? 'forecast' : null,
    precipValue,
  };
}
