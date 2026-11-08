import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { parse } from '../validate.js';
import {
  publicVapidKey,
  pushEnabled,
  removeSubscription,
  saveSubscription,
} from '../../services/push.js';

const subscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({
      p256dh: z.string().min(10).max(500),
      auth: z.string().min(5).max(200),
    }),
  }),
});

export function pushRoutes(): Router {
  const router = Router();

  router.get('/key', (_req, res) => {
    res.json({ enabled: pushEnabled(), publicKey: publicVapidKey() });
  });

  router.use(requireAuth);

  router.post('/subscribe', async (req, res) => {
    const { userId } = currentUser(req);
    const body = parse(subscriptionSchema, req.body);
    await saveSubscription(userId, body.subscription);
    res.status(201).json({ ok: true });
  });

  router.post('/unsubscribe', async (req, res) => {
    const { userId } = currentUser(req);
    const endpoint = String(req.body?.endpoint ?? '');
    if (endpoint) await removeSubscription(userId, endpoint);
    res.json({ ok: true });
  });

  return router;
}
