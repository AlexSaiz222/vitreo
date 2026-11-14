import { describe, expect, it, vi } from 'vitest';

import { readDataConfig } from './config.ts';
import { routeMessage } from './router.ts';
import { createGreenhouseStore } from './store.ts';
import { telemetry } from './testing.ts';

const T0 = Date.parse('2026-09-30T12:00:00Z');

function setup() {
  const store = createGreenhouseStore('sim', T0);
  const commands = { handleAck: vi.fn() };
  const route = (topic: string, payload: unknown) =>
    routeMessage(store, commands, topic, JSON.stringify(payload), T0);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return { store, commands, route };
}

describe('routeMessage', () => {
  it('applies status and telemetry for our device', () => {
    const { store, route } = setup();
    expect(route('vitreo/sim/status', { v: 1, state: 'online' })).toBe(true);
    expect(route('vitreo/sim/telemetry', telemetry(T0))).toBe(true);
    expect(store.getState().device.state).toBe('online');
    expect(store.getState().telemetry?.ts).toBe(T0 / 1000);
  });

  it('hands acks to the command service', () => {
    const { commands, route } = setup();
    const ack = { v: 1, requestId: 'a1', ts: 1, source: 'user', result: 'ok' };
    route('vitreo/sim/ack', ack);
    expect(commands.handleAck).toHaveBeenCalledWith(ack);
  });

  it('records events', () => {
    const { store, route } = setup();
    route('vitreo/sim/event', { v: 1, ts: 1, type: 'sensor.error', sensor: 'air' });
    expect(store.getState().events).toHaveLength(1);
  });

  it('shows what a newer device sends, leaving out the fields it does not know', () => {
    const { store, route } = setup();
    const event = {
      v: 1,
      ts: 1,
      type: 'automation.switched',
      source: 'automation',
      target: 'fan',
      value: true,
      reason: { kind: 'humidity', value: 88, limit: 85, trend: 'rising' },
      firmware: '3.1.0',
    };
    expect(route('vitreo/sim/event', event)).toBe(true);
    expect(route('vitreo/sim/telemetry', { ...telemetry(T0), co2: 612 })).toBe(true);
    expect(store.getState().events).toEqual([
      expect.objectContaining({
        type: 'automation.switched',
        reason: { kind: 'humidity', value: 88, limit: 85 },
      }),
    ]);
    expect(store.getState().events[0]).not.toHaveProperty('firmware');
    expect(store.getState().telemetry).not.toHaveProperty('co2');
  });

  it('skips an event of a type it does not know, quietly (D108)', () => {
    const { store, route } = setup();
    const warn = vi.spyOn(console, 'warn');
    expect(
      route('vitreo/sim/event', { v: 1, ts: 1, type: 'filter.clogged', zone: 'basil_01' }),
    ).toBe(true);
    expect(store.getState().events).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores other devices, unknown topics and invalid payloads', () => {
    const { store, route } = setup();
    expect(route('vitreo/other/telemetry', telemetry(T0))).toBe(false);
    expect(route('elsewhere/sim/telemetry', telemetry(T0))).toBe(false);
    expect(route('vitreo/sim/telemetry', { v: 1, ts: 'now' })).toBe(false);
    expect(route('vitreo/sim/status', 'online')).toBe(false);
    expect(store.getState().telemetry).toBeNull();
    expect(store.getState().device.state).toBe('unknown');
  });
});

describe('readDataConfig', () => {
  it('reads the broker settings', () => {
    expect(
      readDataConfig({
        VITE_MQTT_URL: 'ws://localhost:9002',
        VITE_MQTT_USERNAME: 'web',
        VITE_MQTT_PASSWORD: 'secret',
      }),
    ).toEqual({
      mqttUrl: 'ws://localhost:9002',
      username: 'web',
      password: 'secret',
      deviceId: 'sim',
    });
  });

  it('uses a secure broker on the same host when the page is served over HTTPS', () => {
    const env = {
      VITE_MQTT_URL: 'ws://localhost:9002',
      VITE_MQTT_USERNAME: 'web',
      VITE_MQTT_PASSWORD: 'secret',
    };
    expect(
      readDataConfig(env, { protocol: 'https:', hostname: 'pc.tail1234.ts.net' }),
    ).toMatchObject({
      mqttUrl: 'wss://pc.tail1234.ts.net:8443',
    });
    expect(
      readDataConfig(
        { ...env, VITE_MQTT_URL_SECURE: 'wss://broker.example.ts.net' },
        { protocol: 'https:', hostname: 'pc.tail1234.ts.net' },
      ),
    ).toMatchObject({ mqttUrl: 'wss://broker.example.ts.net' });
  });

  it('returns null when settings are missing', () => {
    expect(readDataConfig({})).toBeNull();
  });
});
