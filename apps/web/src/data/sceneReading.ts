import type { TelemetryMessage } from '@vitreo/shared';

import { greenhouseStore } from './greenhouse.ts';
import { isGap, replayColumns, replayIndex, useReplay } from './replay.ts';
import { selectFreshness } from './selectors.ts';

/**
 * What the 3D twin shows this frame (A5, D88): the live reading, or the
 * past one under the rewind cursor. Read inside `useFrame`, never through
 * React, so scrubbing moves the scene without re-rendering anything. A gap
 * in the history shows nothing: no moisture, no water, everything off.
 */
const live = (): TelemetryMessage | null => greenhouseStore.getState().telemetry;
const replaying = () => useReplay.getState().mode === 'replay';

function past(): { i: number; data: NonNullable<ReturnType<typeof replayColumns>> } | null {
  const data = replayColumns();
  const i = replayIndex();
  return data && !isGap(data, i) ? { i, data } : null;
}

export const sceneReading = {
  soil(zone: string): number | null {
    if (!replaying()) return live()?.soil.find((reading) => reading.id === zone)?.moisture ?? null;
    const p = past();
    return p ? (p.data.soil[zone]?.[p.i] ?? null) : null;
  },
  tank(): number | null {
    if (!replaying()) return live()?.tank.level ?? null;
    const p = past();
    return p ? (p.data.tank[p.i] ?? null) : null;
  },
  vent(): number {
    if (!replaying()) return live()?.actuators.vent ?? 0;
    const p = past();
    return p ? (p.data.vent[p.i] ?? 0) : 0;
  },
  /** Relative humidity, %; null when unknown (A9: condensation). */
  rh(): number | null {
    if (!replaying()) return live()?.air.rh ?? null;
    const p = past();
    return p ? (p.data.airRh[p.i] ?? null) : null;
  },
  /** Light, lux; null when unknown (A9: dust in the sunlight). */
  lux(): number | null {
    if (!replaying()) return live()?.light.lux ?? null;
    const p = past();
    return p ? (p.data.lux[p.i] ?? null) : null;
  },
  /** Fresh data to show: live, or a rewound instant with readings. */
  live(): boolean {
    if (!replaying()) return selectFreshness(greenhouseStore.getState()).kind === 'live';
    return past() !== null;
  },
  fan(): boolean {
    if (!replaying()) return live()?.actuators.fan ?? false;
    const p = past();
    return p ? (p.data.fan[p.i] ?? 0) >= 0.5 : false;
  },
};
