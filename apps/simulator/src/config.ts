import { deviceId } from '@vitreo/shared';
import { z } from 'zod';

const configSchema = z.object({
  SIMULATOR_DEVICE_ID: deviceId.default('sim'),
  SIMULATOR_MQTT_URL: z.url().default('mqtt://localhost:1883'),
  MQTT_DEVICE_USERNAME: z.string().min(1).default('device'),
  MQTT_DEVICE_PASSWORD: z.string().min(1, 'MQTT_DEVICE_PASSWORD is required (see .env.example)'),
  SIMULATOR_CONTROL_PORT: z.coerce.number().int().min(1).max(65_535).default(8788),
  /** 0.0.0.0 only inside its container, whose port is published on 127.0.0.1. */
  SIMULATOR_CONTROL_HOST: z.string().min(1).default('127.0.0.1'),
  SIMULATOR_PARAMS: z.string().min(1).optional(),
  SIMULATOR_TIME_SCALE: z.coerce.number().positive().optional(),
  SIMULATOR_STATE_FILE: z.string().min(1).optional(),
});

export interface SimulatorConfig {
  deviceId: string;
  mqttUrl: string;
  username: string;
  password: string;
  /** Local HTTP port for forcing scenarios (development only). */
  controlPort: number;
  controlHost: string;
  /** Optional JSON file overriding the physical parameters. */
  paramsFile: string | undefined;
  /** Optional override of `timing.timeScale`. */
  timeScale: number | undefined;
  /**
   * Where the greenhouse is kept over restarts (D100): only the daily
   * simulator has one; without it, every start is a fresh greenhouse.
   */
  stateFile: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SimulatorConfig {
  const parsed = configSchema.parse(env);
  return {
    deviceId: parsed.SIMULATOR_DEVICE_ID,
    mqttUrl: parsed.SIMULATOR_MQTT_URL,
    username: parsed.MQTT_DEVICE_USERNAME,
    password: parsed.MQTT_DEVICE_PASSWORD,
    controlPort: parsed.SIMULATOR_CONTROL_PORT,
    controlHost: parsed.SIMULATOR_CONTROL_HOST,
    paramsFile: parsed.SIMULATOR_PARAMS,
    timeScale: parsed.SIMULATOR_TIME_SCALE,
    stateFile: parsed.SIMULATOR_STATE_FILE,
  };
}
