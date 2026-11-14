/**
 * Checks the local broker: authentication, both listeners and the ACL.
 * Run with `pnpm broker:check` after `pnpm broker:up`.
 */
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';

import { loadRootEnv } from './env.ts';

loadRootEnv();

const env = process.env;
const tcpUrl = `mqtt://localhost:${env['MQTT_PORT'] ?? '1883'}`;
const wsUrl = `ws://localhost:${env['MQTT_WS_PORT'] ?? '9002'}`;
const TIMEOUT_MS = 5_000;

interface Credentials {
  username: string;
  password: string;
}

function credentials(username: string, variable: string): Credentials {
  const password = env[variable];
  if (!password) throw new Error(`${variable} is not set (see .env.example)`);
  return { username, password };
}

const device = credentials('device', 'MQTT_DEVICE_PASSWORD');
const hub = credentials('hub', 'MQTT_HUB_PASSWORD');
const web = credentials('web', 'MQTT_WEB_PASSWORD');

function connect(url: string, auth?: Credentials): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(url, {
      ...auth,
      protocolVersion: 5,
      reconnectPeriod: 0,
      connectTimeout: TIMEOUT_MS,
    });
    client.once('connect', () => {
      resolve(client);
    });
    client.once('error', (error) => {
      client.end(true);
      reject(error);
    });
  });
}

function publish(client: MqttClient, topic: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 1 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function roundTrip(from: MqttClient, to: MqttClient, topic: string): Promise<void> {
  const payload = `check-${Date.now().toString()}`;
  await to.subscribeAsync(topic, { qos: 1 });
  const received = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('message not delivered'));
    }, TIMEOUT_MS);
    to.on('message', (t, message) => {
      if (t === topic && message.toString() === payload) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await publish(from, topic, payload);
  await received;
  await to.unsubscribeAsync(topic);
}

/** Passes only if the broker refuses with "not authorised", not on any other error. */
async function expectRejected(promise: Promise<unknown>): Promise<string> {
  try {
    const result = await promise;
    if (result && typeof result === 'object' && 'end' in result) (result as MqttClient).end(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not authori[sz]ed/i.test(message)) return message;
    throw new Error(`failed for another reason: ${message}`, { cause: error });
  }
  throw new Error('was allowed');
}

const checks: [name: string, run: () => Promise<unknown>][] = [];
const clients: MqttClient[] = [];
const open = async (url: string, auth: Credentials) => {
  const client = await connect(url, auth);
  clients.push(client);
  return client;
};

let deviceTcp: MqttClient;
let hubTcp: MqttClient;
let webWs: MqttClient;

checks.push(
  ['anonymous connection is refused (MQTT)', () => expectRejected(connect(tcpUrl))],
  ['anonymous connection is refused (WebSocket)', () => expectRejected(connect(wsUrl))],
  [
    'wrong password is refused',
    () => expectRejected(connect(tcpUrl, { username: 'web', password: 'wrong' })),
  ],
  ['device connects over MQTT', async () => void (deviceTcp = await open(tcpUrl, device))],
  ['hub connects over MQTT', async () => void (hubTcp = await open(tcpUrl, hub))],
  ['web connects over WebSocket', async () => void (webWs = await open(wsUrl, web))],
  ['device → telemetry → web', () => roundTrip(deviceTcp, webWs, 'vitreo/check/telemetry')],
  ['web → cmd → device', () => roundTrip(webWs, deviceTcp, 'vitreo/check/cmd')],
  ['hub → config → device', () => roundTrip(hubTcp, deviceTcp, 'vitreo/check/config')],
  [
    'web cannot publish telemetry',
    () => expectRejected(publish(webWs, 'vitreo/check/telemetry', '{}')),
  ],
  ['web cannot publish config', () => expectRejected(publish(webWs, 'vitreo/check/config', '{}'))],
  ['device cannot publish cmd', () => expectRejected(publish(deviceTcp, 'vitreo/check/cmd', '{}'))],
  [
    'nobody can publish outside vitreo/',
    () => expectRejected(publish(hubTcp, 'other/topic', '{}')),
  ],
);

let failed = 0;
for (const [name, run] of checks) {
  try {
    const detail = await run();
    console.info(`  ✓ ${name}${typeof detail === 'string' ? ` (${detail})` : ''}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const client of clients) client.end(true);
console.info(failed === 0 ? '\nBroker OK' : `\n${failed.toString()} check(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;
