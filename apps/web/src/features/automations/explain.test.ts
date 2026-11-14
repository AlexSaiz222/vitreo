import { describe, expect, it } from 'vitest';

import {
  explainReason,
  explainWatering,
  lightSummary,
  statusText,
  ventilationSummary,
  wateringSummary,
} from './explain.ts';

/** Units carry a non-breaking space; compared here as plain text. */
/** As read: no-break spaces as spaces, word joiners (invisible) gone. */
const expectText = (actual: string | null) =>
  expect(
    actual
      ?.replaceAll(String.fromCharCode(0xa0), ' ')
      .replaceAll(String.fromCharCode(0x2060), '') ?? null,
  );

describe('explaining automations', () => {
  it('says why a pot was watered', () => {
    expectText(explainWatering({ kind: 'soil', moisture: 0.33, threshold: 0.35 })).toBe(
      'Riego automático · tierra 33 % < 35 %',
    );
    expectText(explainWatering(undefined)).toBe('Riego automático');
  });

  it('says when a pot was watered in the evening, before it crossed overnight (D106)', () => {
    const evening = { kind: 'soil', moisture: 0.43, threshold: 0.4, evening: true } as const;
    expectText(explainWatering(evening)).toBe('Riego de tarde · 43 %, cerca del 40 %');
    expectText(explainReason(evening)).toBe('de tarde, tierra 43 %, cerca del 40 %');
  });

  it('says why the fan, the window or the light switched', () => {
    expectText(explainReason({ kind: 'temperature', value: 28.4, limit: 28 })).toBe(
      '28,4 °C ≥ 28 °C',
    );
    expectText(explainReason({ kind: 'temperature', value: 25.9, limit: 26 })).toBe(
      '25,9 °C < 26 °C',
    );
    expectText(explainReason({ kind: 'humidity', value: 86, limit: 85 })).toBe(
      'humedad 86 % ≥ 85 %',
    );
    expectText(
      explainReason({
        kind: 'light',
        mode: 'sun',
        from: '08:02',
        to: '21:50',
        lux: 1200,
        belowLux: 3000,
      }),
    ).toBe('con el sol 08:02–21:50, luz natural 1200 lx < 3000 lx');
  });

  it('says why the hub closed the window: rain, snow or wind outside (A10)', () => {
    expectText(explainReason({ kind: 'weather', cause: 'rain', value: 0.4, limit: 0.1 })).toBe(
      'llueve fuera, 0,4 mm en la última hora',
    );
    expectText(explainReason({ kind: 'weather', cause: 'rain', value: null, limit: 0.1 })).toBe(
      'llueve fuera (según la previsión de AEMET)',
    );
    expectText(explainReason({ kind: 'weather', cause: 'snow', value: 0, limit: 0.1 })).toBe(
      'nieva fuera (según la previsión de AEMET)',
    );
    expectText(explainReason({ kind: 'weather', cause: 'wind', value: 16, limit: 13.9 })).toBe(
      'viento fuerte fuera, 58 km/h ≥ 50 km/h',
    );
  });

  it('says when the hold came from the forecast, not the station (A10)', () => {
    const forecast = { kind: 'weather', limit: 0.1, from: 'forecast' } as const;
    expectText(explainReason({ ...forecast, cause: 'rain', value: 1.5 })).toBe(
      'llueve fuera (según la previsión de AEMET, 1,5 mm esta hora)',
    );
    expectText(explainReason({ ...forecast, cause: 'wind', value: 16, limit: 13.9 })).toBe(
      'viento fuerte previsto, 58 km/h ≥ 50 km/h',
    );
  });

  it('never pretends a change is active before the greenhouse confirms it', () => {
    expectText(statusText('pending', null)).toBe(
      'Pendiente: el invernadero aún no lo ha confirmado.',
    );
    expectText(statusText('applied', null)).toBe('Aplicado en el invernadero.');
    expectText(statusText('rejected', 'unsupported_version')).toMatch(/no entiende esta versión/);
  });

  it('sums up a rule in one sentence', () => {
    expectText(
      wateringSummary({
        zone: 'basil_01',
        enabled: true,
        threshold: 0.35,
        seconds: 5,
        maxPerDay: 2,
        cooldownMinutes: 60,
        quiet: { from: '22:00', to: '08:00' },
      }),
    ).toBe(
      'Riega 5 s por debajo del 35 %, como mucho 2 veces al día, con 1 h de pausa; de noche no (22:00–08:00).',
    );
    // A line never ends between a number and its unit, nor inside the range.
    const summary = wateringSummary({
      zone: 'basil_01',
      enabled: true,
      threshold: 0.35,
      seconds: 5,
      maxPerDay: 2,
      cooldownMinutes: 60,
      quiet: { from: '22:00', to: '08:00' },
    });
    expect(summary).toContain('5 s');
    expect(summary).toContain('1 h');
    expect(summary).toContain('22:00⁠–⁠08:00');
    expectText(
      ventilationSummary({
        enabled: true,
        fanAbove: 28,
        windowAbove: 31,
        hysteresis: 2,
        maxRh: 85,
      }),
    ).toBe(
      'Ventilador desde 28 °C (o humedad desde 85 %), ventana desde 31 °C; paran 2 °C por debajo.',
    );
    expectText(
      lightSummary({
        enabled: true,
        mode: 'sun',
        sunriseOffset: 0,
        sunsetOffset: 120,
        belowLux: 3000,
      }),
    ).toBe('Del amanecer al anochecer + 2 h, solo con poca luz natural.');
  });
});
