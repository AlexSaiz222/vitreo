import type { Freshness } from '../data/selectors.ts';
import type { SafetyLimit } from '@vitreo/shared';

import { wateringElapsedMs } from '../data/store.ts';
import type { ActiveWatering, BrokerLink, CommandEntry } from '../data/store.ts';

const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const percent = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 });

export const formatTime = (ms: number) => time.format(ms);
/** Whole degrees everywhere (docs/03): "22°". */
export const formatTemperature = (celsius: number | null) =>
  celsius === null ? '—' : `${(Math.round(celsius) || 0).toString()}°`;
/** Relative humidity given in % (0–100). */
/** "4,2 °C": one decimal, a non-breaking space (frost, D90). */
const oneDecimal = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
export const formatDegrees = (celsius: number) =>
  `${oneDecimal.format(celsius)}${String.fromCharCode(0xa0)}°C`;

export const formatHumidity = (rh: number | null) => (rh === null ? '—' : percent.format(rh / 100));
/** A 0–1 fraction, such as soil moisture. */
export const formatFraction = (value: number | null) =>
  value === null ? 'sin lectura' : percent.format(value);

/** One calm, human sentence about how fresh the data is (docs/03, docs/06). */
export function freshnessText(freshness: Freshness, link: BrokerLink): string {
  switch (freshness.kind) {
    case 'live':
      return 'En directo';
    case 'waiting':
      return 'Esperando datos del invernadero…';
    case 'stale':
      return `Datos de las ${formatTime(freshness.since)}`;
    case 'disconnected': {
      if (link === 'unconfigured') return 'Conexión sin configurar';
      const since = freshness.since === null ? '' : ` desde las ${formatTime(freshness.since)}`;
      return freshness.reason === 'device' ? `Desconectado${since}` : `Sin conexión${since}`;
    }
  }
}

const REASONS: Record<NonNullable<CommandEntry['reason']>, string> = {
  tank_empty: 'Sin agua en el depósito',
  safety_limit: 'Bloqueado por seguridad',
  busy: 'Ya está regando',
  invalid: 'Orden no válida',
  offline: 'Sin conexión',
};

/** Each safety limit, in words (D85): never just "blocked". */
export const LIMITS: Record<SafetyLimit, string> = {
  pump_max_per_command: 'Límite de riego por vez',
  pump_max_per_hour: 'Límite de riego por hora (60 s)',
  tank_empty: 'Sin agua en el depósito',
  tank_unknown: 'No se sabe cuánta agua queda: no se riega',
  sensor_failure: 'Falla un sensor que hace falta',
  over_temperature: 'Hace demasiado calor: bloqueado por seguridad',
  frost: 'Hace demasiado frío: ventana cerrada y ventilador parado',
  connection_lost: 'Se perdió la conexión',
};

/**
 * Why an order was refused and, if it is temporary, until when (D85):
 * "Límite de riego por hora (60 s) · vuelve a las 11:32".
 */
export function refusalText(entry: CommandEntry, now: number): string | null {
  if (entry.status !== 'rejected') return null;
  const recent = entry.settledAt !== null && now - entry.settledAt <= RESULT_VISIBLE_MS;
  if (!recent && blockedUntil(entry, now) === null) return null;
  const why = entry.limit ? LIMITS[entry.limit] : entry.reason ? REASONS[entry.reason] : null;
  if (!why) return null;
  return entry.retryAt !== null && entry.retryAt > now
    ? `${why} · vuelve a las ${formatTime(entry.retryAt)}`
    : why;
}

/** Still blocked by a temporary limit (D85). */
export function blockedUntil(entry: CommandEntry | null, now: number): number | null {
  return entry?.status === 'rejected' && entry.retryAt !== null && entry.retryAt > now
    ? entry.retryAt
    : null;
}

/** How long a result stays visible after it settles. */
export const RESULT_VISIBLE_MS = 8_000;

/**
 * The outcome of a command, in words, or `null` when there is nothing to say.
 * A confirmed command says nothing: the scene and the data already show it.
 * An unconfirmed one stays visible until it is retried or answered.
 */
export function commandText(entry: CommandEntry | null, now: number): string | null {
  if (!entry) return null;
  if (entry.status === 'pending') return 'Enviando…';
  if (entry.status === 'timeout') return 'Sin confirmación';
  if (entry.settledAt === null || now - entry.settledAt > RESULT_VISIBLE_MS) return null;
  if (entry.status === 'confirmed') return null;
  return entry.reason ? REASONS[entry.reason] : 'No se pudo hacer';
}

/** The state of a zone's watering, in words, or `null` when there is nothing to say. */
export function wateringText(
  entry: CommandEntry | null,
  watering: ActiveWatering | undefined,
  now: number,
): string | null {
  if (watering) {
    const remaining = Math.max(
      0,
      Math.ceil((watering.seconds * 1000 - wateringElapsedMs(watering, now)) / 1000),
    );
    // It may stay on screen a moment once its seconds are over (the last ack).
    return remaining > 0 ? `Regando · ${remaining.toString()} s` : 'Regando';
  }
  // Blocked for a while: say until when, for as long as it lasts (the
  // reason goes below the button).
  const until = blockedUntil(entry, now);
  if (until !== null) return `Disponible a las ${formatTime(until)}`;
  const text = commandText(entry, now);
  if (!text || entry?.reason !== 'safety_limit') return text;
  return entry.limit ? LIMITS[entry.limit] : 'Bloqueado por seguridad';
}

/** How a plant is doing, in one short sentence (docs/03). */
export function plantMood(moisture: number | null, thirsty: boolean): string {
  if (moisture === null) return 'Sin lectura de humedad';
  if (thirsty) return 'Tiene sed';
  if (moisture > 0.85) return 'Tierra muy húmeda';
  return 'Está bien';
}

const dayTime = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** "hoy a las 14:10", or the weekday and time for older moments. */
export function formatWhen(ms: number, now: number): string {
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  return sameDay ? `hoy a las ${formatTime(ms)}` : dayTime.format(ms);
}

/**
 * What Vitreo is following, honestly (A3): the simulator reports a firmware
 * version ending in "-sim"; anything else is a real device. `null` until
 * the first telemetry says.
 */
export function deviceKind(fw: string | undefined): 'simulator' | 'device' | null {
  if (fw === undefined) return null;
  return fw.endsWith('-sim') ? 'simulator' : 'device';
}
