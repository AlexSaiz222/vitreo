import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';

import { openLive } from './helpers.ts';

/**
 * The public demo, step 1 (D103, docs/09 "Demo pública"): the greenhouse
 * runs in a Web Worker in the visitor's browser, through the same contract
 * as MQTT. Live data, a watering with its ack, and not one request to the
 * hub, the broker or another site. Run with `pnpm e2e:demo`.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-demo-1-${name}.png`);
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

/** Every request the page makes, the worker's included. */
function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.context().on('request', (request) => requests.push(request));
  return requests;
}

/**
 * The demo's line folds to its label (D115, D124): on a desktop the pointer
 * goes to it first; on a phone, a tap.
 */
async function openDemoBar(page: Page) {
  const toggle = page.locator('.demo-label-toggle');
  await toggle.hover();
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

async function waterBasil(page: Page) {
  await page.getByRole('button', { name: 'Regar', exact: true }).click();
  await page.locator('.menu-row[data-zone="basil_01"]').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Albahaca' })).toBeVisible();
  await sheet.getByRole('radio', { name: '3 s' }).click();
  const water = sheet.locator('.primary-button');
  await water.click();
  return { sheet, water };
}

test('the greenhouse lives in the browser: readings arrive with nothing else running', async ({
  page,
}) => {
  await openLive(page);
  await expect(page.locator('.status')).toContainText('°');
  // The six pots of the demo's greenhouse, each with its soil reading.
  for (const plant of ['Albahaca', 'Perejil', 'Lechuga', 'Fresa', 'Cebollino', 'Tomate cherry']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${plant}: \\d+ %`) })).toHaveCount(
      1,
    );
  }
});

test('a watering goes to the worker and its ack comes back', async ({ page }) => {
  await openLive(page);
  // At an hour a minute (D112) its 3 s last a twentieth of a second in the
  // worker; on screen they last 3 s of the visitor's clock (D128), then
  // "Regada", then the ack and the watering recorded.
  const { sheet, water } = await waterBasil(page);
  const pressed = Date.now();
  await expect(water).toContainText('Regando');
  await page.waitForTimeout(1500);
  await expect(water).toContainText(/Regando · [12] s/);
  await expect(water).toHaveText('Regada', { timeout: 5_000 });
  expect(Date.now() - pressed).toBeGreaterThan(2500);
  await expect(water).toHaveText('Regar ahora', { timeout: 10_000 });
  await expect(sheet).toContainText(/Último riego\s*(hoy a las|\w+) \d\d:\d\d · 3 s/);
});

test('every visit arrives by day, whatever was chosen on an earlier one (D128)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('vitreo.theme', 'night');
  });
  await openLive(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
});

test('the round "Invernadero" button opens the greenhouse sheet (D128)', async ({ page }) => {
  await openLive(page);
  await page.getByRole('button', { name: 'Invernadero', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Invernadero', exact: true }),
  ).toBeVisible();
});

test('nothing leaves the page: no hub, no broker, no other site, no MQTT client', async ({
  page,
}) => {
  const requests = recordRequests(page);
  await openLive(page);
  await waterBasil(page);
  await page.waitForTimeout(3000);
  const origin = new URL(page.url()).origin;
  const urls = requests.map((request) => request.url());
  expect(urls.filter((url) => !url.startsWith(origin) && !url.startsWith('data:'))).toEqual([]);
  expect(urls.filter((url) => new URL(url).pathname.startsWith('/api'))).toEqual([]);
  // The client library (mqtt.js), not the contract in packages/shared/src/mqtt.
  expect(urls.filter((url) => /deps\/mqtt|\/node_modules\/mqtt\//.test(url))).toEqual([]);
  // The worker is the greenhouse.
  expect(urls.some((url) => url.includes('/src/demo/worker.ts'))).toBe(true);
});

// Tagged @capture: what step 1 looks like, phone and desktop, day and night.
test.describe('captures @capture', () => {
  for (const [device, use] of DEVICES) {
    test.describe(device, () => {
      test.use(use);
      for (const [theme, name] of THEMES) {
        test(`the demo's greenhouse, ${theme}`, async ({ page }) => {
          const at = (shot: string) => file(`${shot}-${name}-${device}`);
          await openLive(page, `?theme=${theme}`);
          await page.waitForTimeout(1500);
          await page.screenshot({ path: at('en-vivo') });
          await waterBasil(page);
          await page.waitForTimeout(600);
          await page.screenshot({ path: at('riego') });
        });
      }
    });
  }
});

/**
 * Step 2 (D103): the demo's hub is the hub's own code on sql.js, in the
 * same worker. The page asks it as it asks the hub at home, and it answers.
 */
async function openBasilSheet(page: Page) {
  await page.locator('.plant-target[data-zone="basil_01"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Albahaca' })).toBeVisible();
}

async function openGreenhouse(page: Page) {
  await page.getByRole('button', { name: /Ver el invernadero/ }).click();
  await expect(page.locator('.greenhouse-sheet')).toBeVisible();
}

test('the hub answers in the worker: its rules, a note kept, the history', async ({ page }) => {
  const requests = recordRequests(page);
  await openLive(page);
  await openBasilSheet(page);
  // The rules come from the hub (/config): basil waters itself, applied.
  const automation = page.locator('.automation');
  await automation.scrollIntoViewIfNeeded();
  await expect(automation.getByRole('switch', { name: /Regar sola/ })).toHaveAttribute(
    'aria-checked',
    'true',
    { timeout: 15_000 },
  );
  // A note, kept by the hub (not waiting for it).
  const journal = page.locator('.journal');
  await journal.scrollIntoViewIfNeeded();
  await page.getByRole('textbox', { name: 'Nota' }).fill('Hojas nuevas arriba');
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  await expect(journal.getByText('Hojas nuevas arriba', { exact: true })).toBeVisible();
  await expect(journal).not.toContainText('Se guardará');
  await page.getByRole('button', { name: 'Cerrar' }).click();
  // The greenhouse's history: the hub answers, with what it has kept so far.
  await openGreenhouse(page);
  const greenhouse = page.locator('.greenhouse-sheet');
  await expect(greenhouse).toContainText(/Aún hay poco historial|Dentro/, { timeout: 15_000 });
  await expect(greenhouse).not.toContainText('No se ha podido cargar el historial');
  // Still nothing to /api: the worker answers, and SQLite's WebAssembly is ours.
  const urls = requests.map((request) => request.url());
  expect(urls.filter((url) => new URL(url).pathname.startsWith('/api'))).toEqual([]);
  expect(urls.some((url) => /sql-wasm.*\.wasm/.test(url))).toBe(true);
});

test('what needs the real hub is hidden: push, CSV and photos (D110)', async ({ page }) => {
  await openLive(page);
  await openBasilSheet(page);
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: 'Guardar nota' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(sheet.getByRole('button', { name: /foto/i })).toHaveCount(0);
  await expect(sheet.getByRole('link', { name: /CSV/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await openGreenhouse(page);
  await expect(page.locator('.greenhouse-sheet a[download]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await page.getByRole('button', { name: /^Avisos/ }).click();
  await expect(page.getByText('En el invernadero real, el hub avisa al móvil.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activar avisos' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Últimos avisos' })).toBeVisible();
  // Nor is the browser asked for notifications.
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => Notification.permission)).toBe('default');
});

// Tagged @capture: what step 2 adds, phone and desktop, day and night.
test.describe('captures, step 2 @capture', () => {
  const step2 = (name: string) => file(name).replace('-demo-1-', '-demo-2-');
  for (const [device, use] of DEVICES) {
    test.describe(device, () => {
      test.use(use);
      for (const [theme, name] of THEMES) {
        test(`the demo's hub answers, ${theme}`, async ({ page }) => {
          const at = (shot: string) => step2(`${shot}-${name}-${device}`);
          await openLive(page, `?theme=${theme}`);
          await openBasilSheet(page);
          await page.getByRole('textbox', { name: 'Nota' }).fill('Hojas nuevas arriba');
          await page.getByRole('button', { name: 'Guardar nota' }).click();
          await expect(page.getByText('Hojas nuevas arriba', { exact: true })).toBeVisible();
          await page.locator('.journal').scrollIntoViewIfNeeded();
          await page.waitForTimeout(600);
          await page.screenshot({ path: at('diario') });
          await page.getByRole('button', { name: 'Cerrar' }).click();
          await openGreenhouse(page);
          await page.waitForTimeout(1500);
          await page.screenshot({ path: at('invernadero') });
        });
      }
    });
  }
});

/**
 * Step 3, the sky (D111): simulated and said so, raining when the visitor
 * arrives (the window held closed by the hub's own rule), and rain on demand
 * in "Probar situaciones".
 */
async function openAir(page: Page) {
  await page.getByRole('button', { name: 'Aire', exact: true }).click();
  const popover = page.locator('.dock-popover');
  await expect(popover).toBeVisible();
  return popover;
}

const HELD = 'Cerrada mientras llueva fuera: ventila solo el ventilador';

test('the sky is simulated, and it rains on arrival: the window held closed (D111)', async ({
  page,
}) => {
  await openLive(page);
  await expect(page.locator('.demo-bar')).toContainText('Demo · datos simulados');
  // "fuera · simulado", with its temperature, once the hub has looked at the sky.
  const outside = page.locator('.status-outside');
  await expect(outside).toContainText(/\d+°\s*fuera\s*· simulado/, { timeout: 15_000 });
  await expect(page.locator('.status')).not.toContainText('AEMET');
  // The hub's rain hold, as at home (A10).
  await expect(await openAir(page)).toContainText(HELD, { timeout: 20_000 });
  await page.keyboard.press('Escape');
  // Ajustes › Tiempo exterior: raining, never attributed to AEMET.
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await page.getByRole('button', { name: /^Tiempo exterior/ }).click();
  const settings = page.locator('.settings-page, .settings-sheet').last();
  await expect(page.getByText(/Fuente: simulado, no observado/)).toBeVisible();
  await expect(settings).toContainText(/Nuboso con lluvia|mm en la última hora/);
  await expect(settings).not.toContainText('Fuente: AEMET');
});

test('"Probar situaciones › Lluvia" makes it rain at once (D111)', async ({ page }) => {
  await openLive(page, '?cielo=seco');
  await expect(page.locator('.status-outside')).toContainText('· simulado', { timeout: 15_000 });
  await expect(await openAir(page)).not.toContainText(HELD);
  await page.keyboard.press('Escape');
  await openDemoBar(page);
  await page.getByRole('button', { name: 'Probar situaciones' }).click();
  await page.getByRole('button', { name: /^Lluvia/ }).click();
  await expect(page.getByRole('group', { name: 'Probar situaciones' })).toHaveCount(0);
  await expect(await openAir(page)).toContainText(HELD, { timeout: 20_000 });
});

test('"Probar situaciones": what fails shows as what it is, and goes away (D125)', async ({
  page,
}) => {
  await openLive(page, '?cielo=seco');
  const status = page.locator('.status');
  await expect(status).toContainText('Todo bien', { timeout: 20_000 });

  const pick = async (title: RegExp) => {
    await openDemoBar(page);
    await page.getByRole('button', { name: 'Probar situaciones' }).click();
    await page.getByRole('button', { name: title }).click();
    await expect(page.getByRole('group', { name: 'Probar situaciones' })).toHaveCount(0);
  };
  const backToNormal = async () => {
    await pick(/^Volver a la normalidad/);
    await expect(status).toContainText('Todo bien', { timeout: 20_000 });
  };

  await pick(/^Ola de calor/);
  await expect(page.locator('.ui-toast-stack')).toContainText('Demasiado calor', {
    timeout: 20_000,
  });
  await backToNormal();

  await pick(/^Depósito vacío/);
  await expect(status).toContainText('El depósito está vacío', { timeout: 20_000 });
  await backToNormal();

  // A broken sensor is said, never filled in.
  await pick(/^Se rompe un sensor/);
  await expect(status).toContainText('El sensor de la albahaca', { timeout: 20_000 });
  await backToNormal();

  // The device's own safe state when the link goes: orders wait for it.
  await pick(/^Sin conexión/);
  await expect(status).toContainText('Desconectado', { timeout: 20_000 });
  await expect(page.locator('.dock-reason')).toContainText('Sin conexión');
  await backToNormal();
  await expect(page.locator('.dock-reason')).toHaveCount(0);
});

// Tagged @capture: what step 3 adds, phone and desktop, day and night.
test.describe('captures, step 3 @capture', () => {
  const step3 = (name: string) => file(name).replace('-demo-1-', '-demo-3-');
  for (const [device, use] of DEVICES) {
    test.describe(device, () => {
      test.use(use);
      for (const [theme, name] of THEMES) {
        test(`the demo's sky, ${theme}`, async ({ page }) => {
          const at = (shot: string) => step3(`${shot}-${name}-${device}`);
          await openLive(page, `?theme=${theme}`);
          await expect(page.locator('.status-outside')).toContainText('· simulado', {
            timeout: 15_000,
          });
          await page.waitForTimeout(2500);
          await page.screenshot({ path: at('lluvia') });
          await expect(await openAir(page)).toContainText(HELD, { timeout: 20_000 });
          await page.waitForTimeout(600);
          await page.screenshot({ path: at('ventana') });
          await page.keyboard.press('Escape');
          await openDemoBar(page);
          await page.getByRole('button', { name: 'Probar situaciones' }).click();
          await page.waitForTimeout(600);
          await page.screenshot({ path: at('situaciones') });
        });
      }
    });
  }
});

/**
 * Ready to publish (D112): the demo on its own clock, an hour a minute on
 * arrival or "Ver un día en un minuto", carrying on from a recorded week
 * that ends today; said plainly, and welcomed once.
 */
const minutesOf = async (page: Page) => {
  const text = (await page.locator('.demo-label-clock').textContent()) ?? '';
  const [, hours = '0', minutes = '0'] = /(\d\d):(\d\d)/.exec(text) ?? [];
  return Number(hours) * 60 + Number(minutes);
};
/** Minutes from `from` to `to` on a clock face (it may pass midnight). */
const ahead = (from: number, to: number) => (to - from + 1440) % 1440;

async function scrubTo(page: Page, seconds: number) {
  await page.locator('.timeline-input').evaluate((input: HTMLInputElement, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
}

async function rewindWeek(page: Page) {
  await page.getByRole('button', { name: 'Rebobinar' }).click();
  const timeline = page.getByRole('region', { name: 'Rebobinar' });
  await timeline.getByRole('radio', { name: '7 días' }).click();
  await expect(timeline.locator('.timeline-note')).not.toContainText('Cargando', {
    timeout: 20_000,
  });
  return timeline;
}

test('"Demo · datos simulados", and its clock: an hour a minute, or a day (D112)', async ({
  page,
}) => {
  await openLive(page);
  await expect(page).toHaveTitle('Vitreo · Demo');
  await expect(page.locator('.demo-label')).toContainText('Demo · datos simulados');
  await expect(page.locator('section[aria-label="Resumen del invernadero"]')).toContainText(
    'Demo · datos simulados',
  );
  const speed = page.getByRole('radiogroup', { name: 'Velocidad de la demo' });
  await expect(speed.getByRole('radio', { name: 'Normal' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('.demo-label-clock')).toContainText('una hora por minuto');
  // An hour a minute: three seconds are about three minutes.
  let before = await minutesOf(page);
  await page.waitForTimeout(3_200);
  expect(ahead(before, await minutesOf(page))).toBeGreaterThanOrEqual(2);
  expect(ahead(before, await minutesOf(page))).toBeLessThan(10);
  // A day a minute: three seconds are over an hour.
  await openDemoBar(page);
  await speed.getByRole('radio', { name: 'Ver un día en un minuto' }).click();
  await expect(page.locator('.demo-label-clock')).toContainText('un día por minuto');
  before = await minutesOf(page);
  await page.waitForTimeout(3_200);
  expect(ahead(before, await minutesOf(page))).toBeGreaterThanOrEqual(60);
  // Still live at that pace: never "stale" for want of readings.
  await expect(page.locator('.status')).toHaveAttribute('data-freshness', 'live');
  await openDemoBar(page);
  await speed.getByRole('radio', { name: 'Normal' }).click();
  await expect(page.locator('.demo-label-clock')).toContainText('una hora por minuto');
});

test('the recorded week ends today, and the rain held the window closed in it (D112)', async ({
  page,
}) => {
  await openLive(page);
  const timeline = await rewindWeek(page);
  const from = Number(await page.locator('.timeline-input').getAttribute('min'));
  const to = Number(await page.locator('.timeline-input').getAttribute('max'));
  expect(to - from).toBeGreaterThanOrEqual(7 * 86_400 - 3600);
  // Every day of it has readings: two days ago, five days ago.
  for (const daysAgo of [2, 5]) {
    await scrubTo(page, to - daysAgo * 86_400);
    await expect(page.locator('.status-past')).toHaveText(/Así estaba el/);
    await expect(timeline.locator('.timeline-note')).not.toContainText('Sin datos');
  }
  await page.getByRole('button', { name: 'Volver a ahora' }).click();
  // The hub kept the week: its holds for the rain among what it did.
  await openGreenhouse(page);
  await expect(page.locator('.greenhouse-sheet')).not.toContainText('Aún hay poco historial', {
    timeout: 15_000,
  });
});

test('the welcome says it is a demo and what to try (D112)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('vitreo.onboarded');
  });
  await page.goto('/');
  const welcome = page.getByRole('dialog');
  await expect(welcome).toContainText('Esto es una demo');
  await expect(welcome).toContainText('Nada sale de él');
  for (let i = 0; i < 3; i++) await welcome.getByRole('button', { name: 'Siguiente' }).click();
  await expect(welcome).toContainText('Qué probar');
  await expect(welcome).toContainText('Ver un día en un minuto');
  await welcome.getByRole('button', { name: 'Empezar' }).click();
  await expect(welcome).toBeHidden();
});

// Tagged @capture: the demo ready to publish, phone and desktop: a dry day
// at a day a minute, the rain on arrival, the welcome, the recorded week.
test.describe('captures, ready to publish @capture', () => {
  const step4 = (name: string) => file(name).replace('-demo-1-', '-demo-4-');
  for (const [device, use] of DEVICES) {
    test.describe(device, () => {
      test.use(use);
      test(`the demo ready to publish, ${device}`, async ({ page }) => {
        const at = (shot: string) => step4(`${shot}-${device}`);
        await openLive(page, '?theme=day&cielo=seco');
        await expect(page.locator('.status-outside')).toContainText('· simulado', {
          timeout: 15_000,
        });
        await openDemoBar(page);
        await page
          .getByRole('radiogroup', { name: 'Velocidad de la demo' })
          .getByRole('radio', { name: 'Ver un día en un minuto' })
          .click();
        await page.waitForTimeout(2500);
        await page.screenshot({ path: at('dia') });

        await openLive(page, '?theme=day');
        await expect(page.locator('.status-outside')).toContainText('· simulado', {
          timeout: 15_000,
        });
        await expect(await openAir(page)).toContainText(HELD, { timeout: 20_000 });
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
          (document.activeElement as HTMLElement | null)?.blur();
        });
        await page.waitForTimeout(2500);
        await page.screenshot({ path: at('lluvia') });

        await rewindWeek(page);
        const to = Number(await page.locator('.timeline-input').getAttribute('max'));
        await scrubTo(page, to - 3 * 86_400);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: at('semana') });
        await page.getByRole('button', { name: 'Volver a ahora' }).click();

        await page.evaluate(() => {
          localStorage.removeItem('vitreo.onboarded');
        });
        await page.goto('/?theme=day');
        await expect(page.getByRole('dialog')).toContainText('Esto es una demo');
        await page.waitForTimeout(1500);
        await page.screenshot({ path: at('bienvenida') });
      });
    });
  }
});
