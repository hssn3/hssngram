import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth, currentUser } from '../middleware/auth.js';
import { parse } from '../validate.js';
import { query, queryOne } from '../../db/pool.js';
import { randomCode } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { toPublicUser, type UserRow } from '../../services/users.js';
import { hashPassword } from '../../lib/crypto.js';
import { assertDisplayName, assertPassword, assertUsername, getUserByUsername } from '../../services/users.js';
import { queryOne as one } from '../../db/pool.js';

const inviteSchema = z.object({
  note: z.string().max(120).optional(),
  maxUses: z.number().int().min(1).max(500).default(1),
  expiresInDays: z.number().int().min(0).max(365).default(30),
});

const userPatchSchema = z.object({
  status: z.enum(['pending', 'active', 'disabled']).optional(),
  isAdmin: z.boolean().optional(),
});

export function adminRoutes(): Router {
  const router = Router();
  router.use(requireAuth, requireAdmin);

  router.get('/overview', async (_req, res) => {
    const [users, pending, chats, messages] = await Promise.all([
      queryOne<{ count: string }>('select count(*)::text as count from users'),
      queryOne<{ count: string }>(
        "select count(*)::text as count from users where status = 'pending'",
      ),
      queryOne<{ count: string }>('select count(*)::text as count from chats'),
      queryOne<{ count: string }>('select count(*)::text as count from messages'),
    ]);

    res.json({
      users: Number(users?.count ?? 0),
      pending: Number(pending?.count ?? 0),
      chats: Number(chats?.count ?? 0),
      messages: Number(messages?.count ?? 0),
    });
  });

  router.get('/users', async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;

    const rows = await query<UserRow>(
      `select id, username, display_name, password_hash, bio, avatar_key,
              is_admin, status, created_at, last_seen_at, settings
       from users
       where ($1::text is null or status = $1)
       order by case status when 'pending' then 0 when 'active' then 1 else 2 end,
                created_at asc`,
      [status],
    );

    res.json({
      users: rows.map((row) => ({
        ...toPublicUser(row),
        status: row.status,
      })),
    });
  });

  router.patch('/users/:id', async (req, res) => {    const { userId: actorId } = currentUser(req);
    const targetId = String(req.params.id);
    const body = parse(userPatchSchema, req.body);

    if (targetId === actorId && body.isAdmin === false) {
      throw badRequest('نمی‌توانید دسترسی مدیریت خودتان را حذف کنید');
    }
    if (targetId === actorId && body.status && body.status !== 'active') {
      throw badRequest('نمی‌توانید حساب خودتان را غیرفعال کنید');
    }

    const target = await queryOne<UserRow>('select * from users where id = $1', [targetId]);
    if (!target) throw notFound('کاربر پیدا نشد');

    if (body.isAdmin !== undefined) {
      await query('update users set is_admin = $2 where id = $1', [targetId, body.isAdmin]);
    }

    if (body.status !== undefined) {
      await query('update users set status = $2 where id = $1', [targetId, body.status]);
      if (body.status !== 'active') {
        await query('update sessions set revoked_at = now() where user_id = $1', [targetId]);
      }
    }

    const updated = await queryOne<UserRow>('select * from users where id = $1', [targetId]);
    res.json({ user: updated ? { ...toPublicUser(updated), status: updated.status } : null });
  });

  router.delete('/users/:id', async (req, res) => {
    const { userId: actorId } = currentUser(req);
    const targetId = String(req.params.id);

    if (targetId === actorId) throw badRequest('حساب خودتان را نمی‌توانید حذف کنید');

    const target = await one<UserRow>('select * from users where id = $1', [targetId]);
    if (!target) throw notFound('کاربر پیدا نشد');

    if (target.is_admin) {
      const admins = await one<{ count: string }>(
        "select count(*)::text as count from users where is_admin = true and status = 'active'",
      );
      if (Number(admins?.count ?? 0) <= 1) {
        throw badRequest('آخرین مدیر سیستم را نمی‌توان حذف کرد');
      }
    }

    await query('delete from sessions where user_id = $1', [targetId]);
    await query('delete from users where id = $1', [targetId]);
    res.json({ ok: true });
  });

  router.post('/users', async (req, res) => {
    const body = parse(
      z.object({
        loginId: z.string().trim().regex(/^\d{8}$/),
        displayName: z.string().min(2).max(64),
        password: z.string().min(6).max(200),
        isAdmin: z.boolean().optional(),
      }),
      req.body,
    );

    const loginId = assertUsername(body.loginId);
    assertPassword(body.password);
    const displayName = assertDisplayName(body.displayName);

    const existing = await getUserByUsername(loginId);
    if (existing) throw badRequest('این شناسه قبلاً گرفته شده است');

    const passwordHash = await hashPassword(body.password);
    const created = await one<UserRow>(
      `insert into users (username, display_name, password_hash, is_admin, status)
       values ($1, $2, $3, $4, 'active')
       returning id, username, display_name, password_hash, bio, avatar_key,
                 is_admin, status, created_at, last_seen_at, settings`,
      [loginId, displayName, passwordHash, body.isAdmin === true],
    );

    res.status(201).json({ user: created ? { ...toPublicUser(created), status: created.status } : null });
  });

  router.get('/invites', async (_req, res) => {    const rows = await query<{
      code: string;
      note: string;
      max_uses: number;
      uses: number;
      expires_at: Date | null;
      revoked: boolean;
      created_at: Date;
    }>('select * from invites order by created_at desc limit 100');

    res.json({
      invites: rows.map((row) => ({
        code: row.code,
        note: row.note,
        maxUses: row.max_uses,
        uses: row.uses,
        expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
        revoked: row.revoked,
        createdAt: row.created_at.toISOString(),
      })),
    });
  });

  router.post('/invites', async (req, res) => {
    const { userId } = currentUser(req);
    const body = parse(inviteSchema, req.body);

    const code = await createUniqueInviteCode();
    const expiresAt =
      body.expiresInDays > 0
        ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    await query(
      `insert into invites (code, created_by, note, max_uses, expires_at)
       values ($1, $2, $3, $4, $5)`,
      [code, userId, body.note ?? '', body.maxUses, expiresAt],
    );

    res.status(201).json({ code, expiresAt: expiresAt?.toISOString() ?? null });
  });

  router.delete('/invites/:code', async (req, res) => {
    await query('update invites set revoked = true where code = $1', [String(req.params.code)]);
    res.json({ ok: true });
  });

  return router;
}

async function createUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode(8);
    const existing = await queryOne('select 1 from invites where code = $1', [code]);
    if (!existing) return code;
  }
  throw new Error('could not allocate invite code');
}
