import { Router } from 'express';
import { requireAuth, currentUser } from '../middleware/auth.js';
import {
  accountStats,
  chatLinks,
  chatStats,
  markAllChatsRead,
} from '../../services/insights.js';
import {
  addChatToFolder,
  createFolder,
  deleteFolder,
  folderChatIds,
  listFolders,
  removeChatFromFolder,
} from '../../services/folders.js';
import { z } from 'zod';
import { parse } from '../validate.js';

export function insightRoutes(): Router {
  const router = Router();

  router.get('/chats/:chatId/stats', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ stats: await chatStats(String(req.params.chatId), userId) });
  });

  router.get('/chats/:chatId/links', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ links: await chatLinks(String(req.params.chatId), userId) });
  });

  router.get('/me/stats', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ stats: await accountStats(userId) });
  });

  router.post('/chats/read-all', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ updated: await markAllChatsRead(userId) });
  });

  router.get('/folders', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ folders: await listFolders(userId) });
  });

  router.post('/folders', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    const { name } = parse(z.object({ name: z.string().min(1).max(40) }), req.body);
    res.status(201).json({ folder: await createFolder(userId, name) });
  });

  router.delete('/folders/:id', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    await deleteFolder(userId, String(req.params.id));
    res.json({ ok: true });
  });

  router.get('/folders/:id/chats', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ chatIds: await folderChatIds(userId, String(req.params.id)) });
  });

  router.post('/folders/:id/chats', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    const { chatId } = parse(z.object({ chatId: z.string().uuid() }), req.body);
    await addChatToFolder(userId, String(req.params.id), chatId);
    res.status(201).json({ ok: true });
  });

  router.delete('/folders/:id/chats/:chatId', requireAuth, async (req, res) => {
    const { userId } = currentUser(req);
    await removeChatFromFolder(userId, String(req.params.id), String(req.params.chatId));
    res.json({ ok: true });
  });

  return router;
}

