import path from 'node:path';

import { test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { openLive, resetSimulator, setSoil } from './helpers.ts';

/**
 * Before/after captures for the HUD refinements after A1 (docs/09), phone,
 * day and night: the plant list (water menu) and the plant sheet with a
 * thirsty plant, which also show the header and the day/night button.
 * Run with `CAPTURE_TAG=antes|despues pnpm exec playwright test refine.spec.ts`.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const TAG = process.env['CAPTURE_TAG'] ?? 'despues';
const file = (name: string) => path.join(OUT, `${DATE}-hud-${TAG}-${name}.png`);
const THEMES = [
  ['day', 'dia'],
  ['night', 'noche'],
] as const;
const SETTLE_MS = 2_500;

test.use({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
  // A thirsty basil (warning) and a well-watered parsley, for the drops.
  await setSoil(request, 'basil_01', 0.22);
  await setSoil(request, 'parsley_01', 0.68);
});

async function shoot(page: Page, query: string, name: string) {
  await openLive(page, query);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file(`cabecera-${name}`) });
  await page.getByRole('button', { name: 'Regar', exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: file(`lista-${name}`) });
  await page.locator('.menu-row[data-zone="basil_01"]').click();
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file(`hoja-${name}`) });
}

for (const [theme, name] of THEMES) {
  test(`HUD, ${theme}`, async ({ page }) => {
    await shoot(page, `?theme=${theme}`, name);
  });
}
