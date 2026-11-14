import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { HUB, openLive, resetSimulator, seedHistory } from './helpers.ts';

/**
 * A12, the rest of the close (D100): journal tags ("Regada a mano" alone is
 * a note), the greenhouse's own journal, a plant's age and a new plant in
 * its pot, and "Automatizaciones activas" in Ajustes. Phone and desktop,
 * day and night.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-faseA-12-${name}.png`);
const THEMES = [
  ['day', 'dia'],
  ['night', 'noche'],
] as const;
const DEVICES = [
  ['escritorio', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  [
    'movil',
    { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ],
] as const;

const sheet = (page: Page) => page.locator('.ui-sheet');

async function openBasil(page: Page) {
  await page.locator('.plant-target[data-zone="basil_01"]').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Albahaca', exact: true }).waitFor();
  const more = page.getByRole('button', { name: 'Mostrar más detalles' });
  if (await more.isVisible()) await more.click();
}

/** Scrolls the sheet so `selector` starts at the top. */
async function scrollTo(page: Page, selector: string) {
  const go = () =>
    sheet(page)
      .locator(selector)
      .first()
      .evaluate((element: HTMLElement) => {
        element.scrollIntoView({ block: 'start' });
      });
  await go();
  await page.waitForTimeout(700);
  await go();
  await page.waitForTimeout(300);
}

/** The basil waters itself, and the window and fan follow the heat. */
async function someAutomations(request: APIRequestContext) {
  const current = (await (await request.get(`${HUB}/config`)).json()) as {
    config: {
      watering: { zone: string; enabled: boolean }[];
      light: unknown;
      ventilation: unknown;
    };
  };
  const { watering, light, ventilation } = current.config;
  const response = await request.put(`${HUB}/config`, {
    data: {
      watering: watering.map((rule) =>
        rule.zone === 'basil_01' ? { ...rule, enabled: true } : rule,
      ),
      light,
      ventilation: { ...(ventilation as object), enabled: true },
    },
  });
  expect(response.ok()).toBe(true);
}

test.describe('the journal and the plant', () => {
  test.beforeEach(async ({ request }) => {
    await resetSimulator(request);
    await seedHistory(request);
  });

  test('"Regada a mano" alone is a note, and the chart says it', async ({ page }) => {
    await openLive(page);
    await openBasil(page);
    const journal = sheet(page).locator('.journal');
    await journal.getByRole('button', { name: 'Regada a mano' }).click();
    await expect(journal.getByRole('button', { name: 'Regada a mano' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await journal.getByRole('button', { name: 'Guardar nota' }).click();
    await expect(journal.locator('.journal-item .journal-tags').first()).toHaveText(
      'Regada a mano',
    );
    await expect(journal.getByRole('button', { name: 'Regada a mano' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('the greenhouse keeps its own notes, with its own tags', async ({ page, request }) => {
    await openLive(page, '?open=greenhouse');
    const journal = page.locator('.greenhouse-sheet .journal');
    await journal.scrollIntoViewIfNeeded();
    await journal.getByRole('button', { name: 'Depósito rellenado' }).click();
    await journal.getByLabel('Nota').fill('Agua del grifo reposada un día.');
    await journal.getByRole('button', { name: 'Guardar nota' }).click();
    await expect(journal.locator('.journal-item').first()).toContainText('Depósito rellenado');
    // The note shows at once and goes to the hub right after (it is kept
    // on the phone first): wait for the hub, not for the screen.
    await expect
      .poll(async () => {
        const saved = (await (await request.get(`${HUB}/journal/greenhouse`)).json()) as {
          entries: { tags: string[]; text: string }[];
        };
        return saved.entries[0];
      })
      .toMatchObject({ tags: ['refilled'], text: 'Agua del grifo reposada un día.' });
  });

  test('a new plant in the pot starts a chapter, and the journal says where', async ({
    page,
    request,
  }) => {
    await request.patch(`${HUB}/plants/basil_01`, { data: { name: 'Pepa', sownAt: '2026-08-20' } });
    await openLive(page);
    await page.locator('.plant-target[data-zone="basil_01"]').focus();
    await page.keyboard.press('Enter');
    await expect(sheet(page).getByRole('heading', { name: 'Pepa', exact: true })).toBeVisible();
    await expect(sheet(page).locator('.plant-reading .plant-hint').last()).toHaveText(
      /^Sembrada hace \d+ (días|meses)\.$/,
    );
    const identity = sheet(page).locator('.plant-identity');
    await identity.scrollIntoViewIfNeeded();
    await identity.getByRole('button', { name: 'Planta nueva en esta maceta' }).click();
    await identity.getByLabel('Nombre de la nueva').fill('Bruna');
    await identity.getByRole('button', { name: 'Empezar con la planta nueva' }).click();
    await expect(sheet(page).getByRole('heading', { name: 'Bruna', exact: true })).toBeVisible();
    await expect(identity.locator('.plant-age')).toContainText('En esta maceta desde el');
    await expect(sheet(page).locator('.journal')).toContainText(
      'Planta nueva en la maceta. Antes estaba Pepa, sembrada el 20 de agosto.',
    );
    const chapters = (await (await request.get(`${HUB}/plants/basil_01/chapters`)).json()) as {
      name: string;
    }[];
    expect(chapters.map((c) => c.name)).toEqual(['Pepa']);
  });

  test('Ajustes lists what runs on its own, and each row leads there', async ({
    page,
    request,
  }) => {
    await someAutomations(request);
    await openLive(page);
    await page.getByRole('button', { name: 'Ajustes' }).click();
    const list = sheet(page).locator('section:has(#settings-active)');
    await list.scrollIntoViewIfNeeded();
    await expect(list.getByRole('button', { name: /Riego de la albahaca/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /Ventilación/ })).toBeVisible();
    await list.getByRole('button', { name: /Riego de la albahaca/ }).click();
    await expect(page.getByRole('heading', { name: 'Albahaca', exact: true })).toBeVisible();
  });
});

// Tagged @capture: the fast suite (pnpm e2e) leaves them out.
test.describe('captures @capture', () => {
  test.beforeEach(async ({ request }) => {
    await resetSimulator(request);
    await seedHistory(request);
    await someAutomations(request);
    await request.patch(`${HUB}/plants/basil_01`, { data: { name: null, sownAt: '2026-09-22' } });
    const at = Date.now();
    for (const [i, note] of [
      { zone: 'basil_01', text: '', tags: ['watered'] },
      {
        zone: 'basil_01',
        text: 'Dos hojas con manchas, las quito.',
        tags: ['yellow_leaf', 'pruned'],
      },
      { zone: 'greenhouse', text: 'Rellené el depósito.', tags: ['refilled'] },
      { zone: 'greenhouse', text: 'El tubo de la albahaca goteaba en la unión.', tags: ['leak'] },
    ].entries()) {
      await request.post(`${HUB}/journal/notes`, {
        data: { id: crypto.randomUUID(), ...note, createdAt: at - (i + 1) * 3_600_000 },
      });
    }
  });

  for (const [device, use] of DEVICES) {
    test.describe(device, () => {
      test.use(use);
      for (const [theme, name] of THEMES) {
        test(`journal, plant and automations, ${theme}`, async ({ page }) => {
          const at = (shot: string) => file(`${shot}-${name}-${device}`);
          await openLive(page, `?theme=${theme}`);
          await openBasil(page);
          await scrollTo(page, '.plant-identity');
          await page.screenshot({ path: at('planta') });
          await scrollTo(page, '.plant-section:has(.journal)');
          await page.screenshot({ path: at('diario-etiquetas') });
          await page.keyboard.press('Escape');

          await page.getByRole('button', { name: /Ver el invernadero/ }).click();
          await expect(page.locator('.greenhouse-sheet .climate-chart').first()).toBeVisible({
            timeout: 15_000,
          });
          await scrollTo(page, 'section:has(#greenhouse-journal)');
          await page.screenshot({ path: at('diario-invernadero') });
          await page.keyboard.press('Escape');

          await page.getByRole('button', { name: 'Ajustes' }).click();
          await scrollTo(page, 'section:has(#settings-active)');
          await page.screenshot({ path: at('automatizaciones-activas') });
        });
      }
    });
  }
});
