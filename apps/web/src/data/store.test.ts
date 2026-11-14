import type { EventMessage } from '@vitreo/shared';
import { describe, expect, it, vi } from 'vitest';

import { selectFreshness, selectLastWateringCommand, selectSoilMoisture } from './selectors.ts';
import {
  createGreenhouseStore,
  setWateringOnWallClock,
  STALE_AFTER_MS,
  wateringElapsedMs,
} from './store.ts';
import { telemetry } from './testing.ts';

const T0 = Date.parse('2026-09-30T12:00:00Z');

function connectedStore() {
  const store = createGreenhouseStore('sim', T0);
  store.getState().setLink('connected', T0);
  store.getState().applyStatus({ v: 1, state: 'online' }, T0);
  return store;
}

describe('freshness', () => {
  it('waits until the first telemetry arrives', () => {
    expect(selectFreshness(connectedStore().getState())).toEqual({ kind: 'waiting' });
  });

  it('is live with recent telemetry', () => {
    const store = connectedStore();
    store.getState().applyTelemetry(telemetry(T0));
    expect(selectFreshness(store.getState())).toEqual({ kind: 'live' });
  });

  it('becomes stale after two minutes without telemetry, even with no new messages', () => {
    const store = connectedStore();
    store.getState().applyTelemetry(telemetry(T0));
    store.getState().tick(T0 + STALE_AFTER_MS + 1000);
    expect(selectFreshness(store.getState())).toEqual({ kind: 'stale', since: T0 });
  });

  it('treats a retained but old snapshot as stale', () => {
    const store = connectedStore();
    store.getState().applyTelemetry(telemetry(T0 - 60 * 60_000));
    store.getState().tick(T0);
    expect(selectFreshness(store.getState())).toMatchObject({ kind: 'stale' });
  });

  it('reports a device that went offline, since its last data', () => {
    const store = connectedStore();
    store.getState().applyTelemetry(telemetry(T0));
    store.getState().applyStatus({ v: 1, state: 'offline' }, T0 + 5000);
    expect(selectFreshness(store.getState())).toEqual({
      kind: 'disconnected',
      reason: 'device',
      since: T0,
    });
  });

  it('reports our own broker link going down', () => {
    const store = connectedStore();
    store.getState().applyTelemetry(telemetry(T0));
    store.getState().setLink('reconnecting', T0 + 1000);
    expect(selectFreshness(store.getState())).toMatchObject({
      kind: 'disconnected',
      reason: 'broker',
    });
  });
});

describe('telemetry', () => {
  it('keeps a broken sensor as null instead of a value', () => {
    const store = connectedStore();
    store.getState().applyTelemetry(telemetry(T0));
    expect(selectSoilMoisture(store.getState(), 'basil_01')).toBe(0.4);
    expect(selectSoilMoisture(store.getState(), 'parsley_01')).toBeNull();
    expect(selectSoilMoisture(store.getState(), 'unknown_01')).toBeNull();
  });

  it('never moves back in time', () => {
    const store = connectedStore();
    store.getState().applyTelemetry(telemetry(T0 + 60_000));
    store.getState().applyTelemetry(telemetry(T0));
    expect(store.getState().telemetry?.ts).toBe((T0 + 60_000) / 1000);
  });
});

describe('watering events', () => {
  const started: EventMessage = {
    v: 1,
    ts: T0 / 1000,
    type: 'watering.started',
    source: 'user',
    zone: 'basil_01',
    seconds: 5,
  };

  it('tracks a watering from start to finish', () => {
    const store = connectedStore();
    store.getState().applyEvent(started);
    expect(store.getState().watering['basil_01']).toMatchObject({ seconds: 5, startedAt: T0 });
    store.getState().applyEvent({ ...started, type: 'watering.finished', seconds: 5 });
    expect(store.getState().watering['basil_01']).toBeUndefined();
    expect(store.getState().events).toHaveLength(2);
  });

  it('clears waterings when telemetry says the pump is off', () => {
    const store = connectedStore();
    store.getState().applyEvent(started);
    store.getState().applyTelemetry(telemetry(T0 + 10_000));
    expect(store.getState().watering).toEqual({});
  });

  it('in the demo, a watering lasts its seconds of the visitor’s clock (D128)', () => {
    vi.useFakeTimers({ now: T0 });
    setWateringOnWallClock(true);
    try {
      const store = connectedStore();
      store.getState().applyEvent(started);
      // At 60× the device is done within a blink…
      store.getState().applyEvent({ ...started, type: 'watering.finished', seconds: 5 });
      const shown = store.getState().watering['basil_01'];
      expect(shown).toBeDefined();
      vi.advanceTimersByTime(2000);
      if (shown) expect(wateringElapsedMs(shown, 0)).toBe(2000);
      expect(store.getState().watering['basil_01']).toBeDefined();
      // …and the screen keeps it for its 5 s.
      vi.advanceTimersByTime(3000);
      expect(store.getState().watering['basil_01']).toBeUndefined();
    } finally {
      setWateringOnWallClock(false);
      vi.useRealTimers();
    }
  });

  it('"Detener" ends a watering on screen once the pump is off, never while it runs', () => {
    vi.useFakeTimers({ now: T0 });
    setWateringOnWallClock(true);
    try {
      const store = connectedStore();
      const running = telemetry(T0);
      store.getState().applyTelemetry({
        ...running,
        actuators: { ...running.actuators, pump: true },
      });
      store.getState().applyEvent(started);
      store.getState().stopShowingWatering('basil_01');
      expect(store.getState().watering['basil_01']).toBeDefined();
      store.getState().applyTelemetry(telemetry(T0 + 1000));
      store.getState().stopShowingWatering('basil_01');
      expect(store.getState().watering['basil_01']).toBeUndefined();
    } finally {
      setWateringOnWallClock(false);
      vi.useRealTimers();
    }
  });

  it('keeps only the latest events', () => {
    const store = connectedStore();
    for (let i = 0; i < 80; i++) store.getState().applyEvent({ ...started, ts: T0 / 1000 + i });
    expect(store.getState().events).toHaveLength(50);
    expect(store.getState().events.at(-1)?.ts).toBe(T0 / 1000 + 79);
  });
});

describe('commands', () => {
  it('finds the latest watering command for a zone', () => {
    const store = connectedStore();
    const water = (requestId: string) =>
      ({ v: 1, requestId, source: 'user', action: 'water', zone: 'basil_01', seconds: 5 }) as const;
    store.getState().commandSent(water('a'), T0);
    store.getState().commandSent(water('b'), T0 + 1000);
    expect(selectLastWateringCommand(store.getState(), 'basil_01')?.command.requestId).toBe('b');
    expect(selectLastWateringCommand(store.getState(), 'parsley_01')).toBeNull();
  });
});
