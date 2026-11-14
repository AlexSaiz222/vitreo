import { defineConfig } from '@playwright/test';

/**
 * End-to-end checks and progress captures. Needs the broker running
 * (`pnpm broker:up`); the simulator and the web app are started here.
 * Uses the installed Chrome, with software WebGL so it also works headless.
 *
 * Isolated from the greenhouse in daily use (D85): the tests get their own
 * simulator (device `e2e`, so their own MQTT topics, and its control API on
 * port 8789) and their own dev server (port 5174) following that device.
 * They never water, break or reset the simulator the phone shows, and they
 * never reuse a server that might be someone else's. Their hub (A4) keeps
 * that device too, in a throwaway database, on port 8790; it starts at the
 * generic location of the repository, never the one in .env (D79).
 */
/**
 * One isolated stack per worker, so tests run in parallel without touching
 * each other: worker 0 keeps device `e2e` and ports 8789/8790/5174; worker
 * i gets device `e2e<i>`, ports 8789+10i, 8790+10i and 5174+i. Each stack
 * has its own MQTT topics on the shared broker. `E2E_WORKERS` changes how
 * many (default 4).
 */
export const E2E_WORKERS = Number(process.env['E2E_WORKERS'] ?? 4);

export interface E2EStack {
  device: string;
  controlPort: number;
  hubPort: number;
  webPort: number;
}

export function e2eStack(index: number): E2EStack {
  return {
    device: index === 0 ? 'e2e' : `e2e${index.toString()}`,
    controlPort: 8789 + 10 * index,
    hubPort: 8790 + 10 * index,
    webPort: 5174 + index,
  };
}

const STACKS = Array.from({ length: E2E_WORKERS }, (_, index) => e2eStack(index));
/** In a worker process: its own stack (the config is loaded again there). */
const OWN = e2eStack(Number(process.env['TEST_PARALLEL_INDEX'] ?? 0));

export default defineConfig({
  testDir: './e2e',
  // The installability check runs against a production build instead.
  // The demo runs without a hub or broker: its own config (playwright.demo.config.ts).
  testIgnore: ['pwa.spec.ts', 'demo.spec.ts', 'notebook.spec.ts'],
  timeout: 60_000,
  workers: E2E_WORKERS,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${OWN.webPort.toString()}`,
    // A device that has already seen the welcome, at full quality (software
    // WebGL is slow and Auto would lower it): tests that need otherwise say so.
    storageState: {
      cookies: [],
      origins: STACKS.map((stack) => ({
        origin: `http://localhost:${stack.webPort.toString()}`,
        localStorage: [
          { name: 'vitreo.onboarded', value: '1' },
          { name: 'vitreo.quality', value: 'high' },
        ],
      })),
    },
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    // The real GPU by default (far cheaper than software WebGL, so workers
    // do not starve each other); E2E_GL=software for a machine without one.
    launchOptions: {
      args:
        process.env['E2E_GL'] === 'software'
          ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
          : ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'],
    },
  },
  webServer: STACKS.flatMap((stack) => [
    {
      command: 'pnpm --filter @vitreo/simulator start',
      cwd: '../..',
      url: `http://127.0.0.1:${stack.controlPort.toString()}/state`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        SIMULATOR_DEVICE_ID: stack.device,
        SIMULATOR_CONTROL_PORT: stack.controlPort.toString(),
      },
    },
    {
      command: 'pnpm --filter @vitreo/hub start',
      cwd: '../..',
      url: `http://127.0.0.1:${stack.hubPort.toString()}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        HUB_MODE: 'test',
        HUB_DEVICE_ID: stack.device,
        HUB_PORT: stack.hubPort.toString(),
        VITE_LOCATION_LAT: '40.42',
        VITE_LOCATION_LNG: '-3.70',
      },
    },
    {
      command: `pnpm --filter @vitreo/web exec vite --port ${stack.webPort.toString()} --strictPort`,
      cwd: '../..',
      url: `http://localhost:${stack.webPort.toString()}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        VITE_DEVICE_ID: stack.device,
        VITE_API_URL: '/api',
        HUB_PROXY_TARGET: `http://127.0.0.1:${stack.hubPort.toString()}`,
      },
    },
  ]),
});
