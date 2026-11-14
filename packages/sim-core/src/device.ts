import { commandSource, parseMessage, requestId } from '@vitreo/shared';
import type { AckMessage, Channel, EventMessage, MessageFor } from '@vitreo/shared';

import { GreenhouseSim } from './greenhouse.ts';
import type { ScenarioChange, SimMemory, SimSnapshot } from './greenhouse.ts';
import type { AutomationOptions } from './automation.ts';
import type { OutsideCurve } from './outside.ts';
import type { SimParams } from './params.ts';

const MAX_QUEUED_EVENTS = 100;

export interface DeviceOptions {
  /** The noise of the sensors; by default, different on every start. */
  seed?: number;
  /** The weather outside (see GreenhouseSim). */
  outside?: OutsideCurve;
  /** The automation's options, only to compare (week.test.ts). */
  rules?: AutomationOptions;
}

/**
 * For a command that failed validation: the request id and source, if they
 * can still be read, so the sender gets an `invalid` ack instead of silence.
 */
export function attributionOf(
  payload: string,
): { requestId: string; source: AckMessage['source'] } | null {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;
  const record = json as Record<string, unknown>;
  const id = requestId.safeParse(record['requestId']);
  if (!id.success) return null;
  const source = commandSource.safeParse(record['source']);
  return { requestId: id.data, source: source.success ? source.data : 'user' };
}

/** How the device's messages leave it: MQTT in the simulator, a worker in the demo. */
export interface DeviceLink {
  /** Whether a message published now would arrive. */
  readonly connected: boolean;
  publish<C extends Channel>(channel: C, message: MessageFor<C>): void;
}

/**
 * The simulated ESP32 without its network: the greenhouse model, the events
 * kept while offline, telemetry on time and on change, commands and `config`.
 * The simulator (apps/simulator) wraps it in MQTT; the public demo (D66,
 * D103) in a Web Worker. Both get the same device, safety limits included.
 */
export class DeviceCore {
  private sim: GreenhouseSim;
  private readonly outbox: EventMessage[] = [];
  private lastTelemetryMs = 0;
  private lastActuators = '';
  /**
   * The last `config` received, kept like the ESP32 keeps it in flash: a dev
   * reset starts a fresh greenhouse, not a blank device (A6).
   */
  private storedConfig: unknown = null;

  constructor(
    private readonly params: SimParams,
    private readonly link: DeviceLink,
    private readonly now: () => number = Date.now,
    private readonly options: DeviceOptions = {},
  ) {
    this.sim = this.freshSim();
  }

  private freshSim(): GreenhouseSim {
    const { seed = Date.now() % 2 ** 31, outside = null, rules = {} } = this.options;
    return new GreenhouseSim(this.params, this.now(), seed, outside, rules);
  }

  get isDisconnected(): boolean {
    return this.sim.isDisconnected;
  }

  /** What to keep over a restart (D100). */
  memory(): SimMemory {
    return this.sim.memory(this.now());
  }

  /** Carries on from what was kept (D100). */
  restore(memory: SimMemory): void {
    this.sim.restore(memory, this.now());
  }

  snapshot(): SimSnapshot {
    return this.sim.snapshot(this.now());
  }

  /** Called every second: the model moves on, and telemetry goes out when due. */
  tick(): void {
    const events = this.sim.tick(this.now());
    this.queue(events);
    const actuators = JSON.stringify(this.sim.telemetry(this.now()).actuators);
    const due =
      this.now() - this.lastTelemetryMs >= this.params.timing.telemetryIntervalSeconds * 1000;
    // Telemetry every period and on change; every second while watering so
    // the soil visibly darkens in the app.
    if (due || events.length > 0 || this.sim.isWatering || actuators !== this.lastActuators) {
      this.publishTelemetry();
    }
  }

  /** The link is up (again): what waited goes out, then a fresh reading. */
  linked(): void {
    this.flush();
    this.publishTelemetry();
  }

  /** An unexpected drop: temporary actuators return to their safe state. */
  linkLost(): void {
    if (!this.sim.isDisconnected) this.queue(this.sim.connectionLost(this.now()));
  }

  /**
   * A scenario on or off. For `disconnect`, the caller drops or restores its
   * link (before turning it on, after turning it off); this only moves the model.
   */
  setScenario(change: ScenarioChange): void {
    if (change.scenario === 'disconnect' && change.active === this.sim.isDisconnected) return;
    this.queue(this.sim.setScenario(change, this.now()));
    if (change.scenario !== 'disconnect') this.publishTelemetry();
  }

  /**
   * Development only: a fresh greenhouse, as if just started (moisture, tank,
   * scenarios, broken sensors, pump history). The tests use it so no state
   * carries over from one test to the next.
   */
  reset(): void {
    this.sim = this.freshSim();
    if (this.storedConfig !== null) this.queue(this.sim.applyConfig(this.storedConfig, this.now()));
    this.publishTelemetry();
  }

  /** Development only: the pump has used its whole hourly budget (to show the limit). */
  useUpPumpBudget(): void {
    this.sim.useUpPumpBudget(this.now());
  }

  setSoilMoisture(zone: string, moisture: number): boolean {
    const ok = this.sim.setSoilMoisture(zone, moisture);
    if (ok) this.publishTelemetry();
    return ok;
  }

  /** Development only: the air at this temperature now (heat or frost at once, for tests). */
  setAirTemperature(tempC: number): void {
    this.queue(this.sim.setAirTemperature(tempC, this.now()));
    this.publishTelemetry();
  }

  setTankLevel(level: number): void {
    this.sim.setTankLevel(level);
    this.publishTelemetry();
  }

  handleCommand(payload: string): void {
    const parsed = parseMessage('cmd', payload);
    if (!parsed.ok) {
      const attribution = attributionOf(payload);
      console.warn(`[simulator] invalid command: ${parsed.error}`);
      if (attribution) {
        const ack = this.sim.rejectInvalid(attribution.requestId, attribution.source, this.now());
        this.publish('ack', ack);
      }
      return;
    }
    const { ack, events } = this.sim.command(parsed.message, this.now());
    this.publish('ack', ack);
    this.queue(events);
    this.publishTelemetry();
  }

  /** A `config` (A6): applied, or refused with a clear event (never guessed). */
  handleConfig(payload: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(payload);
    } catch {
      // Not JSON: refused as invalid, like any other bad config.
      raw = { invalid: true };
    }
    const events = this.sim.applyConfig(raw, this.now());
    if (events.some((event) => event.type === 'config.applied')) this.storedConfig = raw;
    const refused = events.find((event) => event.type === 'config.rejected');
    if (refused) console.warn(`[simulator] config refused: ${JSON.stringify(refused)}`);
    this.queue(events);
    this.publishTelemetry();
  }

  private publishTelemetry(): void {
    if (!this.link.connected) return;
    const telemetry = this.sim.telemetry(this.now());
    this.lastTelemetryMs = this.now();
    this.lastActuators = JSON.stringify(telemetry.actuators);
    this.publish('telemetry', telemetry);
  }

  /** Events survive a disconnection and are delivered, in order, once back online. */
  private queue(events: EventMessage[]): void {
    this.outbox.push(...events);
    if (this.outbox.length > MAX_QUEUED_EVENTS) {
      this.outbox.splice(0, this.outbox.length - MAX_QUEUED_EVENTS);
    }
    this.flush();
  }

  private flush(): void {
    while (this.link.connected && this.outbox.length > 0) {
      const event = this.outbox.shift();
      if (event) this.publish('event', event);
    }
  }

  private publish<C extends Channel>(channel: C, message: MessageFor<C>): void {
    if (this.link.connected) this.link.publish(channel, message);
  }
}
