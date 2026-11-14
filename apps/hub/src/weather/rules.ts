import {
  FROST_WARNING_C,
  MAX_HOLD_MINUTES,
  RAIN_MM,
  STRONG_WIND,
  weatherNow,
  weatherRules,
} from '@vitreo/shared';
import type {
  CommandMessage,
  WeatherCause,
  WeatherMessage,
  WeatherRules,
  WeatherReason,
  WeatherRulesUpdate,
  WeatherState,
} from '@vitreo/shared';
import { and, desc, eq, isNull, like } from 'drizzle-orm';
import { z } from 'zod';

import { snapshotFrom } from '../alerts.ts';
import type { HubDatabase } from '../db/types.ts';
import * as t from '../db/schema.ts';
import { readSetting, writeSetting } from '../db/store.ts';
import type { PushCore } from '../pushCore.ts';

/**
 * The hub's first rules of its own (A10, D97; the higher level D89 left
 * out). The device's rules (config) work without the hub; these need the
 * weather, which only the hub has. Both can be switched off in Ajustes.
 *
 * 1. Rain, snow or strong wind outside: an outdoor hold on the device
 *    (`outdoorHold`), which closes the window saying why and ventilates
 *    with the fan only while it lasts. The device keeps it, so the hub never
 *    fights the device's own ventilation: heat protection still opens the
 *    window, and a person who opens it wins until the hold ends. The hold
 *    has a duration the hub renews while the weather lasts, and releases
 *    when it clears (or the rule is switched off, or the weather is no
 *    longer known). Only with live data: it never acts on a device it
 *    cannot see.
 * 2. Frost forecast tonight: one notification in the evening (19:00–23:00,
 *    before quiet hours), "Helada prevista: 1 °C a las 6:00", of its own
 *    type (`frost_forecast`, not critical): a forecast, not a limit that
 *    triggered.
 */

const RULES_KEY = 'weather.rules';
const WINDOW_KEY = 'weather.window';
export const DEFAULT_RULES: WeatherRules = { closeWindow: true, frostWarning: true };
/** Data older than this: the device is not known (the same 2 min as the app). */
const STALE_AFTER_MS = 2 * 60_000;
/** How long each hold lasts; renewed while the weather lasts. */
const HOLD_MINUTES = Math.min(30, MAX_HOLD_MINUTES);
/** Renewed when less than this is left: every 10 minutes. */
const RENEW_BELOW_S = 20 * 60;
/** An order the device has not taken up yet is sent again after this. */
const RESEND_AFTER_MS = 60_000;
/** The frost warning goes out in this local window (quiet hours start at 23:00). */
const EVENING = { from: 19, to: 23 } as const;
/** An evening's warning is put away (quietly) the next day. */
const FROST_NOTE_FOR_MS = 16 * 3_600_000;
export const FROST_KEY_PREFIX = 'forecast:frost:';

const windowMemory = z.object({
  state: z.enum(['idle', 'asking', 'holding', 'held-by-heat', 'left-open']),
  cause: z.enum(['rain', 'snow', 'wind']).nullable(),
  at: z.number().nullable(),
  /** When the hub last sent a hold (`sentOn`) or its release (ms). */
  sentAt: z.number().nullable(),
  sentOn: z.boolean().nullable(),
});
type WindowMemory = z.infer<typeof windowMemory>;
const IDLE: WindowMemory = { state: 'idle', cause: null, at: null, sentAt: null, sentOn: null };

export class WeatherRuleEngine {
  private readonly clock: Intl.DateTimeFormat;
  private readonly day: Intl.DateTimeFormat;
  private counter = 0;

  constructor(
    private readonly db: HubDatabase,
    private readonly device: string,
    private readonly deps: {
      weather: (now: number) => WeatherMessage | null;
      sendCommand: (command: CommandMessage) => void;
      push: PushCore | null;
      timeZone: string;
      log: (message: string) => void;
    },
  ) {
    this.clock = new Intl.DateTimeFormat('es-ES', {
      timeZone: deps.timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    this.day = new Intl.DateTimeFormat('en-CA', { timeZone: deps.timeZone });
  }

  rules(): WeatherRules {
    return readSetting(this.db, RULES_KEY, weatherRules, DEFAULT_RULES);
  }

  setRules(change: WeatherRulesUpdate, now: number): WeatherRules {
    const current = this.rules();
    const next: WeatherRules = {
      closeWindow: change.closeWindow ?? current.closeWindow,
      frostWarning: change.frostWarning ?? current.frostWarning,
    };
    writeSetting(this.db, RULES_KEY, next, now);
    return next;
  }

  windowState(): WeatherState['window'] {
    const { state, cause, at } = readSetting(this.db, WINDOW_KEY, windowMemory, IDLE);
    return { state, cause, at };
  }

  private remember(memory: WindowMemory, now: number): void {
    writeSetting(this.db, WINDOW_KEY, memory, now);
  }

  async evaluate(now: number): Promise<void> {
    const rules = this.rules();
    this.window(now, rules.closeWindow);
    if (rules.frostWarning) await this.frost(now);
    this.putAwayFrostNotes(now);
  }

  // ──────────────────────────────────────────────────────────── the window

  private window(now: number, enabled: boolean): void {
    const memory = readSetting(this.db, WINDOW_KEY, windowMemory, IDLE);
    const set = (change: Partial<WindowMemory>) => {
      const next = { ...memory, ...change };
      if (next.state !== memory.state || next.cause !== memory.cause) next.at = now;
      this.remember(next, now);
    };
    const weather = weatherNow(this.deps.weather(now), Math.floor(now / 1000));
    const cause: WeatherCause | null =
      !enabled || !weather
        ? null
        : weather.snow > 0
          ? 'snow'
          : weather.wet
            ? 'rain'
            : weather.windy
              ? 'wind'
              : null;

    const snapshot = snapshotFrom(this.db, this.device, now);
    const telemetry = snapshot.telemetry;
    // A device it cannot see: nothing is sent (an unrenewed hold lapses on its own).
    if (!telemetry || snapshot.lastDataAt === null || now - snapshot.lastDataAt > STALE_AFTER_MS) {
      if (memory.state !== 'idle') set({ ...IDLE });
      return;
    }
    const hold = telemetry.outdoorHold ?? null;
    // The same order is not repeated within the minute; the other one goes at once.
    const maySend = (on: boolean) =>
      memory.sentAt === null || memory.sentOn !== on || now - memory.sentAt >= RESEND_AFTER_MS;

    if (!cause || !weather) {
      // Fair again, the rule off, or the weather no longer known: the device's own rules.
      if (hold && maySend(false)) {
        this.send({ action: 'outdoorHold', on: false }, now);
        this.deps.log('outdoor hold released');
        set({ ...IDLE, sentAt: now, sentOn: false });
      } else if (!hold && memory.state !== 'idle') {
        set({ ...IDLE });
      }
      return;
    }

    const due = hold?.cause !== cause || hold.until - Math.floor(now / 1000) < RENEW_BELOW_S;
    let { sentAt, sentOn } = memory;
    if (due && maySend(true)) {
      const from =
        cause === 'wind'
          ? (weather.windFrom ?? 'station')
          : weather.rainFrom === 'gauge'
            ? 'station'
            : 'forecast';
      const reason = reasonFor(cause, weather.precipValue, weather.windValue, from);
      this.send({ action: 'outdoorHold', on: true, minutes: HOLD_MINUTES, reason }, now);
      if (!hold) this.deps.log(`outdoor hold for the weather (${cause})`);
      sentAt = now;
      sentOn = true;
    }
    const state: WindowMemory['state'] = !hold
      ? 'asking'
      : snapshot.held.some((held) => held.limit === 'over_temperature')
        ? 'held-by-heat'
        : telemetry.actuators.vent > 0
          ? 'left-open'
          : 'holding';
    set({ state, cause, sentAt, sentOn });
  }

  private send(
    order:
      | { action: 'outdoorHold'; on: true; minutes: number; reason: WeatherReason }
      | { action: 'outdoorHold'; on: false },
    now: number,
  ): void {
    this.counter++;
    this.deps.sendCommand({
      v: 1,
      requestId: `hub-hold-${now.toString(36)}-${this.counter.toString()}`,
      source: 'automation',
      ...order,
    });
  }

  // ───────────────────────────────────────────────────────────────── frost

  private localHour(now: number): number {
    return Number(this.clock.format(now).split(':')[0]);
  }

  private async frost(now: number): Promise<void> {
    const hour = this.localHour(now);
    if (hour < EVENING.from || hour >= EVENING.to) return;
    const message = this.deps.weather(now);
    const tonight = message?.tonight;
    if (!tonight || tonight.min > FROST_WARNING_C) return;
    const key = `${FROST_KEY_PREFIX}${this.day.format(now)}`;
    const told = this.db
      .select({ id: t.incidents.id })
      .from(t.incidents)
      .where(and(eq(t.incidents.device, this.device), eq(t.incidents.key, key)))
      .get();
    if (told) return;
    const degrees = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(
      tonight.min,
    );
    const title = `Helada prevista: ${degrees} °C a las ${this.clock.format(tonight.at * 1000)}`;
    const body =
      'Lo prevé AEMET para esta noche. Si hace falta, el invernadero cerrará la ventana y parará el ventilador por sí solo.';
    this.db
      .insert(t.incidents)
      .values({
        device: this.device,
        key,
        type: 'frost_forecast',
        critical: false,
        zone: null,
        title,
        body,
        url: '/?open=air',
        openedAt: now,
        notifiedAt: now,
        lastNotifiedAt: now,
      })
      .run();
    this.deps.log(title);
    await this.deps.push?.send(
      { title, body, tag: key, url: '/?open=air', renotify: true, critical: false },
      'frost_forecast',
    );
  }

  /** Last night's warning is put away the next day, without a notification. */
  private putAwayFrostNotes(now: number): void {
    const open = this.db
      .select({ id: t.incidents.id, openedAt: t.incidents.openedAt })
      .from(t.incidents)
      .where(
        and(
          eq(t.incidents.device, this.device),
          like(t.incidents.key, `${FROST_KEY_PREFIX}%`),
          isNull(t.incidents.resolvedAt),
        ),
      )
      .orderBy(desc(t.incidents.openedAt))
      .all();
    for (const incident of open) {
      if (now - incident.openedAt < FROST_NOTE_FOR_MS) continue;
      this.db
        .update(t.incidents)
        .set({ resolvedAt: now })
        .where(eq(t.incidents.id, incident.id))
        .run();
    }
  }
}

/** Why, as the device will tell it back (rain in mm, wind in m/s). */
export function reasonFor(
  cause: WeatherCause,
  precip: number | null,
  wind: number | null,
  from: 'station' | 'forecast' = 'station',
): WeatherReason {
  if (cause === 'wind') {
    const gust = wind !== null && wind >= STRONG_WIND.gust;
    return {
      kind: 'weather',
      cause,
      value: wind === null ? null : Math.round(wind * 10) / 10,
      limit: Math.round((gust ? STRONG_WIND.gust : STRONG_WIND.mean) * 10) / 10,
      from,
    };
  }
  return { kind: 'weather', cause, value: precip, limit: RAIN_MM, from };
}
