import { z } from 'zod';

import { actionSource, fraction, requestId, schemaVersion, unixSeconds, zoneId } from './common.ts';
import { automationReason } from './reason.ts';

const base = {
  v: schemaVersion,
  ts: unixSeconds,
};

const wateringStarted = z.object({
  ...base,
  type: z.literal('watering.started'),
  source: actionSource,
  /** Present when the watering was started by a command. */
  requestId: requestId.optional(),
  zone: zoneId,
  /** Planned duration. */
  seconds: z.number().int().positive(),
  /** Why, when an automation started it. */
  reason: automationReason.optional(),
});

const wateringFinished = z.object({
  ...base,
  type: z.literal('watering.finished'),
  source: actionSource,
  requestId: requestId.optional(),
  zone: zoneId,
  /** Real duration; shorter than planned if a safety limit or a stop ended it. */
  seconds: z.number().nonnegative(),
  /** The `waterStop` command that ended it early, if one did (D84). */
  stopRequestId: requestId.optional(),
});

export const safetyLimit = z.enum([
  'pump_max_per_command',
  'pump_max_per_hour',
  'tank_empty',
  /** The tank level is unknown (sensor failure): no watering (D32). */
  'tank_unknown',
  /** A sensor the action depends on has failed (e.g. air → no grow light, D32). */
  'sensor_failure',
  'over_temperature',
  /** Below the frost limit: window closed and fan off, whatever is asked (D90). */
  'frost',
  'connection_lost',
]);

const safetyTriggered = z.object({
  ...base,
  type: z.literal('safety.triggered'),
  source: z.literal('safety'),
  limit: safetyLimit,
  zone: zoneId.optional(),
  /** The reading that triggered it, when there is one (°C for heat and frost). */
  value: z.number().optional(),
});

/**
 * A safety limit that holds a state (heat, frost) has released it (D90): the
 * app and the alerts (A7) can say it is over.
 */
const safetyCleared = z.object({
  ...base,
  type: z.literal('safety.cleared'),
  source: z.literal('safety'),
  limit: safetyLimit,
  value: z.number().optional(),
});

export const sensorKind = z.enum(['air', 'light', 'soil', 'tank']);

// Not an action, so it carries no `source`.
const sensorError = z.object({
  ...base,
  type: z.literal('sensor.error'),
  sensor: sensorKind,
  /** Required for soil sensors. */
  zone: zoneId.optional(),
  detail: z.string().max(200).optional(),
});

/** An automation of `config` switched an actuator (A6): the light, the fan or the window. */
const automationSwitched = z.object({
  ...base,
  type: z.literal('automation.switched'),
  source: z.literal('automation'),
  target: z.enum(['growLight', 'fan', 'vent']),
  /** On/off, or how open the window is (0–1). */
  value: z.union([z.boolean(), fraction]),
  reason: automationReason,
});

/** The device applies this revision of `config` (A6): the app can say "Aplicado". */
const configApplied = z.object({
  ...base,
  type: z.literal('config.applied'),
  rev: z.number().int().positive(),
});

/**
 * The device refused a `config` and keeps the one it had (A6): a version it
 * does not know, or one that does not validate. It never guesses.
 */
const configRejected = z.object({
  ...base,
  type: z.literal('config.rejected'),
  /** The refused revision, if it could be read. */
  rev: z.number().int().positive().optional(),
  reason: z.enum(['unsupported_version', 'invalid']),
  /** The version it carried, if any. */
  version: z.number().optional(),
  /** The revision still in force, if any. */
  keeps: z.number().int().positive().optional(),
});

/** `vitreo/<deviceId>/event` — not retained. */
export const eventMessage = z.discriminatedUnion('type', [
  wateringStarted,
  wateringFinished,
  safetyTriggered,
  safetyCleared,
  automationSwitched,
  configApplied,
  configRejected,
  sensorError.refine((e) => e.sensor !== 'soil' || e.zone !== undefined, {
    message: 'soil sensor errors need a zone',
    path: ['zone'],
  }),
]);

/** Every event type this version of the contract knows. */
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(
  eventMessage.options.map((option) => option.shape.type.value),
);

/**
 * An event of a type this version does not know (D108): a newer device or
 * simulator. What every event shares is still checked (version, time, a
 * sensible type name, and the source, pot and request id when it carries
 * them); the rest is its own. Kept and shown as a neutral line, never acted
 * on. A known type that does not validate is not this: it is invalid.
 */
export const unknownEvent = z
  .object({
    v: schemaVersion,
    ts: unixSeconds,
    type: z.string().regex(/^[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)*$/).max(64),
    // Only actions carry a source (a sensor error does not).
    source: actionSource.optional(),
    zone: zoneId.optional(),
    requestId: requestId.optional(),
  })
  .refine((event) => !KNOWN_EVENT_TYPES.has(event.type), {
    message: 'a known event type must match its own schema',
    path: ['type'],
  });

/**
 * A list of events from the hub (`/events`): the ones this app knows, with
 * those of unknown types left out quietly (D108). A known event that does not
 * validate still fails the list, as before.
 */
export const knownEventList = z
  .array(z.union([eventMessage, unknownEvent]))
  .transform((events) => events.filter((e): e is EventMessage => KNOWN_EVENT_TYPES.has(e.type)));

export type UnknownEvent = z.infer<typeof unknownEvent>;
export type SafetyLimit = z.infer<typeof safetyLimit>;
export type SensorKind = z.infer<typeof sensorKind>;
export type EventMessage = z.infer<typeof eventMessage>;
export type EventType = EventMessage['type'];
