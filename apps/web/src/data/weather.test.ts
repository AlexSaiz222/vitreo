import { describe, expect, it } from 'vitest';

import { outdoorAge } from './weather.ts';

/** The outdoor reading's age next to "fuera" (AEMET runs 1–2 h behind). */
describe('outdoorAge', () => {
  const at = 1_791_921_600;
  const NB = String.fromCharCode(0xa0);

  it('says nothing within the hour', () => {
    expect(outdoorAge(at, (at + 59 * 60) * 1000)).toBeNull();
    expect(outdoorAge(null, at * 1000)).toBeNull();
  });

  it('counts whole hours after that', () => {
    expect(outdoorAge(at, (at + 3600) * 1000)).toBe(`hace 1${NB}h`);
    expect(outdoorAge(at, (at + 2 * 3600 + 59 * 60) * 1000)).toBe(`hace 2${NB}h`);
  });
});
