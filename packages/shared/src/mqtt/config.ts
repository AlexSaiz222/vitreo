import { z } from 'zod';

import { MAX_WATER_SECONDS } from './command.ts';
import { fraction, timeOfDay, unixSeconds, zoneId } from './common.ts';

/**
 * The version of `config` (A6, D89). Unlike the other messages it has its
 * own number: its shape grew (cooldown, quiet hours, ventilation in two
 * steps, light by the sun, location), and a device that receives a version
 * it does not know rejects it with `config.rejected` instead of guessing.
 */
export const CONFIG_VERSION = 2;

export { timeOfDay } from './common.ts';

/** A local window, `from` to `to`; it may cross midnight (22:00–08:00). */
const window = z.strictObject({ from: timeOfDay, to: timeOfDay });

const wateringRule = z.strictObject({
  zone: zoneId,
  enabled: z.boolean(),
  /** Water when soil moisture drops below this value (0–1). */
  threshold: fraction,
  seconds: z.number().int().min(1).max(MAX_WATER_SECONDS),
  maxPerDay: z.number().int().min(0).max(24),
  /**
   * Minutes to wait after watering a pot before it can be watered again: the
   * soil is still absorbing and the sensor lags behind it.
   */
  cooldownMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  /** No automatic watering in this local window ("not at night"), or null. */
  quiet: window.nullable(),
});

/** Coordinates rounded to 2 decimals (≈ 1 km, D79): enough for the sun. */
const roundedCoordinate = (limit: number) =>
  z
    .number()
    .min(-limit)
    .max(limit)
    .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, {
      message: 'round to 2 decimals',
    });

const lightBase = {
  enabled: z.boolean(),
  /** Only on while natural light is below this (lux); null = whatever the daylight. */
  belowLux: z.number().min(0).max(200_000).nullable(),
};

const light = z.discriminatedUnion('mode', [
  /** A fixed window of local time; may cross midnight. */
  z.strictObject({ ...lightBase, mode: z.literal('schedule'), on: timeOfDay, off: timeOfDay }),
  /**
   * From sunrise to sunset where the greenhouse is (needs `location`), each
   * moved by an offset in minutes: e.g. +120 after sunset lengthens the day.
   */
  z.strictObject({
    ...lightBase,
    mode: z.literal('sun'),
    sunriseOffset: z.number().int().min(-240).max(240),
    sunsetOffset: z.number().int().min(-240).max(240),
  }),
]);

/**
 * `vitreo/<deviceId>/config` — retained. The basic rules the device applies
 * on its own, even without the hub (D73): watering by threshold per pot,
 * ventilation by temperature and humidity, and the grow light.
 *
 * Safety limits (pump time, empty tank, over-temperature cut-off) are
 * deliberately NOT here: they are firmware constants and cannot be relaxed
 * over MQTT (D22).
 */
const configObject = z.strictObject({
  v: z.literal(CONFIG_VERSION),
  /** Revision of this config, increased on every change. */
  rev: z.number().int().positive(),
  ts: unixSeconds,
  /**
   * POSIX TZ string for the local schedules, e.g. `CET-1CEST,M3.5.0,M10.5.0/3`;
   * the device also needs NTP time (docs/05).
   */
  tz: z.string().min(1).max(64),
  /** Where the greenhouse is, rounded (D79, refined in D89); null if unknown. */
  location: z.strictObject({ lat: roundedCoordinate(90), lng: roundedCoordinate(180) }).nullable(),
  watering: z
    .array(wateringRule)
    .refine((rules) => new Set(rules.map((r) => r.zone)).size === rules.length, {
      message: 'duplicate zone id',
    }),
  light,
  /**
   * In two steps, each with hysteresis (it switches off `hysteresis` °C
   * below where it switched on): the fan above `fanAbove`, and the window
   * too above `windowAbove`. The fan also runs above `maxRh` (5 % lower to stop).
   */
  ventilation: z.strictObject({
    enabled: z.boolean(),
    fanAbove: z.number().min(0).max(60),
    windowAbove: z.number().min(0).max(60),
    hysteresis: z.number().min(0.5).max(10),
    maxRh: z.number().min(0).max(100),
  }),
});

const windowAboveFan = {
  check: (config: { ventilation: { fanAbove: number; windowAbove: number } }) =>
    config.ventilation.windowAbove >= config.ventilation.fanAbove,
  message: {
    message: 'the window opens at or above the fan temperature',
    path: ['ventilation', 'windowAbove'],
  },
};

/**
 * `vitreo/<deviceId>/config` — retained. The basic rules the device applies
 * on its own, even without the hub (D73): watering by threshold per pot,
 * ventilation by temperature and humidity, and the grow light.
 *
 * Safety limits (pump time, empty tank, over-temperature cut-off) are
 * deliberately NOT here: they are firmware constants and cannot be relaxed
 * over MQTT (D22).
 */
export const configMessage = configObject
  .refine(windowAboveFan.check, windowAboveFan.message)
  .refine((config) => config.light.mode !== 'sun' || config.location !== null, {
    message: 'light by the sun needs a location',
    path: ['location'],
  });

/**
 * The rules as the app edits them (A6): the hub adds the version, revision,
 * time, time zone and location before publishing.
 */
export const configRules = configObject
  .pick({ watering: true, light: true, ventilation: true })
  .refine(windowAboveFan.check, windowAboveFan.message);

export type WateringRule = z.infer<typeof wateringRule>;
export type LightRule = z.infer<typeof light>;
export type VentilationRule = ConfigMessage['ventilation'];
export type ConfigMessage = z.infer<typeof configMessage>;
export type ConfigRules = z.infer<typeof configRules>;
