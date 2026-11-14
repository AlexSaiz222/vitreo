import { parseMessage } from '@vitreo/shared';
import type { AckMessage, CommandMessage } from '@vitreo/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandService } from './commands.ts';
import type { CommandTransport } from './commands.ts';
import { createGreenhouseStore } from './store.ts';

class FakeTransport implements CommandTransport {
  connected = true;
  sent: { topic: string; command: CommandMessage }[] = [];
  failNext = false;

  publish(topic: string, payload: string): Promise<void> {
    if (this.failNext) return Promise.reject(new Error('socket closed'));
    const parsed = parseMessage('cmd', payload);
    if (!parsed.ok) throw new Error(parsed.error);
    this.sent.push({ topic, command: parsed.message });
    return Promise.resolve();
  }
}

const water = { action: 'water', zone: 'basil_01', seconds: 5 } as const;

function setup() {
  const store = createGreenhouseStore('sim', 0);
  store.getState().setLink('connected', 0);
  store.getState().applyStatus({ v: 1, state: 'online' }, 0);
  const transport = new FakeTransport();
  let id = 0;
  const service = new CommandService(store, transport, {
    newRequestId: () => `req${(++id).toString()}`,
    now: () => Date.now(),
  });
  const ack = (requestId: string, result: 'ok' | 'rejected' = 'ok'): AckMessage =>
    result === 'ok'
      ? { v: 1, requestId, ts: 0, source: 'user', result }
      : { v: 1, requestId, ts: 0, source: 'user', result, reason: 'tank_empty' };
  return { store, transport, service, ack };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('CommandService', () => {
  it('publishes a versioned command with source to the device cmd topic', () => {
    const { transport, service, store } = setup();
    void service.send(water);
    expect(transport.sent).toEqual([
      {
        topic: 'vitreo/sim/cmd',
        command: { v: 1, requestId: 'req1', source: 'user', ...water },
      },
    ]);
    expect(store.getState().commands['req1']?.status).toBe('pending');
  });

  it('resolves as confirmed when the ack arrives', async () => {
    const { service, ack } = setup();
    const result = service.send(water);
    service.handleAck(ack('req1'));
    await expect(result).resolves.toMatchObject({ status: 'confirmed', attempts: 1 });
  });

  it('resolves as rejected with the device reason', async () => {
    const { service, ack } = setup();
    const result = service.send(water);
    service.handleAck(ack('req1', 'rejected'));
    await expect(result).resolves.toMatchObject({ status: 'rejected', reason: 'tank_empty' });
  });

  it('resends once with the same requestId, then times out at 5 s', async () => {
    const { service, transport } = setup();
    const result = service.send(water);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(transport.sent.map((s) => s.command.requestId)).toEqual(['req1', 'req1']);

    await vi.advanceTimersByTimeAsync(2_500);
    await expect(result).resolves.toMatchObject({ status: 'timeout', attempts: 2 });
    expect(transport.sent).toHaveLength(2);
  });

  it('accepts an ack for the resent command', async () => {
    const { service, ack } = setup();
    const result = service.send(water);
    await vi.advanceTimersByTimeAsync(3_000);
    service.handleAck(ack('req1'));
    await expect(result).resolves.toMatchObject({ status: 'confirmed', attempts: 2 });
  });

  it('lets the user retry a timed-out command, keeping its requestId', async () => {
    const { service, transport, ack } = setup();
    await Promise.all([service.send(water), vi.advanceTimersByTimeAsync(5_000)]);

    const retried = service.retry('req1');
    expect(retried).not.toBeNull();
    service.handleAck(ack('req1'));
    await expect(retried).resolves.toMatchObject({ status: 'confirmed', attempts: 3 });
    expect(new Set(transport.sent.map((s) => s.command.requestId))).toEqual(new Set(['req1']));
  });

  it('does not retry a confirmed command', async () => {
    const { service, ack } = setup();
    const result = service.send(water);
    service.handleAck(ack('req1'));
    await result;
    expect(service.retry('req1')).toBeNull();
  });

  it('a late ack after the timeout still counts', async () => {
    const { service, store, ack } = setup();
    await Promise.all([service.send(water), vi.advanceTimersByTimeAsync(5_000)]);
    service.handleAck(ack('req1'));
    expect(store.getState().commands['req1']?.status).toBe('confirmed');
  });

  it('fails fast instead of queueing when the broker link is down', async () => {
    const { service, transport } = setup();
    transport.connected = false;
    await expect(service.send(water)).resolves.toMatchObject({
      status: 'failed',
      reason: 'offline',
    });
    expect(transport.sent).toHaveLength(0);
  });

  it('fails fast when the device is offline', async () => {
    const { service, store } = setup();
    store.getState().applyStatus({ v: 1, state: 'offline' }, 0);
    await expect(service.send(water)).resolves.toMatchObject({ status: 'failed' });
  });

  it('fails when publishing fails', async () => {
    const { service, transport } = setup();
    transport.failNext = true;
    await expect(service.send(water)).resolves.toMatchObject({ status: 'failed' });
  });

  it('refuses invalid input before sending', () => {
    const { service, transport } = setup();
    expect(() => service.send({ ...water, seconds: 60 })).toThrow();
    expect(transport.sent).toHaveLength(0);
  });

  it('marks commands from automations with their source', () => {
    const { service, transport } = setup();
    void service.send({ action: 'growLight', on: true }, 'automation');
    expect(transport.sent[0]?.command.source).toBe('automation');
  });
});
