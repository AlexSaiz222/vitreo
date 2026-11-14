import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { CONTROL, openLive, resetSimulator, seedHistory } from './helpers.ts';

/**
 * A6 captures (docs/09): the plant's automatic watering off and on (applied),
 * a change pending while the greenhouse is away, an automatic watering in
 * the chart with its reason, and Ajustes › Ventilación y luz. Phone and
 * desktop, day and night. Run with `pnpm exec playwright test a6.spec.ts`.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-faseA-6-${name}.png`);
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
  await page.waitForTimeout(900);
  await page.screenshot({ path: file(name) });
}

async function openBasil(page: Page, phone: boolean) {
  await page.locator('.plant-target[data-zone="basil_01"]').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Albahaca' }).waitFor();
  if (phone) {
    await page.waitForTimeout(600);
    if ((await page.locator('.ui-sheet').getAttribute('data-size')) !== 'full') {
      await page.locator('.ui-sheet-handle').press('Enter');
    }
    await page.locator('.ui-sheet[data-size="full"]').waitFor();
    await page.locator('.ui-sheet-handle').evaluate((handle: HTMLElement) => {
      handle.blur();
    });
  }
}

async function toAutomation(page: Page) {
  const section = page.locator('.automation');
  await section.scrollIntoViewIfNeeded();
  await section.evaluate((element: HTMLElement) => {
    element.scrollIntoView({ block: 'start' });
  });
}

for (const [device, use] of DEVICES) {
  const phone = device === 'movil';
  test.describe(device, () => {
    test.use(use);

    for (const [theme, name] of THEMES) {
      const at = (shot: string) => `${shot}-${name}-${device}`;

      test(`automations, ${theme}`, async ({ page, request }) => {
        await resetSimulator(request);
        await seedHistory(request);
        await openLive(page, `?theme=${theme}`);

        // The plant's automatic watering: off, then on and applied.
        await openBasil(page, phone);
        await toAutomation(page);
        await shoot(page, at('riego-apagado'));
        await page.getByRole('switch', { name: /Regar sola/ }).click();
        await page.getByRole('slider', { name: 'Pide agua por debajo de' }).fill('35');
        await toAutomation(page);
        await page.locator('.automation').getByRole('button', { name: 'Guardar' }).click();
        await expect(page.locator('.automation .config-status')).toHaveText(/Aplicado/, {
          timeout: 15_000,
        });
        await toAutomation(page);
        await shoot(page, at('riego-aplicado'));

        // The chart: an automatic watering says why.
        const plot = page.locator('.history-plot');
        await plot.scrollIntoViewIfNeeded();
        await plot.focus();
        await page.keyboard.press('End');
        for (let i = 0; i < 200; i++) {
          if ((await page.locator('.history-readout').textContent())?.includes('automático')) break;
          await page.keyboard.press('ArrowLeft');
        }
        await page.locator('.history-chart').evaluate((element: HTMLElement) => {
          element.scrollIntoView({ block: 'center' });
        });
        await shoot(page, at('grafica-riego-automatico'));

        // Pending: the greenhouse is away when the change is saved.
        if (phone) {
          await request.post(`${CONTROL}/scenario`, {
            data: { scenario: 'disconnect', active: true },
          });
          await toAutomation(page);
          await page.getByRole('slider', { name: 'Pide agua por debajo de' }).fill('40');
          await page.locator('.automation').getByRole('button', { name: 'Guardar' }).click();
          await expect(page.locator('.automation .config-status')).toHaveText(/Pendiente/, {
            timeout: 15_000,
          });
          await toAutomation(page);
          await shoot(page, at('riego-pendiente'));
          await request.post(`${CONTROL}/scenario`, {
            data: { scenario: 'disconnect', active: false },
          });
          await expect(page.locator('.automation .config-status')).toHaveText(/Aplicado/, {
            timeout: 20_000,
          });
        }
        await page.getByRole('button', { name: 'Cerrar' }).click();

        // Ajustes › Ventilación y luz, with the light by the sun.
        await page.getByRole('button', { name: 'Ajustes' }).click();
        await page.getByRole('button', { name: /^Ventilación y luz/ }).click();
        await page.getByRole('switch', { name: /Ventilar sola/ }).click();
        await page.getByRole('switch', { name: /Encender la luz sola/ }).click();
        await page.getByRole('radio', { name: 'Con el sol' }).click();
        await page.getByRole('button', { name: 'Guardar' }).click();
        await expect(page.locator('.config-status')).toHaveText(/Aplicado/, { timeout: 15_000 });
        await shoot(page, at('ventilacion-luz'));
      });
    }
  });
}
