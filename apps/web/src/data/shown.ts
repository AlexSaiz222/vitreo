import type { TelemetryMessage } from '@vitreo/shared';

import { useShallow } from 'zustand/react/shallow';

import { useGreenhouse } from './greenhouse.ts';
import { useReplay } from './replay.ts';

/**
 * What the interface shows (A5, D88): the live reading, or the past one while
 * rewinding. The live store keeps receiving the broker meanwhile, untouched;
 * the two never mix. Selectors must return plain values (no new objects).
 */
export const useReplaying = (): boolean => useReplay((state) => state.mode === 'replay');

export function useShown<T>(select: (telemetry: TelemetryMessage | null) => T): T {
  const replaying = useReplaying();
  const live = useGreenhouse((state) => select(state.telemetry));
  const past = useReplay((state) => select(state.shown));
  return replaying ? past : live;
}

export const useShownMoisture = (zone: string): number | null =>
  useShown((telemetry) => telemetry?.soil.find((reading) => reading.id === zone)?.moisture ?? null);

/** The grow light as the twin shows it: flips at once while scrubbing. */
export function useShownGrowLight(): boolean {
  const replaying = useReplaying();
  const live = useGreenhouse((state) => state.telemetry?.actuators.growLight ?? false);
  const past = useReplay((state) => state.growLight);
  return replaying ? past : live;
}

/** Rewound to an instant with no readings: the twin sleeps and says so. */
export const useReplayGap = (): boolean =>
  useReplay((state) => state.mode === 'replay' && state.gap);

/** Moisture of several pots, as shown (stable array while nothing changes). */
export function useShownMoistures(zones: readonly string[]): (number | null)[] {
  const replaying = useReplaying();
  const pick = (telemetry: TelemetryMessage | null) =>
    zones.map((id) => telemetry?.soil.find((reading) => reading.id === id)?.moisture ?? null);
  const live = useGreenhouse(useShallow((state) => pick(state.telemetry)));
  const past = useReplay(useShallow((state) => pick(state.shown)));
  return replaying ? past : live;
}
