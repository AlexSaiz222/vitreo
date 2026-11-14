import {
  CONFIG_VERSION,
  configMessage,
  GREENHOUSE_ZONES,
  roundLocation,
  SPECIES,
} from '@vitreo/shared';
import type { ConfigMessage, ConfigUpdate, Location } from '@vitreo/shared';

import type { HubDatabase } from './db/types.ts';
import { currentConfig, latestConfigRev, saveConfig } from './db/store.ts';

/**
 * POSIX TZ strings for the device's `HH:MM` schedules (docs/05), from the
 * hub's IANA zone. A few common ones; an unknown zone falls back to UTC and
 * the hub logs it (set HUB_TZ to one of these, or extend the table).
 */
const POSIX_TZ: Record<string, string> = {
  'Europe/Madrid': 'CET-1CEST,M3.5.0,M10.5.0/3',
  'Europe/Paris': 'CET-1CEST,M3.5.0,M10.5.0/3',
  'Europe/Berlin': 'CET-1CEST,M3.5.0,M10.5.0/3',
  'Europe/Lisbon': 'WET0WEST,M3.5.0/1,M10.5.0',
  'Europe/London': 'GMT0BST,M3.5.0/1,M10.5.0',
  'Atlantic/Canary': 'WET0WEST,M3.5.0/1,M10.5.0',
  UTC: 'UTC0',
};

export function posixTimeZone(timeZone: string): string | null {
  return POSIX_TZ[timeZone] ?? null;
}

/**
 * The rules a new greenhouse starts with (A4, A6; D87, D89): every
 * automation OFF, each pot with its species' proposal (docs/08: threshold,
 * seconds, waterings a day), an hour's pause after watering and quiet
 * nights; the light from 07:00 to 21:00 when daylight is weak; the fan above
 * 28 °C and the window too above 31 °C, 2 °C of hysteresis. Safety limits
 * are not here: they are firmware constants (D22).
 */
export function defaultRules(): ConfigUpdate {
  return {
    watering: GREENHOUSE_ZONES.map((zone) => ({
      zone: zone.id,
      enabled: false,
      threshold: SPECIES[zone.kind].waterBelow,
      seconds: SPECIES[zone.kind].water.seconds,
      maxPerDay: SPECIES[zone.kind].water.maxPerDay,
      cooldownMinutes: 60,
      quiet: { from: '22:00', to: '08:00' },
    })),
    light: {
      enabled: false,
      mode: 'schedule',
      on: '07:00',
      off: '21:00',
      belowLux: 3000,
    },
    ventilation: { enabled: false, fanAbove: 28, windowAbove: 31, hysteresis: 2, maxRh: 85 },
  };
}

export type Publish = (config: ConfigMessage) => void;

export interface ConfigOwnerOptions {
  timeZone: string;
  /** Where the greenhouse is now (Ajustes › Ubicación), for the light by the sun. */
  location: () => Location | null;
  publish: Publish;
}

/**
 * The hub owns `config` (D73): it keeps every revision and publishes the
 * current one, retained. On start: its own latest; a newer one found
 * retained on the broker is adopted (nothing is lost); a stored config of an
 * older version (v1) is replaced by a v2 revision with the same intent;
 * the first time, the default.
 */
export class ConfigOwner {
  constructor(
    private readonly db: HubDatabase,
    private readonly device: string,
    private readonly options: ConfigOwnerOptions,
  ) {}

  /** A full message from rules, with the next revision, time zone and location. */
  private build(rules: ConfigUpdate, now: number): ConfigMessage {
    const location = this.options.location();
    return configMessage.parse({
      ...rules,
      v: CONFIG_VERSION,
      rev: (latestConfigRev(this.db, this.device) ?? 0) + 1,
      ts: Math.floor(now / 1000),
      tz: posixTimeZone(this.options.timeZone) ?? 'UTC0',
      location: location ? roundLocation(location) : null,
      // Light by the sun needs a place: without one, it falls back to the clock.
      ...(rules.light.mode === 'sun' && !location
        ? { light: { ...defaultRules().light, enabled: rules.light.enabled } }
        : {}),
    });
  }

  /** The current config, creating (or upgrading to v2) the first time. */
  current(now: number): ConfigMessage {
    const stored = currentConfig(this.db, this.device);
    const valid = stored ? configMessage.safeParse(stored.config) : null;
    if (valid?.success) return valid.data;
    // None yet, or an older version: a new revision with the default rules
    // (every automation was off in v1, so nothing the person chose is lost).
    const next = this.build(defaultRules(), now);
    saveConfig(this.db, this.device, next, 'default');
    return next;
  }

  /** A config seen retained on the broker: adopted if newer than ours. */
  adopt(retained: ConfigMessage): boolean {
    const latest = latestConfigRev(this.db, this.device);
    if (latest !== null && latest >= retained.rev) return false;
    saveConfig(this.db, this.device, retained, 'adopted');
    return true;
  }

  /** (Re)publishes the current config, retained (start and reconnect). */
  announce(now: number): ConfigMessage {
    const config = this.current(now);
    this.publish(config);
    return config;
  }

  /** New rules from the API: validated, stored as a new revision, published. */
  update(rules: ConfigUpdate, now: number): ConfigMessage {
    this.current(now);
    const next = this.build(rules, now);
    saveConfig(this.db, this.device, next, 'api');
    this.publish(next);
    return next;
  }

  /** The location changed (Ajustes › Ubicación): a new revision carries it. */
  relocate(now: number): ConfigMessage {
    const { watering, light, ventilation } = this.current(now);
    return this.update({ watering, light, ventilation }, now);
  }

  private publish(config: ConfigMessage): void {
    this.options.publish(config);
  }
}
