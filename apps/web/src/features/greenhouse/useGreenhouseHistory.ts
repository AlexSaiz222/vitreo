import { historyColumns, knownEventList, weatherHistory } from '@vitreo/shared';
import type { EventMessage, HistoryColumns, WeatherHistory } from '@vitreo/shared';
import { useEffect, useState } from 'react';

import { now as nowMs } from '../../app/clock.ts';
import { hubGet, useHub } from '../../data/hub.ts';
import type { Series } from '../history/chart.ts';
import { CHART_RANGES } from '../history/usePlantHistory.ts';
import type { ChartRange, WateringMark } from '../history/usePlantHistory.ts';

/** AEMET gives one observation an hour: outside, buckets are never shorter. */
const OUTSIDE_STEP = 3600;
/** Fetched again this often while the sheet stays open. */
const REFRESH_MS = 5 * 60_000;
/** A range reopened within this time is not fetched again. */
const FRESH_MS = 60_000;

export interface GreenhouseWatering extends WateringMark {
  zone: string;
}

export interface GreenhouseHistory {
  temp: Series;
  rh: Series;
  lux: Series;
  tank: Series;
  /** Fraction of each bucket the window was open, the fan and the grow light on (0–1). */
  vent: Series;
  fan: Series;
  growLight: Series;
  /**
   * Outside, from AEMET (A10, D97), in hourly buckets at least; null when the
   * hub could not say (no route, or it failed): not the same as no readings.
   */
  outside: { temp: Series; rh: Series; station: string | null } | null;
  waterings: GreenhouseWatering[];
  /** The oldest reading the hub keeps (Unix s), or null. */
  since: number | null;
  fetchedAt: number;
}

export type GreenhouseHistoryState =
  | { status: 'loading'; data: GreenhouseHistory | null }
  | { status: 'ready'; data: GreenhouseHistory }
  | { status: 'unavailable'; data: GreenhouseHistory | null };

// Events of types this app does not know are left out quietly (D108).
const eventList = knownEventList;
const cache = new Map<ChartRange, GreenhouseHistory>();

const column = (h: HistoryColumns, values: readonly (number | null)[]): Series => ({
  ts: h.ts,
  values,
  step: h.step,
  from: h.from,
  to: h.to,
});

/**
 * AEMET's observations in buckets over the same span: the mean of those in
 * each bucket, null where there is none (AEMET late or down is a gap).
 */
export function outsideSeries(
  rows: WeatherHistory,
  pick: (row: WeatherHistory[number]) => number | null,
  from: number,
  to: number,
  step: number,
): Series {
  const size = Math.max(step, OUTSIDE_STEP);
  const start = Math.floor(from / size) * size;
  const ts: number[] = [];
  for (let t = start; t < to; t += size) ts.push(t);
  const sums = ts.map(() => ({ total: 0, n: 0 }));
  for (const row of rows) {
    const value = pick(row);
    const i = Math.floor((row.at - start) / size);
    const sum = sums[i];
    if (value === null || !sum) continue;
    sum.total += value;
    sum.n += 1;
  }
  return { ts, values: sums.map((s) => (s.n === 0 ? null : s.total / s.n)), step: size, from, to };
}

async function fetchHistory(range: ChartRange, now: number): Promise<GreenhouseHistory | null> {
  const { span, step } = CHART_RANGES[range];
  const to = Math.floor(now / 1000);
  const from = Math.floor((to - span) / step) * step;
  const query = `from=${from.toString()}&to=${to.toString()}`;
  const [history, events, weather] = await Promise.all([
    hubGet(`/history?${query}&step=${step.toString()}`, historyColumns),
    hubGet(`/events?${query}`, eventList),
    hubGet(`/weather/history?${query}`, weatherHistory),
  ]);
  if (!history.ok || !events.ok) return null;
  const h = history.value;
  const waterings = events.value
    .filter(
      (event): event is Extract<EventMessage, { type: 'watering.started' }> =>
        event.type === 'watering.started',
    )
    .map((event) => ({
      t: event.ts,
      zone: event.zone,
      source: event.source,
      seconds: event.seconds,
      ...(event.reason ? { reason: event.reason } : {}),
    }));
  const rows = weather.ok ? weather.value : null;
  return {
    temp: column(h, h.airTemp),
    rh: column(h, h.airRh),
    lux: column(h, h.lux),
    tank: column(h, h.tank),
    vent: column(h, h.vent),
    fan: column(h, h.fan),
    growLight: column(h, h.growLight),
    outside: rows
      ? {
          temp: outsideSeries(rows, (row) => row.temp, h.from, h.to, h.step),
          rh: outsideSeries(rows, (row) => row.rh, h.from, h.to, h.step),
          station: rows.at(-1)?.stationName ?? rows.at(-1)?.station ?? null,
        }
      : null,
    waterings,
    since: useHub.getState().health?.firstTelemetry ?? null,
    fetchedAt: now,
  };
}

/**
 * The whole greenhouse over a range (A11): air, light and tank inside, the
 * weather outside, what the window, fan and light did, and every watering.
 * Kept for a minute per range and fetched again every few minutes while
 * open; with the hub down, what was last fetched stays, and the sheet says so.
 */
export function useGreenhouseHistory(range: ChartRange): GreenhouseHistoryState {
  const [state, setState] = useState<GreenhouseHistoryState>(() => {
    const cached = cache.get(range);
    return cached ? { status: 'ready', data: cached } : { status: 'loading', data: null };
  });
  const [shown, setShown] = useState(range);
  // A new range: start from what is cached for it (render-time reset).
  if (shown !== range) {
    setShown(range);
    const cached = cache.get(range);
    setState(cached ? { status: 'ready', data: cached } : { status: 'loading', data: null });
  }

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const now = nowMs();
      const cached = cache.get(range);
      if (cached && now - cached.fetchedAt < FRESH_MS) return;
      const data = await fetchHistory(range, now);
      if (!alive) return;
      if (data) {
        cache.set(range, data);
        setState({ status: 'ready', data });
      } else {
        setState((previous) => ({ status: 'unavailable', data: previous.data }));
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [range]);

  return state;
}
