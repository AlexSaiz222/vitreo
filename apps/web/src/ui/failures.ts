import type { CommandMessage } from '@vitreo/shared';
import { useShallow } from 'zustand/react/shallow';

import { useSelection } from '../app/selection.ts';
import { useGreenhouse } from '../data/greenhouse.ts';
import type { CommandEntry } from '../data/store.ts';
import { zoneSubject } from '../scene/zones.ts';
import type { ZoneLayout } from '../scene/zones.ts';
import { refusalText } from './format.ts';
import { useZones } from './useZones.ts';

/** A refused order stays on screen this long. */
const FAILURE_VISIBLE_MS = 10_000;
/** One never answered stays until retried or closed, but not forever. */
const UNANSWERED_VISIBLE_MS = 120_000;

/** What was being done, as the start of a sentence. */
function attempted(command: CommandMessage, zones: readonly ZoneLayout[]): string {
  switch (command.action) {
    case 'water': {
      const zone = zones.find((z) => z.id === command.zone);
      return zone ? `No se pudo regar ${zoneSubject(zone)}` : 'No se pudo regar';
    }
    case 'waterStop':
      return 'No se pudo detener el riego';
    case 'growLight':
      return command.on ? 'No se pudo encender la luz' : 'No se pudo apagar la luz';
    case 'fan':
      return command.on ? 'No se pudo encender el ventilador' : 'No se pudo apagar el ventilador';
    case 'vent':
      return 'No se pudo mover la ventana';
    case 'outdoorHold':
      // Sent by the hub (A10), never by the app; here for completeness.
      return 'No se pudo mantener la ventana cerrada';
  }
}

export interface Failure {
  requestId: string;
  message: string;
  /** Never answered: it can be sent again (same requestId, D30). */
  retry: boolean;
}

function failure(entry: CommandEntry, now: number, zones: readonly ZoneLayout[]): Failure | null {
  const id = entry.command.requestId;
  if (entry.status === 'timeout') {
    if (entry.settledAt === null || now - entry.settledAt > UNANSWERED_VISIBLE_MS) return null;
    return {
      requestId: id,
      message: `${attempted(entry.command, zones)}: el invernadero no respondió`,
      retry: true,
    };
  }
  if (entry.settledAt === null || now - entry.settledAt > FAILURE_VISIBLE_MS) return null;
  if (entry.status === 'failed') {
    return {
      requestId: id,
      message: `${attempted(entry.command, zones)}: sin conexión`,
      retry: false,
    };
  }
  if (entry.status === 'rejected') {
    const why = refusalText(entry, now) ?? 'no se pudo hacer';
    return { requestId: id, message: `${attempted(entry.command, zones)}: ${why}`, retry: false };
  }
  return null;
}

/**
 * The orders that failed (D85): refused by the greenhouse, never answered,
 * or not sent for lack of a connection. Successful toggles say nothing (the
 * control shows the new state); a watering refused while its sheet is open
 * is already explained there.
 */
export function useFailures(): Failure[] {
  const entries = useGreenhouse(useShallow((state) => Object.values(state.commands)));
  const sheetZone = useSelection((state) => state.zoneId);
  // The store's clock (refreshed every few seconds) is enough to let them go.
  const now = useGreenhouse((state) => state.now);
  const zones = useZones();
  return entries
    .filter((entry): entry is CommandEntry => entry !== undefined)
    .filter((entry) => !(entry.command.action === 'water' && entry.command.zone === sheetZone))
    .map((entry) => failure(entry, now, zones))
    .filter((f): f is Failure => f !== null);
}
