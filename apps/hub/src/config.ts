import path from 'node:path';

import { z } from 'zod';

/**
 * Where the hub runs (A4, D87):
 * - `service`: in Docker (infra/docker-compose.yml). The live database is in a
 *   named volume (fast, reliable locking), never on a Windows folder.
 * - `dev`: `pnpm --filter @vitreo/hub dev` on the PC, with its own database in
 *   data/hub-dev/, its own MQTT session and its own greenhouse (`dev`), so it
 *   can never open the live database nor publish another hub's config.
 * - `test`: the e2e hub (playwright.config.ts), with a throwaway database.
 */
const mode = z.enum(['service', 'dev', 'test']);
export type HubMode = z.infer<typeof mode>;

const ROOT = path.resolve(import.meta.dirname, '../../..');

const configSchema = z.object({
  HUB_MODE: mode.default('dev'),
  HUB_HOST: z.string().min(1).default('127.0.0.1'),
  HUB_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  /** The dev hub's own port, so it can run next to the Docker one. */
  HUB_DEV_PORT: z.coerce.number().int().min(1).max(65_535).default(8797),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** The greenhouse this hub owns (history and config). */
  HUB_DEVICE_ID: z.string().min(1).optional(),
  HUB_DEV_DEVICE_ID: z.string().min(1).default('dev'),
  HUB_TZ: z.string().min(1).default('Europe/Madrid'),
  HUB_MQTT_URL: z.string().min(1).default('mqtt://localhost:1883'),
  MQTT_HUB_PASSWORD: z.string().min(1).optional(),
  /** The live database. Defaults by mode (see above). */
  HUB_DB: z.string().min(1).optional(),
  /**
   * Where backups/ (nightly) and archive/ (monthly raw telemetry) go: a
   * folder Windows can see (data/hub/ for the Docker hub).
   */
  HUB_OUT_DIR: z.string().min(1).optional(),
  /**
   * Web push (A7): the VAPID key pair, only in .env (`pnpm hub:vapid` makes
   * one). Without it the hub keeps warnings but sends no notifications.
   */
  HUB_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  HUB_VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  /** Who sends them, for the push services (a mailto: or https: address). */
  HUB_VAPID_SUBJECT: z.string().min(1).default('mailto:vitreo@localhost'),
  /**
   * Outdoor weather (A10, D97): the AEMET OpenData key, only in .env.
   * Without it the hub fetches nothing and the app shows no weather.
   */
  AEMET_API_KEY: z.string().trim().optional(),
  /** The municipality for the hourly forecast (INE code): Madrid. */
  AEMET_MUNICIPIO: z
    .string()
    .regex(/^\d{5}$/)
    .default('28079'),
  /** A station (idema) to observe; empty: the nearest to the greenhouse. */
  AEMET_ESTACION: z.string().trim().optional(),
  /** AEMET OpenData's address (tests point it at a fake). */
  AEMET_URL: z.url().default('https://opendata.aemet.es/opendata'),
  /** First location only (D79): later it is edited in Ajustes › Ubicación. */
  VITE_LOCATION_LAT: z.coerce.number().min(-90).max(90).default(40.42),
  VITE_LOCATION_LNG: z.coerce.number().min(-180).max(180).default(-3.7),
});

export interface HubConfig {
  mode: HubMode;
  host: string;
  port: number;
  logLevel: string;
  deviceId: string;
  timeZone: string;
  mqtt: { url: string; username: string; password: string | undefined; clientId: string };
  database: string;
  backupDir: string;
  archiveDir: string;
  /** The journal's photos (A8): next to the database, in the Docker volume. */
  photoDir: string;
  seedLocation: { lat: number; lng: number };
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
  aemet: { key: string | null; municipality: string; station: string | null; url: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const parsed = configSchema.parse(env);
  const deviceId =
    parsed.HUB_MODE === 'dev' ? parsed.HUB_DEV_DEVICE_ID : (parsed.HUB_DEVICE_ID ?? 'sim');
  const defaults = {
    service: { db: '/var/lib/vitreo/hub.sqlite', out: '/out', photos: '/var/lib/vitreo/photos' },
    dev: {
      db: path.join(ROOT, 'data/hub-dev/hub-dev.sqlite'),
      out: path.join(ROOT, 'data/hub-dev'),
      photos: path.join(ROOT, 'data/hub-dev/photos'),
    },
    // One folder per test greenhouse: parallel e2e workers never share one.
    test: {
      db: ':memory:',
      out: path.join(ROOT, 'data/hub-test', deviceId),
      photos: path.join(ROOT, 'data/hub-test', deviceId, 'photos'),
    },
  }[parsed.HUB_MODE];
  return {
    mode: parsed.HUB_MODE,
    host: parsed.HUB_HOST,
    port: parsed.HUB_MODE === 'dev' ? parsed.HUB_DEV_PORT : parsed.HUB_PORT,
    logLevel: parsed.LOG_LEVEL,
    deviceId,
    timeZone: parsed.HUB_TZ,
    mqtt: {
      url: parsed.HUB_MQTT_URL,
      username: 'hub',
      password: parsed.MQTT_HUB_PASSWORD,
      // Fixed per mode and greenhouse: the broker keeps this session's queue
      // while the hub restarts (D87). Different modes never share a session.
      clientId: `vitreo-hub-${parsed.HUB_MODE}-${deviceId}`,
    },
    database: parsed.HUB_DB ?? defaults.db,
    backupDir: path.join(parsed.HUB_OUT_DIR ?? defaults.out, 'backups'),
    archiveDir: path.join(parsed.HUB_OUT_DIR ?? defaults.out, 'archive'),
    photoDir: defaults.photos,
    seedLocation: { lat: parsed.VITE_LOCATION_LAT, lng: parsed.VITE_LOCATION_LNG },
    vapid:
      parsed.HUB_VAPID_PUBLIC_KEY && parsed.HUB_VAPID_PRIVATE_KEY
        ? {
            publicKey: parsed.HUB_VAPID_PUBLIC_KEY,
            privateKey: parsed.HUB_VAPID_PRIVATE_KEY,
            subject: parsed.HUB_VAPID_SUBJECT,
          }
        : null,
    aemet: {
      // The e2e hubs never call AEMET, even with a key in .env: tests put weather in.
      key: parsed.HUB_MODE !== 'test' && parsed.AEMET_API_KEY ? parsed.AEMET_API_KEY : null,
      municipality: parsed.AEMET_MUNICIPIO,
      // Empty in .env means "choose the nearest".
      station:
        parsed.AEMET_ESTACION === undefined || parsed.AEMET_ESTACION === ''
          ? null
          : parsed.AEMET_ESTACION,
      url: parsed.AEMET_URL.replace(/\/+$/, ''),
    },
  };
}
