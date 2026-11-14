import { weatherMessage, weatherNow } from '@vitreo/shared';
import type { WeatherMessage } from '@vitreo/shared';
import { describe, expect, it } from 'vitest';

import { DemoOutside, localMidnight, simulatedSky } from './outside.ts';

const ZONE = 'Europe/Madrid';
const MINUTE = 60_000;
/** A Friday afternoon in late October, 14:20 in Madrid. */
const ARRIVAL = Date.parse('2026-10-23T12:20:00Z');

/** What the demo's hub would publish now (as WeatherService.message does). */
function message(outside: DemoOutside, at: number): WeatherMessage {
  const { observation, forecast } = simulatedSky(outside, at);
  const nowS = Math.floor(at / 1000);
  const point = forecast.points.find((p) => p.hour <= nowS && nowS < p.hour + 3600) ?? null;
  return weatherMessage.parse({
    v: 1,
    ts: nowS,
    source: 'simulated',
    observation,
    forecast: point && {
      municipality: forecast.municipality,
      issuedAt: forecast.issuedAt,
      ...point,
    },
    tonight: null,
  });
}

describe("the demo's sky (D111)", () => {
  it('rains when the visitor arrives, so the window rule closes it at once', () => {
    const outside = new DemoOutside(ARRIVAL, ZONE);
    const now = weatherNow(message(outside, ARRIVAL), Math.floor(ARRIVAL / 1000));
    expect(now).toMatchObject({ wet: true, rainFrom: 'gauge' });
    expect(now?.clouds).toBeGreaterThanOrEqual(0.6);
    // Never attributed to AEMET.
    expect(simulatedSky(outside, ARRIVAL).observation.station.name).toBe('Simulado');
  });

  it('clears after the shower, an hour later', () => {
    const outside = new DemoOutside(ARRIVAL, ZONE);
    const later = ARRIVAL + 2 * 60 * MINUTE;
    expect(weatherNow(message(outside, later), Math.floor(later / 1000))?.wet).toBe(false);
  });

  it('"Lluvia" makes it rain from now, on a dry arrival', () => {
    const outside = new DemoOutside(ARRIVAL, ZONE, { shower: false });
    expect(weatherNow(message(outside, ARRIVAL), Math.floor(ARRIVAL / 1000))?.wet).toBe(false);
    outside.rain(ARRIVAL);
    // At once: this hour's forecast says rain (and the gauge soon after).
    expect(weatherNow(message(outside, ARRIVAL), Math.floor(ARRIVAL / 1000))?.wet).toBe(true);
    expect(message(outside, ARRIVAL).forecast?.sky).toMatch(/^[24]\d$/);
    const soon = ARRIVAL + 5 * MINUTE;
    expect(weatherNow(message(outside, soon), Math.floor(soon / 1000))?.rainFrom).toBe('gauge');
  });

  it('has fog at dawn and a front over the next days, as the week outside', () => {
    const outside = new DemoOutside(ARRIVAL, ZONE, { shower: false });
    const midnight = localMidnight(ARRIVAL, ZONE);
    // The arrival day is the week's last: mist at 07:00.
    const mist = midnight + 7 * 60 * MINUTE;
    expect(weatherNow(message(outside, mist), Math.floor(mist / 1000))?.fog).toBeGreaterThan(0);
    // Four days on, the front's wet morning (the week's fourth day, 10:00).
    const front = midnight + (4 * 24 + 10) * 60 * MINUTE;
    expect(weatherNow(message(outside, front), Math.floor(front / 1000))?.wet).toBe(true);
    // Six days on, the thick fog at 06:00.
    const fog = midnight + (6 * 24 + 6) * 60 * MINUTE;
    expect(message(outside, fog).forecast?.sky).toBe('81');
  });

  it('finds the local midnight in Madrid, summer time or winter', () => {
    expect(new Date(localMidnight(ARRIVAL, ZONE)).toISOString()).toBe('2026-10-22T22:00:00.000Z');
    const winter = Date.parse('2026-11-02T10:00:00Z');
    expect(new Date(localMidnight(winter, ZONE)).toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });
});
