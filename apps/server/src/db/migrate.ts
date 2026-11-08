import { pool, query } from './pool.js';
import { migrations } from './migrations.js';

const LOCK_ID = 918_273_645;

export async function runMigrations(log = true): Promise<string[]> {
  const applied: string[] = [];
  const client = await pool.connect();

  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows } = await client.query<{ id: string }>('select id from schema_migrations');
    const done = new Set(rows.map((row) => row.id));

    for (const migration of migrations) {
      if (done.has(migration.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('insert into schema_migrations (id) values ($1)', [migration.id]);
        await client.query('COMMIT');
        applied.push(migration.id);
        if (log) console.log(`[migrate] applied ${migration.id}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.id} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }

    if (log && applied.length === 0) console.log('[migrate] database is up to date');
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }

  return applied;
}

export async function tableExists(name: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    'select exists(select 1 from information_schema.tables where table_name = $1) as exists',
    [name],
  );
  return Boolean(rows[0]?.exists);
}
