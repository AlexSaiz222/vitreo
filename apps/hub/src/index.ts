import path from 'node:path';

import { backupDue, backupNow, localDay } from './backup.ts';
import { loadConfig } from './config.ts';
import { ConfigOwner, posixTimeZone } from './configOwner.ts';
import { openDatabase } from './db/open.ts';
import { ensurePlants, readSettings } from './db/store.ts';
import { loadRootEnv } from './env.ts';
import { archiveOldTelemetry, archiveRejected } from './archive.ts';
import { hourOf, hoursToCatchUp, summariseHours } from './history.ts';
import { AlertEngine, snapshotFrom } from './alerts.ts';
import { publishCommand, publishConfig, publishWeather, startIngest } from './mqtt.ts';
import { checkLatestBackup, Journal } from './journal.ts';
import type { BackupReport } from './journal.ts';
import { PushSender } from './push.ts';
import { buildServer } from './server.ts';
import { WeatherRuleEngine } from './weather/rules.ts';
import { WeatherService } from './weather/service.ts';

const SUMMARY_EVERY_MS = 60_000;
const DAILY_CHECK_EVERY_MS = 10 * 60_000;
/** Warnings are looked at this often (a notification in about a minute at most). */
const ALERTS_EVERY_MS = 30_000;

loadRootEnv();
const config = loadConfig();
const startedAt = Date.now();
// Fails at once ("database is locked") if another hub has this file open.
const db = openDatabase(config.database);
ensurePlants(db, config.deviceId, startedAt);

let ingest: ReturnType<typeof startIngest> | null = null;
const owner = new ConfigOwner(db, config.deviceId, {
  timeZone: config.timeZone,
  location: () =>
    readSettings(db, { location: config.seedLocation, timeZone: config.timeZone }, Date.now())
      .location,
  publish: (next) => {
    if (ingest) publishConfig(ingest.client, config.deviceId, next);
  },
});

// The plants' journal (A8, D93): photos next to the database.
const journal = new Journal(db, config.deviceId, {
  photoDir: config.photoDir,
  database: config.database,
  backupDir: config.backupDir,
});

// Warnings and web push (A7, D91): the e2e hub records instead of sending.
const push = new PushSender(
  db,
  config.deviceId,
  { keys: config.vapid, dryRun: config.mode === 'test' },
  // Called later, once the server (and its logger) exists.
  (message) => {
    server.log.warn(message);
  },
);
const alerts = new AlertEngine(db, config.deviceId, push, {
  timeZone: config.timeZone,
  startedAt,
});
// Outdoor weather from AEMET and the hub's weather rules (A10, D97).
const weather = new WeatherService(db, config.deviceId, {
  aemet: config.aemet,
  timeZone: config.timeZone,
  location: () =>
    readSettings(db, { location: config.seedLocation, timeZone: config.timeZone }, Date.now())
      .location,
  publish: (message) => {
    if (ingest) publishWeather(ingest.client, config.deviceId, message);
  },
  log: (message) => {
    server.log.info(message);
  },
});
const weatherRules = new WeatherRuleEngine(db, config.deviceId, {
  weather: (now) => weather.message(now),
  sendCommand: (command) => {
    if (ingest) publishCommand(ingest.client, config.deviceId, command);
  },
  push,
  timeZone: config.timeZone,
  log: (message) => {
    server.log.info(message);
  },
});
const evaluateWeatherRules = () => {
  void weatherRules.evaluate(Date.now()).catch((error: unknown) => {
    server.log.error(error, 'weather rules failed');
  });
};
// The e2e hub evaluates when a test asks (like the alerts).
if (config.mode !== 'test') weather.onChange = evaluateWeatherRules;

const server = buildServer(
  {
    db,
    owner,
    device: config.deviceId,
    timeZone: config.timeZone,
    seedLocation: config.seedLocation,
    startedAt,
    mqttConnected: () => ingest?.connected() ?? false,
    testing: config.mode === 'test',
    push,
    alerts,
    journal,
    weather,
    weatherRules,
    // On demand (pnpm hub:backup); the e2e hub has nothing to back up.
    ...(config.mode === 'test'
      ? {}
      : { backup: () => backup(localDay(new Date(), config.timeZone).day) }),
  },
  { logLevel: config.logLevel },
);
const log = (message: string) => {
  server.log.info(message);
};
if (!posixTimeZone(config.timeZone)) {
  server.log.warn(`no POSIX rule for ${config.timeZone}: the device schedules will use UTC`);
}
log(`hub (${config.mode}) for ${config.deviceId}, database ${config.database}`);

// Hours touched by new telemetry: summarised every minute.
const dirty = new Set<number>(hoursToCatchUp(db, config.deviceId));
if (!config.aemet.key && config.mode !== 'test') {
  server.log.warn('no AEMET_API_KEY in .env: no outdoor weather');
}
if (!config.vapid && config.mode !== 'test') {
  server.log.warn('no VAPID keys in .env: warnings are kept but no notifications are sent');
}
const evaluateAlerts = () => {
  void alerts.evaluate(snapshotFrom(db, config.deviceId, Date.now())).catch((error: unknown) => {
    server.log.error(error, 'alerts failed');
  });
};

// Messages queued while the hub was away carry their own time: their hour.
ingest = startIngest(
  config,
  db,
  owner,
  log,
  (ts) => dirty.add(hourOf(ts)),
  (limit) => void alerts.oneOff(limit, Date.now()),
);

const summarise = () => {
  if (dirty.size === 0) return;
  const hours = [...dirty];
  dirty.clear();
  summariseHours(db, config.deviceId, hours);
};

/**
 * A backup now (D77, A8): summaries up to date, old readings archived, the
 * database copied, the journal's photos with it, and the result checked. The
 * nightly job runs it, and `pnpm hub:backup` asks for one on demand.
 */
const backup = (day: string): BackupReport => {
  summarise();
  const archived = archiveOldTelemetry(
    db,
    config.deviceId,
    config.archiveDir,
    Math.floor(Date.now() / 1000),
  );
  // Invalid messages too (A12), so a sensor sending nonsense is kept as such.
  const refused = archiveRejected(db, config.archiveDir, Math.floor(Date.now() / 1000));
  const file = backupNow(db, config.backupDir, day);
  // Deleted photos go after 7 days; the backups keep them while they refer to them.
  const purged = journal.purge(Date.now());
  const photos = journal.backupPhotos();
  const check = checkLatestBackup(config.backupDir);
  log(
    `photos backed up (${photos.copied.toString()} new, ${photos.removed.toString()} removed, ${purged.toString()} purged)`,
  );
  log(
    `backup ${file}${archived > 0 ? `, ${archived.toString()} readings archived` : ''}${refused > 0 ? `, ${refused.toString()} invalid messages archived` : ''}`,
  );
  if (check.missing > 0) {
    server.log.warn(
      `backup ${day} refers to ${check.missing.toString()} photo(s) that are not in ${config.backupDir}/photos`,
    );
  }
  return { file: path.basename(file), copied: photos.copied, removed: photos.removed, ...check };
};

const daily = () => {
  const day = backupDue(config.backupDir, new Date(), config.timeZone);
  if (!day) return;
  try {
    backup(day);
  } catch (error) {
    server.log.error(error, 'daily backup failed');
  }
};

summarise();
const timers = [setInterval(summarise, SUMMARY_EVERY_MS)];
// The e2e hub evaluates when a test asks (a fake clock), not on its own.
if (config.mode !== 'test') {
  timers.push(setInterval(evaluateAlerts, ALERTS_EVERY_MS));
  // The window rule also follows the window (opened by hand or by heat).
  timers.push(setInterval(evaluateWeatherRules, ALERTS_EVERY_MS));
}
weather.start();
// The e2e hub's database is thrown away: nothing to back up.
if (config.mode !== 'test') {
  daily();
  timers.push(setInterval(daily, DAILY_CHECK_EVERY_MS));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    for (const timer of timers) clearInterval(timer);
    weather.stop();
    summarise();
    void Promise.all([server.close(), ingest.stop()]).then(() => {
      db.$client.close();
      process.exit(0);
    });
  });
}

await server.listen({ host: config.host, port: config.port });
