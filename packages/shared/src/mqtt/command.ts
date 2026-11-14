import { z } from 'zod';

import { commandSource, fraction, requestId, schemaVersion, zoneId } from './common.ts';
import { strictWeatherReason } from './reason.ts';

/**
 * Longest watering a single command may ask for. This is a hint for the UI and
 * for early validation only: the firmware enforces its own limits (per command
 * and per hour) whatever this schema says.
 */
export const MAX_WATER_SECONDS = 15;

/** Longest fan run a single command may ask for. */
export const MAX_FAN_MINUTES = 120;

/** Longest outdoor hold a single command may ask for: the hub renews it while it lasts. */
export const MAX_HOLD_MINUTES = 60;

const base = {
  v: schemaVersion,
  requestId,
  source: commandSource,
};

const water = z.strictObject({
  ...base,
  action: z.literal('water'),
  zone: zoneId,
  seconds: z.number().int().min(1).max(MAX_WATER_SECONDS),
});

/**
 * Stops the pump now (A2, D84): the honest undo of a watering, which cannot
 * be taken back once water has flowed. With `zone`, only if that zone is
 * being watered. Acknowledged `ok` even when nothing was running, so
 * repeating it is harmless. The device ends the watering with a
 * `watering.finished` that carries the real duration and `stopRequestId`.
 */
const waterStop = z.strictObject({
  ...base,
  action: z.literal('waterStop'),
  zone: zoneId.optional(),
});

const growLight = z.strictObject({
  ...base,
  action: z.literal('growLight'),
  on: z.boolean(),
});

const vent = z.strictObject({
  ...base,
  action: z.literal('vent'),
  /** 0 = closed, 1 = fully open */
  open: fraction,
});

// A temporary action always carries its duration, so the device can return to
// a safe state on its own.
const fanOn = z.strictObject({
  ...base,
  action: z.literal('fan'),
  on: z.literal(true),
  minutes: z.number().int().min(1).max(MAX_FAN_MINUTES),
});

const fanOff = z.strictObject({
  ...base,
  action: z.literal('fan'),
  on: z.literal(false),
});

const fan = z.discriminatedUnion('on', [fanOn, fanOff]);

/**
 * The outdoor hold (A10, D97), sent by the hub while it rains, snows or the
 * wind is strong outside: the window stays closed and ventilation uses the
 * fan only. The device closes the window if it is open (telling why in
 * `automation.switched`) and its own rules stop opening it. Heat protection
 * still opens it, and a person who opens it by hand wins until the hold
 * ends. Always with a duration, which the hub renews while the weather
 * lasts: if the hub goes quiet, the hold lapses and the device's own rules
 * take over again. Not kept across a restart. Acknowledged `ok` even while
 * heat protection holds the window open.
 */
const outdoorHoldOn = z.strictObject({
  ...base,
  action: z.literal('outdoorHold'),
  on: z.literal(true),
  minutes: z.number().int().min(1).max(MAX_HOLD_MINUTES),
  reason: strictWeatherReason,
});

/** The weather cleared (or the rule was switched off): the device's rules again. */
const outdoorHoldOff = z.strictObject({
  ...base,
  action: z.literal('outdoorHold'),
  on: z.literal(false),
});

const outdoorHold = z.discriminatedUnion('on', [outdoorHoldOn, outdoorHoldOff]);

/** `vitreo/<deviceId>/cmd` — not retained. */
export const commandMessage = z.discriminatedUnion('action', [
  water,
  waterStop,
  growLight,
  vent,
  fan,
  outdoorHold,
]);

export type CommandMessage = z.infer<typeof commandMessage>;
export type CommandAction = CommandMessage['action'];
