import { defineConfig } from '@playwright/test';

/**
 * Installability check against a production build (the service worker only
 * exists there). Run with `pnpm pwa:check`. It builds into `dist-check/`,
 * never `dist/`: nginx serves `dist/` to the phone, and a check on a branch
 * must not publish that branch.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'pwa.spec.ts',
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
  },
  webServer: {
    command:
      'pnpm --filter @vitreo/web exec vite build --outDir dist-check && pnpm --filter @vitreo/web exec vite preview --outDir dist-check',
    cwd: '../..',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
