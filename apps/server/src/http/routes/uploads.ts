import { Router } from 'express';
import { z } from 'zod';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Response } from 'express';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { parse } from '../validate.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { completeUpload, getAttachment, initUpload } from '../../services/attachments.js';
import { storage } from '../../storage/index.js';
import { verifyMediaToken } from '../../lib/http-tokens.js';
import { mimeFromKey } from '../../lib/mime.js';
import { env } from '../../env.js';

const initSchema = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().min(3).max(120),
  size: z.number().int().positive(),
  kind: z.enum(['image', 'video', 'audio', 'voice', 'file']).optional(),
  width: z.number().int().positive().max(20000).nullish(),
  height: z.number().int().positive().max(20000).nullish(),
  duration: z.number().positive().max(24 * 3600).nullish(),
});

export function uploadRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    '/init',
    rateLimit({ windowMs: 60_000, max: 60, scope: 'upload', byUser: true }),
    async (req, res) => {
      const { userId } = currentUser(req);
      const body = parse(initSchema, req.body);
      const result = await initUpload({ ownerId: userId, ...body });
      res.status(201).json(result);
    },
  );

  router.put('/local', async (req, res) => {
    if (storage().kind !== 'local') throw badRequest('این مسیر فقط برای ذخیره‌سازی محلی است');

    const key = String(req.query.key ?? '');
    if (!key || !key.startsWith(`${currentUser(req).userId}/`)) {
      throw forbidden('کلید فایل نامعتبر است');
    }

    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared === 0) throw badRequest('حجم فایل مشخص نیست');

    const limit = env.MAX_UPLOAD_MB * 1024 * 1024;
    const written = await storage().saveStream(key, req, limit, 'application/octet-stream');
    res.json({ ok: true, size: written });
  });

  router.post('/:id/complete', async (req, res) => {
    const { userId } = currentUser(req);
    const attachment = await completeUpload(String(req.params.id), userId);
    res.json({ attachment });
  });

  return router;
}

export function mediaRoutes(): Router {
  const router = Router();

  router.get('/:id', async (req, res) => {
    const id = String(req.params.id);
    const token = typeof req.query.token === 'string' ? req.query.token : undefined;
    if (!verifyMediaToken(id, token)) throw forbidden('لینک فایل منقضی شده است');

    const attachment = await getAttachment(id);
    if (!attachment?.storage_key || attachment.status !== 'ready') throw notFound('فایل پیدا نشد');

    const filename = encodeURIComponent(attachment.name);
    const disposition = `inline; filename*=UTF-8''${filename}`;

    const remote = await storage().downloadUrl(attachment.storage_key, 3600);
    res.setHeader('cache-control', 'private, max-age=3600');
    res.setHeader('content-disposition', disposition);
    if (remote) {
      res.redirect(302, remote);
      return;
    }

    await streamLocal(
      req.headers.range,
      res,
      attachment.storage_key,
      attachment.mime,
      Number(attachment.size),
    );
  });

  return router;
}

async function streamLocal(
  range: string | undefined,
  res: Response,
  key: string,
  mime: string,
  size: number,
): Promise<void> {
  res.setHeader('content-type', mime || mimeFromKey(key));
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('x-content-type-options', 'nosniff');

  if (!range) {
    res.setHeader('content-length', String(size));
    createReadStream(localPath(key)).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    res.status(416).end();
    return;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;

  if (Number.isNaN(start) || start > end || start >= size) {
    res.setHeader('content-range', `bytes */${size}`);
    res.status(416).end();
    return;
  }

  res.status(206);
  res.setHeader('content-range', `bytes ${start}-${end}/${size}`);
  res.setHeader('content-length', String(end - start + 1));
  createReadStream(localPath(key), { start, end }).pipe(res);
}

function localPath(key: string): string {
  const root = resolve(env.LOCAL_STORAGE_DIR);
  const target = resolve(join(root, key));
  if (!target.startsWith(root)) throw forbidden('مسیر فایل نامعتبر است');
  return target;
}
