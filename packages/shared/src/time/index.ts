/**
 * Local time and the sun, as the device computes them (A6, D89): the
 * firmware has a POSIX TZ string (what the ESP32's `setenv("TZ")` takes) and
 * NTP time, and works out sunrise and sunset itself, so the light schedule
 * follows the sun with the PC off. The simulator uses these same functions;
 * the firmware ports them (docs/05).
 */

interface TransitionRule {
  month: number;
  /** 1–5; 5 = the last such weekday of the month. */
  week: number;
  /** 0 = Sunday. */
  weekday: number;
  /** Seconds after local midnight (default 02:00). */
  time: number;
}

export interface PosixTz {
  /** Standard time, seconds east of UTC (POSIX writes the opposite sign). */
  std: number;
  /** Summer time, seconds east of UTC, or null if there is none. */
  dst: number | null;
  start: TransitionRule | null;
  end: TransitionRule | null;
}

const NAME = /^(?:<[^>]+>|[A-Za-z]{3,})/;
const OFFSET = /^([+-]?)(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?/;
const RULE = /^M(\d{1,2})\.(\d)\.(\d)(?:\/([+-]?\d{1,3})(?::(\d{2}))?(?::(\d{2}))?)?$/;

function seconds(sign: string, h: string, m = '0', s = '0'): number {
  const value = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return sign === '-' ? -value : value;
}

/** The opposite sign, never -0. */
const flip = (value: number) => (value === 0 ? 0 : -value);

function parseRule(text: string): TransitionRule | null {
  const match = RULE.exec(text);
  if (!match) return null;
  const [, month, week, weekday, h, m, s] = match;
  const sign = h?.startsWith('-') ? '-' : '+';
  return {
    month: Number(month),
    week: Number(week),
    weekday: Number(weekday),
    time: h === undefined ? 7200 : seconds(sign, h.replace(/^[+-]/, ''), m, s),
  };
}

/** Parses a POSIX TZ string ("CET-1CEST,M3.5.0,M10.5.0/3"); null if it cannot. */
export function parsePosixTz(text: string): PosixTz | null {
  let rest = text.trim();
  const std = NAME.exec(rest);
  if (!std) return null;
  rest = rest.slice(std[0].length);
  const stdOffset = OFFSET.exec(rest);
  if (!stdOffset) return null;
  rest = rest.slice(stdOffset[0].length);
  // POSIX: "CET-1" is one hour EAST of UTC.
  const east = flip(seconds(stdOffset[1] ?? '', stdOffset[2] ?? '0', stdOffset[3], stdOffset[4]));
  if (rest === '') return { std: east, dst: null, start: null, end: null };

  const dst = NAME.exec(rest);
  if (!dst) return null;
  rest = rest.slice(dst[0].length);
  let dstEast = east + 3600;
  const dstOffset = OFFSET.exec(rest);
  if (dstOffset && !rest.startsWith(',')) {
    dstEast = flip(seconds(dstOffset[1] ?? '', dstOffset[2] ?? '0', dstOffset[3], dstOffset[4]));
    rest = rest.slice(dstOffset[0].length);
  }
  const [, startText = '', endText = ''] = rest.split(',');
  const start = parseRule(startText);
  const end = parseRule(endText);
  if (!start || !end) return null;
  return { std: east, dst: dstEast, start, end };
}

/** Unix s of a transition in a year, given the offset in force before it. */
function transition(year: number, rule: TransitionRule, offsetBefore: number): number {
  const first = new Date(Date.UTC(year, rule.month - 1, 1));
  const shift = (rule.weekday - first.getUTCDay() + 7) % 7;
  let day = 1 + shift + (rule.week - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, rule.month, 0)).getUTCDate();
  while (day > daysInMonth) day -= 7;
  return Date.UTC(year, rule.month - 1, day) / 1000 + rule.time - offsetBefore;
}

/** Seconds east of UTC at an instant (Unix s). */
export function utcOffset(tz: PosixTz, at: number): number {
  if (tz.dst === null || !tz.start || !tz.end) return tz.std;
  const year = new Date((at + tz.std) * 1000).getUTCFullYear();
  const start = transition(year, tz.start, tz.std);
  const end = transition(year, tz.end, tz.dst);
  const summer = start < end ? at >= start && at < end : at >= start || at < end;
  return summer ? tz.dst : tz.std;
}

export interface LocalTime {
  /** Minutes since local midnight, 0–1439. */
  minutes: number;
  /** The local day, YYYY-MM-DD: daily counters reset when it changes. */
  day: string;
}

/** Local time of day at an instant (Unix s). */
export function localTime(tz: PosixTz, at: number): LocalTime {
  const local = new Date((at + utcOffset(tz, at)) * 1000);
  return {
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    day: local.toISOString().slice(0, 10),
  };
}

/** "HH:MM" → minutes since midnight. */
export const minutesOf = (time: string): number => {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
};

/** Minutes → "HH:MM" (wrapping around midnight). */
export const timeOf = (minutes: number): string => {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60)
    .toString()
    .padStart(2, '0');
  const m = (wrapped % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
};

/** Is a time of day inside [from, to)? The window may cross midnight. */
export function withinWindow(minutes: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

const RAD = Math.PI / 180;

/**
 * Sunrise and sunset (Unix s) on the day of `at` at a place, or null when
 * the sun does not rise or set that day. The sunrise equation (NOAA's
 * simplification, within a minute or two): enough for a light schedule and
 * light on a microcontroller.
 */
export function sunTimes(
  at: number,
  lat: number,
  lng: number,
): { sunrise: number; sunset: number } | null {
  const julian = at / 86_400 + 2_440_587.5;
  const n = Math.round(julian - 2_451_545 + 0.0008 + lng / 360);
  const mean = n - lng / 360;
  const anomaly = (357.5291 + 0.98560028 * mean) % 360;
  const m = anomaly * RAD;
  const center = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m);
  const ecliptic = ((anomaly + center + 180 + 102.9372) % 360) * RAD;
  const transit = 2_451_545 + mean + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * ecliptic);
  const declination = Math.asin(Math.sin(ecliptic) * Math.sin(23.4397 * RAD));
  const phi = lat * RAD;
  const cosHour =
    (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(declination)) /
    (Math.cos(phi) * Math.cos(declination));
  if (cosHour < -1 || cosHour > 1) return null;
  const hour = Math.acos(cosHour) / RAD / 360;
  const unix = (j: number) => Math.round((j - 2_440_587.5) * 86_400);
  return { sunrise: unix(transit - hour), sunset: unix(transit + hour) };
}
