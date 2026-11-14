import { parseEvent, parseMessage, parseTopic } from '@vitreo/shared';

import type { CommandService } from './commands.ts';
import type { GreenhouseStore } from './store.ts';

/**
 * Validates an incoming MQTT message and applies it to the store. Anything
 * that does not match the contract is dropped, never half-applied.
 * Returns whether the message was accepted.
 */
export function routeMessage(
  store: GreenhouseStore,
  commands: Pick<CommandService, 'handleAck'>,
  topicName: string,
  payload: string | Uint8Array,
  receivedAt: number,
): boolean {
  const parsedTopic = parseTopic(topicName);
  const state = store.getState();
  if (parsedTopic?.deviceId !== state.deviceId) return false;

  switch (parsedTopic.channel) {
    case 'status': {
      const result = parseMessage('status', payload);
      if (result.ok) state.applyStatus(result.message, receivedAt);
      return report(topicName, result);
    }
    case 'telemetry': {
      const result = parseMessage('telemetry', payload);
      if (result.ok) state.applyTelemetry(result.message);
      return report(topicName, result);
    }
    case 'event': {
      const result = parseEvent(payload);
      // A type this app does not know (a newer device, D108): skipped
      // quietly here (the scene and the warnings); the journals show it
      // from the hub.
      if (result.ok && result.known) state.applyEvent(result.message);
      return report(topicName, result);
    }
    case 'ack': {
      const result = parseMessage('ack', payload);
      if (result.ok) commands.handleAck(result.message);
      return report(topicName, result);
    }
    case 'weather': {
      // An empty retained message clears it: the hub has no weather (no key).
      if (payload.length === 0) {
        state.applyWeather(null);
        return true;
      }
      const result = parseMessage('weather', payload);
      if (result.ok) state.applyWeather(result.message);
      return report(topicName, result);
    }
    case 'cmd':
    case 'config':
      return false;
  }
}

function report(topicName: string, result: { ok: boolean; error?: string }): boolean {
  if (!result.ok)
    console.warn(`[vitreo] ignored invalid message on ${topicName}: ${result.error ?? ''}`);
  return result.ok;
}
