import { describe, expect, it } from 'vitest';

import { plantJournal } from './index.ts';

/** The journal answer, read tolerantly like every hub answer (A5, D108). */
describe('the plant journal from the hub', () => {
  it('shows the neutral line for an event a newer device sent', () => {
    const journal = { entries: [], events: [{ kind: 'device', ts: 10, type: 'filter.clogged' }] };
    expect(plantJournal.parse(journal)).toEqual(journal);
  });

  it('leaves out a kind of line from a newer hub instead of failing the journal', () => {
    const watering = { kind: 'watering', ts: 1, source: 'user', seconds: 5 };
    expect(
      plantJournal.parse({ entries: [], events: [watering, { kind: 'harvest', ts: 2 }] }),
    ).toEqual({ entries: [], events: [watering] });
  });
});
