import { GREENHOUSE_ZONES, hubSettings, roundLocation } from '@vitreo/shared';
import type {
  AckMessage,
  CommandMessage,
  ConfigMessage,
  EventMessage,
  HubSettings,
  Location,
  NewPlant,
  Plant,
  PlantChapter,
  PlantUpdate,
  StatusMessage,
  TelemetryMessage,
  UnknownEvent,
} from '@vitreo/shared';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { z } from 'zod';

import type { HubDatabase } from './types.ts';
import * as t from './schema.ts';

/**
 * Invalid messages are archived nightly (A12); this cap only guards the
 * database against a flood between two nights, and says when it trims.
 */
export const MAX_REJECTED = 20_000;

export function storeTelemetry(
  db: HubDatabase,
  device: string,
  message: TelemetryMessage,
  raw: string,
  receivedAt: number,
): void {
  const values = {
    receivedAt,
    airTemp: message.air.temp,
    airRh: message.air.rh,
    lux: message.light.lux,
    tank: message.tank.level,
    pump: message.actuators.pump,
    growLight: message.actuators.growLight,
    fan: message.actuators.fan,
    vent: message.actuators.vent,
    fw: message.fw,
    rssi: message.rssi,
    raw,
  };
  db.transaction((tx) => {
    const existing = tx
      .select({ id: t.telemetry.id, raw: t.telemetry.raw })
      .from(t.telemetry)
      .where(and(eq(t.telemetry.device, device), eq(t.telemetry.ts, message.ts)))
      .get();
    // The same message again (QoS 1, retained): nothing to do.
    if (existing?.raw === raw) return;
    let id: number;
    if (existing) {
      // Another reading within the same second (a change right after the
      // periodic one): the later one is how it was at that second.
      tx.update(t.telemetry).set(values).where(eq(t.telemetry.id, existing.id)).run();
      tx.delete(t.soil).where(eq(t.soil.telemetryId, existing.id)).run();
      id = existing.id;
    } else {
      id = tx
        .insert(t.telemetry)
        .values({ device, ts: message.ts, ...values })
        .returning({ id: t.telemetry.id })
        .get().id;
    }
    for (const reading of message.soil) {
      tx.insert(t.soil)
        .values({
          telemetryId: id,
          device,
          ts: message.ts,
          zone: reading.id,
          moisture: reading.moisture,
          cal: reading.cal ?? null,
        })
        .run();
    }
  });
}

export function storeEvent(
  db: HubDatabase,
  device: string,
  message: EventMessage | UnknownEvent,
  raw: string,
  receivedAt: number,
): void {
  db.insert(t.events)
    .values({
      device,
      ts: message.ts,
      receivedAt,
      type: message.type,
      source: 'source' in message ? message.source : null,
      zone: 'zone' in message ? (message.zone ?? null) : null,
      requestId: 'requestId' in message ? (message.requestId ?? null) : null,
      raw,
    })
    .onConflictDoNothing()
    .run();
}

export function storeCommand(
  db: HubDatabase,
  device: string,
  message: CommandMessage,
  raw: string,
  receivedAt: number,
): void {
  // A resent order keeps its requestId (D30): stored once.
  db.insert(t.commands)
    .values({
      requestId: message.requestId,
      device,
      receivedAt,
      source: message.source,
      action: message.action,
      raw,
    })
    .onConflictDoNothing()
    .run();
}

export function storeAck(
  db: HubDatabase,
  device: string,
  message: AckMessage,
  raw: string,
  receivedAt: number,
): void {
  db.insert(t.acks)
    .values({
      device,
      requestId: message.requestId,
      ts: message.ts,
      receivedAt,
      result: message.result,
      reason: message.result === 'rejected' ? message.reason : null,
      raw,
    })
    .onConflictDoNothing()
    .run();
}

export function storeStatus(
  db: HubDatabase,
  device: string,
  message: StatusMessage,
  receivedAt: number,
): void {
  // Retained: it comes again on every new subscription. Only changes count.
  const last = db
    .select({ state: t.statusChanges.state })
    .from(t.statusChanges)
    .where(eq(t.statusChanges.device, device))
    .orderBy(desc(t.statusChanges.id))
    .limit(1)
    .get();
  if (last?.state === message.state) return;
  db.insert(t.statusChanges).values({ device, receivedAt, state: message.state }).run();
}

export function storeRejected(
  db: HubDatabase,
  topic: string,
  payload: string,
  error: string,
  receivedAt: number,
): number {
  db.insert(t.rejected).values({ topic, payload, error, receivedAt }).run();
  const trimmed = db
    .delete(t.rejected)
    .where(
      lt(
        t.rejected.id,
        sql`(SELECT id FROM ${t.rejected} ORDER BY id DESC LIMIT 1 OFFSET ${MAX_REJECTED - 1})`,
      ),
    )
    .returning({ id: t.rejected.id })
    .all();
  return trimmed.length;
}

/** Device time (Unix s) of the last telemetry stored, or null. */
export function lastTelemetryTs(db: HubDatabase, device: string): number | null {
  const row = db
    .select({ ts: t.telemetry.ts })
    .from(t.telemetry)
    .where(eq(t.telemetry.device, device))
    .orderBy(desc(t.telemetry.ts))
    .limit(1)
    .get();
  return row?.ts ?? null;
}

// ------------------------------------------------------------------ plants

/** Every zone of the greenhouse has a row (stable ids, GREENHOUSE_ZONES). */
export function ensurePlants(db: HubDatabase, device: string, now: number): void {
  for (const zone of GREENHOUSE_ZONES) {
    db.insert(t.plants)
      .values({ zone: zone.id, device, kind: zone.kind, name: null, sownAt: null, updatedAt: now })
      .onConflictDoNothing()
      .run();
  }
}

export function listPlants(db: HubDatabase, device: string): Plant[] {
  const rows = db.select().from(t.plants).where(eq(t.plants.device, device)).all();
  const order = new Map(GREENHOUSE_ZONES.map((zone, index) => [zone.id, index]));
  return rows
    .sort((a, b) => (order.get(a.zone) ?? 99) - (order.get(b.zone) ?? 99))
    .map((row) => ({
      zone: row.zone,
      kind: row.kind as Plant['kind'],
      name: row.name,
      sownAt: row.sownAt,
      since: row.since,
    }));
}

/**
 * A new plant in a pot (A12): the one there now is kept as a past chapter
 * (its name, sowing day and since when), and the pot starts again with the
 * new one. Its zone id does not change; its history is told by chapter.
 */
export function startChapter(
  db: HubDatabase,
  device: string,
  zone: string,
  next: NewPlant,
  now: number,
): Plant | null {
  const current = db
    .select()
    .from(t.plants)
    .where(and(eq(t.plants.device, device), eq(t.plants.zone, zone)))
    .get();
  if (!current) return null;
  db.transaction((tx) => {
    tx.insert(t.plantChapters)
      .values({
        device,
        zone,
        kind: current.kind,
        name: current.name,
        sownAt: current.sownAt,
        startedAt: current.since,
        endedAt: now,
      })
      .run();
    tx.update(t.plants)
      .set({ name: next.name, sownAt: next.sownAt, since: now, updatedAt: now })
      .where(and(eq(t.plants.device, device), eq(t.plants.zone, zone)))
      .run();
  });
  return listPlants(db, device).find((plant) => plant.zone === zone) ?? null;
}

/** The plants a pot had before, newest first (A12). */
export function listChapters(db: HubDatabase, device: string, zone: string): PlantChapter[] {
  return db
    .select()
    .from(t.plantChapters)
    .where(and(eq(t.plantChapters.device, device), eq(t.plantChapters.zone, zone)))
    .orderBy(desc(t.plantChapters.endedAt))
    .all()
    .map((row) => ({
      zone: row.zone,
      kind: row.kind as PlantChapter['kind'],
      name: row.name,
      sownAt: row.sownAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    }));
}

export function updatePlant(
  db: HubDatabase,
  device: string,
  zone: string,
  change: PlantUpdate,
  now: number,
): Plant | null {
  const exists = db
    .select({ zone: t.plants.zone })
    .from(t.plants)
    .where(and(eq(t.plants.device, device), eq(t.plants.zone, zone)))
    .get();
  if (!exists) return null;
  db.update(t.plants)
    .set({
      ...(change.name !== undefined ? { name: change.name } : {}),
      ...(change.sownAt !== undefined ? { sownAt: change.sownAt } : {}),
      updatedAt: now,
    })
    .where(and(eq(t.plants.device, device), eq(t.plants.zone, zone)))
    .run();
  return listPlants(db, device).find((plant) => plant.zone === zone) ?? null;
}

// ---------------------------------------------------------------- settings

const SETTINGS_KEY = 'greenhouse';

/** The greenhouse's settings; the first time, from .env (seed only, D79). */
export function readSettings(db: HubDatabase, seed: HubSettings, now: number): HubSettings {
  const row = db.select().from(t.settings).where(eq(t.settings.key, SETTINGS_KEY)).get();
  const parsed = row ? hubSettings.safeParse(JSON.parse(row.value)) : null;
  if (parsed?.success) return parsed.data;
  const initial = { ...seed, location: roundLocation(seed.location) };
  writeSettings(db, initial, now);
  return initial;
}

export function writeSettings(db: HubDatabase, value: HubSettings, now: number): void {
  db.insert(t.settings)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(value), updatedAt: now })
    .onConflictDoUpdate({
      target: t.settings.key,
      set: { value: JSON.stringify(value), updatedAt: now },
    })
    .run();
}

export function setLocation(
  db: HubDatabase,
  seed: HubSettings,
  location: Location,
  now: number,
): HubSettings {
  const next = { ...readSettings(db, seed, now), location: roundLocation(location) };
  writeSettings(db, next, now);
  return next;
}

/** Another small setting by key (A10: the weather rules, the station), or `fallback`. */
export function readSetting<T>(db: HubDatabase, key: string, schema: z.ZodType<T>, fallback: T): T {
  const row = db.select().from(t.settings).where(eq(t.settings.key, key)).get();
  if (!row) return fallback;
  try {
    return schema.safeParse(JSON.parse(row.value)).data ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeSetting(db: HubDatabase, key: string, value: unknown, now: number): void {
  const json = JSON.stringify(value);
  db.insert(t.settings)
    .values({ key, value: json, updatedAt: now })
    .onConflictDoUpdate({ target: t.settings.key, set: { value: json, updatedAt: now } })
    .run();
}

// ------------------------------------------------------------------ config

/** The newest revision stored, whatever its version, or null. */
export function latestConfigRev(db: HubDatabase, device: string): number | null {
  const row = db
    .select({ rev: sql<number | null>`max(${t.configRevisions.rev})` })
    .from(t.configRevisions)
    .where(eq(t.configRevisions.device, device))
    .get();
  return row?.rev ?? null;
}

/**
 * The newest config (as stored: it may be of an older version), the newest
 * revision the device confirmed, and the newest it refused, if newer.
 */
export function currentConfig(
  db: HubDatabase,
  device: string,
): {
  config: unknown;
  appliedRev: number | null;
  rejected: { rev: number; reason: 'unsupported_version' | 'invalid' } | null;
} | null {
  const rows = db
    .select()
    .from(t.configRevisions)
    .where(eq(t.configRevisions.device, device))
    .orderBy(desc(t.configRevisions.rev))
    .all();
  const latest = rows[0];
  if (!latest) return null;
  const applied = rows.find((row) => row.appliedAt !== null);
  const refused = rows.find((row) => row.rejectedAt !== null);
  const reason = refused?.rejectReason;
  return {
    config: JSON.parse(latest.raw) as unknown,
    appliedRev: applied?.rev ?? null,
    rejected:
      refused &&
      (reason === 'unsupported_version' || reason === 'invalid') &&
      refused.rev > (applied?.rev ?? 0)
        ? { rev: refused.rev, reason }
        : null,
  };
}

export function saveConfig(
  db: HubDatabase,
  device: string,
  config: ConfigMessage,
  origin: 'default' | 'adopted' | 'api',
): void {
  db.insert(t.configRevisions)
    .values({ device, rev: config.rev, ts: config.ts, origin, raw: JSON.stringify(config) })
    .onConflictDoNothing()
    .run();
}

/** The device confirmed a revision (`config.applied`, A6). */
export function markConfigApplied(db: HubDatabase, device: string, rev: number, at: number): void {
  db.update(t.configRevisions)
    .set({ appliedAt: at })
    .where(and(eq(t.configRevisions.device, device), eq(t.configRevisions.rev, rev)))
    .run();
}

/** The device refused a revision (`config.rejected`, A6). */
export function markConfigRejected(
  db: HubDatabase,
  device: string,
  rev: number,
  reason: string,
  at: number,
): void {
  db.update(t.configRevisions)
    .set({ rejectedAt: at, rejectReason: reason })
    .where(and(eq(t.configRevisions.device, device), eq(t.configRevisions.rev, rev)))
    .run();
}
