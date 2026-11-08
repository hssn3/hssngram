import type { RequestHandler } from 'express';
import { tooMany } from '../../lib/errors.js';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 60_000);
cleanup.unref?.();

export function rateLimit(options: {
  windowMs: number;
  max: number;
  scope: string;
  byUser?: boolean;
}): RequestHandler {
  return (req, res, next) => {
    const user = (req as { auth?: { userId: string } }).auth?.userId;
    const identity = options.byUser && user ? `u:${user}` : `ip:${req.ip ?? 'unknown'}`;
    const key = `${options.scope}:${identity}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(options.max - bucket.count, 0);
    res.setHeader('x-ratelimit-limit', String(options.max));
    res.setHeader('x-ratelimit-remaining', String(remaining));
    res.setHeader('x-ratelimit-reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      res.setHeader('retry-after', String(Math.ceil((bucket.resetAt - now) / 1000)));
      next(tooMany());
      return;
    }

    next();
  };
}

export function resetRateLimits(): void {
  buckets.clear();
}
