import { z } from 'zod';

try {
  // Node >= 20.12 can load a .env file without any dependency.
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return fallback;
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z
    .string()
    .default('postgres://hssngram:hssngram@localhost:5432/hssngram'),
  PUBLIC_URL: z.string().default('http://localhost:8080'),
  TRUST_PROXY: bool(true),

  JWT_SECRET: z.string().min(16).default('dev-secret-change-me-before-deploying'),
  ACCESS_TOKEN_TTL: z.string().default('20m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(60),

  REGISTRATION_MODE: z.enum(['invite', 'open', 'closed']).default('open'),
  REQUIRE_APPROVAL: bool(true),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./data/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(200),
  S3_ENDPOINT: z.string().default('https://s3.ir-thr-at1.arvanstorage.ir'),
  S3_REGION: z.string().default('ir-thr-at1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(true),

  TURN_URLS: z.string().default(''),
  TURN_SECRET: z.string().optional(),
  TURN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  MAX_CALL_PARTICIPANTS: z.coerce.number().int().positive().max(20).default(4),
  STUN_URLS: z
    .string()
    .default('stun:stun.arvancloud.ir:3478,stun:stun.l.google.com:19302'),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@hssngram.local'),

  WEB_DIST: z.string().default('../web/dist'),
  MIGRATE_ON_START: bool(true),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const uploadLimitBytes = Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024);
