import type { z } from 'zod';

import { ackMessage } from './ack.ts';
import { commandMessage } from './command.ts';
import { configMessage } from './config.ts';
import { eventMessage, KNOWN_EVENT_TYPES, unknownEvent } from './event.ts';
import type { EventMessage, UnknownEvent } from './event.ts';
import { statusMessage } from './status.ts';
import { telemetryMessage } from './telemetry.ts';
import type { Channel } from './topics.ts';
import { weatherMessage } from './weather.ts';

/**
 * The payload schema for each channel.
 *
 * What the device (or the hub's weather) sends is read **tolerantly**:
 * `status`, `telemetry`, `event`, `ack` and `weather` validate every field
 * they know and leave out the ones they do not, so an older app or hub keeps
 * working with a newer device or simulator (Fase 3: firmware and app
 * versions drift). What tells the device what to do stays **strict**: `cmd`
 * and `config` refuse unknown fields (and `config` an unknown version). And
 * publishing is strict on every channel (serializeMessage).
 */
export const messageSchemas = {
  status: statusMessage,
  telemetry: telemetryMessage,
  event: eventMessage,
  cmd: commandMessage,
  ack: ackMessage,
  config: configMessage,
  weather: weatherMessage,
} as const satisfies Record<Channel, z.ZodType>;

export type MessageFor<C extends Channel> = z.infer<(typeof messageSchemas)[C]>;

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: string };

/**
 * Parses and validates a raw MQTT payload for a channel. Never throws: bad
 * JSON and schema mismatches both come back as `{ ok: false }`.
 */
export function parseMessage<C extends Channel>(
  channel: C,
  payload: string | Uint8Array,
): ParseResult<MessageFor<C>> {
  const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'payload is not valid JSON' };
  }
  const result = schemaFor(channel).safeParse(json);
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: result.error.message };
}

export type EventParse =
  | { ok: true; known: true; message: EventMessage }
  | { ok: true; known: false; message: UnknownEvent }
  | { ok: false; error: string };

/**
 * An event, telling a known one from one of a type this version does not
 * know (D108): that one is valid if what every event shares is, and is kept
 * and shown as such, never acted on. A known type that does not validate is
 * invalid, as always.
 */
export function parseEvent(payload: string | Uint8Array): EventParse {
  const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'payload is not valid JSON' };
  }
  const type = (json as { type?: unknown } | null)?.type;
  if (typeof type === 'string' && !KNOWN_EVENT_TYPES.has(type)) {
    const result = unknownEvent.safeParse(json);
    return result.success
      ? { ok: true, known: false, message: result.data }
      : { ok: false, error: result.error.message };
  }
  const result = eventMessage.safeParse(json);
  return result.success
    ? { ok: true, known: true, message: result.data }
    : { ok: false, error: result.error.message };
}

/**
 * Validates a message and serialises it, so invalid payloads are never
 * published. Strict on every channel: a field the contract does not know is
 * an error here, never dropped in silence (only readers are tolerant).
 */
export function serializeMessage<C extends Channel>(channel: C, message: MessageFor<C>): string {
  const parsed = schemaFor(channel).parse(message);
  const unknown = unknownField(message, parsed);
  if (unknown !== null) throw new Error(`${channel}: unknown field ${unknown}`);
  return JSON.stringify(parsed);
}

/** The first field of `input` that validating left out, as a path, or null. */
function unknownField(input: unknown, output: unknown, at = ''): string | null {
  if (Array.isArray(input) && Array.isArray(output)) {
    for (const [i, item] of input.entries()) {
      const found = unknownField(item, output[i], `${at}[${i.toString()}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(input) || !isRecord(output)) return null;
  for (const [key, value] of Object.entries(input)) {
    const path = at === '' ? key : `${at}.${key}`;
    if (value === undefined) continue;
    if (!(key in output)) return path;
    const found = unknownField(value, output[key], path);
    if (found !== null) return found;
  }
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function schemaFor<C extends Channel>(channel: C): z.ZodType<MessageFor<C>> {
  // TypeScript cannot correlate an indexed schema with its inferred type.
  return messageSchemas[channel] as unknown as z.ZodType<MessageFor<C>>;
}
