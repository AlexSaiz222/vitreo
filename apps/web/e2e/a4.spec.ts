import path from 'node:path';

import { test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { HUB, openLive, resetSimulator } from './helpers.ts';

/**
 * A4 captures (docs/09): Ajustes › Plantas and › Ubicación, a plant called by
 * its name, and the hub down. Phone and desktop, day and night. The tests'
 * hub starts at the repository's generic location, never the real one (D79).
 * Run with `pnpm exec playwright test a4.spec.ts`.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-faseA-4-${name}.png`);
const HUB_API = /\/api\/v1\//;
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

async function openSettings(page: Page, row?: 'Plantas' | 'Ubicación') {
  await page.getByRole('button', { name: 'Ajustes' }).click();
  if (row) await page.getByRole('button', { name: new RegExp(`^${row}`) }).click();
}

for (const [device, use] of DEVICES) {
  const phone = device === 'movil';
  test.describe(device, () => {
    test.use(use);

    for (const [theme, name] of THEMES) {
      const at = (shot: string) => `${shot}-${name}-${device}`;

      test(`plants, location and the hub down, ${theme}`, async ({ page, request }) => {
        await resetSimulator(request);
        await request.patch(`${HUB}/plants/basil_01`, {
          data: { name: 'Pepa', sownAt: '2026-04-01' },
        });
        await openLive(page, `?theme=${theme}`);

        await openSettings(page);
        await shoot(page, at('ajustes'));
        await page.getByRole('button', { name: /^Plantas/ }).click();
        await shoot(page, at('plantas'));
        if (phone) {
          await page.locator('.settings-list [data-zone="parsley_01"]').click();
          await page.getByLabel('Nombre').fill('Perejil del balcón');
          await page.getByRole('button', { name: 'Guardar' }).click();
          await page.getByText('Guardado.').waitFor();
          await shoot(page, at('planta'));
        }
        await page.getByRole('button', { name: 'Cerrar' }).click();

        await openSettings(page, 'Ubicación');
        await shoot(page, at('ubicacion'));
        await page.getByRole('button', { name: 'Cerrar' }).click();

        if (phone) {
          await page.locator('.plant-target[data-zone="basil_01"]').focus();
          await page.keyboard.press('Enter');
          await page.getByRole('heading', { name: 'Pepa' }).waitFor();
          await shoot(page, at('ficha'));
        }

        // The hub stops answering (Docker stopped, the PC's hub restarting).
        await page.route(HUB_API, (route) => route.fulfill({ status: 502, body: '' }));
        await page.reload();
        await page.locator('.status[data-freshness="live"]').waitFor({ timeout: 15_000 });
        await openSettings(page, 'Plantas');
        if (phone) await shoot(page, at('hub-caido-plantas'));
        await page.locator('.settings-list [data-zone="basil_01"]').click();
        await page.getByLabel('Nombre').fill('Pepita');
        await shoot(page, at('hub-caido-planta'));
        if (phone) {
          await page.getByRole('button', { name: 'Volver a Plantas' }).click();
          await page.getByRole('button', { name: 'Volver a Ajustes' }).click();
          await page.locator('.plant-fact', { hasText: 'Hub' }).scrollIntoViewIfNeeded();
          await shoot(page, at('hub-caido-acerca'));
        }
      });
    }
  });
}
