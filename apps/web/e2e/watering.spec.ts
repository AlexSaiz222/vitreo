import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { CONTROL, openLive, resetSimulator, setSoil } from './helpers.ts';

interface SimState {
  moisture: Record<string, number>;
  actuators: { growLight: boolean };
}

async function simState(request: APIRequestContext): Promise<SimState> {
  return (await (await request.get(`${CONTROL}/state`)).json()) as SimState;
}

/** docs/03: watering goes Regar → plant → detail sheet. */
async function openSheet(page: Page, zone: string) {
  await page.getByRole('button', { name: 'Regar', exact: true }).click();
  await page.locator(`.menu-row[data-zone="${zone}"]`).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return sheet;
}

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
});

// Phase 1 "done when": tapping "Regar" in the simulator darkens the soil.
test('watering from the detail sheet confirms, counts down and wets the soil', async ({
  page,
  request,
}) => {
  await setSoil(request, 'basil_01', 0.2);
  await openLive(page);
  const sheet = await openSheet(page, 'basil_01');
  await expect(sheet.getByRole('heading', { name: 'Albahaca' })).toBeFocused();
  await expect(sheet).toContainText('Tiene sed');

  await sheet.getByRole('radio', { name: '3 s' }).click();
  const water = sheet.locator('.primary-button');
  await water.click();
  await expect(water).toContainText('Regando');
  await expect(water).toBeDisabled();

  // Done, said for a moment (D128), then ready again.
  await expect(water).toHaveText('Regada', { timeout: 10_000 });
  await expect(water).toHaveText('Regar ahora', { timeout: 10_000 });
  expect((await simState(request)).moisture['basil_01']).toBeGreaterThan(0.25);
  await expect(sheet).toContainText(/Último riego\s*hoy a las \d\d:\d\d · 3 s/);
});

test('an empty tank is explained, not hidden', async ({ page, request }) => {
  await request.post(`${CONTROL}/scenario`, { data: { scenario: 'tank_empty', active: true } });
  await openLive(page);
  const sheet = await openSheet(page, 'parsley_01');
  await sheet.locator('.primary-button').click();
  await expect(sheet.locator('.primary-button')).toHaveText('Sin agua en el depósito');
});

test('the sheet closes with Escape', async ({ page }) => {
  await openLive(page);
  await openSheet(page, 'lettuce_01');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('zooming out with the wheel leaves the plant focus', async ({ page }) => {
  await openLive(page);
  await openSheet(page, 'basil_01');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  // Zooming in keeps the plant open…
  await page.mouse.wheel(0, -120);
  await expect(page.getByRole('dialog')).toBeVisible();
  // …zooming out closes it.
  await page.mouse.wheel(0, 120);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('after leaving a plant with the wheel, the wheel zooms freely at once', async ({ page }) => {
  await openLive(page);
  const zoom = async () => Number(await page.locator('html').getAttribute('data-camera-zoom'));
  const notches = async (dy: number, count: number) => {
    for (let i = 0; i < count; i++) {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(40);
    }
  };
  const rest = await zoom();
  await openSheet(page, 'basil_01');
  await page.waitForTimeout(1500);
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  // One notch out leaves the plant; zooming in right away, while the view
  // is still going back, must work (it used to be undone frame by frame).
  await notches(100, 1);
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.waitForTimeout(150);
  await notches(-100, 3);
  await page.waitForTimeout(2000);
  const zoomedIn = await zoom();
  expect(zoomedIn).toBeGreaterThan(rest * 1.05);
  // And out again, freely.
  await notches(100, 6);
  await page.waitForTimeout(1000);
  expect(await zoom()).toBeLessThan(zoomedIn);
});

test('Ajustes › Apariencia: day by default, forces the scene light, is remembered, and goes to auto', async ({
  page,
}) => {
  await openLive(page);
  const html = page.locator('html');
  const appearance = () => page.getByRole('radiogroup', { name: 'Apariencia' });
  // Nothing chosen: day (D116), whatever the sun is doing.
  await expect(html).toHaveAttribute('data-theme', 'day');
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await expect(appearance().getByRole('radio', { name: 'Día' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await appearance().getByRole('radio', { name: 'Noche' }).click();
  await expect(html).toHaveAttribute('data-theme', 'night');
  // Remembered across visits.
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'night');
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await appearance().getByRole('radio', { name: 'Auto' }).click();
  await expect(appearance().getByRole('radio', { name: 'Auto' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('the grow light switches with one tap', async ({ page, request }) => {
  await openLive(page);
  const light = page.getByRole('button', { name: /^Luz/ });
  // The simulator keeps the light as it was left (the app in use may have
  // switched it on): each tap must flip it, whichever way it starts.
  const before = (await simState(request)).actuators.growLight;
  // The name, not the text: both words stay in the page, one hidden (SwapText, D129).
  const text = (on: boolean) => (on ? /Encendida/ : /Apagada/);
  await expect(light).toHaveAccessibleName(text(before));
  await light.click();
  await expect(light).toHaveAccessibleName(text(!before));
  await expect(light).toHaveAttribute('aria-pressed', String(!before));
  expect((await simState(request)).actuators.growLight).toBe(!before);
  await light.click();
  await expect(light).toHaveAccessibleName(text(before));
  expect((await simState(request)).actuators.growLight).toBe(before);
});

test('a disconnected device falls asleep and says since when', async ({ page, request }) => {
  await openLive(page);
  await request.post(`${CONTROL}/scenario`, { data: { scenario: 'disconnect', active: true } });
  await expect(page.locator('.app-scene')).toHaveAttribute('data-freshness', 'disconnected');
  await expect(page.locator('.status-line')).toContainText(/Desconectado desde las \d\d:\d\d/);
  for (const name of [/^Regar$/, /^Luz/, /^Aire$/]) {
    await expect(page.getByRole('button', { name })).toBeDisabled();
  }
  await request.post(`${CONTROL}/scenario`, { data: { scenario: 'disconnect', active: false } });
  await expect(page.locator('.app-scene')).toHaveAttribute('data-freshness', 'live');
});

test.describe('on a phone', () => {
  // Reduced motion: the sheet snaps between sizes (the app honours it with
  // --motion-scale), so gestures do not race CSS transitions on software WebGL.
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

  /** Waits until the sheet has stopped moving (its transition can lag on software WebGL). */
  async function settledHandle(page: Page) {
    const handle = page.locator('.ui-sheet-handle');
    let previous = await handle.boundingBox();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(150);
      const current = await handle.boundingBox();
      if (current && previous && Math.abs(current.y - previous.y) < 0.5) return current;
      previous = current;
    }
    throw new Error('the sheet did not settle');
  }

  async function swipe(page: Page, dy: number) {
    const box = await settledHandle(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy / 2, { steps: 5 });
    await page.mouse.move(x, y + dy, { steps: 5 });
    await page.mouse.up();
  }

  test('the sheet opens at half height, swipes up to expand and down to close', async ({
    page,
  }) => {
    await openLive(page);
    const sheet = await openSheet(page, 'basil_01');
    await expect(sheet).toHaveAttribute('data-size', 'half');
    await settledHandle(page);
    await expect(sheet.locator('.primary-button')).toBeInViewport();
    await expect(sheet.locator('.ui-sheet-more')).not.toBeInViewport({ ratio: 0.5 });

    await swipe(page, -220);
    await expect(sheet).toHaveAttribute('data-size', 'full');
    await settledHandle(page);
    await expect(sheet.locator('.ui-sheet-more')).toBeInViewport();

    await swipe(page, 160);
    await expect(sheet).toHaveAttribute('data-size', 'half');

    await swipe(page, 160);
    await expect(sheet).toBeHidden();
  });

  test('the handle also works from the keyboard', async ({ page }) => {
    await openLive(page);
    const sheet = await openSheet(page, 'parsley_01');
    const handle = sheet.getByRole('button', { name: 'Mostrar más detalles' });
    await handle.focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toHaveAttribute('data-size', 'full');
    await expect(sheet.getByRole('button', { name: 'Mostrar menos' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
