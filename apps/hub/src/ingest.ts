import { parseEvent, parseMessage, parseTopic } from '@vitreo/shared';
import type { SafetyLimit } from '@vitreo/shared';

import type { ConfigOwner } from './configOwner.ts';
import type { HubDatabase } from './db/types.ts';
import {
  markConfigApplied,
  markConfigRejected,
  storeAck,
  storeCommand,
  storeEvent,
  MAX_REJECTED,
  storeRejected,
  storeStatus,
  storeTelemetry,
} from './db/store.ts';

/**
 * Stores one message from the broker; invalid ones are kept aside, never
 * crash the hub. Returns the device time of a telemetry stored, else null.
 */
export function handleMessage(
  db: HubDatabase,
  owner: ConfigOwner,
  device: string,
  topicName: string,
  payload: string,
  receivedAt: number,
): number | null {
  const where = parseTopic(topicName);
  if (where?.deviceId !== device) return null;
  const reject = (error: string) => {
    const trimmed = storeRejected(db, topicName, payload, error.slice(0, 500), receivedAt);
    // Only a flood gets here: they are archived every night (A12).
    if (trimmed > 0) {
      console.warn(
        `[hub] over ${MAX_REJECTED.toString()} invalid messages today: the oldest dropped`,
      );
    }
  };
  switch (where.channel) {
    case 'telemetry': {
      const parsed = parseMessage('telemetry', payload);
      if (!parsed.ok) {
        reject(parsed.error);
        return null;
      }
      storeTelemetry(db, device, parsed.message, payload, receivedAt);
      return parsed.message.ts;
    }
    case 'event': {
      const parsed = parseEvent(payload);
      if (!parsed.ok) {
        reject(parsed.error);
        break;
      }
      // A type this hub does not know (a newer device, D108): stored as an
      // event like any other, with its type, never acted on.
      storeEvent(db, device, parsed.message, payload, receivedAt);
      if (!parsed.known) break;
      const event = parsed.message;
      // The device says which revision it applies, or which it refused (A6).
      if (event.type === 'config.applied') markConfigApplied(db, device, event.rev, receivedAt);
      if (event.type === 'config.rejected' && event.rev !== undefined) {
        markConfigRejected(db, device, event.rev, event.reason, receivedAt);
      }
      break;
    }
    case 'cmd': {
      const parsed = parseMessage('cmd', payload);
      if (parsed.ok) storeCommand(db, device, parsed.message, payload, receivedAt);
      else reject(parsed.error);
      break;
    }
    case 'ack': {
      const parsed = parseMessage('ack', payload);
      if (parsed.ok) storeAck(db, device, parsed.message, payload, receivedAt);
      else reject(parsed.error);
      break;
    }
    case 'status': {
      const parsed = parseMessage('status', payload);
      if (parsed.ok) storeStatus(db, device, parsed.message, receivedAt);
      else reject(parsed.error);
      break;
    }
    case 'config': {
      // Retained on the broker: newer than ours (set elsewhere)? Adopt it.
      const parsed = parseMessage('config', payload);
      if (parsed.ok) owner.adopt(parsed.message);
      else reject(parsed.error);
      break;
    }
  }
  return null;
}

/** The safety limit an event message says fired, if it is one (A7: the warnings are told at once). */
export function safetyLimitOf(topicName: string, payload: string): SafetyLimit | null {
  if (!topicName.endsWith('/event')) return null;
  const parsed = parseMessage('event', payload);
  return parsed.ok && parsed.message.type === 'safety.triggered' ? parsed.message.limit : null;
}
