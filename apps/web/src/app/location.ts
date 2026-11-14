import { z } from 'zod';

import { useHub } from '../data/hub.ts';
import type { Location } from './dayNight.ts';

/** Madrid, like the simulator, until the location is set in Ajustes. */
export const DEFAULT_LOCATION: Location = { lat: 40.42, lng: -3.7 };

const schema = z.object({
  VITE_LOCATION_LAT: z.coerce.number().min(-90).max(90),
  VITE_LOCATION_LNG: z.coerce.number().min(-180).max(180),
});

/** Location for day and night, from VITE_LOCATION_LAT/LNG or the default. */
export function readLocation(env: Record<string, unknown>): Location {
  const parsed = schema.safeParse(env);
  return parsed.success
    ? { lat: parsed.data.VITE_LOCATION_LAT, lng: parsed.data.VITE_LOCATION_LNG }
    : DEFAULT_LOCATION;
}

/**
 * Where the greenhouse is now: as set in Ajustes › Ubicación (the hub, or
 * what it last said, remembered on this device), else VITE_LOCATION_*.
 */
export function currentLocation(): Location {
  return useHub.getState().settings?.location ?? readLocation(import.meta.env);
}
