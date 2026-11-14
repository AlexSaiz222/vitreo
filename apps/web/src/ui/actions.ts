import { getCommands, greenhouseStore } from '../data/greenhouse.ts';
import type { CommandInput } from '../data/commands.ts';

/** docs/06: "Aire" runs the fan for a while; every temporary order has a duration. */
export const FAN_MINUTES = 10;

export const WINDOW_POSITIONS = [
  { value: 'closed', label: 'Cerrada', open: 0 },
  { value: 'half', label: 'Media', open: 0.5 },
  { value: 'open', label: 'Abierta', open: 1 },
] as const;

function send(input: CommandInput) {
  void getCommands()?.send(input);
}

/**
 * Orders from the HUD (D85). Toggles have no Undo: the control itself shows
 * the state and is the way back. Only a failure (rejected, or no answer)
 * says something, as a notice. Watering cannot be undone: while it runs,
 * "Detener" stops the pump (D84).
 */
export function switchLight(on: boolean) {
  send({ action: 'growLight', on });
}

export function switchFan(on: boolean) {
  send(on ? { action: 'fan', on: true, minutes: FAN_MINUTES } : { action: 'fan', on: false });
}

export function moveWindow(open: number) {
  send({ action: 'vent', open });
}

/** Stops the pump now: the honest undo of a watering (D84). */
export function stopWatering(zoneId: string) {
  send({ action: 'waterStop', zone: zoneId });
  greenhouseStore.getState().stopShowingWatering(zoneId);
}
