import { Router } from 'express';
import { requireAuth, currentUser } from '../middleware/auth.js';
import {
  accountStats,
  chatLinks,
  chatStats,
  markAllChatsRead,
} from '../../services/insights.js';

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

  return router;
}
