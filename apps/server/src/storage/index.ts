import { env } from '../env.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';
import type { ObjectStorage } from './types.js';

let instance: ObjectStorage | null = null;

export function storage(): ObjectStorage {
  if (!instance) {
    instance =
      env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
  }
  return instance;
}

export type { ObjectStorage, UploadTarget, ObjectStat } from './types.js';
