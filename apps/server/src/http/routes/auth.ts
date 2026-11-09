import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { parse } from '../validate.js';
import {
  changeOwnPassword,
  listSessions,
  login,
  logout,
  refresh,
  refreshCookieName,
  refreshCookieOptions,
  register,
  revokeSession,
} from '../../services/auth.js';
import { getUserById, toPublicUser } from '../../services/users.js';
import { query } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';

const registerSchema = z.object({
  loginId: z.string().trim().regex(/^\d{8}$/, 'شناسه باید ۸ رقم باشد').optional(),
  username: z.string().trim().max(32).optional(),
  displayName: z.string().min(2).max(64),
  password: z.string().min(6).max(200),
  inviteCode: z.string().max(32).optional(),
});

const loginSchema = z.object({
  loginId: z.string().trim().min(1).max(64).optional(),
  username: z.string().trim().min(1).max(64).optional(),
  password: z.string().min(1).max(200),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(6).max(200),
});

export function authRoutes(): Router {
  const router = Router();

  const meta = (req: { headers: Record<string, unknown>; ip?: string }) => ({
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    ip: String(req.ip ?? ''),
  });

  router.post(
    '/register',
    rateLimit({ windowMs: 10 * 60_000, max: 20, scope: 'register' }),
    async (req, res) => {
      const body = parse(registerSchema, req.body);
      const result = await register({
        username: body.loginId ?? body.username ?? '',
        displayName: body.displayName,
        password: body.password,
        inviteCode: body.inviteCode,
        ...meta(req),
      });

      if (result.status === 'pending') {
        res.status(202).json({ status: 'pending', user: result.user });
        return;
      }

      res.cookie(refreshCookieName, result.refreshToken, refreshCookieOptions);
      res.status(201).json({ accessToken: result.accessToken, user: result.user });
    },
  );

  router.post(
    '/login',
    rateLimit({ windowMs: 5 * 60_000, max: 30, scope: 'login' }),
    async (req, res) => {
      const body = parse(loginSchema, req.body);
      const result = await login({
        username: body.loginId ?? body.username ?? '',
        password: body.password,
        ...meta(req),
      });
      res.cookie(refreshCookieName, result.refreshToken, refreshCookieOptions);
      res.json({ accessToken: result.accessToken, user: result.user });
    },
  );

  router.post('/refresh', async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[refreshCookieName];
    const result = await refresh(token, meta(req));
    res.cookie(refreshCookieName, result.refreshToken, refreshCookieOptions);
    res.json({ accessToken: result.accessToken, user: result.user });
  });

  router.post('/logout', async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[refreshCookieName];
    await logout(token);
    res.clearCookie(refreshCookieName, { path: refreshCookieOptions.path });
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    const user = await getUserById(userId);
    if (!user) throw notFound('کاربر پیدا نشد');
    res.json({ user: toPublicUser(user) });
  });

  router.post('/change-password', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    const body = parse(passwordSchema, req.body);
    await changeOwnPassword(userId, body.currentPassword, body.newPassword);
    res.clearCookie(refreshCookieName, { path: refreshCookieOptions.path });
    res.json({ ok: true });
  });

  router.get('/sessions', requireAuth, async (req, res) => {
    const { userId, sessionId } = currentUser(req);
    const sessions = await listSessions(userId);
    res.json({
      sessions: sessions.map((session) => ({ ...session, current: session.id === sessionId })),
    });
  });

  router.delete('/sessions', requireAuth, async (req, res) => {
    const { userId, sessionId } = currentUser(req);
    await query(
      'update sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null',
      [userId, sessionId],
    );
    res.json({ ok: true });
  });

  router.delete('/sessions/:id', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    await revokeSession(userId, String(req.params.id));
    res.json({ ok: true });
  });

  return router;
}

