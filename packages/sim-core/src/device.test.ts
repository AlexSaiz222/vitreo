import { serializeMessage } from '@vitreo/shared';
import type { Channel, MessageFor } from '@vitreo/shared';
import { configExample } from '@vitreo/shared/fixtures';
import { describe, expect, it } from 'vitest';

import { DeviceCore } from './device.ts';
import type { DeviceLink } from './device.ts';
import { DEFAULT_PARAMS } from './params.ts';

// 14:00 local time in Madrid.
const NOON = Date.parse('2026-09-30T12:00:00Z');

type Sent = { [C in Channel]: { channel: C; message: MessageFor<C> } }[Channel];

/** A link that records what the device sends, and can be cut. */
function fakeLink() {
  const sent: Sent[] = [];
  const link: DeviceLink & { up: boolean } = {
    up: true,
    get connected() {
      return this.up;
    },
    publish(channel, message) {
      sent.push({ channel, message } as Sent);
    },
  };
  return { link, sent };
}

function setup() {
  let now = NOON;
  const { link, sent } = fakeLink();
  const device = new DeviceCore(DEFAULT_PARAMS, link, () => now);
  return {
    device,
    link,
    sent,
    advance: (ms: number) => {
      for (let t = 0; t < ms; t += 1000) {
        now += 1000;
        device.tick();
      }
    },
  };
}

const channels = (sent: Sent[]) => sent.map((s) => s.channel);

describe('DeviceCore', () => {
  it('sends telemetry when linked, and then every period', () => {
    const { device, sent, advance } = setup();
    device.linked();
    expect(channels(sent)).toEqual(['telemetry']);
    advance(DEFAULT_PARAMS.timing.telemetryIntervalSeconds * 1000);
    expect(channels(sent).filter((c) => c === 'telemetry')).toHaveLength(2);
  });

  it('answers a command with its ack, and a watering with its events', () => {
    const { device, sent } = setup();
    device.handleCommand(
      serializeMessage('cmd', {
        v: 1,
        requestId: 'r1',
        source: 'user',
        action: 'water',
        zone: 'basil_01',
        seconds: 5,
      }),
    );
    const ack = sent.find((s) => s.channel === 'ack');
    expect(ack?.message).toMatchObject({ requestId: 'r1', result: 'ok' });
    expect(sent.some((s) => s.channel === 'event' && s.message.type === 'watering.started')).toBe(
      true,
    );
  });

  it('refuses an invalid command it can attribute, instead of staying silent', () => {
    const { device, sent } = setup();
    device.handleCommand(JSON.stringify({ v: 1, requestId: 'r2', source: 'user', action: 'nope' }));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      channel: 'ack',
      message: { requestId: 'r2', result: 'rejected', reason: 'invalid' },
    });
  });

  it('keeps the events of a cut link and delivers them in order once back', () => {
    const { device, link, sent, advance } = setup();
    device.handleConfig(JSON.stringify(configExample));
    sent.length = 0;
    link.up = false;
    device.handleCommand(
      serializeMessage('cmd', {
        v: 1,
        requestId: 'r3',
        source: 'user',
        action: 'water',
        zone: 'basil_01',
        seconds: 3,
      }),
    );
    advance(5000);
    expect(sent).toEqual([]);
    link.up = true;
    device.linked();
    const types = sent.flatMap((s) =>
      s.channel === 'event' && s.message.type.startsWith('watering.') ? [s.message.type] : [],
    );
    expect(types).toEqual(['watering.started', 'watering.finished']);
  });

  it('applies a config and keeps it for a reset, like the flash of the ESP32', () => {
    const { device, sent } = setup();
    device.handleConfig(JSON.stringify(configExample));
    expect(device.snapshot().configRev).toBe(configExample.rev);
    sent.length = 0;
    device.reset();
    expect(device.snapshot().configRev).toBe(configExample.rev);
  });

  it('refuses a config it cannot read, and says so', () => {
    const { device, sent } = setup();
    device.handleConfig('not json');
    expect(sent.some((s) => s.channel === 'event' && s.message.type === 'config.rejected')).toBe(
      true,
    );
  });
});
