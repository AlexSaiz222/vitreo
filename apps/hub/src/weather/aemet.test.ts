import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AemetError,
  fetchDataset,
  fetchForecast,
  fetchNearestStation,
  fetchObservation,
  parseForecast,
  zonedSeconds,
} from './aemet.ts';

/** AEMET OpenData's two-step answers, from files: no network (A10). */

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');
const BASE = 'https://aemet.test/opendata';
const KEY = 'test-key';

interface Seen {
  url: string;
  headers: Record<string, string>;
}

/** A fake AEMET: the first request says where the data is; the second serves it in ISO-8859-15. */
function fakeAemet(
  routes: Record<string, string | { status: number; body?: unknown }>,
  seen: Seen[] = [],
): typeof fetch {
  return (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    seen.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    if (url.startsWith(`${BASE}/api`)) {
      const path = url.slice(`${BASE}/api`.length);
      const route = routes[path];
      if (route === undefined) {
        return Promise.resolve(Response.json({ descripcion: 'No hay datos', estado: 404 }));
      }
      if (typeof route !== 'string')
        return Promise.resolve(Response.json(route.body ?? {}, { status: route.status }));
      return Promise.resolve(
        Response.json({
          descripcion: 'exito',
          estado: 200,
          datos: `https://aemet.test/datos${path}`,
          metadatos: 'https://aemet.test/meta',
        }),
      );
    }
    const body = routes[url.slice('https://aemet.test/datos'.length)];
    return Promise.resolve(
      new Response(Buffer.from(typeof body === 'string' ? body : '', 'latin1'), {
        headers: { 'content-type': 'text/plain;charset=ISO-8859-15' },
      }),
    );
  };
}

const options = (fetcher: typeof fetch) => ({ url: BASE, key: KEY, fetch: fetcher });
const OBS = '/observacion/convencional/datos/estacion/3195';
const ALL = '/observacion/convencional/todas';
const FORECAST = '/prediccion/especifica/municipio/horaria/28079';

describe('AEMET OpenData', () => {
  it('sends the key in a header, never in the address', async () => {
    const seen: Seen[] = [];
    await fetchObservation(
      options(fakeAemet({ [OBS]: fixture('observacion-3195.json') }, seen)),
      '3195',
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]?.headers['api_key']).toBe(KEY);
    expect(seen.every((request) => !request.url.includes(KEY))).toBe(true);
    expect(seen[1]?.headers['api_key']).toBeUndefined();
  });

  it('reads the station’s latest hour, in UTC', async () => {
    const { observation } = await fetchObservation(
      options(fakeAemet({ [OBS]: fixture('observacion-3195.json') })),
      '3195',
    );
    expect(observation).toEqual({
      station: { id: '3195', name: 'MADRID, RETIRO' },
      at: Date.parse('2026-10-13T15:00:00Z') / 1000,
      temp: 19.1,
      rh: 72,
      windSpeed: 3.1,
      windGust: 7.2,
      windDir: 230,
      precip: 0.4,
      visibility: 12,
    });
  });

  it('chooses the nearest station that reports a temperature, reading ISO-8859-15', async () => {
    const fetcher = fakeAemet({ [ALL]: fixture('todas.json') });
    // Madrid centre: Retiro.
    expect(await fetchNearestStation(options(fetcher), { lat: 40.42, lng: -3.7 })).toMatchObject({
      id: '3195',
    });
    // East of Madrid: Torrejón, its accent intact.
    expect(await fetchNearestStation(options(fetcher), { lat: 40.47, lng: -3.45 })).toMatchObject({
      id: '3175',
      name: 'TORREJÓN DE ARDOZ',
    });
    // Cuatro Vientos is closest to here but has no temperature now.
    expect((await fetchNearestStation(options(fetcher), { lat: 40.37, lng: -3.79 })).id).not.toBe(
      '3196',
    );
  });

  it('reads the hourly forecast in local time, with wind in m/s and "Ip" as a trace', async () => {
    const forecast = await fetchForecast(
      options(fakeAemet({ [FORECAST]: fixture('horaria-28079.json') })),
      '28079',
      'Europe/Madrid',
    );
    expect(forecast.municipality).toEqual({ id: '28079', name: 'Madrid' });
    // 13:12:40 in Madrid (CEST) is 11:12:40 UTC.
    expect(forecast.issuedAt).toBe(Date.parse('2026-10-13T11:12:40Z') / 1000);
    const at15 = forecast.points.find((p) => p.hour === Date.parse('2026-10-13T13:00:00Z') / 1000);
    expect(at15).toEqual({
      hour: Date.parse('2026-10-13T13:00:00Z') / 1000,
      sky: '45',
      skyText: 'Muy nuboso con lluvia escasa',
      temp: 19,
      precip: 0,
      snow: 0,
      windSpeed: 15 / 3.6,
      windGust: 30 / 3.6,
    });
    expect(forecast.points).toHaveLength(34);
  });

  it('turns local hours into UTC on both sides of a change of time', () => {
    // Summer (CEST, +2) and winter (CET, +1).
    expect(zonedSeconds('2026-10-13', 6, 'Europe/Madrid')).toBe(
      Date.parse('2026-10-13T04:00:00Z') / 1000,
    );
    expect(zonedSeconds('2026-12-01', 6, 'Europe/Madrid')).toBe(
      Date.parse('2026-12-01T05:00:00Z') / 1000,
    );
    // The night the clocks go back (25 Oct 2026): 04:00 is already CET.
    expect(zonedSeconds('2026-10-25', 4, 'Europe/Madrid')).toBe(
      Date.parse('2026-10-25T03:00:00Z') / 1000,
    );
  });

  it.each([
    [401, 'unauthorized'],
    [429, 'limit'],
    [500, 'unavailable'],
  ] as const)('says what went wrong: HTTP %d is %s', async (status, kind) => {
    const fetcher = fakeAemet({ [OBS]: { status } });
    await expect(fetchDataset(options(fetcher), OBS)).rejects.toMatchObject({ kind });
  });

  it('reads AEMET’s own status inside a 200 (an expired key, no data)', async () => {
    const expired = fakeAemet({
      [OBS]: { status: 200, body: { estado: 401, descripcion: 'API key invalido' } },
    });
    await expect(fetchDataset(options(expired), OBS)).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    await expect(fetchDataset(options(fakeAemet({})), OBS)).rejects.toMatchObject({
      kind: 'no-data',
    });
  });

  it('gives up on a silent server instead of waiting forever', async () => {
    const down = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    const error = await fetchDataset(options(down), OBS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AemetError);
    expect(error).toMatchObject({ kind: 'unavailable' });
  });

  it('refuses an answer that is not a forecast', () => {
    expect(() => parseForecast({ nope: true }, 'Europe/Madrid')).toThrow(AemetError);
  });
});
