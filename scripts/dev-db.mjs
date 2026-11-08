/**
 * Local development database: real PostgreSQL semantics without installing
 * PostgreSQL (PGlite + a pg-wire socket server).
 *
 *   npm run db:dev
 *   # DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres
 *
 * Production uses a normal PostgreSQL instance (ArvanCloud managed database),
 * so the application code is identical in both cases.
 */
import { mkdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const dir = process.env.PGLITE_DIR ?? '.pgdata-pglite';
const port = Number(process.env.PGLITE_PORT ?? 55432);
const host = process.env.PGLITE_HOST ?? '127.0.0.1';

await mkdir(dir, { recursive: true });

const db = await PGlite.create({ dataDir: dir });
const server = new PGLiteSocketServer({ db, port, host, maxConnections: 20 });
await server.start();

console.log(`[db] PGlite listening on ${host}:${port} (data: ${dir})`);

async function shutdown() {
  console.log('[db] shutting down');
  await server.stop();
  await db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
