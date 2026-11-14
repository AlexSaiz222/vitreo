import { ackMessage, eventMessage, telemetryMessage } from '@vitreo/shared';
import type { CommandMessage, EventMessage, WeatherReason } from '@vitreo/shared';
import { configExample } from '@vitreo/shared/fixtures';
import { describe, expect, it } from 'vitest';

import { GreenhouseSim, simMemory } from './greenhouse.ts';
import { DEFAULT_PARAMS } from './params.ts';
import type { SimParams } from './params.ts';
import { SAFETY } from './safety.ts';

const QUIET: SimParams = {
  ...DEFAULT_PARAMS,
  noise: { tempC: 0, rh: 0, lux: 0, moisture: 0 },
};

// 14:00 and 01:00 local time in Madrid.
const NOON = Date.parse('2026-09-30T12:00:00Z');
const NIGHT = Date.parse('2026-09-30T23:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

let counter = 0;
function water(zone = 'basil_01', seconds = 5): CommandMessage {
  counter++;
  return {
    v: 1,
    requestId: `r${counter.toString()}`,
    source: 'user',
    action: 'water',
    zone,
    seconds,
  };
}

function run(sim: GreenhouseSim, fromMs: number, durationMs: number, stepMs = MINUTE) {
  const events: EventMessage[] = [];
  for (let t = fromMs + stepMs; t <= fromMs + durationMs; t += stepMs) events.push(...sim.tick(t));
  return events;
}

function moisture(sim: GreenhouseSim, nowMs: number, zone = 'basil_01'): number | null {
  return sim.telemetry(nowMs).soil.find((s) => s.id === zone)?.moisture ?? null;
}

const types = (events: EventMessage[]) => events.map((e) => e.type);

describe('telemetry', () => {
  it('always matches the MQTT contract', () => {
    const sim = new GreenhouseSim(DEFAULT_PARAMS, NOON);
    for (let i = 0; i < 50; i++) {
      expect(() => telemetryMessage.parse(sim.telemetry(NOON + i * MINUTE))).not.toThrow();
    }
  });

  it('reports the six pots from docs/08 with a calibration version', () => {
    const soil = new GreenhouseSim(QUIET, NOON).telemetry(NOON).soil;
    expect(soil.map((s) => s.id)).toEqual([
      'basil_01',
      'parsley_01',
      'lettuce_01',
      'strawberry_01',
      'chives_01',
      'tomato_01',
    ]);
    expect(soil.every((s) => s.cal === 1)).toBe(true);
  });

  it('uses whole Unix seconds', () => {
    expect(new GreenhouseSim(QUIET, NOON + 1500).telemetry(NOON + 1500).ts).toBe(NOON / 1000 + 1);
  });
});

describe('day and night', () => {
  it('is brighter and warmer by day than by night', () => {
    const day = new GreenhouseSim(QUIET, NOON).telemetry(NOON);
    const night = new GreenhouseSim(QUIET, NIGHT).telemetry(NIGHT);
    expect(day.light.lux).toBeGreaterThan(10_000);
    expect(night.light.lux).toBe(0);
    expect(day.air.temp).toBeGreaterThan((night.air.temp ?? 0) + 5);
  });

  it('is more humid when it is cooler', () => {
    const day = new GreenhouseSim(QUIET, NOON).telemetry(NOON);
    const night = new GreenhouseSim(QUIET, NIGHT).telemetry(NIGHT);
    expect(night.air.rh).toBeGreaterThan(day.air.rh ?? 100);
  });

  it('adds grow light to the measured light at night', () => {
    const sim = new GreenhouseSim(QUIET, NIGHT);
    sim.command({ v: 1, requestId: 'l1', source: 'user', action: 'growLight', on: true }, NIGHT);
    expect(sim.telemetry(NIGHT).light.lux).toBe(DEFAULT_PARAMS.light.growLightLux);
  });
});

describe('soil', () => {
  it('dries slowly: a few points per day, faster when wet', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    const start = moisture(sim, NOON) ?? 0;
    run(sim, NOON, 24 * HOUR, 10 * MINUTE);
    const afterOneDay = moisture(sim, NOON + 24 * HOUR) ?? 0;
    run(sim, NOON + 24 * HOUR, 24 * HOUR, 10 * MINUTE);
    const afterTwoDays = moisture(sim, NOON + 48 * HOUR) ?? 0;

    const firstDay = start - afterOneDay;
    const secondDay = afterOneDay - afterTwoDays;
    expect(firstDay).toBeGreaterThan(0.05);
    expect(firstDay).toBeLessThan(0.3);
    expect(secondDay).toBeLessThan(firstDay);
  });

  it('never dries below the floor', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    run(sim, NOON, 60 * 24 * HOUR, HOUR);
    expect(moisture(sim, NOON + 60 * 24 * HOUR)).toBeGreaterThanOrEqual(0.03);
  });

  it('dries faster with a larger time scale', () => {
    const fast = new GreenhouseSim({ ...QUIET, timing: { ...QUIET.timing, timeScale: 60 } }, NOON);
    const normal = new GreenhouseSim(QUIET, NOON);
    run(fast, NOON, HOUR);
    run(normal, NOON, HOUR);
    expect(moisture(fast, NOON + HOUR)).toBeLessThan((moisture(normal, NOON + HOUR) ?? 0) - 0.05);
  });
});

describe('watering', () => {
  it('acks, raises soil moisture, uses water and reports start and real duration', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    const before = moisture(sim, NOON) ?? 0;
    const tankBefore = sim.telemetry(NOON).tank.level ?? 0;

    const { ack, events } = sim.command(water('basil_01', 5), NOON);
    expect(ackMessage.parse(ack)).toMatchObject({ result: 'ok', source: 'user' });
    expect(types(events)).toEqual(['watering.started']);
    expect(sim.telemetry(NOON + 2 * SECOND).actuators.pump).toBe(true);

    const later = run(sim, NOON, 10 * SECOND, SECOND);
    expect(later).toEqual([
      expect.objectContaining({ type: 'watering.finished', zone: 'basil_01', seconds: 5 }),
    ]);
    const after = sim.telemetry(NOON + 10 * SECOND);
    expect(after.actuators.pump).toBe(false);
    expect((moisture(sim, NOON + 10 * SECOND) ?? 0) - before).toBeCloseTo(0.15, 2);
    expect(tankBefore - (after.tank.level ?? 0)).toBeCloseTo(0.02, 2);
  });

  it('darkens the soil within a couple of seconds', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    const before = moisture(sim, NOON) ?? 0;
    sim.command(water('basil_01', 5), NOON);
    sim.tick(NOON + 2 * SECOND);
    expect((moisture(sim, NOON + 2 * SECOND) ?? 0) - before).toBeGreaterThan(0.05);
  });

  it('rejects a second watering while the pump runs', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    sim.command(water('basil_01'), NOON);
    expect(sim.command(water('parsley_01'), NOON + SECOND).ack).toMatchObject({
      result: 'rejected',
      reason: 'busy',
    });
  });

  it('stops at once on waterStop, with the real duration and the stop request (D84)', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    const before = moisture(sim, NOON) ?? 0;
    sim.command(water('basil_01', 10), NOON);
    sim.tick(NOON + 2 * SECOND);
    const stop = {
      v: 1,
      requestId: 'stop1',
      source: 'user',
      action: 'waterStop',
      zone: 'basil_01',
    } as const;
    const { ack, events } = sim.command(stop, NOON + 2 * SECOND);
    expect(ack).toMatchObject({ result: 'ok', requestId: 'stop1' });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'watering.finished',
        zone: 'basil_01',
        seconds: 2,
        stopRequestId: 'stop1',
      }),
    ]);
    expect(sim.telemetry(NOON + 3 * SECOND).actuators.pump).toBe(false);
    // Two seconds of water, not ten.
    expect((moisture(sim, NOON + 20 * SECOND) ?? 0) - before).toBeLessThan(0.1);
  });

  it('a stop for another zone, or with nothing running, changes nothing but is ok', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    const idle = { v: 1, requestId: 's0', source: 'user', action: 'waterStop' } as const;
    expect(sim.command(idle, NOON)).toMatchObject({ ack: { result: 'ok' }, events: [] });
    sim.command(water('basil_01', 5), NOON);
    const other = {
      v: 1,
      requestId: 's1',
      source: 'user',
      action: 'waterStop',
      zone: 'parsley_01',
    } as const;
    expect(sim.command(other, NOON + SECOND).events).toEqual([]);
    expect(sim.telemetry(NOON + 2 * SECOND).actuators.pump).toBe(true);
  });

  it('says which limit stopped a watering and when it can water again (D85)', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    sim.useUpPumpBudget(NOON);
    const { ack } = sim.command(water('basil_01', 5), NOON + SECOND);
    expect(ack).toMatchObject({
      result: 'rejected',
      reason: 'safety_limit',
      limit: 'pump_max_per_hour',
    });
    // The last minute of pumping leaves the hour 55 s after it began, an hour later.
    const retryAt = ack.result === 'rejected' ? (ack.retryAt ?? 0) * 1000 : 0;
    expect(retryAt).toBeGreaterThanOrEqual(NOON + HOUR - 56 * SECOND);
    expect(retryAt).toBeLessThanOrEqual(NOON + HOUR - 54 * SECOND);
    expect(sim.command(water('basil_01', 5), retryAt).ack).toMatchObject({ result: 'ok' });
  });

  it('rejects an unknown zone', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    expect(sim.command(water('mint_01'), NOON).ack).toMatchObject({ reason: 'invalid' });
  });

  it('is idempotent: a repeated requestId gets the same ack and waters once', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    const cmd = water('basil_01', 5);
    const first = sim.command(cmd, NOON);
    run(sim, NOON, 10 * SECOND, SECOND);
    const second = sim.command(cmd, NOON + 10 * SECOND);
    expect(second.ack).toEqual(first.ack);
    expect(sim.isWatering).toBe(false);
  });
});

describe('safety limits', () => {
  it('allows at most 60 s of pumping per rolling hour', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    let t = NOON;
    for (let i = 0; i < 4; i++) {
      expect(sim.command(water('basil_01', 15), t).ack.result).toBe('ok');
      t += 20 * SECOND;
      sim.tick(t);
    }
    const blocked = sim.command(water('basil_01', 1), t);
    expect(blocked.ack).toMatchObject({ result: 'rejected', reason: 'safety_limit' });
    expect(blocked.events).toContainEqual(
      expect.objectContaining({ type: 'safety.triggered', limit: 'pump_max_per_hour' }),
    );

    run(sim, t, HOUR);
    expect(sim.command(water('basil_01', 5), t + HOUR).ack.result).toBe('ok');
  });

  it('turns muggy at once with the humid scenario, and back when it ends (A9)', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    const before = sim.telemetry(NOON).air.rh ?? 0;
    sim.setScenario({ scenario: 'humid', active: true }, NOON);
    const humid = sim.telemetry(NOON).air.rh ?? 0;
    expect(humid).toBeGreaterThan(before + 15);
    expect(humid).toBeGreaterThanOrEqual(90);
    sim.setScenario({ scenario: 'humid', active: false }, NOON);
    expect(sim.telemetry(NOON).air.rh ?? 0).toBeLessThan(humid);
  });

  it('never starts the pump with an empty tank', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    sim.setScenario({ scenario: 'tank_empty', active: true }, NOON);
    expect(sim.telemetry(NOON).tank.level).toBe(0);
    const result = sim.command(water(), NOON);
    expect(result.ack).toMatchObject({ result: 'rejected', reason: 'tank_empty' });
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'safety.triggered', source: 'safety', limit: 'tank_empty' }),
    );
  });

  it('stops the pump when the tank runs dry mid-watering', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    sim.setTankLevel(SAFETY.tankEmptyLevel + 0.01);
    sim.command(water('basil_01', 15), NOON);
    const events = run(sim, NOON, 20 * SECOND, SECOND);
    expect(types(events)).toEqual(['safety.triggered', 'watering.finished']);
    const finished = events.find((e) => e.type === 'watering.finished');
    expect(finished && 'seconds' in finished ? finished.seconds : 99).toBeLessThan(15);
  });

  it('forces ventilation and switches the light off above 35 °C', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    sim.command({ v: 1, requestId: 'l1', source: 'user', action: 'growLight', on: true }, NOON);
    sim.setScenario({ scenario: 'heatwave', active: true }, NOON);
    const events = run(sim, NOON, 3 * HOUR);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'safety.triggered', limit: 'over_temperature' }),
    );

    const t = NOON + 3 * HOUR;
    expect(sim.telemetry(t).actuators).toMatchObject({ growLight: false, fan: true, vent: 1 });
    const base = { v: 1, source: 'user' } as const;
    const attempts: CommandMessage[] = [
      { ...base, requestId: 'h1', action: 'growLight', on: true },
      { ...base, requestId: 'h2', action: 'fan', on: false },
      { ...base, requestId: 'h3', action: 'vent', open: 0 },
    ];
    for (const cmd of attempts) {
      expect(sim.command(cmd, t).ack).toMatchObject({ result: 'rejected', reason: 'safety_limit' });
    }
  });

  it('releases the forced fan once it has cooled down', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    sim.setScenario({ scenario: 'heatwave', active: true }, NOON);
    run(sim, NOON, 3 * HOUR);
    sim.setScenario({ scenario: 'heatwave', active: false }, NOON + 3 * HOUR);
    run(sim, NOON + 3 * HOUR, 6 * HOUR);
    const t = NOON + 9 * HOUR;
    expect(sim.snapshot(t).overTemperature).toBe(false);
    expect(sim.telemetry(t).actuators.fan).toBe(false);
  });

  it('stops the pump when the connection is lost', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    sim.command(water('basil_01', 10), NOON);
    const events = sim.setScenario({ scenario: 'disconnect', active: true }, NOON + 2 * SECOND);
    expect(sim.isDisconnected).toBe(true);
    expect(types(events)).toEqual(['safety.triggered', 'watering.finished']);
    expect(events[0]).toMatchObject({ limit: 'connection_lost', zone: 'basil_01' });
    expect(sim.isWatering).toBe(false);
  });

  it('switches the fan off when its time is up', () => {
    const sim = new GreenhouseSim(QUIET, NIGHT);
    sim.command(
      { v: 1, requestId: 'f1', source: 'user', action: 'fan', on: true, minutes: 10 },
      NIGHT,
    );
    expect(sim.telemetry(NIGHT + 9 * MINUTE).actuators.fan).toBe(true);
    sim.tick(NIGHT + 11 * MINUTE);
    expect(sim.telemetry(NIGHT + 11 * MINUTE).actuators.fan).toBe(false);
  });
});

describe('broken sensors', () => {
  it('reports null, never a made-up value, and emits sensor.error once', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    const target = { sensor: 'soil', zone: 'parsley_01' } as const;
    const events = sim.setScenario({ scenario: 'sensor_failure', active: true, target }, NOON);
    expect(events).toEqual([
      expect.objectContaining({ type: 'sensor.error', sensor: 'soil', zone: 'parsley_01' }),
    ]);
    expect(sim.setScenario({ scenario: 'sensor_failure', active: true, target }, NOON)).toEqual([]);
    expect(moisture(sim, NOON, 'parsley_01')).toBeNull();
    expect(moisture(sim, NOON, 'basil_01')).not.toBeNull();

    sim.setScenario({ scenario: 'sensor_failure', active: false, target }, NOON);
    expect(moisture(sim, NOON, 'parsley_01')).not.toBeNull();
  });

  it('switches the grow light off and keeps it off without an air sensor', () => {
    const sim = new GreenhouseSim(QUIET, NIGHT);
    sim.command({ v: 1, requestId: 'l1', source: 'user', action: 'growLight', on: true }, NIGHT);
    sim.setScenario({ scenario: 'sensor_failure', active: true, target: { sensor: 'air' } }, NIGHT);
    const telemetry = sim.telemetry(NIGHT);
    expect(telemetry.air).toEqual({ temp: null, rh: null });
    expect(telemetry.actuators.growLight).toBe(false);
    const ack = sim.command(
      { v: 1, requestId: 'l2', source: 'user', action: 'growLight', on: true },
      NIGHT,
    ).ack;
    expect(ack).toMatchObject({ reason: 'safety_limit' });
  });

  it('refuses to pump when the tank level is unknown', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    sim.setScenario({ scenario: 'sensor_failure', active: true, target: { sensor: 'tank' } }, NOON);
    expect(sim.telemetry(NOON).tank.level).toBeNull();
    expect(sim.command(water(), NOON).ack).toMatchObject({ reason: 'safety_limit' });
  });
});

describe('contract', () => {
  it('only emits valid events and acks', () => {
    const sim = new GreenhouseSim(QUIET, NOON);
    const events: EventMessage[] = [];
    events.push(...sim.command(water('basil_01', 15), NOON).events);
    events.push(...run(sim, NOON, 20 * SECOND, SECOND));
    events.push(...sim.setScenario({ scenario: 'tank_empty', active: true }, NOON + 20 * SECOND));
    events.push(...sim.command(water(), NOON + 21 * SECOND).events);
    events.push(
      ...sim.setScenario(
        { scenario: 'sensor_failure', active: true, target: { sensor: 'light' } },
        NOON + 22 * SECOND,
      ),
    );
    expect(events.length).toBeGreaterThanOrEqual(4);
    for (const event of events) expect(() => eventMessage.parse(event)).not.toThrow();
  });
});

describe('outdoor hold (A10)', () => {
  // The example config: the fan from 28 °C, the window too from 31 °C.
  const RAIN: WeatherReason = { kind: 'weather', cause: 'rain', value: 1.2, limit: 0.1 };
  const hold = (requestId: string, minutes = 30): CommandMessage => ({
    v: 1,
    requestId,
    source: 'automation',
    action: 'outdoorHold',
    on: true,
    minutes,
    reason: RAIN,
  });
  const release = (requestId: string): CommandMessage => ({
    v: 1,
    requestId,
    source: 'automation',
    action: 'outdoorHold',
    on: false,
  });
  const ventSwitched = (events: EventMessage[]) =>
    events.filter((e) => e.type === 'automation.switched' && e.target === 'vent');

  function greenhouse(tempC = 24) {
    const sim = new GreenhouseSim(QUIET, NIGHT);
    sim.applyConfig(configExample, NIGHT);
    sim.setAirTemperature(tempC, NIGHT);
    return sim;
  }

  it('closes an open window and says why, then ventilates with the fan only', () => {
    const sim = greenhouse(32);
    expect(sim.telemetry(NIGHT).actuators).toMatchObject({ fan: true, vent: 1 });
    const { ack, events } = sim.command(hold('h1'), NIGHT + SECOND);
    expect(ack.result).toBe('ok');
    expect(ventSwitched(events)).toEqual([
      expect.objectContaining({ value: 0, reason: RAIN, source: 'automation' }),
    ]);
    const telemetry = sim.telemetry(NIGHT + SECOND);
    expect(telemetry.actuators).toMatchObject({ fan: true, vent: 0 });
    expect(telemetry.outdoorHold).toEqual({
      cause: 'rain',
      until: Math.floor((NIGHT + SECOND + 30 * MINUTE) / 1000),
    });
    expect(() => telemetryMessage.parse(telemetry)).not.toThrow();
  });

  it('keeps the rules from opening the window while it lasts', () => {
    const sim = greenhouse(24);
    sim.command(hold('h2'), NIGHT);
    const events = sim.setAirTemperature(32, NIGHT + MINUTE);
    expect(ventSwitched(events)).toEqual([]);
    expect(sim.telemetry(NIGHT + MINUTE).actuators).toMatchObject({ fan: true, vent: 0 });
  });

  it('gives way to heat protection, and closes again once the heat has passed', () => {
    const sim = greenhouse(24);
    sim.command(hold('h3'), NIGHT);
    sim.setAirTemperature(36, NIGHT + MINUTE);
    expect(sim.telemetry(NIGHT + MINUTE).actuators.vent).toBe(1);
    // Accepted while hot, and the window stays open.
    const renewed = sim.command(hold('h4'), NIGHT + 2 * MINUTE);
    expect(renewed.ack.result).toBe('ok');
    expect(sim.telemetry(NIGHT + 2 * MINUTE).actuators.vent).toBe(1);
    const cooled = sim.setAirTemperature(31, NIGHT + 3 * MINUTE);
    expect(types(cooled)).toContain('safety.cleared');
    expect(ventSwitched(cooled)).toEqual([expect.objectContaining({ value: 0, reason: RAIN })]);
  });

  it('lets a window opened by hand stay open until the hold ends', () => {
    const sim = greenhouse(24);
    sim.command(hold('h5'), NIGHT);
    sim.command({ v: 1, requestId: 'u1', source: 'user', action: 'vent', open: 1 }, NIGHT + MINUTE);
    run(sim, NIGHT + MINUTE, 5 * MINUTE);
    sim.command(hold('h6'), NIGHT + 6 * MINUTE);
    expect(sim.telemetry(NIGHT + 6 * MINUTE).actuators.vent).toBe(1);
    expect(sim.snapshot(NIGHT + 6 * MINUTE).outdoorHold?.openedByHand).toBe(true);
  });

  it('opens the window again when the weather clears, if it is still warm', () => {
    const sim = greenhouse(24);
    sim.command(hold('h7'), NIGHT);
    sim.setAirTemperature(32, NIGHT + MINUTE);
    const { events } = sim.command(release('h8'), NIGHT + 2 * MINUTE);
    const [opened] = ventSwitched(events);
    expect(ventSwitched(events)).toHaveLength(1);
    expect(opened).toMatchObject({ value: 1, reason: { kind: 'temperature' } });
    expect(sim.telemetry(NIGHT + 2 * MINUTE).outdoorHold).toBeNull();
  });

  it('lapses on its own if the hub stops renewing it', () => {
    const sim = greenhouse(24);
    sim.command(hold('h9', 5), NIGHT);
    sim.setAirTemperature(32, NIGHT + MINUTE);
    // Closed at night it cools fast: still warm when the hold lapses.
    sim.setAirTemperature(32, NIGHT + 4 * MINUTE);
    const events = run(sim, NIGHT + 4 * MINUTE, 2 * MINUTE);
    expect(ventSwitched(events)).toEqual([expect.objectContaining({ value: 1 })]);
    expect(sim.telemetry(NIGHT + 6 * MINUTE).outdoorHold).toBeNull();
  });

  it('every event it causes matches the contract', () => {
    const sim = greenhouse(32);
    const events = [
      ...sim.command(hold('h10'), NIGHT + SECOND).events,
      ...sim.command(release('h11'), NIGHT + MINUTE).events,
    ];
    for (const event of events) expect(() => eventMessage.parse(event)).not.toThrow();
  });
});

describe('restart (D100)', () => {
  const startedBy = (events: EventMessage[]) =>
    events.filter((e) => e.type === 'watering.started').length;

  it('carries on from what it kept: the soil dried while it was off, the tank as it was', () => {
    const before = new GreenhouseSim(QUIET, NOON);
    before.setSoilMoisture('basil_01', 0.6);
    before.setTankLevel(0.5);
    const memory = simMemory.parse(JSON.parse(JSON.stringify(before.memory(NOON))));

    const after = new GreenhouseSim(QUIET, NOON + 3 * HOUR);
    after.restore(memory, NOON + 3 * HOUR);
    const basil = after.snapshot(NOON + 3 * HOUR).moisture['basil_01'] ?? 0;
    expect(basil).toBeLessThan(0.6);
    expect(basil).toBeGreaterThan(0.4);
    expect(after.snapshot(NOON + 3 * HOUR).tankLevel).toBe(0.5);
  });

  it('never adds automatic waterings: the day count and the pump hour are kept', () => {
    const before = new GreenhouseSim(QUIET, NOON);
    before.applyConfig(configExample, NOON);
    let watered = 0;
    for (let i = 0; i < 4; i++) {
      before.setSoilMoisture('basil_01', 0.2);
      watered += startedBy(run(before, NOON + i * 70 * MINUTE, 70 * MINUTE, 10 * SECOND));
    }
    // configExample: basil at most twice a day.
    expect(watered).toBe(2);
    const at = NOON + 5 * HOUR;
    const memory = before.memory(at);

    const after = new GreenhouseSim(QUIET, at);
    after.applyConfig(configExample, at);
    after.restore(memory, at);
    after.setSoilMoisture('basil_01', 0.2);
    expect(startedBy(run(after, at, 2 * HOUR, 10 * SECOND))).toBe(0);
  });
});

describe('automation events (A12)', () => {
  it('a config applied again does not switch what is already so, nor say it did', () => {
    const sim = new GreenhouseSim(QUIET, NIGHT);
    const first = sim.applyConfig(configExample, NIGHT);
    const later = run(sim, NIGHT, 2 * MINUTE, 10 * SECOND);
    // At night the light is off already: nothing to switch, nothing to say.
    expect([...first, ...later].filter((e) => e.type === 'automation.switched')).toEqual([]);
    const again = sim.applyConfig({ ...configExample, rev: 4 }, NIGHT + 3 * MINUTE);
    const after = run(sim, NIGHT + 3 * MINUTE, 2 * MINUTE, 10 * SECOND);
    expect([...again, ...after].filter((e) => e.type === 'automation.switched')).toEqual([]);
  });
});
