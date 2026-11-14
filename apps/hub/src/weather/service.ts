import type {
  Location,
  WeatherMessage,
  WeatherObservation,
  WeatherSource,
  WeatherState,
} from '@vitreo/shared';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';

import type { HubConfig } from '../config.ts';
import type { HubDatabase } from '../db/types.ts';
import * as t from '../db/schema.ts';
import { readSetting, writeSetting } from '../db/store.ts';
import {
  AemetError,
  distanceKm,
  fetchForecast,
  fetchNearestStation,
  fetchObservation,
  zonedSeconds,
} from './aemet.ts';
import type { AemetFailure, AemetOptions, Forecast, ForecastPoint, Station } from './aemet.ts';

/**
 * The outdoor weather on the hub (A10, D97). Asks AEMET for the station's
 * latest observation every 10 minutes and the municipality's hourly
 * forecast every hour: about 16 requests an hour, far under their limit
 * (50 a minute). Each answer is stored (the weather history, next to the
 * telemetry) and published retained on `weather`.
 *
 * AEMET slow or down: each request gives up after 15 s, the next try comes
 * 5 minutes later (15 if AEMET says "too many"), and what the hub had stays
 * published with its own times, so its age shows. It survives a restart:
 * the last observation and forecast come back from the database. Nothing
 * is invented: no answer, no value.
 */

const OBSERVATION_EVERY_MS = 10 * 60_000;
const FORECAST_EVERY_MS = 60 * 60_000;
const RETRY_AFTER_MS = 5 * 60_000;
const LIMIT_WAIT_MS = 15 * 60_000;
/** The loop looks this often; it also republishes, so the app knows the hub is alive. */
const TICK_MS = 60_000;
const REPUBLISH_EVERY_MS = 10 * 60_000;
/** The station is chosen again if the greenhouse moved more than this. */
const MOVED_KM = 2;

const STATION_KEY = 'weather.station';
const storedStation = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  /** Where the greenhouse was when it was chosen. */
  for: z.object({ lat: z.number(), lng: z.number() }),
});

export interface WeatherServiceOptions {
  aemet: HubConfig['aemet'];
  timeZone: string;
  /** Where the greenhouse is (rounded, D79): the nearest station. */
  location: () => Location;
  publish: (message: WeatherMessage | null) => void;
  log: (message: string) => void;
  fetch?: typeof fetch;
  /**
   * Where the weather comes from: AEMET, or (the public demo, D111) a
   * simulated sky, put in with `inject` and published as `simulated`.
   */
  source?: WeatherSource;
}

interface Due {
  observation: number;
  forecast: number;
}

export class WeatherService {
  private observation: WeatherObservation | null = null;
  private forecast: Forecast | null = null;
  private error: AemetFailure | null = null;
  private failingSince: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastPublishedAt = 0;
  private readonly due: Due = { observation: 0, forecast: 0 };
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Told when new weather arrives (the rules look again). */
  onChange: () => void = () => undefined;

  constructor(
    private readonly db: HubDatabase,
    private readonly device: string,
    private readonly options: WeatherServiceOptions,
  ) {
    this.restore();
  }

  get hasKey(): boolean {
    return this.options.aemet.key !== null;
  }

  private get aemet(): AemetOptions {
    return {
      url: this.options.aemet.url,
      key: this.options.aemet.key ?? '',
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    };
  }

  /** The last observation and forecast stored, so a restart loses nothing. */
  private restore(): void {
    const observation = this.db
      .select()
      .from(t.weatherObservations)
      .where(eq(t.weatherObservations.device, this.device))
      .orderBy(desc(t.weatherObservations.at))
      .limit(1)
      .get();
    if (observation) {
      this.observation = {
        station: { id: observation.station, name: observation.stationName },
        at: observation.at,
        temp: observation.temp,
        rh: observation.rh,
        windSpeed: observation.windSpeed,
        windGust: observation.windGust,
        windDir: observation.windDir,
        precip: observation.precip,
        visibility: observation.visibility,
      };
      this.lastSuccessAt = observation.receivedAt;
    }
    const forecast = this.db
      .select()
      .from(t.weatherForecasts)
      .where(
        and(
          eq(t.weatherForecasts.device, this.device),
          eq(t.weatherForecasts.municipality, this.options.aemet.municipality),
        ),
      )
      .orderBy(desc(t.weatherForecasts.issuedAt))
      .limit(1)
      .get();
    if (forecast) {
      this.forecast = {
        municipality: { id: forecast.municipality, name: forecast.name },
        issuedAt: forecast.issuedAt,
        points: JSON.parse(forecast.points) as ForecastPoint[],
      };
      this.lastSuccessAt = Math.max(this.lastSuccessAt ?? 0, forecast.receivedAt);
    }
  }

  /** What the hub publishes now, or null if it has nothing. */
  message(now: number): WeatherMessage | null {
    if (!this.hasKey && !this.injected) return null;
    if (!this.observation && !this.forecast) return null;
    const nowS = Math.floor(now / 1000);
    const forecast = this.forecast;
    const point = forecast?.points.find((p) => p.hour <= nowS && nowS < p.hour + 3600) ?? null;
    return {
      v: 1,
      ts: nowS,
      source: this.options.source ?? 'aemet',
      observation: this.observation,
      forecast:
        forecast && point
          ? { municipality: forecast.municipality, issuedAt: forecast.issuedAt, ...point }
          : null,
      tonight: forecast ? tonightMin(forecast.points, nowS, this.options.timeZone) : null,
    };
  }

  state(now: number): Omit<WeatherState, 'rules' | 'window'> {
    const weather = this.message(now);
    const status: WeatherState['status'] =
      !this.hasKey && !this.injected
        ? 'no-key'
        : this.error !== null
          ? 'failing'
          : this.lastSuccessAt === null
            ? 'starting'
            : 'ok';
    return {
      status,
      error: status === 'failing' ? this.error : null,
      failingSince: status === 'failing' ? this.failingSince : null,
      lastSuccessAt: this.lastSuccessAt,
      weather,
    };
  }

  /** Starts asking AEMET (or, with no key, clears what an earlier key left). */
  start(): void {
    if (!this.hasKey) {
      this.options.publish(null);
      return;
    }
    this.publishNow(Date.now());
    void this.tick(Date.now());
    this.timer = setInterval(() => {
      void this.tick(Date.now());
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private publishNow(now: number): void {
    const message = this.message(now);
    if (message) this.options.publish(message);
    this.lastPublishedAt = now;
  }

  /** One look: whatever is due is asked for, then published. */
  async tick(now: number): Promise<void> {
    if (this.busy || !this.hasKey) return;
    this.busy = true;
    let changed = false;
    try {
      if (now >= this.due.observation) changed = (await this.refreshObservation(now)) || changed;
      if (now >= this.due.forecast) changed = (await this.refreshForecast(now)) || changed;
    } finally {
      this.busy = false;
    }
    if (changed || now - this.lastPublishedAt >= REPUBLISH_EVERY_MS) this.publishNow(now);
    if (changed) this.onChange();
  }

  private failed(error: unknown, now: number, what: keyof Due): void {
    const kind = error instanceof AemetError ? error.kind : 'invalid';
    if (this.error !== kind) {
      this.options.log(`AEMET ${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.error = kind;
    this.failingSince ??= now;
    this.due[what] = now + (kind === 'limit' ? LIMIT_WAIT_MS : RETRY_AFTER_MS);
  }

  private succeeded(now: number): void {
    if (this.error !== null) this.options.log('AEMET answers again');
    this.error = null;
    this.failingSince = null;
    this.lastSuccessAt = now;
  }

  /** The station: from .env, or the nearest to the greenhouse (chosen once, kept). */
  private async station(): Promise<Station | { id: string; name: string }> {
    const fixed = this.options.aemet.station;
    if (fixed) return { id: fixed, name: this.observation?.station.name ?? fixed };
    const place = this.options.location();
    const stored = readSetting(this.db, STATION_KEY, storedStation.nullable(), null);
    if (stored && distanceKm(stored.for, place) <= MOVED_KM) return stored;
    const nearest = await fetchNearestStation(this.aemet, place);
    writeSetting(this.db, STATION_KEY, { ...nearest, for: place }, Date.now());
    this.options.log(`AEMET station: ${nearest.id} (${nearest.name})`);
    return nearest;
  }

  private async refreshObservation(now: number): Promise<boolean> {
    try {
      const station = await this.station();
      const { observation, row } = await fetchObservation(this.aemet, station.id);
      this.recordObservation(observation, row, now);
      this.succeeded(now);
      this.due.observation = now + OBSERVATION_EVERY_MS;
      return true;
    } catch (error) {
      this.failed(error, now, 'observation');
      return false;
    }
  }

  private async refreshForecast(now: number): Promise<boolean> {
    try {
      const forecast = await fetchForecast(
        this.aemet,
        this.options.aemet.municipality,
        this.options.timeZone,
      );
      this.recordForecast(forecast, now);
      this.succeeded(now);
      this.due.forecast = now + FORECAST_EVERY_MS;
      return true;
    } catch (error) {
      this.failed(error, now, 'forecast');
      return false;
    }
  }

  recordObservation(observation: WeatherObservation, row: unknown, now: number): void {
    this.db
      .insert(t.weatherObservations)
      .values({
        device: this.device,
        station: observation.station.id,
        stationName: observation.station.name,
        at: observation.at,
        receivedAt: now,
        temp: observation.temp,
        rh: observation.rh,
        windSpeed: observation.windSpeed,
        windGust: observation.windGust,
        windDir: observation.windDir,
        precip: observation.precip,
        visibility: observation.visibility,
        raw: JSON.stringify(row),
      })
      .onConflictDoNothing()
      .run();
    if (!this.observation || observation.at >= this.observation.at) this.observation = observation;
  }

  recordForecast(forecast: Forecast, now: number): void {
    this.db
      .insert(t.weatherForecasts)
      .values({
        device: this.device,
        municipality: forecast.municipality.id,
        name: forecast.municipality.name,
        issuedAt: forecast.issuedAt,
        receivedAt: now,
        points: JSON.stringify(forecast.points),
      })
      .onConflictDoNothing()
      .run();
    this.forecast = forecast;
  }

  /** Weather put in from outside, with no key and no network: an e2e test's, or the demo's simulated sky. */
  private injected = false;

  inject(
    weather: { observation: WeatherObservation | null; forecast: Forecast | null },
    now: number,
  ): void {
    this.injected = true;
    this.observation = null;
    this.forecast = null;
    if (weather.observation) this.recordObservation(weather.observation, weather.observation, now);
    if (weather.forecast) this.recordForecast(weather.forecast, now);
    this.succeeded(now);
    this.publishNow(now);
    this.onChange();
  }

  /** The e2e hub: back to "no key", nothing published. */
  clear(): void {
    this.injected = false;
    this.observation = null;
    this.forecast = null;
    this.lastSuccessAt = null;
    this.error = null;
    this.failingSince = null;
    this.options.publish(null);
  }

  /** Observations between two instants (Unix s), oldest first. */
  history(from: number, to: number) {
    return this.db
      .select({
        at: t.weatherObservations.at,
        station: t.weatherObservations.station,
        stationName: t.weatherObservations.stationName,
        temp: t.weatherObservations.temp,
        rh: t.weatherObservations.rh,
        windSpeed: t.weatherObservations.windSpeed,
        windGust: t.weatherObservations.windGust,
        precip: t.weatherObservations.precip,
      })
      .from(t.weatherObservations)
      .where(
        and(
          eq(t.weatherObservations.device, this.device),
          gte(t.weatherObservations.at, from),
          lte(t.weatherObservations.at, to),
        ),
      )
      .orderBy(t.weatherObservations.at)
      .all();
  }

  /**
   * The same, as CSV (A11): AEMET's hourly readings, SI units, empty = not
   * given, and the source on every row (AEMET's terms ask for it).
   */
  historyCsv(from: number, to: number): string {
    const cell = (value: number | string | null) => (value === null ? '' : String(value));
    const lines = this.history(from, to).map((row) =>
      [
        new Date(row.at * 1000).toISOString(),
        row.at,
        row.station,
        row.temp,
        row.rh,
        row.windSpeed,
        row.windGust,
        row.precip,
        this.options.source === 'simulated' ? 'simulated' : 'AEMET',
      ]
        .map(cell)
        .join(','),
    );
    const header = 'time_utc,ts,station,temp_c,rh,wind_ms,gust_ms,precip_mm,source';
    return [header, ...lines, ''].join('\n');
  }
}

/**
 * Tonight's lowest forecast temperature and its hour: from now until 10:00
 * tomorrow (or this morning, before 10:00), local time. Null if the
 * forecast does not reach that far or has no temperatures.
 */
export function tonightMin(
  points: readonly ForecastPoint[],
  nowS: number,
  timeZone: string,
): { min: number; at: number } | null {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(nowS * 1000);
  const part = (type: string) => local.find((p) => p.type === type)?.value ?? '';
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const hour = Number(part('hour'));
  let end = zonedSeconds(today, 10, timeZone);
  if (end === null) return null;
  if (hour >= 10) {
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    end = zonedSeconds(tomorrow, 10, timeZone);
    if (end === null) return null;
  }
  const last = points.at(-1);
  if (!last || last.hour < end - 3600) return null;
  let best: { min: number; at: number } | null = null;
  for (const point of points) {
    if (point.hour + 3600 <= nowS || point.hour >= end || point.temp === null) continue;
    if (!best || point.temp < best.min) best = { min: point.temp, at: point.hour };
  }
  return best;
}
