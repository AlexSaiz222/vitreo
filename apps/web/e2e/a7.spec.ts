import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { CONTROL, fakePush, HUB, openLive, resetSimulator } from './helpers.ts';

/**
 * A7 captures (docs/09): Ajustes › Avisos before and after turning them on
 * (with "Probar aviso" sent), and the warnings history with one open and
 * one resolved. Phone and desktop, day and night, on the test stack (no
 * real notification is sent). Run with `pnpm exec playwright test a7.spec.ts`.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-faseA-7-${name}.png`);
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

for (const [device, use] of DEVICES) {
  test.describe(device, () => {
    test.use(use);

    for (const [theme, name] of THEMES) {
      const at = (shot: string) => `${shot}-${name}-${device}`;

      test(`warnings, ${theme}`, async ({ page, request }) => {
        await resetSimulator(request);
        await fakePush(page);
        await openLive(page, `?theme=${theme}`);
        await page.getByRole('button', { name: 'Ajustes' }).click();
        await page.getByRole('button', { name: /^Avisos/ }).click();
        await shoot(page, at('avisos-apagados'));

        await page.getByRole('button', { name: 'Activar avisos' }).click();
        await page.getByRole('button', { name: 'Probar aviso' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Enviado' })).toBeVisible();
        await shoot(page, at('avisos-activados'));

        // History: the tank emptied and was refilled (resolved), then ran low
        // (open; at night it waits for the morning: quiet hours).
        const evaluate = async (expected: number) => {
          await expect
            .poll(async () => {
              await request.post(`${HUB}/test/evaluate`);
              return ((await (await request.get(`${HUB}/alerts`)).json()) as unknown[]).length;
            })
            .toBe(expected);
        };
        await request.post(`${CONTROL}/tank`, { data: { level: 0.02 } });
        await evaluate(1);
        await request.post(`${CONTROL}/tank`, { data: { level: 0.15 } });
        await evaluate(2);
        await page.getByRole('button', { name: 'Volver a Ajustes' }).click();
        await page.getByRole('button', { name: /^Avisos/ }).click();
        await page.locator('.alerts-item').first().waitFor();
        await page.locator('.alerts-history').evaluate((element: HTMLElement) => {
          element.scrollIntoView({ block: 'end' });
        });
        await shoot(page, at('avisos-historial'));
      });
    }
  });
}
