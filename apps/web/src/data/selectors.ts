import type { CommandMessage, EventMessage } from '@vitreo/shared';

import type { CommandEntry, GreenhouseState } from './store.ts';

/**
 * How much the app can trust what it shows. Never invent values: when the
 * data is old or the link is down, the UI and the scene say so.
 *
 * `since` is the time (ms) of the last telemetry we received, which is what
 * "Desconectado desde las 14:10" refers to.
 */
export type Freshness =
  | { kind: 'waiting' }
  | { kind: 'live' }
  | { kind: 'stale'; since: number }
  | { kind: 'disconnected'; reason: 'broker' | 'device'; since: number | null };

export function selectFreshness(state: GreenhouseState): Freshness {
  const lastData = state.telemetry ? state.telemetry.ts * 1000 : null;

  if (state.link !== 'connected') {
    return { kind: 'disconnected', reason: 'broker', since: lastData ?? state.linkChangedAt };
  }
  if (state.device.state === 'offline') {
    return { kind: 'disconnected', reason: 'device', since: lastData };
  }
  if (lastData === null) return { kind: 'waiting' };
  if (state.now - lastData > state.staleAfterMs) return { kind: 'stale', since: lastData };
  return { kind: 'live' };
}

/** Last known soil moisture (0–1) for a zone, or `null` if unknown or the sensor failed. */
export function selectSoilMoisture(state: GreenhouseState, zone: string): number | null {
  return state.telemetry?.soil.find((reading) => reading.id === zone)?.moisture ?? null;
}

/** The latest command matching `match`, if any. */
export function selectLastCommand(
  state: GreenhouseState,
  match: (command: CommandMessage) => boolean,
): CommandEntry | null {
  let latest: CommandEntry | null = null;
  for (const entry of Object.values(state.commands)) {
    if (entry && match(entry.command) && (!latest || entry.sentAt > latest.sentAt)) latest = entry;
  }
  return latest;
}

/** The latest command sent for a zone's watering, if any. */
export function selectLastWateringCommand(state: GreenhouseState, zone: string) {
  return selectLastCommand(state, (c) => c.action === 'water' && c.zone === zone);
}

/** The last watering of a zone started in this session (with its reason, A6), if any. */
export function selectLastWateringStart(state: GreenhouseState, zone: string) {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const event = state.events[i];
    if (event?.type === 'watering.started' && event.zone === zone) return event;
  }
  return null;
}

/**
 * The last completed watering of a zone seen in this session, if any.
 * Earlier history comes from the hub (phase 4).
 */
export function selectLastWatering(state: GreenhouseState, zone: string) {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const event = state.events[i];
    if (event?.type === 'watering.finished' && event.zone === zone) return event;
  }
  return null;
}

/**
 * The automation's last switch of an actuator (A6), if it still explains
 * what is shown: same state now, and no order for it sent since.
 */
export function selectAutomationNote(
  state: GreenhouseState,
  target: 'growLight' | 'fan' | 'vent',
): Extract<EventMessage, { type: 'automation.switched' }> | null {
  let event: Extract<EventMessage, { type: 'automation.switched' }> | null = null;
  for (let i = state.events.length - 1; i >= 0 && !event; i--) {
    const candidate = state.events[i];
    if (candidate?.type === 'automation.switched' && candidate.target === target) event = candidate;
  }
  const actuators = state.telemetry?.actuators;
  if (!event || !actuators) return null;
  const now = target === 'vent' ? actuators.vent : actuators[target];
  if (typeof now === 'boolean' ? now !== event.value : Math.abs(now - Number(event.value)) > 0.01)
    return null;
  const action = target === 'growLight' ? 'growLight' : target;
  // The event's time is in whole seconds: an order in that same second came
  // before it (the hub's rain rule can close the window right after you open it).
  const orderedSince = Object.values(state.commands).some(
    (entry) => entry?.command.action === action && entry.sentAt >= (event.ts + 1) * 1000,
  );
  return orderedSince ? null : event;
}

/** Below this the firmware protects from frost (D90); used only before any event says. */
const FROST_C = 5;

/**
 * Whether the device holds a safety limit now (D90): from its own events
 * (triggered, then cleared), with the temperature now. Before any event
 * this session, frost is read from the air temperature; heat is not
 * guessed.
 */
export function selectHeld(
  state: GreenhouseState,
  limit: 'frost' | 'over_temperature',
): { active: boolean; temp: number | null } {
  const temp = state.telemetry?.air.temp ?? null;
  for (let i = state.events.length - 1; i >= 0; i--) {
    const event = state.events[i];
    if (
      (event?.type === 'safety.triggered' || event?.type === 'safety.cleared') &&
      event.limit === limit
    ) {
      return { active: event.type === 'safety.triggered', temp: temp ?? event.value ?? null };
    }
  }
  return { active: limit === 'frost' && temp !== null && temp < FROST_C, temp };
}

/** Frost protection (D90): the window held closed and the fan off. */
export const selectFrost = (state: GreenhouseState) => selectHeld(state, 'frost');
