import { CONFIG_VERSION, configMessage } from '@vitreo/shared';
import type {
  AckMessage,
  ActionSource,
  AutomationReason,
  CommandMessage,
  EventMessage,
  RejectReason,
  SafetyLimit,
  TelemetryMessage,
  WeatherReason,
} from '@vitreo/shared';
import { getPosition } from 'suncalc';
import { z } from 'zod';

import { Automation } from './automation.ts';
import type { AutomationOptions } from './automation.ts';
import type { OutsideCurve } from './outside.ts';
import type { SimParams } from './params.ts';
import { createRandom, gaussian } from './random.ts';
import { SAFETY } from './safety.ts';

export const FIRMWARE_VERSION = '0.1.0-sim';

/** Soil can dry towards this floor, never below. */
const SOIL_FLOOR = 0.03;
/** Pumping beyond this just drains through the pot. */
const SOIL_SATURATION = 0.95;
const MAX_REMEMBERED_ACKS = 64;
const HOUR_MS = 3_600_000;
/** The automations look at the readings this often, like the firmware's loop. */
const AUTOMATION_EVERY_MS = 10_000;

export type Scenario =
  'heatwave' | 'cold_snap' | 'humid' | 'tank_empty' | 'disconnect' | 'sensor_failure';

export type SensorTarget = { sensor: 'air' | 'light' | 'tank' } | { sensor: 'soil'; zone: string };

export type ScenarioChange =
  | { scenario: 'heatwave' | 'cold_snap' | 'humid' | 'tank_empty' | 'disconnect'; active: boolean }
  | { scenario: 'sensor_failure'; active: boolean; target: SensorTarget };

/** Why a command was refused, with the limit and when to try again (D85). */
interface Rejection {
  reason: RejectReason;
  limit?: SafetyLimit;
  retryAtMs?: number;
}

interface Watering {
  zone: string;
  startMs: number;
  untilMs: number;
  requestId: string | undefined;
  source: ActionSource;
}

export interface CommandResult {
  ack: AckMessage;
  events: EventMessage[];
}

export interface SimSnapshot {
  time: string;
  sunFactor: number;
  tempC: number;
  rh: number;
  lux: number;
  moisture: Record<string, number>;
  tankLevel: number;
  actuators: TelemetryMessage['actuators'];
  overTemperature: boolean;
  pumpSecondsLastHour: number;
  scenarios: {
    heatwave: boolean;
    coldSnap: boolean;
    humid: boolean;
    tankEmpty: boolean;
    disconnected: boolean;
  };
  frost: boolean;
  brokenSensors: string[];
  /** The revision of `config` in force (A6), or null. */
  configRev: number | null;
  /** The hub's outdoor hold (A10), or null. */
  outdoorHold: { cause: WeatherReason['cause']; until: string; openedByHand: boolean } | null;
}

/**
 * What survives a restart of the simulator (D100), as the real greenhouse
 * survives a reboot of its ESP32: the soil, the tank and the air go on, the
 * automation keeps its counts and the pump its last hour. A watering in
 * progress is not resumed (the pump stops on reboot), and scenarios and
 * broken sensors are test tools: they are not kept.
 */
export const simMemory = z.object({
  v: z.literal(1),
  /** ms */
  savedAt: z.number(),
  moisture: z.record(z.string(), z.number().min(0).max(1)),
  tankLevel: z.number().min(0).max(1),
  tempC: z.number(),
  rh: z.number().min(0).max(100),
  pumpLog: z.array(z.object({ startMs: z.number(), endMs: z.number() })),
  automation: z.object({
    lastWatering: z.record(z.string(), z.number()),
    counts: z.object({ day: z.string(), perZone: z.record(z.string(), z.number()) }),
  }),
});
export type SimMemory = z.infer<typeof simMemory>;

/** How much of the sunlight a fully overcast sky takes away (OutsideCurve.cloud = 1). */
const CLOUD_SHADE = 0.75;

/** A longer gap (the PC off for weeks) is caught up only this far. */
const CATCH_UP_MAX_MS = 14 * 24 * HOUR_MS;
const CATCH_UP_STEP_MS = 10 * 60_000;

const toSeconds = (ms: number) => Math.floor(ms / 1000);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const sensorKey = (target: SensorTarget) =>
  target.sensor === 'soil' ? `soil:${target.zone}` : target.sensor;

/**
 * A pure, deterministic model of the greenhouse and its firmware: climate,
 * soil, tank, actuators and the same safety limits. Time only moves when the
 * caller says so, which keeps it easy to test.
 */
export class GreenhouseSim {
  private readonly random: () => number;
  private lastMs: number;
  private tempC: number;
  private rh: number;
  private readonly moisture = new Map<string, number>();
  private tankLevel: number;
  private growLight = false;
  private vent = 0;
  private fanUntilMs: number | null = null;
  private fanForced = false;
  /** The ventilation automation holds the fan on (A6). */
  private fanAuto = false;
  private readonly automation: Automation;
  private lastAutomationMs = Number.NEGATIVE_INFINITY;
  private overTemperature = false;
  private watering: Watering | null = null;
  private pumpLog: { startMs: number; endMs: number }[] = [];
  private readonly scenarios = {
    heatwave: false,
    coldSnap: false,
    humid: false,
    tankEmpty: false,
    disconnected: false,
  };
  /** Frost protection holds the window closed and the fan off (D90). */
  private frost = false;
  /** The hub's outdoor hold (A10, D97): window closed, fan only, until it lapses. */
  private hold: { reason: WeatherReason; untilMs: number } | null = null;
  /** The person opened the window during the hold: theirs until it ends. */
  private holdOpenedByHand = false;
  private readonly brokenSensors = new Set<string>();
  private readonly recentAcks = new Map<string, AckMessage>();

  /**
   * `outside`: the weather outside, day by day (the accelerated week, D104).
   * Without it, the daily cosine of `params.air` under a clear sky, as always.
   * `rules`: the automation's options, only to compare (week.test.ts).
   */
  constructor(
    private readonly params: SimParams,
    nowMs: number,
    seed = 1,
    private readonly outside: OutsideCurve | null = null,
    rules: AutomationOptions = {},
  ) {
    this.automation = new Automation(rules);
    this.random = createRandom(seed);
    this.lastMs = nowMs;
    for (const zone of params.zones) this.moisture.set(zone.id, zone.initialMoisture);
    this.tankLevel = params.tank.initialLevel;
    this.tempC = this.targetTemperature(nowMs);
    this.rh = this.targetHumidity();
  }

  /** What to keep over a restart (D100). */
  memory(nowMs: number): SimMemory {
    this.pumpSecondsLastHour(nowMs);
    return {
      v: 1,
      savedAt: nowMs,
      moisture: Object.fromEntries(this.moisture),
      tankLevel: this.tankLevel,
      tempC: this.tempC,
      rh: this.rh,
      pumpLog: this.watering
        ? [...this.pumpLog, { startMs: this.watering.startMs, endMs: nowMs }]
        : [...this.pumpLog],
      automation: this.automation.memory(),
    };
  }

  /**
   * Starts from what was kept, and lets the soil dry and the air follow the
   * day for the time it was off, as they would have (nothing waters then).
   */
  restore(memory: SimMemory, nowMs: number): void {
    for (const zone of this.params.zones) {
      const kept = memory.moisture[zone.id];
      if (kept !== undefined) this.moisture.set(zone.id, kept);
    }
    this.tankLevel = memory.tankLevel;
    this.tempC = memory.tempC;
    this.rh = memory.rh;
    this.pumpLog = memory.pumpLog.filter((entry) => entry.endMs > nowMs - HOUR_MS);
    this.automation.restore(memory.automation);
    let fromMs = Math.max(memory.savedAt, nowMs - CATCH_UP_MAX_MS);
    while (fromMs < nowMs) {
      const toMs = Math.min(nowMs, fromMs + CATCH_UP_STEP_MS);
      this.advance(fromMs, toMs);
      fromMs = toMs;
    }
    this.lastMs = nowMs;
  }

  get isWatering(): boolean {
    return this.watering !== null;
  }

  get isDisconnected(): boolean {
    return this.scenarios.disconnected;
  }

  /** Advances the simulation to `nowMs` and returns the events that happened. */
  tick(nowMs: number): EventMessage[] {
    const events: EventMessage[] = [];
    while (this.lastMs < nowMs) {
      const stepMs = this.watering ? 250 : 10_000;
      let nextMs = Math.min(nowMs, this.lastMs + stepMs);
      if (this.watering && this.watering.untilMs > this.lastMs) {
        nextMs = Math.min(nextMs, this.watering.untilMs);
      }
      if (this.fanUntilMs !== null && this.fanUntilMs > this.lastMs) {
        nextMs = Math.min(nextMs, this.fanUntilMs);
      }
      this.advance(this.lastMs, nextMs);
      this.lastMs = nextMs;
      this.checkLimits(nextMs, events);
      if (nextMs - this.lastAutomationMs >= AUTOMATION_EVERY_MS) {
        this.lastAutomationMs = nextMs;
        this.runAutomation(nextMs, events);
      }
    }
    return events;
  }

  /** The revision of `config` in force, or null. */
  get configRev(): number | null {
    return this.automation.rev;
  }

  /**
   * A `config` arrived (A6, D89). A version it does not know, or one that
   * does not validate, is refused with `config.rejected` and the previous one
   * stays: the device never guesses. Otherwise it applies and says so.
   */
  applyConfig(raw: unknown, nowMs: number): EventMessage[] {
    const events = this.tick(nowMs);
    const ts = toSeconds(nowMs);
    const keeps = this.automation.rev ?? undefined;
    const fields = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const revField = fields['rev'];
    const rev =
      typeof revField === 'number' && Number.isInteger(revField) && revField > 0
        ? revField
        : undefined;
    const versionField = fields['v'];
    const refuse = (reason: 'unsupported_version' | 'invalid'): EventMessage[] => {
      events.push({
        v: 1,
        ts,
        type: 'config.rejected',
        reason,
        ...(rev !== undefined ? { rev } : {}),
        ...(typeof versionField === 'number' ? { version: versionField } : {}),
        ...(keeps !== undefined ? { keeps } : {}),
      });
      return events;
    };
    if (versionField !== CONFIG_VERSION) return refuse('unsupported_version');
    const parsed = configMessage.safeParse(raw);
    if (!parsed.success || !this.automation.apply(parsed.data)) return refuse('invalid');
    // A ventilation turned off lets go of what it held.
    if (!parsed.data.ventilation.enabled) this.fanAuto = false;
    events.push({ v: 1, ts, type: 'config.applied', rev: parsed.data.rev });
    // Decide at once with the new rules.
    this.lastAutomationMs = nowMs;
    this.runAutomation(nowMs, events);
    return events;
  }

  /** Executes a validated command, like the firmware would. Idempotent per `requestId`. */
  command(cmd: CommandMessage, nowMs: number): CommandResult {
    const events = this.tick(nowMs);
    const remembered = this.recentAcks.get(cmd.requestId);
    if (remembered) return { ack: remembered, events };

    const reject = ({ reason, limit, retryAtMs }: Rejection): AckMessage => ({
      v: 1,
      requestId: cmd.requestId,
      ts: toSeconds(nowMs),
      source: cmd.source,
      result: 'rejected',
      reason,
      ...(limit ? { limit } : {}),
      ...(retryAtMs !== undefined ? { retryAt: Math.ceil(retryAtMs / 1000) } : {}),
    });
    const ok: AckMessage = {
      v: 1,
      requestId: cmd.requestId,
      ts: toSeconds(nowMs),
      source: cmd.source,
      result: 'ok',
    };

    let ack: AckMessage = ok;
    switch (cmd.action) {
      case 'water': {
        const rejection = this.startWatering(
          { zone: cmd.zone, seconds: cmd.seconds, source: cmd.source, requestId: cmd.requestId },
          nowMs,
          events,
        );
        if (rejection) ack = reject(rejection);
        break;
      }
      case 'waterStop':
        // Stopping is always allowed (it is the safe direction) and idempotent.
        if (this.watering && (cmd.zone === undefined || cmd.zone === this.watering.zone)) {
          this.finishWatering(nowMs, events, cmd.requestId);
        }
        break;
      case 'growLight':
        if (cmd.on && this.overTemperature) {
          ack = reject({ reason: 'safety_limit', limit: 'over_temperature' });
        } else if (cmd.on && this.brokenSensors.has('air')) {
          ack = reject({ reason: 'safety_limit', limit: 'sensor_failure' });
        } else {
          this.growLight = cmd.on;
        }
        break;
      case 'vent':
        if (this.overTemperature && cmd.open < 1) {
          ack = reject({ reason: 'safety_limit', limit: 'over_temperature' });
        } else if (this.frost && cmd.open > 0) {
          ack = reject({ reason: 'safety_limit', limit: 'frost' });
        } else {
          this.vent = cmd.open;
          // During an outdoor hold, a person's call stands until it ends (A10).
          if (this.hold && cmd.source !== 'automation') this.holdOpenedByHand = cmd.open > 0;
        }
        break;
      case 'outdoorHold':
        // Accepted even while heat holds the window open: heat still wins.
        if (cmd.on) {
          if (!this.hold) this.holdOpenedByHand = false;
          this.hold = { reason: cmd.reason, untilMs: nowMs + cmd.minutes * 60_000 };
          this.keepHold(nowMs, events);
        } else {
          this.endHold(nowMs, events);
        }
        break;
      case 'fan':
        if (cmd.on && this.frost) ack = reject({ reason: 'safety_limit', limit: 'frost' });
        else if (cmd.on) this.fanUntilMs = nowMs + cmd.minutes * 60_000;
        else if (this.overTemperature) {
          ack = reject({ reason: 'safety_limit', limit: 'over_temperature' });
        } else {
          this.fanUntilMs = null;
          // Switched off by hand: the automation lets go until the next crossing.
          this.fanAuto = false;
          this.automation.releaseFan();
        }
        break;
    }

    this.remember(ack);
    return { ack, events };
  }

  /** Answers an invalid command, if it can at least be attributed to a request. */
  rejectInvalid(requestId: string, source: AckMessage['source'], nowMs: number): AckMessage {
    const ack: AckMessage = {
      v: 1,
      requestId,
      ts: toSeconds(nowMs),
      source,
      result: 'rejected',
      reason: 'invalid',
    };
    this.remember(ack);
    return ack;
  }

  setScenario(change: ScenarioChange, nowMs: number): EventMessage[] {
    const events = this.tick(nowMs);
    switch (change.scenario) {
      case 'heatwave':
        this.scenarios.heatwave = change.active;
        break;
      case 'cold_snap':
        this.scenarios.coldSnap = change.active;
        break;
      case 'humid':
        // A muggy morning (condensation on the glass, A9): the air settles
        // at a higher humidity, and is there at once to be seen.
        this.scenarios.humid = change.active;
        this.rh = this.targetHumidity();
        break;
      case 'tank_empty':
        this.scenarios.tankEmpty = change.active;
        this.checkLimits(nowMs, events);
        break;
      case 'disconnect':
        this.scenarios.disconnected = change.active;
        if (change.active) events.push(...this.connectionLost(nowMs));
        break;
      case 'sensor_failure':
        this.setSensorFailure(change.target, change.active, nowMs, events);
        break;
    }
    return events;
  }

  /**
   * The link to the broker dropped: temporary actuators go back to their safe
   * state. The pump stops at once; the fan keeps its own timer.
   */
  connectionLost(nowMs: number): EventMessage[] {
    const events = this.tick(nowMs);
    if (this.watering) {
      events.push(this.safetyEvent('connection_lost', nowMs, this.watering.zone));
      this.finishWatering(nowMs, events);
    }
    return events;
  }

  /** Development helpers (debug HTTP API only). */
  setSoilMoisture(zone: string, value: number): boolean {
    if (!this.moisture.has(zone)) return false;
    this.moisture.set(zone, clamp(value, 0, 1));
    return true;
  }

  setTankLevel(value: number): void {
    this.tankLevel = clamp(value, 0, 1);
  }

  telemetry(nowMs: number): TelemetryMessage {
    const { noise } = this.params;
    const broken = (key: string) => this.brokenSensors.has(key);
    const lux = this.lux(nowMs);
    return {
      v: 1,
      ts: toSeconds(nowMs),
      air: {
        temp: broken('air') ? null : round(this.tempC + gaussian(this.random, noise.tempC), 1),
        rh: broken('air')
          ? null
          : round(clamp(this.rh + gaussian(this.random, noise.rh), 0, 100), 1),
      },
      light: {
        lux: broken('light')
          ? null
          : Math.round(clamp(lux * (1 + gaussian(this.random, noise.lux)), 0, 200_000)),
      },
      soil: this.params.zones.map(({ id }) => ({
        id,
        moisture: broken(`soil:${id}`)
          ? null
          : round(
              clamp((this.moisture.get(id) ?? 0) + gaussian(this.random, noise.moisture), 0, 1),
              2,
            ),
        cal: 1,
      })),
      tank: { level: broken('tank') ? null : round(this.effectiveTankLevel(), 2) },
      actuators: {
        pump: this.watering !== null,
        growLight: this.growLight,
        fan: this.fanOn(nowMs),
        vent: this.vent,
      },
      outdoorHold: this.hold
        ? { cause: this.hold.reason.cause, until: toSeconds(this.hold.untilMs) }
        : null,
      fw: FIRMWARE_VERSION,
      rssi: Math.round(clamp(-55 + gaussian(this.random, 2), -127, 0)),
    };
  }

  snapshot(nowMs: number): SimSnapshot {
    return {
      time: new Date(nowMs).toISOString(),
      sunFactor: round(this.sunFactor(nowMs), 3),
      tempC: round(this.tempC, 2),
      rh: round(this.rh, 2),
      lux: Math.round(this.lux(nowMs)),
      moisture: Object.fromEntries([...this.moisture].map(([id, m]) => [id, round(m, 3)])),
      tankLevel: round(this.tankLevel, 3),
      actuators: {
        pump: this.watering !== null,
        growLight: this.growLight,
        fan: this.fanOn(nowMs),
        vent: this.vent,
      },
      overTemperature: this.overTemperature,
      frost: this.frost,
      pumpSecondsLastHour: round(this.pumpSecondsLastHour(nowMs), 1),
      scenarios: { ...this.scenarios },
      brokenSensors: [...this.brokenSensors],
      configRev: this.automation.rev,
      outdoorHold: this.hold
        ? {
            cause: this.hold.reason.cause,
            until: new Date(this.hold.untilMs).toISOString(),
            openedByHand: this.holdOpenedByHand,
          }
        : null,
    };
  }

  // ── Physics ────────────────────────────────────────────────────────

  /** The sunlight reaching the greenhouse, 0–1: the sun's height, less the clouds. */
  private sunFactor(nowMs: number): number {
    const { lat, lng } = this.params.location;
    const altitude = getPosition(new Date(nowMs), lat, lng).altitude;
    const sun = Math.max(0, Math.sin((altitude * Math.PI) / 180));
    return this.outside ? sun * (1 - CLOUD_SHADE * this.outside.cloud(nowMs)) : sun;
  }

  /** Outdoor temperature: daily cosine peaking mid-afternoon (solar time). */
  private outdoorC(nowMs: number): number {
    const { air, location } = this.params;
    const solarHour = (((((nowMs / HOUR_MS) % 24) + location.lng / 15) % 24) + 24) % 24;
    const daily = Math.cos((2 * Math.PI * (solarHour - 15)) / 24);
    const base = this.outside
      ? this.outside.tempC(nowMs)
      : air.outdoorMeanC + air.outdoorAmplitudeC * daily;
    return (
      base +
      (this.scenarios.heatwave ? air.heatwaveExtraC : 0) -
      (this.scenarios.coldSnap ? air.coldSnapDropC : 0)
    );
  }

  /**
   * Where the air is heading: outside, plus what the sun through the glass
   * and the lamp add. The fan swaps air with outside, so it takes away a
   * share of that difference, not a fixed amount: on a cold night, with no
   * difference left, it cools nothing (D105).
   */
  private targetTemperature(nowMs: number): number {
    const { air } = this.params;
    const gain =
      air.greenhouseGainC * this.sunFactor(nowMs) * (1 - 0.6 * this.vent) +
      (this.growLight ? air.growLightGainC : 0);
    return this.outdoorC(nowMs) + gain * (this.fanOn(nowMs) ? 1 - air.fanExchange : 1);
  }

  private targetHumidity(): number {
    const { air } = this.params;
    const fan = this.fanUntilMs !== null || this.fanForced;
    return clamp(
      air.baseRh +
        (this.scenarios.humid ? air.humidExtraRh : 0) -
        air.rhPerDegree * (this.tempC - 20) -
        air.ventRhDrop * this.vent -
        (fan ? air.fanRhDrop : 0),
      20,
      98,
    );
  }

  private lux(nowMs: number): number {
    const { light } = this.params;
    return light.maxDaylightLux * this.sunFactor(nowMs) + (this.growLight ? light.growLightLux : 0);
  }

  private advance(fromMs: number, toMs: number): void {
    const { air, timing, zones, tank } = this.params;
    const realSeconds = (toMs - fromMs) / 1000;
    const slowSeconds = realSeconds * timing.timeScale;

    const relax = (tauMinutes: number) => 1 - Math.exp(-slowSeconds / (tauMinutes * 60));
    this.tempC += (this.targetTemperature(toMs) - this.tempC) * relax(air.temperatureTauMinutes);
    this.rh += (this.targetHumidity() - this.rh) * relax(air.humidityTauMinutes);

    const sun = this.sunFactor(toMs);
    const evaporation = Math.max(0.2, (1 + 0.06 * (this.tempC - 20)) * (0.6 + 0.8 * sun));
    for (const zone of zones) {
      const m = this.moisture.get(zone.id) ?? 0;
      const available = Math.max(0, m - SOIL_FLOOR);
      const kept = Math.exp(-zone.dryingPerHour * evaporation * (slowSeconds / 3600));
      this.moisture.set(zone.id, SOIL_FLOOR + available * kept);
    }

    if (this.watering) {
      const pumped = Math.max(
        0,
        (Math.min(toMs, this.watering.untilMs) - Math.max(fromMs, this.watering.startMs)) / 1000,
      );
      const zone = zones.find((z) => z.id === this.watering?.zone);
      if (zone && pumped > 0) {
        const m = this.moisture.get(zone.id) ?? 0;
        this.moisture.set(
          zone.id,
          Math.min(SOIL_SATURATION, m + zone.wateringGainPerSecond * pumped),
        );
        this.tankLevel = Math.max(0, this.tankLevel - tank.usePerPumpSecond * pumped);
      }
    }
  }

  // ── Firmware behaviour ─────────────────────────────────────────────

  private checkLimits(nowMs: number, events: EventMessage[]): void {
    if (this.watering) {
      if (this.effectiveTankLevel() <= SAFETY.tankEmptyLevel) {
        events.push(this.safetyEvent('tank_empty', nowMs, this.watering.zone));
        this.finishWatering(nowMs, events);
      } else if (nowMs >= this.watering.untilMs) {
        this.finishWatering(this.watering.untilMs, events);
      }
    }

    if (this.fanUntilMs !== null && nowMs >= this.fanUntilMs) this.fanUntilMs = null;

    if (!this.overTemperature && this.tempC >= SAFETY.overTemperatureC) {
      this.overTemperature = true;
      this.fanForced = true;
      this.growLight = false;
      this.vent = 1;
      events.push(this.safetyEvent('over_temperature', nowMs));
    } else if (this.overTemperature && this.tempC < SAFETY.overTemperatureClearC) {
      // Release the forced fan; the window stays open until someone closes it.
      this.overTemperature = false;
      this.fanForced = false;
      events.push(this.safetyCleared('over_temperature', nowMs));
    }

    // The outdoor hold lapses unless the hub renews it (A10).
    if (this.hold && nowMs >= this.hold.untilMs) this.endHold(this.hold.untilMs, events);
    else this.keepHold(nowMs, events);

    // Frost protection (D90): window closed, fan off, over any rule or order.
    if (!this.frost && this.tempC < SAFETY.frostC) {
      this.frost = true;
      this.closeForFrost();
      events.push(this.safetyEvent('frost', nowMs, undefined, round(this.tempC, 1)));
    } else if (this.frost && this.tempC >= SAFETY.frostClearC) {
      this.frost = false;
      events.push(this.safetyCleared('frost', nowMs));
    } else if (this.frost) {
      this.closeForFrost();
    }
  }

  private startWatering(
    cmd: {
      zone: string;
      seconds: number;
      source: ActionSource;
      requestId?: string;
      reason?: AutomationReason;
    },
    nowMs: number,
    events: EventMessage[],
  ): Rejection | null {
    if (!this.moisture.has(cmd.zone)) return { reason: 'invalid' };
    if (this.watering) return { reason: 'busy' };
    // An unknown tank level is treated as unsafe.
    if (this.brokenSensors.has('tank')) return { reason: 'safety_limit', limit: 'tank_unknown' };
    if (this.effectiveTankLevel() <= SAFETY.tankEmptyLevel) {
      events.push(this.safetyEvent('tank_empty', nowMs, cmd.zone));
      return { reason: 'tank_empty', limit: 'tank_empty' };
    }

    const seconds = Math.min(cmd.seconds, SAFETY.pumpMaxSecondsPerCommand);
    if (this.pumpSecondsLastHour(nowMs) + seconds > SAFETY.pumpMaxSecondsPerHour) {
      events.push(this.safetyEvent('pump_max_per_hour', nowMs, cmd.zone));
      return {
        reason: 'safety_limit',
        limit: 'pump_max_per_hour',
        retryAtMs: this.pumpAvailableAt(nowMs, seconds),
      };
    }

    this.watering = {
      zone: cmd.zone,
      startMs: nowMs,
      untilMs: nowMs + seconds * 1000,
      requestId: cmd.requestId,
      source: cmd.source,
    };
    events.push({
      v: 1,
      ts: toSeconds(nowMs),
      type: 'watering.started',
      source: cmd.source,
      ...(cmd.requestId ? { requestId: cmd.requestId } : {}),
      zone: cmd.zone,
      seconds,
      ...(cmd.reason ? { reason: cmd.reason } : {}),
    });
    return null;
  }

  /**
   * The outdoor hold in force (A10): the window closed, saying why, unless
   * heat protection holds it open or the person opened it during the hold.
   * Checked on every step, so it closes again once the heat has passed.
   */
  private keepHold(nowMs: number, events: EventMessage[]): void {
    if (!this.hold || this.overTemperature || this.holdOpenedByHand || this.vent <= 0) return;
    this.vent = 0;
    events.push({
      v: 1,
      ts: toSeconds(nowMs),
      type: 'automation.switched',
      source: 'automation',
      target: 'vent',
      value: 0,
      reason: this.hold.reason,
    });
  }

  /** The hold ends (cleared or lapsed): the rules open the window again if it is warm. */
  private endHold(nowMs: number, events: EventMessage[]): void {
    if (!this.hold) return;
    this.hold = null;
    this.holdOpenedByHand = false;
    const reason = this.automation.ventReason(this.brokenSensors.has('air') ? null : this.tempC);
    if (!reason || this.frost || this.vent >= 1) return;
    this.vent = 1;
    events.push({
      v: 1,
      ts: toSeconds(nowMs),
      type: 'automation.switched',
      source: 'automation',
      target: 'vent',
      value: 1,
      reason,
    });
  }

  /** Development only: the air at this temperature now (to show heat or frost at once). */
  setAirTemperature(tempC: number, nowMs: number): EventMessage[] {
    const events = this.tick(nowMs);
    this.tempC = tempC;
    this.checkLimits(nowMs, events);
    this.runAutomation(nowMs, events);
    return events;
  }

  /** The basic rules of `config` (A6): decided, then carried out within the safety limits. */
  private runAutomation(nowMs: number, events: EventMessage[]): void {
    const broken = (key: string) => this.brokenSensors.has(key);
    const now = toSeconds(nowMs);
    const decisions = this.automation.decide({
      now,
      moisture: new Map(
        this.params.zones.map(({ id }) => [
          id,
          broken(`soil:${id}`) ? null : (this.moisture.get(id) ?? null),
        ]),
      ),
      temp: broken('air') ? null : this.tempC,
      rh: broken('air') ? null : this.rh,
      lux: broken('light') ? null : this.lux(nowMs),
      pumping: this.watering !== null,
      growLight: this.growLight,
    });
    const switched = (
      target: 'growLight' | 'fan' | 'vent',
      value: boolean | number,
      reason: AutomationReason,
    ) => {
      events.push({
        v: 1,
        ts: now,
        type: 'automation.switched',
        source: 'automation',
        target,
        value,
        reason,
      });
    };
    for (const decision of decisions) {
      switch (decision.kind) {
        case 'water': {
          const refused = this.startWatering(
            {
              zone: decision.zone,
              seconds: decision.seconds,
              source: 'automation',
              reason: decision.reason,
            },
            nowMs,
            events,
          );
          this.automation.watered(decision.zone, now, refused === null);
          break;
        }
        case 'fan':
          // Frost protection wins over the rule (D90).
          if (decision.on && this.frost) break;
          {
            const before = this.fanOn(nowMs);
            this.fanAuto = decision.on;
            // Only what changes is an action: taking over a fan already so is not.
            if (this.fanOn(nowMs) !== before) switched('fan', decision.on, decision.reason);
          }
          break;
        case 'vent':
          // Over temperature the window stays open, whatever the rule says;
          // in frost it stays closed (D90).
          if (this.overTemperature && decision.open < 1) break;
          if (this.frost && decision.open > 0) break;
          // Under an outdoor hold the rules ventilate with the fan only (A10);
          // a window the person opened may still close by them.
          if (this.hold && (decision.open > 0 || this.vent <= 0)) break;
          if (this.vent === decision.open) break;
          this.vent = decision.open;
          switched('vent', decision.open, decision.reason);
          break;
        case 'light':
          if (decision.on && (this.overTemperature || broken('air'))) {
            events.push(
              this.safetyEvent(this.overTemperature ? 'over_temperature' : 'sensor_failure', nowMs),
            );
            break;
          }
          // A config applied again (every restart) decides afresh: the light
          // already off at night is not switched off again, nor said to be.
          if (this.growLight === decision.on) break;
          this.growLight = decision.on;
          switched('growLight', decision.on, decision.reason);
          break;
      }
    }
  }

  private finishWatering(endMs: number, events: EventMessage[], stopRequestId?: string): void {
    const watering = this.watering;
    if (!watering) return;
    this.watering = null;
    this.pumpLog.push({ startMs: watering.startMs, endMs });
    events.push({
      v: 1,
      ts: toSeconds(endMs),
      type: 'watering.finished',
      source: watering.source,
      ...(watering.requestId ? { requestId: watering.requestId } : {}),
      zone: watering.zone,
      seconds: round((endMs - watering.startMs) / 1000, 1),
      ...(stopRequestId ? { stopRequestId } : {}),
    });
  }

  /** Pump seconds within the hour before `atMs` (no running watering). */
  private pumpSecondsBefore(atMs: number): number {
    const since = atMs - HOUR_MS;
    return this.pumpLog.reduce(
      (total, { startMs, endMs }) =>
        total + Math.max(0, Math.min(endMs, atMs) - Math.max(startMs, since)) / 1000,
      0,
    );
  }

  /** When a watering of `seconds` fits the hourly limit again (D85). */
  private pumpAvailableAt(nowMs: number, seconds: number): number {
    for (let atMs = nowMs; atMs <= nowMs + HOUR_MS; atMs += 1000) {
      if (this.pumpSecondsBefore(atMs) + seconds <= SAFETY.pumpMaxSecondsPerHour) return atMs;
    }
    return nowMs + HOUR_MS;
  }

  /** Development only: as if the pump had run its whole hourly budget just now. */
  useUpPumpBudget(nowMs: number): void {
    this.tick(nowMs);
    this.pumpLog.push({ startMs: nowMs - SAFETY.pumpMaxSecondsPerHour * 1000, endMs: nowMs });
  }

  private pumpSecondsLastHour(nowMs: number): number {
    const since = nowMs - HOUR_MS;
    this.pumpLog = this.pumpLog.filter((entry) => entry.endMs > since);
    const spans = [...this.pumpLog];
    if (this.watering) spans.push({ startMs: this.watering.startMs, endMs: nowMs });
    return spans.reduce(
      (total, { startMs, endMs }) => total + Math.max(0, endMs - Math.max(startMs, since)) / 1000,
      0,
    );
  }

  private setSensorFailure(
    target: SensorTarget,
    active: boolean,
    nowMs: number,
    events: EventMessage[],
  ): void {
    const key = sensorKey(target);
    if (!active) {
      this.brokenSensors.delete(key);
      return;
    }
    if (this.brokenSensors.has(key)) return;
    this.brokenSensors.add(key);
    // Without an air reading the firmware cannot watch the temperature, so the
    // grow light (a heat source) goes off.
    if (target.sensor === 'air') this.growLight = false;
    events.push({
      v: 1,
      ts: toSeconds(nowMs),
      type: 'sensor.error',
      sensor: target.sensor,
      ...(target.sensor === 'soil' ? { zone: target.zone } : {}),
      detail: 'simulated failure',
    });
  }

  private effectiveTankLevel(): number {
    return this.scenarios.tankEmpty ? 0 : this.tankLevel;
  }

  private fanOn(nowMs: number): boolean {
    return this.fanForced || this.fanAuto || (this.fanUntilMs !== null && nowMs < this.fanUntilMs);
  }

  private closeForFrost(): void {
    this.vent = 0;
    this.fanUntilMs = null;
    this.fanAuto = false;
  }

  private safetyCleared(limit: SafetyLimit, nowMs: number): EventMessage {
    return {
      v: 1,
      ts: toSeconds(nowMs),
      type: 'safety.cleared',
      source: 'safety',
      limit,
      value: round(this.tempC, 1),
    };
  }

  private safetyEvent(
    limit: SafetyLimit,
    nowMs: number,
    zone?: string,
    value?: number,
  ): EventMessage {
    return {
      v: 1,
      ts: toSeconds(nowMs),
      type: 'safety.triggered',
      source: 'safety',
      limit,
      ...(zone ? { zone } : {}),
      ...(value !== undefined ? { value } : {}),
    };
  }

  private remember(ack: AckMessage): void {
    this.recentAcks.set(ack.requestId, ack);
    if (this.recentAcks.size > MAX_REMEMBERED_ACKS) {
      const oldest = this.recentAcks.keys().next().value;
      if (oldest !== undefined) this.recentAcks.delete(oldest);
    }
  }
}
