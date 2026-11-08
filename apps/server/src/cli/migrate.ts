import { runMigrations } from '../db/migrate.js';
import { closePool } from '../db/pool.js';

try {
  const applied = await runMigrations();
  console.log(
    applied.length > 0
      ? `[migrate] ${applied.length} migration(s) applied`
      : '[migrate] nothing to do',
  );
} catch (error) {
  console.error('[migrate] failed:', error);
  process.exitCode = 1;
} finally {
  await closePool();
}
