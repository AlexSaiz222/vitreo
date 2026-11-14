import { describe, expect, it } from 'vitest';

import { createCueGate, cuesBetween } from './deviceCues.ts';
import type { DeviceState } from './deviceCues.ts';

const still: DeviceState = { live: true, pump: false, growLight: false, fan: false, vent: 0 };

describe('cuesBetween', () => {
  it('says nothing when nothing changed', () => {
    expect(cuesBetween(still, { ...still })).toEqual([]);
  });

  it('hears the first reading of a visit as how things already were', () => {
    expect(cuesBetween(null, { ...still, fan: true, pump: true })).toEqual([]);
  });

  it('hears nothing without fresh data, on either side of the change', () => {
    expect(cuesBetween(still, { ...still, fan: true, live: false })).toEqual([]);
    expect(cuesBetween({ ...still, live: false }, { ...still, fan: true })).toEqual([]);
  });

  it('hears the pump, the relay and the fan, each way', () => {
    expect(cuesBetween(still, { ...still, pump: true })).toEqual(['pump-start']);
    expect(cuesBetween({ ...still, pump: true }, still)).toEqual(['pump-stop']);
    expect(cuesBetween(still, { ...still, growLight: true })).toEqual(['relay']);
    expect(cuesBetween({ ...still, growLight: true }, still)).toEqual(['relay']);
    expect(cuesBetween(still, { ...still, fan: true })).toEqual(['fan-up']);
    expect(cuesBetween({ ...still, fan: true }, still)).toEqual(['fan-down']);
  });

  it('hears the window for as long as it travels, ignoring a servo that holds', () => {
    expect(cuesBetween(still, { ...still, vent: 0.01 })).toEqual([]);
    const full = cuesBetween(still, { ...still, vent: 1 })[0];
    const half = cuesBetween({ ...still, vent: 1 }, { ...still, vent: 0.5 })[0];
    expect(full).toMatchObject({ kind: 'window', seconds: 2.2 });
    expect(half).toMatchObject({ kind: 'window', seconds: 1.1 });
    expect(cuesBetween(still, { ...still, vent: 0.05 })[0]).toMatchObject({ seconds: 0.5 });
  });

  it('hears several things that change together', () => {
    expect(cuesBetween(still, { ...still, fan: true, growLight: true })).toEqual([
      'relay',
      'fan-up',
    ]);
  });
});

describe('createCueGate', () => {
  it('lets a sound rest before it plays again, each on its own', () => {
    const gate = createCueGate(1000);
    expect(gate('relay', 0)).toBe(true);
    expect(gate('relay', 500)).toBe(false);
    expect(gate('fan-up', 500)).toBe(true);
    expect(gate('relay', 1000)).toBe(true);
  });

  it('counts a window as one sound, whatever its length', () => {
    const gate = createCueGate(1000);
    expect(gate({ kind: 'window', seconds: 2 }, 0)).toBe(true);
    expect(gate({ kind: 'window', seconds: 1 }, 100)).toBe(false);
  });

  it('never holds back a pump stopping, or it would sound as if it ran on', () => {
    const gate = createCueGate(1000);
    expect(gate('pump-stop', 0)).toBe(true);
    expect(gate('pump-stop', 1)).toBe(true);
  });
});
