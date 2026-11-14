import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { CONTROL, openLive, resetSimulator, setSoil } from './helpers.ts';

/** A2: touch zones, warnings on the plants, home view, shortcuts and Undo. */

interface SimState {
  actuators: { growLight: boolean; pump: boolean };
  moisture: Record<string, number>;
}

async function simState(request: APIRequestContext): Promise<SimState> {
  return (await (await request.get(`${CONTROL}/state`)).json()) as SimState;
}

/** Where the app thinks a plant is on screen (its keyboard target). */
async function plantPoint(page: Page, zone: string) {
  const transform = await page
    .locator(`.plant-target[data-zone="${zone}"]`)
    .evaluate((element: HTMLElement) => element.style.transform);
  const match = /translate\(([\d.]+)px, ([\d.]+)px\)/.exec(transform);
  expect(match).not.toBeNull();
  return { x: Number(match?.[1]), y: Number(match?.[2]) };
}

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test('a tap on a plant opens it, even a small pot (44 px touch zone)', async ({ page }) => {
    await openLive(page, '?theme=day');
    const point = await plantPoint(page, 'basil_01');
    // The anchor is the top of the plant; the touch zone is around it.
    await page.touchscreen.tap(point.x, point.y + 12);
    await expect(page.getByRole('heading', { name: 'Albahaca' })).toBeVisible();
  });
});

test('a drag that starts on a plant turns the camera, it does not open it', async ({ page }) => {
  await openLive(page, '?theme=day');
  const point = await plantPoint(page, 'basil_01');
  await page.mouse.move(point.x, point.y + 12);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(point.x + i * 15, point.y + 12);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeHidden();
  // The camera moved away from the home view, so its button appears; it goes back.
  const home = page.getByRole('button', { name: 'Vista inicial' });
  await expect(home).toBeVisible();
  await home.click();
  await expect(home).toBeHidden({ timeout: 5_000 });
});

test('a thirsty plant carries a warning; tapping it opens the plant', async ({ page, request }) => {
  await setSoil(request, 'parsley_01', 0.1);
  await openLive(page, '?theme=day');
  const marker = page.locator('.plant-marker[data-zone="parsley_01"]');
  await expect(marker).toHaveAttribute('data-kind', 'warning');
  await expect(marker).toHaveAttribute('data-placed', 'true');
  await expect(page.locator('.plant-marker[data-zone="basil_01"]')).toHaveCount(0);
  // Markers let the pointer through; the scene recognises the tap.
  await marker.click({ force: true });
  await expect(page.getByRole('heading', { name: 'Perejil' })).toBeVisible();
});

test('every plant is reachable with the keyboard, warning included', async ({ page, request }) => {
  await setSoil(request, 'lettuce_01', 0.1);
  await openLive(page, '?theme=day');
  const targets = page.locator('.plant-target');
  await expect(targets).toHaveCount(6);
  const lettuce = page.locator('.plant-target[data-zone="lettuce_01"]');
  await expect(lettuce).toHaveAccessibleName(/Lechuga: .*tiene sed/);
  await lettuce.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Lechuga' })).toBeFocused();
});

test('shortcuts: 1–6, H and ?', async ({ page }) => {
  await openLive(page, '?theme=day');
  await page.keyboard.press('2');
  await expect(page.getByRole('heading', { name: 'Perejil' })).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.keyboard.press('?');
  await expect(page.getByRole('heading', { name: 'Atajos de teclado' })).toBeVisible();
});

test('a successful toggle says nothing: the button shows the state (D85)', async ({
  page,
  request,
}) => {
  await openLive(page, '?theme=day');
  const before = (await simState(request)).actuators.growLight;
  await page.getByRole('button', { name: /^Luz/ }).click();
  await expect.poll(async () => (await simState(request)).actuators.growLight).toBe(!before);
  await page.waitForTimeout(1_000);
  await expect(page.locator('.ui-toast')).toHaveCount(0);
});

test('a plant never watered can be watered', async ({ page, request }) => {
  await openLive(page, '?theme=day');
  await page.keyboard.press('6');
  await expect(page.getByRole('heading', { name: 'Tomate cherry' })).toBeVisible();
  const water = page.locator('.primary-button');
  await expect(water).toBeEnabled();
  await water.click();
  await expect.poll(async () => (await simState(request)).actuators.pump).toBe(true);
  await expect(water).toContainText('Regando');
});

test('the hourly limit says which one and until when; the button is disabled (D85)', async ({
  page,
  request,
}) => {
  await request.post(`${CONTROL}/pump-budget`);
  await openLive(page, '?theme=day');
  await page.keyboard.press('1');
  const water = page.locator('.primary-button');
  await water.click();
  await expect(water).toHaveText(/^Disponible a las \d\d:\d\d$/);
  await expect(water).toBeDisabled();
  await expect(page.locator('.plant-reason')).toHaveText(
    /Límite de riego por hora \(60 s\) · vuelve a las \d\d:\d\d/,
  );
});

test('plant markers step aside while a menu or a sheet is open (D85)', async ({
  page,
  request,
}) => {
  await setSoil(request, 'basil_01', 0.1);
  await openLive(page, '?theme=day');
  const marker = page.locator('.plant-marker[data-zone="basil_01"]');
  await expect(marker).toHaveCount(1);
  await page.getByRole('button', { name: 'Regar', exact: true }).click();
  await expect(page.locator('.plant-marker')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(marker).toHaveCount(1);
  await page.keyboard.press('2');
  await expect(page.locator('.plant-marker')).toHaveCount(0);
});

test('the Aire menu is a small popover above the dock', async ({ page }) => {
  await openLive(page, '?theme=day');
  await page.getByRole('button', { name: 'Aire', exact: true }).click();
  const popover = page.locator('.dock-popover');
  // Measured once its opening animation (a short slide up) has finished.
  await popover.waitFor();
  await page.waitForTimeout(500);
  const box = await popover.boundingBox();
  const bar = await page.locator('.dock-bar').boundingBox();
  expect(box && bar).toBeTruthy();
  if (!box || !bar) return;
  expect(box.width).toBeLessThan(360);
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
});

test('watering starts at once and Detener stops the pump (D84)', async ({ page, request }) => {
  await setSoil(request, 'parsley_01', 0.3);
  await openLive(page, '?theme=day');
  await page.getByRole('button', { name: 'Regar', exact: true }).click();
  await page.locator('.menu-row[data-zone="parsley_01"]').click();
  await page.getByRole('radio', { name: '10 s' }).click();
  await page.locator('.primary-button').click();
  await expect.poll(async () => (await simState(request)).actuators.pump).toBe(true);
  await page.getByRole('button', { name: 'Detener' }).click();
  await expect.poll(async () => (await simState(request)).actuators.pump).toBe(false);
  // Stopped early: far less than ten seconds of water (0.03 per second).
  expect((await simState(request)).moisture['parsley_01']).toBeLessThan(0.3 + 0.03 * 6);
  await expect(page.locator('.primary-button')).toHaveText('Regar ahora');
  await expect(page.getByRole('button', { name: 'Detener' })).toBeHidden();
});

test('a tap on a warning registers even if the finger moves a little', async ({
  page,
  request,
}) => {
  await setSoil(request, 'strawberry_01', 0.1);
  await openLive(page, '?theme=day');
  const box = await page.locator('.plant-marker[data-zone="strawberry_01"]').boundingBox();
  expect(box).not.toBeNull();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 6, y + 3);
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: 'Fresa' })).toBeVisible();
});
