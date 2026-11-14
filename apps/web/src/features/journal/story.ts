import type { JournalEntry, JournalEvent, PlantJournal } from '@vitreo/shared';

import type { PendingEntry } from '../../data/journal.ts';
import { formatFraction, formatTime } from '../../ui/format.ts';
import { explainWatering } from '../automations/explain.ts';

/**
 * A plant's story (A8, D93): its notes and photos together with what the
 * greenhouse did for it (waterings, warnings, changes to its automatic
 * watering), newest first, by day. Pure: tested without a browser.
 */
export type StoryItem =
  | { kind: 'entry'; at: number; entry: JournalEntry }
  | { kind: 'pending'; at: number; pending: PendingEntry }
  | { kind: 'event'; at: number; event: JournalEvent['kind']; text: string; key: string };

export interface StoryDay {
  label: string;
  items: StoryItem[];
}

const SOURCE = { user: 'tú', automation: 'automático', agent: 'automático', safety: 'seguridad' };
const NB = String.fromCharCode(0xa0);

/** What an event says, in one line. */
export function eventText(event: JournalEvent): string {
  switch (event.kind) {
    case 'watering': {
      // A no-break space: "5 s" never splits at the end of a line.
      const seconds = `${Math.round(event.seconds).toString()}${NB}s`;
      return event.source === 'automation' || event.source === 'agent'
        ? `${explainWatering(event.reason)} · ${seconds}`
        : `Riego de ${seconds} · ${SOURCE[event.source]}`;
    }
    case 'alert':
      return event.resolvedAt === null
        ? `Aviso: ${event.title}`
        : `Aviso: ${event.title} · resuelto a las ${formatTime(event.resolvedAt)}`;
    case 'rule': {
      const before = event.before;
      if (before && !before.enabled && event.enabled) {
        return `Riego automático activado · por debajo del ${formatFraction(event.threshold)}`;
      }
      if (before?.enabled && !event.enabled) return 'Riego automático desactivado';
      // The plant's threshold (D100), whether it waters itself or not.
      return before
        ? `Pide agua por debajo del ${formatFraction(event.threshold)} (antes, ${formatFraction(before.threshold)})`
        : `Pide agua por debajo del ${formatFraction(event.threshold)}`;
    }
    case 'chapter': {
      // A new plant in the pot (A12): the one before, by name and sowing day.
      const { name, sownAt } = event.before;
      const sown = sownAt ? sownDay(sownAt) : null;
      if (name) {
        return `Planta nueva en la maceta. Antes estaba ${name}${sown ? `, sembrada el ${sown}` : ''}.`;
      }
      return `Planta nueva en la maceta.${sown ? ` La anterior se sembró el ${sown}.` : ''}`;
    }
    case 'device':
      // A newer device's event this version does not know (D108): said, not interpreted.
      return `Evento del invernadero: ${event.type}`;
  }
}

const sownFormat = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
/** "3 de septiembre", from "2026-09-03". */
const sownDay = (day: string) => sownFormat.format(Date.parse(`${day}T00:00:00Z`));

const eventAt = (event: JournalEvent): number =>
  event.kind === 'alert' ? event.openedAt : event.kind === 'chapter' ? event.at : event.ts * 1000;

const dayKey = (ms: number) => new Date(ms).toDateString();
const dayFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });
const dayYearFormat = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** "Hoy", "Ayer", "3 de octubre", "3 de octubre de 2025". */
export function dayLabel(ms: number, now: number): string {
  if (dayKey(ms) === dayKey(now)) return 'Hoy';
  if (dayKey(ms) === dayKey(now - 86_400_000)) return 'Ayer';
  return new Date(ms).getFullYear() === new Date(now).getFullYear()
    ? dayFormat.format(ms)
    : dayYearFormat.format(ms);
}

export function buildStory(
  journal: PlantJournal | null,
  pending: readonly PendingEntry[],
  hidden: readonly string[],
  now: number,
): StoryDay[] {
  const saved = new Set(journal?.entries.map((entry) => entry.id));
  const items: StoryItem[] = [
    ...(journal?.entries ?? [])
      .filter((entry) => !hidden.includes(entry.id))
      .map((entry): StoryItem => ({ kind: 'entry', at: entry.createdAt, entry })),
    // Waiting for the hub; once saved, the hub's copy is the one shown.
    ...pending
      .filter((entry) => !saved.has(entry.id))
      .map((entry): StoryItem => ({ kind: 'pending', at: entry.createdAt, pending: entry })),
    ...(journal?.events ?? []).map((event, i): StoryItem => ({
      kind: 'event',
      at: eventAt(event),
      event: event.kind,
      text: eventText(event),
      // Two lines can share a second (two events of a newer device, D108).
      key: `${event.kind}-${eventAt(event).toString()}-${i.toString()}`,
    })),
  ].sort((a, b) => b.at - a.at);

  const days: StoryDay[] = [];
  for (const item of items) {
    const label = dayLabel(item.at, now);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(item);
    else days.push({ label, items: [item] });
  }
  return days;
}

/** The newest `limit` items, without leaving a day's heading empty ("Ver más"). */
export function firstItems(days: readonly StoryDay[], limit: number): StoryDay[] {
  const out: StoryDay[] = [];
  let left = limit;
  for (const day of days) {
    if (left <= 0) break;
    const items = day.items.slice(0, left);
    left -= items.length;
    out.push({ ...day, items });
  }
  return out;
}
