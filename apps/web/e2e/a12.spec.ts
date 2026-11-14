import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { openLive, resetSimulator, setSoil } from './helpers.ts';

/**
 * A12, first part (D100): one threshold per plant. The plant's own, from its
 * watering rule in `config`, whether it waters itself or not: below it the
 * plant wilts, asks for water and is warned about. Captures of the
 * threshold in the sheet and the thirsty plant in the scene, phone and
 * desktop, day and night.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-faseA-12-${name}.png`);
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

const basilWarning = (page: Page) =>
  page.locator('.plant-marker[data-zone="basil_01"][data-kind="warning"]');

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

async function toWatering(page: Page) {
  const section = page.locator('.automation');
  await section.scrollIntoViewIfNeeded();
  await section.evaluate((element: HTMLElement) => {
    element.scrollIntoView({ block: 'start' });
  });
}

/** Moves the basil's threshold to 50 % with automatic watering off, and saves. */
async function askForWaterAt50(page: Page) {
  const section = page.locator('.automation');
  await toWatering(page);
  await expect(section.getByRole('heading', { name: 'Riego' })).toBeVisible();
  await expect(section.getByRole('switch', { name: /Regar sola/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await section.getByRole('slider', { name: 'Pide agua por debajo de' }).fill('50');
  await expect(section.getByText('Por debajo se marchita y te avisa.')).toBeVisible();
  await section.getByRole('button', { name: 'Guardar' }).click();
  await expect(section.locator('.config-status')).toHaveText(/Aplicado/, { timeout: 15_000 });
}

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
  // Above the basil's species threshold (40 %), below 50 %.
  await setSoil(request, 'basil_01', 0.45);
});

test('a plant asks for water below its own threshold, with automatic watering off (D100)', async ({
  page,
}) => {
  await openLive(page);
  await expect(basilWarning(page)).toHaveCount(0);
  await openBasil(page, false);
  await expect(page.locator('.plant-mood')).toHaveAttribute('data-thirsty', 'false');
  await expect(page.locator('.plant-hint')).toHaveText(/Pide agua por debajo del 40\s%/);

  await askForWaterAt50(page);
  // The whole app follows it: the sheet, the scene and the warnings.
  await expect(page.locator('.plant-mood')).toHaveAttribute('data-thirsty', 'true');
  await expect(page.locator('.plant-hint')).toHaveText(/Pide agua por debajo del 50\s%/);
  await expect(
    page.locator('.automation').getByRole('switch', { name: /Regar sola/ }),
  ).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(basilWarning(page)).toContainText('Sed');

  // Opened again, it is remembered: the threshold is the plant's.
  await page.reload();
  await openLive(page);
  await expect(basilWarning(page)).toContainText('Sed');
});

// Tagged @capture: the fast suite (pnpm e2e) leaves them out.
test.describe('captures @capture', () => {
  for (const [device, use] of DEVICES) {
    const phone = device === 'movil';
    test.describe(device, () => {
      test.use(use);
      for (const [theme, name] of THEMES) {
        test(`the plant's threshold, ${theme}`, async ({ page }) => {
          const at = (shot: string) => file(`${shot}-${name}-${device}`);
          await openLive(page, `?theme=${theme}`);
          await openBasil(page, phone);
          await askForWaterAt50(page);
          await toWatering(page);
          await page.waitForTimeout(900);
          await page.screenshot({ path: at('umbral') });

          await page.keyboard.press('Escape');
          await expect(basilWarning(page)).toContainText('Sed');
          // The scene as seen, without the keyboard focus the sheet hands back.
          await page.evaluate(() => {
            (document.activeElement as HTMLElement | null)?.blur();
          });
          await page.waitForTimeout(1500);
          await page.screenshot({ path: at('sed') });
        });
      }
    });
  }
});
