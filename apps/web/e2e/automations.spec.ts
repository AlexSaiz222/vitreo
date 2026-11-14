import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { CONTROL, HUB, openLive, resetSimulator, setSoil } from './helpers.ts';

/**
 * A6: the greenhouse's own automations, on the isolated test stack (its own
 * simulator `e2e`, hub and broker topics): never the greenhouse in daily use.
 */

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
});

async function openBasil(page: Page) {
  await page.locator('.plant-target[data-zone="basil_01"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Albahaca' })).toBeVisible();
}

async function expectAccessible(page: Page) {
  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
}

async function setRange(page: Page, label: string, value: number) {
  await page.getByRole('slider', { name: label }).fill(String(value));
}

/**
 * Turns on the basil's automatic watering at 35 % and saves. `anyHour` lifts
 * the quiet night (22:00–08:00 by default), so the test does not depend on
 * the time it runs.
 */
async function enableBasil(page: Page, anyHour = false) {
  await openBasil(page);
  const section = page.locator('.automation');
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('switch', { name: /Regar sola/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await section.getByRole('switch', { name: /Regar sola/ }).click();
  await setRange(page, 'Pide agua por debajo de', 35);
  if (anyHour) await section.getByRole('switch', { name: /De noche no/ }).click();
  await section.getByRole('button', { name: 'Guardar' }).click();
}

test('automatic watering: off by default, then applied by the greenhouse, never before', async ({
  page,
  request,
}) => {
  await openLive(page);
  await enableBasil(page);
  // Saving first, then only "applied" when the greenhouse says so.
  const status = page.locator('.automation .config-status');
  await expect(status).toHaveText(/Aplicado en el invernadero/, { timeout: 15_000 });
  interface State {
    config: { rev: number; watering: { zone: string; enabled: boolean; threshold: number }[] };
    appliedRev: number;
  }
  const read = async () => (await (await request.get(`${HUB}/config`)).json()) as State;
  // The app hears config.applied straight from the broker; the hub records
  // the same event through its own subscription, a moment later.
  await expect
    .poll(async () => {
      const state = await read();
      return state.appliedRev === state.config.rev;
    })
    .toBe(true);
  const config = await read();
  expect(config.config.watering.find((rule) => rule.zone === 'basil_01')).toMatchObject({
    enabled: true,
    threshold: 0.35,
  });
  await expect(page.locator('.automation')).toContainText(
    'Riega 5 s por debajo del 35 %, como mucho 2 veces al día, con 1 h de pausa',
  );
  await expectAccessible(page);
});

test('the greenhouse waters on its own, and says why', async ({ page, request }) => {
  await openLive(page);
  await enableBasil(page, true);
  await expect(page.locator('.automation .config-status')).toHaveText(/Aplicado/, {
    timeout: 15_000,
  });
  // The soil dries (from the test simulator): the next check waters it.
  await setSoil(request, 'basil_01', 0.2);
  await expect(page.locator('.plant-fact', { hasText: 'Último riego' })).toContainText(
    /Riego automático · tierra \d+\s% < 35\s%/,
    { timeout: 30_000 },
  );
});

test('while the greenhouse is away, a change is pending; it applies when it is back', async ({
  page,
  request,
}) => {
  await openLive(page);
  await request.post(`${CONTROL}/scenario`, { data: { scenario: 'disconnect', active: true } });
  await enableBasil(page);
  const status = page.locator('.automation .config-status');
  await expect(status).toHaveText('Pendiente: el invernadero aún no lo ha confirmado.', {
    timeout: 15_000,
  });
  await request.post(`${CONTROL}/scenario`, { data: { scenario: 'disconnect', active: false } });
  await expect(status).toHaveText(/Aplicado en el invernadero/, { timeout: 20_000 });
});

test('ventilation and light live in Ajustes, with the sun at the greenhouse', async ({ page }) => {
  await openLive(page);
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.getByRole('button', { name: /^Ventilación y luz/ })).toContainText(
    'Apagadas: las mueves tú',
  );
  await page.getByRole('button', { name: /^Ventilación y luz/ }).click();
  await page.getByRole('switch', { name: /Ventilar sola/ }).click();
  await setRange(page, 'Ventilador desde', 26);
  await page.getByRole('switch', { name: /Encender la luz sola/ }).click();
  await page.getByRole('radio', { name: 'Con el sol' }).click();
  await expect(page.getByText(/Hoy, de \d\d:\d\d a \d\d:\d\d\./)).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.config-status')).toHaveText(/Aplicado en el invernadero/, {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Volver a Ajustes' }).click();
  await expect(page.getByRole('button', { name: /^Ventilación y luz/ })).toContainText(
    'Ventila sola · Luz con el sol',
  );
});
