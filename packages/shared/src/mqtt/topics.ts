import { deviceId as deviceIdSchema } from './common.ts';
import type { DeviceId } from './common.ts';

export const TOPIC_ROOT = 'vitreo';

export const CHANNELS = [
  'status',
  'telemetry',
  'event',
  'cmd',
  'ack',
  'config',
  'weather',
] as const;

export type Channel = (typeof CHANNELS)[number];

/** Whether messages on each channel are published with the MQTT retain flag. */
export const RETAINED = {
  status: true,
  telemetry: true,
  event: false,
  cmd: false,
  ack: false,
  config: true,
  /** Outdoor weather from AEMET, published by the hub (A10). */
  weather: true,
} as const satisfies Record<Channel, boolean>;

/** Builds `vitreo/<deviceId>/<channel>`. Throws on an invalid device id. */
export function topic(deviceId: DeviceId, channel: Channel): string {
  deviceIdSchema.parse(deviceId);
  return `${TOPIC_ROOT}/${deviceId}/${channel}`;
}

/** Subscription filter for one channel of every device: `vitreo/+/<channel>`. */
export function anyDeviceTopic(channel: Channel): string {
  return `${TOPIC_ROOT}/+/${channel}`;
}

/** Splits a concrete topic back into its parts, or returns `null` if it is not a Vitreo topic. */
export function parseTopic(value: string): { deviceId: DeviceId; channel: Channel } | null {
  const parts = value.split('/');
  if (parts.length !== 3) return null;
  const [root, id, channel] = parts;
  if (root !== TOPIC_ROOT || !isChannel(channel)) return null;
  if (id === undefined || !deviceIdSchema.safeParse(id).success) return null;
  return { deviceId: id, channel };
}

function isChannel(value: string | undefined): value is Channel {
  return (CHANNELS as readonly (string | undefined)[]).includes(value);
}
