import { existsSync } from 'node:fs';
import path from 'node:path';

import { listBackups, restoreBackup } from '../backup.ts';
import { loadConfig } from '../config.ts';
import { loadRootEnv } from '../env.ts';
import { restorePhotos } from '../journal.ts';

/**
 * Restores the hub's database from a backup (docs/05, "Restaurar"):
 *   tsx src/cli/restore.ts [hub-YYYY-MM-DD.sqlite]
 * Without a name, lists the backups. The hub must be stopped (the database is
 * locked while it runs). `pnpm hub:restore` does this for the Docker hub.
 */
loadRootEnv();
const config = loadConfig();
const wanted = process.argv[2];
const backups = listBackups(config.backupDir);

if (!wanted) {
  console.log(`Backups in ${config.backupDir}:`);
  for (const backup of backups) {
    console.log(`  ${path.basename(backup.file)}  ${(backup.bytes / 1024).toFixed(0)} KB`);
  }
  if (backups.length === 0) console.log('  (none yet)');
  process.exit(0);
}

const file = existsSync(wanted) ? wanted : path.join(config.backupDir, path.basename(wanted));
try {
  const replaced = restoreBackup(file, config.database, config.backupDir);
  console.log(`Restored ${path.basename(file)} into ${config.database}.`);
  // The journal's photos it refers to (A8), from the nightly mirror.
  const photos = restorePhotos(config.backupDir, config.photoDir);
  if (photos > 0) console.log(`${photos.toString()} photo(s) brought back from the backup.`);
  if (replaced) console.log(`The database it replaced is kept as ${path.basename(replaced)}.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    message.includes('locked')
      ? 'The hub is running: stop it first (pnpm hub:restore does it for the Docker hub).'
      : `Not restored: ${message}`,
  );
  process.exit(1);
}
