import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { CONTROL, fakePush, HUB, openLive, resetSimulator } from './helpers.ts';

/**
 * A7: warnings and web push, on the isolated test stack. The test hub never
 * sends a real notification (it records them), and the browser's push
 * service is a stand-in: nothing here can reach a real phone.
 */

const ENDPOINT = 'https://push.example/e2e-browser';

interface Sent {
  endpoint: string;
  message: { title: string; body: string; tag: string; url: string; renotify: boolean };
}

const pushes = async (request: APIRequestContext) =>
  (await (await request.get(`${HUB}/test/pushes`)).json()) as Sent[];

async function openAlerts(page: Page) {
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await page.getByRole('button', { name: /^Avisos/ }).click();
  await expect(page.getByRole('heading', { name: 'Avisos', exact: true })).toBeFocused();
}

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
});

test('turning warnings on asks permission only on tap, and "Probar aviso" reaches this device', async ({
  page,
  request,
}) => {
  await fakePush(page);
  await openLive(page);
  // Nothing asked on load.
  expect(
    await page.evaluate(() => (window as unknown as { __push: { asked: number } }).__push.asked),
  ).toBe(0);
  await openAlerts(page);
  await expect(page.getByText(/con el PC apagado o dormido no llega ninguno/)).toBeVisible();
  await page.getByRole('button', { name: 'Activar avisos' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Avisos activados' })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __push: { asked: number } }).__push.asked),
  ).toBe(1);

  await page.getByRole('button', { name: 'Probar aviso' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enviado' })).toBeVisible();
  expect(await pushes(request)).toEqual([
    expect.objectContaining({
      endpoint: ENDPOINT,
      message: expect.objectContaining({ title: 'Prueba de Vitreo' }),
    }),
  ]);

  // Each type can be switched off, and the hub knows.
  await page.getByRole('switch', { name: /Plantas con sed/ }).click();
  await expect
    .poll(
      async () =>
        (
          (await (
            await request.post(`${HUB}/push/subscription/prefs`, { data: { endpoint: ENDPOINT } })
          ).json()) as { types: string[] }
        ).types,
    )
    .toEqual(['tank', 'safety', 'frost_forecast', 'no_data']);

  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test('the same warning the app shows becomes one notification, then "Resuelto"', async ({
  page,
  request,
}) => {
  await request.put(`${HUB}/push/subscription`, {
    data: {
      subscription: {
        endpoint: 'https://push.example/e2e-phone',
        keys: { p256dh: 'k', auth: 'a' },
      },
      prefs: { types: ['tank', 'safety', 'no_data', 'thirsty'] },
    },
  });
  await openLive(page);
  await request.post(`${CONTROL}/tank`, { data: { level: 0.02 } });
  // The app says it at once…
  await expect(page.getByText('El depósito está vacío: no se puede regar')).toBeVisible();
  // …and the hub, once it has the reading, notifies once.
  await expect
    .poll(async () => {
      await request.post(`${HUB}/test/evaluate`);
      return (await pushes(request)).map((p) => p.message.title);
    })
    .toEqual(['Depósito vacío']);
  await request.post(`${HUB}/test/evaluate`);
  expect(await pushes(request)).toHaveLength(1);
  expect((await pushes(request))[0]?.message).toMatchObject({ url: '/?open=tank', renotify: true });

  await openAlerts(page);
  await expect(page.locator('.alerts-item').first()).toContainText('Depósito vacío');
  await expect(page.locator('.alerts-item').first()).toContainText('sigue abierto');

  await request.post(`${CONTROL}/tank`, { data: { level: 0.8 } });
  await expect
    .poll(async () => {
      await request.post(`${HUB}/test/evaluate`);
      return (await pushes(request)).at(-1)?.message;
    })
    .toMatchObject({ title: 'Resuelto: Depósito vacío', renotify: false, tag: 'tank_empty' });
});

test('a notification opens the app on its plant, the tank or the air', async ({ page }) => {
  await openLive(page, '?open=plant:basil_01');
  await expect(page.getByRole('heading', { name: 'Albahaca' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await openLive(page, '?open=air');
  await expect(page.getByRole('group', { name: 'Aire' })).toBeVisible();
  await openLive(page, '?open=tank');
  await expect(page.getByRole('group', { name: 'Elige una planta para regar' })).toBeVisible();
});
