import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { API_PREFIX, configMessage, GREENHOUSE_ZONES } from '@vitreo/shared';
import { configExample, configV1Example, telemetryExample } from '@vitreo/shared/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BACKUPS_KEPT,
  backupDue,
  backupNow,
  listBackups,
  localDay,
  restoreBackup,
} from './backup.ts';
import { loadConfig } from './config.ts';
import { ConfigOwner, defaultRules } from './configOwner.ts';
import type { Publish } from './configOwner.ts';
import { openDatabase } from './db/open.ts';
import type { NodeHubDatabase as HubDatabase } from './db/open.ts';
import * as t from './db/schema.ts';
import { currentConfig, ensurePlants } from './db/store.ts';
import { archiveOldTelemetry, archiveRejected } from './archive.ts';
import {
  firstTelemetryTs,
  hourOf,
  readHistory,
  readSeries,
  RAW_DAYS,
  summariseHours,
} from './history.ts';
import { handleMessage } from './ingest.ts';
import { buildServer } from './server.ts';

const DEVICE = 'sim';
const NOW = 1_790_780_400_000;
const T0 = telemetryExample.ts;

const ownerOptions = (publish: Publish) => ({
  timeZone: 'Europe/Madrid',
  location: () => ({ lat: 40.4168, lng: -3.7038 }),
  publish,
});

const telemetryAt = (ts: number, overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ ...telemetryExample, ts, ...overrides });

describe('hub config', () => {
  it('keeps every mode on its own database, port and MQTT session', () => {
    const service = loadConfig({ HUB_MODE: 'service', HUB_DEVICE_ID: 'sim' });
    const dev = loadConfig({ HUB_MODE: 'dev', HUB_DEVICE_ID: 'sim' });
    const test = loadConfig({ HUB_MODE: 'test', HUB_DEVICE_ID: 'e2e' });
    expect(service.database).toBe('/var/lib/vitreo/hub.sqlite');
    expect(dev.database).toMatch(/data[\\/]hub-dev[\\/]hub-dev\.sqlite$/);
    expect(test.database).toBe(':memory:');
    // The dev hub never owns the real greenhouse, so it never publishes its config.
    expect(dev.deviceId).toBe('dev');
    expect(new Set([service.port, dev.port]).size).toBe(2);
    expect(new Set([service, dev, test].map((c) => c.mqtt.clientId)).size).toBe(3);
  });

  it('lets only the real hubs call AEMET: the e2e hubs never do, even with a key (A10)', () => {
    const env = { AEMET_API_KEY: 'key', AEMET_ESTACION: '' };
    expect(loadConfig({ ...env, HUB_MODE: 'service' }).aemet).toMatchObject({
      key: 'key',
      municipality: '28079',
      station: null,
    });
    expect(loadConfig({ ...env, HUB_MODE: 'test' }).aemet.key).toBeNull();
    expect(loadConfig({ HUB_MODE: 'service' }).aemet.key).toBeNull();
  });

  it('defaults to this computer only', () => {
    expect(loadConfig({}).host).toBe('127.0.0.1');
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ HUB_PORT: 'eighty' })).toThrow();
  });
});

describe('the hub database', () => {
  let db: HubDatabase;
  let owner: ConfigOwner;
  const published: unknown[] = [];

  beforeEach(() => {
    db = openDatabase(':memory:');
    published.length = 0;
    owner = new ConfigOwner(
      db,
      DEVICE,
      ownerOptions((config) => published.push(config)),
    );
    ensurePlants(db, DEVICE, NOW);
  });
  afterEach(() => {
    db.$client.close();
  });

  const receive = (channel: string, payload: string, device = DEVICE) =>
    handleMessage(db, owner, DEVICE, `vitreo/${device}/${channel}`, payload, NOW);

  it('stores telemetry with its pots, and a repeat only once', () => {
    expect(receive('telemetry', telemetryAt(T0))).toBe(T0);
    receive('telemetry', telemetryAt(T0));
    expect(db.select().from(t.telemetry).all()).toHaveLength(1);
    expect(db.select().from(t.soil).all()).toHaveLength(2);
  });

  it('a different reading within the same second replaces the earlier one', () => {
    receive('telemetry', telemetryAt(T0));
    receive('telemetry', telemetryAt(T0, { tank: { level: 0.15 } }));
    const rows = db.select().from(t.telemetry).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tank).toBe(0.15);
    expect(db.select().from(t.soil).all()).toHaveLength(2);
  });

  it('keeps a broken sensor as null, never a number', () => {
    receive(
      'telemetry',
      telemetryAt(T0, { soil: [{ id: 'basil_01', moisture: null }], air: { temp: null, rh: 60 } }),
    );
    expect(db.select().from(t.soil).get()?.moisture).toBeNull();
    expect(db.select().from(t.telemetry).get()?.airTemp).toBeNull();
  });

  it('stores what a newer device sends, unknown fields kept in the raw message', () => {
    const event = {
      v: 1,
      ts: T0,
      type: 'watering.started',
      source: 'automation',
      zone: 'basil_01',
      seconds: 5,
      reason: { kind: 'soil', moisture: 0.33, threshold: 0.35, probe: 'capacitive-v2' },
      firmware: '3.1.0',
    };
    receive('event', JSON.stringify(event));
    expect(receive('telemetry', telemetryAt(T0, { co2: 612 }))).toBe(T0);
    expect(db.select().from(t.rejected).all()).toHaveLength(0);
    expect(JSON.parse(db.select().from(t.events).get()?.raw ?? '{}')).toEqual(event);
    expect(db.select().from(t.telemetry).all()).toHaveLength(1);
  });

  it('keeps a known event type that does not validate with the invalid messages', () => {
    receive(
      'event',
      JSON.stringify({
        v: 1,
        ts: T0,
        type: 'watering.started',
        source: 'user',
        zone: 'basil_01',
        seconds: -5,
      }),
    );
    receive('event', JSON.stringify({ v: 1, ts: T0, type: 'filter.clogged', source: 'robot' }));
    expect(db.select().from(t.events).all()).toHaveLength(0);
    expect(db.select().from(t.rejected).all()).toHaveLength(2);
  });

  it('ignores other greenhouses and keeps invalid messages aside', () => {
    receive('telemetry', telemetryAt(T0), 'other');
    receive('telemetry', '{"v":1}');
    receive('event', 'not json');
    expect(db.select().from(t.telemetry).all()).toHaveLength(0);
    expect(db.select().from(t.rejected).all()).toHaveLength(2);
  });

  it('archives invalid messages after a day, by month, instead of trimming them (A12)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vitreo-rejected-'));
    try {
      receive('telemetry', '{"v":1,"air":{"temp":999}}');
      const nowS = Math.floor(NOW / 1000);
      expect(archiveRejected(db, dir, nowS)).toBe(0);
      expect(archiveRejected(db, dir, nowS + 2 * 86_400)).toBe(1);
      expect(db.select().from(t.rejected).all()).toHaveLength(0);
      const [file] = readdirSync(dir);
      expect(file).toMatch(/^rejected-\d{4}-\d{2}\.ndjson\.gz$/);
      const line = JSON.parse(
        gunzipSync(readFileSync(path.join(dir, file ?? '')))
          .toString()
          .trim(),
      ) as Record<string, unknown>;
      expect(line).toMatchObject({
        receivedAt: NOW,
        topic: `vitreo/${DEVICE}/telemetry`,
        payload: '{"v":1,"air":{"temp":999}}',
      });
      expect(typeof line['error']).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records only changes of the retained status', () => {
    const online = JSON.stringify({ v: 1, state: 'online' });
    receive('status', online);
    receive('status', online);
    receive('status', JSON.stringify({ v: 1, state: 'offline' }));
    expect(
      db
        .select()
        .from(t.statusChanges)
        .all()
        .map((row) => row.state),
    ).toEqual(['online', 'offline']);
  });

  it('starts with every automation off, with each species proposal (v2)', () => {
    const initial = owner.announce(NOW);
    expect(initial).toMatchObject({
      v: 2,
      rev: 1,
      tz: 'CET-1CEST,M3.5.0,M10.5.0/3',
      // Rounded on the way to the device (D79, D89).
      location: { lat: 40.42, lng: -3.7 },
    });
    expect(initial.watering.every((rule) => !rule.enabled)).toBe(true);
    expect(initial.light.enabled || initial.ventilation.enabled).toBe(false);
    expect(initial.watering.map((rule) => rule.zone)).toEqual(GREENHOUSE_ZONES.map((z) => z.id));
    expect(initial.watering.find((rule) => rule.zone === 'tomato_01')).toMatchObject({
      threshold: 0.4,
      seconds: 8,
      maxPerDay: 3,
      cooldownMinutes: 60,
    });
    expect(published).toHaveLength(1);
  });

  it('adopts a newer config found retained, never an older one', () => {
    owner.announce(NOW);
    receive('config', JSON.stringify(configExample)); // rev 3 > 1
    expect(owner.current(NOW).rev).toBe(3);
    receive('config', JSON.stringify({ ...configExample, rev: 2 }));
    expect(owner.current(NOW).rev).toBe(3);
  });

  it('replaces a stored v1 config with a v2 revision', () => {
    db.insert(t.configRevisions)
      .values({
        device: DEVICE,
        rev: 4,
        ts: 1,
        origin: 'default',
        raw: JSON.stringify(configV1Example),
      })
      .run();
    const upgraded = owner.announce(NOW);
    expect(upgraded).toMatchObject({ v: 2, rev: 5 });
    expect(published.at(-1)).toEqual(upgraded);
  });

  it('numbers every new config, adds time zone and location, and publishes it', () => {
    owner.announce(NOW);
    const rules = defaultRules();
    const next = owner.update(
      {
        ...rules,
        light: { enabled: true, mode: 'sun', sunriseOffset: 0, sunsetOffset: 120, belowLux: null },
      },
      NOW,
    );
    expect(next).toMatchObject({ rev: 2, light: { mode: 'sun' }, location: { lat: 40.42 } });
    expect(configMessage.safeParse(next).success).toBe(true);
    expect(published.at(-1)).toEqual(next);
  });

  it('records which revision the device applied, and which it refused', () => {
    owner.announce(NOW);
    owner.update(defaultRules(), NOW);
    const event = (body: object) => JSON.stringify({ v: 1, ts: T0, ...body });
    receive('event', event({ type: 'config.applied', rev: 1 }));
    expect(currentConfig(db, DEVICE)).toMatchObject({ appliedRev: 1, rejected: null });
    receive('event', event({ type: 'config.rejected', rev: 2, reason: 'invalid', keeps: 1 }));
    expect(currentConfig(db, DEVICE)).toMatchObject({
      appliedRev: 1,
      rejected: { rev: 2, reason: 'invalid' },
    });
    receive('event', event({ type: 'config.applied', rev: 2 }));
    expect(currentConfig(db, DEVICE)).toMatchObject({ appliedRev: 2, rejected: null });
  });

  it('summarises hours without inventing readings', () => {
    const hour = hourOf(T0);
    receive('telemetry', telemetryAt(hour + 60, { air: { temp: 20, rh: 50 } }));
    receive('telemetry', telemetryAt(hour + 120, { air: { temp: 24, rh: null } }));
    summariseHours(db, DEVICE, [hour, hour + 3600]);
    const rows = db.select().from(t.hourly).all();
    const temp = rows.find((row) => row.metric === 'air_temp');
    expect(temp).toMatchObject({ count: 2, mean: 22, min: 20, max: 24 });
    expect(rows.find((row) => row.metric === 'air_rh')).toMatchObject({ count: 1, mean: 50 });
    expect(rows.find((row) => row.metric === 'soil' && row.zone === 'basil_01')?.count).toBe(2);
    // The empty hour has no rows: a gap, not zeros.
    expect(rows.every((row) => row.hour === hour)).toBe(true);
  });

  it('marks gaps in the history instead of joining across them', () => {
    receive('telemetry', telemetryAt(T0));
    receive('telemetry', telemetryAt(T0 + 60));
    receive('telemetry', telemetryAt(T0 + 3 * 3600)); // the PC was off
    const { step, series } = readSeries(db, DEVICE, T0 - 10, T0 + 4 * 3600);
    expect(step).toBe('raw');
    expect(series['air_temp']?.map((point) => point.value)).toEqual([22.4, 22.4, null, 22.4]);
    expect(series['soil:basil_01']).toHaveLength(4);
  });

  it('archives raw readings older than 30 days by month, once, and keeps the summaries', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vitreo-archive-'));
    try {
      const old = T0 - (RAW_DAYS + 2) * 86_400;
      receive('telemetry', telemetryAt(old));
      receive('telemetry', telemetryAt(T0));
      summariseHours(db, DEVICE, [hourOf(old)]);
      expect(archiveOldTelemetry(db, DEVICE, dir, T0)).toBe(1);
      expect(archiveOldTelemetry(db, DEVICE, dir, T0)).toBe(0);
      expect(
        db
          .select()
          .from(t.telemetry)
          .all()
          .map((row) => row.ts),
      ).toEqual([T0]);
      expect(db.select().from(t.soil).all()).toHaveLength(2);
      expect(db.select().from(t.hourly).all().length).toBeGreaterThan(0);
      const [file] = readdirSync(dir);
      expect(file).toMatch(/^telemetry-sim-\d{4}-\d{2}\.ndjson\.gz$/);
      const lines = gunzipSync(readFileSync(path.join(dir, file ?? ''))).toString();
      // The message as it came, and when it reached the hub (A12).
      expect(JSON.parse(lines.trim())).toEqual({
        receivedAt: NOW,
        message: JSON.parse(telemetryAt(old)) as unknown,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('backups', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'vitreo-backup-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is due once a day from 03:00 local time', () => {
    const madrid = 'Europe/Madrid';
    expect(localDay(new Date('2026-10-08T00:30:00Z'), madrid)).toEqual({
      day: '2026-10-08',
      hour: 2,
    });
    expect(backupDue(dir, new Date('2026-10-08T00:30:00Z'), madrid)).toBeNull();
    expect(backupDue(dir, new Date('2026-10-08T09:00:00Z'), madrid)).toBe('2026-10-08');
    writeFileSync(path.join(dir, 'hub-2026-10-08.sqlite'), '');
    expect(backupDue(dir, new Date('2026-10-08T21:00:00Z'), madrid)).toBeNull();
  });

  it('keeps seven, and restores one over a stopped hub', () => {
    const live = path.join(dir, 'live', 'hub.sqlite');
    let db = openDatabase(live);
    const owner = new ConfigOwner(
      db,
      DEVICE,
      ownerOptions(() => undefined),
    );
    handleMessage(db, owner, DEVICE, 'vitreo/sim/telemetry', telemetryAt(T0), NOW);
    for (let day = 1; day <= 9; day++) backupNow(db, dir, `2026-10-0${day.toString()}`);
    expect(listBackups(dir).map((b) => b.day)).toHaveLength(BACKUPS_KEPT);
    expect(listBackups(dir)[0]?.day).toBe('2026-10-09');

    // Later data, then a restore of the backup: the later data is gone.
    handleMessage(db, owner, DEVICE, 'vitreo/sim/telemetry', telemetryAt(T0 + 60), NOW);
    const backup = listBackups(dir)[0]?.file ?? '';
    // While the hub holds the database, a restore is refused.
    expect(() => restoreBackup(backup, live, dir)).toThrow(/locked/);
    db.$client.close();

    const replaced = restoreBackup(backup, live, dir);
    expect(replaced).toMatch(/replaced-.*\.sqlite$/);
    db = openDatabase(live);
    expect(
      db
        .select()
        .from(t.telemetry)
        .all()
        .map((row) => row.ts),
    ).toEqual([T0]);
    // A second hub cannot open the same file while this one runs.
    expect(() => openDatabase(live)).toThrow(/locked/);
    db.$client.close();
  }, 20_000);

  it('refuses a file that is not a hub database', () => {
    const bad = path.join(dir, 'bad.sqlite');
    writeFileSync(bad, 'not sqlite');
    expect(() => restoreBackup(bad, path.join(dir, 'live.sqlite'), dir)).toThrow();
  });
});

describe('the hub API', () => {
  let db: HubDatabase;
  const api = () =>
    buildServer(
      {
        db,
        owner: new ConfigOwner(
          db,
          DEVICE,
          ownerOptions(() => undefined),
        ),
        device: DEVICE,
        timeZone: 'Europe/Madrid',
        seedLocation: { lat: 40.4168, lng: -3.7038 },
        startedAt: NOW,
        mqttConnected: () => true,
        now: () => NOW,
      },
      { logLevel: 'silent' },
    );

  beforeEach(() => {
    db = openDatabase(':memory:');
    ensurePlants(db, DEVICE, NOW);
  });
  afterEach(() => {
    db.$client.close();
  });

  it('says it is up, whose it is and when it last heard', async () => {
    const server = api();
    const response = await server.inject({ url: `${API_PREFIX}/health` });
    expect(response.json()).toEqual({
      status: 'ok',
      device: DEVICE,
      since: NOW,
      mqtt: true,
      lastTelemetry: null,
      firstTelemetry: null,
    });
    await server.close();
  });

  it('renames a plant without touching its zone id', async () => {
    const server = api();
    const plants = (await server.inject({ url: `${API_PREFIX}/plants` })).json<unknown[]>();
    expect(plants).toHaveLength(GREENHOUSE_ZONES.length);
    const renamed = await server.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/plants/basil_01`,
      payload: { name: '  Albahaca de Ana ', sownAt: '2026-04-01' },
    });
    expect(renamed.json()).toEqual({
      zone: 'basil_01',
      kind: 'basil',
      name: 'Albahaca de Ana',
      sownAt: '2026-04-01',
      // Renaming is not a new plant: still the first one (A12).
      since: null,
    });
    const back = await server.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/plants/basil_01`,
      payload: { name: null },
    });
    expect(back.json()).toMatchObject({ name: null, sownAt: '2026-04-01' });
    expect(
      (await server.inject({ method: 'PATCH', url: `${API_PREFIX}/plants/nope_01`, payload: {} }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await server.inject({
          method: 'PATCH',
          url: `${API_PREFIX}/plants/basil_01`,
          payload: { name: '' },
        })
      ).statusCode,
    ).toBe(400);
    await server.close();
  });

  it('keeps the location rounded to about a kilometre', async () => {
    const server = api();
    const first = (await server.inject({ url: `${API_PREFIX}/settings` })).json<unknown>();
    expect(first).toEqual({ location: { lat: 40.42, lng: -3.7 }, timeZone: 'Europe/Madrid' });
    const moved = await server.inject({
      method: 'PUT',
      url: `${API_PREFIX}/settings/location`,
      payload: { lat: 41.38879, lng: 2.15899 },
    });
    expect(moved.json()).toMatchObject({ location: { lat: 41.39, lng: 2.16 } });
    expect(
      (
        await server.inject({
          method: 'PUT',
          url: `${API_PREFIX}/settings/location`,
          payload: { lat: 120, lng: 0 },
        })
      ).statusCode,
    ).toBe(400);
    await server.close();
  });

  it('serves the config it owns and history ranges', async () => {
    const server = api();
    const config = (await server.inject({ url: `${API_PREFIX}/config` })).json<unknown>();
    expect(config).toMatchObject({ config: { rev: 1 }, appliedRev: null });
    const history = await server.inject({
      url: `${API_PREFIX}/telemetry?from=${(T0 - 3600).toString()}&to=${T0.toString()}`,
    });
    expect(history.json()).toMatchObject({ step: 'raw', series: {} });
    expect((await server.inject({ url: `${API_PREFIX}/telemetry?from=5&to=1` })).statusCode).toBe(
      400,
    );
    await server.close();
  });

  it('exports raw readings as CSV, with no reading left empty', async () => {
    const owner = new ConfigOwner(
      db,
      DEVICE,
      ownerOptions(() => undefined),
    );
    handleMessage(db, owner, DEVICE, 'vitreo/sim/telemetry', telemetryAt(T0), NOW);
    handleMessage(
      db,
      owner,
      DEVICE,
      'vitreo/sim/telemetry',
      telemetryAt(T0 + 60, { soil: [{ id: 'basil_01', moisture: null }] }),
      NOW,
    );
    handleMessage(
      db,
      owner,
      DEVICE,
      'vitreo/sim/event',
      JSON.stringify({
        v: 1,
        ts: T0 + 30,
        type: 'watering.started',
        zone: 'basil_01',
        seconds: 5,
        source: 'user',
        requestId: 'r1',
      }),
      NOW,
    );
    const server = api();
    const query = `from=${(T0 - 1).toString()}&to=${(T0 + 120).toString()}`;
    const csv = await server.inject({ url: `${API_PREFIX}/telemetry.csv?${query}` });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/vitreo-sim-\d{4}-\d{2}-\d{2}/);
    const [header, first, second] = csv.body.trim().split('\n');
    expect(header).toBe(
      'time_utc,ts,air_temp_c,air_rh,lux,tank,pump,grow_light,fan,vent,soil_basil_01,soil_parsley_01',
    );
    expect(first?.split(',').slice(-2)).toEqual(['0.42', '0.58']);
    expect(second?.split(',').slice(-2)).toEqual(['', '']);
    const events = await server.inject({ url: `${API_PREFIX}/events?${query}` });
    expect(events.json()).toMatchObject([{ type: 'watering.started', source: 'user' }]);
    await server.close();
  });
});

describe('history in buckets (A5)', () => {
  let db: HubDatabase;
  let owner: ConfigOwner;
  beforeEach(() => {
    db = openDatabase(':memory:');
    owner = new ConfigOwner(
      db,
      DEVICE,
      ownerOptions(() => undefined),
    );
  });
  afterEach(() => {
    db.$client.close();
  });
  const at = (ts: number, basil: number | null, extra: Record<string, unknown> = {}) =>
    handleMessage(
      db,
      owner,
      DEVICE,
      'vitreo/sim/telemetry',
      telemetryAt(ts, { soil: [{ id: 'basil_01', moisture: basil }], ...extra }),
      NOW,
    );
  const H = hourOf(T0);

  it('averages each bucket, and leaves an empty bucket as a gap', () => {
    at(H + 10, 0.4);
    at(H + 70, 0.6, { actuators: { pump: true, growLight: false, fan: false, vent: 0.5 } });
    // Nothing between H+300 and H+600: a gap.
    at(H + 610, null);
    const history = readHistory(db, DEVICE, { from: H, to: H + 900, step: 300 });
    expect(history.ts).toEqual([H, H + 300, H + 600]);
    expect(history.n).toEqual([2, 0, 1]);
    expect(history.soil['basil_01']).toEqual([0.5, null, null]);
    expect(history.pump).toEqual([0.5, null, 0]);
    expect(history.vent[0]).toBeCloseTo(0.25);
    expect(history.airTemp[1]).toBeNull();
  });

  it('uses the hourly summaries for wide buckets, weighted by readings', () => {
    // Buckets are aligned to their step (UTC).
    const B = Math.floor(H / 7200) * 7200;
    at(B + 10, 0.2);
    at(B + 20, 0.4);
    at(B + 3600 + 10, 0.8);
    summariseHours(db, DEVICE, [B, B + 3600]);
    const history = readHistory(db, DEVICE, { from: B, to: B + 4 * 3600, step: 2 * 3600 });
    expect(history.n).toEqual([3, 0]);
    expect(history.soil['basil_01']?.[0]).toBeCloseTo((0.2 + 0.4 + 0.8) / 3);
    expect(history.soil['basil_01']?.[1]).toBeNull();
  });

  it('gives only the pots asked for, and says how far back it goes', () => {
    at(H + 10, 0.4);
    const history = readHistory(db, DEVICE, {
      from: H,
      to: H + 600,
      step: 300,
      zones: ['tomato_01'],
    });
    expect(Object.keys(history.soil)).toEqual(['tomato_01']);
    expect(history.soil['tomato_01']).toEqual([null, null]);
    expect(firstTelemetryTs(db, DEVICE)).toBe(H + 10);
  });

  it('seeds history only on the e2e hub', async () => {
    const context = {
      db,
      owner,
      device: DEVICE,
      timeZone: 'Europe/Madrid',
      seedLocation: { lat: 40.42, lng: -3.7 },
      startedAt: NOW,
      mqttConnected: () => true,
    };
    const service = buildServer(context, { logLevel: 'silent' });
    const refused = await service.inject({
      method: 'POST',
      url: `${API_PREFIX}/test/messages`,
      payload: { messages: [] },
    });
    expect(refused.statusCode).toBe(404);
    await service.close();

    const testing = buildServer({ ...context, testing: true }, { logLevel: 'silent' });
    const seeded = await testing.inject({
      method: 'POST',
      url: `${API_PREFIX}/test/messages`,
      payload: { messages: [{ channel: 'telemetry', message: { ...telemetryExample, ts: H } }] },
    });
    expect(seeded.json()).toEqual({ stored: 1 });
    const history = await testing.inject({
      url: `${API_PREFIX}/history?from=${H.toString()}&to=${(H + 3600).toString()}&step=3600&zones=basil_01`,
    });
    expect(history.json()).toMatchObject({ n: [1], soil: { basil_01: [0.42] } });
    const tooMany = await testing.inject({
      url: `${API_PREFIX}/history?from=0&to=${(3600 * 24 * 30).toString()}&step=60`,
    });
    expect(tooMany.statusCode).toBe(400);
    await testing.inject({ method: 'POST', url: `${API_PREFIX}/test/reset` });
    expect(firstTelemetryTs(db, DEVICE)).toBeNull();
    await testing.close();
  });
});
