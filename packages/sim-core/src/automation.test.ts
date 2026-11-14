import { eventMessage } from '@vitreo/shared';
import type { ConfigMessage, EventMessage } from '@vitreo/shared';
import { configExample, configV1Example } from '@vitreo/shared/fixtures';
import { describe, expect, it } from 'vitest';

import { Automation, HUMID_FAN_MIN_C, LIGHT_MIN_SWITCH_S } from './automation.ts';
import type { Decision, Readings } from './automation.ts';
import { GreenhouseSim } from './greenhouse.ts';
import { DEFAULT_PARAMS } from './params.ts';
import type { SimParams } from './params.ts';

/** The basic rules of `config`, run by the simulated firmware (A6, D89). */

const QUIET: SimParams = {
  ...DEFAULT_PARAMS,
  noise: { tempC: 0, rh: 0, lux: 0, moisture: 0 },
};
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// 14:00 local (Madrid, CEST) on an autumn day.
const AFTERNOON = Date.parse('2026-09-30T12:00:00Z');

const allOff = (): ConfigMessage => ({
  ...(configExample as unknown as ConfigMessage),
  rev: 1,
  watering: DEFAULT_PARAMS.zones.map(({ id }) => ({
    zone: id,
    enabled: false,
    threshold: 0.35,
    seconds: 5,
    maxPerDay: 2,
    cooldownMinutes: 60,
    quiet: null,
  })),
  light: { enabled: false, mode: 'schedule', on: '07:00', off: '21:00', belowLux: null },
  ventilation: { enabled: false, fanAbove: 28, windowAbove: 31, hysteresis: 2, maxRh: 95 },
});

function withBasil(rule: Partial<ConfigMessage['watering'][number]>, rev = 2): ConfigMessage {
  const config = allOff();
  return {
    ...config,
    rev,
    watering: config.watering.map((r) =>
      r.zone === 'basil_01' ? { ...r, enabled: true, ...rule } : r,
    ),
  };
}

function run(sim: GreenhouseSim, fromMs: number, durationMs: number, stepMs = MINUTE) {
  const events: EventMessage[] = [];
  for (let t = fromMs + stepMs; t <= fromMs + durationMs; t += stepMs) events.push(...sim.tick(t));
  return events;
}

const started = (events: EventMessage[]) =>
  events.filter((e) => e.type === 'watering.started' && e.zone === 'basil_01');

describe('config in the simulated firmware', () => {
  it('applies a valid v2 config and says which revision', () => {
    const sim = new GreenhouseSim(QUIET, AFTERNOON);
    const events = sim.applyConfig(allOff(), AFTERNOON);
    expect(events).toContainEqual(expect.objectContaining({ type: 'config.applied', rev: 1 }));
    expect(sim.configRev).toBe(1);
    for (const event of events) expect(eventMessage.safeParse(event).success).toBe(true);
  });

  it('refuses a v1 config with a clear event and keeps the one it had', () => {
    const sim = new GreenhouseSim(QUIET, AFTERNOON);
    sim.applyConfig(allOff(), AFTERNOON);
    const events = sim.applyConfig({ ...configV1Example, rev: 9 }, AFTERNOON);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'config.rejected',
        reason: 'unsupported_version',
        version: 1,
        rev: 9,
        keeps: 1,
      }),
    );
    expect(sim.configRev).toBe(1);
  });

  it('refuses an invalid config, and never acts on it', () => {
    const sim = new GreenhouseSim(QUIET, AFTERNOON);
    sim.setSoilMoisture('basil_01', 0.1);
    const bad = { ...withBasil({ threshold: 0.4 }), tz: 'not a zone' };
    const events = sim.applyConfig(bad, AFTERNOON);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'config.rejected', reason: 'invalid' }),
    );
    expect(started(run(sim, AFTERNOON, 5 * MINUTE))).toHaveLength(0);
  });
});

describe('watering by threshold', () => {
  it('waters a dry pot, saying why, and not again during the cooldown', () => {
    const sim = new GreenhouseSim(QUIET, AFTERNOON);
    sim.setSoilMoisture('basil_01', 0.3);
    const first = sim.applyConfig(withBasil({ threshold: 0.35, cooldownMinutes: 60 }), AFTERNOON);
    expect(started(first)).toEqual([
      expect.objectContaining({
        source: 'automation',
        seconds: 5,
        reason: { kind: 'soil', moisture: 0.3, threshold: 0.35 },
      }),
    ]);
    // Still under the threshold (the water has not soaked in yet): no second watering.
    sim.setSoilMoisture('basil_01', 0.3);
    expect(started(run(sim, AFTERNOON, 50 * MINUTE))).toHaveLength(0);
    sim.setSoilMoisture('basil_01', 0.3);
    expect(started(run(sim, AFTERNOON + 50 * MINUTE, 20 * MINUTE))).toHaveLength(1);
  });

  it('stops at the daily maximum, and counts again the next local day', () => {
    const sim = new GreenhouseSim(QUIET, AFTERNOON);
    sim.applyConfig(withBasil({ maxPerDay: 2, cooldownMinutes: 0 }), AFTERNOON);
    let count = 0;
    for (let t = AFTERNOON; t < AFTERNOON + 6 * HOUR; t += 10 * MINUTE) {
      sim.setSoilMoisture('basil_01', 0.2);
      count += started(sim.tick(t + MINUTE)).length;
    }
    expect(count).toBe(2);
    // 00:30 the next day, local time.
    const nextDay = Date.parse('2026-09-30T22:30:00Z');
    sim.setSoilMoisture('basil_01', 0.2);
    expect(started(sim.tick(nextDay)).length).toBeGreaterThan(0);
  });

  it('keeps its quiet hours, which cross midnight', () => {
    const night = Date.parse('2026-09-30T21:30:00Z'); // 23:30 local
    const sim = new GreenhouseSim(QUIET, night);
    sim.setSoilMoisture('basil_01', 0.2);
    sim.applyConfig(withBasil({ quiet: { from: '22:00', to: '08:00' } }), night);
    expect(started(run(sim, night, 2 * HOUR, 10 * MINUTE))).toHaveLength(0);
    const morning = Date.parse('2026-10-01T06:05:00Z'); // 08:05 local
    sim.setSoilMoisture('basil_01', 0.2);
    expect(started(sim.tick(morning))).toHaveLength(1);
  });

  it('never beats the safety limits: no watering with the tank empty', () => {
    const sim = new GreenhouseSim(QUIET, AFTERNOON);
    sim.setSoilMoisture('basil_01', 0.2);
    sim.setTankLevel(0.02);
    const events = sim.applyConfig(withBasil({}), AFTERNOON);
    expect(started(events)).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'safety.triggered', limit: 'tank_empty' }),
    );
    // Not retried every few seconds either.
    const later = run(sim, AFTERNOON, 5 * MINUTE, 10_000);
    expect(later.filter((e) => e.type === 'safety.triggered')).toHaveLength(0);
  });

  it('ignores a pot whose sensor gives no reading', () => {
    const sim = new GreenhouseSim(QUIET, AFTERNOON);
    sim.setSoilMoisture('basil_01', 0.1);
    sim.setScenario(
      { scenario: 'sensor_failure', active: true, target: { sensor: 'soil', zone: 'basil_01' } },
      AFTERNOON,
    );
    expect(started(sim.applyConfig(withBasil({}), AFTERNOON))).toHaveLength(0);
  });
});

describe('ventilation with hysteresis', () => {
  it('fan above fanAbove, window too above windowAbove, off below minus hysteresis', () => {
    const sim = new GreenhouseSim(QUIET, AFTERNOON);
    sim.setScenario({ scenario: 'heatwave', active: true }, AFTERNOON);
    const applied = sim.applyConfig(
      {
        ...allOff(),
        rev: 3,
        ventilation: { enabled: true, fanAbove: 24, windowAbove: 26, hysteresis: 2, maxRh: 99 },
      },
      AFTERNOON,
    );
    const events = [...applied, ...run(sim, AFTERNOON, 3 * HOUR)];
    const switches = events.filter((e) => e.type === 'automation.switched');
    const fanOn = switches.find((e) => e.target === 'fan');
    expect(fanOn).toMatchObject({ value: true, reason: { kind: 'temperature', limit: 24 } });
    const ventOpen = switches.find((e) => e.target === 'vent');
    expect(ventOpen).toMatchObject({ value: 1, reason: { kind: 'temperature', limit: 26 } });
    expect(sim.snapshot(AFTERNOON + 3 * HOUR).actuators).toMatchObject({ fan: true, vent: 1 });

    // Cooler: still on just under the limit, off only below limit − hysteresis.
    sim.setScenario({ scenario: 'heatwave', active: false }, AFTERNOON + 3 * HOUR);
    const cooling = run(sim, AFTERNOON + 3 * HOUR, 12 * HOUR, 10 * MINUTE);
    const fanOff = cooling.find(
      (e) => e.type === 'automation.switched' && e.target === 'fan' && e.value === false,
    );
    expect(fanOff).toMatchObject({ reason: { kind: 'temperature', limit: 22 } });
    if (fanOff?.type === 'automation.switched' && fanOff.reason.kind === 'temperature') {
      expect(fanOff.reason.value).toBeLessThan(22);
    }
  });

  it('a fan switched off by hand stays off until the next crossing', () => {
    // A mild afternoon, well under the 35 °C safety cut-off (which would force the fan).
    const sim = new GreenhouseSim(QUIET, AFTERNOON);
    const applied = sim.applyConfig(
      {
        ...allOff(),
        rev: 3,
        ventilation: { enabled: true, fanAbove: 10, windowAbove: 40, hysteresis: 2, maxRh: 99 },
      },
      AFTERNOON,
    );
    expect(applied).toContainEqual(
      expect.objectContaining({ type: 'automation.switched', target: 'fan', value: true }),
    );
    const at = AFTERNOON + 10 * MINUTE;
    const { ack } = sim.command(
      { v: 1, requestId: 'off1', source: 'user', action: 'fan', on: false },
      at,
    );
    expect(ack.result).toBe('ok');
    run(sim, at, 30 * MINUTE);
    expect(sim.snapshot(at + 30 * MINUTE).actuators.fan).toBe(false);
  });
});

describe('the grow light', () => {
  const schedule = (on: string, off: string, rev = 4): ConfigMessage => ({
    ...allOff(),
    rev,
    light: { enabled: true, mode: 'schedule', on, off, belowLux: null },
  });

  it('follows a schedule that crosses midnight, in local time', () => {
    const start = Date.parse('2026-09-30T19:00:00Z'); // 21:00 local
    const sim = new GreenhouseSim(QUIET, start);
    const events = [
      ...sim.applyConfig(schedule('22:00', '02:00'), start),
      ...run(sim, start, 7 * HOUR, 5 * MINUTE),
    ];
    const lights = events.filter(
      (e) => e.type === 'automation.switched' && e.target === 'growLight',
    );
    // Off already at 21:00: taking it over is not a switch (A12); on at 22:00, off at 02:00.
    expect(lights.map((e) => (e.type === 'automation.switched' ? e.value : null))).toEqual([
      true,
      false,
    ]);
    const on = lights[0];
    expect(on?.ts).toBe(Date.parse('2026-09-30T20:00:00Z') / 1000);
    expect(on).toMatchObject({
      reason: { kind: 'light', mode: 'schedule', from: '22:00', to: '02:00' },
    });
  });

  it('follows the sun where the greenhouse is, with offsets', () => {
    const start = Date.parse('2026-09-30T04:00:00Z'); // 06:00 local, before sunrise
    const sim = new GreenhouseSim(QUIET, start);
    const config: ConfigMessage = {
      ...allOff(),
      rev: 5,
      location: { lat: 40.42, lng: -3.7 },
      light: { enabled: true, mode: 'sun', sunriseOffset: 0, sunsetOffset: 120, belowLux: null },
    };
    const events = [...sim.applyConfig(config, start), ...run(sim, start, 20 * HOUR, 5 * MINUTE)];
    const on = events.find(
      (e) => e.type === 'automation.switched' && e.target === 'growLight' && e.value === true,
    );
    // Madrid, 30 Sep: sunrise ≈ 08:00 local, sunset ≈ 19:50 (+2 h → off ≈ 21:50).
    expect(on).toMatchObject({ reason: { kind: 'light', mode: 'sun' } });
    if (on?.type === 'automation.switched' && on.reason.kind === 'light') {
      expect(on.reason.from).toMatch(/^0[78]:\d\d$/);
      expect(on.reason.to).toMatch(/^2[12]:\d\d$/);
    }
  });

  it('waits while there is daylight enough (belowLux)', () => {
    const sim = new GreenhouseSim(QUIET, AFTERNOON);
    const config: ConfigMessage = {
      ...allOff(),
      rev: 6,
      light: { enabled: true, mode: 'schedule', on: '07:00', off: '21:00', belowLux: 100 },
    };
    const events = sim.applyConfig(config, AFTERNOON);
    // Daylight enough: it stays off, and nothing was switched (A12).
    expect(
      events.find((e) => e.type === 'automation.switched' && e.target === 'growLight'),
    ).toBeUndefined();
    expect(sim.snapshot(AFTERNOON).actuators.growLight).toBe(false);
  });
});

describe('frost protection (a firmware safety constant, D90)', () => {
  // A winter night in Madrid: 23:00 local.
  const NIGHT = Date.parse('2026-12-15T22:00:00Z');

  it('closes the window and stops the fan below 5 °C, over orders and rules, and says so', () => {
    const sim = new GreenhouseSim(QUIET, NIGHT);
    sim.command({ v: 1, requestId: 'open', source: 'user', action: 'vent', open: 1 }, NIGHT);
    sim.setScenario({ scenario: 'cold_snap', active: true }, NIGHT);
    // A ventilation rule that would want the fan on at any temperature.
    sim.applyConfig(
      {
        ...allOff(),
        rev: 7,
        ventilation: { enabled: true, fanAbove: 0, windowAbove: 0, hysteresis: 1, maxRh: 99 },
      },
      NIGHT,
    );
    const events = run(sim, NIGHT, 6 * HOUR, 5 * MINUTE);
    const frost = events.find((e) => e.type === 'safety.triggered' && e.limit === 'frost');
    expect(frost).toMatchObject({ source: 'safety', limit: 'frost' });
    if (frost?.type === 'safety.triggered') expect(frost.value).toBeLessThan(5);
    const later = NIGHT + 6 * HOUR;
    expect(sim.snapshot(later)).toMatchObject({ frost: true, actuators: { vent: 0, fan: false } });

    // Orders to open or ventilate are refused, saying why.
    const open = sim.command(
      { v: 1, requestId: 'o2', source: 'user', action: 'vent', open: 1 },
      later,
    );
    expect(open.ack).toMatchObject({ result: 'rejected', reason: 'safety_limit', limit: 'frost' });
    const fan = sim.command(
      { v: 1, requestId: 'f2', source: 'user', action: 'fan', on: true, minutes: 10 },
      later,
    );
    expect(fan.ack).toMatchObject({ result: 'rejected', limit: 'frost' });
    // Closing stays allowed: it is the safe direction.
    const close = sim.command(
      { v: 1, requestId: 'c2', source: 'user', action: 'vent', open: 0 },
      later,
    );
    expect(close.ack.result).toBe('ok');

    // Warmer again: released above 7 °C, and it says so.
    sim.setScenario({ scenario: 'cold_snap', active: false }, later);
    const thaw = run(sim, later, 16 * HOUR, 10 * MINUTE);
    expect(thaw).toContainEqual(
      expect.objectContaining({ type: 'safety.cleared', source: 'safety', limit: 'frost' }),
    );
    for (const event of [...events, ...thaw])
      expect(eventMessage.safeParse(event).success).toBe(true);
  });
});

describe('the grow light never flickers, and humidity never chills (D105)', () => {
  // 10:00 local (Madrid, CEST).
  const MORNING = Date.parse('2026-09-30T08:00:00Z') / 1000;
  const LAMP = 4000;
  const lightConfig = (): ConfigMessage => ({
    ...allOff(),
    rev: 7,
    light: { enabled: true, mode: 'schedule', on: '07:00', off: '21:00', belowLux: 3000 },
  });
  const fanConfig = (): ConfigMessage => ({
    ...allOff(),
    rev: 8,
    ventilation: { enabled: true, fanAbove: 28, windowAbove: 31, hysteresis: 2, maxRh: 85 },
  });
  const readings = (now: number, change: Partial<Readings> = {}): Readings => ({
    now,
    growLight: false,
    moisture: new Map(),
    temp: 18,
    rh: 60,
    lux: 1000,
    pumping: false,
    ...change,
  });
  const lights = (decisions: Decision[]) => decisions.filter((d) => d.kind === 'light');

  it('subtracts its own lamp from the light it reads', () => {
    const automation = new Automation();
    automation.apply(lightConfig());
    // Dark morning: on.
    expect(lights(automation.decide(readings(MORNING, { lux: 2000 })))).toMatchObject([
      { on: true },
    ]);
    // The sensor now reads the lamp too: still 2000 of daylight, so it stays on.
    expect(
      lights(automation.decide(readings(MORNING + 10, { lux: 2000 + LAMP, growLight: true }))),
    ).toEqual([]);
    // Twenty minutes later the day is bright enough (above 3000 × 1.5): off, saying the daylight.
    expect(
      lights(automation.decide(readings(MORNING + 1200, { lux: 4600 + LAMP, growLight: true }))),
    ).toMatchObject([{ on: false, reason: { lux: 4600 } }]);
  });

  it('switches at most once every 15 minutes, even if the measurement is off', () => {
    const automation = new Automation();
    automation.apply(lightConfig());
    automation.decide(readings(MORNING, { lux: 2000 }));
    // The lamp seems to add nothing (a bad measurement): the reading alone says "bright".
    let switches = 0;
    for (let t = 10; t < 15 * 60; t += 10) {
      const lux = t % 20 === 0 ? 5000 : 2000;
      switches += lights(automation.decide(readings(MORNING + t, { lux, growLight: true }))).length;
    }
    expect(switches).toBe(0);
    expect(
      lights(
        automation.decide(readings(MORNING + LIGHT_MIN_SWITCH_S, { lux: 5000, growLight: true })),
      ),
    ).toMatchObject([{ on: false }]);
  });

  it('switches off at the end of its window, however recently it came on', () => {
    const automation = new Automation();
    automation.apply(lightConfig());
    const evening = Date.parse('2026-09-30T18:55:00Z') / 1000; // 20:55 local
    expect(lights(automation.decide(readings(evening, { lux: 100 })))).toMatchObject([
      { on: true },
    ]);
    expect(
      lights(automation.decide(readings(evening + 300, { lux: 100 + LAMP, growLight: true }))),
    ).toMatchObject([{ on: false }]);
  });

  it('runs the fan for humidity only at 10 °C or more, and stops it below 9 °C', () => {
    const automation = new Automation();
    automation.apply(fanConfig());
    const fans = (r: Readings) => automation.decide(r).filter((d) => d.kind === 'fan');
    expect(fans(readings(MORNING, { temp: 8, rh: 95 }))).toEqual([]);
    expect(fans(readings(MORNING + 10, { temp: 12, rh: 95 }))).toMatchObject([
      { on: true, reason: { kind: 'humidity' } },
    ]);
    // Within the 1 °C below the limit: it keeps going.
    expect(fans(readings(MORNING + 20, { temp: 9.5, rh: 95 }))).toEqual([]);
    expect(fans(readings(MORNING + 30, { temp: 8.9, rh: 95 }))).toMatchObject([
      { on: false, reason: { kind: 'temperature', limit: HUMID_FAN_MIN_C - 1 } },
    ]);
  });
});

describe('evening watering (D106)', () => {
  // 19:00 local (Madrid, CEST); quiet hours from 22:00, so the evening is 21:30–22:00.
  const SEVEN_PM = Date.parse('2026-09-30T17:00:00Z') / 1000;
  const HALF_PAST_NINE = SEVEN_PM + 2.5 * 3600;
  const config = () => withBasil({ threshold: 0.4, quiet: { from: '22:00', to: '08:00' } });
  const readings = (now: number, moisture: number): Readings => ({
    now,
    growLight: false,
    moisture: new Map([['basil_01', moisture]]),
    temp: 16,
    rh: 60,
    lux: 0,
    pumping: false,
  });
  /** Basil read once a minute from 19:00 until `until`, drying `perHour` from `start`. */
  function evening(
    start: number,
    perHour: number,
    until = HALF_PAST_NINE,
    noise = 0,
    before: (automation: Automation) => void = () => undefined,
  ) {
    const automation = new Automation();
    automation.apply(config());
    before(automation);
    let decisions: Decision[] = [];
    for (let now = SEVEN_PM, i = 0; now <= until; now += 60, i++) {
      const moisture = start - (perHour * (now - SEVEN_PM)) / 3600 + (i % 2 ? noise : -noise);
      decisions = automation.decide(readings(now, moisture));
      if (decisions.length > 0) return { automation, decisions, at: now };
    }
    return { automation, decisions, at: null };
  }

  it('waters a pot just above its threshold that would cross overnight, and says so', () => {
    // 41 % at 21:30, losing 0.3 points an hour: under 40 % well before 08:00.
    const { decisions, at } = evening(0.4175, 0.003);
    expect(at).toBe(HALF_PAST_NINE);
    expect(decisions).toMatchObject([
      {
        kind: 'water',
        zone: 'basil_01',
        reason: { kind: 'soil', moisture: 0.41, threshold: 0.4, evening: true },
      },
    ]);
  });

  it('waits for the half hour before the quiet hours', () => {
    expect(evening(0.4175, 0.003, HALF_PAST_NINE - 60).at).toBeNull();
  });

  it('leaves a pot that will not cross: too far above, or not drying (noise is not drying)', () => {
    expect(evening(0.47, 0.003).at).toBeNull();
    expect(evening(0.41, 0, HALF_PAST_NINE, 0.003).at).toBeNull();
  });

  it('does not guess without an hour of readings', () => {
    const automation = new Automation();
    automation.apply(config());
    for (let now = HALF_PAST_NINE - 20 * 60; now < HALF_PAST_NINE + 20 * 60; now += 60) {
      expect(automation.decide(readings(now, 0.405))).toEqual([]);
    }
  });

  it('keeps the daily maximum and the cooldown', () => {
    // Watered twice this afternoon (its maximum), before the readings start.
    const twice = (automation: Automation) => {
      automation.decide(readings(SEVEN_PM - 5 * 3600, 0.6));
      automation.watered('basil_01', SEVEN_PM - 4 * 3600, true);
      automation.watered('basil_01', SEVEN_PM - 2 * 3600, true);
    };
    expect(evening(0.4175, 0.003, HALF_PAST_NINE + 600, 0, twice).at).toBeNull();
    // Watered at 21:00: within its 60 minutes.
    const recently = (automation: Automation) => {
      automation.watered('basil_01', HALF_PAST_NINE - 30 * 60, true);
    };
    expect(evening(0.4175, 0.003, HALF_PAST_NINE + 600, 0, recently).at).toBeNull();
  });

  it('can be left out, only to compare a week without it', () => {
    const automation = new Automation({ eveningWatering: false });
    automation.apply(config());
    for (let now = SEVEN_PM; now <= HALF_PAST_NINE + 600; now += 60) {
      expect(automation.decide(readings(now, 0.4175 - (0.003 * (now - SEVEN_PM)) / 3600))).toEqual(
        [],
      );
    }
  });
});
