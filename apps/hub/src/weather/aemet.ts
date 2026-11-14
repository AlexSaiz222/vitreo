import type { WeatherObservation } from '@vitreo/shared';

/**
 * AEMET OpenData (A10, D97): the latest observation of a station and the
 * hourly forecast of a municipality. Every dataset takes two requests: the
 * first (with the key, in a header so it never lands in a log) answers
 * where the data is; the second fetches it. AEMET answers in ISO-8859-15.
 *
 * Their terms (aemet.es/es/nota_legal): cite the source ("Fuente: AEMET"),
 * show when it was last updated, never suggest AEMET endorses the app.
 */

export type AemetFailure =
  /** The key was refused: a typo, or it expired. */
  | 'unauthorized'
  /** Too many requests: wait. */
  | 'limit'
  /** No answer, a timeout or a server error. */
  | 'unavailable'
  /** AEMET has nothing for that station or municipality now. */
  | 'no-data'
  /** An answer that is not what AEMET documents. */
  | 'invalid';

export class AemetError extends Error {
  constructor(
    readonly kind: AemetFailure,
    detail: string,
  ) {
    super(`${kind}: ${detail}`);
  }
}

const TIMEOUT_MS = 15_000;

export interface AemetOptions {
  url: string;
  key: string;
  fetch?: typeof fetch;
}

function decode(bytes: ArrayBuffer, contentType: string | null): string {
  const charset = /charset=([^;]+)/i
    .exec(contentType ?? '')?.[1]
    ?.trim()
    .toLowerCase();
  try {
    return new TextDecoder(charset ?? 'iso-8859-15').decode(bytes);
  } catch {
    return new TextDecoder('iso-8859-15').decode(bytes);
  }
}

async function get(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string }> {
  let response: Response;
  try {
    response = await fetcher(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new AemetError('unavailable', (error as Error).message);
  }
  const text = decode(await response.arrayBuffer(), response.headers.get('content-type'));
  return { status: response.status, text };
}

const fail = (status: number, what: string): never => {
  if (status === 401 || status === 403) throw new AemetError('unauthorized', what);
  if (status === 429) throw new AemetError('limit', what);
  if (status === 404) throw new AemetError('no-data', what);
  throw new AemetError('unavailable', `${what}: ${status.toString()}`);
};

/** One dataset: the request with the key, then the data it points to. */
export async function fetchDataset(options: AemetOptions, path: string): Promise<unknown> {
  const fetcher = options.fetch ?? fetch;
  const first = await get(fetcher, `${options.url}/api${path}`, {
    api_key: options.key,
    accept: 'application/json',
  });
  if (first.status >= 400) fail(first.status, path);
  let meta: { estado?: number; datos?: string; descripcion?: string };
  try {
    meta = JSON.parse(first.text) as typeof meta;
  } catch {
    throw new AemetError('invalid', `${path}: not JSON`);
  }
  // AEMET puts its own status in the body, sometimes with a 200.
  if (meta.estado !== undefined && meta.estado !== 200) fail(meta.estado, path);
  if (typeof meta.datos !== 'string') throw new AemetError('invalid', `${path}: no datos`);
  const second = await get(fetcher, meta.datos, { accept: 'application/json' });
  if (second.status >= 400) fail(second.status, `${path} (datos)`);
  try {
    return JSON.parse(second.text) as unknown;
  } catch {
    throw new AemetError('invalid', `${path} (datos): not JSON`);
  }
}

// ──────────────────────────────────────────────────────────── observations

/** One row of `observacion/convencional`, as AEMET documents it. */
interface ObservationRow {
  idema?: string;
  ubi?: string;
  lat?: number;
  lon?: number;
  /** End of the observed hour, UTC. */
  fint?: string;
  ta?: number;
  hr?: number;
  vv?: number;
  vmax?: number;
  dv?: number;
  prec?: number;
  vis?: number;
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** AEMET's observation times are UTC, sometimes without saying so. */
function utcSeconds(text: string | undefined): number | null {
  if (!text) return null;
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

const rowsOf = (data: unknown): ObservationRow[] => {
  if (!Array.isArray(data)) throw new AemetError('invalid', 'observations: not a list');
  return data as ObservationRow[];
};

function toObservation(row: ObservationRow): WeatherObservation | null {
  const at = utcSeconds(row.fint);
  if (!row.idema || at === null) return null;
  return {
    station: { id: row.idema, name: (row.ubi ?? row.idema).slice(0, 80) },
    at,
    temp: num(row.ta),
    rh: num(row.hr),
    windSpeed: num(row.vv),
    windGust: num(row.vmax),
    windDir: num(row.dv),
    precip: num(row.prec),
    visibility: num(row.vis),
  };
}

/** The station's latest hour (AEMET gives the last 12–24), and its row as sent. */
export function latestObservation(data: unknown): {
  observation: WeatherObservation;
  row: unknown;
} {
  let best: { observation: WeatherObservation; row: unknown } | null = null;
  for (const row of rowsOf(data)) {
    const observation = toObservation(row);
    if (observation && (!best || observation.at > best.observation.at)) best = { observation, row };
  }
  if (!best) throw new AemetError('no-data', 'no observation');
  return best;
}

export async function fetchObservation(
  options: AemetOptions,
  station: string,
): Promise<{ observation: WeatherObservation; row: unknown }> {
  const data = await fetchDataset(
    options,
    `/observacion/convencional/datos/estacion/${encodeURIComponent(station)}`,
  );
  return latestObservation(data);
}

export interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * The station nearest the greenhouse among those reporting now, with a
 * temperature (every station in `observacion/convencional/todas`).
 */
export function nearestStation(data: unknown, place: { lat: number; lng: number }): Station {
  let best: Station | null = null;
  let bestKm = Infinity;
  for (const row of rowsOf(data)) {
    const lat = num(row.lat);
    const lng = num(row.lon);
    if (!row.idema || lat === null || lng === null || num(row.ta) === null) continue;
    const km = distanceKm(place, { lat, lng });
    if (km < bestKm) {
      bestKm = km;
      best = { id: row.idema, name: (row.ubi ?? row.idema).slice(0, 80), lat, lng };
    }
  }
  if (!best) throw new AemetError('no-data', 'no station reporting');
  return best;
}

export async function fetchNearestStation(
  options: AemetOptions,
  place: { lat: number; lng: number },
): Promise<Station> {
  return nearestStation(await fetchDataset(options, '/observacion/convencional/todas'), place);
}

// ──────────────────────────────────────────────────────────────── forecast

/** One hour of the forecast, before it is published. */
export interface ForecastPoint {
  /** Start of the hour, Unix s. */
  hour: number;
  sky: string | null;
  skyText: string | null;
  temp: number | null;
  precip: number | null;
  snow: number | null;
  /** m/s. */
  windSpeed: number | null;
  windGust: number | null;
}

export interface Forecast {
  municipality: { id: string; name: string };
  issuedAt: number;
  points: ForecastPoint[];
}

interface Period {
  value?: string;
  periodo?: string;
  descripcion?: string;
  velocidad?: string[];
}

/** The offset of a time zone at an instant, ms (local − UTC). */
function offsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - Math.floor(at / 1000) * 1000;
}

/** A local wall-clock time in `timeZone` as Unix s ("2026-10-13", 6 → 04:00Z in summer). */
export function zonedSeconds(
  day: string,
  hour: number,
  timeZone: string,
  minute = 0,
  second = 0,
): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!match) return null;
  const guess = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    hour,
    minute,
    second,
  );
  let utc = guess - offsetMs(guess, timeZone);
  // Near a change of time, the offset at the answer is the one that counts.
  utc = guess - offsetMs(utc, timeZone);
  return Math.floor(utc / 1000);
}

/** "Ip" is AEMET's "inappreciable" (a trace): counted as 0. Empty: unknown. */
const amount = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  if (value.trim().toLowerCase() === 'ip') return 0;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * `prediccion/especifica/municipio/horaria`: hours in local time
 * (`fecha` + `periodo`), wind in km/h.
 */
export function parseForecast(data: unknown, timeZone: string): Forecast {
  const root = (Array.isArray(data) ? data[0] : null) as {
    id?: string | number;
    nombre?: string;
    elaborado?: string;
    prediccion?: { dia?: Record<string, unknown>[] };
  } | null;
  const days = root?.prediccion?.dia;
  if (!root || !Array.isArray(days)) throw new AemetError('invalid', 'forecast: no days');
  const issued = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(root.elaborado ?? '');
  const issuedAt = issued
    ? zonedSeconds(
        issued[1] ?? '',
        Number(issued[2]),
        timeZone,
        Number(issued[3]),
        Number(issued[4]),
      )
    : null;
  if (issuedAt === null) throw new AemetError('invalid', 'forecast: no elaborado');

  const points = new Map<number, ForecastPoint>();
  for (const day of days) {
    const date = typeof day['fecha'] === 'string' ? day['fecha'] : null;
    if (!date) continue;
    const point = (periodo: string | undefined): ForecastPoint | null => {
      if (!periodo || !/^\d{2}$/.test(periodo)) return null;
      const hour = zonedSeconds(date, Number(periodo), timeZone);
      if (hour === null) return null;
      let existing = points.get(hour);
      if (!existing) {
        existing = {
          hour,
          sky: null,
          skyText: null,
          temp: null,
          precip: null,
          snow: null,
          windSpeed: null,
          windGust: null,
        };
        points.set(hour, existing);
      }
      return existing;
    };
    const list = (key: string) => (Array.isArray(day[key]) ? (day[key] as Period[]) : []);
    for (const entry of list('estadoCielo')) {
      const p = point(entry.periodo);
      if (!p) continue;
      p.sky = entry.value && /^\d{2}n?$/.test(entry.value) ? entry.value : null;
      p.skyText = entry.descripcion ? entry.descripcion.slice(0, 80) : null;
    }
    for (const entry of list('temperatura')) {
      const p = point(entry.periodo);
      if (p) p.temp = amount(entry.value);
    }
    for (const entry of list('precipitacion')) {
      const p = point(entry.periodo);
      if (p) p.precip = amount(entry.value);
    }
    for (const entry of list('nieve')) {
      const p = point(entry.periodo);
      if (p) p.snow = amount(entry.value);
    }
    // Wind and gusts alternate in one list: {velocidad: ["10"]} and {value: "18"}.
    for (const entry of list('vientoAndRachaMax')) {
      const p = point(entry.periodo);
      if (!p) continue;
      if (Array.isArray(entry.velocidad)) {
        const kmh = amount(entry.velocidad[0]);
        p.windSpeed = kmh === null ? null : kmh / 3.6;
      } else {
        const kmh = amount(entry.value);
        p.windGust = kmh === null ? null : kmh / 3.6;
      }
    }
  }
  return {
    municipality: { id: String(root.id ?? ''), name: (root.nombre ?? '').slice(0, 80) },
    issuedAt,
    points: [...points.values()].sort((a, b) => a.hour - b.hour),
  };
}

export async function fetchForecast(
  options: AemetOptions,
  municipality: string,
  timeZone: string,
): Promise<Forecast> {
  const data = await fetchDataset(
    options,
    `/prediccion/especifica/municipio/horaria/${encodeURIComponent(municipality)}`,
  );
  return parseForecast(data, timeZone);
}
