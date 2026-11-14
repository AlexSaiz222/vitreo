import {
  API_PREFIX,
  hubHealth,
  hubSettings,
  plant as plantSchema,
  plantList,
} from '@vitreo/shared';
import type {
  HubHealth,
  HubSettings,
  Location,
  NewPlant,
  Plant,
  PlantUpdate,
} from '@vitreo/shared';
import type { z } from 'zod';
import { create } from 'zustand';

import { hubFetch } from './hubFetch.ts';

/**
 * The hub (A4, D87): history, plant names, location and config. Optional for
 * the live greenhouse: the scene, the controls and the warnings go through
 * the broker and keep working while the hub is down (the PC asleep, Docker
 * stopped). Checked every 30 s; each feature that needs it says so calmly,
 * never as an alarm. What it last said (names, location) is remembered on
 * this device, so a hub that is down never blanks them.
 */
export type HubStatus =
  /** Not asked yet. */
  | 'unknown'
  | 'up'
  | 'down'
  /** Up, but it keeps another greenhouse (the dev hub, a wrong .env). */
  | 'other';

export const HUB_CHECK_EVERY_MS = 30_000;
const TIMEOUT_MS = 5_000;
/** Names and location are fetched again this often while the hub is up. */
const REFRESH_EVERY_MS = 5 * 60_000;
const CACHE_KEY = 'vitreo.hub';

export type HubResult<T> = { ok: true; value: T } | { ok: false; reason: 'down' | 'invalid' };

interface HubCache {
  plants: Plant[] | null;
  settings: HubSettings | null;
}

interface HubState extends HubCache {
  status: HubStatus;
  /** When it stopped answering (ms), while down. */
  downSince: number | null;
  health: HubHealth | null;
  /** When names and location were last fetched (ms). */
  fetchedAt: number | null;
}

function readCache(): HubCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<HubCache>) : {};
    return {
      plants: plantList.safeParse(parsed.plants).data ?? null,
      settings: hubSettings.safeParse(parsed.settings).data ?? null,
    };
  } catch {
    return { plants: null, settings: null };
  }
}

function writeCache(cache: HubCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Not remembered: it is fetched again on the next visit.
  }
}

export const useHub = create<HubState>()(() => ({
  status: 'unknown',
  downSince: null,
  health: null,
  fetchedAt: null,
  ...(typeof localStorage === 'undefined' ? { plants: null, settings: null } : readCache()),
}));

let apiBase = '/api';
let deviceId = 'sim';

/** The API's address (VITE_API_URL, normally `/api`) and the greenhouse the app follows. */
export function configureHub(options: { apiUrl?: string | undefined; deviceId: string }): void {
  apiBase = (options.apiUrl ?? '/api').replace(/\/+$/, '');
  deviceId = options.deviceId;
}

const url = (path: string) => `${apiBase}${API_PREFIX.replace(/^\/api/, '')}${path}`;

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<HubResult<T>> {
  let response: Response;
  try {
    response = await hubFetch(url(path), {
      ...init,
      ...(init?.body ? { headers: { 'content-type': 'application/json' } } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'down' };
  }
  // 502/503/504: nginx or Vite could not reach the hub.
  if (response.status >= 500) return { ok: false, reason: 'down' };
  if (!response.ok) return { ok: false, reason: 'invalid' };
  const parsed = schema.safeParse(await response.json().catch(() => null));
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: 'invalid' };
}

function markDown(now: number): void {
  const { status, downSince } = useHub.getState();
  useHub.setState({
    status: 'down',
    downSince: status === 'down' && downSince !== null ? downSince : now,
  });
}

function remember(change: Partial<HubCache>): void {
  useHub.setState(change);
  const { plants, settings } = useHub.getState();
  writeCache({ plants, settings });
}

async function fetchData(now: number): Promise<void> {
  const [plants, settings] = await Promise.all([
    request('/plants', plantList),
    request('/settings', hubSettings),
  ]);
  if (plants.ok && settings.ok) {
    remember({ plants: plants.value, settings: settings.value });
    useHub.setState({ fetchedAt: now });
  }
}

/** Asks the hub how it is, and refreshes names and location when due. */
export async function checkHub(now = Date.now()): Promise<void> {
  const health = await request('/health', hubHealth);
  if (!health.ok) {
    markDown(now);
    return;
  }
  const previous = useHub.getState();
  if (health.value.device !== deviceId) {
    useHub.setState({ status: 'other', downSince: null, health: health.value });
    return;
  }
  useHub.setState({ status: 'up', downSince: null, health: health.value });
  const stale = previous.fetchedAt === null || now - previous.fetchedAt >= REFRESH_EVERY_MS;
  if (previous.status !== 'up' || stale) await fetchData(now);
}

/** Checks now and every 30 s, and again when the app comes back to the front. */
export function startHubCheck(): () => void {
  const check = () => void checkHub();
  const onVisible = () => {
    if (document.visibilityState === 'visible') check();
  };
  check();
  const timer = setInterval(check, HUB_CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', check);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', check);
  };
}

async function write<T>(path: string, schema: z.ZodType<T>, method: string, body: unknown) {
  const result = await request(path, schema, { method, body: JSON.stringify(body) });
  if (!result.ok && result.reason === 'down') markDown(Date.now());
  return result;
}

/** Reads from the hub (history, events): a failure marks it down, as a check would. */
export async function hubGet<T>(path: string, schema: z.ZodType<T>): Promise<HubResult<T>> {
  const result = await request(path, schema);
  if (!result.ok && result.reason === 'down') markDown(Date.now());
  return result;
}

/** Writes to the hub (the automations' config, A6); a failure marks it down. */
export async function hubPut<T>(path: string, schema: z.ZodType<T>, body: unknown) {
  return write(path, schema, 'PUT', body);
}

/** The hub's address for a path, for links (the CSV download). */
export const hubUrl = (path: string): string => url(path);

/** Renames a plant or sets its sowing day. Saved by the hub, then shown. */
export async function updatePlant(zone: string, change: PlantUpdate): Promise<HubResult<Plant>> {
  const result = await write(`/plants/${encodeURIComponent(zone)}`, plantSchema, 'PATCH', change);
  if (result.ok) {
    const plants = useHub.getState().plants ?? [];
    remember({
      plants: plants.some((p) => p.zone === zone)
        ? plants.map((p) => (p.zone === zone ? result.value : p))
        : [...plants, result.value],
    });
  }
  return result;
}

/**
 * A new plant in the pot (A12): the hub keeps the one there as a past
 * chapter and starts again with this one. Saved by the hub, then shown.
 */
export async function startChapter(zone: string, next: NewPlant): Promise<HubResult<Plant>> {
  const result = await write(
    `/plants/${encodeURIComponent(zone)}/chapter`,
    plantSchema,
    'POST',
    next,
  );
  if (result.ok) {
    const plants = useHub.getState().plants ?? [];
    remember({ plants: plants.map((p) => (p.zone === zone ? result.value : p)) });
  }
  return result;
}

/** Moves the greenhouse (rounded by the hub to about a kilometre, D79). */
export async function updateLocation(location: Location): Promise<HubResult<HubSettings>> {
  const result = await write('/settings/location', hubSettings, 'PUT', location);
  if (result.ok) remember({ settings: result.value });
  return result;
}

/** The plant's name as the hub keeps it, or null for the species name. */
export const selectPlantName = (state: HubState, zone: string): string | null =>
  state.plants?.find((p) => p.zone === zone)?.name ?? null;
