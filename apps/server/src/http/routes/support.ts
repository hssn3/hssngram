import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { parse } from '../validate.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import {
  convertGuestToUser,
  getThread,
  guestFromToken,
  listSupportThreads,
  mapSupportMessage,
  markThreadRead,
  postAdminReply,
  postGuestMessage,
  setThreadStatus,
  startSupportSession,
  supportMessages,
  threadForGuest,
  type GuestRow,
} from '../../services/support.js';
import { queryOne } from '../../db/pool.js';
import { emitToUsers } from '../../realtime/index.js';

const guestCookie = 'hssn_guest';
const guestCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.PUBLIC_URL?.startsWith('https://') ?? false,
  path: '/',
  maxAge: 90 * 24 * 60 * 60 * 1000,
};

function guestToken(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[guestCookie];
}

async function requireGuest(req: Request): Promise<GuestRow> {
  const guest = await guestFromToken(guestToken(req));
  if (!guest) throw forbidden('نشست گفتگو پیدا نشد. صفحه را دوباره باز کنید.');
  return guest;
}

async function adminIds(): Promise<string[]> {
  const rows = await queryOne<{ ids: string[] | null }>(
    "select array_agg(id) as ids from users where is_admin = true and status = 'active'",
  );
  return rows?.ids ?? [];
}

const startSchema = z.object({
  displayName: z.string().min(2).max(60),
  note: z.string().max(300).optional(),
});

const messageSchema = z.object({ body: z.string().min(1).max(4000) });

export function supportRoutes(): Router {
  const router = Router();

  router.post(
    '/start',
    rateLimit({ windowMs: 60 * 60_000, max: 10, scope: 'support-start' }),
    async (req, res) => {
      const body = parse(startSchema, req.body);
      const result = await startSupportSession(body);
      res.cookie(guestCookie, result.guestToken, guestCookieOptions);
      res.status(201).json({ threadId: result.threadId, guestToken: result.guestToken });
    },
  );

  router.get('/session', async (req, res) => {
    const guest = await guestFromToken(guestToken(req));
    if (!guest) {
      res.json({ guest: null });
      return;
    }

    const thread = await threadForGuest(guest.id);
    if (!thread) {
      res.json({ guest: null });
      return;
    }

    const messages = await supportMessages(thread.id);
    await markThreadRead(thread.id, 'guest');

    res.json({
      guest: { id: guest.id, displayName: guest.display_name, converted: Boolean(guest.converted_user_id) },
      thread: { id: thread.id, status: thread.status },
      messages: messages.map(mapSupportMessage),
    });
  });

  router.get('/messages', async (req, res) => {
    const guest = await requireGuest(req);
    const thread = await threadForGuest(guest.id);
    if (!thread) throw badRequest('گفتگو پیدا نشد');

    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const messages = await supportMessages(thread.id, since);
    if (messages.length > 0) await markThreadRead(thread.id, 'guest');

    res.json({ messages: messages.map(mapSupportMessage), status: thread.status });
  });

  router.post(
    '/messages',
    rateLimit({ windowMs: 10 * 60_000, max: 40, scope: 'support-send' }),
    async (req, res) => {
      const guest = await requireGuest(req);
      const { body } = parse(messageSchema, req.body);
      const result = await postGuestMessage(guest, body);

      const admins = await adminIds();
      emitToUsers(admins, 'support:message', {
        threadId: result.thread.id,
        message: mapSupportMessage(result.message),
      });

      res.status(201).json({ message: mapSupportMessage(result.message) });
    },
  );

  return router;
}

export function adminSupportRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (_req, res) => {
    res.json({ threads: await listSupportThreads() });
  });

  router.get('/:id', async (req, res) => {
    const { thread, guest } = await getThread(String(req.params.id));
    const messages = await supportMessages(thread.id);
    await markThreadRead(thread.id, 'admin');

    res.json({
      thread: {
        id: thread.id,
        status: thread.status,
        converted: Boolean(thread.converted_user_id),
        guest: {
          id: guest.id,
          displayName: guest.display_name,
          note: guest.note,
          converted: Boolean(guest.converted_user_id),
        },
      },
      messages: messages.map(mapSupportMessage),
    });
  });

  router.post('/:id/messages', async (req, res) => {
    const { userId } = currentUser(req);
    const { body } = parse(messageSchema, req.body);
    const message = await postAdminReply(String(req.params.id), userId, body);
    res.status(201).json({ message: mapSupportMessage(message) });
  });

  router.post('/:id/read', async (req, res) => {
    await markThreadRead(String(req.params.id), 'admin');
    res.json({ ok: true });
  });

  router.post('/:id/status', async (req, res) => {
    const status = req.body?.status === 'closed' ? 'closed' : 'open';
    await setThreadStatus(String(req.params.id), status);
    res.json({ ok: true });
  });

  router.post('/:id/convert', async (req, res) => {
    const { userId } = currentUser(req);
    const body = parse(
      z.object({
        loginId: z.string().trim().regex(/^\d{8}$/),
        password: z.string().min(6).max(200),
        displayName: z.string().min(2).max(64).optional(),
      }),
      req.body,
    );

    const result = await convertGuestToUser({
      threadId: String(req.params.id),
      adminId: userId,
      ...body,
    });

    res.status(201).json(result);
  });

  return router;
}
