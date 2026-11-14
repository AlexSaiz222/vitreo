import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { e2eStack } from '../playwright.config.ts';

/** This worker's own stack (playwright.config.ts): never the one in daily use. */
const STACK = e2eStack(Number(process.env['TEST_PARALLEL_INDEX'] ?? 0));
/** The tests' own simulator. */
export const CONTROL = `http://127.0.0.1:${STACK.controlPort.toString()}`;
/** The tests' own hub (A4), keeping this worker's device in a throwaway database. */
export const HUB = `http://127.0.0.1:${STACK.hubPort.toString()}/api/v1`;
const PLANTS = ['basil_01', 'parsley_01', 'lettuce_01', 'strawberry_01', 'chives_01', 'tomato_01'];

/** The hub as new: species names, no sowing days, the repository's location. */
export async function resetHub(request: APIRequestContext): Promise<void> {
  for (const zone of PLANTS) {
    const response = await request.patch(`${HUB}/plants/${zone}`, {
      data: { name: null, sownAt: null },
    });
    expect(response.ok()).toBe(true);
  }
  // No history, warnings or subscriptions from earlier tests (A5, A7).
  const reset = await request.post(`${HUB}/test/reset`);
  expect(reset.ok()).toBe(true);
  // Every automation off, as a new greenhouse (A6).
  const config = await request.post(`${HUB}/test/reset-config`);
  expect(config.ok()).toBe(true);
  const location = await request.put(`${HUB}/settings/location`, {
    data: { lat: 40.42, lng: -3.7 },
  });
  expect(location.ok()).toBe(true);
}

/** The same starting point for every run, so captures are comparable. */
export const BASELINE_MOISTURE: Record<string, number> = {
  basil_01: 0.55,
  parsley_01: 0.62,
  lettuce_01: 0.5,
  strawberry_01: 0.4,
  chives_01: 0.6,
  tomato_01: 0.52,
};

export async function resetSimulator(request: APIRequestContext): Promise<void> {
  // A fresh greenhouse: no pump history (hourly limit), scenarios or broken sensors.
  const reset = await request.post(`${CONTROL}/reset`);
  expect(reset.ok()).toBe(true);
  for (const scenario of ['heatwave', 'tank_empty', 'disconnect']) {
    await request.post(`${CONTROL}/scenario`, { data: { scenario, active: false } });
  }
  for (const sensor of ['air', 'light', 'tank']) {
    await request.post(`${CONTROL}/scenario`, {
      data: { scenario: 'sensor_failure', active: false, sensor },
    });
  }
  for (const [zone, moisture] of Object.entries(BASELINE_MOISTURE)) {
    await request.post(`${CONTROL}/scenario`, {
      data: { scenario: 'sensor_failure', active: false, sensor: 'soil', zone },
    });
    await request.post(`${CONTROL}/soil`, { data: { zone, moisture } });
  }
  await request.post(`${CONTROL}/tank`, { data: { level: 0.8 } });
  await resetHub(request);
}

export async function setSoil(request: APIRequestContext, zone: string, moisture: number) {
  const response = await request.post(`${CONTROL}/soil`, { data: { zone, moisture } });
  expect(response.ok()).toBe(true);
}

/** Opens the app and waits for live data and a rendered scene. */
export async function openLive(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('.status')).toHaveAttribute('data-freshness', 'live', {
    timeout: 15_000,
  });
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-scene-ready') === 'true',
    null,
    {
      timeout: 30_000,
    },
  );
}

export interface SeededHistory {
  /** The gap (PC off), Unix s. */
  gap: { start: number; end: number };
  /** Basil's waterings (Unix s) and who started them. */
  waterings: { t: number; source: 'user' | 'automation' }[];
}

/**
 * A believable week in the tests' hub (A5): readings every 5 minutes with a
 * day/night cycle, the basil drying past its threshold and watered back (by
 * you and by automation), and six hours with nothing (the PC was off). The
 * same shape every run, relative to now.
 */
export async function seedHistory(
  request: APIRequestContext,
  options: { days?: number; now?: number } = {},
): Promise<SeededHistory> {
  const reset = await request.post(`${HUB}/test/reset`);
  expect(reset.ok()).toBe(true);
  const days = options.days ?? 7;
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const step = 300;
  const start = now - days * 86_400;
  const gap = { start: now - 14 * 3600, end: now - 8 * 3600 };
  const waterings: SeededHistory['waterings'] = [];
  const messages: { channel: 'telemetry' | 'event'; message: unknown }[] = [];
  let basil = 0.62;
  let tank = 0.9;
  for (let t = start; t <= now - 60; t += step) {
    const hour = new Date(t * 1000).getUTCHours() + 2;
    const daytime = hour % 24 >= 8 && hour % 24 < 20;
    const sun = Math.max(0, Math.sin((((hour % 24) - 6) / 12) * Math.PI));
    // Drier by day; watered when it gets thirsty (alternating who waters).
    basil -= daytime ? 0.00175 : 0.0006;
    if (basil < 0.35) {
      const source = waterings.length % 2 === 0 ? 'user' : 'automation';
      const basilBefore = basil;
      basil = 0.66;
      tank = Math.max(0.15, tank - 0.05);
      // With the PC off the hub never heard of it: no event, as in reality.
      if (t >= gap.start && t < gap.end) continue;
      waterings.push({ t, source });
      messages.push({
        channel: 'event',
        message: {
          v: 1,
          ts: t,
          type: 'watering.started',
          source,
          zone: 'basil_01',
          seconds: 5,
          ...(source === 'user'
            ? { requestId: `seed-${t.toString()}` }
            : {
                // Why, as the device says it (A6).
                reason: {
                  kind: 'soil',
                  moisture: Math.floor(basilBefore * 100) / 100,
                  threshold: 0.35,
                },
              }),
        },
      });
    }
    if (t >= gap.start && t < gap.end) continue;
    const hot = sun > 0.8;
    messages.push({
      channel: 'telemetry',
      message: {
        v: 1,
        ts: t,
        air: { temp: Math.round((17 + 9 * sun) * 10) / 10, rh: Math.round(70 - 20 * sun) },
        light: { lux: Math.round(sun * 20_000) },
        soil: [
          { id: 'basil_01', moisture: Math.round(basil * 1000) / 1000, cal: 1 },
          { id: 'parsley_01', moisture: 0.58, cal: 1 },
          { id: 'lettuce_01', moisture: 0.52, cal: 1 },
          { id: 'strawberry_01', moisture: 0.45, cal: 1 },
          { id: 'chives_01', moisture: 0.6, cal: 1 },
          { id: 'tomato_01', moisture: 0.5, cal: 1 },
        ],
        tank: { level: Math.round(tank * 100) / 100 },
        actuators: {
          pump: false,
          growLight: hour % 24 >= 7 && hour % 24 < 21 && sun < 0.3,
          fan: hot,
          vent: hot ? 0.8 : daytime ? 0.3 : 0,
        },
        fw: '0.4.0-sim',
        rssi: -60,
      },
    });
  }
  const seeded = await request.post(`${HUB}/test/messages`, { data: { messages } });
  expect(seeded.ok()).toBe(true);
  return { gap, waterings };
}

/** The tests' hub with no history at all. */
export async function clearHistory(request: APIRequestContext): Promise<void> {
  const reset = await request.post(`${HUB}/test/reset`);
  expect(reset.ok()).toBe(true);
}

/** A browser that can do push, but answers locally (no push service). */
export async function fakePush(page: Page, endpoint = 'https://push.example/e2e-browser') {
  await page.addInitScript((endpoint) => {
    const state = { permission: 'default' as NotificationPermission, asked: 0 };
    (window as unknown as { __push: typeof state }).__push = state;
    Object.defineProperty(Notification, 'permission', { get: () => state.permission });
    Notification.requestPermission = () => {
      state.asked += 1;
      state.permission = 'granted';
      return Promise.resolve('granted');
    };
    let current: unknown = null;
    const subscription = {
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: 'BPk-test', auth: 'auth-test' } }),
      unsubscribe: () => {
        current = null;
        return Promise.resolve(true);
      },
    };
    const registration = {
      pushManager: {
        getSubscription: () => Promise.resolve(current),
        subscribe: () => {
          current = subscription;
          return Promise.resolve(subscription);
        },
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: () => Promise.resolve(registration),
        ready: Promise.resolve(registration),
        register: () => Promise.resolve(registration),
        addEventListener: () => undefined,
      },
    });
  }, endpoint);
}
