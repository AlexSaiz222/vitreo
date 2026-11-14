import { parseMessage } from '@vitreo/shared';
import { attributionOf, statusPublication } from '@vitreo/sim-core';
import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';
import { scenarioRequest } from './control.ts';

describe('statusPublication', () => {
  it.each(['online', 'offline'] as const)('builds a retained, valid %s message', (state) => {
    const publication = statusPublication('sim', state);
    expect(publication.topic).toBe('vitreo/sim/status');
    expect(publication.retain).toBe(true);
    expect(parseMessage('status', publication.payload)).toEqual({
      ok: true,
      message: { v: 1, state },
    });
  });
});

describe('simulator config', () => {
  it('requires the device password', () => {
    expect(() => loadConfig({})).toThrow(/MQTT_DEVICE_PASSWORD/);
  });

  it('uses sensible local defaults', () => {
    expect(loadConfig({ MQTT_DEVICE_PASSWORD: 'secret' })).toEqual({
      deviceId: 'sim',
      mqttUrl: 'mqtt://localhost:1883',
      username: 'device',
      password: 'secret',
      controlPort: 8788,
      controlHost: '127.0.0.1',
      paramsFile: undefined,
      timeScale: undefined,
      stateFile: undefined,
    });
  });

  it('rejects a device id that would break the topic', () => {
    expect(() =>
      loadConfig({ MQTT_DEVICE_PASSWORD: 'secret', SIMULATOR_DEVICE_ID: 'a/b' }),
    ).toThrow();
  });
});

describe('attributionOf', () => {
  it('recovers requestId and source from an invalid command', () => {
    const payload = JSON.stringify({ v: 1, requestId: 'a1', source: 'agent', action: 'dance' });
    expect(attributionOf(payload)).toEqual({ requestId: 'a1', source: 'agent' });
  });

  it('defaults the source to user when it is missing or invalid', () => {
    expect(attributionOf(JSON.stringify({ requestId: 'a1', source: 'safety' }))).toEqual({
      requestId: 'a1',
      source: 'user',
    });
  });

  it.each(['not json', '42', '{}', JSON.stringify({ requestId: 'bad id!' })])(
    'gives up on %j',
    (payload) => {
      expect(attributionOf(payload)).toBeNull();
    },
  );
});

describe('scenarioRequest', () => {
  it.each([
    { scenario: 'heatwave', active: true },
    { scenario: 'disconnect', active: false },
    { scenario: 'sensor_failure', active: true, sensor: 'air' },
    { scenario: 'sensor_failure', active: true, sensor: 'soil', zone: 'basil_01' },
  ])('accepts %j', (body) => {
    expect(scenarioRequest.safeParse(body).success).toBe(true);
  });

  it.each([
    { scenario: 'earthquake', active: true },
    { scenario: 'sensor_failure', active: true, sensor: 'soil' },
    { scenario: 'heatwave' },
  ])('rejects %j', (body) => {
    expect(scenarioRequest.safeParse(body).success).toBe(false);
  });
});
