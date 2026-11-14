import { z } from 'zod';

import type { MixInput } from './mix.ts';

/**
 * What the demo sounds like, left for the notebook's page (D129): the
 * notebook has no greenhouse of its own, so it plays what was sounding when
 * you left (a night stays a night, a rain a rain), for this visit only. No
 * watering: a trickle that never ends would not be the greenhouse's.
 */
const KEY = 'vitreo.carriedMix';

/** A day at rest, window shut: what the notebook plays when opened on its own. */
export const RESTING_DAY: MixInput = {
  night: 0,
  vent: 0,
  fan: false,
  watering: false,
  live: true,
  weather: null,
  wetness: 0,
};

let last = '';

export function carryMix(input: MixInput): void {
  const text = JSON.stringify({ ...input, watering: false });
  if (text === last) return;
  last = text;
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // Not kept: the notebook plays a resting day.
  }
}

const unit = z.number().min(0).max(1);
const Carried = z.object({
  night: unit,
  vent: unit,
  fan: z.boolean(),
  live: z.boolean(),
  weather: z.object({ wind: unit, rain: unit }).nullable(),
  wetness: unit.optional(),
});

/** Read back as written, checked; anything odd gives a resting day. */
export function parseCarried(text: string | null): MixInput {
  if (!text) return RESTING_DAY;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return RESTING_DAY;
  }
  const parsed = Carried.safeParse(value);
  if (!parsed.success) return RESTING_DAY;
  const { night, vent, fan, live, weather, wetness } = parsed.data;
  return { night, vent, fan, watering: false, live, weather, wetness: wetness ?? 0 };
}

export function carriedMix(): MixInput {
  try {
    return parseCarried(sessionStorage.getItem(KEY));
  } catch {
    return RESTING_DAY;
  }
}
