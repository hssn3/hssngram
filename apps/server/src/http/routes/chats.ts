import { Router, raw } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { parse } from '../validate.js';
import { badRequest, notFound } from '../../lib/errors.js';
import {
  addMembers,
  assertMembership,
  chatAvatarKey,
  createDirectChat,
  createGroupChat,
  getChatForUser,
  listChats,
  markRead,
  removeMember,
  setMuted,
  updateChat,
} from '../../services/chats.js';
import { getUserById, toPublicUser } from '../../services/users.js';
import { membersOf } from '../../services/seq.js';
import {
  createChannel,
  createInvite,
  setMemberRights,
  setSlowMode,
  listInvites,
  revokeInvite,
} from '../../services/channel.js';
import { clearHistory } from '../../services/message-extras.js';
import { addPin, listPins, removePin } from '../../services/pins.js';
import { emitToUsers } from '../../realtime/index.js';
import { publishChat, publishNewChat } from '../../realtime/index.js';
import { storage } from '../../storage/index.js';
import { isImageMime, mimeFromKey } from '../../lib/mime.js';
import { extensionFor } from '../../lib/http-tokens.js';
import { query } from '../../db/pool.js';

const directSchema = z.object({ userId: z.string().uuid() });
const groupSchema = z.object({
  title: z.string().min(1).max(120),
  memberIds: z.array(z.string().uuid()).min(1).max(199),
});
const titleSchema = z.object({ title: z.string().min(1).max(120) });
const membersSchema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(50) });
const readSchema = z.object({ seq: z.number().int().nonnegative() });
const muteSchema = z.object({ minutes: z.number().int().min(0).max(60 * 24 * 365).nullable() });

export function chatRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const { userId } = currentUser(req);
    const archived = req.query.archived === 'true';
    res.json({ chats: await listChats(userId, archived) });
  });

  router.post('/direct', async (req, res) => {
    const { userId } = currentUser(req);
    const { userId: otherId } = parse(directSchema, req.body);
    const chatId = await createDirectChat(userId, otherId);
    const chat = await getChatForUser(chatId, userId);

    const members = await membersOf(chatId);
    for (const member of members) {
      publishNewChat([member], await getChatForUser(chatId, member));
    }
    res.status(201).json({ chat });
  });

  router.post('/group', async (req, res) => {
    const { userId } = currentUser(req);
    const body = parse(groupSchema, req.body);
    const chatId = await createGroupChat(userId, body.title, body.memberIds);

    const members = await membersOf(chatId);
    for (const member of members) {
      publishNewChat([member], await getChatForUser(chatId, member));
    }

    res.status(201).json({ chat: await getChatForUser(chatId, userId) });
  });

  router.get('/:id', async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ chat: await getChatForUser(String(req.params.id), userId) });
  });

  router.patch('/:id', async (req, res) => {
    const { userId } = currentUser(req);
    const chatId = String(req.params.id);
    const body = parse(titleSchema.partial(), req.body);
    await updateChat(chatId, userId, { title: body.title });

    const members = await membersOf(chatId);
    await publishForMembers(members, chatId);
    res.json({ ok: true });
  });

  router.post('/:id/members', async (req, res) => {
    const { userId } = currentUser(req);
    const chatId = String(req.params.id);
    const body = parse(membersSchema, req.body);
    await addMembers(chatId, userId, body.userIds);

    const members = await membersOf(chatId);
    await publishForMembers(members, chatId);
    res.json({ ok: true });
  });

  router.delete('/:id/members/:userId', async (req, res) => {
    const { userId } = currentUser(req);
    const chatId = String(req.params.id);
    const targetId = String(req.params.userId);

    await removeMember(chatId, userId, targetId);

    emitToUsers([targetId], 'chat:removed', { chatId });
    const members = await membersOf(chatId);
    await publishForMembers(members, chatId);
    res.json({ ok: true });
  });

  router.post('/:id/leave', async (req, res) => {
    const { userId } = currentUser(req);
    const chatId = String(req.params.id);
    await removeMember(chatId, userId, userId);
    emitToUsers([userId], 'chat:removed', { chatId });

    const members = await membersOf(chatId);
    await publishForMembers(members, chatId);
    res.json({ ok: true });
  });

  router.post('/:id/read', async (req, res) => {
    const { userId } = currentUser(req);
    const chatId = String(req.params.id);
    const { seq } = parse(readSchema, req.body);
    await assertMembership(chatId, userId);
    await markRead(chatId, userId, seq);
    res.json({ ok: true });
  });

  router.post('/:id/mute', async (req, res) => {
    const { userId } = currentUser(req);
    const chatId = String(req.params.id);
    const { minutes } = parse(muteSchema, req.body);
    await assertMembership(chatId, userId);
    await setMuted(
      chatId,
      userId,
      minutes && minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null,
    );
    res.json({ ok: true });
  });

  router.delete('/:id/messages', async (req, res) => {
    const { userId } = currentUser(req);
    const hidden = await clearHistory(String(req.params.id), userId);
    res.json({ ok: true, hidden });
  });

  router.delete('/:id', async (req, res) => {    const { userId } = currentUser(req);
    const chatId = String(req.params.id);
    const membership = await assertMembership(chatId, userId);
    if (membership.role !== 'owner') {
      throw badRequest('فقط سازنده گروه می‌تواند آن را حذف کند');
    }

    const members = await membersOf(chatId);
    await query('delete from chats where id = $1', [chatId]);
    emitToUsers(members, 'chat:removed', { chatId });
    res.json({ ok: true });
  });

  router.get('/:id/avatar', async (req, res) => {
    const chatId = String(req.params.id);
    const key = await chatAvatarKey(chatId);
    if (!key) throw notFound('تصویری وجود ندارد');

    const remote = await storage().downloadUrl(key, 3600);
    res.setHeader('cache-control', 'public, max-age=3600');
    if (remote) {
      res.redirect(302, remote);
      return;
    }

    const stream = await storage().openLocal(key);
    res.setHeader('content-type', mimeFromKey(key));
    res.setHeader('x-content-type-options', 'nosniff');
    stream.pipe(res);
  });

  router.post(
    '/:id/avatar',
    raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '6mb' }),
    async (req, res) => {
      const { userId } = currentUser(req);
      const chatId = String(req.params.id);
      const membership = await assertMembership(chatId, userId);
      if (membership.role === 'member') throw badRequest('فقط مدیران گروه می‌توانند تصویر بگذارند');

      const mime = String(req.headers['content-type'] ?? '');
      if (!isImageMime(mime)) throw badRequest('فقط تصویر JPEG/PNG/WebP مجاز است');
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length < 64) throw badRequest('تصویر نامعتبر است');

      const previous = await chatAvatarKey(chatId);
      const key = `chats/${chatId}/${randomUUID()}.${extensionFor(mime, 'jpg')}`;
      await storage().putObject(key, body, mime);
      await updateChat(chatId, userId, { avatarKey: key });
      if (previous) void storage().remove(previous);

      const members = await membersOf(chatId);
      await publishForMembers(members, chatId);
      res.json({ ok: true, avatarUrl: `/api/chats/${chatId}/avatar` });
    },
  );

  return router;
}

async function publishForMembers(memberIds: string[], chatId: string): Promise<void> {
  for (const member of memberIds) {
    const chat = await getChatForUser(chatId, member);
    publishChat([member], chat);
  }
}

export function profileRoute(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:id', async (req, res) => {
    const user = await getUserById(String(req.params.id));
    if (!user) throw notFound('کاربر پیدا نشد');
    res.json({ user: toPublicUser(user) });
  });

  return router;
}

export function channelRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/changes', (_req, res) => {
    res.json({ ok: true });
  });

  router.post('/channel', async (req, res) => {
    const { userId } = currentUser(req);
    const { title } = parse(z.object({ title: z.string().min(2).max(120) }), req.body);
    const chatId = await createChannel(userId, title);

    const members = await membersOf(chatId);
    for (const member of members) {
      publishNewChat([member], await getChatForUser(chatId, member));
    }

    res.status(201).json({ chat: await getChatForUser(chatId, userId) });
  });

  router.post('/:id/invites', async (req, res) => {
    const { userId } = currentUser(req);
    const body = parse(
      z.object({
        maxUses: z.number().int().min(1).max(10000).nullish(),
        expiresInHours: z.number().int().min(1).max(8760).nullish(),
      }),
      req.body,
    );

    const invite = await createInvite(String(req.params.id), userId, body);
    res.status(201).json(invite);
  });

  router.get('/:id/pins', async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ pins: await listPins(String(req.params.id), userId) });
  });

  router.post('/:id/pins', async (req, res) => {
    const { userId } = currentUser(req);
    const { messageId } = parse(z.object({ messageId: z.string().uuid() }), req.body);
    await addPin(String(req.params.id), userId, messageId);
    res.status(201).json({ ok: true });
  });

  router.delete('/:id/pins/:messageId', async (req, res) => {
    const { userId } = currentUser(req);
    await removePin(String(req.params.id), userId, String(req.params.messageId));
    res.json({ ok: true });
  });

  router.get('/:id/invites', async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ invites: await listInvites(String(req.params.id), userId) });
  });

  router.delete('/:id/invites/:token', async (req, res) => {
    const { userId } = currentUser(req);
    await revokeInvite(String(req.params.id), userId, String(req.params.token));
    res.json({ ok: true });
  });

  router.post('/:id/slowmode', async (req, res) => {
    const { userId } = currentUser(req);
    const { seconds } = parse(z.object({ seconds: z.number().int().min(0).max(3600) }), req.body);
    const value = await setSlowMode(String(req.params.id), userId, seconds);

    emitToUsers(await membersOf(String(req.params.id)), 'chat:update', await getChatForUser(String(req.params.id), userId));
    res.json({ slowmodeSeconds: value });
  });

  router.patch('/:id/members/:userId', async (req, res) => {
    const { userId } = currentUser(req);
    const body = parse(
      z.object({
        role: z.enum(['admin', 'member']).optional(),
        rights: z
          .object({
            sendMessages: z.boolean().optional(),
            pinMessages: z.boolean().optional(),
            deleteMessages: z.boolean().optional(),
            inviteUsers: z.boolean().optional(),
            manageChat: z.boolean().optional(),
          })
          .optional(),
      }),
      req.body,
    );

    await setMemberRights(String(req.params.id), userId, String(req.params.userId), body);
    res.json({ ok: true });
  });

  return router;
}




