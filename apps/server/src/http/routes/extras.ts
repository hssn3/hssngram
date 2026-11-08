import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { parse } from '../validate.js';
import { assertMembership } from '../../services/chats.js';
import {
  blockUser,
  blockedUsers,
  cancelScheduled,
  chatMedia,
  exportAccount,
  getPrivacy,
  listScheduled,
  setChatTtl,
  setPrivacy,
  unblockUser,
  votePoll,
} from '../../services/feature-extras.js';
import { query, queryOne } from '../../db/pool.js';
import { membersOf } from '../../services/seq.js';
import { emitToUsers } from '../../realtime/index.js';
import { notFound } from '../../lib/errors.js';

const ttlSchema = z.object({ seconds: z.number().int().min(0).max(365 * 24 * 3600).nullable() });

const privacySchema = z.object({
  lastSeen: z.enum(['everyone', 'nobody']).optional(),
  readReceipts: z.boolean().optional(),
  profilePhoto: z.enum(['everyone', 'nobody']).optional(),
});

export function extrasRoutes(): Router {
  const router = Router();
  router.get('/chats/:chatId/scheduled', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ messages: await listScheduled(String(req.params.chatId), userId) });
  });

  router.delete('/messages/:id/scheduled', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    await cancelScheduled(String(req.params.id), userId);
    res.json({ ok: true });
  });

  router.post('/messages/:id/vote', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    const { optionIndex } = parse(
      z.object({ optionIndex: z.number().int().min(0).max(9) }),
      req.body,
    );

    const result = await votePoll(String(req.params.id), userId, optionIndex);

    const message = await queryOne<{ chat_id: string; meta: { counts?: number[] } }>(
      'select chat_id, meta from messages where id = $1',
      [String(req.params.id)],
    );
    if (message) {
      emitToUsers(await membersOf(message.chat_id), 'poll:update', {
        messageId: String(req.params.id),
        chatId: message.chat_id,
        counts: result.counts,
      });
    }

    res.json(result);
  });

  router.get('/chats/:chatId/media', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    const kind = String(req.query.kind ?? 'image');
    if (!['image', 'video', 'audio', 'file'].includes(kind)) {
      res.status(400).json({ error: 'bad_request', message: 'نوع رسانه نامعتبر است' });
      return;
    }

    res.json({
      items: await chatMedia(
        String(req.params.chatId),
        userId,
        kind as 'image' | 'video' | 'audio' | 'file',
      ),
    });
  });

  router.post('/chats/:chatId/ttl', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    const { seconds } = parse(ttlSchema, req.body);
    await setChatTtl(String(req.params.chatId), userId, seconds || null);
    res.json({ ok: true, ttlSeconds: seconds || null });
  });

  router.get('/users/privacy', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ privacy: await getPrivacy(userId) });
  });

  router.patch('/users/privacy', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    const patch = parse(privacySchema, req.body);
    res.json({ privacy: await setPrivacy(userId, patch) });
  });

  router.get('/users/blocked', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ users: await blockedUsers(userId) });
  });

  router.post('/users/:id/block', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    await blockUser(userId, String(req.params.id));
    res.json({ ok: true });
  });

  router.delete('/users/:id/block', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    await unblockUser(userId, String(req.params.id));
    res.json({ ok: true });
  });

  router.get('/export', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    const data = await exportAccount(userId);
    res.setHeader('content-disposition', 'attachment; filename="hssngram-export.json"');
    res.json(data);
  });

  router.get('/chats/:chatId/ttl', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    const chatId = String(req.params.chatId);
    await assertMembership(chatId, userId);
    const row = await queryOne<{ ttl_seconds: number | null }>(
      'select ttl_seconds from chat_members where chat_id = $1 and user_id = $2',
      [chatId, userId],
    );
    if (!row) throw notFound('گفتگو پیدا نشد');
    res.json({ ttlSeconds: row.ttl_seconds });
  });

  router.get('/privacy/scope', requireAuth, async (_req, res) => {
    const rows = await query<{ count: string }>('select count(*)::text as count from user_blocks');
    res.json({ blocks: Number(rows[0]?.count ?? 0) });
  });

  return router;
}


export function inviteRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/:token/join', async (req, res) => {
    const { userId } = currentUser(req);
    const { joinByInvite } = await import('../../services/channel.js');
    const result = await joinByInvite(String(req.params.token), userId);

    const members = await membersOf(result.chat.id);
    emitToUsers(members, 'chat:new', result.chat);
    res.json(result);
  });

  return router;
}
