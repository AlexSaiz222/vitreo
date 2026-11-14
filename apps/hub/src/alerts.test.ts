import { API_PREFIX, PUSH_TYPES } from '@vitreo/shared';
import type { HeldLimit, PushType, TelemetryMessage } from '@vitreo/shared';
import { telemetryExample } from '@vitreo/shared/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AlertEngine, snapshotFrom } from './alerts.ts';
import type { Snapshot } from './alerts.ts';
import { ConfigOwner, defaultRules } from './configOwner.ts';
import { openDatabase } from './db/open.ts';
import type { NodeHubDatabase as HubDatabase } from './db/open.ts';
import { ensurePlants } from './db/store.ts';
import { PushSender } from './push.ts';
import { buildServer } from './server.ts';

/** Warnings and web push (A7, D76, D91), with a fake clock and a fake push service. */

const DEVICE = 'sim';
const MIN = 60_000;
const HOUR = 60 * MIN;
// 12:00 and 01:00 local time in Madrid (CEST).
const NOON = Date.parse('2026-10-08T10:00:00Z');
const NIGHT = Date.parse('2026-10-08T23:00:00Z');
const PHONE = 'https://push.example/phone';

let db: HubDatabase;
let push: PushSender;

function engine(startedAt: number) {
  return new AlertEngine(db, DEVICE, push, { timeZone: 'Europe/Madrid', startedAt });
}

function subscribe(types: readonly PushType[] = PUSH_TYPES, endpoint = PHONE) {
  push.save({ endpoint, keys: { p256dh: 'k', auth: 'a' } }, { types: [...types] }, NOON);
}

const reading = (overrides: Partial<TelemetryMessage> = {}): TelemetryMessage => ({
  ...(telemetryExample as unknown as TelemetryMessage),
  soil: [
    { id: 'basil_01', moisture: 0.6, cal: 1 },
    { id: 'parsley_01', moisture: 0.6, cal: 1 },
    { id: 'lettuce_01', moisture: 0.6, cal: 1 },
    { id: 'strawberry_01', moisture: 0.6, cal: 1 },
    { id: 'chives_01', moisture: 0.6, cal: 1 },
    { id: 'tomato_01', moisture: 0.6, cal: 1 },
  ],
  ...overrides,
});

const at = (
  now: number,
  telemetry: TelemetryMessage,
  extra: Partial<Snapshot> = {},
  held: HeldLimit[] = [],
): Snapshot => ({ now, telemetry, lastDataAt: now - 30_000, online: true, held, ...extra });

const sent = () => push.outbox.map((s) => s.message);

beforeEach(() => {
  db = openDatabase(':memory:');
  ensurePlants(db, DEVICE, NOON);
  push = new PushSender(db, DEVICE, { keys: null, dryRun: true }, () => undefined);
});
afterEach(() => {
  db.$client.close();
});

describe('warnings as notifications', () => {
  it('rings once for an empty tank, even in quiet hours, and says when it is solved', async () => {
    subscribe();
    const alerts = engine(NIGHT - HOUR);
    const empty = reading({ tank: { level: 0.02 } });
    await alerts.evaluate(at(NIGHT, empty));
    await alerts.evaluate(at(NIGHT + 10 * MIN, empty));
    expect(sent()).toEqual([
      expect.objectContaining({
        title: 'Depósito vacío',
        tag: 'tank_empty',
        url: '/?open=tank',
        renotify: true,
        critical: true,
      }),
    ]);
    await alerts.evaluate(at(NIGHT + 20 * MIN, reading({ tank: { level: 0.8 } })));
    expect(sent().at(-1)).toMatchObject({
      title: 'Resuelto: Depósito vacío',
      tag: 'tank_empty',
      // Replaces it without a sound.
      renotify: false,
    });
  });

  it('waits for the morning with a non-critical one, and sends it then if it holds', async () => {
    subscribe();
    const alerts = engine(NIGHT - HOUR);
    const low = reading({ tank: { level: 0.15 } });
    await alerts.evaluate(at(NIGHT, low));
    expect(sent()).toEqual([]);
    const morning = Date.parse('2026-10-09T06:05:00Z'); // 08:05 local
    await alerts.evaluate(at(morning, low));
    expect(sent()).toEqual([
      expect.objectContaining({ title: 'Queda poca agua', critical: false }),
    ]);
    expect(sent()[0]?.body).toBe('El depósito está al 15 %.');
  });

  it('reminds at most every 4 hours while it lasts', async () => {
    subscribe();
    const alerts = engine(NOON - HOUR);
    const empty = reading({ tank: { level: 0.02 } });
    for (let t = NOON; t <= NOON + 5 * HOUR; t += 30 * MIN) await alerts.evaluate(at(t, empty));
    expect(sent()).toHaveLength(2);
    expect(sent()[1]?.body).toMatch(/^Sigue igual\./);
  });

  it('says "no data" after 15 minutes without readings, not after 10', async () => {
    subscribe();
    const alerts = engine(NOON - HOUR);
    const last = NOON;
    await alerts.evaluate(at(last + 10 * MIN, reading(), { lastDataAt: last }));
    expect(sent()).toEqual([]);
    await alerts.evaluate(at(last + 15 * MIN, reading(), { lastDataAt: last }));
    expect(sent()).toEqual([
      expect.objectContaining({ title: 'Sin datos del invernadero', tag: 'no_data' }),
    ]);
    expect(sent()[0]?.body).toBe('No llegan datos desde las 12:00.');
  });

  it('gives the broker time after the hub starts before judging "no data"', async () => {
    subscribe();
    const alerts = engine(NOON);
    await alerts.evaluate(at(NOON + MIN, reading(), { lastDataAt: NOON - 3 * HOUR }));
    expect(sent()).toEqual([]);
  });

  it('a thirsty plant only after hours unwatered, by its name', async () => {
    subscribe();
    const alerts = engine(NOON - HOUR);
    const dry = reading({
      soil: reading().soil.map((s) => (s.id === 'basil_01' ? { ...s, moisture: 0.3 } : s)),
    });
    await alerts.evaluate(at(NOON, dry));
    await alerts.evaluate(at(NOON + 2 * HOUR, dry));
    expect(sent()).toEqual([]);
    await alerts.evaluate(at(NOON + 3 * HOUR, dry));
    expect(sent()).toEqual([
      expect.objectContaining({
        title: 'La albahaca tiene sed',
        url: '/?open=plant:basil_01',
        tag: 'thirsty:basil_01',
      }),
    ]);
  });

  it('a plant is thirsty below its own threshold, the one in config (D100)', async () => {
    subscribe();
    const owner = new ConfigOwner(db, DEVICE, {
      timeZone: 'Europe/Madrid',
      location: () => null,
      publish: () => undefined,
    });
    const rules = defaultRules();
    // Automatic watering stays off: the threshold is the plant's all the same.
    owner.update(
      {
        ...rules,
        watering: rules.watering.map((r) => (r.zone === 'basil_01' ? { ...r, threshold: 0.5 } : r)),
      },
      NOON,
    );
    const snapshot = snapshotFrom(db, DEVICE, NOON);
    expect(snapshot.thresholds?.get('basil_01')).toBe(0.5);
    expect(snapshot.thresholds?.get('parsley_01')).toBe(0.4);

    const alerts = engine(NOON - HOUR);
    const dryish = reading({
      soil: reading().soil.map((s) => (s.id === 'basil_01' ? { ...s, moisture: 0.45 } : s)),
    });
    const { thresholds = new Map<string, number>() } = snapshot;
    await alerts.evaluate(at(NOON, dryish, { thresholds }));
    await alerts.evaluate(at(NOON + 3 * HOUR, dryish, { thresholds }));
    expect(sent()).toEqual([
      expect.objectContaining({
        title: 'La albahaca tiene sed',
        body: 'Lleva más de 3 h por debajo del 50 % sin regar.',
      }),
    ]);
  });

  it('frost is critical and says the temperature', async () => {
    subscribe();
    const alerts = engine(NIGHT - HOUR);
    const cold = reading({ air: { temp: 4.2, rh: 80 } });
    await alerts.evaluate(at(NIGHT, cold, {}, [{ limit: 'frost', value: 4.4 }]));
    expect(sent()).toEqual([
      expect.objectContaining({
        title: 'Ventana cerrada por frío',
        critical: true,
        url: '/?open=air',
      }),
    ]);
    expect(sent()[0]?.body).toMatch(/^4,2 °C en el invernadero/);
  });

  it('a one-off safety limit rings once', async () => {
    subscribe();
    const alerts = engine(NOON - HOUR);
    await alerts.oneOff('pump_max_per_hour', NOON);
    await alerts.oneOff('pump_max_per_hour', NOON + MIN);
    expect(sent()).toEqual([
      expect.objectContaining({ title: 'Límite de seguridad', critical: true }),
    ]);
  });

  it('only to devices that want that type', async () => {
    subscribe(['tank', 'safety'], PHONE);
    subscribe(PUSH_TYPES, 'https://push.example/laptop');
    const alerts = engine(NOON - HOUR);
    const dry = reading({
      soil: reading().soil.map((s) => (s.id === 'basil_01' ? { ...s, moisture: 0.3 } : s)),
    });
    await alerts.evaluate(at(NOON, dry));
    await alerts.evaluate(at(NOON + 3 * HOUR, dry));
    expect(push.outbox.map((s) => s.endpoint)).toEqual(['https://push.example/laptop']);
  });
});

describe('the push API', () => {
  it('keeps subscriptions and sends "Probar aviso" to that device only', async () => {
    const alerts = engine(NOON);
    const server = buildServer(
      {
        db,
        owner: new ConfigOwner(db, DEVICE, {
          timeZone: 'Europe/Madrid',
          location: () => null,
          publish: () => undefined,
        }),
        device: DEVICE,
        timeZone: 'Europe/Madrid',
        seedLocation: { lat: 40.42, lng: -3.7 },
        startedAt: NOON,
        mqttConnected: () => true,
        push,
        alerts,
      },
      { logLevel: 'silent' },
    );
    // Without VAPID keys the hub says why there is no key.
    expect((await server.inject({ url: `${API_PREFIX}/push/key` })).statusCode).toBe(503);
    const saved = await server.inject({
      method: 'PUT',
      url: `${API_PREFIX}/push/subscription`,
      payload: {
        subscription: { endpoint: PHONE, keys: { p256dh: 'k', auth: 'a' } },
        prefs: { types: ['tank'] },
      },
    });
    expect(saved.json()).toEqual({ types: ['tank'] });
    const test = await server.inject({
      method: 'POST',
      url: `${API_PREFIX}/push/test`,
      payload: { endpoint: PHONE },
    });
    expect(test.json()).toEqual({ sent: 1 });
    expect(push.outbox[0]?.message.title).toBe('Prueba de Vitreo');
    await server.inject({
      method: 'DELETE',
      url: `${API_PREFIX}/push/subscription`,
      payload: { endpoint: PHONE },
    });
    const gone = await server.inject({
      method: 'POST',
      url: `${API_PREFIX}/push/test`,
      payload: { endpoint: PHONE },
    });
    expect(gone.statusCode).toBe(404);
    await server.close();
  });
});
