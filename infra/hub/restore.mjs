// Restores the Docker hub's database from a nightly backup (docs/05):
//   pnpm hub:restore                          lists the backups in data/hub/backups/
//   pnpm hub:restore hub-2026-10-08.sqlite    stops the hub, restores, starts it
// The replaced database is kept next to them as replaced-<time>.sqlite.
import { spawnSync } from 'node:child_process';

const compose = ['compose', '--env-file', '.env', '-f', 'infra/docker-compose.yml'];
const docker = (...args) => {
  const result = spawnSync('docker', [...compose, ...args], { stdio: 'inherit' });
  return result.status ?? 1;
};
const restore = ['run', '--rm', '--no-deps', 'hub', 'node_modules/.bin/tsx', 'src/cli/restore.ts'];

const backup = process.argv[2];
if (!backup) process.exit(docker(...restore));

if (docker('stop', 'hub') !== 0) process.exit(1);
const status = docker(...restore, backup);
// Started again either way: a failed restore leaves the old database in place.
docker('start', 'hub');
process.exit(status);
