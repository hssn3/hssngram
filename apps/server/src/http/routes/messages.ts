import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { parse, parseNumber } from '../validate.js';
import {
  deleteMessage,
  editMessage,
  listMessages,
  searchMessages,
  sendMessage,
  toggleReaction,
} from '../../services/messages.js';
import { getChatForUser } from '../../services/chats.js';
import { membersOf } from '../../services/seq.js';
import { notifyNewMessage } from '../../services/notify.js';
import { emitToUsers } from '../../realtime/index.js';
import { withPollVotes } from '../../services/poll-helper.js';
import {
  archiveChat,
  forwardMessage,
  hideMessageForUser,
  messageReaders,
  searchInChat,
  setPinnedMessage,
} from '../../services/message-extras.js';

const sendSchema = z.object({
  kind: z.enum(['text', 'image', 'video', 'audio', 'voice', 'file', 'poll']).optional(),
  body: z.string().max(8000).optional(),
  replyToId: z.string().uuid().nullish(),
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  meta: z.record(z.unknown()).optional(),
  clientId: z.string().max(64).optional(),
  silent: z.boolean().optional(),
  scheduledAt: z.string().datetime().nullish(),
  ttlSeconds: z.number().int().min(0).max(604800).nullish(),
});

const editSchema = z.object({ body: z.string().min(1).max(8000) });
const reactionSchema = z.object({ emoji: z.string().min(1).max(8) });

export function messageRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/chats/:chatId/messages', async (req, res) => {
    const { userId } = currentUser(req);
    const before = req.query.before ? parseNumber(req.query.before, 0) : undefined;
    const limit = parseNumber(req.query.limit, 40);

    const messages = await listMessages(String(req.params.chatId), userId, {
      beforeSeq: before || undefined,
      limit,
    });
    res.json({ messages: await withPollVotes(messages, userId) });
  });

  router.post(
    '/chats/:chatId/messages',
    rateLimit({ windowMs: 60_000, max: 120, scope: 'send', byUser: true }),
    async (req, res) => {
      const { userId } = currentUser(req);
      const chatId = String(req.params.chatId);
      const body = parse(sendSchema, req.body);

      const message = await sendMessage({
        chatId,
        senderId: userId,
        kind: body.kind,
        body: body.body,
        replyToId: body.replyToId ?? null,
        attachmentIds: body.attachmentIds,
        meta: { ...body.meta, clientId: body.clientId },
        silent: body.silent,
        scheduledAt: body.scheduledAt ?? null,
        ttlSeconds: body.ttlSeconds ?? null,
      });

      if (message.scheduledAt) {
        emitToUsers([userId], 'message:scheduled', message);
        res.status(202).json({ message });
        return;
      }

      const memberIds = await membersOf(chatId);
      const chat = await getChatForUser(chatId, userId);
      await notifyNewMessage(memberIds, message, { ...chat, unread: 0 });
      res.status(201).json({ message });
    },
  );

  router.patch('/messages/:id', async (req, res) => {
    const { userId } = currentUser(req);
    const body = parse(editSchema, req.body);
    const message = await editMessage(String(req.params.id), userId, body.body);

    const memberIds = await membersOf(message.chatId);
    emitToUsers(memberIds, 'message:update', message);
    res.json({ message });
  });

  router.delete('/messages/:id', async (req, res) => {
    const { userId } = currentUser(req);
    const scope = String(req.query.scope ?? 'everyone');

    if (scope === 'me') {
      await hideMessageForUser(String(req.params.id), userId);
      res.json({ ok: true, hidden: true });
      return;
    }

    const message = await deleteMessage(String(req.params.id), userId);
    const memberIds = await membersOf(message.chatId);
    emitToUsers(memberIds, 'message:update', message);
    res.json({ message });
  });

  router.post('/messages/:id/forward', async (req, res) => {
    const { userId } = currentUser(req);
    const { chatId, hideAuthor } = parse(
      z.object({ chatId: z.string().uuid(), hideAuthor: z.boolean().optional() }),
      req.body,
    );

    const message = await forwardMessage(
      String(req.params.id),
      userId,
      chatId,
      hideAuthor === true,
    );
    const memberIds = await membersOf(chatId);
    const chat = await getChatForUser(chatId, userId);
    await notifyNewMessage(memberIds, message, { ...chat, unread: 0 });

    res.status(201).json({ message });
  });

  router.get('/messages/:id/readers', async (req, res) => {
    const { userId } = currentUser(req);
    res.json(await messageReaders(String(req.params.id), userId));
  });

  router.post('/chats/:chatId/pin', async (req, res) => {
    const { userId } = currentUser(req);
    const body = parse(
      z.object({ messageId: z.string().uuid().nullable() }),
      req.body,
    );
    await setPinnedMessage(String(req.params.chatId), userId, body.messageId);

    const chat = await getChatForUser(String(req.params.chatId), userId);
    emitToUsers(await membersOf(String(req.params.chatId)), 'chat:update', chat);
    res.json({ chat });
  });

  router.post('/chats/:chatId/archive', async (req, res) => {
    const { userId } = currentUser(req);
    const { archived } = parse(z.object({ archived: z.boolean() }), req.body);
    await archiveChat(String(req.params.chatId), userId, archived);
    res.json({ ok: true, archived });
  });

  router.get('/chats/:chatId/search', async (req, res) => {
    const { userId } = currentUser(req);
    const term = String(req.query.q ?? '');
    res.json({ messages: await searchInChat(String(req.params.chatId), userId, term) });
  });

  router.post('/messages/:id/reactions', async (req, res) => {
    const { userId } = currentUser(req);
    const { emoji } = parse(reactionSchema, req.body);
    const result = await toggleReaction(String(req.params.id), userId, emoji);

    const message = await getChatIdForMessage(String(req.params.id));
    if (message) {
      const memberIds = await membersOf(message);
      emitToUsers(memberIds, 'reaction', {
        messageId: String(req.params.id),
        chatId: message,
        ...result,
      });
    }

    res.json(result);
  });

  router.get('/search', async (req, res) => {
    const { userId } = currentUser(req);
    const term = String(req.query.q ?? '');
    const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
    const fromDate = typeof req.query.from === 'string' ? req.query.from : null;
    const toDate = typeof req.query.to === 'string' ? req.query.to : null;
    const messages = await searchMessages(userId, term, 30, kind, fromDate, toDate);
    res.json({ messages });
  });

  return router;
}

async function getChatIdForMessage(messageId: string): Promise<string | null> {
  const { queryOne } = await import('../../db/pool.js');
  const row = await queryOne<{ chat_id: string }>('select chat_id from messages where id = $1', [
    messageId,
  ]);
  return row?.chat_id ?? null;
}



