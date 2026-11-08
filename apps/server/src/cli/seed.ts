import { hashPassword } from '../lib/crypto.js';
import { query, queryOne, closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

const loginId = process.env.ADMIN_LOGIN_ID ?? '10000000';
const password = process.env.ADMIN_PASSWORD ?? '427726';
const displayName = process.env.ADMIN_DISPLAY_NAME ?? 'حسن';

async function main(): Promise<void> {
  await runMigrations();

  const passwordHash = await hashPassword(password);
  const existing = await queryOne<{ id: string }>('select id from users where username = $1', [
    loginId,
  ]);

  if (existing) {
    await query(
      `update users
       set password_hash = $2, is_admin = true, status = 'active', display_name = coalesce(nullif(display_name, ''), $3)
       where id = $1`,
      [existing.id, passwordHash, displayName],
    );
    console.log(`[seed] admin ${loginId} updated (password reset)`);
  } else {
    await query(
      `insert into users (username, display_name, password_hash, is_admin, status)
       values ($1, $2, $3, true, 'active')`,
      [loginId, displayName, passwordHash],
    );
    console.log(`[seed] admin ${loginId} created`);
  }

  console.log(`[seed] login id: ${loginId}`);
  console.log(`[seed] password: ${password}`);
}

try {
  await main();
} catch (error) {
  console.error('[seed] failed:', error);
  process.exitCode = 1;
} finally {
  await closePool();
}
