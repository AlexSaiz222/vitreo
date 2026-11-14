import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { clearHistory, openLive, resetSimulator, seedHistory } from './helpers.ts';

/** A5: the plant's history chart, and rewinding the twin through the past. */

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

/** Moves the scrubber to an instant (Unix s), as a drag would. */
async function scrubTo(page: Page, seconds: number) {
  await page.locator('.timeline-input').evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
}

test("a plant's history: line, threshold band, gaps and who watered", async ({ page, request }) => {
  const seeded = await seedHistory(request);
  await openLive(page);
  await openBasil(page);
  const chart = page.locator('.history-chart');
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeVisible();
  // The gap (PC off) is drawn as a gap: the line breaks there.
  await expect(chart.locator('.history-gap')).not.toHaveCount(0);
  const path = await chart.locator('.history-line').first().getAttribute('d');
  expect(path?.match(/M/g)?.length ?? 0).toBeGreaterThan(1);
  // Waterings, marked by who started them.
  await expect(chart.locator('.history-mark[data-source="user"]')).not.toHaveCount(0);
  await expect(chart.locator('.history-mark[data-source="auto"]')).not.toHaveCount(0);
  expect(seeded.waterings.length).toBeGreaterThan(1);

  // A finger (or the keyboard) shows the exact value and time.
  const plot = chart.locator('.history-plot');
  await plot.focus();
  await page.keyboard.press('End');
  // The newest hour may not be summarised yet (just after the hour): one back.
  await page.keyboard.press('ArrowLeft');
  await expect(chart.locator('.history-readout')).toHaveText(/\d\d:\d\d · \d+\s%/);
  const box = await plot.boundingBox();
  if (box) await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(chart.locator('.history-readout')).toHaveText(/\d+ [a-z]+, \d\d:\d\d · /); // any month: the seeded week is relative to now

  // The CSV of the range shown.
  const csv = page.getByRole('link', { name: /Descargar CSV \(7 días\)/ });
  await expect(csv).toHaveAttribute('href', /\/api\/v1\/telemetry\.csv\?from=\d+&to=\d+/);
  await page.getByRole('radio', { name: '24 h' }).click();
  await expect(page.getByRole('link', { name: /Descargar CSV \(24 h\)/ })).toBeVisible();
  await expectAccessible(page);
});

test('with little history, the chart says so honestly', async ({ page, request }) => {
  await clearHistory(request);
  await openLive(page);
  await openBasil(page);
  await expect(page.locator('.history-empty')).toHaveText(/Aún (hay poco|no hay) historial/);
  await expect(page.locator('.history-chart')).toHaveCount(0);
});

test('rewind: the past is unmistakable, orders wait, and "Volver a ahora" returns', async ({
  page,
  request,
}) => {
  const { gap } = await seedHistory(request);
  await openLive(page);
  await page.getByRole('button', { name: 'Rebobinar' }).click();
  const timeline = page.getByRole('region', { name: 'Rebobinar' });
  await expect(timeline).toBeVisible();
  await expect(page.getByRole('button', { name: 'Volver a ahora' })).toBeFocused();
  // The dock (orders) is gone; the status line says it is the past.
  await expect(page.locator('.dock')).toHaveCount(0);
  await expect(page.locator('.status-past')).toHaveText(/Así estaba el/);
  await expect(page.locator('[data-replay="true"]')).toBeVisible();
  await expect(timeline.locator('.timeline-note')).not.toContainText('Cargando', {
    timeout: 15_000,
  });

  // Into the gap: no data, said in words, and the twin sleeps.
  await scrubTo(page, gap.start + 3600);
  await expect(page.locator('.status-past')).toHaveText(/Sin datos el/);
  await expect(page.locator('.app-scene')).toHaveAttribute('data-freshness', 'disconnected');
  await expect(timeline.locator('.timeline-note')).toHaveText(/Sin datos a esta hora/);

  // A day after: the basil as it was then.
  await scrubTo(page, gap.end + 2 * 3600);
  await expect(page.locator('.status-past')).toHaveText(/Así estaba el/);
  await expect(page.locator('.app-scene')).toHaveAttribute('data-freshness', 'live');
  await openBasil(page);
  const water = page.locator('.primary-button[data-zone="basil_01"]');
  await expect(water).toBeDisabled();
  await expect(water).toHaveAccessibleDescription(/Estás viendo el pasado/);
  await expect(page.locator('.plant-honesty')).toHaveText(/Así estaba el/);
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Volver a ahora' }).click();
  await expect(timeline).toBeHidden();
  await expect(page.locator('.dock')).toBeVisible();
  await expect(page.locator('.status-past')).toHaveCount(0);
});

test('from a point of the chart, see the whole greenhouse as it was', async ({ page, request }) => {
  await seedHistory(request);
  await openLive(page);
  await openBasil(page);
  const plot = page.locator('.history-plot');
  await plot.scrollIntoViewIfNeeded();
  await plot.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Ver el invernadero así' }).click();
  await expect(page.getByRole('region', { name: 'Rebobinar' })).toBeVisible();
  await expect(page.locator('.status-past')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Rebobinar' })).toBeHidden();
});
