import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './http/app.js';
import { initRealtime } from './realtime/index.js';
import { runMigrations } from './db/migrate.js';
import { closePool } from './db/pool.js';
import { env } from './env.js';
import { publishDueMessages, purgeExpiredMessages } from './services/feature-extras.js';

const app = createApp();
const server = createServer(app);

const io = new Server(server, {
  path: '/socket.io',
  serveClient: false,
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 1_000_000,
  cors: {
    origin: true,
    credentials: true,
  },
});

initRealtime(io);

if (env.MIGRATE_ON_START) {
  try {
    const applied = await runMigrations(false);
    if (applied.length > 0) console.log(`[migrate] applied: ${applied.join(', ')}`);
  } catch (error) {
    console.error('[migrate] failed at startup', error);
    process.exit(1);
  }
}

server.listen(env.PORT, () => {
  console.log(`[hssngram] listening on http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
});

// Scheduled messages and TTL cleanup. Both are idempotent, so running on every
// instance is safe: the publish path locks each row before assigning a seq.
void publishDueMessages().catch((error) => console.error('[scheduler] publish failed', error));
setInterval(() => {
  void publishDueMessages().catch((error) => console.error('[scheduler] publish failed', error));
}, 15_000).unref();

setInterval(() => {
  void purgeExpiredMessages().catch((error) => console.error('[scheduler] purge failed', error));
}, 60_000).unref();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[hssngram] ${signal} received, shutting down`);

  io.close();
  server.close(() => {
    void closePool().finally(() => process.exit(0));
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
