import { API_PREFIX, parseMessage, parseTopic } from '@vitreo/shared';
import type {
  CommandMessage,
  TelemetryMessage,
  ConfigMessage,
  HubStorage,
  WeatherMessage,
  WeatherObservation,
} from '@vitreo/shared';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sql-js';
import type { Database, SqlJsStatic } from 'sql.js';

import { AlertEngine, snapshotFrom } from './alerts.ts';
import { ConfigOwner } from './configOwner.ts';
import * as schema from './db/schema.ts';
import { ensurePlants, readSettings } from './db/store.ts';
import type { HubDatabase } from './db/types.ts';
import { hourOf, summariseHours } from './history.ts';
import { handleMessage, safetyLimitOf } from './ingest.ts';
import { JournalCore } from './journalCore.ts';
import { PushCore } from './pushCore.ts';
import { ApiReply, hubRoutes } from './routes.ts';
import type { HubContext, Method, Route } from './routes.ts';
import type { Forecast } from './weather/aemet.ts';
import { WeatherRuleEngine } from './weather/rules.ts';
import { WeatherService } from './weather/service.ts';

export type { Forecast, ForecastPoint } from './weather/aemet.ts';

/**
 * The hub without Node (D66, D103): the same routes, store, history, alerts,
 * config and journal as the hub, on sql.js, for the public demo's Web
 * Worker. Nothing here is the demo's own logic: it only puts the hub's
 * parts together (as index.ts does) and answers requests as Fastify would
 * (server.ts). contract.test.ts holds the two to the same answers.
 *
 * Left out, as the demo has no use for them: the broker (the worker hands
 * messages in), AEMET (the demo's sky is simulated, put in with
 * `feedWeather` and published as `simulated`, D111; the weather rules are
 * the hub's own), web push (recorded, never sent), backups and the monthly
 * archive.
 */

/** A fresh database on sql.js, with the hub's migrations (apps/hub/drizzle), in order. */
export function openSqlJsDatabase(SQL: SqlJsStatic, migrations: readonly string[]): HubDatabase {
  return openSqlJs(SQL, migrations).db;
}

function openSqlJs(
  SQL: SqlJsStatic,
  migrations: readonly string[],
): { sqlite: Database; db: HubDatabase } {
  const sqlite = new SQL.Database();
  sqlite.exec('PRAGMA foreign_keys = ON;');
  // Their "--> statement-breakpoint" lines are SQL comments: each file runs whole.
  for (const migration of migrations) sqlite.exec(migration);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

/**
 * Many readings at once, into a history that has none of them yet (the
 * demo's recorded week, D112): the rows `storeTelemetry` writes one by one
 * (db/store.ts), with two prepared statements in one transaction instead
 * of eight built queries a reading, which would take the visitor's phone
 * most of a minute. Two readings within the same second: the later one, as
 * there. contract.test.ts holds the two to the same rows.
 */
function storeRecordedTelemetry(
  sqlite: Database,
  device: string,
  readings: readonly { message: TelemetryMessage; raw: string; receivedAt: number }[],
): void {
  const bySecond = new Map<number, (typeof readings)[number]>();
  for (const reading of readings) bySecond.set(reading.message.ts, reading);
  const reading = sqlite.prepare(
    `INSERT INTO telemetry (device, ts, received_at, air_temp, air_rh, lux, tank, pump,
       grow_light, fan, vent, fw, rssi, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const soil = sqlite.prepare(
    'INSERT INTO soil (telemetry_id, device, ts, zone, moisture, cal) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const flag = (on: boolean) => (on ? 1 : 0);
  sqlite.exec('BEGIN');
  try {
    for (const { message, raw, receivedAt } of bySecond.values()) {
      reading.bind([
        device,
        message.ts,
        receivedAt,
        message.air.temp,
        message.air.rh,
        message.light.lux,
        message.tank.level,
        flag(message.actuators.pump),
        flag(message.actuators.growLight),
        flag(message.actuators.fan),
        message.actuators.vent,
        message.fw,
        message.rssi,
        raw,
      ]);
      reading.step();
      const id = Number(reading.get()[0]);
      reading.reset();
      for (const pot of message.soil) {
        soil.run([id, device, message.ts, pot.id, pot.moisture, pot.cal ?? null]);
      }
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  } finally {
    reading.free();
    soil.free();
  }
}

/** One row of the hourly summaries (history.ts), as the hub keeps it. */
export interface HourlySummary {
  /** Unix s at the start of the hour (UTC). */
  hour: number;
  /** air_temp, air_rh, lux, tank, soil, pump, grow_light, fan, vent. */
  metric: string;
  /** For soil; '' otherwise. */
  zone: string;
  count: number;
  mean: number | null;
  min: number | null;
  max: number | null;
}

/**
 * Hourly summaries of a past the hub never held raw (the demo's recorded
 * month, D129: what is older than its last week arrives summarised, as
 * a home hub would show it at a 4-hour step). An hour already summarised
 * keeps its own row.
 */
function storeSummaries(sqlite: Database, device: string, rows: readonly HourlySummary[]): void {
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO hourly (device, hour, metric, zone, count, mean, min, max)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  sqlite.exec('BEGIN');
  try {
    for (const row of rows) {
      insert.run([device, row.hour, row.metric, row.zone, row.count, row.mean, row.min, row.max]);
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  } finally {
    insert.free();
  }
}

/** The journal with its photos in memory: they never leave the visitor's browser. */
export class MemoryJournal extends JournalCore {
  private readonly photos = new Map<string, Uint8Array>();

  protected writePhoto(id: string, bytes: Uint8Array): void {
    this.photos.set(id, bytes);
  }

  protected readPhoto(id: string): Uint8Array | null {
    return this.photos.get(id) ?? null;
  }

  protected removePhoto(id: string): void {
    this.photos.delete(id);
  }

  clear(): void {
    this.photos.clear();
  }

  /** No file and no backup: what a fresh hub without backups says. */
  storageReport(now: number): HubStorage {
    let bytes = 0;
    for (const photo of this.photos.values()) bytes += photo.length;
    return {
      databaseBytes: 0,
      photos: { count: this.photos.size, bytes },
      backupsBytes: 0,
      photosLast30DaysBytes: this.recentPhotoBytes(now),
      backup: { day: null, photos: 0, missing: 0 },
    };
  }
}

/** A request, as a browser would send it to the hub. */
export interface HubRequest {
  method: string;
  /** From `/api/v1`, with the query string: `/api/v1/history?from=…`. */
  url: string;
  /** The body as sent: JSON text, the bytes of an image/jpeg, or none. */
  body?: string | Uint8Array;
  contentType?: string;
}

/** What Fastify would answer: status, content type, the route's own headers, the body. */
export interface HubResponse {
  status: number;
  type: string;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

const JSON_TYPE = 'application/json; charset=utf-8';
const json = (status: number, body: unknown): HubResponse => ({
  status,
  type: JSON_TYPE,
  headers: {},
  body: JSON.stringify(body),
});

/** The query string as Fastify gives it to a route: strings, an array for a repeated key. */
function queryOf(search: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of search) {
    const before = query[key];
    query[key] =
      before === undefined ? value : [...(Array.isArray(before) ? before : [before]), value];
  }
  return query;
}

/** A route's path against a request's: its `:name` parts, or null. */
function match(route: Route, parts: readonly string[]): Record<string, string> | null {
  const pattern = route.path.split('/');
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of pattern.entries()) {
    const given = parts[i] ?? '';
    if (part.startsWith(':')) {
      if (given === '') return null;
      params[part.slice(1)] = decodeURIComponent(given);
    } else if (part !== given) return null;
  }
  return params;
}

/**
 * Answers requests with the hub's routes, as server.ts serves them: a fixed
 * part of the path wins over a `:name` (as in Fastify's router), an unknown
 * route is Fastify's 404, and an error its 500.
 */
export function createRouter(
  routes: readonly Route[],
): (request: HubRequest) => Promise<HubResponse> {
  const statics = (route: Route) => route.path.split('/').filter((p) => !p.startsWith(':')).length;
  const ordered = [...routes].sort((a, b) => statics(b) - statics(a));
  return async (request) => {
    const url = new URL(request.url, 'http://hub');
    const method = request.method.toUpperCase();
    const notFound = json(404, {
      message: `Route ${method}:${request.url} not found`,
      error: 'Not Found',
      statusCode: 404,
    });
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) return notFound;
    const parts = url.pathname.slice(API_PREFIX.length).split('/');
    for (const route of ordered) {
      if (route.method !== (method as Method)) continue;
      const params = match(route, parts);
      if (!params) continue;
      let body: unknown;
      if (typeof request.body === 'string' && request.body !== '') {
        try {
          body = JSON.parse(request.body);
        } catch {
          return json(400, {
            statusCode: 400,
            code: 'FST_ERR_CTP_INVALID_JSON_BODY',
            error: 'Bad Request',
            message: "Body is not valid JSON but content-type is set to 'application/json'",
          });
        }
      } else if (request.body instanceof Uint8Array) {
        body = request.body;
      }
      try {
        const result = await route.handle({
          params,
          query: queryOf(url.searchParams),
          body,
          ip: '',
        });
        if (!(result instanceof ApiReply)) return json(200, result);
        const raw = result.body;
        return {
          status: result.status,
          type: result.type ?? JSON_TYPE,
          headers: { ...result.headers },
          body: typeof raw === 'string' || raw instanceof Uint8Array ? raw : JSON.stringify(raw),
        };
      } catch (error) {
        return json(500, {
          statusCode: 500,
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return notFound;
  };
}

export interface PortableHubOptions {
  /** sql.js, already loaded (its WebAssembly is the caller's to fetch). */
  SQL: SqlJsStatic;
  /** The SQL of apps/hub/drizzle, in order. */
  migrations: readonly string[];
  device: string;
  timeZone: string;
  seedLocation: { lat: number; lng: number };
  now?: () => number;
  /** Where the hub's config goes: what it would publish, retained, on the broker. */
  publishConfig: (config: ConfigMessage) => void;
  /** Where its weather goes (retained on `weather`), from a simulated sky (D111). */
  publishWeather?: (message: WeatherMessage | null) => void;
  /** An order of the hub's own (the weather rules' outdoor hold), as it would publish it on `cmd`. */
  sendCommand?: (command: CommandMessage) => void;
  log?: (message: string) => void;
}

export interface PortableHub {
  context: HubContext;
  /** Answers one API request. */
  request: (request: HubRequest) => Promise<HubResponse>;
  /** A message from the greenhouse, as the broker would deliver it. */
  receive: (topicName: string, payload: string) => void;
  /**
   * Summarises the hours new telemetry touched (the hub does it every
   * minute), newest first; at most `maxHours` of them (the rest wait).
   */
  summarise: (maxHours?: number) => void;
  /** Hours still to summarise. */
  unsummarised: () => number;
  /**
   * What the hub would have heard before it started (the demo's recorded
   * week, D112), each at its own time: stored as `receive` stores it, the
   * readings in batches; summarised later, with `summarise`.
   */
  receiveRecorded: (messages: readonly { topic: string; payload: string; at: number }[]) => void;
  /** Hourly summaries of an older past, stored as they are (the demo's recorded month, D129). */
  receiveSummaries: (rows: readonly HourlySummary[]) => void;
  /** The hourly summaries kept, oldest first (to record the demo's month, D129). */
  hourlySummaries: () => HourlySummary[];
  /** Looks at the warnings (the hub does it every 30 s). */
  evaluateAlerts: () => Promise<void>;
  /** Publishes the current config, as the hub does once connected. */
  announce: () => ConfigMessage;
  /**
   * The weather now, from the demo's simulated sky (D111): stored, published
   * and handed to the weather rules, as the hub does with AEMET's.
   */
  feedWeather: (weather: { observation: WeatherObservation; forecast: Forecast }) => Promise<void>;
  /** Looks at the weather rules (the hub does it every 30 s, and on new weather). */
  evaluateWeather: () => Promise<void>;
  /**
   * An observation of the past, kept in the weather history only: neither
   * published nor ruled on (the demo's recorded week, D112).
   */
  recordObservation: (observation: WeatherObservation) => void;
}

/** The hub's parts, put together as index.ts does, on sql.js and without Node. */
export function createPortableHub(options: PortableHubOptions): PortableHub {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);
  const { device, timeZone, seedLocation } = options;
  const { sqlite, db } = openSqlJs(options.SQL, options.migrations);
  const startedAt = now();
  ensurePlants(db, device, startedAt);
  const owner = new ConfigOwner(db, device, {
    timeZone,
    location: () => readSettings(db, { location: seedLocation, timeZone }, now()).location,
    publish: options.publishConfig,
  });
  const journal = new MemoryJournal(db, device);
  const push = new PushCore(db, device, { publicKey: null, dryRun: true, deliver: null }, log);
  const alerts = new AlertEngine(db, device, push, { timeZone, startedAt });
  const weather = new WeatherService(db, device, {
    // No key: nothing is asked of AEMET; the weather is put in (feedWeather).
    aemet: { key: null, municipality: '', station: null, url: '' },
    timeZone,
    location: () => readSettings(db, { location: seedLocation, timeZone }, now()).location,
    publish: options.publishWeather ?? (() => undefined),
    log,
    source: 'simulated',
  });
  const weatherRules = new WeatherRuleEngine(db, device, {
    weather: (at) => weather.message(at),
    sendCommand: options.sendCommand ?? (() => undefined),
    push,
    timeZone,
    log,
  });
  const context: HubContext = {
    db,
    owner,
    device,
    timeZone,
    seedLocation,
    startedAt,
    // The worker hands every message in: always "connected".
    mqttConnected: () => true,
    now,
    push,
    alerts,
    journal,
    weather,
    weatherRules,
  };
  const dirty = new Set<number>();
  return {
    context,
    request: createRouter(hubRoutes(context)),
    receive(topicName, payload) {
      const ts = handleMessage(db, owner, device, topicName, payload, now());
      if (ts !== null) dirty.add(hourOf(ts));
      const limit = safetyLimitOf(topicName, payload);
      if (limit !== null) void alerts.oneOff(limit, now());
    },
    summarise(maxHours = Number.POSITIVE_INFINITY) {
      if (dirty.size === 0) return;
      const hours = [...dirty].sort((a, b) => b - a).slice(0, maxHours);
      for (const hour of hours) dirty.delete(hour);
      summariseHours(db, device, hours);
    },
    unsummarised: () => dirty.size,
    receiveRecorded(messages) {
      const readings: Parameters<typeof storeRecordedTelemetry>[2][number][] = [];
      for (const { topic: topicName, payload, at } of messages) {
        const parsed =
          parseTopic(topicName)?.channel === 'telemetry'
            ? parseMessage('telemetry', payload)
            : null;
        if (parsed?.ok) {
          readings.push({ message: parsed.message, raw: payload, receivedAt: at });
          dirty.add(hourOf(parsed.message.ts));
          continue;
        }
        // Anything else (and a reading that does not validate), one by one, as it came.
        handleMessage(db, owner, device, topicName, payload, at);
      }
      storeRecordedTelemetry(sqlite, device, readings);
    },
    receiveSummaries(rows) {
      storeSummaries(sqlite, device, rows);
    },
    hourlySummaries: () =>
      db
        .select({
          hour: schema.hourly.hour,
          metric: schema.hourly.metric,
          zone: schema.hourly.zone,
          count: schema.hourly.count,
          mean: schema.hourly.mean,
          min: schema.hourly.min,
          max: schema.hourly.max,
        })
        .from(schema.hourly)
        .where(eq(schema.hourly.device, device))
        .orderBy(asc(schema.hourly.hour), asc(schema.hourly.metric), asc(schema.hourly.zone))
        .all(),
    evaluateAlerts: () => alerts.evaluate(snapshotFrom(db, device, now())),
    announce: () => owner.announce(now()),
    async feedWeather(readings) {
      weather.inject(readings, now());
      await weatherRules.evaluate(now());
    },
    evaluateWeather: () => weatherRules.evaluate(now()),
    recordObservation(observation) {
      weather.recordObservation(observation, observation, now());
    },
  };
}
