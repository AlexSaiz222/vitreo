import { z } from 'zod';

import { fraction, timeOfDay } from './common.ts';

/** What outside makes the hub hold the window closed (A10, D97). */
export const weatherCause = z.enum(['rain', 'snow', 'wind']);

/**
 * The weather outside (A10, D97): it rains (or snows) or the wind is strong.
 * `value` is the rain (mm in an hour) or the wind (m/s, a gust or the mean)
 * that crossed `limit`; null if the rain comes from the forecast, which has
 * no amount.
 */
const weatherReasonShape = {
  kind: z.literal('weather'),
  cause: weatherCause,
  value: z.number().nullable(),
  limit: z.number(),
  /**
   * Measured at the station, or forecast by AEMET for this hour (the
   * station runs 1–2 h behind). Absent before this field existed.
   */
  from: z.enum(['station', 'forecast']).optional(),
};
/** As read in an event: unknown fields from a newer sender are left out. */
export const weatherReason = z.object(weatherReasonShape);
/** As the hold command carries it: commands stay strict. */
export const strictWeatherReason = z.strictObject(weatherReasonShape);

/**
 * Why an automation acted (A6, D89), so every automatic action can be
 * explained: "Riego automático · tierra 33 % < 35 %". Read tolerantly, like
 * every message from the device (messages.ts).
 */
export const automationReason = z.discriminatedUnion('kind', [
  /**
   * Soil moisture below the pot's threshold. `evening`: watered just before
   * its quiet hours instead, still above the threshold but close to it and
   * drying fast enough to cross overnight (D106): "Riego de tarde · 43 %,
   * cerca del 40 %".
   */
  z.object({
    kind: z.literal('soil'),
    moisture: fraction,
    threshold: fraction,
    evening: z.literal(true).optional(),
  }),
  /** Air temperature crossed a limit (°C): above it to switch on, below it to stop. */
  z.object({ kind: z.literal('temperature'), value: z.number(), limit: z.number() }),
  /** Relative humidity crossed a limit (%). */
  z.object({ kind: z.literal('humidity'), value: z.number(), limit: z.number() }),
  /**
   * The light's window began or ended (local `HH:MM`, by the clock or the sun),
   * or daylight crossed `belowLux` inside it.
   */
  z.object({
    kind: z.literal('light'),
    mode: z.enum(['schedule', 'sun']),
    from: timeOfDay,
    to: timeOfDay,
    lux: z.number().nullable(),
    belowLux: z.number().nullable(),
  }),
  /** The device closed the window for the hub's outdoor hold (A10, D97). */
  weatherReason,
]);

export type AutomationReason = z.infer<typeof automationReason>;
export type WeatherCause = z.infer<typeof weatherCause>;
export type WeatherReason = z.infer<typeof weatherReason>;
