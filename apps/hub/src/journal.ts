import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { hasJpegMetadata } from '@vitreo/shared';
import type { HubStorage } from '@vitreo/shared';

import { listBackups } from './backup.ts';
import type { HubDatabase } from './db/types.ts';
import { cleanJpeg, JournalCore, photoName } from './journalCore.ts';
import type { BackupCheck } from './journalCore.ts';

/**
 * The journal on the hub (A8, D93): the database part is JournalCore; here,
 * the photos as files next to the database, their mirror in the backups
 * folder, and what all of it takes on disk.
 */

export { DELETED_KEPT_MS, JournalError, photoName } from './journalCore.ts';
export type { BackupCheck, BackupReport } from './journalCore.ts';

/** The shared stripper, with the hub's error (a 400 for the client). */
export function stripJpegMetadata(input: Uint8Array): Buffer {
  return Buffer.from(cleanJpeg(input));
}

export { hasJpegMetadata };

function dirBytes(dir: string): { count: number; bytes: number } {
  if (!existsSync(dir)) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = dirBytes(file);
      count += inner.count;
      bytes += inner.bytes;
    } else {
      count += 1;
      bytes += statSync(file).size;
    }
  }
  return { count, bytes };
}

/**
 * The photo files a hub database refers to: every photo entry, deleted ones
 * too (they can still be brought back). Read-only; a database from before
 * the journal (A8) refers to none.
 */
export function photosIn(file: string): string[] {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const table = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'journal_entries'")
      .get();
    if (!table) return [];
    const rows = db.prepare("SELECT id FROM journal_entries WHERE kind = 'photo'").all() as {
      id: string;
    }[];
    return rows.map((row) => photoName(row.id));
  } finally {
    db.close();
  }
}

/** Is the newest backup whole: every photo it refers to, in the mirror? */
export function checkLatestBackup(backupDir: string): BackupCheck {
  const latest = listBackups(backupDir)[0];
  if (!latest) return { day: null, photos: 0, missing: 0 };
  const names = photosIn(latest.file);
  const mirror = path.join(backupDir, 'photos');
  const missing = names.filter((name) => !existsSync(path.join(mirror, name))).length;
  return { day: latest.day, photos: names.length, missing };
}

export class Journal extends JournalCore {
  constructor(
    db: HubDatabase,
    device: string,
    private readonly options: { photoDir: string; database: string; backupDir: string },
  ) {
    super(db, device);
  }

  /** Where the nightly backups and the photos' mirror are. */
  get backupDir(): string {
    return this.options.backupDir;
  }

  photoPath(id: string): string {
    return path.join(this.options.photoDir, photoName(id));
  }

  protected writePhoto(id: string, bytes: Uint8Array): void {
    mkdirSync(this.options.photoDir, { recursive: true });
    writeFileSync(this.photoPath(id), bytes);
  }

  protected readPhoto(id: string): Uint8Array | null {
    const file = this.photoPath(id);
    return existsSync(file) ? readFileSync(file) : null;
  }

  protected removePhoto(id: string): void {
    rmSync(this.photoPath(id), { force: true });
  }

  /** The photo file, if the entry exists and is not deleted. */
  photoFile(id: string): string | null {
    if (!this.isShownPhoto(id)) return null;
    const file = this.photoPath(id);
    return existsSync(file) ? file : null;
  }

  clear(): void {
    rmSync(this.options.photoDir, { recursive: true, force: true });
  }

  /** What the hub keeps on disk, and what a month of photos costs. */
  storage(now: number): HubStorage {
    const database = this.options.database;
    const size = (file: string) => (existsSync(file) ? statSync(file).size : 0);
    return {
      databaseBytes: database === ':memory:' ? 0 : size(database) + size(`${database}-wal`),
      photos: dirBytes(this.options.photoDir),
      backupsBytes: dirBytes(this.options.backupDir).bytes,
      photosLast30DaysBytes: this.recentPhotoBytes(now),
    };
  }

  /** And the check of the newest backup. */
  storageReport(now: number): HubStorage {
    return { ...this.storage(now), backup: checkLatestBackup(this.backupDir) };
  }

  /**
   * Copies the photos into the backups folder (nightly, next to the database
   * copies), so a restore (pnpm hub:restore) brings them back. A photo leaves
   * that folder only when no database refers to it any more: neither the
   * live one nor any of the kept backups. A photo lost from the volume is
   * therefore never lost from the backups too.
   */
  backupPhotos(): { copied: number; removed: number } {
    const from = this.options.photoDir;
    const to = path.join(this.options.backupDir, 'photos');
    mkdirSync(to, { recursive: true });
    const live = existsSync(from) ? new Set(readdirSync(from)) : new Set<string>();
    let copied = 0;
    let removed = 0;
    for (const name of live) {
      const source = path.join(from, name);
      const target = path.join(to, name);
      if (existsSync(target) && statSync(target).size === statSync(source).size) continue;
      // Whole or not at all: a copy cut halfway is never taken for the photo.
      const partial = `${target}.partial`;
      copyFileSync(source, partial);
      renameSync(partial, target);
      copied++;
    }
    const wanted = new Set([
      ...this.photoNames(),
      ...listBackups(this.options.backupDir).flatMap((backup) => photosIn(backup.file)),
    ]);
    for (const name of readdirSync(to)) {
      if (name.endsWith('.partial') || (!live.has(name) && !wanted.has(name))) {
        rmSync(path.join(to, name));
        if (!name.endsWith('.partial')) removed++;
      }
    }
    return { copied, removed };
  }
}

/** After restoring a database: the photos it knows, back from the backup folder. */
export function restorePhotos(backupDir: string, photoDir: string): number {
  const from = path.join(backupDir, 'photos');
  if (!existsSync(from)) return 0;
  mkdirSync(photoDir, { recursive: true });
  let restored = 0;
  for (const name of readdirSync(from)) {
    const target = path.join(photoDir, name);
    if (!existsSync(target)) {
      copyFileSync(path.join(from, name), target);
      restored++;
    }
  }
  return restored;
}
