import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * "Cómo se hizo" (D113, D117, D133): the demo's notebook, a page of its own
 * at /cuaderno, a visit through the demo in seven stops. Reached from the
 * demo's bar, back to the greenhouse in one step; every picture arrives,
 * the clips play only on screen (and wait with reduced motion), nothing
 * comes from another site, and it reads well with a screen reader. Run with
 * `pnpm e2e:demo`.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-cuaderno-${name}.png`);
const DEVICES = [
  ['escritorio', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  [
    'movil',
    { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ],
] as const;

/** Scrolls to the end so every lazy picture loads, then back to the top. */
async function loadEveryPicture(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await Promise.all(
      [...document.images]
        .filter((img) => !img.complete)
        .map((img) => img.decode().catch(() => undefined)),
    );
    window.scrollTo(0, 0);
  });
}

test('the demo bar leads to the notebook, and it leads back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Cómo se hizo' }).click();
  await expect(page).toHaveURL(/\/cuaderno$/);
  await expect(page).toHaveTitle('Cómo se hizo · Vitreo');
  await expect(page.getByRole('heading', { level: 1, name: 'Cómo se hizo' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver al invernadero' }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.status')).toBeVisible();
});

test('every picture and clip arrives, with words for it, and nothing comes from another site', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/cuaderno');
  await loadEveryPicture(page);
  const pictures = await page.locator('img').evaluateAll((images) =>
    (images as HTMLImageElement[]).map((img) => ({
      alt: img.alt,
      loaded: img.complete && img.naturalWidth > 0,
    })),
  );
  expect(pictures.length).toBeGreaterThanOrEqual(25);
  expect(pictures.filter((p) => !p.loaded || p.alt.length < 20)).toEqual([]);
  // The clips: the cover's and one in six sections, each described.
  const clips = page.locator('video');
  await expect(clips).toHaveCount(7);
  const labels = await clips.evaluateAll((videos) =>
    videos.map((video) => video.getAttribute('aria-label') ?? ''),
  );
  expect(labels.filter((label) => label.length < 20)).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((url) => !url.startsWith(origin) && !url.startsWith('data:'))).toEqual([]);
  // The notebook is only the notebook: no worker, no hub, no 3D model.
  expect(requests.filter((url) => /worker|sql-wasm|\.glb/.test(url))).toEqual([]);
});

test('the notebook reads well with assistive technology (axe)', async ({ page }) => {
  await page.goto('/cuaderno');
  await loadEveryPicture(page);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('every link and button is reachable by keyboard and at least 44 px tall', async ({ page }) => {
  await page.goto('/cuaderno');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Volver al invernadero' }).first()).toBeFocused();
  const small = await page
    .locator('a, button, summary')
    .evaluateAll((targets) =>
      targets
        .filter((a) => a.checkVisibility() && a.getBoundingClientRect().height < 44)
        .map((a) => a.textContent),
    );
  expect(small).toEqual([]);
});

test('on a wide screen the index stays beside the reading and follows it (D117)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/cuaderno');
  const index = page.getByRole('navigation', { name: 'Índice' });
  await expect(index).toBeVisible();
  // The seven stops, by name.
  await expect(index.getByRole('link', { name: /^\d/ })).toHaveCount(7);
  await index.getByRole('link', { name: /Una planta/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Una planta' })).toBeInViewport();
  // The stop opens its sections in the index; scrolling on marks where you are.
  await expect(index.getByRole('link', { name: 'La ficha' })).toBeVisible();
  await page.locator('#lo-que-no-se-sabe').scrollIntoViewIfNeeded();
  await expect(
    index.getByRole('link', { name: 'Lo que no se sabe, no se inventa' }),
  ).toHaveAttribute('aria-current', 'location');
  await expect(index).toBeInViewport();
});

test('on a phone the bar says where you are and opens the index (D117)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/cuaderno');
  await expect(page.getByRole('navigation', { name: 'Índice' })).toBeHidden();
  await page.getByRole('button', { name: 'Índice' }).click();
  const dialog = page.getByRole('dialog', { name: 'Índice' });
  await dialog.getByRole('link', { name: /Aire y luz/ }).click();
  await expect(dialog).toBeHidden();
  const heading = page.getByRole('heading', { level: 2, name: 'Aire y luz' });
  await expect(heading).toBeInViewport();
  await expect(page.locator('.notebook-bar-title')).toContainText('Aire y luz');
  // The heading is not hidden under the bar.
  const bar = await page.locator('.notebook-bar').boundingBox();
  const box = await heading.boundingBox();
  expect((box?.y ?? 0) >= (bar?.y ?? 0) + (bar?.height ?? 0)).toBe(true);
});

test('a link to a section opens the notebook at that section', async ({ page }) => {
  await page.goto('/cuaderno#rebobinar');
  await expect(page.getByRole('heading', { level: 3, name: 'Rebobinar' })).toBeInViewport();
});

test('a capture opens larger, with its caption, and closes with Escape (D117)', async ({
  page,
}) => {
  await page.goto('/cuaderno#la-ficha');
  const capture = page.locator('#la-ficha .notebook-zoom');
  await capture.click();
  const zoomed = page.getByRole('dialog', { name: 'Captura ampliada' });
  await expect(zoomed).toBeVisible();
  await expect(zoomed).toContainText('La ficha de la albahaca');
  await expect(zoomed.getByRole('img')).toHaveJSProperty('complete', true);
  await page.keyboard.press('Escape');
  await expect(zoomed).toBeHidden();
  await expect(capture).toBeFocused();
});

test('a comparison moves with its handle, also from the keyboard (D133)', async ({ page }) => {
  await page.goto('/cuaderno#luz-horneada');
  const slider = page.getByRole('slider', { name: /Comparar: De día .* De noche/ });
  await expect(slider).toHaveValue('50');
  await slider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('55');
  const split = await page
    .locator('#luz-horneada .notebook-compare')
    .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--split'));
  expect(split).toBe('55%');
});

test('a clip plays while it is on screen, and its button pauses it (D133)', async ({ page }) => {
  await page.goto('/cuaderno#regar-y-poder-parar');
  const video = page.locator('#regar-y-poder-parar video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page
    .locator('#regar-y-poder-parar')
    .getByRole('button', { name: 'Pausar el vídeo' })
    .click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(
    page.locator('#regar-y-poder-parar').getByRole('button', { name: 'Reproducir el vídeo' }),
  ).toBeVisible();
});

test('with reduced motion a clip waits to be asked (D133)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/cuaderno#regar-y-poder-parar');
  const section = page.locator('#regar-y-poder-parar');
  const video = section.locator('video');
  await expect(section.getByRole('button', { name: 'Reproducir el vídeo' })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await section.getByRole('button', { name: 'Reproducir el vídeo' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
});

test('the decisions behind each stop are folded, and open with their numbers (D133)', async ({
  page,
}) => {
  await page.goto('/cuaderno#la-escena');
  const decisions = page.locator('#la-escena .notebook-decisions');
  await expect(decisions.locator('li').first()).toBeHidden();
  await decisions.locator('summary').click();
  await expect(decisions.getByText('D40', { exact: true })).toBeVisible();
});

for (const [device, options] of DEVICES) {
  test.describe(`captures ${device} @capture`, () => {
    test.use(options);

    test(`the notebook (${device})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/cuaderno');
      await loadEveryPicture(page);
      await page.screenshot({ path: file(`portada-${device}`) });
      const stops = page.locator('article.notebook-stop');
      for (let i = 0; i < (await stops.count()); i++) {
        await stops.nth(i).screenshot({ path: file(`parada-${String(i + 1)}-${device}`) });
      }
    });
  });
}
