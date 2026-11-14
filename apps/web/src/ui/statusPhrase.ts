import { TANK_EMPTY_LEVEL, TANK_LOW_LEVEL } from '@vitreo/shared';
import type { TelemetryMessage } from '@vitreo/shared';

import type { Freshness } from '../data/selectors.ts';
import type { BrokerLink } from '../data/store.ts';
import { wiltAmount } from '../scene/wilt.ts';
import { zoneOf, zoneSubject } from '../scene/zones.ts';
import type { ZoneLayout } from '../scene/zones.ts';
import { freshnessText } from './format.ts';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "la albahaca", "la albahaca y el perejil", "la albahaca, el perejil y la fresa". */
function list(zones: readonly ZoneLayout[]): string {
  const names = zones.map(zoneSubject);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1) ?? ''}`;
}

/** The status line's sentence, and whether it asks for attention. */
export interface StatusSummary {
  text: string;
  /** Not normal: shown with the attention mark as well as in words. */
  attention: boolean;
}

/**
 * The human sentence of the status line (docs/03): "Todo bien", "La albahaca
 * tiene sed", "Desconectado desde las 14:10". Normal is said plainly; only
 * what is not normal gets named, most important first.
 */
export function statusSummary(
  freshness: Freshness,
  link: BrokerLink,
  telemetry: TelemetryMessage | null,
  zones: readonly ZoneLayout[],
  watering: ReadonlySet<string>,
  /** The device holding a safety limit now (D90): never "Todo bien" under a heat alarm. */
  held: { heat: boolean; frost: boolean } = { heat: false, frost: false },
): StatusSummary {
  const calm = (text: string) => ({ text, attention: false });
  const alert = (text: string) => ({ text, attention: true });
  if (freshness.kind !== 'live' || !telemetry) {
    const text = freshnessText(freshness, link);
    return freshness.kind === 'waiting' ? calm(text) : alert(text);
  }

  const moisture = (zone: ZoneLayout) =>
    telemetry.soil.find((reading) => reading.id === zone.id)?.moisture ?? null;

  const beingWatered = zones.filter((zone) => watering.has(zone.id));
  if (beingWatered.length > 0) return calm(`Regando ${list(beingWatered)}`);

  if (held.heat) return alert('Hace demasiado calor');
  if (held.frost) return alert('Protegido del frío');

  const tank = telemetry.tank.level;
  if (tank !== null && tank <= TANK_EMPTY_LEVEL) return alert('El depósito está vacío');

  const thirsty = zones.filter((zone) => wiltAmount(moisture(zone), zone.threshold) > 0);
  if (thirsty.length > 0) {
    return alert(capitalize(`${list(thirsty)} ${thirsty.length === 1 ? 'tiene' : 'tienen'} sed`));
  }

  const silent = [
    ...zones.filter((zone) => moisture(zone) === null).map(zoneOf),
    ...(tank === null ? ['del depósito'] : []),
    ...(telemetry.air.temp === null ? ['del aire'] : []),
  ];
  if (silent.length === 1) return alert(`El sensor ${silent[0] ?? ''} no responde`);
  if (silent.length > 1) return alert('Hay sensores que no responden');

  if (tank !== null && tank < TANK_LOW_LEVEL) return alert('Queda poca agua en el depósito');
  return calm('Todo bien');
}

/** Just the sentence of {@link statusSummary}. */
export function statusPhrase(...args: Parameters<typeof statusSummary>): string {
  return statusSummary(...args).text;
}
