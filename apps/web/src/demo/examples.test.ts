import { journalNote } from '@vitreo/shared';
import { describe, expect, it } from 'vitest';

import { addExampleNotes, EXAMPLE_NOTES } from './examples.ts';

describe('the demo journal examples (D126)', () => {
  it('says each one is an example', () => {
    for (const { note } of EXAMPLE_NOTES) expect(note.text).toMatch(/^Ejemplo · /);
  });

  it('are valid notes, with ids of their own', () => {
    const NOW = Date.parse('2026-11-09T12:00:00Z');
    const written: unknown[] = [];
    addExampleNotes({ addNote: (note) => written.push(note) }, NOW);
    expect(written).toHaveLength(EXAMPLE_NOTES.length);
    for (const note of written) expect(journalNote.safeParse(note).success).toBe(true);
    expect(new Set(EXAMPLE_NOTES.map(({ note }) => note.id)).size).toBe(EXAMPLE_NOTES.length);
  });

  it('are dated in the past', () => {
    const NOW = Date.parse('2026-11-09T12:00:00Z');
    const dates: number[] = [];
    addExampleNotes(
      {
        addNote: (note) => {
          dates.push(note.createdAt);
        },
      },
      NOW,
    );
    expect(dates.every((at) => at < NOW)).toBe(true);
  });
});
