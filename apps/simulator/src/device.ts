import { RETAINED, serializeMessage, topic } from '@vitreo/shared';
import type { Channel, MessageFor } from '@vitreo/shared';
import { DeviceCore, statusPublication } from '@vitreo/sim-core';
import type { DeviceLink, ScenarioChange, SimParams, SimSnapshot } from '@vitreo/sim-core';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';

import type { SimulatorConfig } from './config.ts';
import { readMemory, writeMemory } from './memory.ts';

const TICK_MS = 1000;
/** The memory on disk (D100) is written this often, and on a clean stop. */
const SAVE_EVERY_MS = 60_000;

/**
 * The simulated ESP32 on the network: the device of `@vitreo/sim-core`
 * (model, safety limits, events kept while offline) over MQTT.
 */
export class SimulatedDevice {
  private readonly core: DeviceCore;
  private client: MqttClient | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastSavedMs = 0;

  constructor(
    private readonly config: SimulatorConfig,
    params: SimParams,
    private readonly now: () => number = Date.now,
  ) {
    const connected = () => this.client?.connected ?? false;
    const link: DeviceLink = {
      get connected() {
        return connected();
      },
      publish: (channel, message) => {
        this.publish(channel, message);
      },
    };
    this.core = new DeviceCore(params, link, now);
    const memory = config.stateFile ? readMemory(config.stateFile) : null;
    if (memory) {
      this.core.restore(memory);
      const away = Math.round((now() - memory.savedAt) / 60_000);
      console.info(
        `[simulator] carrying on from ${config.stateFile ?? ''} (${away.toString()} min away)`,
      );
    }
    this.lastSavedMs = now();
  }

  /** Keeps the greenhouse on disk (D100), when this simulator has a file. */
  private save(): void {
    if (!this.config.stateFile) return;
    try {
      writeMemory(this.config.stateFile, this.core.memory());
      this.lastSavedMs = this.now();
    } catch (error) {
      console.error('[simulator] could not keep the greenhouse on disk', error);
    }
  }

  start(): void {
    this.connect();
    this.timer = setInterval(() => {
      this.core.tick();
      if (this.now() - this.lastSavedMs >= SAVE_EVERY_MS) this.save();
    }, TICK_MS);
  }

  /** Clean shutdown: announce `offline` ourselves, since a clean disconnect skips the will. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.save();
    const client = this.client;
    if (!client) return;
    if (client.connected) {
      const offline = statusPublication(this.config.deviceId, 'offline');
      await client.publishAsync(offline.topic, offline.payload, {
        qos: offline.qos,
        retain: offline.retain,
      });
    }
    await client.endAsync();
  }

  snapshot(): SimSnapshot & { connected: boolean } {
    return { ...this.core.snapshot(), connected: this.client?.connected ?? false };
  }

  setScenario(change: ScenarioChange): void {
    if (change.scenario === 'disconnect') {
      if (change.active === this.core.isDisconnected) return;
      if (change.active) {
        // Drop the link without a DISCONNECT packet, like a device losing Wi-Fi:
        // the broker then publishes the Last Will.
        this.dropConnection();
        this.core.setScenario(change);
      } else {
        this.core.setScenario(change);
        this.connect();
      }
      return;
    }
    this.core.setScenario(change);
  }

  /**
   * Development only: a fresh greenhouse, as if just started (moisture, tank,
   * scenarios, broken sensors, pump history). The tests use it so no state
   * carries over from one test to the next.
   */
  reset(): void {
    const wasDisconnected = this.core.isDisconnected;
    this.core.reset();
    if (wasDisconnected) this.connect();
  }

  /** Development only: the pump has used its whole hourly budget (to show the limit). */
  useUpPumpBudget(): void {
    this.core.useUpPumpBudget();
  }

  setSoilMoisture(zone: string, moisture: number): boolean {
    return this.core.setSoilMoisture(zone, moisture);
  }

  /** Development only: the air at this temperature now (heat or frost at once, for tests). */
  setAirTemperature(tempC: number): void {
    this.core.setAirTemperature(tempC);
  }

  setTankLevel(level: number): void {
    this.core.setTankLevel(level);
  }

  private connect(): void {
    const { deviceId, mqttUrl, username, password } = this.config;
    const online = statusPublication(deviceId, 'online');
    const client = mqtt.connect(mqttUrl, {
      clientId: `vitreo-simulator-${deviceId}`,
      username,
      password,
      reconnectPeriod: 5_000,
      will: statusPublication(deviceId, 'offline'),
    });
    this.client = client;

    client.on('connect', () => {
      console.info(`[simulator] connected to ${mqttUrl} as ${deviceId}`);
      client.publish(online.topic, online.payload, { qos: online.qos, retain: online.retain });
      client.subscribe(topic(deviceId, 'cmd'), { qos: 1 });
      // Retained: the current config arrives on every connection (A6).
      client.subscribe(topic(deviceId, 'config'), { qos: 1 });
      this.core.linked();
    });
    client.on('message', (name, payload) => {
      if (name === topic(deviceId, 'config')) this.core.handleConfig(payload.toString());
      else this.core.handleCommand(payload.toString());
    });
    client.on('close', () => {
      // An unexpected drop: temporary actuators return to their safe state.
      if (this.client === client) this.core.linkLost();
    });
    client.on('reconnect', () => {
      console.info('[simulator] reconnecting…');
    });
    client.on('error', (error) => {
      console.warn(`[simulator] ${error.message}`);
    });
  }

  private dropConnection(): void {
    const client = this.client;
    this.client = null;
    client?.end(true);
    console.info('[simulator] connection dropped (disconnect scenario)');
  }

  private publish<C extends Channel>(channel: C, message: MessageFor<C>): void {
    const client = this.client;
    if (!client?.connected) return;
    client.publish(topic(this.config.deviceId, channel), serializeMessage(channel, message), {
      qos: 1,
      retain: RETAINED[channel],
    });
  }
}
