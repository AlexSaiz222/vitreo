import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { openLive, resetHub } from './helpers.ts';

/** A3: Ajustes, quality and the view without 3D, the welcome. */

// Plant names as new: another spec on this worker may have renamed one.
test.beforeEach(async ({ request }) => {
  await resetHub(request);
});

test('without 3D the plants are a list and the model is never downloaded', async ({ page }) => {
  const models: string[] = [];
  page.on('request', (request) => {
    if (/\.(glb|webp)$/.test(new URL(request.url()).pathname)) models.push(request.url());
  });
  await page.goto('/?quality=flat');
  await expect(page.locator('[data-quality="flat"]')).toBeVisible();
  const rows = page.locator('.plant-list .menu-row');
  await expect(rows).toHaveCount(6);
  await rows.first().click();
  await expect(page.getByRole('heading', { name: 'Albahaca' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(models).toEqual([]);
});

test('the quality is remembered: Sin 3D, then back to 3D', async ({ page }) => {
  await openLive(page);
  await page.getByRole('button', { name: 'Ajustes' }).click();
  const quality = page.getByRole('radiogroup', { name: 'Calidad del 3D' });
  await quality.getByRole('radio', { name: 'Sin 3D' }).click();
  await expect(page.locator('.plant-list')).toBeVisible();
  await page.reload();
  await expect(page.locator('.plant-list')).toBeVisible();
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await quality.getByRole('radio', { name: 'Alta' }).click();
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('Ajustes passes an accessibility check and closes with Escape', async ({ page }) => {
  await openLive(page);
  const button = page.getByRole('button', { name: 'Ajustes' });
  await button.click();
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeFocused();
  // After its short fade-in: mid-fade, text is still partly transparent.
  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeHidden();
  await expect(button).toBeFocused();
});

test.describe('first visit', () => {
  // A device that has never seen the welcome.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the welcome shows once, steps with the keyboard and can be seen again', async ({
    page,
  }) => {
    await page.goto('/?quality=high');
    const welcome = page.getByRole('dialog', { name: /Vitreo/ });
    await expect(welcome).toBeVisible();
    await page.waitForTimeout(500);
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    for (const title of ['Cómo leerlo', 'Tocar y mirar', 'Conexión']) {
      await page.getByRole('button', { name: 'Siguiente' }).click();
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    }
    await expect(page.getByText(/simulador: datos de prueba/)).toBeVisible();
    await page.getByRole('button', { name: 'Empezar' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.reload();
    await expect(page.locator('.status')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vitreo', level: 2 })).toHaveCount(0);

    await page.getByRole('button', { name: 'Ajustes' }).click();
    await page.getByRole('button', { name: 'Ver la bienvenida' }).click();
    await expect(page.getByRole('heading', { name: 'Vitreo', level: 2 })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Vitreo', level: 2 })).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test('Ajustes opens at full height, so nothing in it is hidden', async ({ page }) => {
    await openLive(page);
    await page.getByRole('button', { name: 'Ajustes' }).click();
    await expect(page.locator('.settings-sheet')).toHaveAttribute('data-size', 'full');
    await page.getByText('Acerca de').scrollIntoViewIfNeeded();
    await expect(page.getByText('Acerca de')).toBeInViewport();
  });
});
