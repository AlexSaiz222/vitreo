// The notebook's pictures ("Cómo se hizo", D113): progress captures from
// referencias/progreso/, re-encoded as WebP for the web. Run with
// `pnpm notebook:images` after changing apps/web/src/notebook/images.json.
//
//   1. Reads the list (id, source, width it is encoded at: about twice the
//      width it is shown at, never more than the capture has; optionally a
//      crop of the source, in its pixels).
//   2. Writes apps/web/src/notebook/img/cuaderno-<id>.webp (Git LFS), with
//      no metadata, and img/sizes.json (width and height of each, so the
//      page keeps their place before they load).
//   3. Removes pictures no longer on the list.
//
// Only captures of the app and of Blender go in: never a photo of the
// journal ("ninguna foto sale de casa"). The demo's check (scripts/
// demo-check.mjs) reads the built pages as it reads the rest of the demo.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIR = path.join(ROOT, 'apps/web/src/notebook');
const OUT = path.join(DIR, 'img');
const QUALITY = 82;

const list = JSON.parse(readFileSync(path.join(DIR, 'images.json'), 'utf8'));
mkdirSync(OUT, { recursive: true });

const sizes = {};
let total = 0;
for (const { id, from, width, crop } of list) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`${id}: ids are lowercase words and dashes`);
  if (!from.startsWith('referencias/progreso/')) {
    throw new Error(`${id}: only progress captures go in the notebook`);
  }
  const file = path.join(OUT, `cuaderno-${id}.webp`);
  const source = sharp(path.join(ROOT, from));
  if (crop) source.extract(crop);
  const info = await source
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 6 })
    .toFile(file);
  sizes[id] = { width: info.width, height: info.height };
  total += info.size;
  console.log(`  ${id}: ${String(info.width)}×${String(info.height)}, ${(info.size / 1024).toFixed(0)} KiB`);
}

const kept = new Set(list.map(({ id }) => `cuaderno-${id}.webp`));
for (const name of readdirSync(OUT)) {
  if (name.endsWith('.webp') && !kept.has(name)) rmSync(path.join(OUT, name));
}
writeFileSync(path.join(OUT, 'sizes.json'), `${JSON.stringify(sizes, null, 2)}\n`);
console.log(`${String(list.length)} pictures, ${(total / 1024).toFixed(0)} KiB`);
