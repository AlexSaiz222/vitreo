import type { TelemetryMessage } from '../mqtt/telemetry.ts';

/**
 * What needs attention, derived from the latest telemetry (docs/06). Pure
 * and language-neutral: the app words it now (A2); the hub will use the same
 * rules for push notifications (A7). Honest: a missing reading is its own
 * warning, never treated as dry or as fine.
 */

/** docs/06: "Avisarme si el depósito baja del 20 %". */
export const TANK_LOW_LEVEL = 0.2;
/** Below this the float switch reads "empty" (same as the firmware). */
export const TANK_EMPTY_LEVEL = 0.05;

export type AlertKind =
  | 'disconnected'
  | 'stale'
  /** A firmware safety limit holding a state (D90): window closed by frost. */
  | 'frost'
  /** A firmware safety limit holding a state: forced ventilation, light off. */
  | 'over_temperature'
  | 'tank_empty'
  | 'tank_low'
  | 'tank_sensor'
  | 'air_sensor'
  | 'light_sensor'
  | 'thirsty'
  | 'soil_sensor';

/** `critical` needs you now; `attention` soon. */
export type AlertSeverity = 'critical' | 'attention';

export interface Alert {
  /** Stable while the situation lasts: `<kind>` or `<kind>:<zone>`. */
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  /** The zone, for warnings about one plant. */
  zone?: string;
  /** The reading behind it, when it helps (°C for frost and heat). */
  value?: number;
}

/** A safety limit the device holds right now (from its events, D90). */
export interface HeldLimit {
  limit: 'frost' | 'over_temperature';
  /** The reading when it triggered, °C. */
  value: number | null;
}

/** How fresh the data is (the app computes it from the link and the clock). */
export type DataFreshness = 'waiting' | 'live' | 'stale' | 'disconnected';

export interface AlertZone {
  id: string;
  /** Soil moisture below which the plant asks for water (0–1). */
  waterBelow: number;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, attention: 1 };

/**
 * Every active warning, most important first (critical, then global before
 * per plant, then in zone order). Without fresh data only the connection is
 * reported: old readings are not turned into new warnings.
 */
export function deriveAlerts(
  freshness: DataFreshness,
  telemetry: TelemetryMessage | null,
  zones: readonly AlertZone[],
  held: readonly HeldLimit[] = [],
): Alert[] {
  if (freshness === 'disconnected') {
    return [{ id: 'disconnected', kind: 'disconnected', severity: 'critical' }];
  }
  if (freshness === 'stale') return [{ id: 'stale', kind: 'stale', severity: 'attention' }];
  if (freshness === 'waiting' || !telemetry) return [];

  const alerts: Alert[] = [];
  // A safety limit holding a state: critical, with the reading (A7, D90).
  for (const { limit, value } of held) {
    const temp = telemetry.air.temp ?? value;
    alerts.push({
      id: limit,
      kind: limit,
      severity: 'critical',
      ...(temp === null ? {} : { value: temp }),
    });
  }
  const tank = telemetry.tank.level;
  if (tank === null) alerts.push({ id: 'tank_sensor', kind: 'tank_sensor', severity: 'attention' });
  else if (tank <= TANK_EMPTY_LEVEL) {
    alerts.push({ id: 'tank_empty', kind: 'tank_empty', severity: 'critical' });
  } else if (tank < TANK_LOW_LEVEL) {
    alerts.push({ id: 'tank_low', kind: 'tank_low', severity: 'attention' });
  }
  if (telemetry.air.temp === null || telemetry.air.rh === null) {
    alerts.push({ id: 'air_sensor', kind: 'air_sensor', severity: 'attention' });
  }
  if (telemetry.light.lux === null) {
    alerts.push({ id: 'light_sensor', kind: 'light_sensor', severity: 'attention' });
  }
  for (const zone of zones) {
    const reading = telemetry.soil.find((soil) => soil.id === zone.id);
    const moisture = reading?.moisture ?? null;
    if (moisture === null) {
      alerts.push({
        id: `soil_sensor:${zone.id}`,
        kind: 'soil_sensor',
        severity: 'attention',
        zone: zone.id,
      });
    } else if (moisture < zone.waterBelow) {
      alerts.push({
        id: `thirsty:${zone.id}`,
        kind: 'thirsty',
        severity: 'attention',
        zone: zone.id,
      });
    }
  }
  // Stable sort: severity first, keeping the order above within each.
  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// ───────────────────────────────────────────── notifications (A7, D76, D91)

/** What a person can switch off in Ajustes › Avisos. */
export const PUSH_TYPES = ['tank', 'safety', 'frost_forecast', 'no_data', 'thirsty'] as const;
export type PushType = (typeof PUSH_TYPES)[number];

/** Quiet hours (local time): only critical warnings sound in them (D76). */
export const QUIET_HOURS = { from: '23:00', to: '08:00' } as const;

/** At most one reminder this often while a warning stays open (D76). */
export const REMINDER_EVERY_MS = 4 * 3_600_000;

export interface PushRule {
  type: PushType;
  /** Rings even in quiet hours. */
  critical: boolean;
  /**
   * How long the warning must last before it is sent: a plant briefly under
   * its threshold is not news; one thirsty and unwatered for hours is.
   */
  afterMs: number;
}

/** Without data for this long (since the last reading), a notification (D76). */
export const NO_DATA_AFTER_MS = 15 * 60_000;
/** A plant thirsty and unwatered this long, a notification (D76). */
export const THIRSTY_AFTER_MS = 3 * 3_600_000;

/**
 * Which of the warnings above become notifications, and when. The same
 * warnings the app shows (`deriveAlerts`): one source of truth, with the
 * hub only adding how long they must last. Broken sensors and automation
 * notices stay in the app (D91).
 */
export const PUSH_RULES: Partial<Record<AlertKind, PushRule>> = {
  tank_empty: { type: 'tank', critical: true, afterMs: 0 },
  tank_low: { type: 'tank', critical: false, afterMs: 0 },
  frost: { type: 'safety', critical: true, afterMs: 0 },
  over_temperature: { type: 'safety', critical: true, afterMs: 0 },
  // Measured from the last reading, not from when the app calls it stale.
  stale: { type: 'no_data', critical: false, afterMs: NO_DATA_AFTER_MS },
  disconnected: { type: 'no_data', critical: false, afterMs: NO_DATA_AFTER_MS },
  thirsty: { type: 'thirsty', critical: false, afterMs: THIRSTY_AFTER_MS },
};

/** One incident per situation: stale and disconnected are the same "no data". */
export function incidentKey(alert: Alert): string {
  return alert.kind === 'stale' || alert.kind === 'disconnected' ? 'no_data' : alert.id;
}
