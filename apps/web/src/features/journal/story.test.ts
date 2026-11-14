import type { PlantJournal } from '@vitreo/shared';
import { describe, expect, it } from 'vitest';

import type { PendingEntry } from '../../data/journal.ts';
import { buildStory, dayLabel, eventText, firstItems } from './story.ts';
import { fitSize } from './photo.ts';

const NB = String.fromCharCode(0xa0);
const NOW = new Date(2026, 9, 12, 18, 0).getTime();
const HOUR = 3_600_000;
const id = (n: number) => `0b8f6a52-6f0e-4c7a-9f7e-2d1c3b4a5e${n.toString().padStart(2, '0')}`;

const journal: PlantJournal = {
  entries: [
    {
      id: id(1),
      zone: 'basil_01',
      kind: 'note',
      tags: [],
      text: 'Hojas nuevas',
      photo: null,
      createdAt: NOW - HOUR,
      savedAt: NOW,
    },
    {
      id: id(2),
      zone: 'basil_01',
      kind: 'photo',
      tags: [],
      text: null,
      photo: { width: 1600, height: 1200, bytes: 300_000 },
      createdAt: NOW - 30 * HOUR,
      savedAt: NOW,
    },
  ],
  events: [
    {
      kind: 'watering',
      ts: (NOW - 2 * HOUR) / 1000,
      source: 'automation',
      seconds: 5,
      reason: { kind: 'soil', moisture: 0.33, threshold: 0.35 },
    },
    { kind: 'alert', openedAt: NOW - 3 * HOUR, resolvedAt: null, title: 'La albahaca tiene sed' },
  ],
};

describe("the plant's story", () => {
  it('says what the greenhouse did, in words', () => {
    expect(eventText({ kind: 'watering', ts: 0, source: 'user', seconds: 5 })).toBe(
      `Riego de 5${NB}s · tú`,
    );
    expect(
      eventText({
        kind: 'watering',
        ts: 0,
        source: 'automation',
        seconds: 4.6,
        reason: { kind: 'soil', moisture: 0.33, threshold: 0.35 },
      }),
    ).toBe(`Riego automático · tierra 33${NB}% < 35${NB}% · 5${NB}s`);
    expect(
      eventText({
        kind: 'rule',
        ts: 0,
        enabled: true,
        threshold: 0.35,
        before: { enabled: false, threshold: 0.4 },
      }),
    ).toMatch(/^Riego automático activado · por debajo del 35/);
    expect(
      eventText({
        kind: 'rule',
        ts: 0,
        enabled: false,
        threshold: 0.35,
        before: { enabled: true, threshold: 0.35 },
      }),
    ).toBe('Riego automático desactivado');
    expect(
      eventText({
        kind: 'rule',
        ts: 0,
        enabled: true,
        threshold: 0.3,
        before: { enabled: true, threshold: 0.35 },
      }),
    ).toMatch(/^Pide agua por debajo del 30\s%\s\(antes, 35\s%\)$/);
  });

  it('says plainly what a newer device reported that this app does not know (D108)', () => {
    expect(eventText({ kind: 'device', ts: 0, type: 'filter.clogged' })).toBe(
      'Evento del invernadero: filter.clogged',
    );
  });

  it('says where a new plant started in the pot (A12)', () => {
    expect(
      eventText({ kind: 'chapter', at: NOW, before: { name: 'Pepa', sownAt: '2026-09-03' } }),
    ).toBe('Planta nueva en la maceta. Antes estaba Pepa, sembrada el 3 de septiembre.');
    expect(
      eventText({ kind: 'chapter', at: NOW, before: { name: null, sownAt: '2026-09-03' } }),
    ).toBe('Planta nueva en la maceta. La anterior se sembró el 3 de septiembre.');
    expect(eventText({ kind: 'chapter', at: NOW, before: { name: null, sownAt: null } })).toBe(
      'Planta nueva en la maceta.',
    );
  });

  it('puts notes, photos and events together, newest first, by day', () => {
    const days = buildStory(journal, [], [], NOW);
    expect(days.map((day) => day.label)).toEqual(['Hoy', 'Ayer']);
    expect(days[0]?.items.map((item) => item.kind)).toEqual(['entry', 'event', 'event']);
  });

  it('shows what still waits for the hub once, and hides what was just deleted', () => {
    const pending: PendingEntry[] = [
      { id: id(3), zone: 'basil_01', kind: 'note', text: 'Sin hub', createdAt: NOW - 10 },
      // Already saved: the hub's copy is the one shown.
      { id: id(1), zone: 'basil_01', kind: 'note', text: 'Hojas nuevas', createdAt: NOW - HOUR },
    ];
    const items = buildStory(journal, pending, [id(2)], NOW).flatMap((day) => day.items);
    expect(items.filter((item) => item.kind === 'pending')).toHaveLength(1);
    expect(items.some((item) => item.kind === 'entry' && item.entry.id === id(2))).toBe(false);
  });

  it('pages without leaving an empty day', () => {
    const days = buildStory(journal, [], [], NOW);
    const first = firstItems(days, 2);
    expect(first).toHaveLength(1);
    expect(first[0]?.items).toHaveLength(2);
  });

  it('names days calmly', () => {
    expect(dayLabel(NOW - 2 * 86_400_000, NOW)).toBe('10 de octubre');
    expect(dayLabel(new Date(2025, 9, 10).getTime(), NOW)).toBe('10 de octubre de 2025');
  });
});

describe('photo size', () => {
  it('fits the long edge to 1600 px and never enlarges', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
