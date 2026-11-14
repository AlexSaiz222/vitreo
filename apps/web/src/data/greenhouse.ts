import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { DEMO_DEVICE_ID } from '../demo/setup.ts';
import type { CommandService } from './commands.ts';
import { readDataConfig } from './config.ts';
import type { Connection } from './mqttClient.ts';
import { selectFreshness } from './selectors.ts';
import type { Freshness } from './selectors.ts';
import { createGreenhouseStore } from './store.ts';
import type { GreenhouseState } from './store.ts';

/**
 * The public demo (`vite --mode demo`, D66, D103): the greenhouse runs in a
 * worker in this browser. A constant, so the demo build leaves out the MQTT
 * client entirely, and the home build the demo.
 */
const DEMO = import.meta.env.MODE === 'demo';

const config = DEMO
  ? null
  : readDataConfig(import.meta.env, typeof location === 'undefined' ? undefined : location);

/** The app-wide store: the single source of truth for the device state. */
export const greenhouseStore = createGreenhouseStore(
  DEMO ? DEMO_DEVICE_ID : (config?.deviceId ?? 'sim'),
);

let connection: Connection | null = null;
let starting = false;

/**
 * Starts the live data feed. The MQTT client is loaded on demand so the
 * interface can paint before it. Safe to call more than once.
 */
export function startDataLayer(): void {
  if (connection || starting) return;
  if (DEMO) {
    starting = true;
    void import('./demoLink.ts').then(({ connectDemo }) => {
      connection = connectDemo(greenhouseStore);
    });
    return;
  }
  if (!config) {
    console.warn('[vitreo] VITE_MQTT_* not set: no live data (see .env.example)');
    greenhouseStore.getState().setLink('unconfigured', Date.now());
    return;
  }
  starting = true;
  void import('./mqttClient.ts').then(({ connectGreenhouse }) => {
    connection = connectGreenhouse(config, greenhouseStore);
  });
}

export function getCommands(): CommandService | null {
  return connection?.commands ?? null;
}

export function useGreenhouse<T>(selector: (state: GreenhouseState) => T): T {
  return useStore(greenhouseStore, selector);
}

/** Freshness is a new object on every read; compare it field by field. */
export function useFreshness(): Freshness {
  return useStore(greenhouseStore, useShallow(selectFreshness));
}
