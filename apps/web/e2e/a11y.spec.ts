import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { openLive, resetSimulator, seedHistory } from './helpers.ts';

/**
 * The accessibility checklist of docs/03, with evidence (A12): text at
 * 200 % on a phone and a desktop without breaking the layout (no sideways
 * scroll, no clipped text), every target at least 44 px, and no axe
 * violations by day and by night, on the main screen and the sheets.
 */
const OUT =
  process.env['CAPTURE_DIR'] ?? path.resolve(import.meta.dirname, '../../../referencias/progreso');
const DATE = new Date().toLocaleDateString('en-CA');
const file = (name: string) => path.join(OUT, `${DATE}-faseA-12-${name}.png`);
const DEVICES = [
  ['escritorio', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  [
    'movil',
    { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ],
] as const;

/** Text at 200 %, as the browser's or Android's text size does (the type is in rem). */
async function bigText(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = '200%';
    });
  });
}

/** What breaks the layout inside `scope`: sideways scroll and clipped text. */
async function layoutProblems(page: Page, scope: string): Promise<string[]> {
  return page.locator(scope).evaluate((root: Element) => {
    const problems: string[] = [];
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 40)}"`;
    if (root.scrollWidth > root.clientWidth + 1) problems.push(`sideways scroll in ${name(root)}`);
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (el.closest('svg, .visually-hidden, [aria-hidden="true"]')) continue;
      const clips =
        ['hidden', 'clip'].includes(style.overflowX) || style.textOverflow === 'ellipsis';
      if (clips && el.scrollWidth > el.clientWidth + 1) problems.push(`clipped: ${name(el)}`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      problems.push('the page scrolls sideways');
    }
    // Fixed panels (the dock) never scroll the page: they must fit the screen.
    for (const el of root.querySelectorAll<HTMLElement>('button, a[href], p, h1, h2, h3, li')) {
      if (el.closest('.app-scene, .plant-anchors, .visually-hidden, [aria-hidden="true"]'))
        continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.left < -1 || box.right > window.innerWidth + 1) {
        problems.push(`off screen: ${name(el)}`);
      }
    }
    return problems;
  });
}

/** Controls smaller than 44 × 44 px (docs/03, `--target-min`). */
async function smallTargets(page: Page, scope: string): Promise<string[]> {
  return page.locator(scope).evaluate((root: Element) => {
    const selector =
      'button, a[href], input:not([type="hidden"]):not([type="file"]), select, textarea, [role="switch"], [role="radio"], [role="slider"]';
    const small: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      if (el.closest('[hidden], .visually-hidden, [aria-hidden="true"]')) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      // A native range input is covered by its 44 px row (Slider): measured there.
      const target = el.matches('input[type="range"]') ? (el.parentElement ?? el) : el;
      const { width, height } = target.getBoundingClientRect();
      if (width < 43.5 || height < 43.5) {
        small.push(
          `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30)}" ${Math.round(width).toString()}×${Math.round(height).toString()}`,
        );
      }
    }
    return small;
  });
}

/** Once the sheet has finished appearing: mid-fade its colours are not the real ones. */
async function settled(page: Page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.ui-sheet')].every((sheet) =>
      sheet.getAnimations({ subtree: true }).every((a) => a.playState !== 'running'),
    ),
  );
}

async function openBasil(page: Page) {
  await page.locator('.plant-target[data-zone="basil_01"]').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Albahaca' }).waitFor();
  const more = page.getByRole('button', { name: 'Mostrar más detalles' });
  if (await more.isVisible()) await more.click();
}

test.describe('accessibility checklist (docs/03)', () => {
  test.beforeEach(async ({ request }) => {
    await resetSimulator(request);
    await seedHistory(request);
  });

  for (const [device, use] of DEVICES) {
    test.describe(device, () => {
      test.use(use);

      test(`text at 200 % keeps every screen whole, ${device}`, async ({ page }) => {
        await bigText(page);
        await openLive(page, '?theme=day');
        // On a desktop the dock opens on approach (D115): judged open, as it is used,
        // once its words have finished opening.
        await page.locator('.dock-bar').hover();
        await expect(page.locator('.dock-buttons .ui-button > span').first()).toHaveCSS(
          'opacity',
          '1',
        );
        await page.waitForTimeout(400);
        expect(await layoutProblems(page, 'body')).toEqual([]);

        await openBasil(page);
        expect(await layoutProblems(page, '.ui-sheet')).toEqual([]);
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: 'Ajustes' }).click();
        expect(await layoutProblems(page, '.ui-sheet')).toEqual([]);
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: /Ver el invernadero/ }).click();
        await expect(page.locator('.greenhouse-sheet .climate-chart').first()).toBeVisible({
          timeout: 15_000,
        });
        expect(await layoutProblems(page, '.ui-sheet')).toEqual([]);
      });

      test(`every target is at least 44 px, ${device}`, async ({ page }) => {
        await openLive(page, '?theme=day');
        // The dock open, as it is used (D115): folded, its tank is not a target
        // at all. It opens in a short reveal (D128): measured once it has.
        await page.locator('.dock-bar').hover();
        await expect.poll(() => smallTargets(page, 'main')).toEqual([]);
        await openBasil(page);
        expect(await smallTargets(page, '.ui-sheet')).toEqual([]);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Ajustes' }).click();
        expect(await smallTargets(page, '.ui-sheet')).toEqual([]);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /Ver el invernadero/ }).click();
        await expect(page.locator('.greenhouse-sheet .climate-chart').first()).toBeVisible({
          timeout: 15_000,
        });
        expect(await smallTargets(page, '.ui-sheet')).toEqual([]);
      });
    });
  }

  test('the scene has a text summary: every plant, its soil and how it is', async ({ page }) => {
    await openLive(page);
    const summary = page.getByRole('region', { name: 'Resumen del invernadero' });
    await expect(summary.getByRole('listitem')).toHaveCount(6);
    await expect(summary.getByRole('listitem').first()).toHaveText(
      /^Albahaca: tierra al \d+\s%, (bien|tiene sed)$/,
    );
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });
    test('every animation stops: --motion-scale is 0', async ({ page }) => {
      await openLive(page);
      const scale = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--motion-scale').trim(),
      );
      expect(scale).toBe('0');
    });
  });

  for (const theme of ['day', 'night'] as const) {
    test(`no axe violations (contrast AA included), ${theme}`, async ({ page }) => {
      await openLive(page, `?theme=${theme}`);
      const check = async () => {
        await settled(page);
        const results = await new AxeBuilder({ page }).exclude('canvas').analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.length.toString()}`)).toEqual([]);
      };
      await check();
      await openBasil(page);
      await check();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /Ver el invernadero/ }).click();
      await expect(page.locator('.greenhouse-sheet .climate-chart').first()).toBeVisible({
        timeout: 15_000,
      });
      await check();
    });
  }
});

// Tagged @capture: the fast suite (pnpm e2e) leaves them out.
test.describe('captures @capture', () => {
  test.beforeEach(async ({ request }) => {
    await resetSimulator(request);
    await seedHistory(request);
  });
  for (const [device, use] of DEVICES) {
    test.describe(device, () => {
      test.use(use);
      test(`text at 200 %, ${device}`, async ({ page }) => {
        await bigText(page);
        await openLive(page, '?theme=day');
        await page.waitForTimeout(900);
        await page.screenshot({ path: file(`texto-200-inicio-${device}`) });
        await openBasil(page);
        await page.waitForTimeout(900);
        await page.screenshot({ path: file(`texto-200-planta-${device}`) });
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /Ver el invernadero/ }).click();
        await expect(page.locator('.greenhouse-sheet .climate-chart').first()).toBeVisible({
          timeout: 15_000,
        });
        await page.waitForTimeout(900);
        await page.screenshot({ path: file(`texto-200-invernadero-${device}`) });
      });
    });
  }
});
