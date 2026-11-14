/**
 * Which device sounds to play (D121). Pure, so it is tested without audio.
 * Honesty, as with the rest of the sound: a device is heard only when the
 * data says it changed. Never when the data is old, while rewinding (the past
 * does not click), or for the first reading of a visit, which only says how
 * things already were.
 */
export interface DeviceState {
  /** Fresh telemetry, and not rewinding. */
  live: boolean;
  pump: boolean;
  growLight: boolean;
  fan: boolean;
  /** Roof window opening, 0–1. */
  vent: number;
}

export type DeviceCue =
  | 'pump-start'
  | 'pump-stop'
  | 'relay'
  | 'fan-up'
  | 'fan-down'
  | { kind: 'window'; seconds: number };

/** A smaller change of the window is the servo holding, not moving. */
const WINDOW_MIN_CHANGE = 0.02;
/** How long the servo takes end to end (the firmware's slew, about). */
const WINDOW_FULL_SECONDS = 2.2;
const WINDOW_MIN_SECONDS = 0.5;

export function cuesBetween(before: DeviceState | null, after: DeviceState): DeviceCue[] {
  if (!before?.live || !after.live) return [];
  const cues: DeviceCue[] = [];
  if (after.pump !== before.pump) cues.push(after.pump ? 'pump-start' : 'pump-stop');
  if (after.growLight !== before.growLight) cues.push('relay');
  if (after.fan !== before.fan) cues.push(after.fan ? 'fan-up' : 'fan-down');
  const moved = Math.abs(after.vent - before.vent);
  if (moved >= WINDOW_MIN_CHANGE) {
    cues.push({
      kind: 'window',
      seconds: Math.max(WINDOW_MIN_SECONDS, moved * WINDOW_FULL_SECONDS),
    });
  }
  return cues;
}

/**
 * The demo can run a day in a minute, and rules then switch things every few
 * seconds: each sound waits this long (of real time) before it plays again.
 * Never for a stop, or a pump would be heard running on.
 */
export const CUE_REST_MS = 2500;

export function cueName(cue: DeviceCue): string {
  return typeof cue === 'string' ? cue : cue.kind;
}

export function createCueGate(rest = CUE_REST_MS): (cue: DeviceCue, now: number) => boolean {
  const last = new Map<string, number>();
  return (cue, now) => {
    if (cue === 'pump-stop') return true;
    const name = cueName(cue);
    const previous = last.get(name);
    if (previous !== undefined && now - previous < rest) return false;
    last.set(name, now);
    return true;
  };
}
