import {
  configUpdate,
  journalNote,
  journalPhotoQuery,
  location,
  MAX_HISTORY_BUCKETS,
  newPlant,
  plantUpdate,
  pushEndpoint,
  pushRegistration,
  skyCode,
  weatherObservation,
  weatherRulesUpdate,
  zoneId,
} from '@vitreo/shared';
import type { ConfigState, HubHealth, HubSettings, WeatherState } from '@vitreo/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { snapshotFrom } from './alerts.ts';
import type { AlertEngine } from './alerts.ts';
import type { ConfigOwner } from './configOwner.ts';
import * as tables from './db/schema.ts';
import {
  currentConfig,
  lastTelemetryTs,
  listChapters,
  listPlants,
  readSettings,
  setLocation,
  startChapter,
  updatePlant,
} from './db/store.ts';
import type { HubDatabase } from './db/types.ts';
import {
  firstTelemetryTs,
  hourOf,
  readEvents,
  readHistory,
  readSeries,
  summariseHours,
  telemetryCsv,
} from './history.ts';
import { handleMessage } from './ingest.ts';
import { JournalError } from './journalCore.ts';
import type { BackupReport, JournalCore } from './journalCore.ts';
import type { PushCore } from './pushCore.ts';
import type { WeatherRuleEngine } from './weather/rules.ts';
import type { WeatherService } from './weather/service.ts';

/**
 * The hub's API (A4, D87) as plain handlers, without a web framework: the
 * hub serves them with Fastify (server.ts), and the public demo (D66, D103)
 * answers the same requests from a Web Worker. One implementation for both,
 * so the demo always behaves as the hub does.
 */

export interface HubContext {
  db: HubDatabase;
  owner: ConfigOwner;
  device: string;
  timeZone: string;
  seedLocation: { lat: number; lng: number };
  startedAt: number;
  mqttConnected: () => boolean;
  now?: () => number;
  /**
   * The e2e hub only (HUB_MODE=test): routes to seed history and start over,
   * so tests and captures are the same every run. Never in Docker or dev.
   */
  testing?: boolean;
  /** Warnings and web push (A7); absent in tests that do not need them. */
  push?: PushCore;
  alerts?: AlertEngine;
  /** The plants' journal (A8). */
  journal?: JournalCore;
  /** Outdoor weather and the hub's weather rules (A10). */
  weather?: WeatherService;
  weatherRules?: WeatherRuleEngine;
  /**
   * A backup now (pnpm hub:backup). Only asked from inside the hub's own
   * container: never from the phone (through nginx) or the PC.
   */
  backup?: () => BackupReport;
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A request as a route sees it, whoever received it. */
export interface ApiRequest {
  /** The `:name` parts of the path. */
  params: Readonly<Record<string, string>>;
  /** The query string, as an object of strings. */
  query: unknown;
  /** Parsed JSON, the bytes of an image/jpeg, or undefined. */
  body: unknown;
  /** Who asked: only the backup route looks at it. */
  ip: string;
}

/** Any answer other than JSON with a 200: an error, a CSV, a photo. */
export class ApiReply {
  constructor(
    readonly status: number,
    readonly body: unknown,
    /** The content type; JSON if absent. */
    readonly type?: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {}
}

/** A route's answer: a JSON value (sent with a 200), or an ApiReply. */
export type ApiResult = unknown;

export interface Route {
  method: Method;
  /** Under API_PREFIX, with `:name` parts. */
  path: string;
  handle: (request: ApiRequest) => ApiResult;
}

/** The photo upload's body is raw JPEG bytes, not JSON (A8). */
export const JPEG_UPLOAD = { method: 'PUT', path: '/journal/:id/photo' } as const;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_SPAN_S = 400 * 24 * 3600;
const range = z
  .object({ from: z.coerce.number().int(), to: z.coerce.number().int() })
  .refine((value) => value.to > value.from && value.to - value.from <= MAX_SPAN_S, {
    message: 'from < to, at most 400 days',
  });

const historyQuery = z
  .object({
    from: z.coerce.number().int(),
    to: z.coerce.number().int(),
    step: z.coerce.number().int().min(60),
    zones: z
      .string()
      .optional()
      .transform((value) => (value ? value.split(',').filter(Boolean) : undefined)),
  })
  .refine((value) => value.to > value.from && value.to - value.from <= MAX_SPAN_S, {
    message: 'from < to, at most 400 days',
  })
  .refine((value) => (value.to - value.from) / value.step <= MAX_HISTORY_BUCKETS, {
    message: `at most ${MAX_HISTORY_BUCKETS.toString()} buckets: use a wider step`,
  });

const testMessages = z.object({
  messages: z.array(
    z.object({ channel: z.enum(['telemetry', 'event', 'status']), message: z.unknown() }),
  ),
});

/** Weather put in by an e2e test, as the hub would have fetched it (A10). */
const reading = z.number().nullable();
const testWeather = z.object({
  /** The hub's clock for it (ms); now by default. */
  now: z.number().int().optional(),
  observation: weatherObservation.nullable(),
  forecast: z
    .object({
      municipality: z.object({ id: z.string(), name: z.string() }),
      issuedAt: z.number().int(),
      points: z.array(
        z.object({
          hour: z.number().int(),
          sky: skyCode.nullable(),
          skyText: z.string().nullable(),
          temp: reading,
          precip: reading,
          snow: reading,
          windSpeed: reading,
          windGust: reading,
        }),
      ),
    })
    .nullable(),
});

const invalid = (error: z.ZodError) => new ApiReply(400, { error: z.prettifyError(error) });
const notFound = (error: string) => new ApiReply(404, { error });
const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const csv = (body: string, filename: string) =>
  new ApiReply(200, body, 'text/csv; charset=utf-8', {
    'content-disposition': `attachment; filename="${filename}"`,
  });

/**
 * Every route of the API, in the order the hub registers them. The optional
 * parts (push, journal, weather, the e2e routes) are there only when the
 * context has them, as before.
 */
export function hubRoutes(context: HubContext): Route[] {
  const routes: Route[] = [];
  const route = (method: Method, path: string, handle: Route['handle']) => {
    routes.push({ method, path, handle });
  };
  const now = context.now ?? Date.now;
  const seed = (): HubSettings => ({
    location: context.seedLocation,
    timeZone: context.timeZone,
  });

  route('GET', '/health', (): HubHealth => ({
    status: 'ok',
    device: context.device,
    since: context.startedAt,
    mqtt: context.mqttConnected(),
    lastTelemetry: lastTelemetryTs(context.db, context.device),
    firstTelemetry: firstTelemetryTs(context.db, context.device),
  }));

  // A backup now (pnpm hub:backup, docs/05). Only from inside the hub's
  // own container: a request through nginx (the phone) or the published
  // port (the PC) comes from another address and is refused.
  const backup = context.backup;
  if (backup) {
    route('POST', '/backup', (request) =>
      LOOPBACK.has(request.ip)
        ? backup()
        : new ApiReply(403, { error: 'only from inside the hub (pnpm hub:backup)' }),
    );
  }

  route('GET', '/plants', () => listPlants(context.db, context.device));

  route('PATCH', '/plants/:zone', (request) => {
    const zone = zoneId.safeParse(request.params['zone']);
    if (!zone.success) return invalid(zone.error);
    const change = plantUpdate.safeParse(request.body);
    if (!change.success) return invalid(change.error);
    const plant = updatePlant(context.db, context.device, zone.data, change.data, now());
    return plant ?? notFound('no such plant');
  });

  // A new plant in the pot (A12): the one there becomes a past chapter.
  route('POST', '/plants/:zone/chapter', (request) => {
    const zone = zoneId.safeParse(request.params['zone']);
    if (!zone.success) return invalid(zone.error);
    const next = newPlant.safeParse(request.body);
    if (!next.success) return invalid(next.error);
    const plant = startChapter(context.db, context.device, zone.data, next.data, now());
    return plant ?? notFound('no such plant');
  });

  route('GET', '/plants/:zone/chapters', (request) => {
    const zone = zoneId.safeParse(request.params['zone']);
    if (!zone.success) return invalid(zone.error);
    return listChapters(context.db, context.device, zone.data);
  });

  route('GET', '/settings', () => readSettings(context.db, seed(), now()));

  route('PUT', '/settings/location', (request) => {
    const parsed = location.strict().safeParse(request.body);
    if (!parsed.success) return invalid(parsed.error);
    const settings = setLocation(context.db, seed(), parsed.data, now());
    // The device works out sunrise and sunset itself: it needs the place (D89).
    context.owner.relocate(now());
    return settings;
  });

  route('GET', '/config', (): ConfigState => {
    const config = context.owner.current(now());
    const stored = currentConfig(context.db, context.device);
    return {
      config,
      appliedRev: stored?.appliedRev ?? null,
      rejected: stored?.rejected ?? null,
    };
  });

  route('PUT', '/config', (request) => {
    const parsed = configUpdate.safeParse(request.body);
    if (!parsed.success) return invalid(parsed.error);
    const config = context.owner.update(parsed.data, now());
    const stored = currentConfig(context.db, context.device);
    return { config, appliedRev: stored?.appliedRev ?? null, rejected: null };
  });

  route('GET', '/telemetry', (request) => {
    const parsed = range.safeParse(request.query);
    if (!parsed.success) return invalid(parsed.error);
    return readSeries(context.db, context.device, parsed.data.from, parsed.data.to);
  });

  route('GET', '/telemetry.csv', (request) => {
    const parsed = range.safeParse(request.query);
    if (!parsed.success) return invalid(parsed.error);
    const { from, to } = parsed.data;
    return csv(
      telemetryCsv(context.db, context.device, from, to),
      `vitreo-${context.device}-${day(from)}-${day(to)}.csv`,
    );
  });

  route('GET', '/history', (request) => {
    const parsed = historyQuery.safeParse(request.query);
    if (!parsed.success) return invalid(parsed.error);
    const { from, to, step, zones } = parsed.data;
    return readHistory(context.db, context.device, {
      from,
      to,
      step,
      ...(zones ? { zones } : {}),
    });
  });

  if (context.testing) {
    route('POST', '/test/messages', (request) => {
      const parsed = testMessages.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error);
      const hours = new Set<number>();
      for (const { channel, message } of parsed.data.messages) {
        const ts = handleMessage(
          context.db,
          context.owner,
          context.device,
          `vitreo/${context.device}/${channel}`,
          JSON.stringify(message),
          now(),
        );
        if (ts !== null) hours.add(hourOf(ts));
      }
      summariseHours(context.db, context.device, hours);
      return { stored: parsed.data.messages.length };
    });
    route('POST', '/test/reset', () => {
      context.journal?.clear();
      for (const table of [
        tables.journalEntries,
        tables.plantChapters,
        tables.incidents,
        tables.pushSubscriptions,
        tables.soil,
        tables.telemetry,
        tables.hourly,
        tables.events,
        tables.commands,
        tables.acks,
      ]) {
        context.db.delete(table).run();
      }
      // Every pot with its first plant again (A12).
      context.db.update(tables.plants).set({ since: null }).run();
      // And forget what the test hub "sent", and any weather a test put in.
      context.push?.outbox.splice(0);
      context.weather?.clear();
      context.db.delete(tables.weatherObservations).run();
      context.db.delete(tables.weatherForecasts).run();
      for (const key of ['weather.rules', 'weather.window']) {
        context.db.delete(tables.settings).where(eq(tables.settings.key, key)).run();
      }
      return { reset: true };
    });
    // Back to the default rules (all off), published again for the device.
    route('POST', '/test/reset-config', () => {
      context.db.delete(tables.configRevisions).run();
      return { config: context.owner.announce(now()) };
    });
  }

  // ── Warnings and web push (A7, D91) ──────────────────────────────
  const push = context.push;
  const alerts = context.alerts;
  if (push && alerts) {
    route('GET', '/push/key', () => {
      const publicKey = push.publicKey;
      return publicKey
        ? { publicKey }
        : new ApiReply(503, { error: 'no VAPID keys: set them in .env (pnpm hub:vapid)' });
    });
    route('PUT', '/push/subscription', (request) => {
      const parsed = pushRegistration.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error);
      push.save(parsed.data.subscription, parsed.data.prefs, now());
      return parsed.data.prefs;
    });
    route('POST', '/push/subscription/prefs', (request) => {
      const parsed = pushEndpoint.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error);
      return push.prefsOf(parsed.data.endpoint) ?? notFound('unknown');
    });
    route('DELETE', '/push/subscription', (request) => {
      const parsed = pushEndpoint.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error);
      push.remove(parsed.data.endpoint);
      return { removed: true };
    });
    route('POST', '/push/test', async (request) => {
      const parsed = pushEndpoint.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error);
      const sent = await push.send(
        {
          title: 'Prueba de Vitreo',
          body: 'Si ves esto, los avisos llegan a este dispositivo.',
          tag: 'test',
          url: '/',
          renotify: true,
          critical: false,
        },
        null,
        parsed.data.endpoint,
      );
      return sent > 0 ? { sent } : notFound('not subscribed');
    });
    route('GET', '/alerts', () => alerts.list());
    if (context.testing) {
      route('GET', '/test/pushes', () => push.outbox);
      // A fake clock for the engine: evaluate as if it were `now` (ms).
      route('POST', '/test/evaluate', async (request) => {
        const at = (request.body as { now?: number } | undefined)?.now ?? now();
        await alerts.evaluate(snapshotFrom(context.db, context.device, at));
        return alerts.list();
      });
      // A past warning about a plant (A8), already resolved: some take hours to open.
      route('POST', '/test/incidents', (request) => {
        const body = request.body as {
          zone: string;
          title: string;
          openedAt: number;
          resolvedAt: number | null;
        };
        context.db
          .insert(tables.incidents)
          .values({
            device: context.device,
            key: `thirsty:${body.zone}`,
            type: 'thirsty',
            critical: false,
            zone: body.zone,
            title: body.title,
            body: '',
            url: `/?open=plant:${body.zone}`,
            openedAt: body.openedAt,
            notifiedAt: body.openedAt,
            lastNotifiedAt: body.openedAt,
            resolvedAt: body.resolvedAt,
          })
          .run();
        return { ok: true };
      });
    }
  }

  // ── The plants' journal (A8, D93) ─────────────────────────────────
  const journal = context.journal;
  if (journal) {
    const fail = (error: unknown) => {
      if (error instanceof JournalError) return new ApiReply(error.status, { error: error.message });
      throw error;
    };
    route('GET', '/journal/:zone', (request) => {
      const zone = zoneId.safeParse(request.params['zone']);
      if (!zone.success) return invalid(zone.error);
      return journal.plant(zone.data, now());
    });
    route('POST', '/journal/notes', (request) => {
      const parsed = journalNote.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error);
      try {
        return journal.addNote(parsed.data, now());
      } catch (error) {
        return fail(error);
      }
    });
    // Photos arrive as raw JPEG bytes (the phone has already resized them).
    route(JPEG_UPLOAD.method, JPEG_UPLOAD.path, (request) => {
      const id = z.uuid().safeParse(request.params['id']);
      if (!id.success) return invalid(id.error);
      const details = journalPhotoQuery.safeParse(request.query);
      if (!details.success) return invalid(details.error);
      if (!(request.body instanceof Uint8Array)) {
        return new ApiReply(415, { error: 'send the photo as image/jpeg' });
      }
      try {
        const { caption, ...rest } = details.data;
        return journal.addPhoto(
          id.data,
          { ...rest, ...(caption ? { caption } : {}) },
          request.body,
          now(),
        );
      } catch (error) {
        return fail(error);
      }
    });
    route('GET', '/journal/:id/photo', (request) => {
      const id = z.uuid().safeParse(request.params['id']);
      if (!id.success) return invalid(id.error);
      const photo = journal.photo(id.data);
      if (!photo) return notFound('no such photo');
      return new ApiReply(200, photo, 'image/jpeg', {
        'cache-control': 'private, max-age=31536000, immutable',
      });
    });
    route('DELETE', '/journal/:id', (request) => {
      const id = z.uuid().safeParse(request.params['id']);
      if (!id.success) return invalid(id.error);
      return journal.remove(id.data, now()) ? { deleted: true } : notFound('no such entry');
    });
    route('POST', '/journal/:id/restore', (request) => {
      const id = z.uuid().safeParse(request.params['id']);
      if (!id.success) return invalid(id.error);
      return journal.restore(id.data) ?? notFound('no such entry');
    });
    route('GET', '/storage', () => journal.storageReport(now()));
  }

  // ── Outdoor weather and its rules (A10, D97) ─────────────────────────
  const weather = context.weather;
  const weatherRules = context.weatherRules;
  if (weather && weatherRules) {
    route('GET', '/weather', (): WeatherState => ({
      ...weather.state(now()),
      rules: weatherRules.rules(),
      window: weatherRules.windowState(),
    }));
    route('PUT', '/weather/rules', async (request) => {
      const parsed = weatherRulesUpdate.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error);
      const rules = weatherRules.setRules(parsed.data, now());
      await weatherRules.evaluate(now());
      return rules;
    });
    route('GET', '/weather/history', (request) => {
      const parsed = range.safeParse(request.query);
      if (!parsed.success) return invalid(parsed.error);
      return weather.history(parsed.data.from, parsed.data.to);
    });
    route('GET', '/weather.csv', (request) => {
      const parsed = range.safeParse(request.query);
      if (!parsed.success) return invalid(parsed.error);
      const { from, to } = parsed.data;
      return csv(weather.historyCsv(from, to), `vitreo-aemet-${day(from)}-${day(to)}.csv`);
    });
    if (context.testing) {
      route('POST', '/test/weather', async (request) => {
        const parsed = testWeather.safeParse(request.body);
        if (!parsed.success) return invalid(parsed.error);
        const at = parsed.data.now ?? now();
        weather.inject(
          { observation: parsed.data.observation, forecast: parsed.data.forecast },
          at,
        );
        await weatherRules.evaluate(at);
        return { ...weather.state(at), window: weatherRules.windowState() };
      });
      // The rules at a given time (ms), e.g. the evening for the frost warning.
      route('POST', '/test/weather/evaluate', async (request) => {
        const at = (request.body as { now?: number } | undefined)?.now ?? now();
        await weatherRules.evaluate(at);
        return { window: weatherRules.windowState() };
      });
    }
  }

  route('GET', '/events', (request) => {
    const parsed = range.safeParse(request.query);
    if (!parsed.success) return invalid(parsed.error);
    return readEvents(context.db, context.device, parsed.data.from, parsed.data.to);
  });

  return routes;
}
