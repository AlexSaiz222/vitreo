import type { AutomationReason, ConfigRules, WateringRule } from '@vitreo/shared';

import { IN_DEMO } from '../../app/demo.ts';
import type { ConfigStatus } from '../../data/automation.ts';

/**
 * Every automatic action says why (A6, D89), in the same words everywhere:
 * the chart, "Último riego", the dock. Numbers as the device sent them
 * (rounded down, so "33 % < 35 %" is always true as written).
 */
/** A non-breaking space before units: "35 %" never splits across lines. */
const NB = String.fromCharCode(0xa0);

/** Whose forecast: AEMET's, or the demo's simulated sky (D111). */
const FORECAST_BY = IN_DEMO ? 'simulada' : 'de AEMET';
const percent = (value: number) => `${Math.floor(value * 100).toString()}${NB}%`;
const degrees = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const celsius = (value: number) => `${degrees.format(value)}${NB}°C`;
const lux = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const mm = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
/** Wind as people say it: km/h, from m/s. */
export const kmh = (metresPerSecond: number) =>
  `${Math.round(metresPerSecond * 3.6).toString()}${NB}km/h`;

/** "tierra 33 % < 35 %", "28,4 °C > 28 °C", "horario 07:00–21:00". */
export function explainReason(reason: AutomationReason): string {
  switch (reason.kind) {
    case 'soil':
      // Watered before the quiet hours, still above the threshold (D106).
      return reason.evening
        ? `de tarde, tierra ${percent(reason.moisture)}, cerca del ${percent(reason.threshold)}`
        : `tierra ${percent(reason.moisture)} < ${percent(reason.threshold)}`;
    case 'temperature':
      return `${celsius(reason.value)} ${reason.value >= reason.limit ? '≥' : '<'} ${celsius(reason.limit)}`;
    case 'humidity':
      return `humedad ${degrees.format(reason.value)}${NB}% ${reason.value >= reason.limit ? '≥' : '<'} ${degrees.format(reason.limit)}${NB}%`;
    case 'weather': {
      // A10: the hub closed the window because of the weather outside.
      // Measured at the station, or forecast for this hour (A10 follow-up).
      const forecast = reason.from === 'forecast';
      if (reason.cause === 'wind') {
        const what = forecast ? 'viento fuerte previsto' : 'viento fuerte fuera';
        return reason.value === null
          ? what
          : `${what}, ${kmh(reason.value)} ≥ ${kmh(reason.limit)}`;
      }
      const what = reason.cause === 'snow' ? 'nieva fuera' : 'llueve fuera';
      if (forecast || reason.value === null || reason.value === 0) {
        return reason.value === null || reason.value === 0
          ? `${what} (según la previsión ${FORECAST_BY})`
          : `${what} (según la previsión ${FORECAST_BY}, ${mm.format(reason.value)}${NB}mm esta hora)`;
      }
      return `${what}, ${mm.format(reason.value)}${NB}mm en la última hora`;
    }
    case 'light': {
      const window = `${reason.mode === 'sun' ? 'con el sol' : 'horario'} ${reason.from}–${reason.to}`;
      if (reason.lux === null || reason.belowLux === null) return window;
      return `${window}, luz natural ${lux.format(reason.lux)}${NB}lx ${reason.lux < reason.belowLux ? '<' : '≥'} ${lux.format(reason.belowLux)}${NB}lx`;
    }
  }
}

/** "Riego automático · tierra 33 % < 35 %", "Riego de tarde · 43 %, cerca del 40 %" (D106). */
export function explainWatering(reason: AutomationReason | undefined): string {
  if (reason?.kind === 'soil' && reason.evening)
    return `Riego de tarde · ${percent(reason.moisture)}, cerca del ${percent(reason.threshold)}`;
  return reason ? `Riego automático · ${explainReason(reason)}` : 'Riego automático';
}

/** What a change is doing, calmly: never "active" before the device says so. */
export function statusText(
  status: ConfigStatus | null,
  rejected: 'unsupported_version' | 'invalid' | null,
): string | null {
  switch (status) {
    case null:
      return null;
    case 'saving':
      return 'Guardando…';
    case 'pending':
      return 'Pendiente: el invernadero aún no lo ha confirmado.';
    case 'applied':
      return 'Aplicado en el invernadero.';
    case 'rejected':
      return rejected === 'unsupported_version'
        ? 'El invernadero no entiende esta versión de los ajustes: sigue con los anteriores.'
        : 'El invernadero no ha aceptado estos ajustes: sigue con los anteriores.';
    case 'failed':
      return null;
  }
}

/** A number never parts from its unit, nor a time range at its dash, at a line end. */
const NBSP = ' ';
const JOIN = '⁠';

const minutes = (value: number) =>
  value === 0
    ? 'sin pausa'
    : value % 60 === 0
      ? `${(value / 60).toString()}${NBSP}h de pausa`
      : `${value.toString()}${NBSP}min de pausa`;

/** "Riega 5 s por debajo del 35 %, como mucho 2 veces al día, con 1 h de pausa; de noche no (22:00–08:00)." */
export function wateringSummary(rule: WateringRule): string {
  const times = rule.maxPerDay === 1 ? '1 vez' : `${rule.maxPerDay.toString()} veces`;
  const quiet = rule.quiet
    ? `; de noche no (${rule.quiet.from}${JOIN}–${JOIN}${rule.quiet.to})`
    : '';
  return `Riega ${rule.seconds.toString()}${NBSP}s por debajo del ${percent(rule.threshold)}, como mucho ${times} al día, con ${minutes(rule.cooldownMinutes)}${quiet}.`;
}

/** "Ventilador desde 28 °C, ventana desde 31 °C; paran 2 °C por debajo." */
export function ventilationSummary(rules: ConfigRules['ventilation']): string {
  return `Ventilador desde ${celsius(rules.fanAbove)} (o humedad desde ${degrees.format(rules.maxRh)} %), ventana desde ${celsius(rules.windowAbove)}; paran ${celsius(rules.hysteresis)} por debajo.`;
}

/** "De 07:00 a 21:00, solo con poca luz natural." */
export function lightSummary(rules: ConfigRules['light']): string {
  const when =
    rules.mode === 'schedule'
      ? `De ${rules.on} a ${rules.off}`
      : `Del amanecer${offset(rules.sunriseOffset)} al anochecer${offset(rules.sunsetOffset)}`;
  return `${when}${rules.belowLux === null ? '' : ', solo con poca luz natural'}.`;
}

function offset(value: number): string {
  if (value === 0) return '';
  const size =
    Math.abs(value) % 60 === 0
      ? `${(Math.abs(value) / 60).toString()} h`
      : `${Math.abs(value).toString()} min`;
  return value > 0 ? ` + ${size}` : ` − ${size}`;
}
