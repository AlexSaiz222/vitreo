import { API_PREFIX, GREENHOUSE_JOURNAL } from '@vitreo/shared';
import type { JournalNote } from '@vitreo/shared';

const DAY_MS = 24 * 3_600_000;

/**
 * A few notes in the demo's journal (D126), so a visitor sees what it is for;
 * since D129 spread over the recorded month, so a plant's story goes back
 * as far as its charts. Every one says it is an example: never passed off
 * as somebody's real diary.
 */
export const EXAMPLE_NOTES: readonly { daysAgo: number; note: Omit<JournalNote, 'createdAt'> }[] = [
  {
    daysAgo: 27,
    note: {
      id: '4f1c9a30-6b1e-4d7a-9c11-000000000005',
      zone: 'lettuce_01',
      text: 'Ejemplo · Aclarada: dejo las tres plántulas más fuertes.',
      tags: [],
    },
  },
  {
    daysAgo: 23,
    note: {
      id: '4f1c9a30-6b1e-4d7a-9c11-000000000006',
      zone: 'tomato_01',
      text: 'Ejemplo · Trasplantada a la maceta grande, con su tutor.',
      tags: ['transplanted'],
    },
  },
  {
    daysAgo: 19,
    note: {
      id: '4f1c9a30-6b1e-4d7a-9c11-000000000007',
      zone: 'strawberry_01',
      text: 'Ejemplo · Quitados dos estolones para que no se canse.',
      tags: ['pruned'],
    },
  },
  {
    daysAgo: 14,
    note: {
      id: '4f1c9a30-6b1e-4d7a-9c11-000000000008',
      zone: 'parsley_01',
      text: 'Ejemplo · Primer corte de hojas para la cocina.',
      tags: ['harvested'],
    },
  },
  {
    daysAgo: 10,
    note: {
      id: '4f1c9a30-6b1e-4d7a-9c11-000000000009',
      zone: 'chives_01',
      text: 'Ejemplo · Cortado a ras; en una semana vuelve a brotar.',
      tags: ['harvested'],
    },
  },
  {
    daysAgo: 7,
    note: {
      id: '4f1c9a30-6b1e-4d7a-9c11-000000000010',
      zone: GREENHOUSE_JOURNAL,
      text: 'Ejemplo · Revisadas las juntas de la ventana antes de las lluvias.',
      tags: ['maintenance'],
    },
  },
  {
    daysAgo: 5,
    note: {
      id: '4f1c9a30-6b1e-4d7a-9c11-000000000001',
      zone: 'basil_01',
      text: 'Ejemplo · Pinzadas las puntas: ya ramifica por abajo.',
      tags: ['pruned'],
    },
  },
  {
    daysAgo: 4,
    note: {
      id: '4f1c9a30-6b1e-4d7a-9c11-000000000002',
      zone: GREENHOUSE_JOURNAL,
      text: 'Ejemplo · Depósito rellenado, y limpio el filtro de la bomba.',
      tags: ['refilled'],
    },
  },
  {
    daysAgo: 3,
    note: {
      id: '4f1c9a30-6b1e-4d7a-9c11-000000000003',
      zone: 'tomato_01',
      text: 'Ejemplo · Primeras flores. Atado el tallo a la guía.',
      tags: [],
    },
  },
  {
    daysAgo: 1,
    note: {
      id: '4f1c9a30-6b1e-4d7a-9c11-000000000004',
      zone: 'basil_01',
      text: 'Ejemplo · Hojas algo caídas al mediodía; por la tarde, bien.',
      tags: [],
    },
  },
];

/**
 * When each demo plant was sown, in days before the visit (D129): before
 * the recorded month began, so every pot has had its plant all along and
 * its sheet says how old it is.
 */
export const EXAMPLE_SOWING: Readonly<Record<string, number>> = {
  basil_01: 45,
  parsley_01: 58,
  lettuce_01: 36,
  strawberry_01: 120,
  chives_01: 75,
  tomato_01: 62,
};

/** Writes them into the visitor's journal, dated before `nowMs`, in their browser only. */
export function addExampleNotes(
  journal: { addNote: (note: JournalNote, now: number) => unknown },
  nowMs: number,
): void {
  for (const { daysAgo, note } of EXAMPLE_NOTES) {
    const createdAt = nowMs - daysAgo * DAY_MS;
    journal.addNote({ ...note, createdAt }, createdAt);
  }
}

/** The local day (YYYY-MM-DD) `daysAgo` days before `nowMs`, in `timeZone`. */
export function dayBefore(nowMs: number, daysAgo: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(nowMs - daysAgo * DAY_MS);
}

/** The sowing days, through the hub's own route, as a visitor would set them. */
export async function sowExamplePlants(
  request: (patch: { method: 'PATCH'; url: string; body: string }) => Promise<unknown>,
  nowMs: number,
  timeZone: string,
): Promise<void> {
  for (const [zone, daysAgo] of Object.entries(EXAMPLE_SOWING)) {
    await request({
      method: 'PATCH',
      url: `${API_PREFIX}/plants/${zone}`,
      body: JSON.stringify({ sownAt: dayBefore(nowMs, daysAgo, timeZone) }),
    });
  }
}
