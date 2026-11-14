import { describe, expect, it } from 'vitest';

import { anyDeviceTopic, CHANNELS, parseTopic, RETAINED, topic } from './topics.ts';

describe('topic', () => {
  it.each(CHANNELS)('builds the %s topic under the device prefix', (channel) => {
    expect(topic('greenhouse_01', channel)).toBe(`vitreo/greenhouse_01/${channel}`);
  });

  it.each(['', 'Greenhouse', 'a/b', 'a+', '#', 'with space'])('rejects the device id %j', (id) => {
    expect(() => topic(id, 'telemetry')).toThrow();
  });
});

describe('anyDeviceTopic', () => {
  it('uses a single-level wildcard for the device', () => {
    expect(anyDeviceTopic('status')).toBe('vitreo/+/status');
  });
});

describe('parseTopic', () => {
  it('round-trips every channel', () => {
    for (const channel of CHANNELS) {
      expect(parseTopic(topic('sim', channel))).toEqual({ deviceId: 'sim', channel });
    }
  });

  it.each([
    'vitreo/sim',
    'vitreo/sim/telemetry/extra',
    'other/sim/telemetry',
    'vitreo/sim/unknown',
    'vitreo/+/telemetry',
    'vitreo//telemetry',
  ])('returns null for %j', (value) => {
    expect(parseTopic(value)).toBeNull();
  });
});

describe('RETAINED', () => {
  it('retains status, telemetry, config and weather only', () => {
    const retained = CHANNELS.filter((c) => RETAINED[c]);
    expect(retained).toEqual(['status', 'telemetry', 'config', 'weather']);
  });
});
