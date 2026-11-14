// Interface fonts (P08 → D82): Young Serif (display) + Schibsted Grotesk
// (text), cut down to what the HUD uses. Run with `pnpm fonts`.
//
//   1. Subset to Latin + Spanish: ASCII, Latin-1 (á é í ó ú ü ñ ¿ ¡ º ª °
//      · and the no-break space Intl puts before %), dashes, quotes, the
//      ellipsis, the euro sign, → and the minus sign.
//   2. Only the styles in use: Young Serif 400; Schibsted Grotesk upright
//      with its weight axis limited to 400–500 (--weight-regular and
//      --weight-medium) and italic pinned to 400 (Latin plant names).
//   3. woff2 in apps/web/public/fonts/ (fixed names: index.html preloads
//      them; the service worker precaches them).
//   4. Metric-matched fallbacks (size-adjust and ascent/descent/line-gap
//      overrides on local Georgia, Roboto and Arial), so the text keeps its
//      place while the web fonts load: written to src/styles/fonts.css.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import * as fontkit from 'fontkit';
import subsetFont from 'subset-font';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WEB = path.join(ROOT, 'apps/web');
const OUT = path.join(WEB, 'public/fonts');
const CSS = path.join(WEB, 'src/styles/fonts.css');
const modules = (pkg) => path.join(WEB, 'node_modules', pkg, 'files');

const RANGES = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x2013, 0x2014],
  [0x2018, 0x2019],
  [0x201c, 0x201e],
  [0x2022, 0x2022],
  [0x2026, 0x2026],
  [0x202f, 0x202f],
  [0x20ac, 0x20ac],
  [0x2192, 0x2192],
  [0x2212, 0x2212],
];
const TEXT = RANGES.flatMap(([from, to]) =>
  Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)),
).join('');

/** A sentence like the HUD's, for the average character width. */
const SAMPLE =
  'La albahaca tiene sed. Riego automático: cuando baje del 35 %. Último dato a las 14:10. ' +
  'Perejil, lechuga, fresa, cebollino y tomate cherry. ¿Regar ahora? Sin conexión con el invernadero.';

/**
 * Metrics of the local fallbacks (unitsPerEm, ascent, descent, lineGap and
 * the average advance over SAMPLE), measured once from the font files:
 * Windows' arial.ttf and georgia.ttf, and Roboto (as on Android).
 */
const FALLBACKS = {
  Georgia: { upm: 2048, ascent: 1878, descent: -449, lineGap: 0, avg: 894.6 },
  Roboto: { upm: 2048, ascent: 1900, descent: -500, lineGap: 0, avg: 899.13 },
  Arial: { upm: 2048, ascent: 1854, descent: -434, lineGap: 67, avg: 913.83 },
};

const FACES = [
  {
    family: 'Young Serif',
    file: 'young-serif-400.woff2',
    source: path.join(modules('@fontsource/young-serif'), 'young-serif-latin-400-normal.woff2'),
    weight: '400',
    style: 'normal',
    fallbacks: ['Georgia'],
  },
  {
    family: 'Schibsted Grotesk',
    file: 'schibsted-grotesk.woff2',
    source: path.join(
      modules('@fontsource-variable/schibsted-grotesk'),
      'schibsted-grotesk-latin-wght-normal.woff2',
    ),
    axes: { wght: { min: 400, max: 500 } },
    weight: '400 500',
    style: 'normal',
    fallbacks: ['Roboto', 'Arial'],
  },
  {
    family: 'Schibsted Grotesk',
    file: 'schibsted-grotesk-italic.woff2',
    source: path.join(
      modules('@fontsource-variable/schibsted-grotesk'),
      'schibsted-grotesk-latin-wght-italic.woff2',
    ),
    axes: { wght: 400 },
    weight: '400',
    style: 'italic',
  },
];

function metrics(buffer) {
  const font = fontkit.create(buffer);
  let width = 0;
  let count = 0;
  for (const char of SAMPLE) {
    const glyph = font.glyphForCodePoint(char.codePointAt(0));
    width += glyph.advanceWidth;
    count += 1;
  }
  return {
    upm: font.unitsPerEm,
    ascent: font.ascent,
    descent: font.descent,
    lineGap: font.lineGap,
    avg: width / count,
  };
}

const percent = (value) => `${(value * 100).toFixed(2)}%`;

/** A local font scaled and re-metred to take the web font's place. */
function fallbackFace(family, target, local) {
  const fallback = FALLBACKS[local];
  const sizeAdjust = target.avg / target.upm / (fallback.avg / fallback.upm);
  return `@font-face {
  font-family: '${family} fallback ${local}';
  src: local('${local}');
  size-adjust: ${percent(sizeAdjust)};
  ascent-override: ${percent(target.ascent / target.upm / sizeAdjust)};
  descent-override: ${percent(Math.abs(target.descent) / target.upm / sizeAdjust)};
  line-gap-override: ${percent(target.lineGap / target.upm / sizeAdjust)};
}`;
}

mkdirSync(OUT, { recursive: true });
const rules = [];
let total = 0;
for (const face of FACES) {
  const source = readFileSync(face.source);
  const subset = await subsetFont(source, TEXT, {
    targetFormat: 'woff2',
    ...(face.axes ? { variationAxes: face.axes } : {}),
  });
  writeFileSync(path.join(OUT, face.file), subset);
  const size = statSync(path.join(OUT, face.file)).size;
  total += size;
  console.log(`✓ ${face.file}: ${(size / 1024).toFixed(1)} KB`);
  rules.push(`@font-face {
  font-family: '${face.family}';
  src: url('/fonts/${face.file}') format('woff2');
  font-weight: ${face.weight};
  font-style: ${face.style};
  font-display: swap;
  unicode-range: ${RANGES.map(([from, to]) =>
    from === to
      ? `U+${from.toString(16).toUpperCase().padStart(4, '0')}`
      : `U+${from.toString(16).toUpperCase().padStart(4, '0')}-${to.toString(16).toUpperCase().padStart(4, '0')}`,
  ).join(', ')};
}`);
  for (const local of face.fallbacks ?? []) {
    rules.push(fallbackFace(face.family, metrics(source), local));
  }
}

writeFileSync(
  CSS,
  `/* Generated by \`pnpm fonts\` (assets/scripts/subset-fonts.mjs): do not edit.
   Young Serif (display) and Schibsted Grotesk (text), D82. */

${rules.join('\n\n')}
`,
);
console.log(`\nFonts: ${(total / 1024).toFixed(1)} KB in ${FACES.length.toString()} files`);
