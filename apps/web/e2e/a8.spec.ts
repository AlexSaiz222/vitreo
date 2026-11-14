import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { HUB, openLive, resetHub, resetSimulator, seedHistory } from './helpers.ts';

/** A8 (D93): the plant's journal. Notes and photos, without location, and the plant's story. */

const HUB_API = /\/api\/v1\//;
/** 2400 × 1800, with an EXIF block carrying a (fake) GPS position. */
const PHOTO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/leaf-with-gps.jpg');

interface Entry {
  id: string;
  kind: string;
  text: string | null;
  photo: { width: number; height: number; bytes: number } | null;
}

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
  await resetHub(request);
});

declare global {
  interface Window {
    __sentPhotos?: number[][];
  }
}

/** Records the bytes of every photo the page sends to the hub. */
async function recordPhotos(page: Page) {
  await page.addInitScript(() => {
    const send = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (init?.method === 'PUT' && init.body instanceof Blob) {
        const bytes = Array.from(new Uint8Array(await init.body.arrayBuffer()));
        (window.__sentPhotos ??= []).push(bytes);
      }
      return send(input, init);
    };
  });
}

async function openBasil(page: Page) {
  await page.locator('.plant-target[data-zone="basil_01"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Albahaca' })).toBeVisible();
  await expect(page.locator('.journal')).toBeAttached();
  await page.locator('.journal').scrollIntoViewIfNeeded();
}

async function expectAccessible(page: Page) {
  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
}

const entries = async (page: Page) =>
  ((await (await page.request.get(`${HUB}/journal/basil_01`)).json()) as { entries: Entry[] })
    .entries;

test('a note and a photo: in the journal, on the chart, and no location leaves the phone', async ({
  page,
  request,
}) => {
  await seedHistory(request);
  await recordPhotos(page);
  await openLive(page);
  await openBasil(page);
  const journal = page.locator('.journal');
  // No notes yet: an invitation, above what the greenhouse did.
  await expect(journal.locator('.journal-invite')).toHaveText(
    'Aún no hay notas. Cuéntale algo a tu albahaca.',
  );

  await page.getByRole('textbox', { name: 'Nota' }).fill('Primeras hojas nuevas arriba');
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(journal.locator('.journal-note')).toHaveText('Primeras hojas nuevas arriba');
  await expect(journal).not.toContainText('Se guardará');
  await expect(journal.locator('.journal-invite')).toHaveCount(0);

  // A photo from the gallery (the camera is the same, with capture).
  await journal.locator('input[type="file"]:not([capture])').setInputFiles(PHOTO);
  await expect(page.getByAltText('La foto que vas a guardar')).toBeVisible();
  await page.getByLabel('Pie de foto (opcional)').fill('Una hoja amarilla abajo');
  await page.getByRole('button', { name: 'Guardar foto' }).click();
  // What left the phone (recorded by the fetch wrapper below): a JPEG,
  // without EXIF and without the position.
  await expect.poll(() => page.evaluate(() => window.__sentPhotos?.length ?? 0)).toBe(1);
  const sent = Buffer.from(await page.evaluate(() => window.__sentPhotos?.[0] ?? []));
  expect(sent.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(sent.includes('Exif')).toBe(false);
  expect(sent.includes('GPSLatitude')).toBe(false);
  await expect(journal.getByAltText('Una hoja amarilla abajo')).toBeVisible();

  // Resized to 1600 px on its long edge, about 300 KB, and stored clean.
  const photo = (await entries(page)).find((entry) => entry.kind === 'photo');
  expect(photo?.photo).toMatchObject({ width: 1600, height: 1200 });
  expect(photo?.photo?.bytes ?? Infinity).toBeLessThan(330_000);
  const stored = await (await page.request.get(`${HUB}/journal/${photo?.id ?? ''}/photo`)).body();
  expect(stored.includes('GPSLatitude')).toBe(false);

  // Both are small marks on the history chart, and the readout names them.
  const chart = page.locator('.history-chart');
  await expect(chart.locator('.history-note')).toHaveCount(2);
  await expect(chart.locator('.history-note[data-kind="photo"]')).toHaveCount(1);
  await expect(chart.locator('.history-legend')).toContainText('Nota o foto');
  await expectAccessible(page);

  // Ajustes says what the hub keeps.
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.locator('.plant-fact', { hasText: 'Almacenamiento' })).toContainText(
    /fotos \d+(,\d)?\sKB \(1\)/,
  );
  await expect(page.locator('.plant-fact', { hasText: 'Fotos, último mes' })).toBeVisible();
});

test("the journal tells the plant's story: waterings, a warning, a rule change", async ({
  page,
  request,
}) => {
  await seedHistory(request);
  // A warning this morning, already resolved (thirst takes hours to count).
  await request.post(`${HUB}/test/incidents`, {
    data: {
      zone: 'basil_01',
      title: 'La albahaca tiene sed',
      openedAt: Date.now() - 50 * 60_000,
      resolvedAt: Date.now() - 20 * 60_000,
    },
  });
  // Its automatic watering switched on at 35 %.
  const { config } = (await (await request.get(`${HUB}/config`)).json()) as {
    config: { watering: { zone: string }[]; light: unknown; ventilation: unknown };
  };
  await request.put(`${HUB}/config`, {
    data: {
      watering: config.watering.map((rule) =>
        rule.zone === 'basil_01' ? { ...rule, enabled: true, threshold: 0.35 } : rule,
      ),
      light: config.light,
      ventilation: config.ventilation,
    },
  });

  await openLive(page);
  await openBasil(page);
  const journal = page.locator('.journal');
  await expect(journal.locator('.journal-day-label').first()).toHaveText('Hoy');
  await expect(journal.locator('[data-kind="rule"]')).toContainText(
    /Riego automático activado · por debajo del 35\s%/,
  );
  await expect(journal.locator('[data-kind="alert"]')).toContainText(
    /Aviso: La albahaca tiene sed · resuelto a las \d\d:\d\d/,
  );
  await expect(journal.getByText(/Riego automático · tierra \d+\s% < 35\s%/).first()).toBeVisible();
  await expect(journal.getByText(/Riego de 5\ss · tú/).first()).toBeVisible();
  await expectAccessible(page);
});

test('hub down: the journal from the phone, and a new note waits calmly', async ({
  page,
  request,
}) => {
  await request.post(`${HUB}/journal/notes`, {
    data: {
      id: crypto.randomUUID(),
      zone: 'basil_01',
      text: 'Escrita con el hub en marcha',
      createdAt: Date.now() - 3_600_000,
    },
  });
  await openLive(page);
  await openBasil(page);
  const journal = page.locator('.journal');
  await expect(journal).toContainText('Escrita con el hub en marcha');

  // The hub stops answering, and the app is opened again.
  await page.route(HUB_API, (route) => route.fulfill({ status: 502, body: '' }));
  await page.reload();
  await expect(page.locator('.status')).toHaveAttribute('data-freshness', 'live', {
    timeout: 15_000,
  });
  await openBasil(page);
  await expect(journal).toContainText('Escrita con el hub en marcha');
  await expect(journal).toContainText(/no responde desde .*: es el diario guardado en este móvil/);
  await expect(page.getByRole('button', { name: 'Borrar la nota' })).toBeDisabled();

  await page.getByRole('textbox', { name: 'Nota' }).fill('Regada a mano, sin hub');
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  const waiting = journal.locator('[data-pending="true"]');
  await expect(waiting).toContainText('Regada a mano, sin hub');
  await expect(waiting).toContainText('Se guardará cuando el hub responda');
  await expectAccessible(page);

  // Closing the app does not lose it.
  await page.reload();
  await expect(page.locator('.status')).toHaveAttribute('data-freshness', 'live', {
    timeout: 15_000,
  });
  await openBasil(page);
  await expect(waiting).toContainText('Se guardará cuando el hub responda');

  // The hub answers again: it is sent, once.
  await page.unroute(HUB_API);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
  });
  await expect(journal.locator('[data-pending="true"]')).toHaveCount(0);
  await expect(journal).toContainText('Regada a mano, sin hub');
  expect((await entries(page)).map((entry) => entry.text).sort()).toEqual([
    'Escrita con el hub en marcha',
    'Regada a mano, sin hub',
  ]);
});

test('deleting a note offers Deshacer (the D85 exception)', async ({ page }) => {
  await openLive(page);
  await openBasil(page);
  await page.getByRole('textbox', { name: 'Nota' }).fill('Nota que sobra');
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  const note = page.locator('.journal-note', { hasText: 'Nota que sobra' });
  await expect(note).toBeVisible();
  await expect.poll(async () => (await entries(page)).length).toBe(1);

  await page.getByRole('button', { name: 'Borrar la nota' }).click();
  await expect(note).toHaveCount(0);
  const toast = page.locator('.ui-toast', { hasText: 'Nota borrada' });
  await expect(toast).toBeVisible();
  await expect.poll(async () => (await entries(page)).length).toBe(0);
  await toast.getByRole('button', { name: 'Deshacer' }).click();
  await expect(note).toBeVisible();
  expect(await entries(page)).toHaveLength(1);

  // Deleted again and left: it stays deleted.
  await page.getByRole('button', { name: 'Borrar la nota' }).click();
  await expect(note).toHaveCount(0);
  await page.waitForTimeout(5_500);
  await expect(toast).toHaveCount(0);
  expect(await entries(page)).toHaveLength(0);
});

/**
 * A8 captures (docs/09): the journal empty, with notes and photos, the
 * plant's story with its events, the marks on the chart, and the hub down
 * with a note waiting. Phone, day and night, on the test stack.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const shot = (name: string) => path.join(OUT, `${DATE}-faseA-8-${name}.png`);
const PHONE = {
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

/** On a phone the sheet opens at half height: open it fully, as a person would. */
async function openBasilFully(page: Page) {
  await openBasil(page);
  const more = page.getByRole('button', { name: 'Mostrar más detalles' });
  if (await more.isVisible()) await more.click();
}

/** Scrolls the sheet so `selector` starts at the top, then shoots. */
async function shootAt(page: Page, selector: string, name: string) {
  const scroll = () =>
    page
      .locator(selector)
      .first()
      .evaluate((element: HTMLElement) => {
        element.scrollIntoView({ block: 'start' });
      });
  // Again once the sheet has settled (its opening resets the scroll).
  await scroll();
  await page.waitForTimeout(900);
  await scroll();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot(name) });
}

/** A few days of a plant's life: notes, a photo, a warning and a rule change. */
async function writeStory(request: APIRequestContext) {
  const ago = (hours: number) => Date.now() - hours * 3_600_000;
  for (const [hours, text] of [
    [52, 'Trasplantada a la maceta grande. Tierra nueva con un poco de compost.'],
    [27, 'Primeras hojas nuevas arriba, muy verdes.'],
    [2, 'Huele muchísimo al tocarla. La primera cosecha, pronto.'],
  ] as const) {
    await request.post(`${HUB}/journal/notes`, {
      data: { id: crypto.randomUUID(), zone: 'basil_01', text, createdAt: ago(hours) },
    });
  }
  await request.put(
    `${HUB}/journal/${crypto.randomUUID()}/photo?zone=basil_01&createdAt=${ago(5).toString()}&width=2400&height=1800&caption=${encodeURIComponent('Una hoja amarilla abajo; la quito.')}`,
    { headers: { 'content-type': 'image/jpeg' }, data: readFileSync(PHOTO) },
  );
  await request.post(`${HUB}/test/incidents`, {
    data: {
      zone: 'basil_01',
      title: 'La albahaca tiene sed',
      openedAt: ago(30),
      resolvedAt: ago(28.5),
    },
  });
  const { config } = (await (await request.get(`${HUB}/config`)).json()) as {
    config: { watering: { zone: string }[]; light: unknown; ventilation: unknown };
  };
  await request.put(`${HUB}/config`, {
    data: {
      watering: config.watering.map((rule) =>
        rule.zone === 'basil_01' ? { ...rule, enabled: true, threshold: 0.35 } : rule,
      ),
      light: config.light,
      ventilation: config.ventilation,
    },
  });
}

// Tagged @capture: the fast suite (pnpm e2e) leaves them out.
test.describe('captures @capture', () => {
  test.use(PHONE);
  // Five screenshots and a seeded week each.
  test.describe.configure({ timeout: 240_000 });

  for (const [theme, name] of [
    ['day', 'dia'],
    ['night', 'noche'],
  ] as const) {
    test(`journal, ${theme}`, async ({ page, request }) => {
      const at = (state: string) => `${state}-${name}-movil`;
      // Empty: no notes and nothing happened yet.
      await openLive(page, `?theme=${theme}`);
      await openBasilFully(page);
      await shootAt(page, '.plant-section:has(.journal)', at('diario-vacio'));

      // A week of history, and the plant's story on top.
      await seedHistory(request);
      await writeStory(request);
      await openLive(page, `?theme=${theme}`);
      await openBasilFully(page);
      await expect(page.locator('.journal-photo img')).toBeVisible();
      await shootAt(page, '.plant-section:has(.journal)', at('diario-notas-fotos'));
      await shootAt(page, '.journal-day:nth-child(2)', at('diario-historia'));
      await expect(page.locator('.history-note')).not.toHaveCount(0);
      await shootAt(page, '.plant-section:has(.history)', at('historial-marcas'));

      // The hub stops answering: the phone's copy, and a note that waits.
      await page.route(HUB_API, (route) => route.fulfill({ status: 502, body: '' }));
      await page.reload();
      await expect(page.locator('.status')).toHaveAttribute('data-freshness', 'live', {
        timeout: 15_000,
      });
      await openBasilFully(page);
      await page.getByRole('textbox', { name: 'Nota' }).fill('Regada a mano: el hub no responde.');
      await page.getByRole('button', { name: 'Guardar nota' }).click();
      await expect(page.locator('[data-pending="true"]')).toContainText(
        'Se guardará cuando el hub responda',
      );
      // A photo this phone has not kept: a calm placeholder, not a broken image.
      await expect(page.getByText('La foto se verá cuando el hub responda.')).toBeVisible();
      await shootAt(page, '.plant-section:has(.journal)', at('diario-sin-hub'));
    });
  }
});

test.describe('on a phone', () => {
  test.use(PHONE);

  test('a tap on the sheet handle opens it fully, and another closes it to half', async ({
    page,
  }) => {
    await openLive(page);
    await page.locator('.plant-target[data-zone="basil_01"]').focus();
    await page.keyboard.press('Enter');
    const handle = page.locator('.ui-sheet-handle');
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    await handle.tap();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    await handle.tap();
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    // The keyboard too.
    await handle.press('Enter');
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
  });
});

test('an event of a type the app does not know shows as a neutral line, and nothing else (D108)', async ({
  page,
  request,
}) => {
  const ts = Math.floor(Date.now() / 1000) - 600;
  const seeded = await request.post(`${HUB}/test/messages`, {
    data: {
      messages: [
        {
          channel: 'event',
          message: {
            v: 1,
            ts,
            type: 'filter.clogged',
            source: 'safety',
            zone: 'basil_01',
            bar: 1.4,
          },
        },
      ],
    },
  });
  expect(seeded.ok()).toBe(true);
  await openLive(page);
  await openBasil(page);
  const line = page.locator('.journal-item[data-kind="device"]');
  await expect(line).toContainText('Evento del invernadero: filter.clogged');
  // Not a warning: nothing warm, nothing to act on.
  await expect(page.locator('[data-kind="alert"]')).toHaveCount(0);
});
