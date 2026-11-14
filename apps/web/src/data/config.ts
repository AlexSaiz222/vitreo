import { deviceId } from '@vitreo/shared';
import { z } from 'zod';

/** Tailscale serves the broker's WebSocket over TLS on this port (docs/05). */
export const SECURE_MQTT_PORT = 8443;

const schema = z.object({
  VITE_MQTT_URL: z.url().optional(),
  VITE_MQTT_URL_SECURE: z.url().optional(),
  VITE_MQTT_USERNAME: z.string().min(1),
  VITE_MQTT_PASSWORD: z.string().min(1),
  VITE_DEVICE_ID: deviceId.default('sim'),
});

export interface DataConfig {
  mqttUrl: string;
  username: string;
  password: string;
  deviceId: string;
}

export interface PageLocation {
  protocol: string;
  hostname: string;
}

/**
 * Reads the broker settings from the Vite environment, or `null` if they are
 * missing. The app never assumes it runs at home (docs/05): over HTTPS (the
 * Tailscale address) it must use a `wss://` broker, by default the same host
 * on port 8443; over plain HTTP it uses VITE_MQTT_URL.
 */
export function readDataConfig(
  env: Record<string, unknown>,
  page: PageLocation = { protocol: 'http:', hostname: 'localhost' },
): DataConfig | null {
  const parsed = schema.safeParse(env);
  if (!parsed.success) return null;
  const secure = page.protocol === 'https:';
  const mqttUrl = secure
    ? (parsed.data.VITE_MQTT_URL_SECURE ?? `wss://${page.hostname}:${SECURE_MQTT_PORT.toString()}`)
    : parsed.data.VITE_MQTT_URL;
  if (!mqttUrl) return null;
  return {
    mqttUrl,
    username: parsed.data.VITE_MQTT_USERNAME,
    password: parsed.data.VITE_MQTT_PASSWORD,
    deviceId: parsed.data.VITE_DEVICE_ID,
  };
}
