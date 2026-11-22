import { loadConfig } from '../config.js';
import { restoreBackup } from '../db/backup.js';

/** `npm run restore -- <backup folder>`: put a backup back while Lgbids is stopped. */
const dir = process.argv[2];
if (!dir) {
  console.error('Name the backup folder to restore, for example: npm run restore -- data/backups/20261122T101500Z');
  process.exit(1);
}
try {
  const aside = restoreBackup(loadConfig(process.env).dataDir, dir);
  console.log(`Restored ${dir}. What was there before is kept in ${aside}.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
