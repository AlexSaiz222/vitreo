import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { NodeHubDatabase } from './db/open.ts';

/** Nightly backups kept (D77). */
export const BACKUPS_KEPT = 7;
const NAME = /^hub-(\d{4}-\d{2}-\d{2})\.sqlite$/;

/** YYYY-MM-DD and hour in a time zone. */
export function localDay(now: Date, timeZone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

export function listBackups(dir: string): { file: string; day: string; bytes: number }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, match: NAME.exec(name) }))
    .filter((entry) => entry.match !== null)
    .map(({ name, match }) => {
      const file = path.join(dir, name);
      return { file, day: match?.[1] ?? '', bytes: statSync(file).size };
    })
    .sort((a, b) => b.day.localeCompare(a.day));
}

/** Is this file a sound hub database? Throws with the reason if not. */
export function checkDatabase(file: string): void {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma('quick_check', { simple: true });
    if (result !== 'ok') throw new Error(`integrity check failed: ${String(result)}`);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'telemetry'")
      .all();
    if (tables.length === 0) throw new Error('not a Vitreo hub database');
  } finally {
    db.close();
  }
}

const quoted = (file: string) => `'${file.replaceAll("'", "''")}'`;

/**
 * Writes today's backup, checks it, and keeps the newest BACKUPS_KEPT.
 * `VACUUM INTO` makes a consistent, compact copy in rollback-journal mode: a
 * plain file that needs no WAL or shared memory on the Windows folder.
 * Written to a temporary name first, so a half-written file is never taken
 * for a backup.
 */
export function backupNow(db: NodeHubDatabase, dir: string, day: string): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `hub-${day}.sqlite`);
  const partial = `${file}.partial`;
  rmSync(partial, { force: true });
  db.$client.exec(`VACUUM INTO ${quoted(partial)}`);
  checkDatabase(partial);
  renameSync(partial, file);
  for (const old of listBackups(dir).slice(BACKUPS_KEPT)) rmSync(old.file);
  return file;
}

/**
 * Is a backup due? One a day, at 03:00 in the greenhouse's time zone or at
 * the first chance after (the PC is often off at night).
 */
export function backupDue(dir: string, now: Date, timeZone: string): string | null {
  const { day, hour } = localDay(now, timeZone);
  if (hour < 3) return null;
  return listBackups(dir).some((backup) => backup.day === day) ? null : day;
}

/**
 * Replaces the database with a backup (docs/05, "Restaurar"). The hub must be
 * stopped: the live file is opened with an exclusive lock first, which fails
 * while a hub holds it. Safe at every step: the backup is copied next to the
 * live file and checked, the live file is copied aside (into `keepDir`, which
 * may be another disk), and only then swapped in with an atomic rename.
 * Returns where the replaced database was kept.
 */
export function restoreBackup(backup: string, database: string, keepDir: string): string {
  checkDatabase(backup);
  mkdirSync(path.dirname(database), { recursive: true });
  const incoming = `${database}.restoring`;
  rmSync(incoming, { force: true });
  const source = new Database(backup, { readonly: true });
  try {
    source.exec(`VACUUM INTO ${quoted(incoming)}`);
  } finally {
    source.close();
  }
  checkDatabase(incoming);

  let kept = '';
  if (existsSync(database)) {
    const live = new Database(database, { fileMustExist: true, timeout: 0 });
    try {
      // Fails with "database is locked" while the hub is running.
      live.exec('BEGIN EXCLUSIVE; COMMIT;');
      // Fold the WAL into the file, so nothing is left behind to replay.
      live.pragma('wal_checkpoint(TRUNCATE)');
    } catch (error) {
      rmSync(incoming, { force: true });
      throw error;
    } finally {
      live.close();
    }
    mkdirSync(keepDir, { recursive: true });
    kept = path.join(keepDir, `replaced-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    copyFileSync(database, kept);
  }
  rmSync(`${database}-wal`, { force: true });
  rmSync(`${database}-shm`, { force: true });
  renameSync(incoming, database);
  return kept;
}
