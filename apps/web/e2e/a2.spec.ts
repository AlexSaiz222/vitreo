import path from 'node:path';

import { test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { CONTROL, openLive, resetSimulator, setSoil } from './helpers.ts';

/**
 * A2 captures (docs/09): phone and desktop, day and night, with the worst
 * cases: several warnings at once, plants behind others (camera rotated),
 * zoomed in with plants off screen, a sheet open, and the notices (Undo,
 * watering about to start). Run with `pnpm exec playwright test a2.spec.ts`.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const TAG = process.env['CAPTURE_TAG'] ?? 'faseA-2';
const file = (name: string) => path.join(OUT, `${DATE}-${TAG}-${name}.png`);

const THEMES = [
  ['day', 'dia'],
  ['night', 'noche'],
] as const;
const DEVICES = [
  ['escritorio', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  [
    'movil',
    { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ],
] as const;
const SETTLE_MS = 3_000;

/** Three thirsty plants, a broken soil sensor and a low tank, all at once. */
async function manyWarnings(request: APIRequestContext) {
  await resetSimulator(request);
  await setSoil(request, 'basil_01', 0.15);
  await setSoil(request, 'lettuce_01', 0.2);
  await setSoil(request, 'strawberry_01', 0.1);
  await request.post(`${CONTROL}/scenario`, {
    data: { scenario: 'sensor_failure', active: true, sensor: 'soil', zone: 'chives_01' },
  });
  await request.post(`${CONTROL}/tank`, { data: { level: 0.12 } });
}

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file(name) });
}

for (const [device, use] of DEVICES) {
  test.describe(device, () => {
    test.use(use);

    for (const [theme, name] of THEMES) {
      test(`warnings, ${theme}`, async ({ page, request }) => {
        await manyWarnings(request);
        await openLive(page, `?theme=${theme}`);
        await shoot(page, `avisos-${name}-${device}`);

        await openLive(page, `?theme=${theme}&azimuth=221`);
        await shoot(page, `avisos-girada-${name}-${device}`);

        await openLive(page, `?theme=${theme}&zoom=2.6`);
        await shoot(page, `avisos-zoom-${name}-${device}`);

        await openLive(page, `?theme=${theme}`);
        // Markers let the pointer through; the tap lands on the scene, which knows it.
        await page.locator('.plant-marker[data-zone="basil_01"]').click({ force: true });
        await shoot(page, `avisos-hoja-${name}-${device}`);
      });

      test(`undo and stopping a watering, ${theme}`, async ({ page, request }) => {
        await resetSimulator(request);
        await openLive(page, `?theme=${theme}`);
        await page.getByRole('button', { name: /^Luz/ }).click();
        await page.getByRole('button', { name: 'Regar', exact: true }).click();
        await page.locator('.menu-row[data-zone="parsley_01"]').click();
        await page.getByRole('radio', { name: '10 s' }).click();
        await page.locator('.primary-button').click();
        await page.getByRole('button', { name: 'Detener' }).waitFor();
        await page.waitForTimeout(1_500);
        await page.screenshot({ path: file(`deshacer-detener-${name}-${device}`) });
        await page.getByRole('button', { name: 'Detener' }).click();
      });
    }
  });
}
