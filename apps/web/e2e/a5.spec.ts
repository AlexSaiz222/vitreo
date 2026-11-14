import path from 'node:path';

import { test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { clearHistory, openLive, resetSimulator, seedHistory } from './helpers.ts';

/**
 * A5 captures (docs/09): the plant's history (7 days, 24 h with a gap, a
 * value under the finger, the empty state) and rewind (a past moment, a
 * gap, the plant's sheet in the past). Phone and desktop, day and night.
 * Run with `pnpm exec playwright test a5.spec.ts`.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-faseA-5-${name}.png`);
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

async function openBasil(page: Page) {
  await page.locator('.plant-target[data-zone="basil_01"]').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Albahaca' }).waitFor();
}

/** On a phone the chart is below the fold: the sheet opens fully. */
async function showChart(page: Page, phone: boolean) {
  if (phone) {
    const sheet = page.locator('.ui-sheet');
    if ((await sheet.getAttribute('data-size')) !== 'full') {
      await page.locator('.ui-sheet-handle').press('Enter');
    }
    await page.locator('.ui-sheet[data-size="full"]').waitFor();
    await page.locator('.ui-sheet-handle').evaluate((handle: HTMLElement) => {
      handle.blur();
    });
    await page.waitForTimeout(600);
  }
  await page.locator('.history-chart, .history-empty').first().scrollIntoViewIfNeeded();
}

async function scrubTo(page: Page, seconds: number) {
  await page.locator('.timeline-input').evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
}

for (const [device, use] of DEVICES) {
  const phone = device === 'movil';
  test.describe(device, () => {
    test.use(use);

    for (const [theme, name] of THEMES) {
      const at = (shot: string) => `${shot}-${name}-${device}`;

      test(`history and rewind, ${theme}`, async ({ page, request }) => {
        await resetSimulator(request);
        const { gap } = await seedHistory(request);
        await openLive(page, `?theme=${theme}`);

        await openBasil(page);
        await showChart(page, phone);
        await shoot(page, at('grafica-7d'));
        await page.getByRole('radio', { name: '24 h' }).click();
        await page.locator('.history-gap').first().waitFor();
        const plot = page.locator('.history-plot');
        await plot.scrollIntoViewIfNeeded();
        const box = await plot.boundingBox();
        await plot.click({
          position: { x: (box?.width ?? 100) * 0.82, y: (box?.height ?? 100) * 0.5 },
        });
        await page.locator('.history-readout .reading').waitFor();
        await shoot(page, at('grafica-24h-valor'));
        await page.getByRole('button', { name: 'Cerrar' }).click();

        await page.getByRole('button', { name: 'Rebobinar' }).click();
        await page
          .locator('.timeline-note')
          .filter({ hasNotText: 'Cargando' })
          .waitFor({ timeout: 15_000 });
        await scrubTo(page, gap.end + 3 * 3600);
        await shoot(page, at('rebobinar'));
        await scrubTo(page, gap.start + 2 * 3600);
        await shoot(page, at('rebobinar-hueco'));
        if (phone) {
          await scrubTo(page, gap.end + 5 * 3600);
          await openBasil(page);
          await shoot(page, at('rebobinar-ficha'));
        }
      });
    }

    test(`empty history, ${device}`, async ({ page, request }) => {
      await resetSimulator(request);
      await clearHistory(request);
      await openLive(page, '?theme=day');
      await openBasil(page);
      await showChart(page, phone);
      await shoot(page, `vacio-dia-${device}`);
    });
  });
}
