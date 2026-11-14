import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { and, asc, eq, lt, lte, sql } from 'drizzle-orm';

import type { HubDatabase } from './db/types.ts';
import * as t from './db/schema.ts';
import { DAY, RAW_DAYS } from './history.ts';

// --------------------------------------------------------------- retention

const ARCHIVED_ID = 'archive.telemetryId';

/**
 * Raw telemetry older than RAW_DAYS leaves the database (D77): appended, as
 * JSON lines, to `<dir>/telemetry-<device>-YYYY-MM.ndjson.gz` (one gzip member per
 * run; `gunzip` reads them as one file), then deleted. The hourly summaries
 * stay. The last archived id is recorded before deleting, so a crash in
 * between never writes a row twice. Returns how many rows were archived.
 */
export function archiveOldTelemetry(
  db: HubDatabase,
  device: string,
  dir: string,
  nowS: number,
): number {
  const cutoff = nowS - RAW_DAYS * DAY;
  const done = db.select().from(t.jobs).where(eq(t.jobs.name, ARCHIVED_ID)).get()?.value ?? 0;
  const rows = db
    .select({
      id: t.telemetry.id,
      ts: t.telemetry.ts,
      raw: t.telemetry.raw,
      receivedAt: t.telemetry.receivedAt,
    })
    .from(t.telemetry)
    .where(
      and(
        eq(t.telemetry.device, device),
        lt(t.telemetry.ts, cutoff),
        sql`${t.telemetry.id} > ${done}`,
      ),
    )
    .orderBy(asc(t.telemetry.id))
    .all();
  if (rows.length > 0) {
    const byMonth = new Map<string, string[]>();
    for (const row of rows) {
      const month = new Date(row.ts * 1000).toISOString().slice(0, 7);
      const lines = byMonth.get(month) ?? [];
      // The message as it came, and when it reached the hub (A12): the
      // device's clock drifting, or readings arriving late, show in the gap.
      lines.push(`{"receivedAt":${row.receivedAt.toString()},"message":${row.raw}}`);
      byMonth.set(month, lines);
    }
    mkdirSync(dir, { recursive: true });
    for (const [month, lines] of byMonth) {
      const file = path.join(dir, `telemetry-${device}-${month}.ndjson.gz`);
      appendFileSync(file, gzipSync(`${lines.join('\n')}\n`), { flush: true });
    }
    const last = rows[rows.length - 1]?.id ?? done;
    db.insert(t.jobs)
      .values({ name: ARCHIVED_ID, value: last })
      .onConflictDoUpdate({ target: t.jobs.name, set: { value: last } })
      .run();
  }
  // Soil rows go with their telemetry (ON DELETE CASCADE).
  db.delete(t.telemetry)
    .where(
      and(
        eq(t.telemetry.device, device),
        lt(t.telemetry.ts, cutoff),
        lte(t.telemetry.id, rows.at(-1)?.id ?? done),
      ),
    )
    .run();
  return rows.length;
}

/** Invalid messages stay in the database this long, then go to the archive (A12). */
const REJECTED_KEPT_S = DAY;

/**
 * Messages the hub could not accept (bad JSON, a reading out of range, an
 * unknown version), archived by month like the telemetry (A12): a sensor
 * that starts sending impossible values is a fault worth keeping, not noise
 * to trim. `rejected-YYYY-MM.ndjson.gz`, one line each: when it arrived, its
 * topic, why it was refused and the payload as it came. Returns how many.
 */
export function archiveRejected(db: HubDatabase, dir: string, nowS: number): number {
  const cutoff = (nowS - REJECTED_KEPT_S) * 1000;
  const rows = db
    .select()
    .from(t.rejected)
    .where(lt(t.rejected.receivedAt, cutoff))
    .orderBy(asc(t.rejected.id))
    .all();
  if (rows.length === 0) return 0;
  const byMonth = new Map<string, string[]>();
  for (const row of rows) {
    const month = new Date(row.receivedAt).toISOString().slice(0, 7);
    const lines = byMonth.get(month) ?? [];
    lines.push(
      JSON.stringify({
        receivedAt: row.receivedAt,
        topic: row.topic,
        error: row.error,
        payload: row.payload,
      }),
    );
    byMonth.set(month, lines);
  }
  mkdirSync(dir, { recursive: true });
  for (const [month, lines] of byMonth) {
    appendFileSync(
      path.join(dir, `rejected-${month}.ndjson.gz`),
      gzipSync(`${lines.join('\n')}\n`),
      { flush: true },
    );
  }
  db.delete(t.rejected)
    .where(lte(t.rejected.id, rows.at(-1)?.id ?? 0))
    .run();
  return rows.length;
}
