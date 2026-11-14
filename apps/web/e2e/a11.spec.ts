import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { HUB, openLive, resetSimulator, seedHistory } from './helpers.ts';

/**
 * A11: the greenhouse's own sheet, its climate and its tank. Opened from the
 * header's readings or the dock's tank line; temperature and air humidity
 * inside and outside (AEMET), light with the grow light, the tank with every
 * watering, and when the window, fan and light were on. On the test stack,
 * with a seeded week inside and AEMET's hourly readings outside.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-faseA-11-${name}.png`);
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
const HOUR = 3600;

/**
 * AEMET's hourly readings for the last `days`, cooler and damper than inside,
 * with three hours missing (AEMET down) 5 to 3 hours ago; the last one is
 * current, so the header says "fuera".
 */
async function seedOutside(request: APIRequestContext, days = 7) {
  const now = Math.floor(Date.now() / 1000);
  const first = Math.floor((now - days * 86_400) / HOUR) * HOUR;
  for (let at = first; at <= now - 600; at += HOUR) {
    if (at >= now - 5 * HOUR && at < now - 2 * HOUR) continue;
    const hour = (new Date(at * 1000).getUTCHours() + 2) % 24;
    const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const response = await request.post(`${HUB}/test/weather`, {
      data: {
        now: (at + 600) * 1000,
        observation: {
          station: { id: '3195', name: 'MADRID, RETIRO' },
          at,
          temp: Math.round((9 + 8 * sun) * 10) / 10,
          rh: Math.round(85 - 30 * sun),
          windSpeed: 2,
          windGust: 5,
          windDir: 240,
          precip: 0,
          visibility: 20,
        },
        forecast: null,
      },
    });
    expect(response.ok()).toBe(true);
  }
}

const sheet = (page: Page) => page.locator('.greenhouse-sheet');

async function openFromHeader(page: Page) {
  await page.getByRole('button', { name: /Ver el invernadero/ }).click();
  await expect(
    sheet(page).getByRole('heading', { name: 'Invernadero', exact: true }),
  ).toBeVisible();
  await expect(sheet(page).locator('.climate-chart').first()).toBeVisible({ timeout: 15_000 });
}

/** Scrolls the sheet so `selector` starts at the top, then shoots. */
async function shootAt(page: Page, selector: string | null, name: string) {
  const scroll = () =>
    selector === null
      ? Promise.resolve()
      : sheet(page)
          .locator(selector)
          .first()
          .evaluate((element: HTMLElement) => {
            element.scrollIntoView({ block: 'start' });
          });
  await scroll();
  await page.waitForTimeout(900);
  await scroll();
  await page.waitForTimeout(300);
  await page.screenshot({ path: file(name) });
}

test.describe('the greenhouse sheet', () => {
  test.beforeEach(async ({ request }) => {
    await resetSimulator(request);
    await seedHistory(request);
    await seedOutside(request, 1);
  });

  test('opens from the header, reads inside and outside, and rewinds from a chart', async ({
    page,
  }) => {
    await openLive(page);
    await openFromHeader(page);
    for (const name of ['Temperatura', 'Humedad del aire', 'Luz', 'Depósito']) {
      await expect(sheet(page).getByRole('heading', { name, exact: true })).toBeVisible();
    }
    await expect(sheet(page).getByText(/Fuera: AEMET, estación MADRID, RETIRO/)).toBeVisible();

    // The keyboard walks the temperature: inside, outside and what was on.
    const plot = sheet(page).locator('.history-plot').first();
    await plot.focus();
    // An hour back: AEMET's reading for this very hour may not be in yet.
    await page.keyboard.press('End');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    const readout = sheet(page).locator('.history-readout').first();
    await expect(readout).toContainText(/dentro \d+(,\d)?\s°C · fuera \d+(,\d)?\s°C/);
    // AEMET's gap, 5 to 2 hours ago, is a gap outside, never bridged.
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
    await expect(readout).toContainText('fuera sin datos');

    // And from there, the whole greenhouse as it was.
    await sheet(page).getByRole('button', { name: 'Ver el invernadero así' }).first().click();
    await expect(page.locator('.status')).toHaveAttribute('data-freshness', 'past');
  });

  test('the tank line opens it at the tank, with every watering counted', async ({ page }) => {
    await openLive(page);
    // On a desktop the tank line shows when the pointer comes to the dock (D115).
    await page.locator('.dock-bar').hover();
    await page.locator('.dock-tank').click();
    const tank = sheet(page).locator('.greenhouse-tank');
    await expect(tank.locator('.climate-chart')).toBeVisible({ timeout: 15_000 });
    await expect(tank).toBeInViewport();
    await expect(tank.getByText(/riego|Ningún riego/).first()).toBeVisible();
    // The seeded week waters the basil, by you and by automation.
    await sheet(page).getByRole('radio', { name: '7 días' }).click();
    await expect(
      tank.getByText(/\d+ riegos en este periodo: \d+ tuyos? y \d+ automáticos?\./),
    ).toBeVisible({ timeout: 15_000 });
    // The data, as CSV: inside and AEMET's.
    const csv = sheet(page).getByRole('link', { name: /Invernadero, CSV/ });
    await expect(csv).toHaveAttribute('href', /\/telemetry\.csv\?from=\d+&to=\d+/);
    const weather = await page.request.get(
      (await sheet(page)
        .getByRole('link', { name: /Fuera \(AEMET\), CSV/ })
        .getAttribute('href')) ?? '',
    );
    expect(await weather.text()).toMatch(/^time_utc,ts,station,temp_c,rh,.*,source\n.*,AEMET\n/);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
  });

  test('without AEMET it says so, and the greenhouse charts still stand', async ({
    page,
    request,
  }) => {
    await seedHistory(request);
    await openLive(page, '?open=greenhouse');
    await expect(sheet(page).locator('.climate-chart').first()).toBeVisible({ timeout: 15_000 });
    await expect(sheet(page).getByText('Fuera: AEMET no dio datos en este periodo.')).toBeVisible();
    await expect(sheet(page).locator('[data-line="outside"]')).toHaveCount(0);
  });
});

// Tagged @capture: the fast suite (pnpm e2e) leaves them out.
test.describe('captures @capture', () => {
  // The same week for every capture, seeded once per worker.
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await resetSimulator(request);
    await seedHistory(request);
    await seedOutside(request);
    await request.dispose();
  });

  for (const [device, use] of DEVICES) {
    test.describe(device, () => {
      test.use(use);
      for (const [theme, name] of THEMES) {
        test(`the greenhouse sheet, ${theme}`, async ({ page }) => {
          const at = (shot: string) => `${shot}-${name}-${device}`;
          await openLive(page, `?theme=${theme}`);
          await openFromHeader(page);
          await shootAt(page, null, at('clima'));
          // A value under the finger: inside, outside and what was on.
          const plot = sheet(page).locator('.history-plot').first();
          await plot.focus();
          await page.keyboard.press('End');
          for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowLeft');
          await shootAt(page, '.plant-section', at('temperatura'));
          await shootAt(page, '.plant-section:nth-of-type(3)', at('luz'));
          await page.keyboard.press('Escape');

          // On a desktop the tank line shows when the pointer comes to the dock (D115).

          await page.locator('.dock-bar').hover();

          await page.locator('.dock-tank').click();
          await expect(sheet(page).locator('.greenhouse-tank .climate-chart')).toBeVisible();
          await shootAt(page, '.greenhouse-tank', at('deposito'));
        });
      }
    });
  }

  test.describe('movil, 7 days', () => {
    test.use(DEVICES[1][1]);
    test('a week', async ({ page }) => {
      await openLive(page, '?theme=day');
      await openFromHeader(page);
      await sheet(page).getByRole('radio', { name: '7 días' }).click();
      await expect(sheet(page).locator('.climate-chart').first()).toBeVisible();
      await shootAt(page, '.plant-section', '7dias-dia-movil');
    });
  });
});
