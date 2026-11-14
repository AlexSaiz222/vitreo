import { z } from 'zod';

import { configMessage, configRules } from '../mqtt/config.ts';
import { zoneId } from '../mqtt/common.ts';
import { automationReason, weatherCause } from '../mqtt/reason.ts';
import { weatherMessage } from '../mqtt/weather.ts';
import { PUSH_TYPES } from '../alerts/index.ts';
import { SPECIES_KINDS } from '../species/index.ts';

/**
 * The hub's HTTP API (`/api/v1`, A4, D87): the app and the hub validate the
 * same schemas. Versioned by path: an incompatible change becomes `/api/v2`.
 */
export const API_PREFIX = '/api/v1';

/*
 * Answers from the hub are read with `z.object`, which ignores fields it
 * does not know: a newer hub (a field added) never breaks an older app on a
 * phone (D88). What is sent to the hub stays strict.
 */

export const hubHealth = z.object({
  status: z.literal('ok'),
  /** The greenhouse this hub owns. */
  device: z.string(),
  /** Unix ms when the hub started. */
  since: z.number().int(),
  mqtt: z.boolean(),
  /** Unix s of the last telemetry stored, or null. */
  lastTelemetry: z.number().int().nullable(),
  /** Unix s of the oldest telemetry kept (raw or summarised), or null: how far back history goes. */
  firstTelemetry: z.number().int().nullable(),
});
export type HubHealth = z.infer<typeof hubHealth>;

/** A display name: what the person calls the plant; never changes its zone id. */
export const plantName = z.string().trim().min(1).max(40);
/** A day, YYYY-MM-DD (the sowing date). */
export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const plant = z.object({
  zone: zoneId,
  kind: z.enum(SPECIES_KINDS),
  /** The name chosen, or null for the species name. */
  name: plantName.nullable(),
  sownAt: isoDay.nullable(),
  /**
   * Since when this plant is in its pot (Unix ms, A12): set when a new plant
   * starts a new chapter; null for the first one, there from the start.
   */
  since: z.number().int().nullable().default(null),
});
export type Plant = z.infer<typeof plant>;

/**
 * A plant that was in a pot before the one there now (A12): which plant was
 * where, and when, so a pot's history never mixes two plants (docs/12).
 */
export const plantChapter = z.object({
  zone: zoneId,
  kind: z.enum(SPECIES_KINDS),
  name: plantName.nullable(),
  sownAt: isoDay.nullable(),
  /** Unix ms; null = there from the start. */
  startedAt: z.number().int().nullable(),
  endedAt: z.number().int(),
});
export type PlantChapter = z.infer<typeof plantChapter>;
export const plantChapters = z.array(plantChapter);

/** A new plant in a pot: the one there now becomes a past chapter. */
export const newPlant = z.strictObject({
  name: plantName.nullable(),
  sownAt: isoDay.nullable(),
});
export type NewPlant = z.infer<typeof newPlant>;

export const plantList = z.array(plant);

export const plantUpdate = z
  .strictObject({ name: plantName.nullable(), sownAt: isoDay.nullable() })
  .partial();
export type PlantUpdate = z.infer<typeof plantUpdate>;

/**
 * Where the greenhouse is (D79): only ever rounded to 2 decimals (≈ 1 km),
 * plenty for sunrise and sunset, and never in the repository.
 */
export const location = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Location = z.infer<typeof location>;

export const roundLocation = ({ lat, lng }: Location): Location => ({
  lat: Math.round(lat * 100) / 100,
  lng: Math.round(lng * 100) / 100,
});

export const hubSettings = z.object({
  location,
  /** IANA time zone, e.g. Europe/Madrid. */
  timeZone: z.string().min(1),
});
export type HubSettings = z.infer<typeof hubSettings>;

/**
 * A new config, as edited in the app: the rules only. The hub adds the
 * version, revision, time, time zone and location (D73, D89).
 */
export const configUpdate = configRules;
export type ConfigUpdate = z.infer<typeof configUpdate>;

export const configState = z.object({
  config: configMessage,
  /** The newest revision the device has confirmed with `config.applied`, if any (A6). */
  appliedRev: z.number().int().nullable(),
  /** The newest revision the device refused with `config.rejected`, and why. */
  rejected: z
    .object({ rev: z.number().int(), reason: z.enum(['unsupported_version', 'invalid']) })
    .nullable(),
});
export type ConfigState = z.infer<typeof configState>;

/** A point of a series: raw (one reading) or hourly (mean, min, max). */
export const seriesPoint = z.object({
  /** Unix s. */
  ts: z.number().int(),
  value: z.number().nullable(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
});

export const telemetrySeries = z.object({
  step: z.enum(['raw', 'hour']),
  from: z.number().int(),
  to: z.number().int(),
  /** By metric: air_temp, air_rh, lux, tank, soil:<zone>, pump, grow_light, fan, vent. */
  series: z.record(z.string(), z.array(seriesPoint)),
});
export type TelemetrySeries = z.infer<typeof telemetrySeries>;

export const apiError = z.strictObject({ error: z.string() });

/**
 * History in time buckets, as columns (A5, D88): compact enough to scrub
 * through on a phone. Bucket `i` covers `[ts[i], ts[i] + step)`. `n[i]` is how
 * many readings it holds: 0 is a gap, and every column is null there; nothing
 * is interpolated. Numbers are means; switches (pump, growLight, fan) are the
 * share of readings with them on (0–1). A broken sensor stays null.
 */
const column = z.array(z.number().nullable());
export const historyColumns = z.object({
  from: z.number().int(),
  to: z.number().int(),
  /** Seconds per bucket. */
  step: z.number().int().positive(),
  ts: z.array(z.number().int()),
  n: z.array(z.number().int().nonnegative()),
  airTemp: column,
  airRh: column,
  lux: column,
  tank: column,
  pump: column,
  growLight: column,
  fan: column,
  vent: column,
  /** By zone id. */
  soil: z.record(z.string(), column),
});
export type HistoryColumns = z.infer<typeof historyColumns>;

/** At most this many buckets per request: callers widen `step` for long spans. */
export const MAX_HISTORY_BUCKETS = 2000;

// ───────────────────────────────────────────── alerts and web push (A7, D91)

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export const pushSubscription = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type PushSubscriptionJson = z.infer<typeof pushSubscription>;

/** What this device wants to be told about (every type can be switched off). */
export const pushPrefs = z.object({
  types: z.array(z.enum(PUSH_TYPES)),
});
export type PushPrefs = z.infer<typeof pushPrefs>;

export const pushRegistration = z.strictObject({
  subscription: pushSubscription,
  prefs: pushPrefs,
});

export const pushEndpoint = z.strictObject({ endpoint: z.url() });

/** The hub's public VAPID key, or why there is none. */
export const pushKey = z.object({ publicKey: z.string().min(1) });

/** One warning as the hub lived it: when it opened, was told, and cleared. */
export const incident = z.object({
  id: z.number().int(),
  /** The situation: `tank_low`, `thirsty:basil_01`, `no_data`, `safety:pump_max_per_hour`… */
  key: z.string(),
  type: z.enum(PUSH_TYPES),
  critical: z.boolean(),
  title: z.string(),
  body: z.string(),
  zone: z.string().nullable(),
  openedAt: z.number().int(),
  notifiedAt: z.number().int().nullable(),
  resolvedAt: z.number().int().nullable(),
});
export type Incident = z.infer<typeof incident>;
export const incidentList = z.array(incident);

// ──────────────────────────────────────────────────── plant journal (A8, D93)

/** Photos larger than this are refused (the phone sends about 300 KB). */
export const MAX_PHOTO_BYTES = 1_500_000;
/** The phone resizes photos to this long edge before sending them. */
export const PHOTO_LONG_EDGE = 1600;

/**
 * The greenhouse's own journal (A12): maintenance and real faults, not about
 * one plant. It lives with the plants' journals under this zone id.
 */
export const GREENHOUSE_JOURNAL = 'greenhouse';

/**
 * Tags on a journal entry (A12): what happened, in a word, so the data says
 * it too (docs/12). A plant's, and the greenhouse's.
 */
export const PLANT_TAGS = [
  'watered',
  'sown',
  'transplanted',
  'pruned',
  'harvested',
  'pest',
  'yellow_leaf',
] as const;
export const GREENHOUSE_TAGS = [
  'refilled',
  'maintenance',
  'sensor_changed',
  'fault',
  'leak',
] as const;
export const journalTag = z.enum([...PLANT_TAGS, ...GREENHOUSE_TAGS]);
export type JournalTag = z.infer<typeof journalTag>;
const tagList = z
  .array(journalTag)
  .max(8)
  .refine((tags) => new Set(tags).size === tags.length, { message: 'repeated tag' });

/** A note or a photo in a plant's journal. Ids come from the phone (idempotent saves). */
export const journalEntry = z.object({
  id: z.uuid(),
  zone: zoneId,
  kind: z.enum(['note', 'photo']),
  tags: z.array(journalTag).default([]),
  /** The note, or the photo's caption. */
  text: z.string().max(2000).nullable(),
  photo: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      bytes: z.number().int().positive(),
    })
    .nullable(),
  /** When it was written on the phone (Unix ms). */
  createdAt: z.number().int(),
  /** When the hub stored it (Unix ms). */
  savedAt: z.number().int(),
});
export type JournalEntry = z.infer<typeof journalEntry>;

export const journalNote = z
  .strictObject({
    id: z.uuid(),
    zone: zoneId,
    /** Empty is fine with a tag: "Regada a mano" alone is a note. */
    text: z.string().trim().max(2000),
    tags: tagList.default([]),
    createdAt: z.number().int(),
  })
  .refine((note) => note.text.length > 0 || note.tags.length > 0, {
    message: 'a note needs text or a tag',
  });
export type JournalNote = z.infer<typeof journalNote>;

/** A photo's details, sent as query parameters with its JPEG body. */
export const journalPhotoQuery = z.object({
  zone: zoneId,
  createdAt: z.coerce.number().int(),
  width: z.coerce.number().int().positive(),
  height: z.coerce.number().int().positive(),
  caption: z.string().trim().max(2000).optional(),
  /** Comma-separated tags (A12). */
  tags: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').filter(Boolean) : []))
    .pipe(tagList),
});

/** What else happened to the plant, for its story (all from the hub's records). */
export const journalEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('watering'),
    /** Unix s. */
    ts: z.number().int(),
    source: z.enum(['user', 'automation', 'agent', 'safety']),
    seconds: z.number(),
    reason: automationReason.optional(),
  }),
  z.object({
    kind: z.literal('alert'),
    /** Unix ms. */
    openedAt: z.number().int(),
    resolvedAt: z.number().int().nullable(),
    title: z.string(),
  }),
  z.object({
    kind: z.literal('rule'),
    /** Unix s (the config revision). */
    ts: z.number().int(),
    enabled: z.boolean(),
    threshold: z.number(),
    /** The rule before, or null if this is the first revision. */
    before: z.object({ enabled: z.boolean(), threshold: z.number() }).nullable(),
  }),
  z.object({
    /** A new plant in the pot (A12): the end of one chapter, the start of the next. */
    kind: z.literal('chapter'),
    /** Unix ms. */
    at: z.number().int(),
    /** The plant that was there until then. */
    before: z.object({ name: plantName.nullable(), sownAt: isoDay.nullable() }),
  }),
  z.object({
    /**
     * An event of a type the hub does not know (D108), from a newer device:
     * shown as a neutral line, so nothing is silently lost. A pot's when it
     * names one, the greenhouse's otherwise.
     */
    kind: z.literal('device'),
    /** Unix s. */
    ts: z.number().int(),
    type: z.string(),
  }),
]);
export type JournalEvent = z.infer<typeof journalEvent>;

export const plantJournal = z.object({
  entries: z.array(journalEntry),
  // A kind of line from a newer hub is left out, not a failed journal (A5, D108).
  events: z
    .array(z.unknown())
    .transform((items) =>
      items.flatMap((item) => {
        const parsed = journalEvent.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});
export type PlantJournal = z.infer<typeof plantJournal>;

/** What the hub keeps on disk (Ajustes › Acerca de). */
export const hubStorage = z.object({
  databaseBytes: z.number().int().nonnegative(),
  photos: z.object({
    count: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  }),
  backupsBytes: z.number().int().nonnegative(),
  /** Photos stored in the last 30 days: what a month costs. */
  photosLast30DaysBytes: z.number().int().nonnegative(),
  /**
   * The newest nightly backup: its day (null if none yet), the photos it
   * refers to, and how many of them are not in the backups' photo folder.
   */
  backup: z
    .object({
      day: z.string().nullable(),
      photos: z.number().int().nonnegative(),
      missing: z.number().int().nonnegative(),
    })
    .optional(),
});
export type HubStorage = z.infer<typeof hubStorage>;

// ───────────────────────────────────────────── outdoor weather (A10, D97)

/** The hub's two weather rules, each switched in Ajustes › Tiempo exterior. */
export const weatherRules = z.object({
  /** Close the window when it rains or the wind is strong (heat protection wins). */
  closeWindow: z.boolean(),
  /** A notification in the evening when AEMET forecasts frost tonight. */
  frostWarning: z.boolean(),
});
export type WeatherRules = z.infer<typeof weatherRules>;

export const weatherRulesUpdate = z
  .strictObject({ closeWindow: z.boolean(), frostWarning: z.boolean() })
  .partial();
export type WeatherRulesUpdate = z.infer<typeof weatherRulesUpdate>;

/**
 * What the hub knows of the weather, and why not when it does not:
 * - `no-key`: no AEMET key in .env;
 * - `starting`: the key is there, nothing fetched yet;
 * - `failing`: the last attempts failed (`error` says how); what it had is kept;
 * - `ok`.
 */
export const weatherState = z.object({
  status: z.enum(['no-key', 'starting', 'failing', 'ok']),
  error: z.enum(['unauthorized', 'limit', 'unavailable', 'no-data', 'invalid']).nullable(),
  /** Unix ms of the first failure in a row, while failing. */
  failingSince: z.number().int().nullable(),
  /** Unix ms of the last answer from AEMET. */
  lastSuccessAt: z.number().int().nullable(),
  /** What the hub publishes on `weather`, or null if it has nothing. */
  weather: weatherMessage.nullable(),
  rules: weatherRules,
  /**
   * The outdoor hold now, as the device reports it: `asking` (sent, not yet
   * in force), `holding` (window closed, fan only), `held-by-heat` (heat
   * protection keeps the window open), `left-open` (the person opened it
   * during the hold: left alone), `idle` (no hold).
   */
  window: z.object({
    state: z.enum(['idle', 'asking', 'holding', 'held-by-heat', 'left-open']),
    cause: weatherCause.nullable(),
    /** Unix ms of the last change. */
    at: z.number().int().nullable(),
  }),
});
export type WeatherState = z.infer<typeof weatherState>;

/** Observed outdoor weather over a span (for the history), oldest first. */
export const weatherHistory = z.array(
  z.object({
    /** Unix s. */
    at: z.number().int(),
    station: z.string(),
    /** "MADRID RETIRO", as AEMET names it (A11). */
    stationName: z.string().optional(),
    temp: z.number().nullable(),
    rh: z.number().nullable(),
    windSpeed: z.number().nullable(),
    windGust: z.number().nullable(),
    precip: z.number().nullable(),
  }),
);
export type WeatherHistory = z.infer<typeof weatherHistory>;
