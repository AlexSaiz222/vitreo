import { useMemo } from 'react';

import { useHub } from '../data/hub.ts';
import { useThresholds } from '../data/thresholds.ts';
import { withNames, withThresholds, ZONES } from '../scene/zones.ts';
import type { ZoneLayout } from '../scene/zones.ts';

/**
 * The pots with the names given in Ajustes › Plantas (A4) and each plant's
 * threshold (D100). While the hub is down, the last ones it gave
 * (remembered on this device); never seen any, the species'.
 */
export function useZones(): readonly ZoneLayout[] {
  const plants = useHub((state) => state.plants);
  const thresholds = useThresholds();
  return useMemo(() => {
    const zones = withThresholds(ZONES, thresholds);
    return plants ? withNames(zones, new Map(plants.map((p) => [p.zone, p.name]))) : zones;
  }, [plants, thresholds]);
}

export function useZone(zoneId: string | null): ZoneLayout | undefined {
  const zones = useZones();
  return zones.find((zone) => zone.id === zoneId);
}
