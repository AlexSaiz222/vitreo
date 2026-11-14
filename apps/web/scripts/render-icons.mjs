// Renders the PWA icons from public/icon.svg with the installed Chrome.
// Run from apps/web: `node scripts/render-icons.mjs`.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const svg = readFileSync(path.join(root, 'public/icon.svg'), 'utf8');

const icons = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  // The artwork already sits inside the safe zone, so it doubles as maskable.
  { file: 'icon-maskable-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
for (const { file, size } of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: path.join(root, 'public/icons', file) });
  console.info(`public/icons/${file}`);
}
await browser.close();
