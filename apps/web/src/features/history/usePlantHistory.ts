import { historyColumns, knownEventList } from '@vitreo/shared';
import type { ActionSource, AutomationReason, EventMessage } from '@vitreo/shared';
import { useEffect, useState } from 'react';

import { now as nowMs } from '../../app/clock.ts';
import { hubGet, useHub } from '../../data/hub.ts';
import type { Series } from './chart.ts';

/** The chart's ranges (A5): span and bucket size, in seconds. */
export const CHART_RANGES = {
  '24h': { span: 24 * 3600, step: 15 * 60, label: '24 h' },
  '7d': { span: 7 * 24 * 3600, step: 3600, label: '7 días' },
  '30d': { span: 30 * 24 * 3600, step: 4 * 3600, label: '30 días' },
} as const;
export type ChartRange = keyof typeof CHART_RANGES;

/** Fetched again this often while the sheet stays open. */
const REFRESH_MS = 5 * 60_000;
/** A range reopened within this time is not fetched again. */
const FRESH_MS = 60_000;

export interface WateringMark {
  /** Unix s. */
  t: number;
  source: ActionSource;
  seconds: number;
  /** Why, for an automatic watering (A6). */
  reason?: AutomationReason;
}

export interface PlantHistory {
  series: Series;
  marks: WateringMark[];
  /** The oldest reading the hub keeps (Unix s), or null: before it, no history yet. */
  since: number | null;
  /** When it was fetched (ms). */
  fetchedAt: number;
}

export type PlantHistoryState =
  | { status: 'loading'; data: PlantHistory | null }
  | { status: 'ready'; data: PlantHistory }
  | { status: 'unavailable'; data: PlantHistory | null };

const cache = new Map<string, PlantHistory>();
// Events of types this app does not know are left out quietly (D108).
const eventList = knownEventList;

async function fetchHistory(zone: string, range: ChartRange, now: number) {
  const { span, step } = CHART_RANGES[range];
  const to = Math.floor(now / 1000);
  const from = Math.floor((to - span) / step) * step;
  const query = `from=${from.toString()}&to=${to.toString()}`;
  const [history, events] = await Promise.all([
    hubGet(`/history?${query}&step=${step.toString()}&zones=${zone}`, historyColumns),
    hubGet(`/events?${query}`, eventList),
  ]);
  if (!history.ok || !events.ok) return null;
  const h = history.value;
  const marks = events.value
    .filter(
      (event): event is Extract<EventMessage, { type: 'watering.started' }> =>
        event.type === 'watering.started' && event.zone === zone,
    )
    .map((event) => ({
      t: event.ts,
      source: event.source,
      seconds: event.seconds,
      ...(event.reason ? { reason: event.reason } : {}),
    }));
  const data: PlantHistory = {
    series: {
      ts: h.ts,
      values: h.soil[zone] ?? h.ts.map(() => null),
      step: h.step,
      from: h.from,
      to: h.to,
    },
    marks,
    since: useHub.getState().health?.firstTelemetry ?? null,
    fetchedAt: now,
  };
  return data;
}

/**
 * A plant's soil moisture over a range, with its waterings (A5). Kept for a
 * minute per range, fetched again every few minutes while open; while the
 * hub is down, what was last fetched stays and the sheet says why it waits.
 */
export function usePlantHistory(zone: string, range: ChartRange): PlantHistoryState {
  const key = `${zone}|${range}`;
  const [state, setState] = useState<PlantHistoryState>(() => {
    const cached = cache.get(key);
    return cached ? { status: 'ready', data: cached } : { status: 'loading', data: null };
  });
  const [shownKey, setShownKey] = useState(key);
  // A new range or plant: start from what is cached for it (render-time reset).
  if (shownKey !== key) {
    setShownKey(key);
    const cached = cache.get(key);
    setState(cached ? { status: 'ready', data: cached } : { status: 'loading', data: null });
  }

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const now = nowMs();
      const cached = cache.get(key);
      if (cached && now - cached.fetchedAt < FRESH_MS) return;
      const data = await fetchHistory(zone, range, now);
      if (!alive) return;
      if (data) {
        cache.set(key, data);
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
  }, [key, zone, range]);

  return state;
}
