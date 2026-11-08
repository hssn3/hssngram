import { createHmac } from 'node:crypto';
import { env } from '../env.js';
import { timingSafeStringEqual } from './crypto.js';

/** Short-lived signed token so <img>/<video> can load protected media without headers. */
export function signMediaToken(id: string, ttlSeconds = 6 * 60 * 60): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = createHmac('sha256', env.JWT_SECRET)
    .update(`${id}:${expires}`)
    .digest('base64url');
  return `${expires}.${signature}`;
}

export function verifyMediaToken(id: string, token: string | undefined): boolean {
  if (!token) return false;
  const [expiresPart, signature] = token.split('.');
  if (!expiresPart || !signature) return false;

  const expires = Number(expiresPart);
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false;

  const expected = createHmac('sha256', env.JWT_SECRET)
    .update(`${id}:${expires}`)
    .digest('base64url');

  return timingSafeStringEqual(expected, signature);
}

export function extensionFor(mime: string, fallback = 'bin'): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
  };
  return map[mime] ?? fallback;
}

export function kindForMime(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}
