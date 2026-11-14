import { journalEntry, plantJournal } from '@vitreo/shared';
import type { JournalEntry, JournalTag, PlantJournal } from '@vitreo/shared';
import { create } from 'zustand';

import { now as nowMs } from '../app/clock.ts';
import { hubGet, hubUrl, useHub } from './hub.ts';
import { hubFetch } from './hubFetch.ts';
import { idbAll, idbDelete, idbGet, idbSet } from './idb.ts';
import { releasePhotoUrl } from './photoUrls.ts';

/**
 * The plants' journal on this device (A8, D93). A new note or photo is
 * written to the phone first (IndexedDB) and then sent: if the hub is down,
 * it waits, says so ("Se guardará cuando el hub responda"), and goes as soon
 * as the hub answers. Nothing is lost silently. Each plant's journal is also
 * cached here, so it still shows while the hub is down.
 */
export interface PendingEntry {
  id: string;
  zone: string;
  kind: 'note' | 'photo';
  text: string | null;
  /** A12; absent in entries kept before tags existed. */
  tags?: JournalTag[];
  createdAt: number;
  photo?: { blob: Blob; width: number; height: number };
  /** The hub refused it (not a slow hub: a real problem), in words. */
  failed?: string;
}

export type JournalStatus = 'loading' | 'ready' | 'cached' | 'unavailable';

interface JournalState {
  byZone: Partial<Record<string, { journal: PlantJournal | null; status: JournalStatus }>>;
  pending: PendingEntry[];
  /** Entries deleted this visit, hidden while "Deshacer" is offered. */
  hidden: string[];
}

export const useJournal = create<JournalState>()(() => ({ byZone: {}, pending: [], hidden: [] }));

const setZone = (zone: string, value: { journal: PlantJournal | null; status: JournalStatus }) => {
  useJournal.setState((state) => ({ byZone: { ...state.byZone, [zone]: value } }));
};

/** A plant's journal: from the hub, else from this phone's cache. */
export async function loadJournal(zone: string): Promise<void> {
  const current = useJournal.getState().byZone[zone];
  if (!current) setZone(zone, { journal: null, status: 'loading' });
  const result = await hubGet(`/journal/${zone}`, plantJournal);
  if (result.ok) {
    setZone(zone, { journal: result.value, status: 'ready' });
    void idbSet('journal', zone, result.value).catch(() => undefined);
    return;
  }
  // What is already on screen, else what this phone stored last time.
  const onScreen = useJournal.getState().byZone[zone]?.journal;
  const cached = onScreen ?? (await idbGet<PlantJournal>('journal', zone).catch(() => undefined));
  const parsed = plantJournal.safeParse(cached);
  setZone(
    zone,
    parsed.success
      ? { journal: parsed.data, status: 'cached' }
      : { journal: null, status: 'unavailable' },
  );
}

/** Entries waiting from earlier visits (after a reload, or the app was closed). */
export async function loadPending(): Promise<void> {
  const stored = await idbAll<PendingEntry>('pending').catch(() => [] as PendingEntry[]);
  useJournal.setState((state) => ({
    pending: [...state.pending.filter((p) => !stored.some((s) => s.id === p.id)), ...stored],
  }));
}

let askedToPersist = false;

async function keep(entry: PendingEntry): Promise<void> {
  useJournal.setState((state) => ({
    pending: [...state.pending.filter((p) => p.id !== entry.id), entry],
  }));
  // Ask the browser not to clear this storage when space runs low.
  if (!askedToPersist) {
    askedToPersist = true;
    // Absent outside secure contexts (and in tests).
    const storage = navigator.storage as StorageManager | undefined;
    void storage?.persist().catch(() => false);
  }
  // On the phone first: if this fails (private window), it stays in memory.
  await idbSet('pending', entry.id, entry).catch(() => undefined);
}

async function forget(id: string): Promise<void> {
  useJournal.setState((state) => ({ pending: state.pending.filter((p) => p.id !== id) }));
  await idbDelete('pending', id).catch(() => undefined);
}

type SendResult = 'saved' | 'down' | { refused: string };

async function send(entry: PendingEntry): Promise<SendResult> {
  try {
    const response =
      entry.kind === 'note'
        ? await hubFetch(hubUrl('/journal/notes'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: entry.id,
              zone: entry.zone,
              text: entry.text ?? '',
              tags: entry.tags ?? [],
              createdAt: entry.createdAt,
            }),
            signal: AbortSignal.timeout(10_000),
          })
        : await hubFetch(
            hubUrl(
              `/journal/${entry.id}/photo?${new URLSearchParams({
                zone: entry.zone,
                createdAt: String(entry.createdAt),
                width: String(entry.photo?.width ?? 0),
                height: String(entry.photo?.height ?? 0),
                ...(entry.text ? { caption: entry.text } : {}),
                ...(entry.tags?.length ? { tags: entry.tags.join(',') } : {}),
              }).toString()}`,
            ),
            {
              method: 'PUT',
              headers: { 'content-type': 'image/jpeg' },
              body: entry.photo?.blob ?? null,
              signal: AbortSignal.timeout(30_000),
            },
          );
    if (response.status >= 500) return 'down';
    if (!response.ok) {
      return {
        refused:
          response.status === 413 ? 'La foto es demasiado grande.' : 'El hub no la ha aceptado.',
      };
    }
    return journalEntry.safeParse(await response.json()).success ? 'saved' : 'down';
  } catch {
    return 'down';
  }
}

let flushing: Promise<void> | null = null;

/** Sends what waits, oldest first; stops at the first sign of a hub that is down. */
export function flushJournal(): Promise<void> {
  flushing ??= (async () => {
    const zones = new Set<string>();
    const waiting = [...useJournal.getState().pending]
      .filter((entry) => !entry.failed)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of waiting) {
      const result = await send(entry);
      if (result === 'down') break;
      if (result === 'saved') {
        await forget(entry.id);
        if (entry.photo) releasePhotoUrl(entry.photo.blob);
        zones.add(entry.zone);
      } else {
        await keep({ ...entry, failed: result.refused });
      }
    }
    for (const zone of zones) await loadJournal(zone);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

const newId = () => crypto.randomUUID();

/** A note (text, tags or both): kept on the phone at once, then sent. */
export async function addNote(
  zone: string,
  text: string,
  tags: readonly JournalTag[] = [],
): Promise<void> {
  await keep({
    id: newId(),
    zone,
    kind: 'note',
    text: text.trim() || null,
    tags: [...tags],
    createdAt: nowMs(),
  });
  await flushJournal();
}

/** A photo (already resized and without metadata): kept on the phone, then sent. */
export async function addPhoto(
  zone: string,
  photo: { blob: Blob; width: number; height: number },
  caption: string,
  tags: readonly JournalTag[] = [],
): Promise<void> {
  await keep({
    id: newId(),
    zone,
    kind: 'photo',
    text: caption.trim() || null,
    tags: [...tags],
    createdAt: nowMs(),
    photo,
  });
  await flushJournal();
}

/** Discards an entry that has not reached the hub; resolves to its undo. */
export async function discardPending(entry: PendingEntry): Promise<() => Promise<void>> {
  await forget(entry.id);
  return async () => {
    await keep(entry);
    await flushJournal();
  };
}

async function hubCall(method: 'DELETE' | 'POST', path: string): Promise<boolean> {
  try {
    const response = await hubFetch(hubUrl(path), {
      method,
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Deletes a note or photo; resolves to a function that undoes it (true if
 * the hub took it back), or null if deleting failed.
 */
export async function deleteEntry(entry: JournalEntry): Promise<(() => Promise<boolean>) | null> {
  useJournal.setState((state) => ({ hidden: [...state.hidden, entry.id] }));
  const ok = await hubCall('DELETE', `/journal/${entry.id}`);
  if (!ok) {
    useJournal.setState((state) => ({ hidden: state.hidden.filter((id) => id !== entry.id) }));
    return null;
  }
  return async () => {
    // Without the hub it stays deleted, and the caller says so.
    if (!(await hubCall('POST', `/journal/${entry.id}/restore`))) return false;
    useJournal.setState((state) => ({ hidden: state.hidden.filter((id) => id !== entry.id) }));
    await loadJournal(entry.zone);
    return true;
  };
}

/** How often what waits is tried again while the hub answers. */
const RETRY_MS = 30_000;

/** Sends what waits whenever the hub answers (again), at start, and every 30 s. */
export function startJournalSync(): () => void {
  void loadPending().then(() => flushJournal());
  const unsubscribe = useHub.subscribe((state, previous) => {
    if (state.status === 'up' && previous.status !== 'up') void flushJournal();
  });
  const timer = setInterval(() => {
    const waiting = useJournal.getState().pending.some((entry) => !entry.failed);
    if (waiting && useHub.getState().status === 'up') void flushJournal();
  }, RETRY_MS);
  return () => {
    unsubscribe();
    clearInterval(timer);
  };
}
