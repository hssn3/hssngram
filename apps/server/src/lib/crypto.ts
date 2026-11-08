import { randomBytes, createHash, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';
import crypto from 'node:crypto';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const SCRYPT_COST = 16384;
const SCRYPT_BLOCK = 8;
const SCRYPT_PARALLEL = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK,
    p: SCRYPT_PARALLEL,
  });

  return [
    'scrypt',
    SCRYPT_COST,
    SCRYPT_BLOCK,
    SCRYPT_PARALLEL,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, cost, block, parallel, saltPart, keyPart] = parts;
  const salt = Buffer.from(saltPart!, 'base64url');
  const expected = Buffer.from(keyPart!, 'base64url');

  const actual = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
    N: Number(cost),
    r: Number(block),
    p: Number(parallel),
  });

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomUUID(): string {
  return crypto.randomUUID();
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomCode(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Short-lived HMAC credentials for coturn (`use-auth-secret`).
 * username = "<expiry-timestamp>:<userId>", password = base64(hmac-sha1(secret, username)).
 */
export function turnCredentials(
  userId: string,
  secret: string,
  ttlSeconds: number,
): { username: string; credential: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiresAt}:${userId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiresAt };
}
