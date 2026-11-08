import type { z } from 'zod';
import { badRequest } from '../lib/errors.js';

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('داده‌های ورودی نامعتبر است', result.error.flatten());
  }
  return result.data;
}

export function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
