import { describe, expect, it } from 'vitest';

import {
  localTime,
  minutesOf,
  parsePosixTz,
  sunTimes,
  timeOf,
  utcOffset,
  withinWindow,
} from './index.ts';

const MADRID = 'CET-1CEST,M3.5.0,M10.5.0/3';
const at = (iso: string) => Date.parse(iso) / 1000;

describe('POSIX time zones (as the ESP32 takes them)', () => {
  it('reads Madrid: winter UTC+1, summer UTC+2', () => {
    const tz = parsePosixTz(MADRID);
    expect(tz).not.toBeNull();
    if (!tz) return;
    expect(utcOffset(tz, at('2026-01-15T12:00:00Z'))).toBe(3600);
    expect(utcOffset(tz, at('2026-07-15T12:00:00Z'))).toBe(7200);
  });

  it('changes at the right instants (last Sunday of March and October)', () => {
    const tz = parsePosixTz(MADRID);
    if (!tz) throw new Error('unparsed');
    // 2026-03-29 01:00 UTC = 02:00 CET → 03:00 CEST.
    expect(utcOffset(tz, at('2026-03-29T00:59:59Z'))).toBe(3600);
    expect(utcOffset(tz, at('2026-03-29T01:00:00Z'))).toBe(7200);
    // 2026-10-25 01:00 UTC = 03:00 CEST → 02:00 CET.
    expect(utcOffset(tz, at('2026-10-25T00:59:59Z'))).toBe(7200);
    expect(utcOffset(tz, at('2026-10-25T01:00:00Z'))).toBe(3600);
  });

  it('gives local time of day and the local date', () => {
    const tz = parsePosixTz(MADRID);
    if (!tz) throw new Error('unparsed');
    expect(localTime(tz, at('2026-10-08T21:30:00Z'))).toEqual({
      minutes: 23 * 60 + 30,
      day: '2026-10-08',
    });
    expect(localTime(tz, at('2026-10-08T22:30:00Z')).day).toBe('2026-10-09');
  });

  it('reads zones without summer time, and refuses nonsense', () => {
    expect(parsePosixTz('UTC0')).toEqual({ std: 0, dst: null, start: null, end: null });
    expect(parsePosixTz('<-03>3')?.std).toBe(-3 * 3600);
    expect(parsePosixTz('')).toBeNull();
    expect(parsePosixTz('CET-1CEST,nonsense')).toBeNull();
  });
});

describe('time windows', () => {
  it('handle windows that cross midnight', () => {
    expect(withinWindow(minutesOf('23:00'), minutesOf('22:00'), minutesOf('08:00'))).toBe(true);
    expect(withinWindow(minutesOf('07:59'), minutesOf('22:00'), minutesOf('08:00'))).toBe(true);
    expect(withinWindow(minutesOf('08:00'), minutesOf('22:00'), minutesOf('08:00'))).toBe(false);
    expect(withinWindow(minutesOf('12:00'), minutesOf('07:00'), minutesOf('21:00'))).toBe(true);
    expect(withinWindow(600, 600, 600)).toBe(false);
    expect(timeOf(-30)).toBe('23:30');
    expect(timeOf(1500)).toBe('01:00');
  });
});

describe('sunrise and sunset', () => {
  // Reference: Madrid centre (40.42, -3.70); within two minutes of the
  // almanac (2026-06-21: 06:44 and 21:48 CEST; 2026-12-21: 08:33 and 17:51 CET).
  const close = (actual: number | undefined, iso: string) => {
    expect(Math.abs((actual ?? 0) - at(iso))).toBeLessThan(150);
  };

  it('match the almanac in Madrid, summer and winter', () => {
    const june = sunTimes(at('2026-06-21T12:00:00Z'), 40.42, -3.7);
    close(june?.sunrise, '2026-06-21T04:44:00Z');
    close(june?.sunset, '2026-06-21T19:48:00Z');
    const december = sunTimes(at('2026-12-21T12:00:00Z'), 40.42, -3.7);
    close(december?.sunrise, '2026-12-21T07:33:00Z');
    close(december?.sunset, '2026-12-21T16:51:00Z');
  });

  it('say so when the sun does not set (polar summer)', () => {
    expect(sunTimes(at('2026-06-21T12:00:00Z'), 78.2, 15.6)).toBeNull();
  });
});
