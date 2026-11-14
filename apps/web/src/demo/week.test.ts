import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { localMidnight } from './outside.ts';
import { DEMO_WEEK } from './record.ts';
import {
  arrivalPast,
  decodeWeek,
  demoWeekFile,
  encodeWeek,
  shiftTimes,
  summariesOf,
} from './week.ts';

/**
 * The recorded past (D112; a month since D129), as it is versioned: it
 * reads back exactly as it was recorded, and moved so that it ends today it
 * keeps the time of day, and stops at the last hour before the visitor
 * arrives.
 */
const file = demoWeekFile.parse(
  JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../demo/week.json'), 'utf8')),
);
const ZONE = 'Europe/Madrid';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const hourMinute = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(
    ms,
  );

describe('the recorded past (D112, D129)', () => {
  it('is the demo month: thirty-one days of the demo greenhouse, from a Monday midnight', () => {
    expect(file.startMs).toBe(DEMO_WEEK.startMs);
    expect(file.endMs - file.startMs).toBe(DEMO_WEEK.days * DAY);
    expect(file.device).toBe('demo');
    // The last week reading by reading, the rest summarised by the hour.
    expect(file.endMs - file.rawFromMs).toBe(DEMO_WEEK.rawDays * DAY);
    expect(file.startMs / 1000 + (file.telemetry.dt[0] ?? 0)).toBeGreaterThanOrEqual(
      file.rawFromMs / 1000,
    );
    const summaries = summariesOf(file);
    expect(summaries.every((row) => row.hour % 3600 === 0)).toBe(true);
    // The hub's summaries of every hour, every pot included.
    const soilHours = new Set(summaries.filter((row) => row.metric === 'soil').map((r) => r.hour));
    expect(soilHours.size).toBe(DEMO_WEEK.days * 24);
    expect(file.memory).toHaveLength(DEMO_WEEK.memoryHours);
    // Rain held the window closed in it, by the hub's own rule.
    expect(file.messages.some(([, name]) => name.endsWith('/cmd'))).toBe(true);
    expect(file.telemetry.hold.some((hold) => hold?.[0] === 'rain')).toBe(true);
  });

  it('never runs the tank dry: somebody tops it up every week', () => {
    const refused = file.messages.filter(
      ([, , message]) =>
        typeof message === 'object' &&
        message !== null &&
        (message as { limit?: string }).limit === 'tank_empty',
    );
    expect(refused).toEqual([]);
    expect(Math.min(...file.telemetry.tank.map((level) => level ?? 1))).toBeGreaterThan(0.2);
  });

  it('reads back exactly as it was recorded', () => {
    const again = encodeWeek(
      { ...file, messages: decodeWeek(file), summaries: summariesOf(file) },
      file.about,
    );
    expect(again).toEqual(file);
  });

  it('moves every time a message holds, and nothing else', () => {
    expect(
      shiftTimes({ ts: 10, reason: { value: 2.5, limit: 1 }, outdoorHold: { until: 40 } }, 100),
    ).toEqual({ ts: 110, reason: { value: 2.5, limit: 1 }, outdoorHold: { until: 140 } });
    expect(shiftTimes({ v: 1, ts: 5, retryAt: 9, seconds: 3 }, 1)).toEqual({
      v: 1,
      ts: 6,
      retryAt: 10,
      seconds: 3,
    });
  });

  for (const [when, arrival] of [
    ['in summer time, before the recording', Date.parse('2026-10-23T14:20:00Z')],
    ['in winter, months later', Date.parse('2027-02-10T09:45:00Z')],
  ] as const) {
    it(`ends today, keeping the time of day (${when})`, () => {
      const past = arrivalPast(file, arrival);
      // Carries on from the last hour before the visitor arrives.
      expect(past.memory.savedAt).toBeLessThanOrEqual(arrival);
      expect(arrival - past.memory.savedAt).toBeLessThan(HOUR);
      expect(past.messages.every((m) => m.at <= past.memory.savedAt)).toBe(true);
      // It began a month before today's midnight, at midnight; the readings, six days before.
      expect(hourMinute(past.fromMs)).toBe('00:00');
      expect(hourMinute(past.rawFromMs)).toBe('00:00');
      const today = localMidnight(arrival, ZONE);
      expect(today - past.fromMs).toBeGreaterThan((DEMO_WEEK.days - 1) * DAY - 2 * HOUR);
      expect(today - past.rawFromMs).toBeGreaterThan((DEMO_WEEK.rawDays - 1) * DAY - 2 * HOUR);
      // Summaries of whole hours only, every one over before the device carries on.
      expect(past.summaries.length).toBeGreaterThan(0);
      expect(past.summaries.every((row) => row.hour % 3600 === 0)).toBe(true);
      expect(past.summaries.every((row) => (row.hour + 3600) * 1000 <= past.memory.savedAt)).toBe(
        true,
      );
      // The last week's hours are there already: its charts are full at once.
      expect(past.summaries.some((row) => row.hour * 1000 >= past.rawFromMs)).toBe(true);
      // A watering at the time of day it was recorded.
      const recorded = decodeWeek(file).find((m) => m.payload.includes('watering.started'));
      const moved = past.messages.find((m) => m.payload.includes('watering.started'));
      expect(recorded && moved && hourMinute(moved.at)).toBe(recorded && hourMinute(recorded.at));
    });
  }
});
