import type { WeatherObservation } from '@vitreo/shared';
import type { Forecast, ForecastPoint } from '@vitreo/hub/portable';
import { dailyCurve, MADRID_LATE_OCTOBER } from '@vitreo/sim-core';
import type { OutsideCurve, OutsideDay, OutsideWeather } from '@vitreo/sim-core';

/**
 * The demo's sky (D111): simulated, never observed, and said so. The week of
 * the accelerated run (MADRID_LATE_OCTOBER: a front with rain, a foggy dawn,
 * wind), placed so that the visitor arrives on its last day, as the recorded
 * week will end (docs/09, step 7), and going round again after it. On top,
 * showers: one already falling when the visitor arrives, so the rain, the
 * drops on the glass and the window closing show in the first minute; and
 * the ones "Probar situaciones › Lluvia" asks for.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** The arrival's shower: begun 10 minutes before, over 40 minutes after. */
const ARRIVAL_SHOWER = { before: 10 * MINUTE_MS, after: 40 * MINUTE_MS, mmH: 2.5 } as const;
/** "Lluvia": half an hour of steady rain from now. */
export const RAIN_SCENARIO = { minutes: 30, mmH: 3 } as const;
/** Clouds gather before a shower and part after it. */
const CLOUD_RAMP_MS = 20 * MINUTE_MS;
const SHOWER_CLOUD = 0.9;
/** Enough weeks for a long visit at a day a minute; after them, the last day stays. */
const WEEKS = 52;

interface Shower {
  from: number;
  to: number;
  mmH: number;
}

/** Local midnight (in `timeZone`) of the day `ms` falls on. */
export function localMidnight(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(ms);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const since = (part('hour') * 3600 + part('minute') * 60 + part('second')) * 1000 + (ms % 1000);
  return ms - since;
}

/** The local midnight six days before the day of `ms`: where its week began. */
export function weekStart(ms: number, timeZone: string): number {
  // From noon, so a change of summer time in between still lands on the day.
  return localMidnight(localMidnight(ms, timeZone) - 6 * DAY_MS + 12 * HOUR_MS, timeZone);
}

export class DemoOutside implements OutsideCurve {
  private readonly days: OutsideCurve;
  private readonly showers: Shower[] = [];

  /**
   * The week ends on the arrival day: it began six days before, as the
   * recorded week (D112), and goes round again after it.
   * `shower: false`: no shower on arrival (`?cielo=seco`, for the tests of
   * "Lluvia"; and the recording, which nobody arrives at).
   */
  constructor(arrivalMs: number, timeZone: string, { shower = true } = {}) {
    const week = MADRID_LATE_OCTOBER;
    const days: OutsideDay[] = [];
    for (let i = 0; i < WEEKS * week.length; i++) {
      const day = week[i % week.length];
      if (day) days.push(day);
    }
    this.days = dailyCurve(weekStart(arrivalMs, timeZone), days);
    if (!shower) return;
    this.showers.push({
      from: arrivalMs - ARRIVAL_SHOWER.before,
      to: arrivalMs + ARRIVAL_SHOWER.after,
      mmH: ARRIVAL_SHOWER.mmH,
    });
  }

  /** "Probar situaciones › Lluvia": rain from now on, for a while. */
  rain(nowMs: number, minutes: number = RAIN_SCENARIO.minutes, mmH: number = RAIN_SCENARIO.mmH) {
    this.showers.push({ from: nowMs, to: nowMs + minutes * MINUTE_MS, mmH });
  }

  /** How near a shower is, 0 (none within the ramp) … 1 (raining). */
  private showery(ms: number): number {
    let near = 0;
    for (const shower of this.showers) {
      const away = ms < shower.from ? shower.from - ms : ms >= shower.to ? ms - shower.to : 0;
      near = Math.max(near, 1 - Math.min(1, away / CLOUD_RAMP_MS));
    }
    return near;
  }

  tempC(ms: number): number {
    // Rain cools the air a little.
    return this.days.tempC(ms) - 1.5 * this.showery(ms);
  }

  cloud(ms: number): number {
    const day = this.days.cloud(ms);
    return day + (Math.max(day, SHOWER_CLOUD) - day) * this.showery(ms);
  }

  weather(ms: number): OutsideWeather {
    const day = this.days.weather?.(ms) ?? {
      rainMmH: 0,
      visibilityKm: null,
      wind: { mean: 0, gust: 0, dir: 0 },
    };
    const shower = this.showers.find((s) => ms >= s.from && ms < s.to);
    if (!shower || shower.mmH <= day.rainMmH) return day;
    // A shower brings a breeze and gusts with it.
    return {
      ...day,
      rainMmH: shower.mmH,
      wind: {
        mean: Math.max(day.wind.mean, 4),
        gust: Math.max(day.wind.gust, 9),
        dir: day.wind.mean > 0 ? day.wind.dir : 240,
      },
    };
  }
}

// ───────────────────────────────────── what a weather station would say

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Clear air: as far as a station reports (km). */
const CLEAR_VISIBILITY_KM = 20;

/**
 * Relative humidity from the sky: near saturation in rain or fog, drier
 * under a clear sky. The gap to the dew point (°C) sets it, about 5 % a
 * degree.
 */
function humidity(cloud: number, weather: OutsideWeather): number {
  const spread =
    weather.rainMmH > 0 ? 1 : weather.visibilityKm !== null ? 0.4 : 3 + 6 * (1 - cloud);
  return Math.round(clamp(100 - 5 * spread, 30, 100));
}

/** AEMET's sky code and words for an hour (their table "estado del cielo"). */
function skyOf(
  cloud: number,
  rainMm: number,
  visibilityKm: number | null,
): { sky: string; text: string } {
  if (visibilityKm !== null && visibilityKm < 1) return { sky: '81', text: 'Niebla' };
  if (rainMm >= 0.1) {
    // The units say how cloudy: 3–6 with rain.
    const units = clamp(Math.round(cloud * 4 + 2), 3, 6).toString();
    return rainMm >= 2
      ? { sky: `2${units}`, text: 'Nuboso con lluvia' }
      : { sky: `4${units}`, text: 'Nuboso con lluvia escasa' };
  }
  if (visibilityKm !== null && visibilityKm < 2) return { sky: '82', text: 'Bruma' };
  if (cloud < 0.1) return { sky: '11', text: 'Despejado' };
  if (cloud < 0.3) return { sky: '12', text: 'Poco nuboso' };
  if (cloud < 0.5) return { sky: '13', text: 'Intervalos nubosos' };
  if (cloud < 0.7) return { sky: '14', text: 'Nuboso' };
  if (cloud < 0.9) return { sky: '15', text: 'Muy nuboso' };
  return { sky: '16', text: 'Cubierto' };
}

/** One hour of the sky, sampled every 10 minutes. */
function hourOf(outside: DemoOutside, hourMs: number): ForecastPoint {
  const samples = Array.from({ length: 6 }, (_, i) => hourMs + i * 10 * MINUTE_MS);
  const weathers = samples.map((ms) => outside.weather(ms));
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const cloud = mean(samples.map((ms) => outside.cloud(ms)));
  const rainMm = mean(weathers.map((w) => w.rainMmH));
  const visibilities = weathers
    .map((w) => w.visibilityKm)
    .filter((km): km is number => km !== null);
  const visibility = visibilities.length > 0 ? Math.min(...visibilities) : null;
  const { sky, text } = skyOf(cloud, rainMm, visibility);
  return {
    hour: Math.floor(hourMs / 1000),
    sky,
    skyText: text,
    temp: Math.round(mean(samples.map((ms) => outside.tempC(ms)))),
    precip: round1(rainMm),
    snow: 0,
    windSpeed: round1(mean(weathers.map((w) => w.wind.mean))),
    windGust: round1(Math.max(...weathers.map((w) => w.wind.gust))),
  };
}

/** Forecast hours: from the one before now to a day and a half ahead (for tonight's minimum). */
const FORECAST_HOURS = { before: 1, after: 36 } as const;

/**
 * What a station and a forecast would say now about the demo's sky, in the
 * hub's own shapes, for `feedWeather`: measured this minute (a simulated
 * station has no delay), rain as the last hour's gauge, and the hourly
 * forecast around now. Named "Simulado", never AEMET.
 */
export function simulatedSky(
  outside: DemoOutside,
  nowMs: number,
): { observation: WeatherObservation; forecast: Forecast } {
  const hourMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const points: ForecastPoint[] = [];
  for (let i = -FORECAST_HOURS.before; i <= FORECAST_HOURS.after; i++) {
    points.push(hourOf(outside, hourMs + i * HOUR_MS));
  }
  return {
    observation: simulatedObservation(outside, nowMs),
    forecast: {
      municipality: { id: 'demo', name: 'Madrid (simulado)' },
      issuedAt: Math.floor(hourMs / 1000),
      points,
    },
  };
}

/** What the simulated station measures now (for the recorded week's history, alone). */
export function simulatedObservation(outside: DemoOutside, nowMs: number): WeatherObservation {
  const weather = outside.weather(nowMs);
  // The gauge: mm over the last hour, minute by minute.
  let gauge = 0;
  for (let ms = nowMs - HOUR_MS + MINUTE_MS; ms <= nowMs; ms += MINUTE_MS) {
    gauge += outside.weather(ms).rainMmH / 60;
  }
  return {
    station: { id: 'demo', name: 'Simulado' },
    at: Math.floor(nowMs / MINUTE_MS) * 60,
    temp: round1(outside.tempC(nowMs)),
    rh: humidity(outside.cloud(nowMs), weather),
    windSpeed: round1(weather.wind.mean),
    windGust: round1(weather.wind.gust),
    windDir: Math.round(weather.wind.dir),
    precip: round1(gauge),
    visibility: round1(weather.visibilityKm ?? CLEAR_VISIBILITY_KM),
  };
}
