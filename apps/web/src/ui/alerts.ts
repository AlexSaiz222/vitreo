import { deriveAlerts } from '@vitreo/shared';
import type { Alert, HeldLimit } from '@vitreo/shared';
import { useMemo } from 'react';

import { useFreshness, useGreenhouse } from '../data/greenhouse.ts';
import { selectHeld } from '../data/selectors.ts';
import { useReplaying, useShown } from '../data/shown.ts';
import { useThresholds } from '../data/thresholds.ts';
import { zoneOf, ZONES, zoneSubject } from '../scene/zones.ts';
import { formatDegrees } from './format.ts';
import type { ZoneLayout } from '../scene/zones.ts';

/** The active warnings (packages/shared/alerts), most important first. */
export function useAlerts(): Alert[] {
  const freshness = useFreshness().kind;
  // Rewound (A5), the warnings of that moment (none in a gap).
  const replaying = useReplaying();
  const telemetry = useShown((reading) => reading);
  const kind = replaying ? (telemetry ? 'live' : 'waiting') : freshness;
  // Safety limits the device holds now (D90): not shown for the past.
  const frost = useGreenhouse((state) => !replaying && selectHeld(state, 'frost').active);
  const heat = useGreenhouse((state) => !replaying && selectHeld(state, 'over_temperature').active);
  // Each plant's own threshold (D100), the same the hub's notifications use.
  const thresholds = useThresholds();
  return useMemo(() => {
    const held: HeldLimit[] = [];
    if (frost) held.push({ limit: 'frost', value: null });
    if (heat) held.push({ limit: 'over_temperature', value: null });
    const zones = ZONES.map((zone) => ({
      id: zone.id,
      waterBelow: thresholds.get(zone.id) ?? zone.threshold,
    }));
    return deriveAlerts(kind, telemetry, zones, held);
  }, [kind, telemetry, frost, heat, thresholds]);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The few words on a plant's marker: "Sed", "Sin dato". */
export function alertShort(alert: Alert): string {
  return alert.kind === 'thirsty' ? 'Sed' : 'Sin dato';
}

/** The whole sentence, calm (docs/06): for notices and screen readers. */
export function alertSentence(alert: Alert, zones: readonly ZoneLayout[] = ZONES): string {
  const zone = zones.find((z) => z.id === alert.zone);
  switch (alert.kind) {
    case 'thirsty':
      return zone ? capitalize(`${zoneSubject(zone)} tiene sed`) : 'Una planta tiene sed';
    case 'soil_sensor':
      return zone ? `El sensor ${zoneOf(zone)} no responde` : 'Un sensor de tierra no responde';
    case 'tank_empty':
      return 'El depósito está vacío: no se puede regar';
    case 'tank_low':
      return 'Queda poca agua en el depósito';
    case 'tank_sensor':
      return 'El sensor del depósito no responde';
    case 'air_sensor':
      return 'El sensor del aire no responde';
    case 'light_sensor':
      return 'El sensor de luz no responde';
    case 'stale':
      return 'Los datos no son recientes';
    case 'frost':
      return `Ventana cerrada por frío${alert.value === undefined ? '' : ` · ${formatDegrees(alert.value)}`}`;
    case 'over_temperature':
      return `Demasiado calor: ventilación forzada y luz apagada${alert.value === undefined ? '' : ` · ${formatDegrees(alert.value)}`}`;
    case 'disconnected':
      return 'Sin conexión con el invernadero';
  }
}
