import { localTime, minutesOf, parsePosixTz, serializeMessage, withinWindow } from '@vitreo/shared';
import type { ConfigMessage, EventMessage, TelemetryMessage } from '@vitreo/shared';

import type { AutomationOptions } from './automation.ts';
import { DeviceCore } from './device.ts';
import type { DeviceLink } from './device.ts';
import { dailyCurve, MADRID_LATE_OCTOBER } from './outside.ts';
import type { OutsideCurve } from './outside.ts';
import { DEFAULT_PARAMS } from './params.ts';
import type { SimParams } from './params.ts';

/**
 * The accelerated week (D104): the simulated device, safety limits and
 * automation exactly as the daily simulator runs them, driven by a virtual
 * clock instead of the wall clock, so seven days take seconds. Same seed,
 * same week: its summary is a test (week.test.ts), and its record is the
 * week report's data and the public demo's pre-recorded week.
 */

export interface WeekOptions {
  /** ms; a local midnight keeps the days whole. */
  startMs: number;
  days: number;
  /** The noise of the sensors. */
  seed: number;
  config: ConfigMessage;
  outside: OutsideCurve;
  params?: SimParams;
  /** The automation's options, only to compare against a week without one rule. */
  rules?: AutomationOptions;
}

export interface WeekRecord {
  startMs: number;
  endMs: number;
  telemetry: TelemetryMessage[];
  events: EventMessage[];
}

/** The device's loop runs once a second, as on the ESP32 and in the simulator. */
const TICK_MS = 1000;

export function runWeek(options: WeekOptions): WeekRecord {
  let now = options.startMs;
  const telemetry: TelemetryMessage[] = [];
  const events: EventMessage[] = [];
  const link: DeviceLink = {
    connected: true,
    publish(channel, message) {
      if (channel === 'telemetry') telemetry.push(message as TelemetryMessage);
      else if (channel === 'event') events.push(message as EventMessage);
    },
  };
  const device = new DeviceCore(options.params ?? DEFAULT_PARAMS, link, () => now, {
    seed: options.seed,
    outside: options.outside,
    ...(options.rules && { rules: options.rules }),
  });
  device.handleConfig(serializeMessage('config', options.config));
  device.linked();
  const endMs = options.startMs + options.days * 86_400_000;
  while (now < endMs) {
    now += TICK_MS;
    device.tick();
  }
  return { startMs: options.startMs, endMs, telemetry, events };
}

/**
 * The week run's rules (rev 3, 2026-10-14): every pot watered on its own,
 * ventilation and the grow light on, quiet nights 22:00–08:00. Its
 * location is Madrid centre (the repository's generic one, D79).
 */
export function weekRunConfig(startMs: number): ConfigMessage {
  const quiet = { from: '22:00', to: '08:00' };
  const rule = (zone: string, threshold: number, seconds: number, maxPerDay: number) => ({
    zone,
    enabled: true,
    threshold,
    seconds,
    maxPerDay,
    cooldownMinutes: 60,
    quiet,
  });
  return {
    v: 2,
    rev: 3,
    ts: Math.floor(startMs / 1000),
    tz: 'CET-1CEST,M3.5.0,M10.5.0/3',
    location: { lat: 40.42, lng: -3.7 },
    watering: [
      rule('basil_01', 0.4, 5, 2),
      rule('parsley_01', 0.4, 5, 2),
      rule('lettuce_01', 0.45, 6, 3),
      rule('strawberry_01', 0.35, 5, 2),
      rule('chives_01', 0.4, 4, 2),
      rule('tomato_01', 0.4, 8, 3),
    ],
    light: { enabled: true, mode: 'schedule', on: '07:00', off: '21:00', belowLux: 3000 },
    ventilation: { enabled: true, fanAbove: 28, windowAbove: 31, hysteresis: 2, maxRh: 85 },
  };
}

/**
 * The week of D104: Monday 19 to Monday 26 October 2026 in Madrid (it
 * crosses the change to winter time on the 25th), seed 2026, the week
 * run's rules and seven plausible late-October days outside.
 */
export const ACCELERATED_WEEK_START = Date.parse('2026-10-18T22:00:00Z');

export function acceleratedWeek(rules?: AutomationOptions): WeekRecord {
  return runWeek({
    startMs: ACCELERATED_WEEK_START,
    days: 7,
    seed: 2026,
    config: weekRunConfig(ACCELERATED_WEEK_START),
    outside: dailyCurve(ACCELERATED_WEEK_START, MADRID_LATE_OCTOBER),
    ...(rules && { rules }),
  });
}

export interface PlantSummary {
  zone: string;
  threshold: number;
  /** Hours with the soil reading below the plant's threshold. */
  hoursBelow: number;
  /** Of those, the hours inside the plant's quiet hours (overnight). */
  hoursBelowQuiet: number;
  minMoisture: number;
  lastMoisture: number | null;
  /** `evening`: of the automatic ones, those just before the quiet hours (D106). */
  waterings: { automatic: number; evening: number; byHand: number; seconds: number };
  /** Automatic waterings per local day, in order. */
  perDay: number[];
  /** Automatic waterings that started inside the plant's quiet hours (should be 0). */
  inQuietHours: number;
}

export interface WeekSummary {
  days: number;
  readings: number;
  plants: PlantSummary[];
  air: { minC: number; maxC: number; maxRh: number };
  tank: { first: number | null; last: number | null; emptyEvents: number };
  hours: { fan: number; window: number; light: number };
  switches: { fan: number; vent: number; growLight: number };
  safety: Record<string, number>;
  config: { applied: number; rejected: number };
}

const round = (value: number, decimals = 1) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** What the week was like, from what the device sent (as the hub would see it). */
export function summarizeWeek(record: WeekRecord, config: ConfigMessage): WeekSummary {
  const tz = parsePosixTz(config.tz);
  if (!tz) throw new Error(`unreadable time zone: ${config.tz}`);
  const { telemetry, events } = record;
  const dayOf = (ts: number) => localTime(tz, ts).day;
  const days = [...new Set(telemetry.map((t) => dayOf(t.ts)))];

  // Time-weighted: each reading holds until the next one.
  const spans = telemetry.map((reading, i) => ({
    reading,
    hours: ((telemetry[i + 1]?.ts ?? record.endMs / 1000) - reading.ts) / 3600,
  }));
  const hoursWhere = (test: (t: TelemetryMessage) => boolean) =>
    round(spans.reduce((total, { reading, hours }) => total + (test(reading) ? hours : 0), 0));

  const plants = config.watering.map((rule): PlantSummary => {
    const soil = (t: TelemetryMessage) => t.soil.find((s) => s.id === rule.zone)?.moisture ?? null;
    const readings = telemetry.map(soil).filter((m): m is number => m !== null);
    const started = events.filter(
      (e): e is Extract<EventMessage, { type: 'watering.started' }> =>
        e.type === 'watering.started' && e.zone === rule.zone,
    );
    const finished = events.filter(
      (e): e is Extract<EventMessage, { type: 'watering.finished' }> =>
        e.type === 'watering.finished' && e.zone === rule.zone,
    );
    const automatic = started.filter((e) => e.source === 'automation');
    const quiet = rule.quiet;
    const inQuiet = (ts: number) =>
      quiet !== null &&
      withinWindow(localTime(tz, ts).minutes, minutesOf(quiet.from), minutesOf(quiet.to));
    return {
      zone: rule.zone,
      threshold: rule.threshold,
      hoursBelow: hoursWhere((t) => {
        const m = soil(t);
        return m !== null && m < rule.threshold;
      }),
      hoursBelowQuiet: hoursWhere((t) => {
        const m = soil(t);
        return m !== null && m < rule.threshold && inQuiet(t.ts);
      }),
      minMoisture: round(Math.min(...readings), 2),
      lastMoisture: readings.at(-1) ?? null,
      waterings: {
        automatic: automatic.length,
        evening: automatic.filter((e) => e.reason?.kind === 'soil' && e.reason.evening === true)
          .length,
        byHand: started.length - automatic.length,
        seconds: round(finished.reduce((total, e) => total + e.seconds, 0)),
      },
      perDay: days.map((day) => automatic.filter((e) => dayOf(e.ts) === day).length),
      inQuietHours: automatic.filter((e) => inQuiet(e.ts)).length,
    };
  });

  const temps = telemetry.map((t) => t.air.temp).filter((v): v is number => v !== null);
  const rhs = telemetry.map((t) => t.air.rh).filter((v): v is number => v !== null);
  const tanks = telemetry.map((t) => t.tank.level);
  const count = (list: string[]) =>
    list.reduce<Record<string, number>>((all, key) => ({ ...all, [key]: (all[key] ?? 0) + 1 }), {});
  const switched = events.filter(
    (e): e is Extract<EventMessage, { type: 'automation.switched' }> =>
      e.type === 'automation.switched',
  );

  return {
    days: days.length,
    readings: telemetry.length,
    plants,
    air: { minC: Math.min(...temps), maxC: Math.max(...temps), maxRh: Math.max(...rhs) },
    tank: {
      first: tanks[0] ?? null,
      last: tanks.at(-1) ?? null,
      emptyEvents: events.filter((e) => e.type === 'safety.triggered' && e.limit === 'tank_empty')
        .length,
    },
    hours: {
      fan: hoursWhere((t) => t.actuators.fan),
      window: hoursWhere((t) => t.actuators.vent > 0),
      light: hoursWhere((t) => t.actuators.growLight),
    },
    switches: {
      fan: switched.filter((e) => e.target === 'fan').length,
      vent: switched.filter((e) => e.target === 'vent').length,
      growLight: switched.filter((e) => e.target === 'growLight').length,
    },
    safety: count(events.flatMap((e) => (e.type === 'safety.triggered' ? [e.limit] : []))),
    config: {
      applied: events.filter((e) => e.type === 'config.applied').length,
      rejected: events.filter((e) => e.type === 'config.rejected').length,
    },
  };
}
