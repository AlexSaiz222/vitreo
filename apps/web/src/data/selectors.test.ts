import { describe, expect, it } from 'vitest';

import { selectAutomationNote, selectFrost } from './selectors.ts';
import { createGreenhouseStore } from './store.ts';
import { telemetry } from './testing.ts';

const T0 = Date.parse('2026-12-15T22:00:00Z');

describe('frost protection, as the app reads it (D90)', () => {
  it('follows the device: triggered, then cleared', () => {
    const store = createGreenhouseStore('sim', T0);
    store.getState().applyTelemetry(telemetry(T0, { air: { temp: 4.2, rh: 80 } }));
    store.getState().applyEvent({
      v: 1,
      ts: T0 / 1000,
      type: 'safety.triggered',
      source: 'safety',
      limit: 'frost',
      value: 4.4,
    });
    expect(selectFrost(store.getState())).toEqual({ active: true, temp: 4.2 });
    store.getState().applyEvent({
      v: 1,
      ts: T0 / 1000 + 600,
      type: 'safety.cleared',
      source: 'safety',
      limit: 'frost',
      value: 7.1,
    });
    expect(selectFrost(store.getState()).active).toBe(false);
  });

  it('before any event this session, reads the air temperature', () => {
    const store = createGreenhouseStore('sim', T0);
    store.getState().applyTelemetry(telemetry(T0, { air: { temp: 3, rh: 80 } }));
    expect(selectFrost(store.getState())).toEqual({ active: true, temp: 3 });
    store.getState().applyTelemetry(telemetry(T0 + 60_000, { air: { temp: 12, rh: 60 } }));
    expect(selectFrost(store.getState()).active).toBe(false);
  });
});

describe('why the window moved (A6, A10)', () => {
  const closed = {
    v: 1,
    ts: T0 / 1000,
    type: 'automation.switched',
    source: 'automation',
    target: 'vent',
    value: 0,
    reason: { kind: 'weather', cause: 'rain', value: 0.4, limit: 0.1 },
  } as const;

  it('explains a close by the hub even right after you opened it, in the same second', () => {
    const store = createGreenhouseStore('sim', T0);
    store
      .getState()
      .commandSent({ v: 1, requestId: 'u1', source: 'user', action: 'vent', open: 1 }, T0 + 400);
    store.getState().applyEvent(closed);
    store.getState().applyTelemetry(telemetry(T0 + 1000));
    expect(selectAutomationNote(store.getState(), 'vent')).toEqual(closed);
  });

  it('lets a later order of yours speak instead', () => {
    const store = createGreenhouseStore('sim', T0);
    store.getState().applyEvent(closed);
    store
      .getState()
      .commandSent({ v: 1, requestId: 'u2', source: 'user', action: 'vent', open: 0 }, T0 + 2000);
    store.getState().applyTelemetry(telemetry(T0 + 3000));
    expect(selectAutomationNote(store.getState(), 'vent')).toBeNull();
  });
});
