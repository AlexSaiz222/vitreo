import { topic } from '@vitreo/shared';
import mqtt from 'mqtt';

import { CommandService } from './commands.ts';
import type { DataConfig } from './config.ts';
import { routeMessage } from './router.ts';
import type { BrokerLink, GreenhouseStore } from './store.ts';

/** How often staleness is re-evaluated when no data arrives. */
const CLOCK_TICK_MS = 5_000;

export interface Connection {
  commands: CommandService;
  close(): void;
}

/** Connects the store to the broker over WebSocket. The only place that talks MQTT. */
export function connectGreenhouse(config: DataConfig, store: GreenhouseStore): Connection {
  const client = mqtt.connect(config.mqttUrl, {
    username: config.username,
    password: config.password,
    clientId: `vitreo-web-${crypto.randomUUID().slice(0, 8)}`,
    reconnectPeriod: 3_000,
    connectTimeout: 10_000,
  });

  const commands = new CommandService(store, {
    get connected() {
      return client.connected;
    },
    publish: async (name, payload) => {
      await client.publishAsync(name, payload, { qos: 1 });
    },
  });

  const setLink = (link: BrokerLink, at: number) => {
    store.getState().setLink(link, at);
  };
  client.on('connect', () => {
    setLink('connected', Date.now());
    const { deviceId } = config;
    void client.subscribeAsync(
      [
        topic(deviceId, 'status'),
        topic(deviceId, 'telemetry'),
        topic(deviceId, 'event'),
        topic(deviceId, 'ack'),
        topic(deviceId, 'weather'),
      ],
      { qos: 1 },
    );
  });
  client.on('reconnect', () => {
    setLink('reconnecting', Date.now());
  });
  client.on('offline', () => {
    setLink('offline', Date.now());
  });
  client.on('close', () => {
    if (store.getState().link === 'connected') setLink('offline', Date.now());
  });
  client.on('error', (error) => {
    console.warn(`[vitreo] MQTT: ${error.message}`);
  });
  client.on('message', (name, payload) => {
    routeMessage(store, commands, name, payload, Date.now());
  });

  const clock = setInterval(() => {
    store.getState().tick(Date.now());
  }, CLOCK_TICK_MS);

  return {
    commands,
    close() {
      clearInterval(clock);
      commands.dispose();
      client.end(true);
    },
  };
}
