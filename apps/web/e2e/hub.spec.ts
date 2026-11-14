import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { HUB, openLive, resetSimulator } from './helpers.ts';

/** A4: the hub keeps names and location; when it is down the app says so calmly. */

/** The app's calls to the hub (not Vite's modules, such as shared/src/api). */
const HUB_API = /\/api\/v1\//;

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
});

async function openSettingsPage(page: Page, row: 'Plantas' | 'Ubicación') {
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await page.getByRole('button', { name: new RegExp(`^${row}`) }).click();
  await expect(page.getByRole('heading', { name: row })).toBeFocused();
}

async function expectAccessible(page: Page) {
  // After the sheet's short fade-in.
  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
}

test('a plant gets a name and a sowing day; the whole app uses the name', async ({ page }) => {
  await openLive(page);
  await openSettingsPage(page, 'Plantas');
  await expectAccessible(page);
  await page.locator('.settings-list [data-zone="basil_01"]').click();
  await expect(page.getByRole('heading', { name: 'Albahaca' })).toBeFocused();

  const name = page.getByLabel('Nombre');
  await expect(name).toHaveAttribute('placeholder', 'Albahaca');
  const save = page.getByRole('button', { name: 'Guardar' });
  await expect(save).toBeDisabled();
  await name.fill('Pepa');
  await page.getByLabel('Fecha de siembra').fill('2026-04-01');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Guardado.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pepa' })).toBeVisible();
  await expectAccessible(page);

  // Kept by the hub, by zone id.
  const plants: unknown = await (await page.request.get(`${HUB}/plants`)).json();
  expect(plants).toContainEqual({
    zone: 'basil_01',
    kind: 'basil',
    name: 'Pepa',
    sownAt: '2026-04-01',
    // Renamed, not replaced: still the first plant in the pot (A12).
    since: null,
  });

  await page.getByRole('button', { name: 'Volver a Plantas' }).click();
  await expect(page.locator('.settings-list [data-zone="basil_01"]')).toContainText(
    'Albahaca · sembrada el 1 abr 2026',
  );
  await page.getByRole('button', { name: 'Cerrar' }).click();

  // The Regar menu and the plant's sheet call it by its name.
  await page.getByRole('button', { name: /^Regar/ }).click();
  await expect(page.locator('.dock-menu [data-zone="basil_01"]')).toContainText('Pepa');
  await page.locator('.dock-menu [data-zone="basil_01"]').click();
  await expect(page.getByRole('heading', { name: 'Pepa' })).toBeVisible();
  await expect(page.getByText('Albahaca · Ocimum basilicum')).toBeVisible();
});

test('the location is kept by the hub, rounded, and shows the sun there', async ({ page }) => {
  await openLive(page);
  await openSettingsPage(page, 'Ubicación');
  const lat = page.getByLabel('Latitud');
  const lng = page.getByLabel('Longitud');
  await expect(lat).toHaveValue('40,42');
  await expect(lng).toHaveValue('-3,70');
  await expect(page.getByText(/Allí hoy amanece a las \d\d:\d\d/)).toBeVisible();
  await expectAccessible(page);

  await lat.fill('41.38879');
  await lng.fill('2,15899');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Guardado.' })).toBeVisible();
  const settings: unknown = await (await page.request.get(`${HUB}/settings`)).json();
  expect(settings).toMatchObject({ location: { lat: 41.39, lng: 2.16 } });

  await page.reload();
  await openSettingsPage(page, 'Ubicación');
  await expect(lat).toHaveValue('41,39');

  await lat.fill('120');
  await expect(page.getByText('Entre −90 y 90.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled();
});

test.describe('with the hub down', () => {
  test('the greenhouse keeps working and each place says why it waits', async ({
    page,
    request,
  }) => {
    // A name first, while the hub is up: the app remembers it.
    await request.patch(`${HUB}/plants/basil_01`, { data: { name: 'Pepa' } });
    await openLive(page);
    await expect(page.locator('.plant-target[data-zone="basil_01"]')).toHaveAccessibleName(
      /^Pepa:/,
    );

    // Now the hub stops answering (as if the PC's Docker were stopped).
    await page.route(HUB_API, (route) => route.fulfill({ status: 502, body: '' }));
    await page.reload();
    await expect(page.locator('.status')).toHaveAttribute('data-freshness', 'live', {
      timeout: 15_000,
    });
    // No alarm: the status line speaks of the greenhouse only.
    await expect(page.locator('.status-line')).not.toContainText('hub');
    // The remembered name is still used.
    await expect(page.locator('.plant-target[data-zone="basil_01"]')).toHaveAccessibleName(
      /^Pepa:/,
    );
    // The controls go through the broker, not the hub.
    await expect(page.getByRole('button', { name: /^Regar/ })).toBeEnabled();

    await page.getByRole('button', { name: 'Ajustes' }).click();
    await expect(page.locator('.plant-fact', { hasText: 'Hub' })).toContainText(
      /El hub no responde desde las \d\d:\d\d/,
    );
    await page.getByRole('button', { name: /^Plantas/ }).click();
    await expect(
      page.getByText(/no responde desde .*: los nombres se podrán cambiar/),
    ).toBeVisible();
    await page.locator('.settings-list [data-zone="basil_01"]').click();
    await page.getByLabel('Nombre').fill('Pepita');
    const save = page.getByRole('button', { name: 'Guardar' });
    await expect(save).toBeDisabled();
    await expect(save).toHaveAccessibleDescription(/el cambio se podrá guardar cuando vuelva/);
    await expectAccessible(page);

    // It comes back: on the next check (or when the app returns to the front).
    await page.unroute(HUB_API);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });
    await expect(save).toBeEnabled();
  });
});
