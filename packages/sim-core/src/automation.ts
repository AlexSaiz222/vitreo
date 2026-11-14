import { localTime, minutesOf, parsePosixTz, sunTimes, timeOf, withinWindow } from '@vitreo/shared';
import type { AutomationReason, ConfigMessage, PosixTz, WateringRule } from '@vitreo/shared';

/**
 * The basic rules of `config`, as the firmware runs them (A6, D73, D89).
 * Pure decisions from readings and time; the greenhouse model carries them
 * out through the same safety limits as any order (D22), which always win.
 *
 * - Watering, per pot: below its threshold, outside its quiet hours, under
 *   its daily maximum, and not within its cooldown after the last automatic
 *   watering (the soil is still absorbing). One pot at a time.
 * - Evening watering (D106): in the half hour before a pot's quiet hours,
 *   a pot less than 5 points above its threshold is watered if, drying as
 *   fast as it has over the last hours, it would cross before they end. Same
 *   daily maximum and cooldown; the pots below their threshold go first.
 * - Ventilation, edge-triggered with hysteresis: the fan when the air passes
 *   `fanAbove` (or `maxRh`), the window too above `windowAbove`; each stops
 *   `hysteresis` °C below (5 % for humidity). A manual change stays until the
 *   next crossing. For humidity only while the air is at 10 °C or more (it
 *   stops below 9 °C): a fan on a cold night only cools the greenhouse
 *   towards frost (D105).
 * - The grow light: on inside its window (by the clock, or sunrise to sunset
 *   with offsets) while daylight is below `belowLux`; it switches only when
 *   that changes, so a manual switch stays until then. Daylight is the
 *   reading less the lamp's own light, measured each time it comes on (the
 *   sensor sees the lamp too), and two automatic switches are at least 15
 *   minutes apart, except to switch off at the end of the window: it never
 *   flickers, even if that measurement is off (D105).
 *
 * Firmware notes (phase 5): it needs NTP time and the POSIX TZ string; the
 * sunrise equation is `sunTimes` in packages/shared/src/time.
 */

export interface Readings {
  /** Unix s. */
  now: number;
  /** The grow light is on now (by the automation or by hand). */
  growLight: boolean;
  moisture: ReadonlyMap<string, number | null>;
  temp: number | null;
  rh: number | null;
  lux: number | null;
  /** The pump is running (one watering at a time). */
  pumping: boolean;
}

export interface AutomationMemory {
  /** Unix s, per pot. */
  lastWatering: Record<string, number>;
  /** Automatic waterings per pot on `day` (local date). */
  counts: { day: string; perZone: Record<string, number> };
}

export type Decision =
  | { kind: 'water'; zone: string; seconds: number; reason: AutomationReason }
  | { kind: 'fan'; on: boolean; reason: AutomationReason }
  | { kind: 'vent'; open: number; reason: AutomationReason }
  | { kind: 'light'; on: boolean; reason: AutomationReason };

/** Daylight must pass `belowLux` by this factor to switch the light off again. */
const LUX_HYSTERESIS = 1.5;
/** Humidity must drop this much under `maxRh` to stop the fan. */
const RH_HYSTERESIS = 5;
/** A watering the safety limits refused is not retried for this long. */
const REFUSED_PAUSE_S = 10 * 60;
/** Below this the fan does not run for humidity, and it stops 1 °C lower (D105). */
export const HUMID_FAN_MIN_C = 10;
/** Two automatic switches of the grow light are at least this far apart (D105). */
export const LIGHT_MIN_SWITCH_S = 15 * 60;
/** Evening watering (D106): this long before the quiet hours, this close to the threshold. */
export const EVENING_LEAD_MIN = 30;
export const EVENING_MARGIN = 0.05;
/**
 * How fast a pot dries: its readings averaged per half hour, over the last
 * two hours (at least one), so the sensor's noise does not count as drying.
 */
const TREND_BIN_S = 30 * 60;
const TREND_BINS = 5;

export interface AutomationOptions {
  /** On unless said otherwise; off only to compare a week without it (week.test.ts). */
  eveningWatering?: boolean;
}

export class Automation {
  private config: ConfigMessage | null = null;
  private tz: PosixTz | null = null;
  /** Last automatic watering (or refused attempt) per pot, Unix s. */
  private readonly lastWatering = new Map<string, number>();
  private counts = { day: '', perZone: new Map<string, number>() };
  private cooling = false;
  private humid = false;
  /** Switched off by hand: not again until the air has come back below the limit. */
  private fanReleased = false;
  private venting = false;
  /** The light as the automation last set it; null = decide afresh. */
  private lightOn: boolean | null = null;
  /** When the automation last switched the light, Unix s. */
  private lightSwitchedAt: number | null = null;
  /** The last reading with the lamp off, and how much the lamp adds (lux). */
  private luxWithoutLamp: number | null = null;
  private lampLux = 0;
  private lampWasOn = false;
  /** Per pot, its readings summed per half hour since its last watering. */
  private readonly trend = new Map<string, { bin: number; sum: number; n: number }[]>();

  constructor(private readonly options: AutomationOptions = {}) {}

  get rev(): number | null {
    return this.config?.rev ?? null;
  }

  /**
   * What it must not forget over a restart (D100): when each pot was last
   * watered and how many times today, so restarting never adds waterings.
   */
  memory(): AutomationMemory {
    return {
      lastWatering: Object.fromEntries(this.lastWatering),
      counts: { day: this.counts.day, perZone: Object.fromEntries(this.counts.perZone) },
    };
  }

  restore(memory: AutomationMemory): void {
    for (const [zone, at] of Object.entries(memory.lastWatering)) this.lastWatering.set(zone, at);
    this.counts = {
      day: memory.counts.day,
      perZone: new Map(Object.entries(memory.counts.perZone)),
    };
  }

  /** A validated config. Returns false if its time zone cannot be read. */
  apply(config: ConfigMessage): boolean {
    const tz = parsePosixTz(config.tz);
    if (!tz) return false;
    this.config = config;
    this.tz = tz;
    // The light is decided afresh: turning the automation on takes it over.
    this.lightOn = null;
    if (!config.ventilation.enabled) {
      this.cooling = false;
      this.humid = false;
      this.venting = false;
    }
    return true;
  }

  /** What the ventilation automation holds on now (the model shows it). */
  holds(): { fan: boolean; vent: boolean } {
    return { fan: this.cooling || this.humid, vent: this.venting };
  }

  /**
   * Why the rules want the window open now, or null: after an outdoor hold
   * (A10) the window opens again if it is still warm.
   */
  ventReason(temp: number | null): AutomationReason | null {
    const v = this.config?.ventilation;
    if (!v?.enabled || !this.venting || temp === null) return null;
    return { kind: 'temperature', value: round1(temp), limit: v.windowAbove };
  }

  /** The model carried out (or the safety limits refused) a watering. */
  watered(zone: string, now: number, done: boolean): void {
    this.lastWatering.set(zone, done ? now : now - this.cooldownOf(zone) + REFUSED_PAUSE_S);
    if (!done) return;
    this.counts.perZone.set(zone, (this.counts.perZone.get(zone) ?? 0) + 1);
    // Watered, it no longer dries as it did.
    this.trend.delete(zone);
  }

  /** The person switched the fan off: the automation lets go until the next crossing. */
  releaseFan(): void {
    this.fanReleased = this.cooling || this.humid;
    this.cooling = false;
    this.humid = false;
  }

  private cooldownOf(zone: string): number {
    const rule = this.config?.watering.find((r) => r.zone === zone);
    return (rule?.cooldownMinutes ?? 0) * 60;
  }

  decide(readings: Readings): Decision[] {
    const config = this.config;
    const tz = this.tz;
    if (!config || !tz) return [];
    const local = localTime(tz, readings.now);
    if (local.day !== this.counts.day) this.counts = { day: local.day, perZone: new Map() };
    this.track(readings);
    return [
      ...this.watering(config, readings, local.minutes),
      ...this.ventilation(config, readings),
      ...this.light(config, tz, readings, local.minutes),
    ];
  }

  private watering(config: ConfigMessage, r: Readings, minutes: number): Decision[] {
    if (r.pumping) return [];
    const allowed = (rule: WateringRule) => {
      if ((this.counts.perZone.get(rule.zone) ?? 0) >= rule.maxPerDay) return false;
      const last = this.lastWatering.get(rule.zone);
      return last === undefined || r.now - last >= rule.cooldownMinutes * 60;
    };
    const water = (rule: WateringRule, moisture: number, evening: boolean): Decision[] => [
      {
        kind: 'water',
        zone: rule.zone,
        seconds: rule.seconds,
        reason: {
          kind: 'soil',
          moisture: round2(moisture),
          threshold: rule.threshold,
          ...(evening && { evening: true }),
        },
      },
    ];
    // One pot at a time: the next one on a later tick.
    for (const rule of config.watering) {
      const moisture = r.moisture.get(rule.zone) ?? null;
      if (!rule.enabled || moisture === null || moisture >= rule.threshold) continue;
      if (rule.quiet && withinWindow(minutes, minutesOf(rule.quiet.from), minutesOf(rule.quiet.to)))
        continue;
      if (allowed(rule)) return water(rule, moisture, false);
    }
    if (this.options.eveningWatering === false) return [];
    for (const rule of config.watering) {
      const moisture = r.moisture.get(rule.zone) ?? null;
      if (!rule.enabled || moisture === null) continue;
      if (this.crossesOvernight(rule, moisture, minutes) && allowed(rule))
        return water(rule, moisture, true);
    }
    return [];
  }

  /**
   * In the half hour before the pot's quiet hours, close above its threshold
   * and drying fast enough to cross before they end (D106). Drying is taken
   * as steady, which overestimates it at night (no sun, cooler air): when in
   * doubt, it waters. Without a known pace (under an hour of readings since
   * the last watering or a restart), it does not.
   */
  private crossesOvernight(rule: WateringRule, moisture: number, minutes: number): boolean {
    if (!rule.quiet || moisture < rule.threshold || moisture >= rule.threshold + EVENING_MARGIN)
      return false;
    const from = minutesOf(rule.quiet.from);
    const to = minutesOf(rule.quiet.to);
    if (from === to || !withinWindow(minutes, (from - EVENING_LEAD_MIN + 1440) % 1440, from))
      return false;
    const rate = this.dryingRate(rule.zone);
    if (rate === null || rate <= 0) return false;
    const untilMorning = ((((to - minutes) % 1440) + 1440) % 1440) * 60;
    return moisture - rate * untilMorning < rule.threshold;
  }

  /** Every reading counts towards its pot's half hour. */
  private track(r: Readings): void {
    const bin = Math.floor(r.now / TREND_BIN_S);
    for (const [zone, moisture] of r.moisture) {
      if (moisture === null) continue;
      const bins = this.trend.get(zone) ?? [];
      const current = bins.at(-1);
      if (current?.bin === bin) {
        current.sum += moisture;
        current.n += 1;
      } else {
        bins.push({ bin, sum: moisture, n: 1 });
        if (bins.length > TREND_BINS) bins.shift();
      }
      this.trend.set(zone, bins);
    }
  }

  /** How fast the pot dries, fraction per second, from its finished half hours; null if unknown. */
  private dryingRate(zone: string): number | null {
    const finished = (this.trend.get(zone) ?? []).slice(0, -1);
    const first = finished[0];
    const last = finished.at(-1);
    if (!first || !last || last.bin - first.bin < 2) return null;
    return (first.sum / first.n - last.sum / last.n) / ((last.bin - first.bin) * TREND_BIN_S);
  }

  private ventilation(config: ConfigMessage, r: Readings): Decision[] {
    const v = config.ventilation;
    if (!v.enabled) return [];
    const decisions: Decision[] = [];
    const fanWas = this.cooling || this.humid;
    let fanReason: AutomationReason | null = null;
    // Re-armed once the air is back under both limits (minus hysteresis).
    if (
      this.fanReleased &&
      (r.temp === null || r.temp < v.fanAbove - v.hysteresis) &&
      (r.rh === null || r.rh < v.maxRh - RH_HYSTERESIS)
    ) {
      this.fanReleased = false;
    }
    if (r.temp !== null) {
      const value = round1(r.temp);
      if (!this.cooling && !this.fanReleased && r.temp >= v.fanAbove) {
        this.cooling = true;
        fanReason = { kind: 'temperature', value, limit: v.fanAbove };
      } else if (this.cooling && r.temp < v.fanAbove - v.hysteresis) {
        this.cooling = false;
        fanReason = { kind: 'temperature', value, limit: v.fanAbove - v.hysteresis };
      }
      if (!this.venting && r.temp >= v.windowAbove) {
        this.venting = true;
        decisions.push({
          kind: 'vent',
          open: 1,
          reason: { kind: 'temperature', value, limit: v.windowAbove },
        });
      } else if (this.venting && r.temp < v.windowAbove - v.hysteresis) {
        this.venting = false;
        decisions.push({
          kind: 'vent',
          open: 0,
          reason: { kind: 'temperature', value, limit: v.windowAbove - v.hysteresis },
        });
      }
    }
    if (r.rh !== null) {
      const value = round1(r.rh);
      // Not on a cold night (D105); an unknown temperature counts as cold.
      const warm = r.temp !== null && r.temp >= HUMID_FAN_MIN_C;
      const cold = r.temp === null || r.temp < HUMID_FAN_MIN_C - 1;
      if (!this.humid && !this.fanReleased && warm && r.rh >= v.maxRh) {
        this.humid = true;
        fanReason ??= { kind: 'humidity', value, limit: v.maxRh };
      } else if (this.humid && r.rh < v.maxRh - RH_HYSTERESIS) {
        this.humid = false;
        fanReason ??= { kind: 'humidity', value, limit: v.maxRh - RH_HYSTERESIS };
      } else if (this.humid && cold) {
        this.humid = false;
        fanReason ??= {
          kind: 'temperature',
          value: r.temp === null ? value : round1(r.temp),
          limit: HUMID_FAN_MIN_C - 1,
        };
      }
    }
    const fanNow = this.cooling || this.humid;
    if (fanNow !== fanWas && fanReason)
      decisions.unshift({ kind: 'fan', on: fanNow, reason: fanReason });
    return decisions;
  }

  /** The light's window today, local minutes, or null if the sun does not rise or set. */
  lightWindow(
    config: ConfigMessage,
    tz: PosixTz,
    now: number,
  ): { from: number; to: number } | null {
    const light = config.light;
    if (light.mode === 'schedule') return { from: minutesOf(light.on), to: minutesOf(light.off) };
    if (!config.location) return null;
    const sun = sunTimes(now, config.location.lat, config.location.lng);
    if (!sun) return null;
    return {
      from: localTime(tz, sun.sunrise).minutes + light.sunriseOffset,
      to: localTime(tz, sun.sunset).minutes + light.sunsetOffset,
    };
  }

  private light(config: ConfigMessage, tz: PosixTz, r: Readings, minutes: number): Decision[] {
    const light = config.light;
    if (!light.enabled) {
      this.lightOn = null;
      return [];
    }
    const window = this.lightWindow(config, tz, r.now);
    const inside =
      window !== null &&
      withinWindow(
        minutes,
        ((window.from % 1440) + 1440) % 1440,
        ((window.to % 1440) + 1440) % 1440,
      );
    // The lamp's own light: what it added when it came on (D105).
    if (r.lux !== null) {
      if (r.growLight && !this.lampWasOn && this.luxWithoutLamp !== null) {
        this.lampLux = Math.max(0, r.lux - this.luxWithoutLamp);
      }
      if (!r.growLight) this.luxWithoutLamp = r.lux;
    }
    this.lampWasOn = r.growLight;
    const daylight = r.lux === null ? null : Math.max(0, r.lux - (r.growLight ? this.lampLux : 0));
    // Daylight: a broken light sensor leaves only the window to decide.
    const limit = light.belowLux;
    const dark =
      limit === null || daylight === null
        ? true
        : this.lightOn === true
          ? daylight < limit * LUX_HYSTERESIS
          : daylight < limit;
    const want = inside && dark;
    if (want === this.lightOn) return [];
    // Never two automatic switches within 15 minutes, except leaving the window.
    const leaving = !inside && r.growLight;
    if (
      !leaving &&
      this.lightSwitchedAt !== null &&
      r.now - this.lightSwitchedAt < LIGHT_MIN_SWITCH_S
    ) {
      return [];
    }
    this.lightOn = want;
    this.lightSwitchedAt = r.now;
    return [
      {
        kind: 'light',
        on: want,
        reason: {
          kind: 'light',
          mode: light.mode,
          from: timeOf(window?.from ?? 0),
          to: timeOf(window?.to ?? 0),
          lux: daylight === null ? null : Math.round(daylight),
          belowLux: limit,
        },
      },
    ];
  }
}

// Rounded down, so the reason always reads true once shown: 21.96 °C is
// "21.9 < 22", never "22 < 22"; 0.349 is "34 % < 35 %".
const round1 = (value: number) => Math.floor(value * 10) / 10;
const round2 = (value: number) => Math.floor(value * 100) / 100;
