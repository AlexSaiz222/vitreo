import { plantThresholds } from '@vitreo/shared';
import { z } from 'zod';
import { create } from 'zustand';

import { useAutomation } from './automation.ts';

/**
 * Each plant's threshold (D100): the one in its watering rule in `config`,
 * on or off, so the scene, the warnings, the chart and the automatic
 * watering agree. While the hub is down, the last ones it gave (remembered
 * on this device); never seen any, the species' proposals.
 */
const KEY = 'vitreo.thresholds';
const stored = z.array(z.object({ zone: z.string(), threshold: z.number().min(0).max(1) }));
type Rules = z.infer<typeof stored>;

function readRemembered(): Rules | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (stored.safeParse(JSON.parse(raw)).data ?? null) : null;
  } catch {
    return null;
  }
}

function remember(rules: Rules): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rules));
  } catch {
    // Not remembered: the hub gives them again on the next visit.
  }
}

export const useThresholds = create<ReadonlyMap<string, number>>()(() =>
  plantThresholds(typeof localStorage === 'undefined' ? null : readRemembered()),
);

useAutomation.subscribe((state, previous) => {
  const watering = state.state?.config.watering;
  if (!watering || watering === previous.state?.config.watering) return;
  const rules = watering.map(({ zone, threshold }) => ({ zone, threshold }));
  remember(rules);
  const next = plantThresholds(rules);
  const current = useThresholds.getState();
  if ([...next].some(([zone, value]) => current.get(zone) !== value)) {
    useThresholds.setState(next, true);
  }
});
