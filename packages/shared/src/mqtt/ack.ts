import { z } from 'zod';

import { commandSource, requestId, schemaVersion, unixSeconds } from './common.ts';
import { safetyLimit } from './event.ts';

export const rejectReason = z.enum(['tank_empty', 'safety_limit', 'invalid', 'busy']);

const base = {
  v: schemaVersion,
  requestId,
  ts: unixSeconds,
  /** Copied from the command. */
  source: commandSource,
};

/** `vitreo/<deviceId>/ack` — not retained. One per command, matched by `requestId`. */
export const ackMessage = z.discriminatedUnion('result', [
  z.object({ ...base, result: z.literal('ok') }),
  z.object({
    ...base,
    result: z.literal('rejected'),
    reason: rejectReason,
    /** Which safety limit, when one stopped it (D85): the UI says so in words. */
    limit: safetyLimit.optional(),
    /** When it can be tried again (Unix s), if the limit is temporary (D85). */
    retryAt: unixSeconds.optional(),
  }),
]);

export type RejectReason = z.infer<typeof rejectReason>;
export type AckMessage = z.infer<typeof ackMessage>;
