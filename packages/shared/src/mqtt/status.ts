import { z } from 'zod';

import { schemaVersion } from './common.ts';

/**
 * `vitreo/<deviceId>/status` — retained. The device publishes `online` after
 * connecting and registers `offline` as its Last Will. The Last Will is fixed
 * at connect time, so this message has no timestamp.
 */
export const statusMessage = z.object({
  v: schemaVersion,
  state: z.enum(['online', 'offline']),
});

export type StatusMessage = z.infer<typeof statusMessage>;
