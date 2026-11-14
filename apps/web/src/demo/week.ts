import { telemetryMessage } from '@vitreo/shared';
import type { TelemetryMessage } from '@vitreo/shared';
import { simMemory } from '@vitreo/sim-core';
import type { SimMemory } from '@vitreo/sim-core';
import { z } from 'zod';

import type { HourlySummary } from '@vitreo/hub/portable';

import type { Delivery } from './engine.ts';
import { localMidnight } from './outside.ts';

/**
 * The demo's recorded past (D104, D112; a month since D129), as `pnpm
 * demo:week` writes it to apps/web/demo/week.json: what the demo's hub
 * heard over thirty-one simulated days (record.ts). Simulated from end to end,
 * nothing from the home hub: device `demo`, Madrid centre, no notes, no
 * photos.
 *
 * The last week as it was heard, every reading; and the hub's own hourly
 * summaries of every hour: before the last week they are all there is (all
 * a month's charts and rewind ask for, at a 4-hour step), so a visitor's
 * browser does not store a month of readings to show it; within it, they
 * spare the browser summarising a week before its charts are full. Every other message (waterings, orders, the rain
 * holds) for the whole month, and the device's memory every hour of the
 * last two days, to carry on from.
 *
 * Compact and still readable: telemetry column by column (it is most of
 * it), summaries as rows, every other message as it was sent, times from
 * the start. The demo moves it by whole days so that it ends today.
 */

export const WEEK_FILE_VERSION = 2;

const DAY_S = 86_400;
const HOUR_S = 3600;
/** Summaries keep this many decimals: far finer than any sensor reads. */
const SUMMARY_DECIMALS = 4;

const telemetryColumns = z.object({
  /** Seconds since the previous reading (the first: since the start). */
  dt: z.array(z.number().int().nonnegative()),
  temp: z.array(z.number().nullable()),
  rh: z.array(z.number().nullable()),
  lux: z.array(z.number().nullable()),
  tank: z.array(z.number().nullable()),
  soil: z.record(z.string(), z.array(z.number().nullable())),
  /** The soil calibration, the same for every reading of a pot. */
  cal: z.record(z.string(), z.number().int().positive()),
  /** 0/1 */
  pump: z.array(z.number().int()),
  growLight: z.array(z.number().int()),
  fan: z.array(z.number().int()),
  vent: z.array(z.number()),
  /** The hub's outdoor hold in force: [cause, seconds from the start until it ends], or null. */
  hold: z.array(z.tuple([z.enum(['rain', 'snow', 'wind']), z.number().int()]).nullable()),
  fw: z.string(),
  rssi: z.array(z.number().int()),
});

const summary = z.number().nullable();
const hourlyRows = z.object({
  /** What each row measures: `air_temp`… or `soil:<zone>`. */
  metrics: z.array(z.string()),
  /** [hours from the start, index in `metrics`, count, mean, min, max]. */
  rows: z.array(
    z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().positive(),
      summary,
      summary,
      summary,
    ]),
  ),
});

export const demoWeekFile = z.object({
  v: z.literal(WEEK_FILE_VERSION),
  about: z.string(),
  device: z.literal('demo'),
  timeZone: z.string(),
  /** ms: a local midnight; and the end, some days later. */
  startMs: z.number().int(),
  endMs: z.number().int(),
  /** ms: a local midnight; every reading from here on, summaries before. */
  rawFromMs: z.number().int(),
  seed: z.number().int(),
  telemetry: telemetryColumns,
  /** The hub's hourly summaries of every hour: before `rawFromMs`, all there is of it. */
  hourly: hourlyRows,
  /** Every other message the hub heard: [seconds from the start, topic, the message]. */
  messages: z.array(z.tuple([z.number().int().nonnegative(), z.string(), z.unknown()])),
  /** The device's memory (D100), every hour of the end: what the demo carries on from. */
  memory: z.array(simMemory),
});
export type DemoWeekFile = z.infer<typeof demoWeekFile>;

export interface RecordedWeek {
  startMs: number;
  endMs: number;
  rawFromMs: number;
  seed: number;
  timeZone: string;
  messages: Delivery[];
  /** The hub's hourly summaries, of every hour recorded. */
  summaries: HourlySummary[];
  memory: SimMemory[];
}

const isTelemetry = (name: string) => name.endsWith('/telemetry');

const rounded = (value: number | null) =>
  value === null ? null : Number(value.toFixed(SUMMARY_DECIMALS));

/** The hub's summaries of the whole recording, as rows. */
function encodeSummaries(week: RecordedWeek): DemoWeekFile['hourly'] {
  const start = week.startMs / 1000;
  const metrics: string[] = [];
  const index = new Map<string, number>();
  const rows: DemoWeekFile['hourly']['rows'] = [];
  for (const row of week.summaries) {
    if (row.hour < start || row.hour * 1000 >= week.endMs || row.count === 0) continue;
    const key = row.zone ? `${row.metric}:${row.zone}` : row.metric;
    let at = index.get(key);
    if (at === undefined) {
      at = metrics.push(key) - 1;
      index.set(key, at);
    }
    rows.push([
      (row.hour - start) / HOUR_S,
      at,
      row.count,
      rounded(row.mean),
      rounded(row.min),
      rounded(row.max),
    ]);
  }
  return { metrics, rows };
}

/** The summaries back, as the hub keeps them, `shiftMs` later (whole hours). */
export function summariesOf(file: DemoWeekFile, shiftMs = 0): HourlySummary[] {
  const start = (file.startMs + shiftMs) / 1000;
  return file.hourly.rows.map(([hours, at, count, mean, min, max]) => {
    const [metric = '', zone = ''] = (file.hourly.metrics[at] ?? '').split(':');
    return { hour: start + hours * HOUR_S, metric, zone, count, mean, min, max };
  });
}

/** The recording, compacted for the file. */
export function encodeWeek(week: RecordedWeek, about: string): DemoWeekFile {
  const start = week.startMs / 1000;
  const readings = week.messages
    .filter((m) => isTelemetry(m.topic) && m.at >= week.rawFromMs)
    .map((m) => ({ at: m.at, t: telemetryMessage.parse(JSON.parse(m.payload)) }));
  const first = readings[0]?.t;
  if (!first) throw new Error('a week without telemetry');
  const zones = first.soil.map((s) => s.id);
  const columns: DemoWeekFile['telemetry'] = {
    dt: [],
    temp: [],
    rh: [],
    lux: [],
    tank: [],
    soil: Object.fromEntries(zones.map((id) => [id, []])),
    cal: Object.fromEntries(first.soil.map((s) => [s.id, s.cal ?? 1])),
    pump: [],
    growLight: [],
    fan: [],
    vent: [],
    hold: [],
    fw: first.fw,
    rssi: [],
  };
  let previous = start;
  for (const { at, t } of readings) {
    // The device sends the time it reads: the same second it is delivered.
    if (t.ts * 1000 !== at)
      throw new Error(`telemetry at ${at.toString()} says ${t.ts.toString()}`);
    if (t.fw !== columns.fw) throw new Error(`firmware changed to ${t.fw}`);
    const ids = t.soil.map((s) => s.id);
    if (ids.join() !== zones.join()) throw new Error(`pots changed to ${ids.join()}`);
    columns.dt.push(t.ts - previous);
    previous = t.ts;
    columns.temp.push(t.air.temp);
    columns.rh.push(t.air.rh);
    columns.lux.push(t.light.lux);
    columns.tank.push(t.tank.level);
    for (const s of t.soil) {
      if ((s.cal ?? 1) !== columns.cal[s.id]) throw new Error(`calibration of ${s.id} changed`);
      columns.soil[s.id]?.push(s.moisture);
    }
    columns.pump.push(t.actuators.pump ? 1 : 0);
    columns.growLight.push(t.actuators.growLight ? 1 : 0);
    columns.fan.push(t.actuators.fan ? 1 : 0);
    columns.vent.push(t.actuators.vent);
    columns.hold.push(t.outdoorHold ? [t.outdoorHold.cause, t.outdoorHold.until - start] : null);
    columns.rssi.push(t.rssi);
  }
  return {
    v: WEEK_FILE_VERSION,
    about,
    device: 'demo',
    timeZone: week.timeZone,
    startMs: week.startMs,
    endMs: week.endMs,
    rawFromMs: week.rawFromMs,
    seed: week.seed,
    telemetry: columns,
    hourly: encodeSummaries(week),
    messages: week.messages
      .filter((m) => !isTelemetry(m.topic))
      .map((m) => [Math.round((m.at - week.startMs) / 1000), m.topic, JSON.parse(m.payload)]),
    memory: week.memory,
  };
}

/** The readings back, as the device sent them, `shiftMs` later. */
function telemetryOf(file: DemoWeekFile, topicName: string, shiftMs: number): Delivery[] {
  const c = file.telemetry;
  const start = (file.startMs + shiftMs) / 1000;
  const zones = Object.keys(c.soil);
  const out: Delivery[] = [];
  let ts = start;
  for (let i = 0; i < c.dt.length; i++) {
    ts += c.dt[i] ?? 0;
    const hold = c.hold[i] ?? null;
    const message: TelemetryMessage = {
      v: 1,
      ts,
      air: { temp: c.temp[i] ?? null, rh: c.rh[i] ?? null },
      light: { lux: c.lux[i] ?? null },
      soil: zones.map((id) => ({ id, moisture: c.soil[id]?.[i] ?? null, cal: c.cal[id] ?? 1 })),
      tank: { level: c.tank[i] ?? null },
      actuators: {
        pump: c.pump[i] === 1,
        growLight: c.growLight[i] === 1,
        fan: c.fan[i] === 1,
        vent: c.vent[i] ?? 0,
      },
      outdoorHold: hold ? { cause: hold[0], until: start + hold[1] } : null,
      fw: c.fw,
      rssi: c.rssi[i] ?? 0,
    };
    out.push({ topic: topicName, payload: JSON.stringify(message), at: ts * 1000 });
  }
  return out;
}

/**
 * Everything the hub heard, in order, as it was sent; moved `shiftMs` later
 * (whole days: see `shiftFor`), the times inside each message too.
 */
export function decodeWeek(file: DemoWeekFile, shiftMs = 0): Delivery[] {
  const telemetryTopic = `vitreo/${file.device}/telemetry`;
  const seconds = Math.round(shiftMs / 1000);
  const others = file.messages.map(([after, name, message]) => ({
    topic: name,
    payload: JSON.stringify(shiftTimes(message, seconds)),
    at: file.startMs + after * 1000 + shiftMs,
  }));
  // Merged by time. Within a second the device sends its events before the
  // reading that follows them, so telemetry goes last.
  const all = [...others, ...telemetryOf(file, telemetryTopic, shiftMs)];
  return all
    .map((message, index) => ({ message, index, last: isTelemetry(message.topic) ? 1 : 0 }))
    .sort((a, b) => a.message.at - b.message.at || a.last - b.last || a.index - b.index)
    .map(({ message }) => message);
}

// ──────────────────────────────────────────────────── moved so it ends today

/** The fields of the contract that hold a time (Unix s): `ts`, an ack's `retryAt`, a hold's `until`. */
const TIME_KEYS = new Set(['ts', 'retryAt', 'until']);

/** A message moved in time by `seconds`: every time it holds, and nothing else. */
export function shiftTimes(value: unknown, seconds: number): unknown {
  if (Array.isArray(value)) return value.map((item) => shiftTimes(item, seconds));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      TIME_KEYS.has(key) && typeof item === 'number' ? item + seconds : shiftTimes(item, seconds),
    ]),
  );
}

const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_S * 1000).toISOString().slice(0, 10);

/** The device's memory moved by `ms` (whole days, give or take a change of summer time). */
export function shiftMemory(memory: SimMemory, ms: number): SimMemory {
  const seconds = Math.round(ms / 1000);
  return {
    ...memory,
    savedAt: memory.savedAt + ms,
    pumpLog: memory.pumpLog.map((entry) => ({
      startMs: entry.startMs + ms,
      endMs: entry.endMs + ms,
    })),
    automation: {
      lastWatering: Object.fromEntries(
        Object.entries(memory.automation.lastWatering).map(([zone, at]) => [zone, at + seconds]),
      ),
      counts: {
        ...memory.automation.counts,
        day:
          memory.automation.counts.day === ''
            ? ''
            : addDays(memory.automation.counts.day, Math.round(seconds / DAY_S)),
      },
    },
  };
}

/**
 * The week moved by whole days so that its last day is the visitor's today
 * (docs/09: the time of day is kept, so the sun, the morning waterings and
 * the quiet nights still match): what the hub had heard by the last hour
 * before `arrivalMs`, and the device's memory then, to carry on from.
 */
export function arrivalPast(
  file: DemoWeekFile,
  arrivalMs: number,
): {
  fromMs: number;
  rawFromMs: number;
  memory: SimMemory;
  messages: Delivery[];
  summaries: HourlySummary[];
} {
  // Noon of the last day: its midnight, whatever the summer time did.
  const lastDay = localMidnight(file.endMs - 12 * 3_600_000, file.timeZone);
  const shiftMs = localMidnight(arrivalMs, file.timeZone) - lastDay;
  const kept = file.memory.filter((m) => m.savedAt + shiftMs <= arrivalMs).at(-1) ?? file.memory[0];
  if (!kept) throw new Error('a week without memory');
  const memory = shiftMemory(kept, shiftMs);
  const messages = decodeWeek(file, shiftMs).filter((m) => m.at <= memory.savedAt);
  // Only hours over before the device carries on: the rest it lives again.
  const summaries = summariesOf(file, shiftMs).filter(
    (row) => (row.hour + HOUR_S) * 1000 <= memory.savedAt,
  );
  return {
    fromMs: file.startMs + shiftMs,
    rawFromMs: file.rawFromMs + shiftMs,
    memory,
    messages,
    summaries,
  };
}
