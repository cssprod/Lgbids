import { loadConfig } from '../config.js';
import { createBackup } from '../db/backup.js';

/** `npm run backup`: copy the database, uploads and imported alerts to DATA_DIR/backups/<stamp>/. */
try {
  const dir = createBackup(loadConfig(process.env).dataDir);
  console.log(`Backup written to ${dir}`);
  console.log('It contains your saved mail passwords and tokens, so keep it somewhere private.');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
