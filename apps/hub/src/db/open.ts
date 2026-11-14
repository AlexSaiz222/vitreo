import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema.ts';

/** The hub's own database, on better-sqlite3: backups and shutdown need its client. */
export type NodeHubDatabase = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

/** A restarting hub may wait briefly for the previous one to let go. */
const LOCK_WAIT_MS = 3_000;
const MIGRATIONS = path.resolve(import.meta.dirname, '../../drizzle');

/**
 * Opens the live database (A4, D87): WAL for safe writes, foreign keys on,
 * and an EXCLUSIVE lock held while the hub runs, so no other process (a
 * second hub, a restore) can open the same file at the same time; it gets
 * "database is locked" instead. Applies the committed migrations.
 */
export function openDatabase(file: string): NodeHubDatabase {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file, { timeout: LOCK_WAIT_MS });
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('locking_mode = EXCLUSIVE');
    // Take the lock now (the first write does it), not on the first message.
    sqlite.exec('BEGIN IMMEDIATE; COMMIT;');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS });
    return db;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
