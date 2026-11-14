import { localTime, minutesOf, parsePosixTz, eventMessage, telemetryMessage } from '@vitreo/shared';
import type { EventMessage } from '@vitreo/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { EVENING_LEAD_MIN, EVENING_MARGIN, HUMID_FAN_MIN_C } from './automation.ts';
import { SAFETY } from './safety.ts';
import { ACCELERATED_WEEK_START, acceleratedWeek, summarizeWeek, weekRunConfig } from './week.ts';
import type { WeekRecord, WeekSummary } from './week.ts';

/**
 * The accelerated week (D104): seven days of the week run's rules, seed
 * 2026, in seconds. The rules and the safety limits must hold on every
 * watering, and the week must come out the same as when it was recorded:
 * a change to the model or the automation shows up here, on purpose or not.
 * After a deliberate change, look at the new numbers and update the snapshot
 * (`vitest -u`), saying why in the commit.
 */
const config = weekRunConfig(ACCELERATED_WEEK_START);
let week: WeekRecord;
let summary: WeekSummary;
/** The same week without the evening watering (D106), to compare against. */
let withoutEvening: WeekSummary;

beforeAll(() => {
  week = acceleratedWeek();
  summary = summarizeWeek(week, config);
  withoutEvening = summarizeWeek(acceleratedWeek({ eveningWatering: false }), config);
}, 120_000);

type Started = Extract<EventMessage, { type: 'watering.started' }>;
const started = () => week.events.filter((e): e is Started => e.type === 'watering.started');

describe('the accelerated week', () => {
  it('covers seven whole days with readings', () => {
    expect(summary.days).toBe(7);
    // Every 30 s at least (more on change and while watering).
    expect(summary.readings).toBeGreaterThan(7 * 2880);
  });

  it('sends only messages of the MQTT contract', () => {
    for (const reading of week.telemetry) telemetryMessage.parse(reading);
    for (const event of week.events) eventMessage.parse(event);
  });

  it('waters every pot on its own, and never in its quiet hours', () => {
    for (const plant of summary.plants) {
      expect(plant.waterings.automatic, plant.zone).toBeGreaterThan(0);
      expect(plant.inQuietHours, plant.zone).toBe(0);
    }
  });

  it('keeps each pot under its daily maximum and its cooldown', () => {
    for (const rule of config.watering) {
      const plant = summary.plants.find((p) => p.zone === rule.zone);
      expect(Math.max(...(plant?.perDay ?? [Infinity])), rule.zone).toBeLessThanOrEqual(
        rule.maxPerDay,
      );
      const times = started()
        .filter((e) => e.zone === rule.zone && e.source === 'automation')
        .map((e) => e.ts);
      for (let i = 1; i < times.length; i++) {
        expect((times[i] ?? 0) - (times[i - 1] ?? 0), rule.zone).toBeGreaterThanOrEqual(
          rule.cooldownMinutes * 60,
        );
      }
    }
  });

  it('runs one watering at a time, each for its rule and within the safety limit', () => {
    let running: string | null = null;
    for (const event of week.events) {
      if (event.type === 'watering.started') {
        expect(running).toBeNull();
        running = event.zone;
        const rule = config.watering.find((r) => r.zone === event.zone);
        expect(event.seconds).toBe(Math.min(rule?.seconds ?? 0, SAFETY.pumpMaxSecondsPerCommand));
      } else if (event.type === 'watering.finished') {
        expect(event.zone).toBe(running);
        running = null;
      }
    }
  });

  it('switches the grow light a handful of times a day at most (D105)', () => {
    const perDay = new Map<string, number>();
    for (const event of week.events) {
      if (event.type !== 'automation.switched' || event.target !== 'growLight') continue;
      const day = new Date(event.ts * 1000).toISOString().slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(6);
  });

  it('never runs the fan for humidity in cold air (D105)', () => {
    for (const event of week.events) {
      if (event.type === 'automation.switched' && event.target === 'fan' && event.value === true) {
        // Its reason is the humidity; the air at that moment, the closest reading.
        const reading = week.telemetry.find((t) => t.ts >= event.ts);
        expect(
          reading?.air.temp ?? Infinity,
          new Date(event.ts * 1000).toISOString(),
        ).toBeGreaterThanOrEqual(HUMID_FAN_MIN_C - 0.2);
      }
    }
    // Below the stopping point (less the sensors' noise) the fan is never on:
    // nothing else turns it on in cold air (only heat, from fanAbove).
    for (const reading of week.telemetry) {
      if (reading.air.temp !== null && reading.air.temp < HUMID_FAN_MIN_C - 1.2) {
        expect(reading.actuators.fan, new Date(reading.ts * 1000).toISOString()).toBe(false);
      }
    }
  });

  it('waters in the evening the pots that would cross overnight (D106)', () => {
    const overnight = (s: WeekSummary, zone: string) =>
      s.plants.find((p) => p.zone === zone)?.hoursBelowQuiet ?? Infinity;
    // Less time below the threshold overnight for every pot that spent any
    // there; the others stay at none.
    for (const { zone } of config.watering) {
      const before = overnight(withoutEvening, zone);
      if (before > 0) expect(overnight(summary, zone), zone).toBeLessThan(before);
      else expect(overnight(summary, zone), zone).toBe(0);
    }
    expect(overnight(withoutEvening, 'basil_01')).toBeGreaterThan(overnight(summary, 'basil_01'));

    // Each one in the half hour before its quiet hours, close above the
    // threshold, and saying so; the daily maximum, the cooldown and one pot
    // at a time are checked above for every watering.
    const tz = parsePosixTz(config.tz);
    const evening = started().filter((e) => e.reason?.kind === 'soil' && e.reason.evening);
    expect(evening.length).toBeGreaterThan(0);
    for (const event of evening) {
      const rule = config.watering.find((r) => r.zone === event.zone);
      const quietFrom = minutesOf(rule?.quiet?.from ?? '00:00');
      const minutes = tz ? localTime(tz, event.ts).minutes : -1;
      expect(minutes, event.zone).toBeGreaterThanOrEqual(quietFrom - EVENING_LEAD_MIN);
      expect(minutes, event.zone).toBeLessThan(quietFrom);
      expect(event.reason).toMatchObject({ kind: 'soil', evening: true });
      if (event.reason?.kind === 'soil' && rule) {
        expect(event.reason.moisture).toBeGreaterThanOrEqual(rule.threshold);
        expect(event.reason.moisture).toBeLessThan(rule.threshold + EVENING_MARGIN);
      }
    }
  });

  it('comes out the same week as when it was recorded', () => {
    expect(summary).toMatchSnapshot();
    const types = week.events.reduce<Record<string, number>>(
      (all, e) => ({ ...all, [e.type]: (all[e.type] ?? 0) + 1 }),
      {},
    );
    expect(types).toMatchSnapshot();
  });
});
