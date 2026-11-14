import {
  configMessage,
  deriveAlerts,
  GREENHOUSE_ZONES,
  incidentKey,
  minutesOf,
  plantThresholds,
  PUSH_RULES,
  QUIET_HOURS,
  REMINDER_EVERY_MS,
  SPECIES,
  THIRSTY_AFTER_MS,
  withinWindow,
} from '@vitreo/shared';
import type {
  Alert,
  DataFreshness,
  HeldLimit,
  Incident,
  PushRule,
  PushType,
  SafetyLimit,
  TelemetryMessage,
} from '@vitreo/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { HubDatabase } from './db/types.ts';
import * as t from './db/schema.ts';
import { currentConfig, listPlants } from './db/store.ts';
import type { PushCore, PushMessage } from './pushCore.ts';

/**
 * The hub's warnings (A7, D76, D91): the very same `deriveAlerts` the app
 * shows, turned into incidents with a notification policy. One notification
 * per incident; a reminder at most every 4 h while it lasts; a silent
 * "Resuelto" that replaces it when it clears. Critical ones (a safety limit,
 * the tank empty) ring in quiet hours (23:00–08:00); the rest wait for
 * the morning, if they still hold.
 *
 * Honest limit: this runs on the hub. With the PC off or asleep, nothing is
 * sent (the app says so in Ajustes › Avisos).
 */

/** Data older than this is stale (the same 2 min as the app, docs/06). */
const STALE_AFTER_MS = 2 * 60_000;
/**
 * After the hub starts, wait this long before judging "no data": the broker
 * is still delivering what it queued (D87).
 */
const NO_DATA_GRACE_MS = 2 * 60_000;
/** A one-off safety limit (the hourly pump limit…) counts as one incident this long. */
const ONE_OFF_FOR_MS = 3_600_000;
/** Limits that hold a state come through `held`; the empty tank, through its own warning. */
const ONE_OFF_LIMITS: readonly SafetyLimit[] = [
  'pump_max_per_command',
  'pump_max_per_hour',
  'tank_unknown',
  'sensor_failure',
  'connection_lost',
];

const LIMITS: Record<SafetyLimit, string> = {
  pump_max_per_command: 'Un riego llegó al máximo por vez y se cortó.',
  pump_max_per_hour: 'Se alcanzó el límite de riego por hora: no se riega hasta que pase.',
  tank_empty: 'Sin agua en el depósito: no se riega.',
  tank_unknown: 'No se sabe cuánta agua queda: no se riega.',
  sensor_failure: 'Falla un sensor que hace falta: esa acción queda bloqueada.',
  over_temperature: 'Demasiado calor: ventilación forzada y luz apagada.',
  frost: 'Hiela: ventana cerrada y ventilador parado.',
  connection_lost: 'El invernadero perdió la conexión y paró lo que estaba haciendo.',
};

export interface Snapshot {
  /** ms */
  now: number;
  telemetry: TelemetryMessage | null;
  /** When the last reading arrived (ms), or null if none ever did. */
  lastDataAt: number | null;
  /** The device's own status (LWT), or null if unknown. */
  online: boolean | null;
  held: HeldLimit[];
  /**
   * Each pot's threshold (D100), from the newest config; left out, the
   * species' proposals.
   */
  thresholds?: ReadonlyMap<string, number>;
}

type Texts = Pick<PushMessage, 'title' | 'body' | 'url'>;

export class AlertEngine {
  /** When each situation began (ms), while it lasts. */
  private readonly since = new Map<string, number>();
  private readonly time: Intl.DateTimeFormat;

  constructor(
    private readonly db: HubDatabase,
    private readonly device: string,
    private readonly push: PushCore,
    private readonly options: { timeZone: string; startedAt: number },
  ) {
    this.time = new Intl.DateTimeFormat('es-ES', {
      timeZone: options.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }

  /** Local quiet hours (23:00–08:00), in the greenhouse's time zone. */
  quiet(now: number): boolean {
    const [h = '0', m = '0'] = this.time.format(now).split(':');
    return withinWindow(
      Number(h) * 60 + Number(m),
      minutesOf(QUIET_HOURS.from),
      minutesOf(QUIET_HOURS.to),
    );
  }

  private freshness(s: Snapshot): DataFreshness {
    if (s.lastDataAt === null) return 'waiting';
    if (s.online === false) return 'disconnected';
    return s.now - s.lastDataAt > STALE_AFTER_MS ? 'stale' : 'live';
  }

  /** "la albahaca" or "Pepa", for sentences. */
  private subject(zone: string): string {
    const given = listPlants(this.db, this.device).find((p) => p.zone === zone)?.name;
    if (given) return given;
    const kind = GREENHOUSE_ZONES.find((z) => z.id === zone)?.kind;
    if (!kind) return 'una planta';
    const species = SPECIES[kind];
    return `${species.article} ${species.name.toLowerCase()}`;
  }

  private texts(alert: Alert, s: Snapshot): Texts {
    const percent = (value: number) => `${Math.round(value * 100).toString()} %`;
    const degrees = (value: number | undefined) =>
      value === undefined
        ? ''
        : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(value)} °C`;
    switch (alert.kind) {
      case 'tank_empty':
        return {
          title: 'Depósito vacío',
          body: 'No se puede regar hasta rellenarlo.',
          url: '/?open=tank',
        };
      case 'tank_low': {
        const level = s.telemetry?.tank.level;
        return {
          title: 'Queda poca agua',
          body: level == null ? 'El depósito está bajo.' : `El depósito está al ${percent(level)}.`,
          url: '/?open=tank',
        };
      }
      case 'frost':
        return {
          title: 'Ventana cerrada por frío',
          body: `${degrees(alert.value)} en el invernadero: la protección contra heladas mantiene la ventana cerrada y el ventilador parado.`.trimStart(),
          url: '/?open=air',
        };
      case 'over_temperature':
        return {
          title: 'Demasiado calor',
          body: `${degrees(alert.value)}: ventilación forzada y luz apagada.`.replace(/^: /, ''),
          url: '/?open=air',
        };
      case 'stale':
      case 'disconnected':
        return {
          title: 'Sin datos del invernadero',
          body:
            s.lastDataAt === null
              ? 'Aún no ha llegado ningún dato.'
              : `No llegan datos desde las ${this.time.format(s.lastDataAt)}.`,
          url: '/',
        };
      case 'thirsty': {
        const zone = alert.zone ?? '';
        const subject = this.subject(zone);
        const threshold = (s.thresholds ?? plantThresholds(null)).get(zone) ?? null;
        const hours = Math.round(THIRSTY_AFTER_MS / 3_600_000);
        return {
          title: `${subject.charAt(0).toUpperCase()}${subject.slice(1)} tiene sed`,
          body: `Lleva más de ${hours.toString()} h${threshold === null ? '' : ` por debajo del ${percent(threshold)}`} sin regar.`,
          url: `/?open=plant:${zone}`,
        };
      }
      default:
        return { title: 'Aviso', body: '', url: '/' };
    }
  }

  private resolvedBody(key: string): string {
    if (key.startsWith('tank')) return 'El depósito tiene agua otra vez.';
    if (key === 'frost') return 'Ya no hiela: la ventana y el ventilador vuelven a obedecer.';
    if (key === 'over_temperature') return 'La temperatura ha bajado.';
    if (key === 'no_data') return 'Vuelven a llegar datos.';
    if (key.startsWith('thirsty:')) {
      const subject = this.subject(key.slice('thirsty:'.length));
      return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ya no tiene sed.`;
    }
    return 'Ya está bien.';
  }

  private openIncidents() {
    return this.db
      .select()
      .from(t.incidents)
      .where(and(eq(t.incidents.device, this.device), isNull(t.incidents.resolvedAt)))
      .all();
  }

  /** Sends what is due for an open incident: the first notification, or a reminder. */
  private async notify(incident: typeof t.incidents.$inferSelect, now: number): Promise<void> {
    if (!incident.critical && this.quiet(now)) return;
    const reminder = incident.notifiedAt !== null;
    if (reminder && now - (incident.lastNotifiedAt ?? 0) < REMINDER_EVERY_MS) return;
    await this.push.send(
      {
        title: incident.title,
        body: reminder ? `Sigue igual. ${incident.body}` : incident.body,
        tag: incident.key,
        url: incident.url,
        renotify: true,
        critical: incident.critical,
      },
      incident.type as PushType,
    );
    this.db
      .update(t.incidents)
      .set(reminder ? { lastNotifiedAt: now } : { notifiedAt: now, lastNotifiedAt: now })
      .where(eq(t.incidents.id, incident.id))
      .run();
  }

  private async resolve(incident: typeof t.incidents.$inferSelect, now: number, quietly: boolean) {
    this.db
      .update(t.incidents)
      .set({ resolvedAt: now })
      .where(eq(t.incidents.id, incident.id))
      .run();
    if (quietly || incident.notifiedAt === null) return;
    // Replaces the notification, without sound (renotify: false).
    await this.push.send(
      {
        title: `Resuelto: ${incident.title}`,
        body: this.resolvedBody(incident.key),
        tag: incident.key,
        url: incident.url,
        renotify: false,
        critical: false,
      },
      incident.type as PushType,
    );
  }

  private insert(key: string, rule: PushRule, zone: string | null, texts: Texts, now: number) {
    return this.db
      .insert(t.incidents)
      .values({
        device: this.device,
        key,
        type: rule.type,
        critical: rule.critical,
        zone,
        ...texts,
        openedAt: now,
      })
      .returning()
      .get();
  }

  /** Looks at the greenhouse now: opens, reminds and resolves incidents. */
  async evaluate(s: Snapshot): Promise<void> {
    const thresholds = s.thresholds ?? plantThresholds(null);
    const zones = GREENHOUSE_ZONES.map((zone) => ({
      id: zone.id,
      waterBelow: thresholds.get(zone.id) ?? 0,
    }));
    let freshness = this.freshness(s);
    // Never any data, long after starting: that is "no data" too.
    if (freshness === 'waiting' && s.now - this.options.startedAt > NO_DATA_GRACE_MS) {
      freshness = 'disconnected';
    }
    const active = new Map<string, { alert: Alert; rule: PushRule }>();
    for (const alert of deriveAlerts(freshness, s.telemetry, zones, s.held)) {
      const rule = PUSH_RULES[alert.kind];
      if (rule) active.set(incidentKey(alert), { alert, rule });
    }
    for (const key of [...this.since.keys()]) if (!active.has(key)) this.since.delete(key);
    for (const key of active.keys()) {
      if (!this.since.has(key)) {
        // "No data" counts from the last reading, not from when it was noticed.
        this.since.set(key, key === 'no_data' ? (s.lastDataAt ?? this.options.startedAt) : s.now);
      }
    }

    const open = this.openIncidents();
    for (const [key, { alert, rule }] of active) {
      const existing = open.find((incident) => incident.key === key);
      if (existing) {
        await this.notify(existing, s.now);
        continue;
      }
      const since = this.since.get(key) ?? s.now;
      if (s.now - since < rule.afterMs) continue;
      if (key === 'no_data' && s.now - this.options.startedAt < NO_DATA_GRACE_MS) continue;
      const incident = this.insert(key, rule, alert.zone ?? null, this.texts(alert, s), s.now);
      await this.notify(incident, s.now);
    }
    for (const incident of open) {
      // The weather's notes (A10) are the weather rules' to put away.
      if (incident.key.startsWith('forecast:')) continue;
      const oneOff = incident.key.startsWith('safety:');
      if (oneOff) {
        if (s.now - incident.openedAt >= ONE_OFF_FOR_MS) await this.resolve(incident, s.now, true);
        else await this.notify(incident, s.now);
      } else if (!active.has(incident.key)) {
        await this.resolve(incident, s.now, false);
      }
    }
  }

  /** A one-off safety limit fired (from its event): one critical notification. */
  async oneOff(limit: SafetyLimit, now: number): Promise<void> {
    if (!ONE_OFF_LIMITS.includes(limit)) return;
    const key = `safety:${limit}`;
    if (this.openIncidents().some((incident) => incident.key === key)) return;
    const incident = this.insert(
      key,
      { type: 'safety', critical: true, afterMs: 0 },
      null,
      { title: 'Límite de seguridad', body: LIMITS[limit], url: '/' },
      now,
    );
    await this.notify(incident, now);
  }

  /** The latest incidents, open ones first (Ajustes › Avisos). */
  list(limit = 20): Incident[] {
    return this.db
      .select()
      .from(t.incidents)
      .where(eq(t.incidents.device, this.device))
      .orderBy(desc(t.incidents.openedAt))
      .limit(limit)
      .all()
      .sort((a, b) => Number(a.resolvedAt !== null) - Number(b.resolvedAt !== null))
      .map((row) => ({
        id: row.id,
        key: row.key,
        type: row.type as PushType,
        critical: row.critical,
        title: row.title,
        body: row.body,
        zone: row.zone,
        openedAt: row.openedAt,
        notifiedAt: row.notifiedAt,
        resolvedAt: row.resolvedAt,
      }));
  }
}

/** What the engine needs, read from the database (latest reading, status, held limits). */
export function snapshotFrom(db: HubDatabase, device: string, now: number): Snapshot {
  const last = db
    .select({ raw: t.telemetry.raw, receivedAt: t.telemetry.receivedAt })
    .from(t.telemetry)
    .where(eq(t.telemetry.device, device))
    .orderBy(desc(t.telemetry.ts))
    .limit(1)
    .get();
  const status = db
    .select({ state: t.statusChanges.state })
    .from(t.statusChanges)
    .where(eq(t.statusChanges.device, device))
    .orderBy(desc(t.statusChanges.id))
    .limit(1)
    .get();
  // The latest safety events: which held limits (frost, heat) are on now.
  const safety = db
    .select({ raw: t.events.raw })
    .from(t.events)
    .where(eq(t.events.device, device))
    .orderBy(desc(t.events.ts), desc(t.events.id))
    .limit(500)
    .all()
    .map((row) => JSON.parse(row.raw) as { type: string; limit?: string; value?: number })
    .filter((event) => event.type === 'safety.triggered' || event.type === 'safety.cleared');
  const held: HeldLimit[] = [];
  for (const limit of ['frost', 'over_temperature'] as const) {
    const latest = safety.find((event) => event.limit === limit);
    if (latest?.type === 'safety.triggered') held.push({ limit, value: latest.value ?? null });
  }
  // The person's thresholds, from the newest config (D100), whatever the device applied.
  const stored = configMessage.safeParse(currentConfig(db, device)?.config);
  return {
    now,
    telemetry: last ? (JSON.parse(last.raw) as TelemetryMessage) : null,
    lastDataAt: last?.receivedAt ?? null,
    online: status ? status.state === 'online' : null,
    held,
    thresholds: plantThresholds(stored.data?.watering),
  };
}
