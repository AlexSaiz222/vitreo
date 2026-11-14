import { readFileSync } from 'node:fs';
import path from 'node:path';

import { API_PREFIX, weatherHistory, weatherState } from '@vitreo/shared';
import type {
  CommandMessage,
  TelemetryMessage,
  WeatherMessage,
  WeatherState,
} from '@vitreo/shared';
import { telemetryExample } from '@vitreo/shared/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AlertEngine } from '../alerts.ts';
import { ConfigOwner } from '../configOwner.ts';
import { openDatabase } from '../db/open.ts';
import type { NodeHubDatabase as HubDatabase } from '../db/open.ts';
import { ensurePlants, storeEvent, storeTelemetry } from '../db/store.ts';
import { PushSender } from '../push.ts';
import { buildServer } from '../server.ts';
import { parseForecast } from './aemet.ts';
import { WeatherRuleEngine } from './rules.ts';
import { tonightMin, WeatherService } from './service.ts';

/** The hub's weather (A10, D97): polling, keeping, publishing, and its two rules. */

const DEVICE = 'sim';
const MIN = 60_000;
// 17:10 local time in Madrid (CEST) on the fixtures' day: their 15:00Z observation is fresh.
const T0 = Date.parse('2026-10-13T15:10:00Z');
const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');
const BASE = 'https://aemet.test/opendata';

let db: HubDatabase;
let push: PushSender;
let published: (WeatherMessage | null)[];
let requests: string[];
let answer: 'ok' | 'down' | 'limit';

/** A fake AEMET serving the fixtures, or failing as told. */
const fakeFetch: typeof fetch = (input) => {
  const url = input instanceof Request ? input.url : input.toString();
  requests.push(url);
  if (answer === 'down') return Promise.reject(new TypeError('fetch failed'));
  if (answer === 'limit') return Promise.resolve(Response.json({ estado: 429 }, { status: 429 }));
  if (url.startsWith(`${BASE}/api`)) {
    return Promise.resolve(
      Response.json({ estado: 200, datos: url.replace(`${BASE}/api`, 'https://aemet.test/d') }),
    );
  }
  const name = url.includes('/todas')
    ? 'todas.json'
    : url.includes('/estacion/')
      ? 'observacion-3195.json'
      : 'horaria-28079.json';
  return Promise.resolve(
    new Response(Buffer.from(fixture(name), 'latin1'), {
      headers: { 'content-type': 'text/plain;charset=ISO-8859-15' },
    }),
  );
};

function service(key: string | null = 'k') {
  return new WeatherService(db, DEVICE, {
    aemet: { key, municipality: '28079', station: null, url: BASE },
    timeZone: 'Europe/Madrid',
    location: () => ({ lat: 40.42, lng: -3.7 }),
    publish: (message) => published.push(message),
    log: () => undefined,
    fetch: fakeFetch,
  });
}

beforeEach(() => {
  db = openDatabase(':memory:');
  ensurePlants(db, DEVICE, T0);
  push = new PushSender(db, DEVICE, { keys: null, dryRun: true }, () => undefined);
  push.save(
    { endpoint: 'https://push.example/phone', keys: { p256dh: 'k', auth: 'a' } },
    { types: ['safety', 'frost_forecast'] },
    T0,
  );
  // A browser that wants only the limits that actually trigger.
  push.save(
    { endpoint: 'https://push.example/tablet', keys: { p256dh: 'k', auth: 'a' } },
    { types: ['safety'] },
    T0,
  );
  published = [];
  requests = [];
  answer = 'ok';
});
afterEach(() => {
  db.$client.close();
});

describe('the weather service', () => {
  it('without a key fetches nothing, clears what an old key left and says why', () => {
    const weather = service(null);
    weather.start();
    expect(published).toEqual([null]);
    expect(requests).toEqual([]);
    expect(weather.state(T0)).toMatchObject({ status: 'no-key', weather: null });
  });

  it('chooses the nearest station once, then publishes the observation and this hour', async () => {
    const weather = service();
    await weather.tick(T0);
    const message = published.at(-1);
    expect(message?.observation).toMatchObject({
      station: { id: '3195' },
      temp: 19.1,
      precip: 0.4,
    });
    // 17:00 local: "Cubierto" at 17 in the fixture.
    expect(message?.forecast).toMatchObject({ sky: '16', skyText: 'Cubierto', temp: 17 });
    expect(weather.state(T0)).toMatchObject({ status: 'ok', error: null, lastSuccessAt: T0 });
    expect(requests.filter((url) => url.includes('/todas'))).toHaveLength(2);
    // The next look does not choose again, and asks only what is due.
    requests = [];
    await weather.tick(T0 + 11 * MIN);
    expect(requests.some((url) => url.includes('/todas'))).toBe(false);
    expect(requests.filter((url) => url.startsWith(`${BASE}/api`))).toEqual([
      `${BASE}/api/observacion/convencional/datos/estacion/3195`,
    ]);
  });

  it('keeps the history next to the telemetry, and survives a restart', async () => {
    await service().tick(T0);
    const again = service();
    const at = Date.parse('2026-10-13T15:00:00Z') / 1000;
    expect(again.message(T0)?.observation?.at).toBe(at);
    expect(again.message(T0)?.forecast?.sky).toBe('16');
    expect(again.history(at - 3600, at + 3600)).toEqual([
      expect.objectContaining({ at, station: '3195', temp: 19.1, precip: 0.4 }),
    ]);
    // Only within the range asked for.
    expect(again.history(at + 1, at + 3600)).toEqual([]);
    // As CSV for the greenhouse sheet (A11), with AEMET on every row.
    const csv = again.historyCsv(at - 3600, at + 3600).split('\n');
    expect(csv[0]).toBe('time_utc,ts,station,temp_c,rh,wind_ms,gust_ms,precip_mm,source');
    expect(csv[1]).toMatch(/^2026-10-13T15:00:00\.000Z,\d+,3195,19\.1,.*,0\.4,AEMET$/);
  });

  it('when AEMET is down keeps what it had, with its age, and tries again later', async () => {
    const weather = service();
    await weather.tick(T0);
    answer = 'down';
    const later = T0 + 30 * MIN;
    await weather.tick(later);
    const state = weather.state(later);
    expect(state).toMatchObject({ status: 'failing', error: 'unavailable', failingSince: later });
    // The same observation, republished with the hub's new time: its age shows.
    expect(published.at(-1)).toMatchObject({
      ts: later / 1000,
      observation: { at: Date.parse('2026-10-13T15:00:00Z') / 1000 },
    });
    requests = [];
    await weather.tick(later + 2 * MIN);
    expect(requests).toEqual([]);
    answer = 'ok';
    await weather.tick(later + 5 * MIN);
    expect(weather.state(later + 5 * MIN)).toMatchObject({ status: 'ok', error: null });
  });

  it('waits a quarter of an hour when AEMET says too many requests', async () => {
    const weather = service();
    answer = 'limit';
    await weather.tick(T0);
    expect(weather.state(T0)).toMatchObject({ status: 'failing', error: 'limit' });
    requests = [];
    await weather.tick(T0 + 10 * MIN);
    expect(requests).toEqual([]);
    await weather.tick(T0 + 15 * MIN);
    expect(requests.length).toBeGreaterThan(0);
  });

  it('finds tonight’s lowest temperature and its hour', () => {
    const { points } = parseForecast(JSON.parse(fixture('horaria-28079.json')), 'Europe/Madrid');
    // 20:00 local on the 13th: the coldest is 1 °C at 05:00 on the 14th (03:00Z).
    const evening = Date.parse('2026-10-13T18:00:00Z') / 1000;
    expect(tonightMin(points, evening, 'Europe/Madrid')).toEqual({
      min: 1,
      at: Date.parse('2026-10-14T03:00:00Z') / 1000,
    });
    // A forecast that does not reach tomorrow morning says nothing.
    expect(tonightMin(points.slice(0, 12), evening, 'Europe/Madrid')).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────── the rules

type Hold = TelemetryMessage['outdoorHold'];

const reading = (vent: number, ts: number, outdoorHold: Hold = null): TelemetryMessage => ({
  ...(telemetryExample as unknown as TelemetryMessage),
  ts: Math.floor(ts / 1000),
  actuators: { pump: false, growLight: false, fan: false, vent },
  outdoorHold,
});

function live(vent: number, now: number, hold: Hold = null) {
  const message = reading(vent, now - 20_000, hold);
  storeTelemetry(db, DEVICE, message, JSON.stringify(message), now - 20_000);
}

/** The device holding for `cause` until `untilMs`. */
const holding = (cause: 'rain' | 'wind', untilMs: number): Hold => ({
  cause,
  until: Math.floor(untilMs / 1000),
});

/** Weather now: rain (the fixture's 0.4 mm), strong wind or fair. */
function weatherAt(now: number, kind: 'rain' | 'wind' | 'fair'): WeatherMessage {
  const nowS = Math.floor(now / 1000);
  return {
    v: 1,
    ts: nowS,
    source: 'aemet',
    observation: {
      station: { id: '3195', name: 'MADRID, RETIRO' },
      at: nowS - 600,
      temp: 12,
      rh: 80,
      windSpeed: kind === 'wind' ? 6 : 2,
      windGust: kind === 'wind' ? 16 : 5,
      windDir: 230,
      precip: kind === 'rain' ? 0.4 : 0,
      visibility: null,
    },
    forecast: null,
    tonight: null,
  };
}

function rules(weather: (now: number) => WeatherMessage | null, sent: CommandMessage[] = []) {
  return new WeatherRuleEngine(db, DEVICE, {
    weather,
    sendCommand: (command) => sent.push(command),
    push,
    timeZone: 'Europe/Madrid',
    log: () => undefined,
  });
}

const holds = (sent: CommandMessage[]) =>
  sent.map((command) => (command.action === 'outdoorHold' ? command : null));

describe('the outdoor hold', () => {
  it('asks the device to hold the window closed while it rains, saying why', async () => {
    const sent: CommandMessage[] = [];
    let weather = weatherAt(T0, 'rain');
    const engine = rules(() => weather, sent);
    live(1, T0);
    await engine.evaluate(T0);
    expect(holds(sent)).toEqual([
      expect.objectContaining({
        source: 'automation',
        action: 'outdoorHold',
        on: true,
        minutes: 30,
        reason: { kind: 'weather', cause: 'rain', value: 0.4, limit: 0.1, from: 'station' },
      }),
    ]);
    expect(engine.windowState()).toMatchObject({ state: 'asking', cause: 'rain', at: T0 });
    // Not taken up yet: not sent again within the minute.
    await engine.evaluate(T0 + 30_000);
    expect(sent).toHaveLength(1);
    // The device holds, and closed the window itself.
    live(0, T0 + 2 * MIN, holding('rain', T0 + 30 * MIN));
    await engine.evaluate(T0 + 2 * MIN);
    expect(sent).toHaveLength(1);
    expect(engine.windowState()).toMatchObject({ state: 'holding', cause: 'rain' });
    // Fair again: released, once.
    weather = weatherAt(T0 + 5 * MIN, 'fair');
    live(0, T0 + 5 * MIN, holding('rain', T0 + 30 * MIN));
    await engine.evaluate(T0 + 5 * MIN);
    await engine.evaluate(T0 + 5 * MIN + 10_000);
    expect(holds(sent).slice(1)).toEqual([
      expect.objectContaining({ action: 'outdoorHold', on: false }),
    ]);
    expect(engine.windowState()).toMatchObject({ state: 'idle', cause: null });
  });

  it('releases at once when switched off right after holding', async () => {
    const sent: CommandMessage[] = [];
    const engine = rules(() => weatherAt(T0, 'rain'), sent);
    live(0, T0);
    await engine.evaluate(T0);
    live(0, T0 + 10_000, holding('rain', T0 + 30 * MIN));
    engine.setRules({ closeWindow: false }, T0 + 10_000);
    await engine.evaluate(T0 + 10_000);
    expect(holds(sent)).toEqual([
      expect.objectContaining({ on: true }),
      expect.objectContaining({ on: false }),
    ]);
  });

  it('renews the hold while the weather lasts, never re-closing the window itself', async () => {
    const sent: CommandMessage[] = [];
    const engine = rules((now) => weatherAt(now, 'rain'), sent);
    live(0, T0, holding('rain', T0 + 30 * MIN));
    await engine.evaluate(T0);
    expect(sent).toEqual([]);
    // Less than 20 minutes left: renewed.
    live(0, T0 + 11 * MIN, holding('rain', T0 + 30 * MIN));
    await engine.evaluate(T0 + 11 * MIN);
    expect(holds(sent)).toEqual([expect.objectContaining({ on: true, minutes: 30 })]);
    expect(sent.some((command) => command.action === 'vent')).toBe(false);
  });

  it('starts on the forecast for this hour, before the station (1–2 h behind) sees it', async () => {
    const sent: CommandMessage[] = [];
    const turning = (now: number): WeatherMessage => ({
      ...weatherAt(now, 'fair'),
      forecast: {
        municipality: { id: '28079', name: 'Madrid' },
        issuedAt: Math.floor(now / 1000) - 3600,
        hour: Math.floor(now / 1000) - 600,
        sky: '17',
        skyText: 'Nubes altas',
        temp: 12,
        precip: 0,
        snow: 0,
        windSpeed: 9,
        windGust: 16,
      },
    });
    live(1, T0);
    await rules(turning, sent).evaluate(T0);
    const hold = sent[0];
    expect(hold?.action === 'outdoorHold' && hold.on ? hold.reason : null).toEqual({
      kind: 'weather',
      cause: 'wind',
      value: 16,
      limit: 13.9,
      from: 'forecast',
    });
  });

  it('says why in the hold for strong wind: the gust', async () => {
    const sent: CommandMessage[] = [];
    live(0.5, T0);
    await rules(() => weatherAt(T0, 'wind'), sent).evaluate(T0);
    const hold = sent[0];
    expect(hold?.action === 'outdoorHold' && hold.on ? hold.reason : null).toEqual({
      kind: 'weather',
      cause: 'wind',
      value: 16,
      limit: 13.9,
      from: 'station',
    });
  });

  it('reports heat protection holding the window open', async () => {
    live(1, T0, holding('rain', T0 + 30 * MIN));
    const heat = {
      v: 1,
      ts: Math.floor((T0 - 10 * MIN) / 1000),
      type: 'safety.triggered',
      source: 'safety',
      limit: 'over_temperature',
      value: 36,
    } as const;
    storeEvent(db, DEVICE, heat, JSON.stringify(heat), T0 - 10 * MIN);
    const engine = rules(() => weatherAt(T0, 'rain'));
    await engine.evaluate(T0);
    expect(engine.windowState()).toMatchObject({ state: 'held-by-heat', cause: 'rain' });
  });

  it('reports a window the person opened during the hold: theirs', async () => {
    const sent: CommandMessage[] = [];
    live(1, T0, holding('rain', T0 + 30 * MIN));
    const engine = rules(() => weatherAt(T0, 'rain'), sent);
    await engine.evaluate(T0);
    expect(sent).toEqual([]);
    expect(engine.windowState()).toMatchObject({ state: 'left-open' });
  });

  it('never acts on a device it cannot see (old data)', async () => {
    const sent: CommandMessage[] = [];
    const message = reading(1, T0 - 10 * MIN);
    storeTelemetry(db, DEVICE, message, JSON.stringify(message), T0 - 10 * MIN);
    await rules(() => weatherAt(T0, 'rain'), sent).evaluate(T0);
    expect(sent).toEqual([]);
  });

  it('switched off, or without weather, it only releases a hold in force', async () => {
    const sent: CommandMessage[] = [];
    live(1, T0);
    const off = rules(() => weatherAt(T0, 'rain'), sent);
    off.setRules({ closeWindow: false }, T0);
    await off.evaluate(T0);
    await rules(() => weatherAt(T0, 'fair'), sent).evaluate(T0);
    await rules(() => null, sent).evaluate(T0);
    expect(sent).toEqual([]);
    live(0, T0 + MIN, holding('rain', T0 + 30 * MIN));
    await off.evaluate(T0 + MIN);
    expect(holds(sent)).toEqual([expect.objectContaining({ on: false })]);
  });
});

describe('the frost warning', () => {
  const EVENING = Date.parse('2026-10-13T18:30:00Z'); // 20:30 in Madrid
  const frosty = (now: number): WeatherMessage => ({
    ...weatherAt(now, 'fair'),
    tonight: { min: 1, at: Date.parse('2026-10-14T04:00:00Z') / 1000 },
  });

  it('tells once in the evening: "Helada prevista: 1 °C a las 6:00"', async () => {
    const engine = rules(() => frosty(EVENING));
    await engine.evaluate(EVENING);
    await engine.evaluate(EVENING + 10 * MIN);
    expect(push.outbox.map((sent) => sent.message)).toEqual([
      expect.objectContaining({
        title: 'Helada prevista: 1 °C a las 6:00',
        url: '/?open=air',
        critical: false,
      }),
    ]);
    // Its own type: only to the browsers that want frost forecasts.
    expect(push.outbox.map((sent) => sent.endpoint)).toEqual(['https://push.example/phone']);
  });

  it('waits for the evening, and stays quiet when it will not freeze or is switched off', async () => {
    await rules(() => frosty(T0)).evaluate(T0); // 17:10
    const mild = rules(() => ({ ...frosty(EVENING), tonight: { min: 4, at: 0 } }));
    await mild.evaluate(EVENING);
    const off = rules(() => frosty(EVENING));
    off.setRules({ frostWarning: false }, EVENING);
    await off.evaluate(EVENING);
    expect(push.outbox).toEqual([]);
  });

  it('is put away quietly the next day, and the alerts leave it alone meanwhile', async () => {
    const engine = rules(() => frosty(EVENING));
    await engine.evaluate(EVENING);
    const alerts = new AlertEngine(db, DEVICE, push, { timeZone: 'Europe/Madrid', startedAt: T0 });
    live(0, EVENING + MIN);
    await alerts.evaluate({
      now: EVENING + MIN,
      telemetry: reading(0, EVENING),
      lastDataAt: EVENING,
      online: true,
      held: [],
    });
    expect(alerts.list()[0]).toMatchObject({
      title: 'Helada prevista: 1 °C a las 6:00',
      type: 'frost_forecast',
      critical: false,
      resolvedAt: null,
    });
    await engine.evaluate(EVENING + 17 * 60 * MIN);
    expect(alerts.list()[0]?.resolvedAt).not.toBeNull();
    expect(push.outbox).toHaveLength(1);
  });
});

describe('the weather API', () => {
  function server(key: string | null) {
    const weather = service(key);
    const engine = rules((now) => weather.message(now));
    return buildServer({
      db,
      owner: new ConfigOwner(db, DEVICE, {
        timeZone: 'Europe/Madrid',
        location: () => ({ lat: 40.42, lng: -3.7 }),
        publish: () => undefined,
      }),
      device: DEVICE,
      timeZone: 'Europe/Madrid',
      seedLocation: { lat: 40.42, lng: -3.7 },
      startedAt: T0,
      mqttConnected: () => true,
      now: () => T0,
      weather,
      weatherRules: engine,
    });
  }

  it('says there is no key, with both rules on by default', async () => {
    const response = await server(null).inject({ url: `${API_PREFIX}/weather` });
    expect(weatherState.parse(response.json())).toMatchObject({
      status: 'no-key',
      weather: null,
      rules: { closeWindow: true, frostWarning: true },
      window: { state: 'idle' },
    });
  });

  it('switches a rule off and keeps it', async () => {
    const api = server(null);
    const put = await api.inject({
      method: 'PUT',
      url: `${API_PREFIX}/weather/rules`,
      payload: { frostWarning: false },
    });
    expect(put.json()).toEqual({ closeWindow: true, frostWarning: false });
    const state = (await api.inject({ url: `${API_PREFIX}/weather` })).json<WeatherState>();
    expect(state.rules.frostWarning).toBe(false);
    const wrong = await api.inject({
      method: 'PUT',
      url: `${API_PREFIX}/weather/rules`,
      payload: { frostWarning: 'yes' },
    });
    expect(wrong.statusCode).toBe(400);
  });

  it('serves the observed history', async () => {
    const weather = service();
    await weather.tick(T0);
    const at = Date.parse('2026-10-13T15:00:00Z') / 1000;
    const response = await server('k').inject({
      url: `${API_PREFIX}/weather/history?from=${(at - 3600).toString()}&to=${(at + 3600).toString()}`,
    });
    expect(weatherHistory.parse(response.json())).toHaveLength(1);
  });
});
