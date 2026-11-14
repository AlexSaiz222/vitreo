import { fraction, zoneId } from '@vitreo/shared';
import { z } from 'zod';

/**
 * Physical parameters of the simulated greenhouse. They live in data, not in
 * code, so the simulator can later be calibrated against real telemetry
 * (see docs/12-ideas-ia.md). Override any section with a JSON file passed in
 * SIMULATOR_PARAMS.
 */
const zoneSchema = z.strictObject({
  id: zoneId,
  initialMoisture: fraction,
  /** Fraction of the available water lost per hour at 20 °C in daylight. */
  dryingPerHour: z.number().positive(),
  /** Moisture gained per second of pumping. */
  wateringGainPerSecond: z.number().positive(),
});

const sections = {
  location: z.strictObject({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  zones: z.array(zoneSchema).min(1),
  air: z.strictObject({
    outdoorMeanC: z.number(),
    outdoorAmplitudeC: z.number().nonnegative(),
    /** Extra warmth trapped by the glass in full sun. */
    greenhouseGainC: z.number().nonnegative(),
    growLightGainC: z.number().nonnegative(),
    /** The share of the greenhouse's warmth over outside that the fan takes away (D105). */
    fanExchange: z.number().min(0).max(1),
    heatwaveExtraC: z.number().nonnegative(),
    /** A winter night (the cold_snap scenario): how much colder outside. */
    coldSnapDropC: z.number().nonnegative(),
    temperatureTauMinutes: z.number().positive(),
    baseRh: z.number().min(0).max(100),
    rhPerDegree: z.number().nonnegative(),
    ventRhDrop: z.number().nonnegative(),
    fanRhDrop: z.number().nonnegative(),
    humidityTauMinutes: z.number().positive(),
    /** A muggy morning (the humid scenario): how much more humid. */
    humidExtraRh: z.number().nonnegative(),
  }),
  light: z.strictObject({
    maxDaylightLux: z.number().nonnegative(),
    growLightLux: z.number().nonnegative(),
  }),
  tank: z.strictObject({
    initialLevel: fraction,
    /** Tank fraction used per second of pumping. */
    usePerPumpSecond: z.number().nonnegative(),
  }),
  noise: z.strictObject({
    tempC: z.number().nonnegative(),
    rh: z.number().nonnegative(),
    /** Relative, e.g. 0.02 = 2 %. */
    lux: z.number().nonnegative(),
    moisture: z.number().nonnegative(),
  }),
  timing: z.strictObject({
    /** Snapshot period; telemetry is also published on every change. */
    telemetryIntervalSeconds: z.number().positive(),
    /** Speeds up slow processes (drying, air) for development. 1 = real time. */
    timeScale: z.number().positive(),
  }),
};

export const simParamsSchema = z.strictObject(sections);
export type SimParams = z.infer<typeof simParamsSchema>;
export type ZoneParams = z.infer<typeof zoneSchema>;

/** Madrid by default; the six pots from docs/08-plantas.md (D63). */
export const DEFAULT_PARAMS: SimParams = {
  location: { lat: 40.42, lng: -3.7 },
  zones: [
    { id: 'basil_01', initialMoisture: 0.55, dryingPerHour: 0.012, wateringGainPerSecond: 0.03 },
    { id: 'parsley_01', initialMoisture: 0.62, dryingPerHour: 0.009, wateringGainPerSecond: 0.03 },
    { id: 'lettuce_01', initialMoisture: 0.5, dryingPerHour: 0.011, wateringGainPerSecond: 0.03 },
    {
      id: 'strawberry_01',
      initialMoisture: 0.4,
      dryingPerHour: 0.01,
      wateringGainPerSecond: 0.03,
    },
    { id: 'chives_01', initialMoisture: 0.6, dryingPerHour: 0.009, wateringGainPerSecond: 0.03 },
    // A fruiting tomato drinks more than the herbs.
    { id: 'tomato_01', initialMoisture: 0.52, dryingPerHour: 0.014, wateringGainPerSecond: 0.03 },
  ],
  air: {
    outdoorMeanC: 18,
    outdoorAmplitudeC: 6,
    greenhouseGainC: 9,
    growLightGainC: 1.5,
    fanExchange: 0.4,
    heatwaveExtraC: 16,
    coldSnapDropC: 22,
    temperatureTauMinutes: 20,
    baseRh: 72,
    rhPerDegree: 1.8,
    ventRhDrop: 15,
    fanRhDrop: 5,
    humidityTauMinutes: 15,
    humidExtraRh: 36,
  },
  light: { maxDaylightLux: 40_000, growLightLux: 4_000 },
  tank: { initialLevel: 0.8, usePerPumpSecond: 0.004 },
  noise: { tempC: 0.05, rh: 0.3, lux: 0.02, moisture: 0.003 },
  timing: { telemetryIntervalSeconds: 30, timeScale: 1 },
};

const overridesSchema = z.strictObject(sections).partial();

/**
 * Default parameters with whole sections replaced (the simulator reads them
 * from the JSON file in SIMULATOR_PARAMS; the demo passes its own).
 */
export function withOverrides(overrides: unknown): SimParams {
  return simParamsSchema.parse({ ...DEFAULT_PARAMS, ...overridesSchema.parse(overrides) });
}
