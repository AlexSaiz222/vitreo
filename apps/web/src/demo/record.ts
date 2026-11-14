import type { PortableHub, PortableHubOptions } from '@vitreo/hub/portable';
import type { SimMemory } from '@vitreo/sim-core';

import { DemoEngine } from './engine.ts';
import type { Delivery } from './engine.ts';
import { DemoOutside } from './outside.ts';
import { DEMO_DEVICE_ID, DEMO_LOCATION, DEMO_TIME_ZONE } from './setup.ts';
import type { RecordedWeek } from './week.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The demo's recorded past (D112; a month since D129): the accelerated week
 * of D104 (the same device, rules and seed, a second at a time) run for
 * thirty-one days, with what the demo adds, its hub (the hub's own code) and
 * its sky (D111), so the rewind shows the window held closed in the rain,
 * as the live demo does. From Monday 26 October 2026, after the change to
 * winter time (it holds until the end of March); the demo moves them so
 * that they end today. The last `rawDays` are kept reading by reading, the
 * rest as the hub's hourly summaries; the device's memory, for the last
 * `memoryHours`.
 */
export const DEMO_WEEK = {
  startMs: Date.parse('2026-10-25T23:00:00Z'),
  /** A day more than the longest range (30 days back from any hour of today). */
  days: 31,
  rawDays: 7,
  memoryHours: 48,
  seed: 2026,
  /**
   * Somebody tops the tank up once a week, at 11:00 of these days (from 0):
   * left alone it runs dry in about two weeks, and the device then refuses
   * every watering (D129). The last, four days before the end, as the
   * journal's example note says.
   */
  refills: { days: [6, 13, 20, 27], hour: 11, level: 0.85 },
} as const;

export type HubFactory = (
  options: Pick<PortableHubOptions, 'device' | 'timeZone' | 'seedLocation'> &
    ReturnType<DemoEngine['hubWiring']>,
) => PortableHub;

export async function recordDemoWeek(
  createHub: HubFactory,
  days: number = DEMO_WEEK.days,
): Promise<RecordedWeek> {
  const { startMs, seed } = DEMO_WEEK;
  const endMs = startMs + days * DAY_MS;
  // Whole local days: winter time all through, so days are 24 h.
  const rawFromMs = endMs - Math.min(days, DEMO_WEEK.rawDays) * DAY_MS;
  // Its last day is the arrival day, as in the demo; no shower: nobody arrives.
  const outside = new DemoOutside(endMs - 12 * HOUR_MS, DEMO_TIME_ZONE, { shower: false });
  const messages: Delivery[] = [];
  const memory: SimMemory[] = [];
  const engine = new DemoEngine({
    startMs,
    outside,
    seed,
    onMessage: () => undefined,
    onHubMessage: (message) => messages.push(message),
    log: () => undefined,
  });
  const hub = createHub({
    device: DEMO_DEVICE_ID,
    timeZone: DEMO_TIME_ZONE,
    seedLocation: { ...DEMO_LOCATION },
    ...engine.hubWiring(),
  });
  engine.attach(hub);
  const { refills } = DEMO_WEEK;
  const refillAt = new Set<number>(
    refills.days.map((day) => startMs + day * DAY_MS + refills.hour * HOUR_MS),
  );
  for (let hour = startMs; hour < endMs; hour += HOUR_MS) {
    engine.advanceTo(hour);
    if (refillAt.has(hour)) engine.refillTank(refills.level);
    if (hour >= endMs - DEMO_WEEK.memoryHours * HOUR_MS) memory.push(engine.memory());
    // What the hub left for later (after an await) happens before the next hour.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  engine.advanceTo(endMs);
  hub.summarise();
  return {
    startMs,
    endMs,
    rawFromMs,
    seed,
    timeZone: DEMO_TIME_ZONE,
    messages,
    summaries: hub.hourlySummaries(),
    memory,
  };
}
