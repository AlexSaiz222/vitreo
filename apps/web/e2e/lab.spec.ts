import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { CONTROL, openLive, resetSimulator, setSoil } from './helpers.ts';

/**
 * Phase A1 captures (docs/09), development server only:
 *   - the primitives catalogue (?ui=lab), day and night, phone and desktop;
 *   - the real HUD with a plant sheet open and a warning, same four ways;
 *   - the dock without a connection (disabled, with its reason).
 * Run with `CAPTURE_TAG=faseA-1 pnpm exec playwright test lab.spec.ts`.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const TAG = process.env['CAPTURE_TAG'] ?? 'faseA-1';
const file = (name: string) => path.join(OUT, `${DATE}-${TAG}-${name}.png`);

const THEMES = [
  ['day', 'dia'],
  ['night', 'noche'],
] as const;
const PHONE = {
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const DEVICES = [
  ['escritorio', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  ['movil', PHONE],
] as const;
const SETTLE_MS = 2_500;

async function openScene(page: Page, query: string) {
  await page.goto(`/${query}`);
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-scene-ready') === 'true',
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(SETTLE_MS);
}

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
});

for (const [device, use] of DEVICES) {
  test.describe(device, () => {
    test.use(use);

    for (const [theme, name] of THEMES) {
      test(`primitives catalogue, ${theme}`, async ({ page }) => {
        await openScene(page, `?ui=lab&theme=${theme}`);
        await page.screenshot({ path: file(`primitivas-${name}-${device}`), fullPage: true });
        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          axe.violations.map(
            (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
          ),
        ).toEqual([]);
      });

      test(`HUD with a thirsty plant, ${theme}`, async ({ page, request }) => {
        // A warning: the basil is thirsty (the status line and the sheet say so).
        await setSoil(request, 'basil_01', 0.22);
        await openLive(page, `?theme=${theme}`);
        await page.getByRole('button', { name: 'Regar', exact: true }).click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: file(`hud-menu-regar-${name}-${device}`) });
        await page.locator('.menu-row[data-zone="basil_01"]').click();
        await page.waitForTimeout(SETTLE_MS);
        await page.screenshot({ path: file(`hud-hoja-aviso-${name}-${device}`) });
      });
    }
  });
}

test.describe('without a connection', () => {
  test.use(PHONE);

  test('the dock stays, flat, and says why', async ({ page, request }) => {
    await openLive(page, '?theme=day');
    await request.post(`${CONTROL}/scenario`, { data: { scenario: 'disconnect', active: true } });
    await expect(page.locator('.status')).toHaveAttribute('data-freshness', 'disconnected', {
      timeout: 20_000,
    });
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: file('hud-sin-conexion-dia-movil') });
    await request.post(`${CONTROL}/scenario`, { data: { scenario: 'disconnect', active: false } });
  });
});
