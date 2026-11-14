import { RETAINED, serializeMessage, topic } from '@vitreo/shared';
import type { StatusMessage } from '@vitreo/shared';

export interface StatusPublication {
  topic: string;
  payload: string;
  qos: 1;
  retain: boolean;
}

/** The retained status message for a device. Also used as its Last Will (`offline`). */
export function statusPublication(
  deviceId: string,
  state: StatusMessage['state'],
): StatusPublication {
  return {
    topic: topic(deviceId, 'status'),
    payload: serializeMessage('status', { v: 1, state }),
    qos: 1,
    retain: RETAINED.status,
  };
}
