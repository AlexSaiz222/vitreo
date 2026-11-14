import type { JournalTag } from '@vitreo/shared';

/** A12: what each journal tag says, in the interface's words. */
export const TAG_LABELS: Record<JournalTag, string> = {
  watered: 'Regada a mano',
  sown: 'Siembra',
  transplanted: 'Trasplante',
  pruned: 'Poda',
  harvested: 'Cosecha',
  pest: 'Plaga',
  yellow_leaf: 'Hoja amarilla',
  refilled: 'Depósito rellenado',
  maintenance: 'Mantenimiento',
  sensor_changed: 'Sensor cambiado',
  fault: 'Fallo',
  leak: 'Fuga',
};

/** "Regada a mano · Poda". */
export const tagsText = (tags: readonly JournalTag[]): string =>
  tags.map((tag) => TAG_LABELS[tag]).join(' · ');
