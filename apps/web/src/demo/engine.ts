// The demo's greenhouse on a clock of its own (D112): the simulated device
// (@vitreo/sim-core, safety limits included), the hub's own code and the
// simulated sky (D111), moved on together by one simulated time. The
// worker runs it at 60× or 1440× (worker.ts); the recording, as fast as it
// can (record.ts). The same engine for both: what the recorded week shows
// is what the demo then does.
import { serializeMessage, topic } from '@vitreo/shared';
import { DEFAULT_PARAMS, DeviceCore, statusPublication } from '@vitreo/sim-core';
import type { DeviceLink, SimMemory } from '@vitreo/sim-core';
import type { HourlySummary, PortableHub, PortableHubOptions } from '@vitreo/hub/portable';

import { simulatedObservation, simulatedSky } from './outside.ts';
import type { DemoOutside } from './outside.ts';
import type { DemoScenario } from './protocol.ts';
import { DEMO_DEVICE_ID, DEMO_LOCATION, demoConfig, demoRules } from './setup.ts';

/** "Ola de calor": the air inside, at once (°C). */
const HEAT_WAVE_C = 36;
/** "Se rompe un sensor": the first pot's, so it shows in every list. */
const BROKEN_SENSOR = { sensor: 'soil', zone: 'basil_01' } as const;

/** The device's loop: once a simulated second, as on the ESP32 and in the week run. */
const TICK_MS = 1000;
/**
 * The hub summarises every minute and looks at its warnings and weather
 * rules every 30 s of the wall clock. Here in simulated time, spaced out so
 * that a day a minute stays light: every 10 and every 5 simulated minutes
 * (at 60×, every 10 and 5 s). The weather rules also look at every new sky,
 * so a shower still closes the window at once.
 */
const SUMMARY_EVERY_MS = 10 * 60_000;
const RULES_EVERY_MS = 5 * 60_000;
/** Hours summarised at a time: the newest (the recorded week's wait their turn). */
const SUMMARY_HOURS = 2;
/** The simulated station is read every 10 minutes (AEMET observes once an hour). */
export const SKY_EVERY_MS = 10 * 60_000;

/** A message on the demo's "broker", at its simulated time (ms). */
export interface Delivery {
  topic: string;
  payload: string;
  at: number;
}

export interface EngineOptions {
  /** Simulated ms at which it starts. */
  startMs: number;
  outside: DemoOutside;
  /** The sensors' noise: fixed for the recording, different on every visit. */
  seed?: number;
  /** Where the device was at `startMs` (the recorded week's, D112). */
  memory?: SimMemory;
  /** Everything on the "broker", in order: what the page sees. */
  onMessage: (message: Delivery) => void;
  /** Everything the hub hears, in order: what the recording keeps. */
  onHubMessage?: (message: Delivery) => void;
  log?: (message: string) => void;
}

/** The recorded past, for a hub that starts now: what it heard, and from when (D112, D129). */
export interface HubPast {
  fromMs: number;
  /** Every reading from here; before it, the hourly summaries. */
  rawFromMs: number;
  messages: readonly Delivery[];
  summaries: readonly HourlySummary[];
}

/** Before the readings, the sky is kept once an hour, as AEMET observes it. */
const OLD_SKY_EVERY_MS = 60 * 60_000;

export class DemoEngine {
  private simMs: number;
  /** The hub's clock: the simulated time, or a past message's while it catches up. */
  private hubMs: number;
  private readonly device: DeviceCore;
  private readonly link: { connected: boolean } & Pick<DeviceLink, 'publish'>;
  private hub: PortableHub | null = null;
  /** What the greenhouse sent before the hub was up: it gets it all, in order. */
  private readonly waiting: Delivery[] = [];
  private next = { summary: 0, rules: 0, sky: 0 };

  constructor(private readonly options: EngineOptions) {
    this.simMs = options.startMs;
    this.hubMs = options.startMs;
    this.link = {
      connected: true,
      publish: (channel, message) => {
        this.deliver(topic(DEMO_DEVICE_ID, channel), serializeMessage(channel, message));
      },
    };
    this.device = new DeviceCore(
      { ...DEFAULT_PARAMS, location: { ...DEMO_LOCATION } },
      this.link,
      () => this.simMs,
      { outside: options.outside, ...(options.seed === undefined ? {} : { seed: options.seed }) },
    );
    if (options.memory) this.device.restore(options.memory);
    const online = statusPublication(DEMO_DEVICE_ID, 'online');
    this.deliver(online.topic, online.payload);
    // The rules it keeps, as the ESP32 keeps its config in flash: it waters
    // on its own before its hub answers (and if it never does).
    this.device.handleConfig(serializeMessage('config', demoConfig(this.simMs)));
    this.device.linked();
  }

  /** Simulated ms now. */
  get now(): number {
    return this.simMs;
  }

  /** The hub's wiring: its clock, and where its config, weather and orders go. */
  hubWiring(): Required<
    Pick<PortableHubOptions, 'now' | 'publishConfig' | 'publishWeather' | 'sendCommand'>
  > {
    return {
      now: () => this.hubMs,
      publishConfig: (config) => {
        this.device.handleConfig(serializeMessage('config', config));
      },
      publishWeather: (message) => {
        if (!message) return;
        this.options.onMessage({
          topic: topic(DEMO_DEVICE_ID, 'weather'),
          payload: serializeMessage('weather', message),
          at: this.simMs,
        });
      },
      sendCommand: (command) => {
        this.command(serializeMessage('cmd', command));
      },
    };
  }

  /**
   * The hub is up: first what it missed (the recorded week, then what the
   * greenhouse sent while it started), each at its own time; then its rules
   * as its first revision, and the sky. The week's hourly summaries follow
   * a few at a time (`catchUp`).
   */
  attach(hub: PortableHub, past?: HubPast): void {
    if (past) {
      hub.receiveSummaries(past.summaries);
      hub.receiveRecorded(past.messages);
      for (
        let at = past.fromMs;
        at < this.options.startMs;
        at += at < past.rawFromMs ? OLD_SKY_EVERY_MS : SKY_EVERY_MS
      ) {
        this.hubMs = at;
        hub.recordObservation(simulatedObservation(this.options.outside, at));
      }
    }
    for (const message of this.waiting.splice(0)) this.toHubAt(hub, message);
    this.hub = hub;
    this.hubMs = this.simMs;
    // The rules have been in force all through the recorded past, as its
    // waterings show (D129): dated when it begins, not on arrival.
    hub.context.owner.update(demoRules(), past ? past.fromMs : this.simMs);
    this.next = { summary: this.simMs, rules: this.simMs, sky: this.simMs };
    this.lookAtTheSky();
  }

  /** Somebody fills the tank up to `level` (0–1): the recording's weekly refill (D129). */
  refillTank(level: number): void {
    this.device.setTankLevel(level);
  }

  /** An order on `cmd`, the page's or the hub's own: the hub records it, the device acts. */
  command(payload: string): void {
    this.toHub({ topic: topic(DEMO_DEVICE_ID, 'cmd'), payload, at: this.simMs });
    this.device.handleCommand(payload);
  }

  /** "Probar situaciones › Lluvia": it rains from now, and the hub hears it at once. */
  rain(): void {
    this.options.outside.rain(this.simMs);
    this.lookAtTheSky();
  }

  /**
   * "Probar situaciones" (D103, D125): the simulated greenhouse's own failure
   * modes, the ones the tests use, safety limits included. Each stays until
   * "normal", which undoes them all and leaves the plants as they are.
   */
  scenario(name: DemoScenario): void {
    const device = this.device;
    switch (name) {
      case 'rain':
        this.rain();
        break;
      case 'heat':
        device.setScenario({ scenario: 'heatwave', active: true });
        device.setAirTemperature(HEAT_WAVE_C);
        break;
      case 'tank':
        device.setScenario({ scenario: 'tank_empty', active: true });
        break;
      case 'sensor':
        device.setScenario({ scenario: 'sensor_failure', active: true, target: BROKEN_SENSOR });
        break;
      case 'offline':
        this.disconnect();
        break;
      case 'normal':
        device.setScenario({ scenario: 'heatwave', active: false });
        device.setScenario({ scenario: 'tank_empty', active: false });
        device.setScenario({ scenario: 'sensor_failure', active: false, target: BROKEN_SENSOR });
        this.reconnect();
        break;
    }
  }

  /** The greenhouse stops answering: its will goes out, then its link (the device's order). */
  private disconnect(): void {
    if (!this.link.connected) return;
    const offline = statusPublication(DEMO_DEVICE_ID, 'offline');
    this.deliver(offline.topic, offline.payload);
    this.link.connected = false;
    this.device.setScenario({ scenario: 'disconnect', active: true });
  }

  private reconnect(): void {
    if (this.link.connected) return;
    this.device.setScenario({ scenario: 'disconnect', active: false });
    this.link.connected = true;
    const online = statusPublication(DEMO_DEVICE_ID, 'online');
    this.deliver(online.topic, online.payload);
    this.device.linked();
  }

  /**
   * One more hour of the recorded week summarised, if any is left: whether
   * one was. The week arrives already summarised (D129), so this only
   * redoes those hours from its readings, quietly: more than one a step
   * held the worker back for seconds after arriving.
   */
  catchUp(): boolean {
    if (!this.hub || this.hub.unsummarised() === 0) return false;
    this.hub.summarise(1);
    return true;
  }

  /** The device's memory now (D100): the recording keeps one every hour. */
  memory(): SimMemory {
    return this.device.memory();
  }

  /**
   * Simulated time moves on to `targetMs`, a second at a time (at most
   * `maxSeconds` of them): the device, then whatever the hub does by then.
   */
  advanceTo(targetMs: number, maxSeconds = Number.POSITIVE_INFINITY): void {
    let seconds = 0;
    while (this.simMs + TICK_MS <= targetMs && seconds < maxSeconds) {
      this.simMs += TICK_MS;
      this.hubMs = this.simMs;
      seconds++;
      this.device.tick();
      this.hubJobs();
    }
  }

  private hubJobs(): void {
    const hub = this.hub;
    if (!hub) return;
    const now = this.simMs;
    if (now >= this.next.summary) {
      hub.summarise(SUMMARY_HOURS);
      this.next.summary = now + SUMMARY_EVERY_MS;
    }
    if (now >= this.next.sky) this.lookAtTheSky();
    if (now >= this.next.rules) {
      hub.evaluateAlerts().catch(this.failed);
      hub.evaluateWeather().catch(this.failed);
      this.next.rules = now + RULES_EVERY_MS;
    }
  }

  /** The sky now, to the hub: stored, published, and its rules applied. */
  private lookAtTheSky(): void {
    if (!this.hub) return;
    this.hubMs = this.simMs;
    this.hub.feedWeather(simulatedSky(this.options.outside, this.simMs)).catch(this.failed);
    this.next.sky = this.simMs + SKY_EVERY_MS;
  }

  private readonly failed = (error: unknown) => {
    (this.options.log ?? console.warn)(`[vitreo] demo hub: ${String(error)}`);
  };

  /** One message on the "broker": to the page, and to the hub (which hears everything). */
  private deliver(name: string, payload: string): void {
    const message = { topic: name, payload, at: this.simMs };
    this.options.onMessage(message);
    this.toHub(message);
  }

  private toHub(message: Delivery): void {
    if (this.hub) this.toHubAt(this.hub, message);
    else this.waiting.push(message);
  }

  private toHubAt(hub: PortableHub, message: Delivery): void {
    this.hubMs = message.at;
    this.options.onHubMessage?.(message);
    hub.receive(message.topic, message.payload);
    this.hubMs = this.simMs;
  }
}
