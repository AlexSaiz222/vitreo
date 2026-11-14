import { PUSH_TYPES } from '@vitreo/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storedTypes } from './push.ts';

/** The types each device chose (A7), and a type added later (A10: frost forecasts). */

let saved: Map<string, string>;

beforeEach(() => {
  saved = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the notification types of this device', () => {
  it('are all of them until the person chooses', () => {
    expect(storedTypes()).toEqual([...PUSH_TYPES]);
  });

  it('add a type that came later to a choice made before it, once', () => {
    // Chosen in A7: no "sin datos", and frost forecasts did not exist.
    saved.set('vitreo.push.types', JSON.stringify(['tank', 'safety', 'thirsty']));
    expect(storedTypes()).toEqual(['tank', 'safety', 'thirsty', 'frost_forecast']);
    // Switched off afterwards: it stays off.
    saved.set('vitreo.push.types', JSON.stringify(['tank', 'safety', 'thirsty']));
    expect(storedTypes()).toEqual(['tank', 'safety', 'thirsty']);
  });
});
