import path from 'node:path';

import { test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { openLive, resetSimulator, setSoil } from './helpers.ts';

/**
 * A3 captures (docs/09): Ajustes, the welcome and the plants without 3D,
 * phone and desktop, day and night. Run with `pnpm exec playwright test a3.spec.ts`.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-faseA-3-${name}.png`);
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

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: file(name) });
}

for (const [device, use] of DEVICES) {
  test.describe(device, () => {
    test.use(use);

    for (const [theme, name] of THEMES) {
      test(`settings and list, ${theme}`, async ({ page, request }) => {
        await resetSimulator(request);
        await setSoil(request, 'basil_01', 0.15);
        await openLive(page, `?theme=${theme}`);
        await page.getByRole('button', { name: 'Ajustes' }).click();
        await shoot(page, `ajustes-${name}-${device}`);

        await page.goto(`/?theme=${theme}&quality=flat`);
        await page.locator('.plant-list .menu-row').first().waitFor();
        await shoot(page, `sin-3d-${name}-${device}`);
      });
    }
  });
}

test.describe('welcome (phone)', () => {
  test.use({ ...DEVICES[1][1], storageState: { cookies: [], origins: [] } });

  for (const [theme, name] of THEMES) {
    test(`welcome, ${theme}`, async ({ page, request }) => {
      await resetSimulator(request);
      await page.goto(`/?theme=${theme}&quality=high`);
      for (let step = 1; step <= 4; step++) {
        await shoot(page, `bienvenida-${step.toString()}-${name}-movil`);
        if (step < 4) await page.getByRole('button', { name: 'Siguiente' }).click();
      }
    });
  }
});
