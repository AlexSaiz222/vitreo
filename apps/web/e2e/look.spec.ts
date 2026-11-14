import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { CONTROL, openLive, resetSimulator } from './helpers.ts';

/**
 * Captures of how the diorama looks (D134): the whole scene and close-ups,
 * day and night, desktop and phone, and zoomed in with the plant names.
 * Run with `pnpm exec playwright test look.spec.ts`; LOOK_TAG names the pass
 * ("antes", "despues"), so both stay side by side.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const TAG = process.env['LOOK_TAG'] ?? 'despues';
const file = (name: string) => path.join(OUT, `${DATE}-aspecto-${TAG}-${name}.png`);
const THEMES = [
  ['day', 'dia'],
  ['night', 'noche'],
] as const;
const PHONE = { width: 412, height: 915 };
const DESKTOP = { width: 1440, height: 900 };

async function lightOff(page: Page, request: APIRequestContext) {
  const state = (await (await request.get(`${CONTROL}/state`)).json()) as {
    actuators: { growLight: boolean };
  };
  const light = page.getByRole('button', { name: /^Luz/ });
  if (state.actuators.growLight) await light.click();
  await expect(light).toHaveAccessibleName(/Apagada/);
}

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: file(name) });
}

test.use({ deviceScaleFactor: 2 });

for (const [theme, name] of THEMES) {
  test(`the diorama, ${theme} @capture`, async ({ page, request }) => {
    test.setTimeout(120_000);
    await resetSimulator(request);

    await page.setViewportSize(DESKTOP);
    await openLive(page, `?theme=${theme}`);
    await lightOff(page, request);
    await shoot(page, `${name}-escritorio`);

    // Zoomed in, as a person would: the names appear and the dock must not cover the pots.
    await openLive(page, `?theme=${theme}&zoom=2`);
    await shoot(page, `${name}-escritorio-zoom`);

    await openLive(page, `?theme=${theme}&zoom=3.2`);
    await page.addStyleTag({ content: '.plant-anchors { visibility: hidden; }' });
    await shoot(page, `${name}-escritorio-cerca`);

    await page.setViewportSize(PHONE);
    await openLive(page, `?theme=${theme}`);
    await shoot(page, `${name}-movil`);

    await openLive(page, `?theme=${theme}&zoom=2`);
    await shoot(page, `${name}-movil-zoom`);
  });
}
