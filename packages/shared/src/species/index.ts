/**
 * Species sheets (docs/08, D38 → A2): what every part of Vitreo (app, hub,
 * simulator) knows about a kind of plant. Only what docs/08 documents is
 * here; comfort ranges, light hours and growth stages will be added when
 * they are decided, never guessed.
 *
 * Thresholds are soil moisture (0–1, calibrated in the firmware) below which
 * the plant asks for water: a starting point, adjusted with experience.
 */
export const SPECIES_KINDS = [
  'basil',
  'parsley',
  'lettuce',
  'strawberry',
  'chives',
  'tomato',
] as const;

export type SpeciesKind = (typeof SPECIES_KINDS)[number];

export interface Species {
  kind: SpeciesKind;
  /** Common name in Spanish, as the interface shows it. */
  name: string;
  /** Definite article, for sentences such as "La albahaca tiene sed". */
  article: 'el' | 'la';
  scientificName: string;
  /** Water when soil moisture drops below this (0–1). */
  waterBelow: number;
  /**
   * Automatic watering, as proposed (A6, docs/08: indicative): seconds per
   * watering and at most how many a day. Off until the person turns it on.
   */
  water: { seconds: number; maxPerDay: number };
}

export const SPECIES: Readonly<Record<SpeciesKind, Species>> = {
  basil: {
    kind: 'basil',
    name: 'Albahaca',
    article: 'la',
    scientificName: 'Ocimum basilicum',
    waterBelow: 0.4,
    water: { seconds: 5, maxPerDay: 2 },
  },
  parsley: {
    kind: 'parsley',
    name: 'Perejil',
    article: 'el',
    scientificName: 'Petroselinum crispum',
    waterBelow: 0.4,
    water: { seconds: 5, maxPerDay: 2 },
  },
  lettuce: {
    kind: 'lettuce',
    name: 'Lechuga',
    article: 'la',
    scientificName: 'Lactuca sativa',
    waterBelow: 0.45,
    water: { seconds: 6, maxPerDay: 3 },
  },
  strawberry: {
    kind: 'strawberry',
    name: 'Fresa',
    article: 'la',
    scientificName: 'Fragaria × ananassa',
    waterBelow: 0.35,
    water: { seconds: 5, maxPerDay: 2 },
  },
  chives: {
    kind: 'chives',
    name: 'Cebollino',
    article: 'el',
    scientificName: 'Allium schoenoprasum',
    waterBelow: 0.4,
    water: { seconds: 4, maxPerDay: 2 },
  },
  tomato: {
    kind: 'tomato',
    name: 'Tomate cherry',
    article: 'el',
    scientificName: 'Solanum lycopersicum',
    waterBelow: 0.4,
    water: { seconds: 8, maxPerDay: 3 },
  },
};

/**
 * The pots of this greenhouse (docs/08, D63), with stable zone ids: renaming a
 * plant never changes them (docs/12). In the order of the shortcuts 1–6.
 */
export const GREENHOUSE_ZONES: readonly { id: string; kind: SpeciesKind }[] = [
  { id: 'basil_01', kind: 'basil' },
  { id: 'parsley_01', kind: 'parsley' },
  { id: 'lettuce_01', kind: 'lettuce' },
  { id: 'strawberry_01', kind: 'strawberry' },
  { id: 'chives_01', kind: 'chives' },
  { id: 'tomato_01', kind: 'tomato' },
];

/**
 * Each pot's threshold, 0–1 (D100): the one in its watering rule in
 * `config`, whether automatic watering is on or off. "Thirsty", the
 * warnings in the app and the hub, the chart band and the automatic
 * watering all use it; a pot without a rule (no config yet) keeps its
 * species' proposal.
 */
export function plantThresholds(
  watering: readonly { zone: string; threshold: number }[] | null | undefined,
): Map<string, number> {
  const rules = new Map((watering ?? []).map((rule) => [rule.zone, rule.threshold]));
  return new Map(
    GREENHOUSE_ZONES.map(({ id, kind }) => [id, rules.get(id) ?? SPECIES[kind].waterBelow]),
  );
}
