import { z } from 'zod';

/**
 * Version of the message schemas. Every MQTT payload carries it as `v`.
 * Bump it only on breaking changes, and keep old parsers around while
 * devices in the field still speak the previous version.
 */
export const SCHEMA_VERSION = 1;

export const schemaVersion = z.literal(SCHEMA_VERSION);

/** Unix time in whole seconds, UTC. */
export const unixSeconds = z.number().int().nonnegative();

/** Local time of day, `HH:MM`, 24 h. */
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

/** A value normalised to the 0–1 range (soil moisture, tank level, vent opening). */
export const fraction = z.number().min(0).max(1);

/**
 * Device identifier used in the topic prefix. Lowercase and safe inside an MQTT
 * topic level: no `/`, `+` or `#`.
 */
export const deviceId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'invalid device id');

/**
 * Stable zone identifier, e.g. `basil_01`. It never changes when the plant is
 * renamed in the app, so history stays linked to the same zone.
 */
export const zoneId = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'invalid zone id');

/** Correlates a command with its ack and the events it causes. */
export const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'invalid request id');

/** Who asked for an action. */
export const commandSource = z.enum(['user', 'automation', 'agent']);

/** Who caused an action; `safety` is only ever set by the firmware itself. */
export const actionSource = z.enum([...commandSource.options, 'safety']);

export type DeviceId = z.infer<typeof deviceId>;
export type ZoneId = z.infer<typeof zoneId>;
export type RequestId = z.infer<typeof requestId>;
export type CommandSource = z.infer<typeof commandSource>;
export type ActionSource = z.infer<typeof actionSource>;
