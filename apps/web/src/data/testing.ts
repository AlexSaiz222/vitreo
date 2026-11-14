import type { TelemetryMessage } from '@vitreo/shared';

/** A valid telemetry snapshot for tests. */
export function telemetry(ts: number, overrides: Partial<TelemetryMessage> = {}): TelemetryMessage {
  return {
    v: 1,
    ts: Math.floor(ts / 1000),
    air: { temp: 22, rh: 60 },
    light: { lux: 8000 },
    soil: [
      { id: 'basil_01', moisture: 0.4 },
      { id: 'parsley_01', moisture: null },
    ],
    tank: { level: 0.7 },
    actuators: { pump: false, growLight: false, fan: false, vent: 0 },
    fw: 'test',
    rssi: -50,
    ...overrides,
  };
}
