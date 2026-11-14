import { describe, expect, it } from 'vitest';

import { ackMessage } from './ack.ts';
import { commandMessage, MAX_HOLD_MINUTES, MAX_WATER_SECONDS } from './command.ts';
import { configMessage } from './config.ts';
import { eventMessage, knownEventList } from './event.ts';
import {
  ackExamples,
  commandExamples,
  configExample,
  configV1Example,
  eventExamples,
  telemetryExample,
  weatherExample,
} from './fixtures.ts';
import { parseEvent, parseMessage, serializeMessage } from './messages.ts';
import { statusMessage } from './status.ts';
import { telemetryMessage } from './telemetry.ts';
import { weatherMessage } from './weather.ts';

describe('status', () => {
  it.each(['online', 'offline'])('accepts %s', (state) => {
    expect(statusMessage.safeParse({ v: 1, state }).success).toBe(true);
  });

  it('rejects the bare string payload', () => {
    expect(statusMessage.safeParse('online').success).toBe(false);
  });
});

describe('schema version', () => {
  const valid = [
    ['status', statusMessage, { v: 1, state: 'online' }],
    ['telemetry', telemetryMessage, telemetryExample],
    ['cmd', commandMessage, commandExamples[0]],
    ['ack', ackMessage, ackExamples[0]],
    ['event', eventMessage, eventExamples[0]],
    ['config', configMessage, configExample],
    ['weather', weatherMessage, weatherExample],
  ] as const;

  // config has its own version (2, D89); the other messages stay at 1.
  it.each(valid)('%s requires its version', (name, schema, message) => {
    expect(schema.safeParse(message).success).toBe(true);
    const other = name === 'config' ? 1 : 2;
    expect(schema.safeParse({ ...message, v: other }).success).toBe(false);
    const { v: _v, ...withoutVersion } = message;
    expect(schema.safeParse(withoutVersion).success).toBe(false);
  });
});

describe('telemetry', () => {
  it('accepts the documented example', () => {
    expect(telemetryMessage.parse(telemetryExample)).toEqual(telemetryExample);
  });

  it('accepts null readings from a broken sensor instead of made-up values', () => {
    const message = {
      ...telemetryExample,
      air: { temp: null, rh: null },
      light: { lux: null },
      soil: [{ id: 'basil_01', moisture: null }],
      tank: { level: null },
    };
    expect(telemetryMessage.safeParse(message).success).toBe(true);
  });

  it('rejects a missing reading (it must be explicit null)', () => {
    const message = { ...telemetryExample, air: { temp: 22.4 } };
    expect(telemetryMessage.safeParse(message).success).toBe(false);
  });

  it.each([-0.01, 1.01])('rejects soil moisture %d outside 0–1', (moisture) => {
    const message = { ...telemetryExample, soil: [{ id: 'basil_01', moisture }] };
    expect(telemetryMessage.safeParse(message).success).toBe(false);
  });

  it.each([-0.1, 1.5])('rejects vent opening %d outside 0–1', (vent) => {
    const message = { ...telemetryExample, actuators: { ...telemetryExample.actuators, vent } };
    expect(telemetryMessage.safeParse(message).success).toBe(false);
  });

  it('rejects relative humidity above 100 %', () => {
    const message = { ...telemetryExample, air: { temp: 22, rh: 101 } };
    expect(telemetryMessage.safeParse(message).success).toBe(false);
  });

  it('rejects duplicate zone ids', () => {
    const message = {
      ...telemetryExample,
      soil: [
        { id: 'basil_01', moisture: 0.4 },
        { id: 'basil_01', moisture: 0.5 },
      ],
    };
    expect(telemetryMessage.safeParse(message).success).toBe(false);
  });

  it('rejects millisecond timestamps given as fractions and negative ones', () => {
    expect(telemetryMessage.safeParse({ ...telemetryExample, ts: 1790780400.5 }).success).toBe(
      false,
    );
    expect(telemetryMessage.safeParse({ ...telemetryExample, ts: -1 }).success).toBe(false);
  });

  it('reads a newer device: unknown fields left out, known ones still checked', () => {
    const newer = {
      ...telemetryExample,
      co2: 612,
      air: { ...telemetryExample.air, pressure: 1013 },
    };
    expect(telemetryMessage.parse(newer)).toEqual(telemetryExample);
    expect(telemetryMessage.safeParse({ ...newer, air: { ...newer.air, rh: 140 } }).success).toBe(
      false,
    );
  });

  it('reports the outdoor hold, or none, or nothing from older devices (A10)', () => {
    const hold = { cause: 'wind', until: telemetryExample.ts + 1800 };
    expect(telemetryMessage.safeParse({ ...telemetryExample, outdoorHold: hold }).success).toBe(
      true,
    );
    expect(telemetryMessage.safeParse({ ...telemetryExample, outdoorHold: null }).success).toBe(
      true,
    );
    expect(telemetryMessage.safeParse(telemetryExample).success).toBe(true);
  });
});

describe('cmd', () => {
  it.each(commandExamples)('accepts $action ($requestId)', (example) => {
    expect(commandMessage.parse(example)).toEqual(example);
  });

  it('requires a source', () => {
    const { source: _source, ...withoutSource } = commandExamples[0];
    expect(commandMessage.safeParse(withoutSource).success).toBe(false);
  });

  it('holds the window closed only for a while, and for a weather reason (A10)', () => {
    const hold = commandExamples.find((c) => c.requestId === 'hub-hold-1');
    expect(commandMessage.safeParse({ ...hold, minutes: undefined }).success).toBe(false);
    expect(commandMessage.safeParse({ ...hold, minutes: MAX_HOLD_MINUTES + 1 }).success).toBe(
      false,
    );
    const hail = { ...hold, reason: { kind: 'weather', cause: 'hail', value: 1, limit: 0 } };
    expect(commandMessage.safeParse(hail).success).toBe(false);
    const heat = { ...hold, reason: { kind: 'temperature', value: 30, limit: 28 } };
    expect(commandMessage.safeParse(heat).success).toBe(false);
  });

  it('no longer takes a reason on vent: the hold says why (A10)', () => {
    const close = {
      ...commandExamples[4],
      reason: { kind: 'weather', cause: 'rain', value: 1, limit: 0.1 },
    };
    expect(commandMessage.safeParse(close).success).toBe(false);
  });

  it('does not let a command claim the safety source', () => {
    expect(commandMessage.safeParse({ ...commandExamples[0], source: 'safety' }).success).toBe(
      false,
    );
  });

  it.each([0, MAX_WATER_SECONDS + 1, 2.5])('rejects watering for %d seconds', (seconds) => {
    expect(commandMessage.safeParse({ ...commandExamples[0], seconds }).success).toBe(false);
  });

  it('requires a duration to switch the fan on', () => {
    const message = { v: 1, requestId: 'x', source: 'user', action: 'fan', on: true };
    expect(commandMessage.safeParse(message).success).toBe(false);
  });

  it('rejects an unknown action', () => {
    const message = { v: 1, requestId: 'x', source: 'user', action: 'heater', on: true };
    expect(commandMessage.safeParse(message).success).toBe(false);
  });

  it('rejects an invalid zone id', () => {
    expect(commandMessage.safeParse({ ...commandExamples[0], zone: 'Basil 01' }).success).toBe(
      false,
    );
  });
});

describe('ack', () => {
  it.each(ackExamples)('accepts a $result ack', (example) => {
    expect(ackMessage.parse(example)).toEqual(example);
  });

  it('requires a reason when rejected', () => {
    const { reason: _reason, ...withoutReason } = ackExamples[1];
    expect(ackMessage.safeParse(withoutReason).success).toBe(false);
  });

  it('reads an ok ack from a newer device as ok, without what it does not know', () => {
    expect(ackMessage.parse({ ...ackExamples[0], reason: 'busy', took: 12 })).toEqual(
      ackExamples[0],
    );
  });
});

describe('event', () => {
  it.each(eventExamples)('accepts $type', (example) => {
    expect(eventMessage.parse(example)).toEqual(example);
  });

  it.each(eventExamples)('reads $type from a newer device, extra fields and all', (example) => {
    const newer: Record<string, unknown> = { ...example, firmware: '3.1.0' };
    if ('reason' in example && typeof example.reason === 'object')
      newer['reason'] = { ...example.reason, confidence: 0.9 };
    expect(parseMessage('event', JSON.stringify(newer))).toEqual({ ok: true, message: example });
  });

  it('still checks the fields it knows in a newer event', () => {
    const newer = { ...eventExamples[0], firmware: '3.1.0', seconds: -5 };
    expect(eventMessage.safeParse(newer).success).toBe(false);
  });

  it('only accepts safety as the source of a safety event', () => {
    const message = { ...eventExamples[2], source: 'user' };
    expect(eventMessage.safeParse(message).success).toBe(false);
  });

  it('requires a zone for soil sensor errors', () => {
    const message = { v: 1, ts: 1, type: 'sensor.error', sensor: 'soil' };
    expect(eventMessage.safeParse(message).success).toBe(false);
  });
});

describe('config', () => {
  it('accepts the example', () => {
    expect(configMessage.parse(configExample)).toEqual(configExample);
  });

  it('has no place for safety limits', () => {
    const message = { ...configExample, safety: { pumpMaxSeconds: 60 } };
    expect(configMessage.safeParse(message).success).toBe(false);
  });

  it.each(['7:00', '24:00', '07:60', '0700'])('rejects the time %j', (on) => {
    const message = { ...configExample, light: { ...configExample.light, on } };
    expect(configMessage.safeParse(message).success).toBe(false);
  });

  it('rejects watering longer than a single command allows', () => {
    const rule = { ...configExample.watering[0], seconds: 30 };
    expect(configMessage.safeParse({ ...configExample, watering: [rule] }).success).toBe(false);
  });

  it('is version 2: a v1 config does not pass (D89)', () => {
    expect(configMessage.safeParse(configV1Example).success).toBe(false);
  });

  it('keeps the location rounded to 2 decimals', () => {
    const exact = { ...configExample, location: { lat: 40.4169, lng: -3.7 } };
    expect(configMessage.safeParse(exact).success).toBe(false);
  });

  it('needs a location for light by the sun', () => {
    const light = {
      enabled: true,
      mode: 'sun',
      sunriseOffset: 0,
      sunsetOffset: 120,
      belowLux: null,
    };
    expect(configMessage.safeParse({ ...configExample, light }).success).toBe(true);
    expect(configMessage.safeParse({ ...configExample, light, location: null }).success).toBe(
      false,
    );
  });

  it('opens the window at or above the fan temperature', () => {
    const ventilation = { ...configExample.ventilation, windowAbove: 25 };
    expect(configMessage.safeParse({ ...configExample, ventilation }).success).toBe(false);
  });
});

describe('parseMessage', () => {
  it('parses a valid payload from bytes', () => {
    const payload = new TextEncoder().encode(JSON.stringify(telemetryExample));
    expect(parseMessage('telemetry', payload)).toEqual({ ok: true, message: telemetryExample });
  });

  it('reports invalid JSON without throwing', () => {
    expect(parseMessage('status', 'online')).toEqual({
      ok: false,
      error: 'payload is not valid JSON',
    });
  });

  it('reports schema errors without throwing', () => {
    const result = parseMessage('cmd', JSON.stringify({ v: 1, action: 'water' }));
    expect(result.ok).toBe(false);
  });
});

describe('events of a type this version does not know (D108)', () => {
  const newer = {
    v: 1,
    ts: 1790780500,
    type: 'filter.clogged',
    source: 'safety',
    zone: 'basil_01',
    pressure: 1.4,
  };

  it('are valid when what every event shares is, and keep their type', () => {
    expect(parseEvent(JSON.stringify(newer))).toEqual({
      ok: true,
      known: false,
      message: { v: 1, ts: 1790780500, type: 'filter.clogged', source: 'safety', zone: 'basil_01' },
    });
    // No source (not an action) and no pot: still an event.
    expect(parseEvent(JSON.stringify({ v: 1, ts: 1, type: 'door.opened' }))).toMatchObject({
      ok: true,
      known: false,
    });
  });

  it('are invalid when the shared part is', () => {
    for (const broken of [
      { ...newer, v: 2 },
      { ...newer, ts: -1 },
      { ...newer, source: 'robot' },
      { ...newer, zone: 'Basil 1' },
      { ...newer, type: 'DROP TABLE' },
      { ...newer, type: '' },
    ]) {
      expect(parseEvent(JSON.stringify(broken)).ok, JSON.stringify(broken)).toBe(false);
    }
  });

  it('never excuse a known type that does not validate', () => {
    const bad = { ...eventExamples[0], seconds: -5 };
    expect(parseEvent(JSON.stringify(bad)).ok).toBe(false);
    expect(parseEvent(JSON.stringify(eventExamples[0]))).toEqual({
      ok: true,
      known: true,
      message: eventExamples[0],
    });
  });

  it('are left out of the event lists from the hub, quietly', () => {
    expect(knownEventList.parse([eventExamples[0], newer, eventExamples[1]])).toEqual([
      eventExamples[0],
      eventExamples[1],
    ]);
    expect(knownEventList.safeParse([{ ...eventExamples[0], seconds: -5 }]).success).toBe(false);
  });
});

describe('reading tolerantly, telling strictly', () => {
  it('reads status and weather from a newer sender', () => {
    expect(statusMessage.parse({ v: 1, state: 'online', uptime: 30 })).toEqual({
      v: 1,
      state: 'online',
    });
    expect(weatherMessage.parse({ ...weatherExample, uv: 3 })).toEqual(weatherExample);
  });

  it('keeps commands strict, the weather reason of the hold included', () => {
    for (const example of commandExamples) {
      expect(commandMessage.safeParse({ ...example, extra: 1 }).success, example.requestId).toBe(
        false,
      );
    }
    const hold = commandExamples.find((c) => c.requestId === 'hub-hold-1');
    expect(
      commandMessage.safeParse({ ...hold, reason: { ...hold?.reason, gustAt: 1 } }).success,
    ).toBe(false);
  });

  it('keeps config strict', () => {
    expect(configMessage.safeParse({ ...configExample, extra: 1 }).success).toBe(false);
    expect(
      configMessage.safeParse({
        ...configExample,
        ventilation: { ...configExample.ventilation, extra: 1 },
      }).success,
    ).toBe(false);
  });
});

describe('serializeMessage', () => {
  it('round-trips through parseMessage', () => {
    const text = serializeMessage('config', configMessage.parse(configExample));
    expect(parseMessage('config', text)).toEqual({ ok: true, message: configExample });
  });

  it('refuses to serialise an invalid message', () => {
    const invalid = { v: 1, state: 'sleeping' } as unknown as { v: 1; state: 'online' };
    expect(() => serializeMessage('status', invalid)).toThrow();
  });

  it('never publishes a field the contract does not know, even where reading tolerates it', () => {
    const extra = { ...telemetryExample, co2: 612 } as typeof telemetryMessage._zod.output;
    expect(() => serializeMessage('telemetry', extra)).toThrow(/unknown field co2/);
    const nested = {
      ...eventExamples[0],
      reason: { kind: 'soil', moisture: 0.3, threshold: 0.35, confidence: 1 },
    } as unknown as typeof eventMessage._zod.output;
    expect(() => serializeMessage('event', nested)).toThrow(/unknown field reason.confidence/);
  });
});
