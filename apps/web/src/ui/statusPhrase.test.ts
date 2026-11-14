import { describe, expect, it } from 'vitest';

import { telemetry } from '../data/testing.ts';
import { withNames, ZONES } from '../scene/zones.ts';
import { statusPhrase } from './statusPhrase.ts';

const T0 = Date.parse('2026-09-30T12:00:00Z');
const live = { kind: 'live' } as const;
const none = new Set<string>();

/** All four zones comfortably moist unless overridden. */
function snapshot(
  moisture: Partial<Record<string, number | null>> = {},
  tank: number | null = 0.7,
) {
  return telemetry(T0, {
    soil: ZONES.map((zone) => ({
      id: zone.id,
      moisture: zone.id in moisture ? (moisture[zone.id] ?? null) : 0.6,
    })),
    tank: { level: tank },
  });
}

const say = (t = snapshot(), watering = none) =>
  statusPhrase(live, 'connected', t, ZONES, watering);

describe('statusPhrase', () => {
  it('calls a plant by the name it was given, without an article', () => {
    const named = withNames(
      ZONES,
      new Map([
        ['basil_01', 'Pepa'],
        ['tomato_01', null],
      ]),
    );
    const sayNamed = (t: ReturnType<typeof snapshot>) =>
      statusPhrase(live, 'connected', t, named, none);
    expect(sayNamed(snapshot({ basil_01: 0.2 }))).toBe('Pepa tiene sed');
    expect(sayNamed(snapshot({ basil_01: 0.2, tomato_01: 0.1 }))).toBe(
      'Pepa y el tomate cherry tienen sed',
    );
    expect(sayNamed(snapshot({ basil_01: null }))).toBe('El sensor de Pepa no responde');
  });

  it('says "Todo bien" when all is well, never "En directo"', () => {
    expect(say()).toBe('Todo bien');
  });

  it('names one thirsty plant with its article', () => {
    expect(say(snapshot({ basil_01: 0.2 }))).toBe('La albahaca tiene sed');
  });

  it('lists several thirsty plants', () => {
    expect(say(snapshot({ basil_01: 0.2, parsley_01: 0.1 }))).toBe(
      'La albahaca y el perejil tienen sed',
    );
    expect(say(snapshot({ basil_01: 0.2, parsley_01: 0.1, strawberry_01: 0.1 }))).toBe(
      'La albahaca, el perejil y la fresa tienen sed',
    );
  });

  it('puts watering first, then an empty tank', () => {
    expect(say(snapshot({ basil_01: 0.2 }, 0.02), new Set(['basil_01']))).toBe(
      'Regando la albahaca',
    );
    expect(say(snapshot({ basil_01: 0.2 }, 0.02))).toBe('El depósito está vacío');
  });

  it('mentions sensors that do not answer', () => {
    expect(say(snapshot({ lettuce_01: null }))).toBe('El sensor de la lechuga no responde');
    // "del", never "de el".
    expect(say(snapshot({ parsley_01: null }))).toBe('El sensor del perejil no responde');
    expect(say(snapshot({}, null))).toBe('El sensor del depósito no responde');
    expect(say(snapshot({ lettuce_01: null }, null))).toBe('Hay sensores que no responden');
  });

  it('warns calmly about a low tank', () => {
    expect(say(snapshot({}, 0.15))).toBe('Queda poca agua en el depósito');
  });

  it('falls back to freshness when the data is not live', () => {
    const since = new Date('2026-09-30T14:10:00').getTime();
    expect(
      statusPhrase(
        { kind: 'disconnected', reason: 'device', since },
        'connected',
        snapshot(),
        ZONES,
        none,
      ),
    ).toBe('Desconectado desde las 14:10');
    expect(statusPhrase({ kind: 'waiting' }, 'connected', null, ZONES, none)).toBe(
      'Esperando datos del invernadero…',
    );
  });

  it('never says all is well while the device holds a safety limit (D90)', () => {
    const t = telemetry(T0);
    const held = (heat: boolean, frost: boolean) =>
      statusPhrase(live, 'connected', t, ZONES, none, { heat, frost });
    expect(held(true, false)).toBe('Hace demasiado calor');
    expect(held(false, true)).toBe('Protegido del frío');
  });
});
