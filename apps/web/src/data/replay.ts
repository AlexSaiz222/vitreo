import { historyColumns } from '@vitreo/shared';
import type { HistoryColumns, TelemetryMessage } from '@vitreo/shared';
import { create } from 'zustand';

import { now as nowMs } from '../app/clock.ts';
import { hubGet } from './hub.ts';

/**
 * Rewind (A5, D88): the twin shows how the greenhouse was at a past instant,
 * from the hub's history. Kept apart from the live store, which keeps
 * receiving the broker untouched: past and live never mix.
 *
 * Two speeds:
 * - per frame, the scene reads the cursor and the loaded columns directly
 *   (`replayIndex`, `replayColumns`), with no React render while scrubbing;
 * - a few times a second, `useReplay` publishes the shown instant and a
 *   reading built from it, for the HUD's texts. Discrete switches (the grow
 *   light, a gap) are published as soon as they flip.
 */
export type ReplayRange = '24h' | '7d' | '30d';

/** Span, bucket size and chunk size per range, in seconds. */
export const REPLAY_RANGES: Record<ReplayRange, { span: number; step: number; chunk: number }> = {
  '24h': { span: 24 * 3600, step: 5 * 60, chunk: 6 * 3600 },
  '7d': { span: 7 * 24 * 3600, step: 30 * 60, chunk: 24 * 3600 },
  '30d': { span: 30 * 24 * 3600, step: 2 * 3600, chunk: 6 * 24 * 3600 },
};

/** The HUD texts follow the cursor at most this often while scrubbing. */
const COMMIT_EVERY_MS = 150;
/** A switch counts as on when it was on for at least half of the bucket. */
const ON = 0.5;

export type ReplayLoad = 'loading' | 'ready' | 'failed';

export interface ReplayState {
  mode: 'live' | 'replay';
  range: ReplayRange;
  /** The window, Unix s (bucket-aligned start, the instant it was opened). */
  from: number;
  to: number;
  step: number;
  /** Chunks loaded, of how many; newest first. */
  loaded: number;
  chunks: number;
  load: ReplayLoad;
  /** The instant shown (Unix s), published a few times a second. */
  at: number;
  /** The reading at `at` as the twin shows it, or null in a gap. */
  shown: TelemetryMessage | null;
  /** No readings at the cursor (a gap, or not loaded yet). */
  gap: boolean;
  /** The cursor's chunk has not arrived yet: "loading", not "no data". */
  pending: boolean;
  /** Bumped when the cursor is moved by the app, not the scrubber. */
  jump: number;
  growLight: boolean;
  /** Bumped when a chunk arrives (the coverage strip redraws). */
  revision: number;
}

const LIVE: Omit<ReplayState, 'range'> = {
  mode: 'live',
  from: 0,
  to: 0,
  step: 300,
  loaded: 0,
  chunks: 0,
  load: 'ready',
  at: 0,
  shown: null,
  gap: false,
  pending: false,
  jump: 0,
  growLight: false,
  revision: 0,
};

export const useReplay = create<ReplayState>()(() => ({ ...LIVE, range: '24h' }));

// ------------------------------------------------- per-frame state (no React)

let columns: HistoryColumns | null = null;
let zones: string[] = [];
let cursor = 0;
let session = 0;
let commitTimer: ReturnType<typeof setTimeout> | null = null;
let lastCommit = 0;
/** Oldest instant loaded so far (chunks arrive newest first). */
let loadedFrom = Number.POSITIVE_INFINITY;
/** The scrubber has been moved since the window opened. */
let touched = false;

/** The loaded history (null while live). */
export const replayColumns = (): HistoryColumns | null => columns;
/** The cursor, Unix s. */
export const replayCursor = (): number => cursor;

/** The bucket under the cursor, or -1 outside the window. */
export function replayIndex(): number {
  if (!columns) return -1;
  const i = Math.floor((cursor - columns.from) / columns.step);
  return i >= 0 && i < columns.ts.length ? i : -1;
}

/** No readings in bucket `i` (a gap, or its chunk is not loaded yet). */
export function isGap(data: HistoryColumns, i: number): boolean {
  return i < 0 || (data.n[i] ?? 0) === 0;
}

/**
 * The reading the twin shows for bucket `i`, in the shape of a telemetry
 * message so the HUD reads it like a live one; null in a gap. Switches are
 * on when they were on for most of the bucket. Nothing is filled in.
 */
export function readingAt(data: HistoryColumns, i: number, soilZones: readonly string[]) {
  if (isGap(data, i)) return null;
  const value = (column: (number | null)[]) => column[i] ?? null;
  const on = (column: (number | null)[]) => (value(column) ?? 0) >= ON;
  const message: TelemetryMessage = {
    v: 1,
    ts: data.ts[i] ?? 0,
    air: { temp: value(data.airTemp), rh: value(data.airRh) },
    light: { lux: value(data.lux) },
    soil: soilZones.map((id) => ({ id, moisture: data.soil[id]?.[i] ?? null })),
    tank: { level: value(data.tank) },
    actuators: {
      pump: on(data.pump),
      growLight: on(data.growLight),
      fan: on(data.fan),
      vent: value(data.vent) ?? 0,
    },
    fw: 'history',
    rssi: 0,
  };
  return message;
}

function publish(now = performance.now()): void {
  if (commitTimer) {
    clearTimeout(commitTimer);
    commitTimer = null;
  }
  lastCommit = now;
  const data = columns;
  const i = replayIndex();
  const shown = data ? readingAt(data, i, zones) : null;
  useReplay.setState({
    at: cursor,
    shown,
    gap: shown === null,
    pending: cursor < loadedFrom,
    growLight: shown?.actuators.growLight ?? false,
  });
}

/** The middle of the newest bucket with readings, or null. */
function newestReading(data: HistoryColumns): number | null {
  for (let i = data.ts.length - 1; i >= 0; i--) {
    if (!isGap(data, i)) return (data.ts[i] ?? 0) + data.step / 2;
  }
  return null;
}

/**
 * Moves the cursor (Unix s). Called on every input event of the scrubber:
 * the scene follows on its next frame; the HUD a few times a second.
 */
export function scrubTo(seconds: number): void {
  const state = useReplay.getState();
  if (state.mode !== 'replay' || !columns) return;
  touched = true;
  cursor = Math.min(Math.max(seconds, state.from), state.to);
  // Switches flip at once, without waiting for the next HUD update.
  const i = replayIndex();
  const gap = isGap(columns, i);
  const growLight = !gap && (columns.growLight[i] ?? 0) >= ON;
  if (gap !== state.gap || growLight !== state.growLight) useReplay.setState({ gap, growLight });
  const now = performance.now();
  if (now - lastCommit >= COMMIT_EVERY_MS) publish(now);
  else commitTimer ??= setTimeout(publish, COMMIT_EVERY_MS - (now - lastCommit));
}

function emptyColumns(from: number, to: number, step: number, wanted: string[]): HistoryColumns {
  const size = Math.ceil((to - from) / step);
  const empty = () => new Array<number | null>(size).fill(null);
  return {
    from,
    to,
    step,
    ts: Array.from({ length: size }, (_, i) => from + i * step),
    n: new Array<number>(size).fill(0),
    airTemp: empty(),
    airRh: empty(),
    lux: empty(),
    tank: empty(),
    pump: empty(),
    growLight: empty(),
    fan: empty(),
    vent: empty(),
    soil: Object.fromEntries(wanted.map((zone) => [zone, empty()])),
  };
}

/** Copies a chunk into the window's columns (same step, aligned buckets). */
export function mergeChunk(into: HistoryColumns, chunk: HistoryColumns): void {
  const offset = Math.round((chunk.from - into.from) / into.step);
  const keys = [
    'n',
    'airTemp',
    'airRh',
    'lux',
    'tank',
    'pump',
    'growLight',
    'fan',
    'vent',
  ] as const;
  chunk.ts.forEach((_, j) => {
    const i = offset + j;
    if (i < 0 || i >= into.ts.length) return;
    for (const key of keys) (into[key] as (number | null)[])[i] = chunk[key][j] ?? null;
    for (const [zone, values] of Object.entries(chunk.soil)) {
      const column = (into.soil[zone] ??= new Array<number | null>(into.ts.length).fill(null));
      column[i] = values[j] ?? null;
    }
  });
}

async function loadChunks(
  id: number,
  window: { from: number; to: number; step: number; chunk: number },
) {
  const { from, to, step, chunk } = window;
  // Newest first: the cursor starts at "now" and is most often moved a little back.
  for (let end = to; end > from; end -= chunk) {
    const start = Math.max(from, end - chunk);
    const result = await hubGet(
      `/history?from=${start.toString()}&to=${end.toString()}&step=${step.toString()}`,
      historyColumns,
    );
    if (id !== session || !columns) return;
    if (!result.ok) {
      useReplay.setState({ load: 'failed' });
      return;
    }
    mergeChunk(columns, result.value);
    loadedFrom = Math.min(loadedFrom, start);
    const { loaded, chunks, revision, jump } = useReplay.getState();
    // Opened at "now", whose bucket may still be empty: start at the newest
    // reading instead, unless the scrubber has already been moved.
    const newest = touched || !isGap(columns, replayIndex()) ? null : newestReading(columns);
    if (newest !== null) cursor = newest;
    useReplay.setState({
      loaded: loaded + 1,
      load: loaded + 1 >= chunks ? 'ready' : 'loading',
      revision: revision + 1,
      ...(newest === null ? {} : { jump: jump + 1 }),
    });
    // The cursor's bucket may just have arrived.
    publish();
  }
}

/**
 * Opens the past (A5): the last `range` up to now, loaded in chunks, newest
 * first. The cursor starts at `at` (Unix s) or at the newest bucket.
 */
export function startReplay(
  range: ReplayRange,
  options: { at?: number; now?: number; zones: string[] },
): void {
  const { span, step, chunk } = REPLAY_RANGES[range];
  const to = Math.floor((options.now ?? nowMs()) / 1000);
  const from = Math.floor((to - span) / step) * step;
  session += 1;
  zones = options.zones;
  columns = emptyColumns(from, to, step, zones);
  loadedFrom = Number.POSITIVE_INFINITY;
  touched = options.at !== undefined;
  const chunks = Math.ceil((to - from) / chunk);
  cursor = Math.min(Math.max(options.at ?? to - 1, from), to - 1);
  useReplay.setState({
    mode: 'replay',
    range,
    from,
    to,
    step,
    loaded: 0,
    chunks,
    load: 'loading',
    at: cursor,
    shown: null,
    gap: true,
    pending: true,
    growLight: false,
  });
  void loadChunks(session, { from, to, step, chunk });
}

/** Changes the range, keeping the instant if it is still inside. */
export function setReplayRange(range: ReplayRange): void {
  const state = useReplay.getState();
  if (state.mode !== 'replay' || state.range === range) return;
  startReplay(range, { at: cursor, zones });
}

/** "Volver a ahora": back to the live greenhouse. */
export function stopReplay(): void {
  session += 1;
  columns = null;
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = null;
  useReplay.setState({ ...LIVE, range: useReplay.getState().range });
}
