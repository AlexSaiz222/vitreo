import { serializeMessage, topic } from '@vitreo/shared';
import type { CommandMessage, ConfigMessage, SafetyLimit, WeatherMessage } from '@vitreo/shared';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';

import type { HubConfig } from './config.ts';
import type { ConfigOwner } from './configOwner.ts';
import type { HubDatabase } from './db/types.ts';
import { handleMessage, safetyLimitOf } from './ingest.ts';

/**
 * The broker keeps the hub's session (and its queue of messages) this long
 * while the hub is away (D87): short restarts lose nothing. Longer than any
 * normal absence; Mosquitto persists it to disk (infra/mosquitto).
 */
const SESSION_EXPIRY_S = 7 * 24 * 3600;
/** How long to wait for a retained config after subscribing. */
const RETAINED_GRACE_MS = 1_500;

export interface Ingest {
  client: MqttClient;
  connected: () => boolean;
  stop: () => Promise<void>;
}

/**
 * Listens to the greenhouse on the broker as user `hub`, with a persistent
 * session (D87): fixed client id, clean start off, QoS 1. While the hub is
 * down the broker queues telemetry and events for it; when it comes back it
 * receives them in order, so short restarts leave no gap.
 */
export function startIngest(
  config: HubConfig,
  db: HubDatabase,
  owner: ConfigOwner,
  log: (message: string) => void,
  onTelemetry: (ts: number) => void,
  /** A safety limit fired (A7): the alerts are told at once. */
  onSafety: (limit: SafetyLimit) => void = () => undefined,
): Ingest {
  const client = mqtt.connect(config.mqtt.url, {
    clientId: config.mqtt.clientId,
    username: config.mqtt.username,
    ...(config.mqtt.password ? { password: config.mqtt.password } : {}),
    protocolVersion: 5,
    // The e2e hub starts from nothing every run.
    clean: config.mode === 'test',
    properties: { sessionExpiryInterval: SESSION_EXPIRY_S },
    reconnectPeriod: 2_000,
  });

  let announce: ReturnType<typeof setTimeout> | null = null;
  client.on('connect', (connack) => {
    log(`connected to the broker (session ${connack.sessionPresent ? 'kept' : 'new'})`);
    // Subscribing again is harmless with a kept session, and needed with a new one.
    client.subscribe(`vitreo/${config.deviceId}/#`, { qos: 1 }, () => {
      // Give a retained config a moment to arrive first: a newer one on the
      // broker (e.g. after restoring an older backup) is adopted, never
      // overwritten by ours.
      if (announce) clearTimeout(announce);
      announce = setTimeout(() => {
        const current = owner.announce(Date.now());
        log(`config rev ${current.rev.toString()} published`);
      }, RETAINED_GRACE_MS);
    });
  });
  client.on('message', (name, payload) => {
    const text = payload.toString();
    const ts = handleMessage(db, owner, config.deviceId, name, text, Date.now());
    if (ts !== null) onTelemetry(ts);
    const limit = safetyLimitOf(name, text);
    if (limit !== null) onSafety(limit);
  });
  client.on('error', (error) => {
    log(`broker error: ${error.message}`);
  });

  return {
    client,
    connected: () => client.connected,
    stop: () => {
      if (announce) clearTimeout(announce);
      return client.endAsync();
    },
  };
}

/**
 * Publishes the outdoor weather, retained, QoS 1 (A10); null clears it (no
 * key: the app shows no weather rather than an old one).
 */
export function publishWeather(
  client: MqttClient,
  device: string,
  message: WeatherMessage | null,
): void {
  const payload = message ? serializeMessage('weather', message) : '';
  client.publish(topic(device, 'weather'), payload, { qos: 1, retain: true });
}

/** An order from the hub's own rules (A10), validated like any other. */
export function publishCommand(client: MqttClient, device: string, command: CommandMessage): void {
  client.publish(topic(device, 'cmd'), serializeMessage('cmd', command), { qos: 1 });
}

/** Publishes a config, retained, QoS 1 (D73). */
export function publishConfig(client: MqttClient, device: string, config: ConfigMessage): void {
  client.publish(topic(device, 'config'), JSON.stringify(config), { qos: 1, retain: true });
}
