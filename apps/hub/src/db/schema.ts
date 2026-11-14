import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * The hub's history (A4, D87). Raw telemetry is kept 30 days, then archived
 * by month (compressed, outside the database) and deleted; hourly summaries,
 * events, commands, acks, status changes and config revisions stay forever
 * (D77). Every action keeps its `source` (docs/12). Times: `ts` is the
 * device's (Unix s); `receivedAt` is the hub's (Unix ms).
 *
 * QoS 1 delivers at least once, and retained messages come again on every
 * new subscription: the unique indexes make a repeat a no-op.
 */

export const telemetry = sqliteTable(
  'telemetry',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    device: text('device').notNull(),
    ts: integer('ts').notNull(),
    receivedAt: integer('received_at').notNull(),
    airTemp: real('air_temp'),
    airRh: real('air_rh'),
    lux: real('lux'),
    tank: real('tank'),
    pump: integer('pump', { mode: 'boolean' }).notNull(),
    growLight: integer('grow_light', { mode: 'boolean' }).notNull(),
    fan: integer('fan', { mode: 'boolean' }).notNull(),
    vent: real('vent').notNull(),
    fw: text('fw'),
    rssi: integer('rssi'),
    /** The message as received (raw, for docs/12). */
    raw: text('raw').notNull(),
  },
  (t) => [uniqueIndex('telemetry_device_ts').on(t.device, t.ts)],
);

export const soil = sqliteTable(
  'soil',
  {
    telemetryId: integer('telemetry_id')
      .notNull()
      .references(() => telemetry.id, { onDelete: 'cascade' }),
    device: text('device').notNull(),
    ts: integer('ts').notNull(),
    zone: text('zone').notNull(),
    /** Null: the sensor gave no reading (never invented, D20). */
    moisture: real('moisture'),
    /** Calibration version (D20). */
    cal: integer('cal'),
  },
  (t) => [
    index('soil_device_zone_ts').on(t.device, t.zone, t.ts),
    // The hourly summaries and the rewind read one device by time, all pots at once.
    index('soil_device_ts').on(t.device, t.ts),
  ],
);

/** Hourly summaries, kept forever: one row per hour, metric and zone. */
export const hourly = sqliteTable(
  'hourly',
  {
    device: text('device').notNull(),
    /** Unix s at the start of the hour (UTC). */
    hour: integer('hour').notNull(),
    /** air_temp, air_rh, lux, tank, soil, pump, grow_light, fan, vent. */
    metric: text('metric').notNull(),
    /** For soil; '' otherwise (part of the key). */
    zone: text('zone').notNull().default(''),
    count: integer('count').notNull(),
    mean: real('mean'),
    min: real('min'),
    max: real('max'),
  },
  (t) => [primaryKey({ columns: [t.device, t.hour, t.metric, t.zone] })],
);

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    device: text('device').notNull(),
    ts: integer('ts').notNull(),
    receivedAt: integer('received_at').notNull(),
    type: text('type').notNull(),
    source: text('source'),
    zone: text('zone'),
    requestId: text('request_id'),
    raw: text('raw').notNull(),
  },
  (t) => [
    index('events_device_ts').on(t.device, t.ts),
    uniqueIndex('events_device_raw').on(t.device, t.raw),
  ],
);

/** Orders seen on the broker, from the app, the hub or an agent. */
export const commands = sqliteTable(
  'commands',
  {
    requestId: text('request_id').notNull(),
    device: text('device').notNull(),
    receivedAt: integer('received_at').notNull(),
    source: text('source').notNull(),
    action: text('action').notNull(),
    raw: text('raw').notNull(),
  },
  (t) => [primaryKey({ columns: [t.device, t.requestId] })],
);

export const acks = sqliteTable(
  'acks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    device: text('device').notNull(),
    requestId: text('request_id').notNull(),
    ts: integer('ts').notNull(),
    receivedAt: integer('received_at').notNull(),
    result: text('result').notNull(),
    reason: text('reason'),
    raw: text('raw').notNull(),
  },
  (t) => [
    index('acks_device_request').on(t.device, t.requestId),
    uniqueIndex('acks_device_raw').on(t.device, t.raw),
  ],
);

export const statusChanges = sqliteTable(
  'status_changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    device: text('device').notNull(),
    receivedAt: integer('received_at').notNull(),
    state: text('state').notNull(),
  },
  (t) => [index('status_device_at').on(t.device, t.receivedAt)],
);

/** Every config this hub owned (D73), and whether the device confirmed it. */
export const configRevisions = sqliteTable(
  'config_revisions',
  {
    device: text('device').notNull(),
    rev: integer('rev').notNull(),
    ts: integer('ts').notNull(),
    /** default (created by the hub), adopted (found retained), api (edited). */
    origin: text('origin').notNull(),
    raw: text('raw').notNull(),
    appliedAt: integer('applied_at'),
    /** The device refused it (`config.rejected`, A6): when and why. */
    rejectedAt: integer('rejected_at'),
    rejectReason: text('reject_reason'),
  },
  (t) => [primaryKey({ columns: [t.device, t.rev] })],
);

/** The plants by zone (stable ids): the name the person gave, the sowing day. */
export const plants = sqliteTable('plants', {
  zone: text('zone').primaryKey(),
  device: text('device').notNull(),
  kind: text('kind').notNull(),
  name: text('name'),
  sownAt: text('sown_at'),
  /** When this plant came to its pot (Unix ms, A12); null = there from the start. */
  since: integer('since'),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * The plants that were in a pot before the one there now (A12): a new plant
 * closes the chapter of the last one, so each pot's history says which
 * plant it is about (docs/12). Kept forever.
 */
export const plantChapters = sqliteTable(
  'plant_chapters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    device: text('device').notNull(),
    zone: text('zone').notNull(),
    kind: text('kind').notNull(),
    name: text('name'),
    sownAt: text('sown_at'),
    /** Unix ms; null = there from the start. */
    startedAt: integer('started_at'),
    endedAt: integer('ended_at').notNull(),
  },
  (t) => [index('plant_chapters_zone').on(t.device, t.zone, t.endedAt)],
);

/** Small settings of the greenhouse, as JSON: location, time zone. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** Messages that failed validation: kept (bounded) to see what went wrong. */
export const rejected = sqliteTable('rejected', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  receivedAt: integer('received_at').notNull(),
  topic: text('topic').notNull(),
  payload: text('payload').notNull(),
  error: text('error').notNull(),
});

/** Bookkeeping of the jobs (last hour summarised, last archive, last backup). */
export const jobs = sqliteTable('jobs', {
  name: text('name').primaryKey(),
  value: integer('value').notNull(),
});

/**
 * Warnings as incidents (A7, D91): one per situation while it lasts, with
 * when it was told and when it cleared. Kept forever, like events.
 */
export const incidents = sqliteTable(
  'incidents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    device: text('device').notNull(),
    /** The situation, stable while it lasts: `tank_low`, `thirsty:basil_01`, `no_data`… */
    key: text('key').notNull(),
    /** tank, safety, no_data, thirsty (what Ajustes › Avisos switches). */
    type: text('type').notNull(),
    critical: integer('critical', { mode: 'boolean' }).notNull(),
    zone: text('zone'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    url: text('url').notNull(),
    openedAt: integer('opened_at').notNull(),
    /** First notification sent (null: not yet, e.g. waiting for quiet hours to end). */
    notifiedAt: integer('notified_at'),
    lastNotifiedAt: integer('last_notified_at'),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [index('incidents_device_open').on(t.device, t.resolvedAt)],
);

/** Web push subscriptions (A7): one per browser that turned warnings on. */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  device: text('device').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  /** The types this browser wants, JSON array. */
  types: text('types').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * A plant's journal (A8, D93): notes and photos. The photo itself is a file
 * next to the database (in the Docker volume), named by the entry's id.
 * Deleting is soft for 7 days ("Deshacer", and the nightly backups stay
 * coherent), then the row and the file go.
 */
export const journalEntries = sqliteTable(
  'journal_entries',
  {
    /** From the phone (a UUID): saving twice stores once. */
    id: text('id').primaryKey(),
    device: text('device').notNull(),
    zone: text('zone').notNull(),
    kind: text('kind').notNull(),
    text: text('text'),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes'),
    createdAt: integer('created_at').notNull(),
    savedAt: integer('saved_at').notNull(),
    deletedAt: integer('deleted_at'),
    /** Tags as a JSON array (A12): "watered", "refilled"… */
    tags: text('tags').notNull().default('[]'),
  },
  (t) => [index('journal_device_zone').on(t.device, t.zone, t.createdAt)],
);

/**
 * Outdoor weather (A10, D97): AEMET's observations at the station nearest
 * the greenhouse, next to the telemetry (docs/12: raw, with its source).
 * One row an hour, kept forever. `at` is AEMET's (Unix s, UTC);
 * `receivedAt` the hub's (Unix ms). SI units; null = not given.
 */
export const weatherObservations = sqliteTable(
  'weather_observations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    device: text('device').notNull(),
    station: text('station').notNull(),
    stationName: text('station_name').notNull(),
    at: integer('at').notNull(),
    receivedAt: integer('received_at').notNull(),
    temp: real('temp'),
    rh: real('rh'),
    windSpeed: real('wind_speed'),
    windGust: real('wind_gust'),
    windDir: real('wind_dir'),
    precip: real('precip'),
    visibility: real('visibility'),
    /** The row as AEMET sent it. */
    raw: text('raw').notNull(),
  },
  (t) => [uniqueIndex('weather_obs_device_station_at').on(t.device, t.station, t.at)],
);

/** Each hourly forecast AEMET issued for the municipality (a few a day), as hours. */
export const weatherForecasts = sqliteTable(
  'weather_forecasts',
  {
    device: text('device').notNull(),
    municipality: text('municipality').notNull(),
    name: text('name').notNull(),
    issuedAt: integer('issued_at').notNull(),
    receivedAt: integer('received_at').notNull(),
    /** The hours, JSON (ForecastPoint[], wind in m/s). */
    points: text('points').notNull(),
  },
  (t) => [primaryKey({ columns: [t.device, t.municipality, t.issuedAt] })],
);
