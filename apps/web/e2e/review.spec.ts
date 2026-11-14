import path from 'node:path';

import { test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { CONTROL, openLive, resetSimulator, setSoil } from './helpers.ts';

/**
 * Captures for the A2 review fixes (D85), phone, day and night: the Regar
 * menu with each plant's state, the Aire popover, a plant being watered
 * (Detener) and watering blocked by the hourly limit.
 * Run with `pnpm exec playwright test review.spec.ts`.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-faseA-2-revision-${name}.png`);
const THEMES = [
  ['day', 'dia'],
  ['night', 'noche'],
] as const;

test.use({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

async function shoot(page: Page, name: string, wait = 1_200) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: file(name) });
}

for (const [theme, name] of THEMES) {
  test(`review captures, ${theme}`, async ({ page, request }) => {
    await resetSimulator(request);
    await setSoil(request, 'basil_01', 0.15);
    await setSoil(request, 'strawberry_01', 0.1);
    await request.post(`${CONTROL}/scenario`, {
      data: { scenario: 'sensor_failure', active: true, sensor: 'soil', zone: 'chives_01' },
    });
    await openLive(page, `?theme=${theme}`);
    await page.waitForTimeout(2_000);

    await page.getByRole('button', { name: 'Regar', exact: true }).click();
    await shoot(page, `menu-regar-${name}-movil`);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Aire', exact: true }).click();
    await shoot(page, `menu-aire-${name}-movil`);
    await page.keyboard.press('Escape');

    await page.keyboard.press('2');
    await page.getByRole('radio', { name: '10 s' }).click();
    await page.locator('.primary-button').click();
    await page.getByRole('button', { name: 'Detener' }).waitFor();
    await shoot(page, `regando-${name}-movil`, 2_500);
    await page.getByRole('button', { name: 'Detener' }).click();
    await page.keyboard.press('Escape');

    await request.post(`${CONTROL}/pump-budget`);
    await page.keyboard.press('1');
    await page.locator('.primary-button').click();
    await shoot(page, `riego-bloqueado-${name}-movil`, 2_500);
  });
}
