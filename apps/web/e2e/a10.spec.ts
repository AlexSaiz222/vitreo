import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { CONTROL, HUB, openLive, resetSimulator } from './helpers.ts';

/**
 * A10 (D97): the weather outside from AEMET. The tests' hubs never call
 * AEMET (no key, no network): each test puts in the weather the hub would
 * have fetched, through its test route.
 */

test.beforeEach(async ({ request }) => {
  await resetSimulator(request);
});

type Kind = 'clear' | 'cloudy' | 'rain' | 'fog' | 'snow' | 'wind';

/** Each state as AEMET would give it: the station's hour and the forecast's sky. */
const WEATHER: Record<
  Kind,
  {
    sky: string;
    text: string;
    temp: number;
    precip: number;
    forecastPrecip: number;
    snow: number;
    wind: number;
    gust: number;
    visibility: number | null;
  }
> = {
  clear: {
    sky: '11',
    text: 'Despejado',
    temp: 19,
    precip: 0,
    forecastPrecip: 0,
    snow: 0,
    wind: 2,
    gust: 5,
    visibility: 30,
  },
  cloudy: {
    sky: '16',
    text: 'Cubierto',
    temp: 14,
    precip: 0,
    forecastPrecip: 0,
    snow: 0,
    wind: 3,
    gust: 7,
    visibility: 20,
  },
  rain: {
    sky: '25',
    text: 'Muy nuboso con lluvia',
    temp: 12,
    precip: 1.2,
    forecastPrecip: 1,
    snow: 0,
    wind: 4,
    gust: 9,
    visibility: 8,
  },
  fog: {
    sky: '81',
    text: 'Niebla',
    temp: 6,
    precip: 0,
    forecastPrecip: 0,
    snow: 0,
    wind: 1,
    gust: 2,
    visibility: 0.3,
  },
  snow: {
    sky: '36',
    text: 'Cubierto con nieve',
    temp: 0.5,
    precip: 0.6,
    forecastPrecip: 0.6,
    snow: 1,
    wind: 3,
    gust: 8,
    visibility: 2,
  },
  wind: {
    sky: '13',
    text: 'Intervalos nubosos',
    temp: 15,
    precip: 0,
    forecastPrecip: 0,
    snow: 0,
    wind: 10,
    gust: 17,
    visibility: 25,
  },
};

/** Local hour in Madrid today, as Unix ms (the hub's time zone). */
function madrid(hour: number, minute = 0): number {
  const now = Date.now();
  const local = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const offset = local.getTime() - Math.floor(now / 1000) * 1000;
  const day = new Date(local);
  day.setHours(hour, minute, 0, 0);
  return day.getTime() - offset;
}

/** Puts weather in the tests' hub, as if it came from AEMET at `now` (ms). */
async function putWeather(
  request: APIRequestContext,
  kind: Kind,
  options: { now?: number; tonight?: { min: number; at: number }; observedHoursAgo?: number } = {},
) {
  const now = options.now ?? Date.now();
  const w = WEATHER[kind];
  const hour = Math.floor(now / 3_600_000) * 3600;
  const points = Array.from({ length: 30 }, (_, i) => {
    const at = hour + (i - 2) * 3600;
    const tonight = at === options.tonight?.at ? options.tonight.min : null;
    return {
      hour: at,
      sky: w.sky,
      skyText: w.text,
      temp: tonight ?? (options.tonight ? Math.max(w.temp, options.tonight.min + 3) : w.temp),
      precip: w.forecastPrecip,
      snow: w.snow,
      windSpeed: w.wind,
      windGust: w.gust,
    };
  });
  const response = await request.post(`${HUB}/test/weather`, {
    data: {
      now,
      observation: {
        station: { id: '3195', name: 'MADRID, RETIRO' },
        at: Math.floor(now / 1000) - 600 - (options.observedHoursAgo ?? 0) * 3600,
        temp: w.temp,
        rh: kind === 'fog' ? 98 : 70,
        windSpeed: w.wind,
        windGust: w.gust,
        windDir: 240,
        precip: w.precip,
        visibility: w.visibility,
      },
      forecast: {
        municipality: { id: '28079', name: 'Madrid' },
        issuedAt: hour - 3 * 3600,
        points,
      },
    },
  });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ status: string; window: { state: string } }>;
}

async function openWeatherPage(page: Page) {
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await page.getByRole('button', { name: /^Tiempo exterior/ }).click();
  await expect(page.getByRole('heading', { name: 'Tiempo exterior', exact: true })).toBeVisible();
}

async function expectAccessible(page: Page) {
  await page.waitForTimeout(500);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
}

/** Opens the window from the dock, as a person would, and waits for the greenhouse. */
async function openWindow(page: Page, request: APIRequestContext) {
  await page.getByRole('button', { name: 'Aire', exact: true }).click();
  await page.getByRole('radio', { name: 'Abierta' }).click();
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${CONTROL}/state`)).json()) as { actuators: { vent: number } })
          .actuators.vent,
    )
    .toBe(1);
}

interface SimState {
  actuators: { vent: number; fan: boolean };
  overTemperature: boolean;
  outdoorHold: { cause: string; openedByHand: boolean } | null;
}
const simState = async (request: APIRequestContext) =>
  (await (await request.get(`${CONTROL}/state`)).json()) as SimState;
const ventNow = async (request: APIRequestContext) => (await simState(request)).actuators.vent;
const holdNow = async (request: APIRequestContext) =>
  (await simState(request)).outdoorHold?.cause ?? null;

/** The air inside at once (the simulator's test route): heat protection for real. */
async function setAir(request: APIRequestContext, temp: number) {
  expect((await request.post(`${CONTROL}/air`, { data: { temp } })).ok()).toBe(true);
}

/** The hub's rules, looked at now (the tests' hub does not on its own). */
async function evaluate(request: APIRequestContext) {
  const response = await request.post(`${HUB}/test/weather/evaluate`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { window: { state: string } }).window.state;
}

/** The greenhouse's own ventilation on (A6): the fan from 28 °C, the window from 31 °C. */
async function ventilate(request: APIRequestContext) {
  const { config } = (await (await request.get(`${HUB}/config`)).json()) as {
    config: { watering: unknown; light: unknown; ventilation: Record<string, unknown> };
  };
  const response = await request.put(`${HUB}/config`, {
    data: {
      watering: config.watering,
      light: config.light,
      ventilation: { ...config.ventilation, enabled: true, fanAbove: 28, windowAbove: 31 },
    },
  });
  expect(response.ok()).toBe(true);
}

test('without a key there is no weather, and Ajustes says why', async ({ page }) => {
  await openLive(page);
  await expect(page.locator('.status-line')).not.toContainText('fuera');
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.getByRole('button', { name: /^Tiempo exterior/ })).toContainText(
    'Sin clave de AEMET',
  );
  await page.getByRole('button', { name: /^Tiempo exterior/ }).click();
  await expect(page.getByText(/El hub no tiene clave de AEMET/)).toBeVisible();
  await expect(page.getByText('Fuente: AEMET', { exact: false })).toHaveCount(0);
  // Both rules are there, on by default, waiting for weather.
  await expect(page.getByRole('switch', { name: /Cerrar la ventana/ })).toBeChecked();
  await expect(page.getByRole('switch', { name: /Avisar de heladas/ })).toBeChecked();
  await expectAccessible(page);
});

test('the header shows the temperature outside next to the one inside, labelled', async ({
  page,
  request,
}) => {
  await openLive(page);
  await putWeather(request, 'rain');
  const line = page.locator('.status-line');
  await expect(line).toContainText('fuera', { timeout: 10_000 });
  await expect(line).toContainText('dentro');
  await expect(page.locator('.status-outside')).toContainText('12°');

  await openWeatherPage(page);
  await expect(page.getByText(/Fuente: AEMET\. Actualizado a las \d\d:\d\d\./)).toBeVisible();
  await expect(page.getByText('MADRID, RETIRO, a las', { exact: false })).toBeVisible();
  await expect(page.getByText('1,2 mm en la última hora')).toBeVisible();
  await expect(page.getByText('Muy nuboso con lluvia')).toBeVisible();
  await expectAccessible(page);
});

test('rain holds the window closed, and the dock says why', async ({ page, request }) => {
  await openLive(page);
  await openWindow(page, request);
  const state = await putWeather(request, 'rain');
  expect(state.window.state).toBe('asking');
  await expect.poll(() => holdNow(request)).toBe('rain');
  expect(await ventNow(request)).toBe(0);
  await expect.poll(() => evaluate(request)).toBe('holding');
  // After the "done" of the person's own order (8 s), the reason.
  await expect(page.locator('.dock-popover .menu-status')).toHaveText(
    'Cerrada: llueve fuera, 1,2 mm en la última hora',
    { timeout: 15_000 },
  );
});

test('strong wind holds it closed too', async ({ page, request }) => {
  await openLive(page);
  await openWindow(page, request);
  await putWeather(request, 'wind');
  await expect.poll(() => ventNow(request)).toBe(0);
  expect(await holdNow(request)).toBe('wind');
  await expect(page.locator('.dock-popover .menu-status')).toContainText(
    'Cerrada: viento fuerte fuera, 61 km/h ≥ 50 km/h',
    { timeout: 15_000 },
  );
});

test('during the hold the greenhouse ventilates with the fan only, and opens again when it clears', async ({
  page,
  request,
}) => {
  await ventilate(request);
  await openLive(page);
  await putWeather(request, 'rain');
  await expect.poll(() => holdNow(request)).toBe('rain');
  // Warm enough for the window (31 °C), not for heat protection (35 °C).
  await setAir(request, 33);
  await expect.poll(async () => (await simState(request)).actuators.fan).toBe(true);
  expect(await ventNow(request)).toBe(0);
  await page.getByRole('button', { name: 'Aire', exact: true }).click();
  await expect(page.locator('.dock-popover .menu-status').last()).toContainText(
    'Cerrada mientras llueva fuera: ventila solo el ventilador',
  );
  // Fair again: the hold is released and the greenhouse's own rule opens the window.
  await putWeather(request, 'clear');
  await expect.poll(() => holdNow(request)).toBeNull();
  await expect.poll(() => ventNow(request)).toBe(1);
});

test('heat protection wins, and the window closes again once the heat has passed', async ({
  page,
  request,
}) => {
  await openLive(page);
  await setAir(request, 36);
  await expect.poll(async () => (await simState(request)).overTemperature).toBe(true);
  await putWeather(request, 'rain');
  await expect.poll(() => holdNow(request)).toBe('rain');
  expect(await ventNow(request)).toBe(1);
  await expect.poll(() => evaluate(request)).toBe('held-by-heat');
  await page.getByRole('button', { name: 'Aire', exact: true }).click();
  await expect(page.locator('.dock-popover .menu-status').last()).toContainText(
    'Llueve fuera, pero el calor dentro la mantiene abierta',
  );
  await page.keyboard.press('Escape');
  await openWeatherPage(page);
  await expect(page.getByText(/la protección por calor deja la ventana abierta/)).toBeVisible();
  // Cooler: heat protection lets go and the hold closes the window again.
  await setAir(request, 30);
  await expect.poll(() => ventNow(request)).toBe(0);
  expect(await holdNow(request)).toBe('rain');
});

test('a window opened by hand during the hold stays open', async ({ page, request }) => {
  await openLive(page);
  await putWeather(request, 'rain');
  await expect.poll(() => holdNow(request)).toBe('rain');
  await openWindow(page, request);
  // Once the hub has the device's reading.
  await expect.poll(() => evaluate(request)).toBe('left-open');
  await page.waitForTimeout(1500);
  expect(await ventNow(request)).toBe(1);
  expect((await simState(request)).outdoorHold?.openedByHand).toBe(true);
  await expect(page.locator('.dock-popover .menu-status')).toHaveText(
    'Llueve fuera; la abriste tú y se queda así mientras dure',
    { timeout: 15_000 },
  );
});

test('switched off, the rule releases the hold and leaves the window alone', async ({
  page,
  request,
}) => {
  await openLive(page);
  await putWeather(request, 'rain');
  await expect.poll(() => holdNow(request)).toBe('rain');
  await openWeatherPage(page);
  const rule = page.getByRole('switch', { name: /Cerrar la ventana/ });
  await rule.click();
  await expect(rule).not.toBeChecked();
  await expect.poll(() => holdNow(request)).toBeNull();
  // Kept on the hub, and no hold comes back while it rains.
  await putWeather(request, 'rain');
  await page.waitForTimeout(1500);
  expect(await holdNow(request)).toBeNull();
  const rules = (await (await request.get(`${HUB}/weather`)).json()) as {
    rules: { closeWindow: boolean };
  };
  expect(rules.rules.closeWindow).toBe(false);
});

test('a frost forecast sends one warning in the evening', async ({ request }) => {
  const endpoint = 'https://push.example/e2e-frost';
  await request.put(`${HUB}/push/subscription`, {
    data: {
      subscription: { endpoint, keys: { p256dh: 'BPk-test', auth: 'auth-test' } },
      prefs: { types: ['frost_forecast'] },
    },
  });
  // A browser that wants only the limits that actually trigger: not this one.
  await request.put(`${HUB}/push/subscription`, {
    data: {
      subscription: {
        endpoint: 'https://push.example/e2e-safety',
        keys: { p256dh: 'BPk-test', auth: 'auth-test' },
      },
      prefs: { types: ['safety'] },
    },
  });
  const evening = madrid(20, 30);
  const six = Math.floor(madrid(6) / 1000) + 24 * 3600;
  await putWeather(request, 'clear', { now: evening, tonight: { min: 1, at: six } });
  await request.post(`${HUB}/test/weather/evaluate`, { data: { now: evening + 600_000 } });
  const pushes = (await (await request.get(`${HUB}/test/pushes`)).json()) as {
    endpoint: string;
    message: { title: string; critical: boolean };
  }[];
  expect(pushes).toEqual([
    {
      endpoint,
      message: expect.objectContaining({
        title: 'Helada prevista: 1 °C a las 6:00',
        critical: false,
      }) as unknown,
    },
  ]);
  const alerts = (await (await request.get(`${HUB}/alerts`)).json()) as {
    title: string;
    type: string;
  }[];
  expect(alerts[0]).toMatchObject({
    title: 'Helada prevista: 1 °C a las 6:00',
    type: 'frost_forecast',
  });
});

test('with the hub down the scene shows no weather, and Ajustes says why', async ({
  page,
  request,
}) => {
  await openLive(page);
  await putWeather(request, 'rain');
  await expect(page.locator('.status-outside')).toBeVisible({ timeout: 10_000 });
  // The hub stops answering (the PC's Docker, say): its next check fails.
  await page.route('**/api/v1/**', (route) => route.abort());
  await expect(page.locator('.status-outside')).toHaveCount(0, { timeout: 45_000 });
  await openWeatherPage(page);
  await expect(page.getByText(/El hub no responde/).first()).toBeVisible();
});

test('old data is not shown as now', async ({ page, request }) => {
  await openLive(page);
  // An observation from 5 hours ago and a forecast that stopped then.
  const then = Date.now() - 5 * 3_600_000;
  await putWeather(request, 'rain', { now: then });
  await page.waitForTimeout(1500);
  await expect(page.locator('.status-outside')).toHaveCount(0);
});

test('an hour-old reading says how old it is, next to "fuera"', async ({ page, request }) => {
  await openLive(page);
  await putWeather(request, 'clear');
  await expect(page.locator('.status-outside')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.status-age')).toHaveCount(0);
  // AEMET runs 1–2 h behind: 1 h 10 min ago.
  await putWeather(request, 'clear', { observedHoursAgo: 1 });
  await expect(page.locator('.status-age')).toHaveText('· hace 1 h', { timeout: 10_000 });
});

test('Baja draws no rain: fewer draw calls than Alta', async ({ page, request }) => {
  await putWeather(request, 'rain');
  await openLive(page, '?theme=day&quality=high');
  await page.waitForTimeout(6000);
  const high = Number(await page.evaluate(() => document.documentElement.dataset['drawCalls']));
  await openLive(page, '?theme=day&quality=low');
  await page.waitForTimeout(3000);
  const low = Number(await page.evaluate(() => document.documentElement.dataset['drawCalls']));
  expect(high).toBeLessThan(100);
  expect(low).toBeLessThan(high);
});

/**
 * A10 captures (docs/09): each weather state by day and by night on the
 * phone (the header shows the outdoor temperature), rain on the desktop,
 * Ajustes › Tiempo exterior, and the rules at work. Tagged @capture.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const shot = (name: string) => path.join(OUT, `${DATE}-faseA-10-${name}.png`);
const PHONE = {
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
} as const;

test.describe('captures @capture', () => {
  test.describe.configure({ timeout: 240_000 });
  test.use(PHONE);

  for (const [theme, name] of [
    ['day', 'dia'],
    ['night', 'noche'],
  ] as const) {
    test(`every weather, ${theme}`, async ({ page, request }) => {
      for (const kind of ['clear', 'cloudy', 'rain', 'fog', 'snow', 'wind'] as const) {
        // Opened afresh each time: the scene starts with the weather as it is
        // (a change while open takes its time, as the sky does).
        await putWeather(request, kind);
        await openLive(page, `?theme=${theme}&quality=high`);
        // Rain and snow fade in over a few seconds; the fog's veil too.
        await page.waitForTimeout(14_000);
        await page.screenshot({ path: shot(`${kind}-${name}-movil`) });
      }
    });

    test(`Ajustes › Tiempo exterior, ${theme}`, async ({ page, request }) => {
      await putWeather(request, 'rain');
      await openLive(page, `?theme=${theme}`);
      await openWeatherPage(page);
      await page.waitForTimeout(900);
      await page.screenshot({ path: shot(`ajustes-${name}-movil`) });
    });
  }

  for (const [theme, name] of [
    ['day', 'dia'],
    ['night', 'noche'],
  ] as const) {
    test(`the header with an hour-old reading, ${theme}`, async ({ page, request }) => {
      await putWeather(request, 'cloudy', { observedHoursAgo: 1 });
      await openLive(page, `?theme=${theme}`);
      await expect(page.locator('.status-age')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(900);
      await page.screenshot({
        path: shot(`cabecera-hace-1h-${name}-movil`),
        clip: { x: 0, y: 0, width: 412, height: 220 },
      });
    });
  }

  test('no key: Ajustes says why', async ({ page }) => {
    await openLive(page, '?theme=day');
    await openWeatherPage(page);
    await page.waitForTimeout(900);
    await page.screenshot({ path: shot('sin-clave-dia-movil') });
  });

  test('Avisos: frost forecasts have their own switch', async ({ page }) => {
    await openLive(page, '?theme=day');
    await page.getByRole('button', { name: 'Ajustes' }).click();
    await page.getByRole('button', { name: /^Avisos/ }).click();
    const frost = page.getByRole('switch', { name: /Previsión de helada/ });
    await frost.scrollIntoViewIfNeeded();
    await expect(frost).toBeVisible();
    await page.waitForTimeout(900);
    await page.screenshot({ path: shot('avisos-dia-movil') });
  });

  test('the rules: held closed for the rain, and opened by heat', async ({ page, request }) => {
    await ventilate(request);
    await openLive(page, '?theme=day&quality=high');
    await putWeather(request, 'rain');
    await expect.poll(() => holdNow(request)).toBe('rain');
    await setAir(request, 33);
    await expect.poll(async () => (await simState(request)).actuators.fan).toBe(true);
    await page.getByRole('button', { name: 'Aire', exact: true }).click();
    await expect(page.locator('.dock-popover .menu-status').last()).toContainText(
      'ventila solo el ventilador',
    );
    await page.waitForTimeout(4000);
    await page.screenshot({ path: shot('regla-lluvia-dia-movil') });

    // Then too hot: heat protection opens the window, and Ajustes says so.
    await setAir(request, 36);
    await expect.poll(() => ventNow(request)).toBe(1);
    await expect.poll(() => evaluate(request)).toBe('held-by-heat');
    await page.keyboard.press('Escape');
    await openWeatherPage(page);
    await expect(page.getByText(/la protección por calor deja la ventana abierta/)).toBeVisible();
    await page.waitForTimeout(900);
    await page.screenshot({ path: shot('reglas-dia-movil') });
  });

  test.describe('desktop', () => {
    test.use({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });
    for (const [theme, name] of [
      ['day', 'dia'],
      ['night', 'noche'],
    ] as const) {
      test(`rain, ${theme}`, async ({ page, request }) => {
        await putWeather(request, 'rain');
        await openLive(page, `?theme=${theme}&quality=high`);
        await page.waitForTimeout(16_000);
        await page.screenshot({ path: shot(`rain-${name}-escritorio`) });
      });
    }
  });
});
