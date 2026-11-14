import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { API_PREFIX } from '@vitreo/shared';
import type { TelemetryMessage } from '@vitreo/shared';
import { telemetryExample } from '@vitreo/shared/fixtures';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';

import { createPortableHub } from './portable.ts';
import type { PortableHub } from './portable.ts';

/**
 * The demo's recorded week goes in all at once (D112): `receiveRecorded`
 * must leave the hub as `receive` does, one message after another; the same
 * rows, the same summaries, the same answers.
 */
const MIGRATIONS = readdirSync(path.resolve(import.meta.dirname, '../drizzle'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(path.resolve(import.meta.dirname, '../drizzle', name), 'utf8'));
const DEVICE = 'demo';
const T0 = telemetryExample.ts;
/** The hubs' clock: each message is heard at its own time. */
let clock = (T0 + 3 * 3600) * 1000;

function reading(i: number, ts: number): TelemetryMessage {
  const base: TelemetryMessage = { ...telemetryExample, v: 1 };
  return {
    ...base,
    ts,
    air: { temp: 18 + (i % 7) / 10, rh: i % 5 === 0 ? null : 60 + (i % 9) },
    light: { lux: (i * 37) % 900 },
    soil: base.soil.map((pot, j) => ({
      ...pot,
      moisture: i % 11 === j ? null : 0.4 + ((i + j) % 20) / 100,
    })),
    actuators: { ...base.actuators, fan: i % 3 === 0, vent: (i % 4) / 4 },
    outdoorHold: i % 13 === 0 ? { cause: 'rain', until: ts + 1800 } : null,
  };
}

/** Two hours of readings every 30 s, one second with two of them, and an event. */
function messages() {
  const out: { topic: string; payload: string; at: number }[] = [];
  for (let i = 0; i < 240; i++) {
    const ts = T0 + i * 30;
    out.push({
      topic: `vitreo/${DEVICE}/telemetry`,
      payload: JSON.stringify(reading(i, ts)),
      at: ts * 1000,
    });
    if (i === 100) {
      // A change right after the periodic one, in the same second: the later one counts.
      out.push({
        topic: `vitreo/${DEVICE}/telemetry`,
        payload: JSON.stringify(reading(i + 1000, ts)),
        at: ts * 1000 + 400,
      });
      out.push({
        topic: `vitreo/${DEVICE}/event`,
        payload: JSON.stringify({
          v: 1,
          ts,
          type: 'watering.started',
          zone: 'basil_01',
          seconds: 3,
          source: 'automation',
        }),
        at: ts * 1000 + 500,
      });
    }
  }
  return out;
}

async function hub(): Promise<PortableHub> {
  return createPortableHub({
    SQL: await initSqlJs(),
    migrations: MIGRATIONS,
    device: DEVICE,
    timeZone: 'Europe/Madrid',
    seedLocation: { lat: 40.42, lng: -3.7 },
    now: () => clock,
    publishConfig: () => undefined,
  });
}

const rows = (h: PortableHub, sql: string) =>
  (h.context.db as unknown as { all: (query: string) => unknown[] }).all(sql);

describe('the recorded week, all at once (D112)', () => {
  it('stores what one message after another stores, and summarises the same', async () => {
    const [one, all] = [await hub(), await hub()];
    for (const m of messages()) {
      clock = m.at;
      one.receive(m.topic, m.payload);
    }
    clock = (T0 + 3 * 3600) * 1000;
    all.receiveRecorded(messages());
    one.summarise();
    all.summarise();
    expect(all.unsummarised()).toBe(0);
    const tables = [
      'SELECT device, ts, received_at, air_temp, air_rh, lux, tank, pump, grow_light, fan, vent, fw, rssi, raw FROM telemetry ORDER BY ts',
      'SELECT s.device, s.ts, s.zone, s.moisture, s.cal, t.ts AS reading FROM soil s JOIN telemetry t ON t.id = s.telemetry_id ORDER BY s.ts, s.zone',
      'SELECT * FROM hourly ORDER BY hour, metric, zone',
      'SELECT device, ts, type, source, zone, raw FROM events ORDER BY ts',
    ];
    for (const sql of tables) expect(rows(all, sql), sql).toEqual(rows(one, sql));
    expect(rows(all, 'SELECT count(*) AS n FROM telemetry')).toEqual([{ n: 240 }]);
    const url = `${API_PREFIX}/history?from=${T0.toString()}&to=${(T0 + 7200).toString()}&step=300`;
    const [a, b] = await Promise.all([
      one.request({ method: 'GET', url }),
      all.request({ method: 'GET', url }),
    ]);
    expect(b).toEqual(a);
  });

  it('summarises the newest hours first, a few at a time', async () => {
    const h = await hub();
    h.receiveRecorded(messages());
    const hours = h.unsummarised();
    expect(hours).toBeGreaterThanOrEqual(2);
    h.summarise(1);
    expect(h.unsummarised()).toBe(hours - 1);
    const done = rows(h, 'SELECT DISTINCT hour FROM hourly') as { hour: number }[];
    expect(done).toHaveLength(1);
    const newest = Math.floor((T0 + 239 * 30) / 3600) * 3600;
    expect(done[0]?.hour).toBe(newest);
  });
});
