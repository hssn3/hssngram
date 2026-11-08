import type { Readable } from 'node:stream';

export type UploadTarget = {
  url: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
};

export type ObjectStat = {
  size: number;
  contentType: string | null;
};

export interface ObjectStorage {
  readonly kind: 'local' | 's3';
  /** Where the browser must upload the bytes, and with which headers. */
  uploadTarget(key: string, mime: string, expiresIn?: number): Promise<UploadTarget>;
  stat(key: string): Promise<ObjectStat | null>;
  remove(key: string): Promise<void>;
  /** Persist a stream we received ourselves (local driver only). */
  saveStream(key: string, stream: Readable, limitBytes: number, mime: string): Promise<number>;
  /** Persist a small buffer (avatars, thumbnails). */
  putObject(key: string, body: Buffer, mime: string): Promise<void>;
  /** Read our own copy (local driver only). */
  openLocal(key: string): Promise<Readable>;
  /** A browser-usable temporary URL, or null when local (use /api/media). */
  downloadUrl(key: string, expiresIn?: number): Promise<string | null>;
}
