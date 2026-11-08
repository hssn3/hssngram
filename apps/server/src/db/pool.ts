import pg from 'pg';
import { env } from '../env.js';

const { Pool } = pg;

// ArvanCloud managed databases terminate TLS with a self-signed chain internally;
// set PGSSL=require when the endpoint demands TLS.
const ssl =
  process.env.PGSSL === 'require'
    ? { rejectUnauthorized: false }
    : undefined;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 12),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl,
});

pool.on('error', (error) => {
  console.error('[db] idle client error', error);
});

export type Row = Record<string, unknown>;

export async function query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params as never[]);
  return result.rows as T[];
}

export async function queryOne<T = Row>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failures, the original error is what matters
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
