import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

const COLOR_TOKENS = [
  '--bg',
  '--ink',
  '--ink-soft',
  '--line',
  '--accent',
  '--warm',
  '--focus',
  '--water',
  '--water-ink',
] as const;

type Rgba = [r: number, g: number, b: number, a: number];

/** Custom property declarations of the first block that starts with `selector {`. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No block for ${selector}`);
  const end = css.indexOf('}', start);
  const body = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) declarations.set(name, value.trim());
  }
  return declarations;
}

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
  if (rgb) {
    const [, r, g, b, a] = rgb.map(Number);
    if (r !== undefined && g !== undefined && b !== undefined && a !== undefined) {
      return [r, g, b, a];
    }
  }
  throw new Error(`Unsupported colour ${value}`);
}

function luminance([r, g, b]: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const day = block(':root');
const night = block(":root[data-theme='night']");

/** Splits on commas that are not inside parentheses. */
function topLevelArgs(value: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else current += char;
  }
  args.push(current.trim());
  return args;
}

/**
 * Resolves a colour token as the browser would on <html>: `var()` (the night
 * block inherits what it does not override) and `color-mix(in srgb, …)`.
 */
function resolve(theme: Map<string, string>, value: string): Rgba {
  const v = value.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref?.[1]) return resolve(theme, theme.get(ref[1]) ?? day.get(ref[1]) ?? '');
  const mix = /^color-mix\(in srgb,\s*(.*)\)$/.exec(v);
  if (mix?.[1]) {
    const [first = '', second = ''] = topLevelArgs(mix[1]);
    const part = (arg: string) => {
      const m = /^(.*?)\s+([\d.]+)%$/.exec(arg);
      return m?.[1] && m[2]
        ? { color: m[1], weight: Number(m[2]) / 100 }
        : { color: arg, weight: null };
    };
    const a = part(first);
    const b = part(second);
    const wa = a.weight ?? 1 - (b.weight ?? 0.5);
    const ca = resolve(theme, a.color);
    const cb = resolve(theme, b.color);
    return ca.map((channel, i) => channel * wa + (cb[i] ?? 0) * (1 - wa)) as Rgba;
  }
  if (v === 'transparent') return [0, 0, 0, 0];
  return parseColor(v);
}

describe('design tokens', () => {
  it.each(COLOR_TOKENS)('defines %s for day and night', (token) => {
    expect(day.get(token)).toBeDefined();
    expect(night.get(token)).toBeDefined();
  });

  it('matches the day palette in docs/03-diseno-ui.md', () => {
    expect(day.get('--bg')).toBe('#faf9f6');
    expect(day.get('--accent')).toBe('#5e8c58');
  });

  it('follows the real sun, not the OS preference (P11)', () => {
    expect(css).not.toContain('prefers-color-scheme');
  });

  it('defines no red', () => {
    for (const theme of [day, night]) {
      for (const token of COLOR_TOKENS) {
        const [r, g, b] = parseColor(theme.get(token) ?? '');
        const isRed = r > 150 && r - Math.max(g, b) > 100;
        expect(isRed, `${token} looks red`).toBe(false);
      }
    }
  });

  describe.each([
    ['day', day],
    ['night', night],
  ])('contrast (%s)', (_name, theme) => {
    const color = (token: string) => parseColor(theme.get(token) ?? '');
    const bg = color('--bg');

    it.each(['--ink', '--ink-soft'])('%s meets WCAG AA on the background', (token) => {
      expect(contrast(color(token), bg)).toBeGreaterThanOrEqual(4.5);
    });

    it('focus ring meets the 3:1 non-text minimum', () => {
      expect(contrast(color('--focus'), bg)).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('neumorphic material (D72)', () => {
  it.each(['--neu-base', '--neu-light', '--neu-dark'])('%s is redefined at night', (token) => {
    expect(day.get(token)).toBeDefined();
    expect(night.get(token)).toBeDefined();
  });

  it('uses no backdrop blur', () => {
    expect(css).not.toContain('backdrop-filter');
  });

  describe.each([
    ['day', day],
    ['night', night],
  ])('%s', (_name, theme) => {
    const color = (token: string) => resolve(theme, `var(${token})`);
    const base = color('--neu-base');

    it('lights from the top left: highlight above the base, shadow below it', () => {
      expect(luminance(color('--neu-light'))).toBeGreaterThan(luminance(base));
      expect(luminance(color('--neu-dark'))).toBeLessThan(luminance(base));
    });

    it.each(['--ink', '--ink-soft', '--warm-ink', '--water-ink'])(
      '%s text meets WCAG AA on the base, with a margin for rounding',
      (token) => {
        // axe rounds differently: 4.50 here failed there. Keep 0.1 spare.
        expect(contrast(color(token), base)).toBeGreaterThanOrEqual(4.6);
      },
    );

    it('the main action (--water-ink on --primary-fill) meets WCAG AA (D81)', () => {
      expect(contrast(color('--water-ink'), color('--primary-fill'))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(['--accent', '--warm-ink', '--focus'])(
      '%s marks meet the 3:1 non-text minimum on the base',
      (token) => {
        expect(contrast(color(token), base)).toBeGreaterThanOrEqual(3);
      },
    );
  });
});

describe('scene palette', () => {
  // docs/02-direccion-artistica.md, "Paleta de la escena" (from ref-03).
  const expected: Record<string, string> = {
    '--scene-frame': '#f1ece3',
    '--scene-plinth': '#edd5b8',
    '--scene-tray': '#cbaa87',
    '--scene-path': '#e6ceb1',
    '--scene-glass': '#dcebea',
    '--scene-terracotta': '#bb7547',
    '--scene-terracotta-shade': '#a86c43',
    '--scene-soil-dry': '#b39a7c',
    '--scene-soil-wet': '#3a281e',
    '--scene-leaf-light': '#abac68',
    '--scene-leaf-mid': '#849050',
    '--scene-leaf-deep': '#687a3f',
    '--scene-flower-pink': '#e7a6a1',
    '--scene-flower-cream': '#f3e3b0',
    '--scene-leaf-new': '#97a05a',
    '--scene-flower-white': '#f7f2e8',
    '--scene-flower-heart': '#e6c97a',
    '--scene-fruit': '#c4604f',
    '--scene-fruit-green': '#a3ad66',
    '--scene-flower-chives': '#c4a6c8',
    '--scene-stake': '#c8b38c',
    '--scene-device': '#f1ede6',
    '--scene-device-dark': '#9a948c',
    '--scene-fan-back': '#bdb6ac',
    '--scene-fan-blade': '#d3ccc2',
    '--scene-hardware': '#d6cfc4',
    '--scene-gasket': '#a39d95',
    '--scene-water': '#9cc9c4',
    '--scene-led': '#9bc38e',
    '--scene-light-strip': '#fff3df',
    '--scene-decor': '#ffffff',
    '--scene-night-glow': '#ffd9a8',
    '--scene-night-bg': '#161a22',
    '--scene-sun': '#ffe2bf',
    '--scene-moon': '#9fb0d0',
    '--scene-shadow': '#9c8670',
    '--scene-sky': '#f4ece1',
  };

  it.each(Object.entries(expected))('%s matches the art direction', (token, value) => {
    expect(day.get(token)).toBe(value);
  });

  it('is the same palette that docs/02 documents', () => {
    const docs = readFileSync(
      new URL('../../../../docs/02-direccion-artistica.md', import.meta.url),
      'utf8',
    ).toLowerCase();
    for (const value of Object.values(expected)) expect(docs).toContain(`\`${value}\``);
  });

  it('matches the night background with the UI night background', () => {
    expect(day.get('--scene-night-bg')).toBe(night.get('--bg'));
  });
});

describe('the scene blends between the two pages (A9)', () => {
  it('has the day and night page colours as scene tokens, equal to --bg in each theme', () => {
    const day = block(':root');
    const night = block(":root[data-theme='night']");
    expect(day.get('--scene-day-bg')).toBe(day.get('--bg'));
    expect(day.get('--scene-night-bg')).toBe(night.get('--bg'));
  });
});
