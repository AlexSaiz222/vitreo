import type { HistoryColumns, TelemetrySeries } from '@vitreo/shared';
import { and, asc, eq, gte, lt, lte, sql } from 'drizzle-orm';

import type { HubDatabase } from './db/types.ts';
import * as t from './db/schema.ts';

const HOUR = 3600;
export const DAY = 24 * HOUR;
/** Raw telemetry kept in the database (D77); older goes to the monthly archive. */
export const RAW_DAYS = 30;

const AIR_METRICS = {
  air_temp: t.telemetry.airTemp,
  air_rh: t.telemetry.airRh,
  lux: t.telemetry.lux,
  tank: t.telemetry.tank,
  pump: t.telemetry.pump,
  grow_light: t.telemetry.growLight,
  fan: t.telemetry.fan,
  vent: t.telemetry.vent,
} as const;

export const hourOf = (ts: number): number => Math.floor(ts / HOUR) * HOUR;

/**
 * Recomputes the hourly summaries of these hours from the raw telemetry:
 * mean, min and max per metric (booleans as the share of samples on), and
 * per pot for the soil. A null reading is not counted (never invented); an
 * hour without readings has no row, so it stays a gap.
 */
export function summariseHours(db: HubDatabase, device: string, hours: Iterable<number>): void {
  db.transaction((tx) => {
    for (const hour of hours) {
      const window = and(
        eq(t.telemetry.device, device),
        gte(t.telemetry.ts, hour),
        lt(t.telemetry.ts, hour + HOUR),
      );
      for (const [metric, column] of Object.entries(AIR_METRICS)) {
        const row = tx
          .select({
            count: sql<number>`count(${column})`,
            mean: sql<number | null>`avg(${column})`,
            min: sql<number | null>`min(${column})`,
            max: sql<number | null>`max(${column})`,
          })
          .from(t.telemetry)
          .where(window)
          .get();
        upsertHour(tx, device, hour, metric, '', row);
      }
      const zones = tx
        .select({
          zone: t.soil.zone,
          count: sql<number>`count(${t.soil.moisture})`,
          mean: sql<number | null>`avg(${t.soil.moisture})`,
          min: sql<number | null>`min(${t.soil.moisture})`,
          max: sql<number | null>`max(${t.soil.moisture})`,
        })
        .from(t.soil)
        .where(and(eq(t.soil.device, device), gte(t.soil.ts, hour), lt(t.soil.ts, hour + HOUR)))
        .groupBy(t.soil.zone)
        .all();
      for (const { zone, ...row } of zones) upsertHour(tx, device, hour, 'soil', zone, row);
    }
  });
}

type Tx = Parameters<Parameters<HubDatabase['transaction']>[0]>[0];

function upsertHour(
  tx: Tx,
  device: string,
  hour: number,
  metric: string,
  zone: string,
  row: { count: number; mean: number | null; min: number | null; max: number | null } | undefined,
): void {
  if (!row || row.count === 0) {
    tx.delete(t.hourly)
      .where(
        and(
          eq(t.hourly.device, device),
          eq(t.hourly.hour, hour),
          eq(t.hourly.metric, metric),
          eq(t.hourly.zone, zone),
        ),
      )
      .run();
    return;
  }
  const values = { count: row.count, mean: row.mean, min: row.min, max: row.max };
  tx.insert(t.hourly)
    .values({ device, hour, metric, zone, ...values })
    .onConflictDoUpdate({
      target: [t.hourly.device, t.hourly.hour, t.hourly.metric, t.hourly.zone],
      set: values,
    })
    .run();
}

/** Hours with raw telemetry after the last summarised one (on start). */
export function hoursToCatchUp(db: HubDatabase, device: string): number[] {
  const last = db
    .select({ hour: sql<number | null>`max(${t.hourly.hour})` })
    .from(t.hourly)
    .where(eq(t.hourly.device, device))
    .get()?.hour;
  return db
    .selectDistinct({ hour: sql<number>`(${t.telemetry.ts} / ${HOUR}) * ${HOUR}` })
    .from(t.telemetry)
    .where(and(eq(t.telemetry.device, device), gte(t.telemetry.ts, last ?? 0)))
    .all()
    .map((row) => row.hour);
}

// ------------------------------------------------------------------ series

/**
 * Longer than this without readings is a gap (telemetry comes every 30 s; a
 * restart of the hub or broker loses nothing, D87): the history shows it as
 * a gap (a null point), never a line across it.
 */
const GAP = { raw: 3 * 60, hour: 2 * HOUR } as const;
/** Up to this span, raw readings; longer spans come from the hourly summaries. */
export const RAW_SPAN_LIMIT = 2 * DAY;

type Point = TelemetrySeries['series'][string][number];

function withGaps(points: Point[], gap: number): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const previous = out.at(-1);
    if (previous && point.ts - previous.ts > gap) {
      out.push({ ts: previous.ts + 1, value: null });
    }
    out.push(point);
  }
  return out;
}

/** History between two instants (Unix s), raw or hourly, with gaps marked. */
export function readSeries(
  db: HubDatabase,
  device: string,
  from: number,
  to: number,
): TelemetrySeries {
  const series: Record<string, Point[]> = {};
  const push = (key: string, point: Point) => {
    (series[key] ??= []).push(point);
  };
  if (to - from <= RAW_SPAN_LIMIT) {
    const rows = db
      .select()
      .from(t.telemetry)
      .where(
        and(eq(t.telemetry.device, device), gte(t.telemetry.ts, from), lte(t.telemetry.ts, to)),
      )
      .orderBy(asc(t.telemetry.ts))
      .all();
    for (const row of rows) {
      push('air_temp', { ts: row.ts, value: row.airTemp });
      push('air_rh', { ts: row.ts, value: row.airRh });
      push('lux', { ts: row.ts, value: row.lux });
      push('tank', { ts: row.ts, value: row.tank });
      push('pump', { ts: row.ts, value: Number(row.pump) });
      push('grow_light', { ts: row.ts, value: Number(row.growLight) });
      push('fan', { ts: row.ts, value: Number(row.fan) });
      push('vent', { ts: row.ts, value: row.vent });
    }
    const soil = db
      .select()
      .from(t.soil)
      .where(and(eq(t.soil.device, device), gte(t.soil.ts, from), lte(t.soil.ts, to)))
      .orderBy(asc(t.soil.ts))
      .all();
    for (const row of soil) push(`soil:${row.zone}`, { ts: row.ts, value: row.moisture });
    for (const key of Object.keys(series)) series[key] = withGaps(series[key] ?? [], GAP.raw);
    return { step: 'raw', from, to, series };
  }
  const rows = db
    .select()
    .from(t.hourly)
    .where(
      and(eq(t.hourly.device, device), gte(t.hourly.hour, hourOf(from)), lte(t.hourly.hour, to)),
    )
    .orderBy(asc(t.hourly.hour))
    .all();
  for (const row of rows) {
    const key = row.metric === 'soil' ? `soil:${row.zone}` : row.metric;
    push(key, { ts: row.hour, value: row.mean, min: row.min, max: row.max });
  }
  for (const key of Object.keys(series)) series[key] = withGaps(series[key] ?? [], GAP.hour);
  return { step: 'hour', from, to, series };
}

// ------------------------------------------------------------------ export

const csvCell = (value: number | string | boolean | null) =>
  value === null ? '' : typeof value === 'boolean' ? (value ? '1' : '0') : String(value);

/**
 * Raw readings as CSV (docs/12: exportable): one row per telemetry message,
 * one column per pot. An empty cell is no reading, never a zero.
 */
export function telemetryCsv(db: HubDatabase, device: string, from: number, to: number): string {
  const rows = db
    .select()
    .from(t.telemetry)
    .where(and(eq(t.telemetry.device, device), gte(t.telemetry.ts, from), lte(t.telemetry.ts, to)))
    .orderBy(asc(t.telemetry.ts))
    .all();
  const soil = db
    .select()
    .from(t.soil)
    .where(and(eq(t.soil.device, device), gte(t.soil.ts, from), lte(t.soil.ts, to)))
    .all();
  const zones = [...new Set(soil.map((row) => row.zone))].sort();
  const byReading = new Map<number, Map<string, number | null>>();
  for (const row of soil) {
    const readings = byReading.get(row.telemetryId) ?? new Map<string, number | null>();
    readings.set(row.zone, row.moisture);
    byReading.set(row.telemetryId, readings);
  }
  const header = [
    'time_utc',
    'ts',
    'air_temp_c',
    'air_rh',
    'lux',
    'tank',
    'pump',
    'grow_light',
    'fan',
    'vent',
    ...zones.map((zone) => `soil_${zone}`),
  ];
  const lines = rows.map((row) =>
    [
      new Date(row.ts * 1000).toISOString(),
      row.ts,
      row.airTemp,
      row.airRh,
      row.lux,
      row.tank,
      row.pump,
      row.growLight,
      row.fan,
      row.vent,
      ...zones.map((zone) => byReading.get(row.id)?.get(zone) ?? null),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines, ''].join('\n');
}

/** The events between two instants (Unix s), as the device sent them. */
export function readEvents(db: HubDatabase, device: string, from: number, to: number): unknown[] {
  return db
    .select({ raw: t.events.raw })
    .from(t.events)
    .where(and(eq(t.events.device, device), gte(t.events.ts, from), lte(t.events.ts, to)))
    .orderBy(asc(t.events.ts), asc(t.events.id))
    .all()
    .map((row) => JSON.parse(row.raw) as unknown);
}

// ----------------------------------------------------------------- history

const COLUMNS = {
  airTemp: 'air_temp',
  airRh: 'air_rh',
  lux: 'lux',
  tank: 'tank',
  pump: 'pump',
  growLight: 'grow_light',
  fan: 'fan',
  vent: 'vent',
} as const;
type Column = keyof typeof COLUMNS;

/**
 * History in buckets of `step` seconds, as columns (A5, D88). Under an hour
 * per bucket it comes from the raw readings (kept 30 days); from an hour up,
 * from the hourly summaries (kept forever), weighted by how many readings
 * each hour had. A bucket with no readings is a gap: count 0, every value
 * null. Nothing is interpolated.
 */
export function readHistory(
  db: HubDatabase,
  device: string,
  options: { from: number; to: number; step: number; zones?: readonly string[] },
): HistoryColumns {
  const { step, zones } = options;
  // Buckets aligned to the step (UTC), so the same instant always falls in the same bucket.
  const from = Math.floor(options.from / step) * step;
  const to = options.to;
  const size = Math.max(0, Math.ceil((to - from) / step));
  const ts = Array.from({ length: size }, (_, i) => from + i * step);
  const empty = () => new Array<number | null>(size).fill(null);
  const out: HistoryColumns = {
    from,
    to,
    step,
    ts,
    n: new Array<number>(size).fill(0),
    airTemp: empty(),
    airRh: empty(),
    lux: empty(),
    tank: empty(),
    pump: empty(),
    growLight: empty(),
    fan: empty(),
    vent: empty(),
    soil: {},
  };
  const wanted = zones ? new Set(zones) : null;
  const soilColumn = (zone: string) => (out.soil[zone] ??= empty());
  for (const zone of zones ?? []) soilColumn(zone);

  if (step < HOUR) {
    // CAST: bound numbers would make SQLite divide in floating point.
    const bucket = sql<number>`cast((${t.telemetry.ts} - ${from}) / ${step} as integer)`;
    const rows = db
      .select({
        bucket,
        n: sql<number>`count(*)`,
        airTemp: sql<number | null>`avg(${t.telemetry.airTemp})`,
        airRh: sql<number | null>`avg(${t.telemetry.airRh})`,
        lux: sql<number | null>`avg(${t.telemetry.lux})`,
        tank: sql<number | null>`avg(${t.telemetry.tank})`,
        pump: sql<number | null>`avg(${t.telemetry.pump})`,
        growLight: sql<number | null>`avg(${t.telemetry.growLight})`,
        fan: sql<number | null>`avg(${t.telemetry.fan})`,
        vent: sql<number | null>`avg(${t.telemetry.vent})`,
      })
      .from(t.telemetry)
      .where(and(eq(t.telemetry.device, device), gte(t.telemetry.ts, from), lt(t.telemetry.ts, to)))
      .groupBy(bucket)
      .all();
    for (const row of rows) {
      const i = row.bucket;
      if (i < 0 || i >= size) continue;
      out.n[i] = row.n;
      for (const key of Object.keys(COLUMNS) as Column[]) out[key][i] = row[key];
    }
    const soilBucket = sql<number>`cast((${t.soil.ts} - ${from}) / ${step} as integer)`;
    const soil = db
      .select({
        bucket: soilBucket,
        zone: t.soil.zone,
        mean: sql<number | null>`avg(${t.soil.moisture})`,
      })
      .from(t.soil)
      .where(and(eq(t.soil.device, device), gte(t.soil.ts, from), lt(t.soil.ts, to)))
      .groupBy(soilBucket, t.soil.zone)
      .all();
    for (const row of soil) {
      if (row.bucket < 0 || row.bucket >= size || (wanted && !wanted.has(row.zone))) continue;
      soilColumn(row.zone)[row.bucket] = row.mean;
    }
    return out;
  }

  // From the hourly summaries: a weighted mean over the hours in each bucket.
  const rows = db
    .select()
    .from(t.hourly)
    .where(and(eq(t.hourly.device, device), gte(t.hourly.hour, from), lt(t.hourly.hour, to)))
    .all();
  const sums = new Map<string, { sum: number; count: number }>();
  const add = (key: string, i: number, mean: number | null, count: number) => {
    if (mean === null || count === 0) return;
    const entry = sums.get(`${key}|${i.toString()}`) ?? { sum: 0, count: 0 };
    entry.sum += mean * count;
    entry.count += count;
    sums.set(`${key}|${i.toString()}`, entry);
  };
  const metricKey = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, metric]) => [metric, key]),
  ) as Record<string, Column>;
  for (const row of rows) {
    const i = Math.floor((row.hour - from) / step);
    if (i < 0 || i >= size) continue;
    if (row.metric === 'soil') {
      if (wanted && !wanted.has(row.zone)) continue;
      add(`soil:${row.zone}`, i, row.mean, row.count);
      soilColumn(row.zone);
    } else {
      const key = metricKey[row.metric];
      if (!key) continue;
      add(key, i, row.mean, row.count);
      // Readings in the bucket: the hours' counts of a metric every message carries.
      if (row.metric === 'pump') out.n[i] = (out.n[i] ?? 0) + row.count;
    }
  }
  for (const [key, { sum, count }] of sums) {
    const [name = '', index = '0'] = key.split('|');
    const i = Number(index);
    const value = sum / count;
    if (name.startsWith('soil:')) soilColumn(name.slice(5))[i] = value;
    else out[name as Column][i] = value;
  }
  return out;
}

/** Unix s of the oldest telemetry kept, raw or summarised: how far back history goes. */
export function firstTelemetryTs(db: HubDatabase, device: string): number | null {
  const raw = db
    .select({ ts: sql<number | null>`min(${t.telemetry.ts})` })
    .from(t.telemetry)
    .where(eq(t.telemetry.device, device))
    .get()?.ts;
  const hourly = db
    .select({ hour: sql<number | null>`min(${t.hourly.hour})` })
    .from(t.hourly)
    .where(eq(t.hourly.device, device))
    .get()?.hour;
  const known = [raw, hourly].filter((value): value is number => typeof value === 'number');
  return known.length > 0 ? Math.min(...known) : null;
}
