import { defineConfig } from '@playwright/test';

/**
 * The public demo (D66, D103): the app built with `--mode demo`, its
 * greenhouse in a Web Worker. No broker, hub or simulator: the demo has
 * none, so this needs nothing running (`pnpm e2e:demo`).
 */
const PORT = 5191;

export default defineConfig({
  testDir: './e2e',
  testMatch: ['demo.spec.ts', 'notebook.spec.ts'],
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT.toString()}`,
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://localhost:${PORT.toString()}`,
          localStorage: [
            { name: 'vitreo.onboarded', value: 'forever' },
            { name: 'vitreo.quality', value: 'high' },
          ],
        },
      ],
    },
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: {
      args:
        process.env['E2E_GL'] === 'software'
          ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
          : ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'],
    },
  },
  webServer: {
    command: `pnpm --filter @vitreo/web exec vite --mode demo --port ${PORT.toString()} --strictPort`,
    cwd: '../..',
    url: `http://localhost:${PORT.toString()}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
