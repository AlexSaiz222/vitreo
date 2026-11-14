// Vitreo 3D pipeline, step 1 of 3 (docs/04, "Exportar y optimizar"):
//   assets/blender/vitreo.blend  →  assets/export/vitreo.glb
//
// Runs Blender without a window with assets/blender/scripts/export_vitreo.py
// (the export settings of docs/04). Nothing is saved to the .blend. Then run
// `pnpm models`.
//
// Blender is looked for in $BLENDER, then in the usual install folders, then
// on the PATH.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BLEND = path.join(ROOT, 'assets/blender/vitreo.blend');
const SCRIPT = path.join(ROOT, 'assets/blender/scripts/export_vitreo.py');

const candidates = [
  process.env['BLENDER'],
  'C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe',
  'C:/Program Files/Blender Foundation/Blender/blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
].filter(Boolean);
const blender = candidates.find((candidate) => existsSync(candidate)) ?? 'blender';

const result = spawnSync(blender, ['-b', BLEND, '--python', SCRIPT], {
  cwd: ROOT,
  encoding: 'utf8',
});
if (result.error) {
  console.error(`Blender not found (${blender}). Set BLENDER to its executable.`);
  process.exit(1);
}
// Blender is chatty: show only what the export script says, and errors.
const lines = `${result.stdout}\n${result.stderr}`.split('\n');
for (const line of lines.filter((l) => /^(!|Exported)|Error|Traceback/.test(l))) {
  console.info(line);
}
process.exit(result.status ?? 1);
