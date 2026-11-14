import { describe, expect, it } from 'vitest';

import type { CommandEntry } from '../data/store.ts';
import {
  commandText,
  refusalText,
  formatFraction,
  formatWhen,
  plantMood,
  formatHumidity,
  formatTemperature,
  freshnessText,
  wateringText,
} from './format.ts';

const at = (hhmm: string) => new Date(`2026-09-30T${hhmm}:00`).getTime();

describe('number formatting (es-ES)', () => {
  it('formats temperature in whole degrees', () => {
    expect(formatTemperature(22.4)).toBe('22°');
    expect(formatTemperature(22.6)).toBe('23°');
    expect(formatTemperature(-0.3)).toBe('0°');
    expect(formatTemperature(null)).toBe('—');
  });

  it('formats percentages the Spanish way', () => {
    expect(formatHumidity(64.1).replace(/\s/u, ' ')).toBe('64 %');
    expect(formatFraction(0.42).replace(/\s/u, ' ')).toBe('42 %');
    expect(formatFraction(null)).toBe('sin lectura');
  });
});

describe('freshnessText', () => {
  it('says calmly how fresh the data is', () => {
    expect(freshnessText({ kind: 'live' }, 'connected')).toBe('En directo');
    expect(freshnessText({ kind: 'stale', since: at('14:10') }, 'connected')).toBe(
      'Datos de las 14:10',
    );
    expect(
      freshnessText({ kind: 'disconnected', reason: 'device', since: at('14:10') }, 'connected'),
    ).toBe('Desconectado desde las 14:10');
    expect(
      freshnessText({ kind: 'disconnected', reason: 'broker', since: null }, 'reconnecting'),
    ).toBe('Sin conexión');
    expect(
      freshnessText({ kind: 'disconnected', reason: 'broker', since: null }, 'unconfigured'),
    ).toBe('Conexión sin configurar');
  });
});

describe('wateringText', () => {
  const now = at('12:00');
  const entry = (overrides: Partial<CommandEntry>): CommandEntry => ({
    command: {
      v: 1,
      requestId: 'r',
      source: 'user',
      action: 'water',
      zone: 'basil_01',
      seconds: 5,
    },
    status: 'pending',
    attempts: 1,
    sentAt: now,
    settledAt: null,
    reason: null,
    limit: null,
    retryAt: null,
    ...overrides,
  });

  it('counts down while watering', () => {
    expect(wateringText(null, { seconds: 5, startedAt: now - 1200, shownAt: 0 }, now)).toBe(
      'Regando · 4 s',
    );
  });

  it('shows sending, rejections and timeouts', () => {
    expect(wateringText(entry({}), undefined, now)).toBe('Enviando…');
    expect(
      wateringText(
        entry({ status: 'rejected', reason: 'tank_empty', settledAt: now }),
        undefined,
        now,
      ),
    ).toBe('Sin agua en el depósito');
    expect(wateringText(entry({ status: 'timeout', settledAt: now }), undefined, now)).toBe(
      'Sin confirmación',
    );
  });

  it('says which limit and until when, for as long as it lasts (D85)', () => {
    const blocked = entry({
      status: 'rejected',
      reason: 'safety_limit',
      limit: 'pump_max_per_hour',
      retryAt: at('12:42'),
      settledAt: now,
    });
    const later = at('12:30');
    expect(wateringText(blocked, undefined, later)).toBe('Disponible a las 12:42');
    expect(refusalText(blocked, later)).toBe(
      'Límite de riego por hora (60 s) · vuelve a las 12:42',
    );
    expect(wateringText(blocked, undefined, at('12:43'))).toBeNull();
    expect(refusalText(blocked, at('12:43'))).toBeNull();
    const unknownTank = entry({
      status: 'rejected',
      reason: 'safety_limit',
      limit: 'tank_unknown',
      settledAt: now,
    });
    expect(wateringText(unknownTank, undefined, now)).toBe(
      'No se sabe cuánta agua queda: no se riega',
    );
  });

  it('lets results fade after a while, but keeps an unconfirmed order visible', () => {
    const later = now + 60_000;
    expect(
      wateringText(entry({ status: 'rejected', reason: 'busy', settledAt: now }), undefined, later),
    ).toBeNull();
    expect(wateringText(entry({ status: 'timeout', settledAt: now }), undefined, later)).toBe(
      'Sin confirmación',
    );
    expect(wateringText(entry({ status: 'confirmed', settledAt: now }), undefined, now)).toBeNull();
  });
});

describe('commandText', () => {
  const now = at('12:00');
  const base: CommandEntry = {
    command: { v: 1, requestId: 'r', source: 'user', action: 'growLight', on: true },
    status: 'pending',
    attempts: 1,
    sentAt: now,
    settledAt: null,
    reason: null,
    limit: null,
    retryAt: null,
  };

  it('explains a light blocked by safety', () => {
    expect(
      commandText({ ...base, status: 'rejected', reason: 'safety_limit', settledAt: now }, now),
    ).toBe('Bloqueado por seguridad');
  });

  it('says nothing once confirmed', () => {
    expect(commandText({ ...base, status: 'confirmed', settledAt: now }, now)).toBeNull();
  });
});

describe('plantMood and formatWhen', () => {
  it('describes the plant in one short sentence', () => {
    expect(plantMood(null, false)).toBe('Sin lectura de humedad');
    expect(plantMood(0.2, true)).toBe('Tiene sed');
    expect(plantMood(0.9, false)).toBe('Tierra muy húmeda');
    expect(plantMood(0.5, false)).toBe('Está bien');
  });

  it('says today when it is today', () => {
    expect(formatWhen(at('09:15'), at('12:00'))).toBe('hoy a las 09:15');
  });
});
