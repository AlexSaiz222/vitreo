import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkHub, configureHub, updatePlant, useHub } from './hub.ts';

const T0 = Date.parse('2026-10-08T14:10:00Z');
const health = (device = 'sim') => ({
  status: 'ok',
  device,
  since: T0,
  mqtt: true,
  lastTelemetry: T0 / 1000,
  firstTelemetry: T0 / 1000 - 3600,
});
const plants = [{ zone: 'basil_01', kind: 'basil', name: 'Pepa', sownAt: null, since: null }];
const settings = { location: { lat: 40.42, lng: -3.7 }, timeZone: 'Europe/Madrid' };

type Reply = { status: number; body?: unknown } | 'offline';

function serve(routes: Record<string, Reply>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api\/v1/, '');
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      const reply = routes[`${init?.method ?? 'GET'} ${path}`] ?? { status: 404 };
      if (reply === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(
        new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), {
          status: reply.status,
        }),
      );
    }),
  );
  return calls;
}

const up = {
  'GET /health': { status: 200, body: health() },
  'GET /plants': { status: 200, body: plants },
  'GET /settings': { status: 200, body: settings },
};

beforeEach(() => {
  configureHub({ apiUrl: '/api', deviceId: 'sim' });
  useHub.setState({
    status: 'unknown',
    downSince: null,
    health: null,
    fetchedAt: null,
    plants: null,
    settings: null,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the hub, seen from the app', () => {
  it('is up and gives the names and the location', async () => {
    serve(up);
    await checkHub(T0);
    expect(useHub.getState()).toMatchObject({ status: 'up', plants, settings, downSince: null });
  });

  it('is down when it does not answer or the proxy cannot reach it, since the first miss', async () => {
    serve({ 'GET /health': 'offline' });
    await checkHub(T0);
    serve({ 'GET /health': { status: 502 } });
    await checkHub(T0 + 30_000);
    expect(useHub.getState()).toMatchObject({ status: 'down', downSince: T0 });
  });

  it('keeps what it last said while it is down', async () => {
    serve(up);
    await checkHub(T0);
    serve({ 'GET /health': 'offline' });
    await checkHub(T0 + 30_000);
    expect(useHub.getState()).toMatchObject({ status: 'down', plants, settings });
  });

  it('is not ours when it keeps another greenhouse (the dev hub)', async () => {
    const calls = serve({ 'GET /health': { status: 200, body: health('dev') } });
    await checkHub(T0);
    expect(useHub.getState().status).toBe('other');
    expect(calls).toEqual(['GET /health']);
  });

  it('asks for names again only every few minutes', async () => {
    const calls = serve(up);
    await checkHub(T0);
    await checkHub(T0 + 30_000);
    await checkHub(T0 + 5 * 60_000);
    expect(calls.filter((call) => call === 'GET /plants')).toHaveLength(2);
  });

  it('shows a new name only once the hub has saved it', async () => {
    serve({ 'PATCH /plants/basil_01': 'offline' });
    const failed = await updatePlant('basil_01', { name: 'Pepa' });
    expect(failed).toEqual({ ok: false, reason: 'down' });
    expect(useHub.getState()).toMatchObject({ plants: null, status: 'down' });

    serve({ 'PATCH /plants/basil_01': { status: 200, body: plants[0] } });
    const saved = await updatePlant('basil_01', { name: 'Pepa' });
    expect(saved.ok).toBe(true);
    expect(useHub.getState().plants).toEqual(plants);
  });
});

describe('a newer hub', () => {
  it('never breaks this app: fields it does not know are ignored', async () => {
    serve({
      ...up,
      'GET /health': { status: 200, body: { ...health(), addedLater: { anything: 1 } } },
    });
    await checkHub(T0);
    expect(useHub.getState().status).toBe('up');
  });
});
