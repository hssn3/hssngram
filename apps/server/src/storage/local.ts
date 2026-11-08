import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { env } from '../env.js';
import { payloadTooLarge } from '../lib/errors.js';
import type { ObjectStat, ObjectStorage, UploadTarget } from './types.js';

const root = resolve(env.LOCAL_STORAGE_DIR);

function pathFor(key: string): string {
  // Guard against path traversal from a crafted key.
  const target = resolve(join(root, key));
  if (!target.startsWith(root)) throw new Error('invalid storage key');
  return target;
}

export class LocalStorage implements ObjectStorage {
  readonly kind = 'local' as const;

  async uploadTarget(key: string): Promise<UploadTarget> {
    return {
      url: `/api/uploads/local?key=${encodeURIComponent(key)}`,
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
    };
  }

  async stat(key: string): Promise<ObjectStat | null> {
    try {
      const info = await stat(pathFor(key));
      return { size: info.size, contentType: null };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await unlink(pathFor(key)).catch(() => undefined);
  }

  async saveStream(key: string, stream: Readable, limitBytes: number, _mime: string): Promise<number> {
    const target = pathFor(key);
    await mkdir(dirname(target), { recursive: true });

    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > limitBytes) {
          callback(payloadTooLarge());
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(stream, limiter, createWriteStream(target));
    return received;
  }

  async openLocal(key: string): Promise<Readable> {
    await stat(pathFor(key));
    return createReadStream(pathFor(key));
  }

  async putObject(key: string, body: Buffer): Promise<void> {
    const target = pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async downloadUrl(): Promise<string | null> {
    return null;
  }
}
