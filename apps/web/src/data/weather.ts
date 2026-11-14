import { weatherHistory, weatherNow, weatherRules, weatherState } from '@vitreo/shared';
import type { WeatherNow, WeatherRulesUpdate, WeatherState } from '@vitreo/shared';
import { useMemo } from 'react';
import { create } from 'zustand';

import { now as nowMs } from '../app/clock.ts';
import { IN_DEMO } from '../app/demo.ts';
import { greenhouseStore, useGreenhouse } from './greenhouse.ts';
import { hubGet, hubPut, useHub } from './hub.ts';
import { useReplay } from './replay.ts';

/**
 * Outdoor weather (A10, D97). What it is now comes from the broker (the
 * hub publishes it retained); why there is none, and the hub's weather
 * rules, from the hub's API. No weather at all while the hub does not
 * answer, while rewinding (the past's sky is not kept), or when the data
 * is too old: the scene shows none rather than a guess.
 */

/** The weather now, for the scene and the sound (read every frame, no React). */
export function outdoorNow(now = nowMs()): WeatherNow | null {
  if (useReplay.getState().mode === 'replay') return null;
  if (useHub.getState().status === 'down') return null;
  return weatherNow(greenhouseStore.getState().weather, Math.floor(now / 1000));
}

/** The same for the interface; it follows the store's clock (every 5 s). */
export function useOutdoor(): WeatherNow | null {
  const message = useGreenhouse((state) => state.weather);
  const now = useGreenhouse((state) => state.now);
  const hubDown = useHub((state) => state.status === 'down');
  const replaying = useReplay((state) => state.mode === 'replay');
  return useMemo(
    () => (replaying || hubDown ? null : weatherNow(message, Math.floor(now / 1000))),
    [message, now, hubDown, replaying],
  );
}

/** How far back the ground remembers rain (scene/atmosphere.ts, `wetnessFor`). */
const RAIN_RECORD_HOURS = 9;
/** Often enough for a demo day that lasts a minute; at home, its gauge is hourly. */
const RAIN_RECORD_MS = IN_DEMO ? 5000 : 2 * 60_000;

let rainReadings: readonly { at: number; precip: number | null }[] = [];

/**
 * The gauge's last hours, oldest first, for how wet the ground is (D120). None
 * while the hub does not answer or while rewinding: the past's sky is not kept.
 */
export function rainRecord(): readonly { at: number; precip: number | null }[] {
  if (useReplay.getState().mode === 'replay') return [];
  if (useHub.getState().status === 'down') return [];
  return rainReadings;
}

async function loadRainRecord(): Promise<void> {
  const to = Math.floor(nowMs() / 1000);
  const from = to - RAIN_RECORD_HOURS * 3600;
  const result = await hubGet(
    `/weather/history?from=${from.toString()}&to=${to.toString()}`,
    weatherHistory,
  );
  if (result.ok) rainReadings = [...result.value].sort((a, b) => a.at - b.at);
}

/** "hace 1 h" once the station's reading is an hour old (AEMET runs behind); null before. */
export function outdoorAge(observedAt: number | null, nowMs: number): string | null {
  if (observedAt === null) return null;
  const hours = Math.floor((nowMs / 1000 - observedAt) / 3600);
  return hours >= 1 ? `hace ${hours.toString()}${String.fromCharCode(0xa0)}h` : null;
}

interface WeatherHubState {
  state: WeatherState | null;
  /** The last request failed: the hub does not answer. */
  unreachable: boolean;
  saving: boolean;
  /** A save that did not go through, in words. */
  error: string | null;
}

export const useWeatherHub = create<WeatherHubState>()(() => ({
  state: null,
  unreachable: false,
  saving: false,
  error: null,
}));

export async function loadWeather(): Promise<void> {
  const result = await hubGet('/weather', weatherState);
  useWeatherHub.setState(
    result.ok ? { state: result.value, unreachable: false } : { unreachable: true },
  );
}

/** Switches a weather rule on the hub; it shows the change only once saved. */
export async function saveWeatherRules(change: WeatherRulesUpdate): Promise<boolean> {
  useWeatherHub.setState({ saving: true, error: null });
  const result = await hubPut('/weather/rules', weatherRules, change);
  if (!result.ok) {
    useWeatherHub.setState({
      saving: false,
      error:
        result.reason === 'down'
          ? 'No se ha guardado: el hub no responde. Sigue como estaba.'
          : 'No se ha guardado: el hub no lo ha aceptado.',
    });
    return false;
  }
  const current = useWeatherHub.getState().state;
  useWeatherHub.setState({
    saving: false,
    state: current ? { ...current, rules: result.value } : current,
  });
  void loadWeather();
  return true;
}

const REFRESH_MS = 2 * 60_000;

/** The hub's weather state: when it answers (again), on new weather, and every 2 min. */
export function startWeatherWatch(): () => void {
  const load = () => {
    if (useHub.getState().status === 'up') void loadWeather();
  };
  load();
  const stopHub = useHub.subscribe((state, previous) => {
    if (state.status === 'up' && previous.status !== 'up') void loadWeather();
    if (state.status === 'down') useWeatherHub.setState({ unreachable: true });
  });
  const stopWeather = greenhouseStore.subscribe((store, previous) => {
    // New weather, or the window moved: what the window rule says may have changed.
    const moved = store.telemetry?.actuators.vent !== previous.telemetry?.actuators.vent;
    if (store.weather !== previous.weather || moved) load();
  });
  const timer = setInterval(load, REFRESH_MS);
  const loadRain = () => {
    if (useHub.getState().status === 'up') void loadRainRecord();
  };
  loadRain();
  const rainTimer = setInterval(loadRain, RAIN_RECORD_MS);
  return () => {
    stopHub();
    stopWeather();
    clearInterval(timer);
    clearInterval(rainTimer);
  };
}
