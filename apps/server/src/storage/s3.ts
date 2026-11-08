import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { env } from '../env.js';
import type { ObjectStat, ObjectStorage, UploadTarget } from './types.js';

export class S3Storage implements ObjectStorage {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
      throw new Error('S3 storage selected but S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY are missing');
    }

    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }

  async uploadTarget(key: string, mime: string, expiresIn = 900): Promise<UploadTarget> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mime,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn });
    return { url, method: 'PUT', headers: { 'content-type': mime } };
  }

  async stat(key: string): Promise<ObjectStat | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: Number(result.ContentLength ?? 0), contentType: result.ContentType ?? null };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch(() => undefined);
  }

  async saveStream(): Promise<number> {
    throw new Error('saveStream is only supported by the local storage driver');
  }

  async openLocal(): Promise<Readable> {
    throw new Error('openLocal is only supported by the local storage driver');
  }

  async putObject(key: string, body: Buffer, mime: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mime,
      }),
    );
  }

  async downloadUrl(key: string, expiresIn = 900): Promise<string | null> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }
}
