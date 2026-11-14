import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { CONTROL, openLive, resetSimulator, setSoil } from './helpers.ts';

/**
 * Progress captures for referencias/progreso/ (docs/09: "Siempre"). Run with
 * `pnpm capture`. CAPTURE_DIR overrides the destination and CAPTURE_TAG the
 * name tag (so a new pass does not overwrite earlier ones).
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
/** Local date, YYYY-MM-DD (the Canadian English format happens to be ISO). */
const DATE = new Date().toLocaleDateString('en-CA');
const TAG = process.env['CAPTURE_TAG'] ?? 'fase1';
const file = (name: string) => path.join(OUT, `${DATE}-${TAG}-${name}.png`);

/** Soil colour and camera moves ease over a couple of seconds. */
const SETTLE_MS = 3_500;

/**
 * Sets the grow light through the dock, as a person would. The light
 * automation (A6, off unless turned on) could switch it, so captures that
 * depend on it say how they want it.
 */
async function growLightTo(page: Page, request: APIRequestContext, on: boolean) {
  const state = (await (await request.get(`${CONTROL}/state`)).json()) as {
    actuators: { growLight: boolean };
  };
  const light = page.getByRole('button', { name: /^Luz/ });
  if (state.actuators.growLight !== on) await light.click();
  await expect(light).toHaveAccessibleName(on ? /Encendida/ : /Apagada/);
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
});

for (const [theme, name] of [
  ['day', 'dia'],
  ['night', 'noche'],
] as const) {
  test(`orthographic camera, ${theme}`, async ({ page, request }) => {
    await openLive(page, `?theme=${theme}`);
    await growLightTo(page, request, false);
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: file(name) });
  });
}

test('dry pot next to a wet one', async ({ page, request }) => {
  await setSoil(request, 'basil_01', 0.08);
  await setSoil(request, 'parsley_01', 0.92);
  await openLive(page, '?theme=day');
  await growLightTo(page, request, false);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file('maceta-seca-y-humeda') });
  // Zoomed in, as a user would, to compare the soil colours.
  await openLive(page, '?theme=day&zoom=2.2');
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file('maceta-seca-y-humeda-detalle') });
});

test('asleep when disconnected', async ({ page, request }) => {
  await openLive(page, '?theme=day');
  await request.post(`${CONTROL}/scenario`, { data: { scenario: 'disconnect', active: true } });
  await expect(page.locator('.app-scene')).toHaveAttribute('data-freshness', 'disconnected');
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file('dormido') });
  await request.post(`${CONTROL}/scenario`, { data: { scenario: 'disconnect', active: false } });
});

test('plant detail sheet', async ({ page, request }) => {
  await setSoil(request, 'basil_01', 0.3);
  await openLive(page, '?theme=day');
  await page.getByRole('button', { name: 'Regar', exact: true }).click();
  await page.locator('.menu-row[data-zone="basil_01"]').click();
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file('hoja-detalle') });
});

test('plant detail sheet on a phone', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setSoil(request, 'parsley_01', 0.7);
  await openLive(page, '?theme=day');
  await page.getByRole('button', { name: 'Regar', exact: true }).click();
  await page.locator('.menu-row[data-zone="parsley_01"]').click();
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file('movil-hoja-detalle') });
  await page.getByRole('button', { name: 'Mostrar más detalles' }).click();
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file('movil-hoja-detalle-ampliada') });
});

/** The newest Blender render in referencias/progreso (…-blender-invernadero-vN.png). */
function latestBlenderRender(): { name: string; data: Buffer } | null {
  const dir = path.resolve(import.meta.dirname, '../../../referencias/progreso');
  const version = (name: string) =>
    Number(/-blender-invernadero-v(\d+)\.png$/.exec(name)?.[1] ?? -1);
  const newest = readdirSync(dir)
    .filter((name) => version(name) >= 0)
    .sort((a, b) => version(b) - version(a))[0];
  return newest ? { name: newest, data: readFileSync(path.join(dir, newest)) } : null;
}

test('next to ref-03 and the Blender render', async ({ page, browser, request }) => {
  await openLive(page, '?theme=day&zoom=1.2');
  // The Blender preview renders with the grow light on.
  await growLightTo(page, request, true);
  // Only the scene: the comparison is about the look, not the interface.
  await page.addStyleTag({ content: '.status, .dock { visibility: hidden; }' });
  await page.waitForTimeout(SETTLE_MS);
  const scene = await page.screenshot({ clip: { x: 190, y: 110, width: 900, height: 600 } });

  const reference = readFileSync(
    path.resolve(import.meta.dirname, '../../../referencias/ref-03-objetivo.png'),
  );
  const render = latestBlenderRender();
  const figure = (data: Buffer, caption: string) => `
    <figure><img src="data:image/png;base64,${data.toString('base64')}" />
      <figcaption>${caption}</figcaption></figure>`;
  const figures = [
    figure(reference, 'ref-03 (objetivo)'),
    ...(render ? [figure(render.data, `Render de Blender (${render.name.slice(0, 10)})`)] : []),
    figure(scene, `Vitreo, la app, con la lámpara encendida como el render (${DATE})`),
  ];
  const sheet = await browser.newPage({ viewport: { width: 900 * figures.length, height: 660 } });
  await sheet.setContent(`
    <style>
      body { margin: 0; display: flex; gap: 0; background: #faf9f6; font: 14px sans-serif; }
      figure { margin: 0; width: 900px; }
      img { width: 900px; height: 600px; object-fit: contain; display: block; }
      figcaption { text-align: center; padding: 16px; color: #5e655f; }
    </style>
    ${figures.join('')}`);
  await sheet.screenshot({ path: file('comparacion-ref-03-blender') });
  await sheet.close();
});

test('roof vent closed and open', async ({ page, request }) => {
  // The vent follows actuators.vent (shape key "open" of vent_window).
  await openLive(page, '?theme=day&zoom=2');
  await growLightTo(page, request, false);
  const setVent = async (label: 'Cerrada' | 'Abierta') => {
    await page.getByRole('button', { name: 'Aire', exact: true }).click();
    const button = page.getByRole('radio', { name: label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
  };
  const shoot = async (name: string) => {
    await page.addStyleTag({ content: '.status, .dock { visibility: hidden; }' });
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: file(name), clip: { x: 240, y: 60, width: 800, height: 560 } });
    await page.addStyleTag({ content: '.status, .dock { visibility: visible; }' });
  };
  await setVent('Abierta');
  await shoot('ventana-abierta');
  await setVent('Cerrada');
  await shoot('ventana-cerrada');
});

test('devices on: grow light and fan', async ({ page, request }) => {
  // The grow light strip glows with actuators.growLight; the fan turns.
  await openLive(page, '?theme=day&zoom=1.6');
  const light = page.getByRole('button', { name: /^Luz/ });
  const growLight = async () =>
    (
      (await (await request.get(`${CONTROL}/state`)).json()) as {
        actuators: { growLight: boolean };
      }
    ).actuators.growLight;
  if (!(await growLight())) {
    await light.click();
    await expect(light).toHaveAccessibleName(/Encendida/);
  }
  await page.getByRole('button', { name: 'Aire', exact: true }).click();
  const fan = page.getByRole('button', { name: /^Encender/ });
  if (await fan.isVisible()) await fan.click();
  await page.keyboard.press('Escape');
  await page.addStyleTag({ content: '.status, .dock { visibility: hidden; }' });
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file('dispositivos-encendidos') });
  // Leave them off for the other captures.
  await page.addStyleTag({ content: '.status, .dock { visibility: visible; }' });
  await light.click();
  await expect(light).toHaveAccessibleName(/Apagada/);
  await page.getByRole('button', { name: 'Aire', exact: true }).click();
  await page.getByRole('button', { name: 'Apagar', exact: true }).click();
});

test('night with the grow light on', async ({ page, request }) => {
  // The baked lamp light (lightmap_lamp) adds when growLight is on.
  await openLive(page, '?theme=night');
  const light = page.getByRole('button', { name: /^Luz/ });
  const growLight = async () =>
    (
      (await (await request.get(`${CONTROL}/state`)).json()) as {
        actuators: { growLight: boolean };
      }
    ).actuators.growLight;
  if (!(await growLight())) await light.click();
  await expect(light).toHaveAccessibleName(/Encendida/);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file('noche-lampara') });
  await light.click();
  await expect(light).toHaveAccessibleName(/Apagada/);
});

test('from the back', async ({ page, request }) => {
  // The glass must read from behind too, not like an empty cage.
  await openLive(page, '?theme=day&azimuth=221');
  await growLightTo(page, request, false);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file('trasera') });
});

test('plant detail sheet at night', async ({ page }) => {
  // The chosen plant gets a little warm light; the others fade back (D68).
  await openLive(page, '?theme=night');
  await page.getByRole('button', { name: 'Regar', exact: true }).click();
  await page.locator('.menu-row[data-zone="tomato_01"]').click();
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file('hoja-detalle-noche') });
});

test('roof vent open at night', async ({ page, request }) => {
  // Parts that are not baked (vent, door, fan) are lit by light probes (D68).
  await openLive(page, '?theme=night&zoom=1.6');
  await growLightTo(page, request, false);
  await page.getByRole('button', { name: 'Aire', exact: true }).click();
  const open = page.getByRole('radio', { name: 'Abierta', exact: true });
  await open.click();
  await expect(open).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.addStyleTag({ content: '.status, .dock, .hud-top { visibility: hidden; }' });
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file('noche-ventana-abierta') });
  await page.addStyleTag({ content: '.status, .dock, .hud-top { visibility: visible; }' });
  await page.getByRole('button', { name: 'Aire', exact: true }).click();
  await page.getByRole('radio', { name: 'Cerrada', exact: true }).click();
});

test('tank close-up: the water gauge follows the level', async ({ page, request }) => {
  // tank_water scales with tank.level inside the gauge window (0 %, 50 %, 100 %).
  test.setTimeout(120_000);
  const shoot = async (name: string, theme: 'day' | 'night', level: number) => {
    await request.post(`${CONTROL}/tank`, { data: { level } });
    await openLive(page, `?theme=${theme}&look=tank&zoom=3.5`);
    await growLightTo(page, request, false);
    await page.addStyleTag({ content: '.status, .dock, .hud-top { visibility: hidden; }' });
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: file(name), clip: { x: 340, y: 100, width: 600, height: 600 } });
  };
  await shoot('deposito-dia-0', 'day', 0);
  await shoot('deposito-dia-50', 'day', 0.5);
  await shoot('deposito-dia-100', 'day', 1);
  await shoot('deposito-noche', 'night', 0.8);
});
