import { GREENHOUSE_ZONES, SPECIES } from '@vitreo/shared';
import type { SpeciesKind } from '@vitreo/shared';

/**
 * The six pots from docs/08-plantas.md (D63). Names come from the species
 * sheets in packages/shared (D38 closed in A2), thresholds start as their
 * proposals and then follow each plant's rule in `config` (D100); where each plant
 * stands comes from the model: node `plant_<id>` of vitreo.glb (docs/04).
 * Zone ids are stable: renaming a plant never changes them.
 */
export type PlantKind = SpeciesKind;

export interface ZoneLayout {
  id: string;
  /** The name shown: the one given in Ajustes › Plantas, or the species'. */
  name: string;
  /**
   * Definite article, for sentences such as "La albahaca tiene sed"; null
   * for a name the person gave, which is a proper name ("Pepa tiene sed").
   */
  article: 'el' | 'la' | null;
  /** The species' common name ("Albahaca"), whatever the plant is called. */
  speciesName: string;
  /** Scientific name, shown in the detail sheet. */
  species: string;
  kind: PlantKind;
  /**
   * Moisture (0–1) below which the plant asks for water and starts to wilt:
   * the species' proposal here, the plant's own with `withThresholds` (D100).
   */
  threshold: number;
}

export const ZONES: readonly ZoneLayout[] = GREENHOUSE_ZONES.map(({ id, kind }) => {
  const sheet = SPECIES[kind];
  return {
    id,
    kind,
    name: sheet.name,
    article: sheet.article,
    speciesName: sheet.name,
    species: sheet.scientificName,
    threshold: sheet.waterBelow,
  };
});

/** The zones with the names given to the plants (from the hub; null = the species'). */
export function withNames(
  zones: readonly ZoneLayout[],
  names: ReadonlyMap<string, string | null>,
): ZoneLayout[] {
  return zones.map((zone) => {
    const given = names.get(zone.id);
    return given ? { ...zone, name: given, article: null } : zone;
  });
}

/** The zones with each plant's threshold (D100, `data/thresholds.ts`). */
export function withThresholds(
  zones: readonly ZoneLayout[],
  thresholds: ReadonlyMap<string, number>,
): ZoneLayout[] {
  return zones.map((zone) => ({ ...zone, threshold: thresholds.get(zone.id) ?? zone.threshold }));
}

/** "la albahaca", "el perejil", or "Pepa": the plant inside a sentence. */
export function zoneSubject(zone: ZoneLayout): string {
  return zone.article ? `${zone.article} ${zone.name.toLowerCase()}` : zone.name;
}

/** "de la albahaca", "del perejil", "de Pepa". */
export function zoneOf(zone: ZoneLayout): string {
  return zone.article === 'el' ? `del ${zone.name.toLowerCase()}` : `de ${zoneSubject(zone)}`;
}
