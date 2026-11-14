import type {
  AckMessage,
  CommandMessage,
  EventMessage,
  RejectReason,
  SafetyLimit,
  StatusMessage,
  TelemetryMessage,
  WeatherMessage,
} from '@vitreo/shared';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';

/** docs/06-gemelo-digital.md: data older than this is shown as stale. */
export const STALE_AFTER_MS = 2 * 60_000;
const MAX_EVENTS = 50;
const MAX_SETTLED_COMMANDS = 20;

/** State of our own link to the broker. */
export type BrokerLink = 'unconfigured' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

export type CommandStatus = 'pending' | 'confirmed' | 'rejected' | 'timeout' | 'failed';

export interface CommandEntry {
  command: CommandMessage;
  status: CommandStatus;
  attempts: number;
  sentAt: number;
  settledAt: number | null;
  /** Why the device rejected it, or `offline` if it could not even be sent. */
  reason: RejectReason | 'offline' | null;
  /** The safety limit that stopped it, if the device said (D85). */
  limit: SafetyLimit | null;
  /** When it can be tried again (local ms), if the limit is temporary (D85). */
  retryAt: number | null;
}

export interface ActiveWatering {
  seconds: number;
  /** Local time (ms) the pump started, from the event timestamp. */
  startedAt: number;
  /** When it appeared on screen (wall clock, ms), for the demo's minimum (D126). */
  shownAt: number;
}

export interface GreenhouseState {
  deviceId: string;
  link: BrokerLink;
  linkChangedAt: number | null;
  device: { state: 'unknown' | StatusMessage['state']; receivedAt: number | null };
  telemetry: TelemetryMessage | null;
  /** Outdoor weather from the hub (A10), or null: none, or the hub cleared it. */
  weather: WeatherMessage | null;
  events: EventMessage[];
  watering: Partial<Record<string, ActiveWatering>>;
  commands: Partial<Record<string, CommandEntry>>;
  /** Refreshed periodically so staleness is re-evaluated without new data. */
  now: number;
  /**
   * Data older than this is stale: STALE_AFTER_MS, the same 2 minutes of
   * the wall clock in the demo whatever its speed (D112), so × the speed.
   */
  staleAfterMs: number;

  setLink(link: BrokerLink, at: number): void;
  applyStatus(message: StatusMessage, at: number): void;
  applyTelemetry(message: TelemetryMessage): void;
  applyWeather(message: WeatherMessage | null): void;
  applyEvent(message: EventMessage): void;
  commandSent(command: CommandMessage, at: number): void;
  commandRetried(requestId: string): void;
  commandSettled(
    requestId: string,
    status: Exclude<CommandStatus, 'pending'>,
    at: number,
    reason?: CommandEntry['reason'],
    details?: Pick<CommandEntry, 'limit' | 'retryAt'>,
  ): void;
  applyAck(ack: AckMessage, at: number): void;
  tick(now: number): void;
  setStaleAfter(ms: number): void;
  /**
   * "Detener" pressed: a watering still on screen after the pump stopped
   * (the demo's wall clock, D128) goes at once. While the pump runs it
   * stays, until the device says it finished.
   */
  stopShowingWatering(zone: string): void;
}

export type GreenhouseStore = StoreApi<GreenhouseState>;

/**
 * The single source of truth for the device state. It is fed by MQTT (see
 * `mqttClient.ts`); the scene and the UI only read from it.
 */
/**
 * How a watering is timed on screen. At home, by the device's clock: the
 * truth, to the second. In the demo (D126, D128) time runs at 60× or 1440×
 * and a 5 s watering lasts 80 ms: nobody would see it, and "5 s" would be a
 * lie to whoever pressed it. There it lasts its seconds of the visitor's
 * clock, from the moment it appears. Set by the demo's link.
 */
let wateringOnWallClock = false;

export function setWateringOnWallClock(on: boolean): void {
  wateringOnWallClock = on;
}

/** How far into its seconds a watering is (ms), as the screen tells it. */
export function wateringElapsedMs(watering: ActiveWatering, now: number): number {
  return wateringOnWallClock ? Date.now() - watering.shownAt : now - watering.startedAt;
}

export function createGreenhouseStore(deviceId: string, now = Date.now()): GreenhouseStore {
  return createStore<GreenhouseState>()((set, get) => {
    const endWatering = (zone: string) => {
      const shown = get().watering[zone];
      if (!shown) return;
      const remove = () => {
        const { [zone]: current, ...rest } = get().watering;
        if (current === shown) set({ watering: rest });
      };
      const wait = wateringOnWallClock ? shown.seconds * 1000 - (Date.now() - shown.shownAt) : 0;
      if (wait > 0) setTimeout(remove, wait);
      else remove();
    };
    return {
      deviceId,
      link: 'connecting',
      linkChangedAt: now,
      device: { state: 'unknown', receivedAt: null },
      telemetry: null,
      weather: null,
      events: [],
      watering: {},
      commands: {},
      now,
      staleAfterMs: STALE_AFTER_MS,

      setLink(link, at) {
        if (get().link === link) return;
        set({ link, linkChangedAt: at });
      },

      applyStatus(message, at) {
        set({ device: { state: message.state, receivedAt: at } });
      },

      applyWeather(message) {
        set({ weather: message });
      },

      applyTelemetry(message) {
        const current = get().telemetry;
        // Retained or late messages must never move time backwards.
        if (current && message.ts < current.ts) return;
        set({ telemetry: message });
        // A stopped pump means nothing is watering, whatever events were missed.
        if (!message.actuators.pump) Object.keys(get().watering).forEach(endWatering);
      },

      applyEvent(message) {
        const events = [...get().events, message].slice(-MAX_EVENTS);
        if (message.type === 'watering.started') {
          set({
            events,
            watering: {
              ...get().watering,
              [message.zone]: {
                seconds: message.seconds,
                startedAt: message.ts * 1000,
                shownAt: Date.now(),
              },
            },
          });
        } else if (message.type === 'watering.finished') {
          set({ events });
          endWatering(message.zone);
        } else {
          set({ events });
        }
      },

      commandSent(command, at) {
        set({
          commands: prune({
            ...get().commands,
            [command.requestId]: {
              command,
              status: 'pending',
              attempts: 1,
              sentAt: at,
              settledAt: null,
              reason: null,
              limit: null,
              retryAt: null,
            },
          }),
        });
      },

      commandRetried(requestId) {
        const entry = get().commands[requestId];
        if (!entry) return;
        set({
          commands: {
            ...get().commands,
            [requestId]: {
              ...entry,
              status: 'pending',
              attempts: entry.attempts + 1,
              settledAt: null,
            },
          },
        });
      },

      commandSettled(requestId, status, at, reason = null, details) {
        const entry = get().commands[requestId];
        if (!entry) return;
        const { limit = null, retryAt = null } = details ?? {};
        set({
          commands: {
            ...get().commands,
            [requestId]: { ...entry, status, settledAt: at, reason, limit, retryAt },
          },
        });
      },

      applyAck(ack, at) {
        // A late ack still wins over a timeout: the device did answer.
        if (ack.result === 'ok') get().commandSettled(ack.requestId, 'confirmed', at);
        else {
          get().commandSettled(ack.requestId, 'rejected', at, ack.reason, {
            limit: ack.limit ?? null,
            retryAt: ack.retryAt === undefined ? null : ack.retryAt * 1000,
          });
        }
      },

      tick(time) {
        set({ now: time });
      },

      setStaleAfter(ms) {
        set({ staleAfterMs: ms });
      },

      stopShowingWatering(zone) {
        if (get().telemetry?.actuators.pump) return;
        const { [zone]: _gone, ...rest } = get().watering;
        set({ watering: rest });
      },
    };
  });
}

/** Keeps pending commands and only the most recent settled ones. */
function prune(commands: GreenhouseState['commands']): GreenhouseState['commands'] {
  const entries = Object.entries(commands).filter(
    (entry): entry is [string, CommandEntry] => entry[1] !== undefined,
  );
  const settled = entries
    .filter(([, entry]) => entry.status !== 'pending')
    .sort(([, a], [, b]) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
    .slice(0, MAX_SETTLED_COMMANDS);
  const pending = entries.filter(([, entry]) => entry.status === 'pending');
  return Object.fromEntries([...pending, ...settled]);
}
