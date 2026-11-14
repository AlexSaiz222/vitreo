import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { openLive, setSoil } from './helpers.ts';

// The theme is decided in index.html, before any app code runs: with the app
// bundle blocked, a night visit must already paint the night background.
test('applies the night theme before the app loads', async ({ page }) => {
  await page.route('**/src/main.tsx', (route) => route.abort());
  await page.goto('/?theme=night');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  const background = await page.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor,
  );
  expect(background).toBe('rgb(22, 26, 34)');
});

test('follows the sun when no theme is forced', async ({ page }) => {
  await page.route('**/src/main.tsx', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(day|night)$/);
});

// CLAUDE.md budget: < 100 draw calls and < 150 k triangles per frame, counting
// everything: scene, shadow maps and post-processing passes.
test('stays within the draw call and triangle budget', async ({ page }) => {
  await openLive(page, '?theme=day');
  const html = page.locator('html');
  const calls = Number(await html.getAttribute('data-draw-calls'));
  const triangles = Number(await html.getAttribute('data-triangles'));
  test.info().annotations.push({
    type: 'frame',
    description: `${calls} draw calls, ${triangles} triangles`,
  });
  expect(calls).toBeGreaterThan(10);
  expect(calls).toBeLessThan(100);
  expect(triangles).toBeLessThan(150_000);
});

// WCAG 2.2 AA on the real HUD (D72), by day and by night, with the plant
// sheet and a menu open and a thirsty plant: contrast, names, roles, states.
for (const theme of ['day', 'night'] as const) {
  test(`the HUD passes an accessibility check (${theme})`, async ({ page, request }) => {
    // Always with a warning showing: a thirsty plant uses the warm tone.
    await setSoil(request, 'basil_01', 0.2);
    await openLive(page, `?theme=${theme}`);
    await page.getByRole('button', { name: 'Regar', exact: true }).click();
    await page.locator('.menu-row[data-zone="basil_01"]').click();
    await page.getByRole('button', { name: 'Aire', exact: true }).click();
    await page.waitForTimeout(500);
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
}
