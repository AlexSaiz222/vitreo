import { z } from 'zod';

import { fraction, schemaVersion, unixSeconds, zoneId } from './common.ts';
import { weatherCause } from './reason.ts';

// Readings are `null` when the sensor fails. The device never fills the gap
// with an old or made-up value.

const soilReading = z.object({
  id: zoneId,
  /** 0 = dry, 1 = wet. Calibration lives in the firmware. */
  moisture: fraction.nullable(),
  /** Version of the calibration used to normalise `moisture`. */
  cal: z.number().int().positive().optional(),
});

/**
 * `vitreo/<deviceId>/telemetry` — retained. Full snapshot every 30 s and on change.
 */
export const telemetryMessage = z.object({
  v: schemaVersion,
  ts: unixSeconds,
  air: z.object({
    /** °C */
    temp: z.number().min(-40).max(125).nullable(),
    /** Relative humidity, % */
    rh: z.number().min(0).max(100).nullable(),
  }),
  light: z.object({
    lux: z.number().min(0).max(200_000).nullable(),
  }),
  soil: z
    .array(soilReading)
    .refine((readings) => new Set(readings.map((r) => r.id)).size === readings.length, {
      message: 'duplicate zone id',
    }),
  tank: z.object({
    level: fraction.nullable(),
  }),
  actuators: z.object({
    pump: z.boolean(),
    growLight: z.boolean(),
    fan: z.boolean(),
    /** 0 = closed, 1 = fully open */
    vent: fraction,
  }),
  /**
   * The hub's outdoor hold in force (A10, D97): why, and until when (Unix s);
   * null if none. Absent from devices that predate it.
   */
  outdoorHold: z.object({ cause: weatherCause, until: unixSeconds }).nullable().optional(),
  fw: z.string().min(1).max(32),
  /** Wi-Fi signal, dBm */
  rssi: z.number().int().min(-127).max(0),
});

export type SoilReading = z.infer<typeof soilReading>;
export type TelemetryMessage = z.infer<typeof telemetryMessage>;
