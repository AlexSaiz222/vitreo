/**
 * The weather outside the greenhouse, for runs that need more than the
 * daily cosine of `params.air` (the accelerated week, D104; the public
 * demo, D111): a temperature and a cloud cover at every instant, and what
 * the sky does besides (rain, fog, wind), which the greenhouse itself does
 * not feel but the demo's sky and the hub's weather rules read.
 */
export interface OutsideCurve {
  /** °C outside. */
  tempC(ms: number): number;
  /** 0 = clear sky, 1 = overcast. */
  cloud(ms: number): number;
  /** Rain, fog and wind; absent, a dry, still day. */
  weather?(ms: number): OutsideWeather;
}

/** What the sky does at an instant, beyond temperature and cloud. */
export interface OutsideWeather {
  /** Rain falling now, mm per hour (0: dry). */
  rainMmH: number;
  /** How far one sees, km, in fog or mist; null in clear air. */
  visibilityKm: number | null;
  /** Mean wind and gusts (m/s), and where it comes from (degrees). */
  wind: { mean: number; gust: number; dir: number };
}

/** A rain spell, in hours since the day began (local midnight), and how hard. */
export interface RainSpell {
  from: number;
  to: number;
  mmH: number;
}

/** One day outside: its lowest and highest temperature, how cloudy, and its sky. */
export interface OutsideDay {
  min: number;
  max: number;
  cloud: number;
  /** Rain spells. Only on cloudy days: the greenhouse's light reads `cloud` alone. */
  rain?: readonly RainSpell[];
  /** Early fog: thick from `from`, lifting by `to` (hours), `km` at its thickest. */
  fog?: { from: number; to: number; km: number };
  /** The day's wind, m/s, at its strongest (mid-afternoon); calmer at night. */
  wind?: { mean: number; gust: number; dir: number };
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The coldest moment, about sunrise in late October (hours since the day began). */
const MIN_AT_H = 6;
/** The warmest, mid-afternoon. */
const MAX_AT_H = 14;
/** Past this visibility (km), fog has lifted. */
const CLEAR_KM = 5;
const STILL = { mean: 0, gust: 0, dir: 0 } as const;

/** Half a cosine from `from` to `to` as `t` goes 0 → 1: smooth at both ends. */
const ease = (from: number, to: number, t: number) =>
  from + ((to - from) * (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))))) / 2;

/** Calmer at night, strongest mid-afternoon: 0.5 at night, 1 at 15:00. */
function windShare(hour: number): number {
  return hour < 8 || hour > 22 ? 0.5 : 0.5 + 0.5 * Math.sin((Math.PI * (hour - 8)) / 14);
}

/** How far one sees in a morning fog: thick for most of it, then lifting. */
function fogKm(fog: NonNullable<OutsideDay['fog']>, hour: number): number | null {
  if (hour < fog.from || hour >= fog.to) return null;
  const t = (hour - fog.from) / (fog.to - fog.from);
  const km = t < 0.6 ? fog.km : ease(fog.km, CLEAR_KM, (t - 0.6) / 0.4);
  return km >= CLEAR_KM ? null : km;
}

/**
 * Days one after another from `startMs` (a local midnight): each day's
 * minimum at dawn, its maximum mid-afternoon, and a smooth curve between
 * them and on to the next day's minimum; its rain, fog and wind. Before the
 * first day and after the last, those days continue.
 */
export function dailyCurve(startMs: number, days: readonly OutsideDay[]): OutsideCurve {
  const first = days[0];
  if (!first) throw new Error('dailyCurve needs at least one day');
  const day = (index: number): OutsideDay =>
    days[Math.min(days.length - 1, Math.max(0, index))] ?? first;
  const at = (ms: number) => {
    const index = Math.floor((ms - startMs) / DAY_MS);
    return { index, hour: (ms - startMs - index * DAY_MS) / HOUR_MS, today: day(index) };
  };
  return {
    tempC(ms) {
      const { index, hour, today } = at(ms);
      if (hour < MIN_AT_H) {
        // From yesterday's maximum down to this morning's minimum.
        const since = hour + 24 - MAX_AT_H;
        return ease(day(index - 1).max, today.min, since / (24 - MAX_AT_H + MIN_AT_H));
      }
      if (hour < MAX_AT_H)
        return ease(today.min, today.max, (hour - MIN_AT_H) / (MAX_AT_H - MIN_AT_H));
      return ease(today.max, day(index + 1).min, (hour - MAX_AT_H) / (24 - MAX_AT_H + MIN_AT_H));
    },
    cloud(ms) {
      return at(ms).today.cloud;
    },
    weather(ms) {
      const { hour, today } = at(ms);
      const spell = today.rain?.find((rain) => hour >= rain.from && hour < rain.to);
      const wind = today.wind ?? STILL;
      const share = windShare(hour);
      // A shower brings gusts with it.
      const gusty = spell ? 1.3 : 1;
      return {
        rainMmH: spell?.mmH ?? 0,
        visibilityKm: today.fog ? fogKm(today.fog, hour) : null,
        wind: { mean: wind.mean * share, gust: wind.gust * share * gusty, dir: wind.dir },
      };
    },
  };
}

/**
 * Seven plausible days of late October in Madrid, **not observations**:
 * near the Retiro normals for the end of the month (highs about 18 °C, lows
 * about 9 °C). A front crosses on day 4: clouds building the day before, a
 * wet, breezy morning and a shower in the afternoon, a last shower the next
 * morning; then a clear, cold dawn with thick fog, and mist on the last
 * morning. Used by the accelerated week (D104) and the demo (D111), which
 * say so.
 */
export const MADRID_LATE_OCTOBER: readonly OutsideDay[] = [
  { min: 10, max: 18, cloud: 0.2, wind: { mean: 3, gust: 6, dir: 60 } },
  { min: 11, max: 19, cloud: 0.1, wind: { mean: 2.5, gust: 5, dir: 90 } },
  { min: 11, max: 17, cloud: 0.5, wind: { mean: 5, gust: 9, dir: 220 } },
  {
    min: 10,
    max: 14,
    cloud: 0.9,
    rain: [
      { from: 9, to: 12.5, mmH: 2.5 },
      { from: 16, to: 17.5, mmH: 1.2 },
    ],
    wind: { mean: 7, gust: 10, dir: 240 },
  },
  {
    min: 7,
    max: 13,
    cloud: 0.6,
    rain: [{ from: 7, to: 8, mmH: 0.6 }],
    wind: { mean: 5, gust: 10, dir: 300 },
  },
  {
    min: 6,
    max: 16,
    cloud: 0.1,
    fog: { from: 5, to: 10.5, km: 0.3 },
    wind: { mean: 2, gust: 4, dir: 0 },
  },
  {
    min: 9,
    max: 18,
    cloud: 0.2,
    fog: { from: 6, to: 9.5, km: 1.2 },
    wind: { mean: 3, gust: 6, dir: 30 },
  },
];
