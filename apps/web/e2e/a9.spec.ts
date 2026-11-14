import { rmSync } from 'node:fs';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { CONTROL, openLive, resetSimulator } from './helpers.ts';

/** A9 (D96): atmosphere. Sound off until asked for; quiet effects that follow the data. */

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
});

async function expectAccessible(page: Page) {
  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
}

/** Every request for a sound loop this page makes. */
function audioRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/audio/')) urls.push(request.url());
  });
  return urls;
}

test('sound is off by default and nothing is downloaded until it is turned on', async ({
  page,
}) => {
  const audio = audioRequests(page);
  await openLive(page);
  await page.waitForTimeout(2000);
  expect(audio).toEqual([]);

  await page.getByRole('button', { name: 'Ajustes' }).click();
  const toggle = page.getByRole('switch', { name: 'Sonido ambiente' });
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('slider', { name: 'Volumen' })).toBeDisabled();
  // The devices' and the touches' sounds have their own switches (D131),
  // off on a first visit too (D96), and usable without the ambient.
  const devices = page.getByRole('switch', { name: 'Sonidos de los aparatos' });
  const touches = page.getByRole('switch', { name: 'Sonidos al tocar' });
  await expect(devices).toBeEnabled();
  await expect(devices).not.toBeChecked();
  await expect(touches).toBeEnabled();
  await expect(touches).not.toBeChecked();
  await expectAccessible(page);
  expect(audio).toEqual([]);

  // On: the loops of every day and the blackbird, versioned by content (the
  // rain only when it rains, D123), and it plays (the tap was the gesture).
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByText('Suena lo que pasa en el invernadero.')).toBeVisible({
    timeout: 15_000,
  });
  expect(audio.map((url) => path.basename(new URL(url).pathname)).sort()).toEqual([
    'birds.ogg',
    'blackbird.ogg',
    'crickets.ogg',
    'fan.ogg',
    'water.ogg',
    'wind.ogg',
  ]);
  expect(audio.every((url) => /\?v=[0-9a-f]{10}$/.test(url))).toBe(true);
  await expect(devices).toBeEnabled();
  const volume = page.getByRole('slider', { name: 'Volumen' });
  await expect(volume).toBeEnabled();
  await volume.fill('0.3');
  await expect(volume).toHaveAttribute('aria-valuetext', /30\s%/);
  await expectAccessible(page);

  // Remembered on this device, and off again at once.
  expect(await page.evaluate(() => localStorage.getItem('vitreo.sound'))).toBe('1');
  await toggle.click();
  await expect(page.getByText(/^Apagado\. Pájaros de día/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vitreo.sound'))).toBe('0');

  // The ambient off, the touches on their own (D131): the volume is theirs too.
  await expect(volume).toBeDisabled();
  await touches.click();
  await expect(touches).toBeChecked();
  await expect(volume).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('vitreo.touchSounds'))).toBe('1');
});

test('reopened with sound on, it waits for a tap before playing', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vitreo.sound', '1');
  });
  await openLive(page);
  await page.getByRole('button', { name: 'Ajustes' }).click();
  // Without a gesture the browser keeps audio suspended; it says so, calmly.
  await expect(
    page.getByText(/Toca la pantalla para que empiece a sonar\.|Suena lo que pasa/),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole('heading', { name: 'Ajustes' }).click();
  await expect(page.getByText('Suena lo que pasa en el invernadero.')).toBeVisible();
});

test('the interface fades between day and night instead of cutting', async ({ page }) => {
  await openLive(page, '?theme=day');
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await page.getByRole('radio', { name: 'Noche' }).click();
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'night');
  await expect(root).toHaveAttribute('data-theme-changing', '');
  const duration = await page
    .locator('.ui-sheet')
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  // Surfaces fade over 2.4 s (D135); text switches half way, so it never vanishes.
  expect(duration.split(',')[0]?.trim()).toBe('2.4s');
  const delay = await page
    .locator('.ui-sheet')
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDelay);
  expect(delay.split(',').at(-1)?.trim()).toBe('1.2s');
  // Only for the change: the controls keep their quick transitions after.
  await expect(root).not.toHaveAttribute('data-theme-changing', '', { timeout: 6000 });
});

test('with reduced motion the theme changes at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLive(page, '?theme=day');
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await page.getByRole('radio', { name: 'Noche' }).click();
  const duration = await page
    .locator('.ui-sheet')
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(duration.split(',').every((d) => d.trim() === '0s')).toBe(true);
});

test('Baja draws no particles: fewer draw calls than Alta at night', async ({ page }) => {
  await openLive(page, '?theme=night&quality=high');
  await page.waitForTimeout(3000);
  const high = Number(await page.evaluate(() => document.documentElement.dataset['drawCalls']));
  await openLive(page, '?theme=night&quality=low');
  await page.waitForTimeout(3000);
  const low = Number(await page.evaluate(() => document.documentElement.dataset['drawCalls']));
  expect(high).toBeLessThan(100);
  expect(low).toBeLessThan(high);
});

test('the humid scenario raises the humidity the twin shows (the mist follows it)', async ({
  page,
  request,
}) => {
  await openLive(page);
  await request.post(`${CONTROL}/scenario`, { data: { scenario: 'humid', active: true } });
  await expect(page.locator('.status-line')).toContainText(/9\d\s%/, { timeout: 15_000 });
});

/**
 * A9 captures (docs/09): the scene by day (dust in the light) and by night
 * (fireflies), condensation on the glass, and Ajustes › Sonido; phone and
 * desktop, day and night. Plus a short recording (fan and window, the glass
 * misting, the change to night). Tagged @capture.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const shot = (name: string) => path.join(OUT, `${DATE}-faseA-9-${name}.png`);
const DEVICES = [
  ['escritorio', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  [
    'movil',
    { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ],
] as const;

test.describe('captures @capture', () => {
  test.describe.configure({ timeout: 180_000 });

  for (const [device, use] of DEVICES) {
    test.describe(device, () => {
      test.use(use);

      for (const [theme, name] of [
        ['day', 'dia'],
        ['night', 'noche'],
      ] as const) {
        test(`atmosphere, ${theme}`, async ({ page, request }) => {
          const at = (what: string) => shot(`${what}-${name}-${device}`);
          await openLive(page, `?theme=${theme}`);
          // Dust or fireflies fade in over a few seconds.
          await page.waitForTimeout(8000);
          await page.screenshot({ path: at('escena') });

          await request.post(`${CONTROL}/scenario`, { data: { scenario: 'humid', active: true } });
          await expect(page.locator('.status-line')).toContainText(/9\d\s%/, { timeout: 15_000 });
          // The mist gathers slowly (as on real glass).
          await page.waitForTimeout(20_000);
          await page.screenshot({ path: at('condensacion') });

          await page.getByRole('button', { name: 'Ajustes' }).click();
          const toggle = page.getByRole('switch', { name: 'Sonido ambiente' });
          await toggle.click();
          await expect(page.getByText('Suena lo que pasa en el invernadero.')).toBeVisible({
            timeout: 15_000,
          });
          await page.locator('#settings-sound').evaluate((element: HTMLElement) => {
            element.scrollIntoView({ block: 'start' });
          });
          await page.waitForTimeout(900);
          await page.screenshot({ path: at('sonido') });
        });
      }
    });
  }

  test('recording: fan and window, the glass misting, then night', async ({
    browser,
    baseURL,
    request,
  }) => {
    const dir = path.join(OUT, '.video');
    const context = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      recordVideo: { dir, size: { width: 412, height: 915 } },
    });
    await context.addInitScript(() => {
      localStorage.setItem('vitreo.onboarded', '1');
      localStorage.setItem('vitreo.quality', 'high');
    });
    const page = await context.newPage();
    await openLive(page, '?theme=day');
    await page.waitForTimeout(3000);
    // The fan and the open window: the leaves move more.
    await page.getByRole('button', { name: 'Aire', exact: true }).click();
    await page.getByRole('button', { name: /^Encender/ }).click();
    await page.getByRole('radio', { name: 'Abierta' }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(8000);
    // A muggy spell: the glass mists over.
    await request.post(`${CONTROL}/scenario`, { data: { scenario: 'humid', active: true } });
    await page.waitForTimeout(14_000);
    // Night (forced here; with the real sun it takes the whole twilight).
    await page.getByRole('button', { name: 'Ajustes' }).click();
    await page.getByRole('radio', { name: 'Noche' }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Cerrar' }).click();
    await page.waitForTimeout(9000);
    const video = page.video();
    await context.close();
    if (video) await video.saveAs(path.join(OUT, `${DATE}-faseA-9-grabacion.webm`));
    rmSync(dir, { recursive: true, force: true });
  });
});
