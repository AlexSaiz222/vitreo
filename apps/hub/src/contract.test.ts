import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { API_PREFIX } from '@vitreo/shared';
import type {
  CommandMessage,
  ConfigMessage,
  WeatherMessage,
  WeatherObservation,
} from '@vitreo/shared';
import { telemetryExample } from '@vitreo/shared/fixtures';
import sharp from 'sharp';
import initSqlJs from 'sql.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AlertEngine, snapshotFrom } from './alerts.ts';
import { ConfigOwner, defaultRules } from './configOwner.ts';
import { openDatabase } from './db/open.ts';
import type { NodeHubDatabase } from './db/open.ts';
import { ensurePlants, readSettings } from './db/store.ts';
import { hourOf, summariseHours } from './history.ts';
import { handleMessage, safetyLimitOf } from './ingest.ts';
import { Journal } from './journal.ts';
import { createPortableHub } from './portable.ts';
import type { Forecast, PortableHub } from './portable.ts';
import { PushSender } from './push.ts';
import { buildServer } from './server.ts';
import { WeatherRuleEngine } from './weather/rules.ts';
import { WeatherService } from './weather/service.ts';
import type { FastifyInstance } from 'fastify';

/**
 * The demo's hub against the hub (D66, D103): the same messages in, then the
 * same requests, in the same order, through both paths. Fastify on
 * better-sqlite3 (what the phone talks to) and the portable router on sql.js
 * (what the demo's worker runs) must answer byte for byte the same: status,
 * content type, headers and body. Both with the same parts (the weather a
 * simulated sky, as in the demo, D111) and the same clock.
 */

const DEVICE = 'demo';
const TIME_ZONE = 'Europe/Madrid';
const SEED = { lat: 40.42, lng: -3.7 };
const T0 = telemetryExample.ts;
let clock = T0 * 1000 + 3 * 3600_000;
const now = () => clock;

const MIGRATIONS = readdirSync(path.resolve(import.meta.dirname, '../drizzle'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(path.resolve(import.meta.dirname, '../drizzle', name), 'utf8'));

let dir: string;
let db: NodeHubDatabase;
let server: FastifyInstance;
let alerts: AlertEngine;
let owner: ConfigOwner;
let portable: PortableHub;
const published = { hub: [] as ConfigMessage[], portable: [] as ConfigMessage[] };
const skies = { hub: [] as (WeatherMessage | null)[], portable: [] as (WeatherMessage | null)[] };
const orders = { hub: [] as CommandMessage[], portable: [] as CommandMessage[] };
let weather: WeatherService;
let weatherRules: WeatherRuleEngine;

/** A wet hour, as the demo's sky would put it in (D111): rain in the gauge, closing the window. */
function sky(): { observation: WeatherObservation; forecast: Forecast } {
  const hour = Math.floor(clock / 3_600_000) * 3600;
  return {
    observation: {
      station: { id: 'demo', name: 'Simulado' },
      at: Math.floor(clock / 60_000) * 60,
      temp: 12.5,
      rh: 90,
      windSpeed: 4.2,
      windGust: 9.1,
      windDir: 240,
      precip: 0.8,
      visibility: 20,
    },
    forecast: {
      municipality: { id: 'demo', name: 'Madrid (simulado)' },
      issuedAt: hour,
      points: [0, 1, 2].map((i) => ({
        hour: hour + i * 3600,
        sky: '45',
        skyText: 'Muy nuboso con lluvia escasa',
        temp: 12,
        precip: 1,
        snow: 0,
        windSpeed: 4,
        windGust: 9,
      })),
    },
  };
}

/** Every message, to both: telemetry each minute for three hours, events, status. */
function messages(): [string, string][] {
  const list: [string, string][] = [
    [`vitreo/${DEVICE}/status`, JSON.stringify({ v: 1, state: 'online' })],
  ];
  for (let ts = T0; ts < T0 + 3 * 3600; ts += 60) {
    const minute = (ts - T0) / 60;
    const soil = telemetryExample.soil.map((s) => ({
      ...s,
      moisture: Math.max(0.2, 0.5 - minute * 0.001),
    }));
    list.push([
      `vitreo/${DEVICE}/telemetry`,
      JSON.stringify({ ...telemetryExample, ts, soil, air: { temp: 18 + minute / 30, rh: 60 } }),
    ]);
  }
  const event = (ts: number, body: Record<string, unknown>) =>
    [`vitreo/${DEVICE}/event`, JSON.stringify({ v: 1, ts, ...body })] as [string, string];
  list.push(
    event(T0 + 600, {
      type: 'watering.started',
      source: 'automation',
      zone: 'basil_01',
      seconds: 5,
      reason: { kind: 'soil', moisture: 0.39, threshold: 0.4, evening: true },
    }),
    event(T0 + 606, {
      type: 'watering.finished',
      source: 'automation',
      zone: 'basil_01',
      seconds: 5,
    }),
    event(T0 + 900, {
      type: 'automation.switched',
      source: 'automation',
      target: 'fan',
      value: true,
      reason: { kind: 'humidity', value: 88, limit: 85 },
    }),
    event(T0 + 1200, { type: 'safety.triggered', source: 'safety', limit: 'pump_max_per_hour' }),
    // A newer device's event (D108) and an invalid one.
    event(T0 + 1500, { type: 'filter.clogged', zone: 'basil_01' }),
    event(T0 + 1600, { type: 'watering.started', source: 'user', zone: 'basil_01', seconds: -1 }),
  );
  return list;
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'vitreo-contract-'));
  db = openDatabase(':memory:');
  ensurePlants(db, DEVICE, now());
  owner = new ConfigOwner(db, DEVICE, {
    timeZone: TIME_ZONE,
    location: () => readSettings(db, { location: SEED, timeZone: TIME_ZONE }, now()).location,
    publish: (config) => published.hub.push(config),
  });
  const push = new PushSender(db, DEVICE, { keys: null, dryRun: true }, () => undefined);
  alerts = new AlertEngine(db, DEVICE, push, { timeZone: TIME_ZONE, startedAt: now() });
  weather = new WeatherService(db, DEVICE, {
    aemet: { key: null, municipality: '', station: null, url: '' },
    timeZone: TIME_ZONE,
    location: () => SEED,
    publish: (message) => skies.hub.push(message),
    log: () => undefined,
    source: 'simulated',
  });
  weatherRules = new WeatherRuleEngine(db, DEVICE, {
    weather: (at) => weather.message(at),
    sendCommand: (command) => orders.hub.push(command),
    push,
    timeZone: TIME_ZONE,
    log: () => undefined,
  });
  server = buildServer(
    {
      db,
      owner,
      device: DEVICE,
      timeZone: TIME_ZONE,
      seedLocation: SEED,
      startedAt: now(),
      mqttConnected: () => true,
      now,
      push,
      alerts,
      journal: new Journal(db, DEVICE, {
        photoDir: path.join(dir, 'photos'),
        database: ':memory:',
        backupDir: path.join(dir, 'backups'),
      }),
      weather,
      weatherRules,
    },
    { logLevel: 'silent' },
  );
  portable = createPortableHub({
    SQL: await initSqlJs(),
    migrations: MIGRATIONS,
    device: DEVICE,
    timeZone: TIME_ZONE,
    seedLocation: SEED,
    now,
    publishConfig: (config) => published.portable.push(config),
    publishWeather: (message) => skies.portable.push(message),
    sendCommand: (command) => orders.portable.push(command),
  });

  const hours = new Set<number>();
  for (const [topicName, payload] of messages()) {
    const ts = handleMessage(db, owner, DEVICE, topicName, payload, now());
    if (ts !== null) hours.add(hourOf(ts));
    const limit = safetyLimitOf(topicName, payload);
    if (limit !== null) await alerts.oneOff(limit, now());
    portable.receive(topicName, payload);
  }
  summariseHours(db, DEVICE, hours);
  portable.summarise();
  owner.announce(now());
  portable.announce();
  await alerts.evaluate(snapshotFrom(db, DEVICE, now()));
  await portable.evaluateAlerts();
  // The same sky to both, as the demo's worker puts it in.
  weather.inject(sky(), now());
  await weatherRules.evaluate(now());
  await portable.feedWeather(sky());
});

afterAll(async () => {
  await server.close();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Answer {
  status: number;
  type: string | undefined;
  headers: Record<string, string>;
  body: string;
}

/** The headers a route sets itself (Fastify adds its own: length, date…). */
const OWN_HEADERS = ['content-disposition', 'cache-control'];

async function both(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  type = 'application/json',
): Promise<{ hub: Answer; demo: Answer }> {
  const raw =
    body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body);
  const response = await server.inject({
    method,
    url,
    // A Buffer, as the phone's bytes arrive (inject would stringify a plain Uint8Array).
    ...(raw === undefined
      ? {}
      : {
          payload: raw instanceof Uint8Array ? Buffer.from(raw) : raw,
          headers: { 'content-type': type },
        }),
  });
  const headers: Record<string, string> = {};
  for (const name of OWN_HEADERS) {
    const value = response.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  const hub: Answer = {
    status: response.statusCode,
    type: response.headers['content-type'],
    headers,
    body: response.rawPayload.toString('base64'),
  };
  const answer = await portable.request({
    method,
    url,
    ...(raw === undefined ? {} : { body: raw, contentType: type }),
  });
  const demo: Answer = {
    status: answer.status,
    type: answer.type,
    headers: answer.headers,
    body: Buffer.from(answer.body).toString('base64'),
  };
  return { hub, demo };
}

/** Same answer, and a sensible one (not two identical errors where data was expected). */
async function same(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  type?: string,
): Promise<Answer> {
  const { hub, demo } = await both(method, url, body, type);
  expect(demo, `${method} ${url}`).toEqual(hub);
  return hub;
}

const api = (route: string) => `${API_PREFIX}${route}`;
const from = T0 - 60;
const to = T0 + 3 * 3600;
const NOTE = '7c0a3c4e-2f7a-4d55-9b8f-1f1d3c7e9a01';
const PHOTO = '0b6f1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const ok = (answer: Answer) => {
  expect(answer.status, answer.body).toBe(200);
};

describe('the demo hub answers as the hub does', () => {
  it('reads: health, plants, settings, config, telemetry, history, events, alerts', async () => {
    ok(await same('GET', api('/health')));
    ok(await same('GET', api('/plants')));
    ok(await same('GET', api('/settings')));
    ok(await same('GET', api('/config')));
    ok(await same('GET', api(`/telemetry?from=${from.toString()}&to=${to.toString()}`)));
    ok(await same('GET', api(`/telemetry.csv?from=${from.toString()}&to=${to.toString()}`)));
    for (const step of [300, 3600]) {
      ok(
        await same(
          'GET',
          api(`/history?from=${from.toString()}&to=${to.toString()}&step=${step.toString()}`),
        ),
      );
    }
    ok(
      await same(
        'GET',
        api(
          `/history?from=${from.toString()}&to=${to.toString()}&step=600&zones=basil_01,tomato_01`,
        ),
      ),
    );
    const events = await same('GET', api(`/events?from=${from.toString()}&to=${to.toString()}`));
    // Not two empty answers: what went in is there (the invalid event is not).
    expect(
      (JSON.parse(Buffer.from(events.body, 'base64').toString()) as { type: string }[]).map(
        (e) => e.type,
      ),
    ).toEqual([
      'watering.started',
      'watering.finished',
      'automation.switched',
      'safety.triggered',
      'filter.clogged',
    ]);
    const alerts = await same('GET', api('/alerts'));
    expect(Buffer.from(alerts.body, 'base64').toString()).toContain('Límite de seguridad');
    const history = await same(
      'GET',
      api(`/history?from=${from.toString()}&to=${to.toString()}&step=3600`),
    );
    expect(
      (JSON.parse(Buffer.from(history.body, 'base64').toString()) as { n: number[] }).n.filter(
        (n) => n > 0,
      ),
    ).toHaveLength(3);
    ok(await same('GET', api('/plants/basil_01/chapters')));
    ok(await same('GET', api('/journal/basil_01')));
    ok(await same('GET', api('/journal/greenhouse')));
    ok(await same('GET', api('/storage')));
  });

  it('refuses the same way: bad queries, unknown routes and things, no push keys', async () => {
    expect((await same('GET', api('/history?from=10&to=5&step=60'))).status).toBe(400);
    expect((await same('GET', api('/telemetry?from=abc&to=1'))).status).toBe(400);
    expect((await same('GET', api('/nothing-here'))).status).toBe(404);
    expect((await same('GET', api('/nothing-here?x=1'))).status).toBe(404);
    expect(await same('GET', '/elsewhere')).toMatchObject({ status: 404 });
    expect((await same('POST', api('/health'))).status).toBe(404);
    expect((await same('GET', api('/journal/Not%20a%20zone'))).status).toBe(400);
    expect((await same('GET', api(`/journal/${PHOTO}/photo`))).status).toBe(404);
    expect((await same('PATCH', api('/plants/nope_01'), { name: 'X' })).status).toBe(404);
    expect((await same('DELETE', api(`/journal/${NOTE}`))).status).toBe(404);
    expect((await same('GET', api('/push/key'))).status).toBe(503);
    expect(
      (await same('POST', api('/push/subscription/prefs'), { endpoint: 'https://push.example/x' }))
        .status,
    ).toBe(404);
    expect((await same('PUT', api('/config'), { watering: 'all' })).status).toBe(400);
    expect((await same('PUT', api('/config'), '{not json', 'application/json')).status).toBe(400);
  });

  it('the weather: the same simulated sky, published and ruled the same (D111)', async () => {
    const state = await same('GET', api('/weather'));
    expect(JSON.parse(Buffer.from(state.body, 'base64').toString())).toMatchObject({
      status: 'ok',
      weather: { source: 'simulated', observation: { precip: 0.8 } },
      window: { state: 'asking', cause: 'rain' },
    });
    ok(await same('GET', api(`/weather/history?from=${from.toString()}&to=${to.toString()}`)));
    const csv = await same('GET', api(`/weather.csv?from=${from.toString()}&to=${to.toString()}`));
    expect(Buffer.from(csv.body, 'base64').toString()).toContain(',simulated');
    ok(await same('PUT', api('/weather/rules'), { frostWarning: false }));
    // What each would have put on the broker: the same weather, the same hold.
    expect(skies.portable).toEqual(skies.hub);
    expect(skies.hub.at(-1)?.source).toBe('simulated');
    expect(orders.portable).toEqual(orders.hub);
    expect(orders.hub.map((order) => order.action)).toEqual(['outdoorHold']);
  });

  it('writes: config, a plant, a new chapter, the place, a note, a photo, delete and restore', async () => {
    clock += 60_000;
    const rules = defaultRules();
    const config = await same('PUT', api('/config'), {
      ...rules,
      watering: rules.watering.map((r) => (r.zone === 'basil_01' ? { ...r, enabled: true } : r)),
    });
    ok(config);
    expect(published.portable).toEqual(published.hub);
    ok(await same('PATCH', api('/plants/basil_01'), { name: 'Albahaca de la ventana' }));
    ok(
      await same('POST', api('/plants/tomato_01/chapter'), {
        name: 'Tomate nuevo',
        sownAt: '2026-09-01',
      }),
    );
    ok(await same('GET', api('/plants/tomato_01/chapters')));
    ok(await same('PUT', api('/settings/location'), { lat: 40.4, lng: -3.69 }));
    expect(published.portable).toEqual(published.hub);
    ok(
      await same('POST', api('/journal/notes'), {
        id: NOTE,
        zone: 'basil_01',
        text: 'Hojas nuevas',
        tags: [],
        createdAt: clock,
      }),
    );
    const jpeg = new Uint8Array(
      await sharp({ create: { width: 8, height: 6, channels: 3, background: '#6a8f5a' } })
        .jpeg()
        .toBuffer(),
    );
    const query = `zone=basil_01&createdAt=${clock.toString()}&width=8&height=6&caption=Hoja`;
    ok(await same('PUT', api(`/journal/${PHOTO}/photo?${query}`), jpeg, 'image/jpeg'));
    const photo = await same('GET', api(`/journal/${PHOTO}/photo`));
    expect(photo).toMatchObject({ status: 200, type: 'image/jpeg' });
    ok(await same('GET', api('/journal/basil_01')));
    ok(await same('GET', api('/storage')));
    ok(await same('DELETE', api(`/journal/${NOTE}`)));
    ok(await same('POST', api(`/journal/${NOTE}/restore`)));
    ok(await same('GET', api('/journal/basil_01')));
    ok(await same('GET', api('/config')));
    ok(await same('GET', api('/plants')));
    ok(await same('GET', api('/settings')));
  });
});
