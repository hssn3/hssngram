import { Router, raw } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { parse } from '../validate.js';
import { badRequest, notFound } from '../../lib/errors.js';
import {
  getUserById,
  searchUsers,
  toPublicUser,
  updateProfile,
} from '../../services/users.js';
import { isImageMime, mimeFromKey } from '../../lib/mime.js';
import { extensionFor } from '../../lib/http-tokens.js';
import { storage } from '../../storage/index.js';
import { env } from '../../env.js';

const profileSchema = z.object({
  displayName: z.string().min(2).max(64).optional(),
  bio: z.string().max(280).optional(),
});

export function userRoutes(): Router {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const { userId } = currentUser(req);
    const user = await getUserById(userId);
    if (!user) throw notFound('کاربر پیدا نشد');
    res.json({ user: toPublicUser(user) });
  });

  router.get('/search', async (req, res) => {
    const { userId } = currentUser(req);
    const term = String(req.query.q ?? '');
    const users = await searchUsers(term, userId, 20);
    res.json({ users });
  });

  router.get('/:id', async (req, res) => {
    const user = await getUserById(String(req.params.id));
    if (!user) throw notFound('کاربر پیدا نشد');
    res.json({ user: toPublicUser(user) });
  });

  router.patch('/', async (req, res) => {
    const { userId } = currentUser(req);
    const body = parse(profileSchema, req.body);
    const user = await updateProfile(userId, body);
    res.json({ user: toPublicUser(user) });
  });

  router.post(
    '/avatar',
    raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: '6mb' }),
    async (req, res) => {
      const { userId } = currentUser(req);
      const mime = String(req.headers['content-type'] ?? '');
      if (!isImageMime(mime)) throw badRequest('فقط تصویر JPEG/PNG/WebP مجاز است');
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length < 64) throw badRequest('تصویر نامعتبر است');

      const current = await getUserById(userId);
      if (!current) throw notFound('کاربر پیدا نشد');

      const key = `avatars/${userId}/${randomUUID()}.${extensionFor(mime, 'jpg')}`;
      await storage().putObject(key, body, mime);
      const user = await updateProfile(userId, { avatarKey: key });

      if (current.avatar_key) void storage().remove(current.avatar_key);

      res.json({ user: toPublicUser(user) });
    },
  );

  router.delete('/avatar', async (req, res) => {
    const { userId } = currentUser(req);
    const current = await getUserById(userId);
    if (!current) throw notFound('کاربر پیدا نشد');
    if (current.avatar_key) void storage().remove(current.avatar_key);
    const user = await updateProfile(userId, { avatarKey: null });
    res.json({ user: toPublicUser(user) });
  });

  return router;
}

export function avatarRoutes(): Router {
  const router = Router();

  router.get('/:userId', async (req, res) => {
    const user = await getUserById(String(req.params.userId));
    if (!user?.avatar_key) throw notFound('تصویری وجود ندارد');

    const remote = await storage().downloadUrl(user.avatar_key, 3600);
    res.setHeader('cache-control', 'public, max-age=3600');
    if (remote) {
      res.redirect(302, remote);
      return;
    }

    const stream = await storage().openLocal(user.avatar_key);
    res.setHeader('content-type', mimeFromKey(user.avatar_key));
    res.setHeader('x-content-type-options', 'nosniff');
    stream.pipe(res);
  });

  return router;
}

export const maxAvatarBytes = env.MAX_UPLOAD_MB;
