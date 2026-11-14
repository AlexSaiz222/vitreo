// A backup of the Docker hub now (docs/05): the database copied into
// data/hub/backups/ (today's file, replaced), the journal's photos with it,
// and the result checked. Handy before touching anything; the nightly one
// runs on its own.
//   pnpm hub:backup
// The hub only takes this from inside its own container, so it is asked there.
import { spawnSync } from 'node:child_process';

const ask = `fetch('http://127.0.0.1:8787/api/v1/backup', { method: 'POST' })
  .then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); })
  .catch((e) => { console.error(e.message); process.exit(1); })`;
const result = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'infra/docker-compose.yml',
    'exec',
    '-T',
    'hub',
    'node',
    '-e',
    ask,
  ],
  { encoding: 'utf8' },
);
if (result.status !== 0) {
  console.error(
    result.stderr || result.stdout || 'the hub did not answer: is it running? (pnpm status)',
  );
  process.exit(1);
}
const report = JSON.parse(result.stdout);
console.log(`Backup ${report.file} in data/hub/backups/.`);
console.log(
  `Photos: ${report.copied.toString()} copied, ${report.removed.toString()} removed; the backup refers to ${report.photos.toString()}, ${report.missing === 0 ? 'all there' : `${report.missing.toString()} MISSING`}.`,
);
process.exit(report.missing === 0 ? 0 : 1);
