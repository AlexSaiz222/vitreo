import type { HistoryColumns } from '@vitreo/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { greenhouseStore } from './greenhouse.ts';
import { configureHub } from './hub.ts';
import {
  isGap,
  mergeChunk,
  readingAt,
  replayColumns,
  scrubTo,
  startReplay,
  stopReplay,
  useReplay,
} from './replay.ts';
import { sceneReading } from './sceneReading.ts';
import { telemetry } from './testing.ts';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const ZONES = ['basil_01'];

/** A history answer with readings everywhere except the buckets in `gaps`. */
function answer(from: number, to: number, step: number, gaps: number[] = []): HistoryColumns {
  const ts: number[] = [];
  for (let t = from; t < to; t += step) ts.push(t);
  const col = (value: number) => ts.map((t) => (gaps.includes(t) ? null : value));
  return {
    from,
    to,
    step,
    ts,
    n: ts.map((t) => (gaps.includes(t) ? 0 : 2)),
    airTemp: col(18),
    airRh: col(60),
    lux: col(100),
    tank: col(0.4),
    pump: col(0),
    growLight: ts.map((t) => (gaps.includes(t) ? null : t % 7200 === 0 ? 1 : 0)),
    fan: col(0),
    vent: col(0.25),
    soil: { basil_01: col(0.31) },
  };
}

/** The hub, answering every chunk with readings except `gaps`. */
function serveHistory(gaps: number[] = []) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push(url);
      const query = new URL(url, 'http://x').searchParams;
      const [from, to, step] = ['from', 'to', 'step'].map((key) => Number(query.get(key)));
      const body = answer(
        Math.floor((from ?? 0) / (step ?? 1)) * (step ?? 1),
        to ?? 0,
        step ?? 1,
        gaps,
      );
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
  return calls;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  configureHub({ apiUrl: '/api', deviceId: 'sim' });
  greenhouseStore.setState({
    telemetry: telemetry(NOW, { soil: [{ id: 'basil_01', moisture: 0.8 }] }),
  });
});
afterEach(() => {
  stopReplay();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('rewind', () => {
  it('loads the window in chunks, newest first', async () => {
    const calls = serveHistory();
    startReplay('24h', { now: NOW, zones: ZONES });
    for (let i = 0; i < 8; i++) await settle();
    expect(calls).toHaveLength(4);
    const ends = calls.map((url) => Number(new URL(url, 'http://x').searchParams.get('to')));
    expect(ends).toEqual([...ends].sort((a, b) => b - a));
    expect(useReplay.getState()).toMatchObject({ mode: 'replay', load: 'ready', loaded: 4 });
  });

  it('shows the past to the scene and the HUD, never the live reading', async () => {
    serveHistory();
    startReplay('24h', { now: NOW, zones: ZONES });
    for (let i = 0; i < 8; i++) await settle();
    const { from } = useReplay.getState();
    scrubTo(from + 3 * 3600);
    // The live store keeps its own reading, untouched.
    expect(greenhouseStore.getState().telemetry?.soil[0]?.moisture).toBe(0.8);
    expect(sceneReading.soil('basil_01')).toBe(0.31);
    expect(sceneReading.tank()).toBe(0.4);
    expect(sceneReading.vent()).toBe(0.25);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(useReplay.getState().shown?.soil[0]?.moisture).toBe(0.31);

    stopReplay();
    expect(sceneReading.soil('basil_01')).toBe(0.8);
    expect(replayColumns()).toBeNull();
  });

  it('a gap shows nothing, and says so at once', async () => {
    const step = 300;
    const to = Math.floor(NOW / 1000);
    const from = Math.floor((to - 24 * 3600) / step) * step;
    const gap = from + 10 * step;
    serveHistory([gap]);
    startReplay('24h', { now: NOW, zones: ZONES });
    for (let i = 0; i < 8; i++) await settle();
    scrubTo(gap + 10);
    expect(useReplay.getState().gap).toBe(true);
    expect(sceneReading.soil('basil_01')).toBeNull();
    expect(sceneReading.tank()).toBeNull();
    expect(sceneReading.fan()).toBe(false);
    scrubTo(gap + step + 10);
    expect(useReplay.getState().gap).toBe(false);
  });

  it('flips the grow light as soon as the cursor crosses it', async () => {
    serveHistory();
    startReplay('24h', { now: NOW, zones: ZONES });
    for (let i = 0; i < 8; i++) await settle();
    const { from } = useReplay.getState();
    const on = Math.ceil(from / 7200) * 7200;
    scrubTo(on + 1);
    expect(useReplay.getState().growLight).toBe(true);
    scrubTo(on + 301);
    expect(useReplay.getState().growLight).toBe(false);
  });

  it('builds a reading without filling anything in', () => {
    const data = answer(0, 900, 300, [300]);
    expect(isGap(data, 1)).toBe(true);
    expect(readingAt(data, 1, ZONES)).toBeNull();
    const reading = readingAt(data, 0, ['basil_01', 'tomato_01']);
    expect(reading?.soil).toEqual([
      { id: 'basil_01', moisture: 0.31 },
      { id: 'tomato_01', moisture: null },
    ]);
    expect(reading?.actuators).toEqual({ pump: false, growLight: true, fan: false, vent: 0.25 });
  });

  it('merges a chunk into its place in the window', () => {
    const window = answer(0, 1200, 300, [0, 300, 600, 900]);
    mergeChunk(window, answer(600, 1200, 300));
    expect(window.n).toEqual([0, 0, 2, 2]);
    expect(window.soil['basil_01']).toEqual([null, null, 0.31, 0.31]);
  });

  it('says when the hub cannot give the history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    startReplay('24h', { now: NOW, zones: ZONES });
    for (let i = 0; i < 4; i++) await settle();
    expect(useReplay.getState().load).toBe('failed');
    expect(sceneReading.soil('basil_01')).toBeNull();
  });
});
