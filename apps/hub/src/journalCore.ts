import {
  configMessage,
  GREENHOUSE_JOURNAL,
  JpegError,
  KNOWN_EVENT_TYPES,
  journalTag,
  MAX_PHOTO_BYTES,
  stripJpegMetadata as stripJpeg,
} from '@vitreo/shared';
import type {
  AutomationReason,
  HubStorage,
  JournalEntry,
  JournalEvent,
  JournalNote,
  JournalTag,
} from '@vitreo/shared';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, not } from 'drizzle-orm';

import { listChapters } from './db/store.ts';
import type { HubDatabase } from './db/types.ts';
import * as t from './db/schema.ts';

/**
 * A plant's journal (A8, D93): notes and photos, and the plant's story from
 * what the hub already keeps (waterings, warnings, rule changes).
 *
 * Privacy: the phone re-encodes every photo (which drops EXIF, GPS
 * included). The hub checks it is a JPEG and strips any metadata segment it
 * still finds, so no location is ever stored, even from another client.
 *
 * This is the part that only needs the database. Where the photos' bytes
 * live is the subclass's: files next to the database in the hub
 * (journal.ts), memory in the public demo.
 */

/** Deleted entries stay this long ("Deshacer", backups), then go for good. */
export const DELETED_KEPT_MS = 7 * 24 * 3_600_000;
/** How far back the plant's story reaches. */
const STORY_DAYS = 90;

export class JournalError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 413,
  ) {
    super(message);
  }
}

/** The shared stripper, with the hub's error (a 400 for the client). */
export function cleanJpeg(input: Uint8Array): Uint8Array {
  try {
    return stripJpeg(input);
  } catch (error) {
    if (error instanceof JpegError) throw new JournalError(error.message, 400);
    throw error;
  }
}

type Row = typeof t.journalEntries.$inferSelect;

/** The tags column, read leniently: an unknown tag (a newer hub's) is left out. */
function journalTags(raw: string): JournalTag[] {
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list)
      ? list.filter((tag): tag is JournalTag => journalTag.safeParse(tag).success)
      : [];
  } catch {
    return [];
  }
}

const toEntry = (row: Row): JournalEntry => ({
  id: row.id,
  zone: row.zone,
  kind: row.kind as JournalEntry['kind'],
  tags: journalTags(row.tags),
  text: row.text,
  photo:
    row.kind === 'photo' && row.width && row.height && row.bytes
      ? { width: row.width, height: row.height, bytes: row.bytes }
      : null,
  createdAt: row.createdAt,
  savedAt: row.savedAt,
});

/** A journal photo's file, in the volume and in the backups' mirror: named by its entry. */
export const photoName = (id: string): string => `${id}.jpg`;

export interface BackupCheck {
  /** The newest nightly backup (YYYY-MM-DD), or null if there is none. */
  day: string | null;
  /** Photos it refers to. */
  photos: number;
  /** Of those, the ones not in the mirror: a restore would not bring them back. */
  missing: number;
}

/** What a backup did, and the check of the newest one. */
export interface BackupReport extends BackupCheck {
  file: string;
  /** Photos copied into the mirror, and removed from it (no database refers to them). */
  copied: number;
  removed: number;
}

export abstract class JournalCore {
  constructor(
    protected readonly db: HubDatabase,
    protected readonly device: string,
  ) {}

  /** Keeps a photo's (clean) bytes. */
  protected abstract writePhoto(id: string, bytes: Uint8Array): void;
  /** A photo's bytes, or null if they are not there. */
  protected abstract readPhoto(id: string): Uint8Array | null;
  protected abstract removePhoto(id: string): void;
  /** The e2e hub starts again from nothing: its photos too. */
  abstract clear(): void;
  /** What the hub keeps (database, photos, backups), for Ajustes › Almacenamiento. */
  abstract storageReport(now: number): HubStorage;

  private get(id: string): Row | undefined {
    return this.db
      .select()
      .from(t.journalEntries)
      .where(and(eq(t.journalEntries.device, this.device), eq(t.journalEntries.id, id)))
      .get();
  }

  addNote(note: JournalNote, now: number): JournalEntry {
    this.db
      .insert(t.journalEntries)
      .values({
        id: note.id,
        device: this.device,
        zone: note.zone,
        kind: 'note',
        text: note.text === '' ? null : note.text,
        tags: JSON.stringify(note.tags),
        createdAt: note.createdAt,
        savedAt: now,
      })
      .onConflictDoNothing()
      .run();
    const row = this.get(note.id);
    if (!row) throw new JournalError('not saved', 400);
    return toEntry(row);
  }

  /** A photo (JPEG bytes): checked, stripped of metadata, stored once per id. */
  addPhoto(
    id: string,
    details: {
      zone: string;
      createdAt: number;
      width: number;
      height: number;
      caption?: string;
      tags?: readonly JournalTag[];
    },
    body: Uint8Array,
    now: number,
  ): JournalEntry {
    if (body.length > MAX_PHOTO_BYTES) throw new JournalError('photo too large', 413);
    const existing = this.get(id);
    if (existing) return toEntry(existing);
    const clean = cleanJpeg(body);
    this.writePhoto(id, clean);
    this.db
      .insert(t.journalEntries)
      .values({
        id,
        device: this.device,
        zone: details.zone,
        kind: 'photo',
        text: details.caption ?? null,
        tags: JSON.stringify(details.tags ?? []),
        width: details.width,
        height: details.height,
        bytes: clean.length,
        createdAt: details.createdAt,
        savedAt: now,
      })
      .run();
    const row = this.get(id);
    if (!row) throw new JournalError('not saved', 400);
    return toEntry(row);
  }

  /** Is this a photo entry, not deleted? */
  protected isShownPhoto(id: string): boolean {
    const row = this.get(id);
    return row?.kind === 'photo' && row.deletedAt === null;
  }

  /** The photo's bytes, if the entry exists and is not deleted. */
  photo(id: string): Uint8Array | null {
    return this.isShownPhoto(id) ? this.readPhoto(id) : null;
  }

  /** Deletes softly (kept 7 days for "Deshacer"). */
  remove(id: string, now: number): boolean {
    const result = this.db
      .update(t.journalEntries)
      .set({ deletedAt: now })
      .where(and(eq(t.journalEntries.device, this.device), eq(t.journalEntries.id, id)))
      .returning({ id: t.journalEntries.id })
      .all();
    return result.length > 0;
  }

  restore(id: string): JournalEntry | null {
    this.db
      .update(t.journalEntries)
      .set({ deletedAt: null })
      .where(and(eq(t.journalEntries.device, this.device), eq(t.journalEntries.id, id)))
      .run();
    const row = this.get(id);
    return row ? toEntry(row) : null;
  }

  /** Deleted more than 7 days ago: the row and the photo go for good. */
  purge(now: number): number {
    const old = this.db
      .select()
      .from(t.journalEntries)
      .where(
        and(
          eq(t.journalEntries.device, this.device),
          isNotNull(t.journalEntries.deletedAt),
          lt(t.journalEntries.deletedAt, now - DELETED_KEPT_MS),
        ),
      )
      .all();
    for (const row of old) {
      this.removePhoto(row.id);
      this.db.delete(t.journalEntries).where(eq(t.journalEntries.id, row.id)).run();
    }
    return old.length;
  }

  /** A plant's notes and photos, and its story (waterings, warnings, rule changes). */
  plant(zone: string, now: number): { entries: JournalEntry[]; events: JournalEvent[] } {
    const entries = this.db
      .select()
      .from(t.journalEntries)
      .where(
        and(
          eq(t.journalEntries.device, this.device),
          eq(t.journalEntries.zone, zone),
          isNull(t.journalEntries.deletedAt),
        ),
      )
      .orderBy(desc(t.journalEntries.createdAt))
      .all()
      .map(toEntry);

    const since = now - STORY_DAYS * 24 * 3_600_000;
    const events: JournalEvent[] = [];
    const watered = this.db
      .select({ raw: t.events.raw })
      .from(t.events)
      .where(
        and(
          eq(t.events.device, this.device),
          eq(t.events.type, 'watering.started'),
          eq(t.events.zone, zone),
          gte(t.events.ts, Math.floor(since / 1000)),
        ),
      )
      .all();
    for (const { raw } of watered) {
      const event = JSON.parse(raw) as {
        ts: number;
        source: 'user' | 'automation' | 'agent' | 'safety';
        seconds: number;
        reason?: AutomationReason;
      };
      events.push({
        kind: 'watering',
        ts: event.ts,
        source: event.source,
        seconds: event.seconds,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
      });
    }
    const alerts = this.db
      .select()
      .from(t.incidents)
      .where(
        and(
          eq(t.incidents.device, this.device),
          eq(t.incidents.zone, zone),
          gte(t.incidents.openedAt, since),
        ),
      )
      .all();
    for (const incident of alerts) {
      events.push({
        kind: 'alert',
        openedAt: incident.openedAt,
        resolvedAt: incident.resolvedAt,
        title: incident.title,
      });
    }
    // Changes to this pot's automatic watering, revision by revision.
    let before: { enabled: boolean; threshold: number } | null = null;
    const revisions = this.db
      .select({ raw: t.configRevisions.raw, ts: t.configRevisions.ts })
      .from(t.configRevisions)
      .where(eq(t.configRevisions.device, this.device))
      .orderBy(asc(t.configRevisions.rev))
      .all();
    for (const revision of revisions) {
      const parsed = configMessage.safeParse(JSON.parse(revision.raw));
      if (!parsed.success) continue;
      const rule = parsed.data.watering.find((r) => r.zone === zone);
      if (!rule) continue;
      const current = { enabled: rule.enabled, threshold: rule.threshold };
      const changed =
        before !== null &&
        (before.enabled !== current.enabled || before.threshold !== current.threshold);
      if (changed && revision.ts * 1000 >= since) {
        events.push({ kind: 'rule', ts: revision.ts, ...current, before });
      }
      before = current;
    }
    // Events of a type this hub does not know (a newer device, D108): a
    // neutral line, the pot's if it names one, the greenhouse's otherwise.
    const unknown = this.db
      .select({ ts: t.events.ts, type: t.events.type })
      .from(t.events)
      .where(
        and(
          eq(t.events.device, this.device),
          zone === GREENHOUSE_JOURNAL ? isNull(t.events.zone) : eq(t.events.zone, zone),
          not(inArray(t.events.type, [...KNOWN_EVENT_TYPES])),
          gte(t.events.ts, Math.floor(since / 1000)),
        ),
      )
      .all();
    for (const { ts, type } of unknown) events.push({ kind: 'device', ts, type });
    // A new plant in the pot ends a chapter (A12): said where it happened.
    for (const chapter of listChapters(this.db, this.device, zone)) {
      if (chapter.endedAt < since) continue;
      events.push({
        kind: 'chapter',
        at: chapter.endedAt,
        before: { name: chapter.name, sownAt: chapter.sownAt },
      });
    }
    return { entries, events };
  }

  /** Bytes of the photos saved in the last 30 days: what a month costs. */
  protected recentPhotoBytes(now: number): number {
    return this.db
      .select({ bytes: t.journalEntries.bytes })
      .from(t.journalEntries)
      .where(
        and(
          eq(t.journalEntries.device, this.device),
          eq(t.journalEntries.kind, 'photo'),
          gte(t.journalEntries.savedAt, now - 30 * 24 * 3_600_000),
        ),
      )
      .all()
      .reduce((total, row) => total + (row.bytes ?? 0), 0);
  }

  /** Every photo file the database refers to, deleted entries too. */
  protected photoNames(): string[] {
    return this.db
      .select({ id: t.journalEntries.id })
      .from(t.journalEntries)
      .where(eq(t.journalEntries.kind, 'photo'))
      .all()
      .map((row) => photoName(row.id));
  }
}
