import { commandMessage, serializeMessage, topic } from '@vitreo/shared';
import type { AckMessage, CommandMessage, CommandSource } from '@vitreo/shared';

import type { CommandEntry, GreenhouseStore } from './store.ts';

/** docs/03-diseno-ui.md: without confirmation in 5 s, tell the user calmly. */
export const ACK_TIMEOUT_MS = 5_000;

export interface CommandTransport {
  readonly connected: boolean;
  publish(topic: string, payload: string): Promise<void>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A command as the UI expresses it; the service adds version, id and source. */
export type CommandInput = DistributiveOmit<CommandMessage, 'v' | 'requestId' | 'source'>;

export interface CommandServiceOptions {
  /** Time to wait for an ack before resending. */
  attemptTimeoutMs?: number;
  /** Sends per dispatch (the first one plus automatic retries). */
  attemptsPerDispatch?: number;
  newRequestId?: () => string;
  now?: () => number;
}

interface Waiting {
  command: CommandMessage;
  attemptsLeft: number;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (entry: CommandEntry) => void;
}

/**
 * Publishes commands, waits for their ack and resends when it does not come.
 *
 * Every resend reuses the same `requestId`. The device remembers recent ids
 * and answers a repeated one with the same ack without acting twice, so a
 * lost ack can never water a plant twice.
 *
 * By default: one automatic resend after 2.5 s, then `timeout` at 5 s, and
 * the user may `retry()`. Commands are never queued while offline: a watering
 * that runs an hour late would be worse than one that fails now.
 */
export class CommandService {
  private readonly waiting = new Map<string, Waiting>();
  private readonly attemptTimeoutMs: number;
  private readonly attemptsPerDispatch: number;
  private readonly newRequestId: () => string;
  private readonly now: () => number;

  constructor(
    private readonly store: GreenhouseStore,
    private readonly transport: CommandTransport,
    options: CommandServiceOptions = {},
  ) {
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? ACK_TIMEOUT_MS / 2;
    this.attemptsPerDispatch = options.attemptsPerDispatch ?? 2;
    this.newRequestId = options.newRequestId ?? (() => crypto.randomUUID());
    this.now = options.now ?? Date.now;
  }

  send(input: CommandInput, source: CommandSource = 'user'): Promise<CommandEntry> {
    const command = commandMessage.parse({
      ...input,
      v: 1,
      requestId: this.newRequestId(),
      source,
    });
    this.store.getState().commandSent(command, this.now());
    return this.dispatch(command);
  }

  /** Sends a timed-out or failed command again, with the same `requestId`. */
  retry(requestId: string): Promise<CommandEntry> | null {
    const entry = this.store.getState().commands[requestId];
    if (!entry || (entry.status !== 'timeout' && entry.status !== 'failed')) return null;
    this.store.getState().commandRetried(requestId);
    return this.dispatch(entry.command);
  }

  handleAck(ack: AckMessage): void {
    this.store.getState().applyAck(ack, this.now());
    this.finish(ack.requestId);
  }

  dispose(): void {
    for (const waiting of this.waiting.values()) {
      if (waiting.timer) clearTimeout(waiting.timer);
    }
    this.waiting.clear();
  }

  private dispatch(command: CommandMessage): Promise<CommandEntry> {
    return new Promise((resolve) => {
      this.waiting.set(command.requestId, {
        command,
        attemptsLeft: this.attemptsPerDispatch,
        timer: null,
        resolve,
      });
      this.attempt(command.requestId);
    });
  }

  private attempt(requestId: string): void {
    const waiting = this.waiting.get(requestId);
    if (!waiting) return;
    const state = this.store.getState();
    if (!this.transport.connected || state.device.state === 'offline') {
      this.fail(requestId);
      return;
    }

    waiting.attemptsLeft--;
    this.transport
      .publish(topic(state.deviceId, 'cmd'), serializeMessage('cmd', waiting.command))
      .catch(() => {
        this.fail(requestId);
      });

    waiting.timer = setTimeout(() => {
      waiting.timer = null;
      if (waiting.attemptsLeft > 0) {
        this.store.getState().commandRetried(requestId);
        this.attempt(requestId);
      } else {
        this.store.getState().commandSettled(requestId, 'timeout', this.now());
        this.finish(requestId);
      }
    }, this.attemptTimeoutMs);
  }

  private fail(requestId: string): void {
    this.store.getState().commandSettled(requestId, 'failed', this.now(), 'offline');
    this.finish(requestId);
  }

  private finish(requestId: string): void {
    const waiting = this.waiting.get(requestId);
    if (!waiting) return;
    if (waiting.timer) clearTimeout(waiting.timer);
    this.waiting.delete(requestId);
    const entry = this.store.getState().commands[requestId];
    if (entry) waiting.resolve(entry);
  }
}
