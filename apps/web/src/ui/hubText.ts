import type { HubStatus } from '../data/hub.ts';
import { formatTime } from './format.ts';

/**
 * Why the hub cannot help right now, calmly (A4, D87): never an alarm, the
 * greenhouse itself is fine. "El hub no responde desde las 14:10: …".
 */
export function hubDownText(
  status: HubStatus,
  downSince: number | null,
  device: string | undefined,
): string | null {
  switch (status) {
    case 'up':
      return null;
    case 'unknown':
      return 'Buscando el hub…';
    case 'down':
      return downSince === null
        ? 'El hub no responde'
        : `El hub no responde desde las ${formatTime(downSince)}`;
    case 'other':
      return `El hub guarda otro invernadero${device ? ` (${device})` : ''}`;
  }
}
