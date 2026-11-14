import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The design rules as code (D49, D72, D80): colours and sizes come from
 * tokens.css, panels over the canvas never blur it, the display face is
 * only used at display sizes, and inset means pressed, selected or input.
 */
const SRC = path.resolve(import.meta.dirname, '..');
const sheets = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((file) => file.endsWith('.css') && path.basename(file) !== 'tokens.css')
  .map((file) => ({
    file: file.replaceAll('\\', '/'),
    css: readFileSync(path.join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
  }));

/** Rule blocks (selector and body), innermost first; enough for our flat CSS. */
function blocks(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? '').trim(),
    body: match[2] ?? '',
  }));
}

describe('CSS follows the design tokens', () => {
  it('finds the style sheets', () => {
    expect(sheets.map((sheet) => sheet.file)).toContain('ui/ui.css');
  });

  it.each(sheets)('$file never blurs the scene behind a panel', ({ css }) => {
    expect(css).not.toMatch(/backdrop-filter/);
  });

  it.each(sheets)('$file takes its colours from tokens', ({ css }) => {
    expect(css.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab)\(/gi) ?? []).toEqual([]);
  });

  it.each(sheets)('$file takes its font sizes from tokens', ({ css }) => {
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1] ?? '');
    expect(sizes.filter((size) => !/^var\(--text-\d+\)$/.test(size.trim()))).toEqual([]);
  });

  it.each(sheets.filter((sheet) => !sheet.file.startsWith('ui/lab/')))(
    '$file uses the display face only at display sizes',
    ({ css }) => {
      const small = blocks(css).filter(
        ({ body }) =>
          body.includes('var(--font-display)') && !/font-size:\s*var\(--text-(28|40)\)/.test(body),
      );
      expect(small.map(({ selector }) => selector)).toEqual([]);
    },
  );

  // Inset means "pressed / selected / input" only (D81): a sunken surface
  // anywhere else reads as a button or a field that is not there.
  const INSET_STATES =
    /:active|:checked|\[aria-(?:pressed|checked|selected|current)=|input|textarea|select\b|-track|\[data-elevation='inset/;

  it.each(sheets)('$file sinks only what is pressed, selected or an input', ({ css }) => {
    const misplaced = blocks(css).filter(
      ({ selector, body }) =>
        /--elev-(?:inset|pressed)/.test(body) &&
        !selector.split(',').every((part) => INSET_STATES.test(part)),
    );
    expect(misplaced.map(({ selector }) => selector)).toEqual([]);
  });

  it('screens use no inset surfaces (only the primitives catalogue shows them)', () => {
    const screens = (readdirSync(SRC, { recursive: true }) as string[])
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => file.endsWith('.tsx') && !file.startsWith('ui/lab/'));
    const offenders = screens.filter((file) =>
      readFileSync(path.join(SRC, file), 'utf8').includes('elevation="inset'),
    );
    expect(offenders).toEqual([]);
  });

  // Only live readings that change in place use tabular figures (D82): the
  // status, the markers, the tank, the dial, the slider, timers and
  // countdowns, and `.reading` inside running text. Static lists (Acerca de,
  // the plant's facts, list rows' details) keep proportional figures: this
  // font's tabular set also widens the colon and the comma ("16 : 44").
  const live = [
    ['ui/ui.css', '.status-reading'],
    ['ui/ui.css', '.plant-marker-detail'],
    ['ui/ui.css', '.dock-tank'],
    ['ui/ui.css', '.menu-status'],
    ['ui/ui.css', '.reading'],
    ['ui/ui.css', '.plant-actions .primary-button'],
    ['ui/primitives/DialGauge.css', '.ui-dial-value'],
    ['ui/primitives/Slider.css', '.ui-slider-value'],
    ['ui/primitives/Button.css', '.ui-button-detail'],
  ] as const;
  const tabular = /font-variant-numeric:\s*tabular-nums/;
  const rulesOf = (file: string) => blocks(sheets.find((sheet) => sheet.file === file)?.css ?? '');

  it.each(live)('%s: %s, a live reading, uses tabular figures (D82)', (file, selector) => {
    const rule = rulesOf(file).find((block) => block.selector === selector);
    expect(rule?.body).toMatch(tabular);
  });

  it('nothing else uses tabular figures', () => {
    const allowed = new Set(live.map(([file, selector]) => `${file} ${selector}`));
    const extra = sheets.flatMap(({ file, css }) =>
      blocks(css)
        .filter((block) => tabular.test(block.body))
        .map((block) => `${file} ${block.selector}`)
        .filter((key) => !allowed.has(key)),
    );
    expect(extra).toEqual([]);
  });
});
