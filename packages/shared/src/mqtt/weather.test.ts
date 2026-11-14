import { describe, expect, it } from 'vitest';

import { weatherExample } from './fixtures.ts';
import { parseMessage } from './messages.ts';
import { readSky, STRONG_WIND, weatherMessage, weatherNow } from './weather.ts';
import type { WeatherMessage } from './weather.ts';

const NOW = weatherExample.ts;
const base = weatherMessage.parse(weatherExample);
const message = (change: {
  observation?: Partial<NonNullable<WeatherMessage['observation']>> | null;
  forecast?: Partial<NonNullable<WeatherMessage['forecast']>> | null;
  ts?: number;
}): WeatherMessage => ({
  ...base,
  ts: change.ts ?? base.ts,
  observation:
    change.observation === null
      ? null
      : base.observation && { ...base.observation, ...change.observation },
  forecast:
    change.forecast === null ? null : base.forecast && { ...base.forecast, ...change.forecast },
});

describe('weather message', () => {
  it('accepts the documented example and needs its version', () => {
    expect(parseMessage('weather', JSON.stringify(weatherExample)).ok).toBe(true);
    expect(weatherMessage.safeParse({ ...weatherExample, v: 2 }).success).toBe(false);
  });

  it('takes null for anything AEMET did not give, never a made-up value', () => {
    const empty = { ...weatherExample, observation: null, forecast: null, tonight: null };
    expect(weatherMessage.safeParse(empty).success).toBe(true);
    const unknown = message({ observation: { temp: null, precip: null }, forecast: { sky: null } });
    expect(weatherMessage.safeParse(unknown).success).toBe(true);
  });

  it('refuses a sky code AEMET does not use', () => {
    expect(weatherMessage.safeParse(message({ forecast: { sky: 'sunny' } })).success).toBe(false);
  });
});

describe('readSky', () => {
  it.each([
    ['11', 'clear', 0],
    ['11n', 'clear', 0],
    ['14', 'cloudy', 0.6],
    ['16', 'cloudy', 1],
    ['26', 'rain', 1],
    ['46n', 'rain', 1],
    ['36', 'snow', 1],
    ['54', 'storm', 1],
    ['81', 'fog', 0.6],
  ] as const)('%s is %s', (code, kind, clouds) => {
    expect(readSky(code)).toMatchObject({ kind, clouds });
  });

  it('says more falls with rain than with light rain', () => {
    expect(readSky('24')?.falling).toBeGreaterThan(readSky('44')?.falling ?? 1);
  });

  it('knows nothing of codes outside the table', () => {
    expect(readSky('99')).toBeNull();
    expect(readSky(null)).toBeNull();
  });
});

describe('weatherNow', () => {
  it('rains from the gauge when it measured some', () => {
    const now = weatherNow(base, NOW);
    expect(now).toMatchObject({ wet: true, rainFrom: 'gauge', precipValue: 0.4, temp: 12.4 });
    expect(now?.rain).toBeGreaterThan(0);
    expect(now?.snow).toBe(0);
  });

  it('rains from the forecast when the gauge measured none', () => {
    const now = weatherNow(message({ observation: { precip: 0 } }), NOW);
    expect(now).toMatchObject({ wet: true, rainFrom: 'forecast' });
  });

  it('is dry and clear when both say so', () => {
    const now = weatherNow(
      message({ observation: { precip: 0 }, forecast: { sky: '11', precip: 0 } }),
      NOW,
    );
    expect(now).toMatchObject({ wet: false, rain: 0, snow: 0, clouds: 0, fog: 0 });
  });

  it('snows only when it is cold enough where it is measured', () => {
    const snowing = message({
      observation: { precip: 0, temp: 0.5 },
      forecast: { sky: '36', snow: 1 },
    });
    expect(weatherNow(snowing, NOW)).toMatchObject({ wet: true });
    expect(weatherNow(snowing, NOW)?.snow).toBeGreaterThan(0);
    const mild = message({ observation: { precip: 0, temp: 8 }, forecast: { sky: '36', snow: 1 } });
    expect(weatherNow(mild, NOW)?.snow).toBe(0);
    expect(weatherNow(mild, NOW)?.rain).toBeGreaterThan(0);
  });

  it('calls the wind strong from the mean or from a gust', () => {
    expect(weatherNow(base, NOW)?.windy).toBe(false);
    const gusty = weatherNow(message({ observation: { windGust: STRONG_WIND.gust + 1 } }), NOW);
    expect(gusty).toMatchObject({ windy: true, windValue: STRONG_WIND.gust + 1 });
    const steady = weatherNow(message({ observation: { windSpeed: STRONG_WIND.mean } }), NOW);
    expect(steady?.windy).toBe(true);
    expect(steady?.wind).toBeGreaterThan(0.5);
  });

  it('trusts the forecast for this hour when the station (1–2 h behind) saw nothing yet', () => {
    // The last observed hour: calm and dry. This hour: rain and gusts forecast.
    const turning = message({
      observation: { precip: 0, windSpeed: 2, windGust: 4 },
      forecast: { sky: '26', precip: 2, windSpeed: 5, windGust: STRONG_WIND.gust + 2 },
    });
    expect(weatherNow(turning, NOW)).toMatchObject({
      wet: true,
      rainFrom: 'forecast',
      windy: true,
      windFrom: 'forecast',
      windValue: STRONG_WIND.gust + 2,
    });
    // Measured wins when both say so.
    const both = message({
      observation: { windGust: STRONG_WIND.gust + 5 },
      forecast: { windGust: STRONG_WIND.gust + 2 },
    });
    expect(weatherNow(both, NOW)).toMatchObject({
      windFrom: 'station',
      windValue: STRONG_WIND.gust + 5,
    });
  });

  it('says when the station measured, so its age can show', () => {
    expect(weatherNow(base, NOW)?.observedAt).toBe(base.observation?.at);
  });

  it('adds fog where the station sees little', () => {
    expect(weatherNow(message({ observation: { visibility: 0.3 } }), NOW)?.fog).toBeGreaterThan(
      0.7,
    );
  });

  it('says nothing when the hub has been silent, or nothing is current', () => {
    expect(weatherNow(base, NOW + 41 * 60)).toBeNull();
    expect(weatherNow(null, NOW)).toBeNull();
    const old = message({
      observation: { at: NOW - 4 * 3600 },
      forecast: { hour: NOW - 5 * 3600 },
    });
    expect(weatherNow(old, NOW)).toBeNull();
  });

  it('keeps the forecast when the observation is old, without a measured temperature', () => {
    const now = weatherNow(message({ observation: { at: NOW - 4 * 3600 } }), NOW);
    expect(now).toMatchObject({ temp: null, rainFrom: 'forecast' });
  });
});
