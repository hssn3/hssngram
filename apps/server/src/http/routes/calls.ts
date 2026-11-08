import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { parse } from '../validate.js';
import {
  callHistory,
  declineCall,
  endCall,
  getCall,
  iceServers,
  joinCall,
  leaveCall,
  startCall,
} from '../../services/calls.js';
import { getChatForUser } from '../../services/chats.js';
import { membersOf } from '../../services/seq.js';
import { notifyCall } from '../../services/notify.js';
import { emitToUsers } from '../../realtime/index.js';
import { env } from '../../env.js';

const startSchema = z.object({
  chatId: z.string().uuid(),
  kind: z.enum(['audio', 'video']),
});

export function callRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/ice', async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ iceServers: iceServers(userId), maxParticipants: env.MAX_CALL_PARTICIPANTS });
  });

  router.get('/history', async (req, res) => {
    const { userId } = currentUser(req);
    res.json({ calls: await callHistory(userId) });
  });

  router.post('/', async (req, res) => {
    const { userId } = currentUser(req);
    const body = parse(startSchema, req.body);
    const { call, participants } = await startCall(body.chatId, userId, body.kind);
    const chat = await getChatForUser(body.chatId, userId);

    await notifyCall(participants, 'incoming', { call, chat, from: userId });
    res.status(201).json({ call });
  });

  router.post('/:id/join', async (req, res) => {
    const { userId } = currentUser(req);
    const { call, participants } = await joinCall(String(req.params.id), userId);

    const memberIds = await membersOf(call.chatId);
    emitToUsers(memberIds, 'call:state', {
      call,
      state: 'joined',
      userId,
      participants,
    });

    res.json({ call, participants });
  });

  router.post('/:id/decline', async (req, res) => {
    const { userId } = currentUser(req);
    const call = await declineCall(String(req.params.id), userId);

    const memberIds = await membersOf(call.chatId);
    emitToUsers(memberIds, 'call:state', { call, state: 'declined', userId });
    res.json({ call });
  });

  router.post('/:id/leave', async (req, res) => {
    const { userId } = currentUser(req);
    const call = await leaveCall(String(req.params.id), userId);

    const memberIds = await membersOf(call.chatId);
    emitToUsers(memberIds, 'call:state', { call, state: 'left', userId });
    res.json({ call });
  });

  router.post('/:id/end', async (req, res) => {
    const { userId } = currentUser(req);
    const call = await endCall(String(req.params.id), userId);

    const memberIds = await membersOf(call.chatId);
    emitToUsers(memberIds, 'call:state', { call, state: 'ended', userId });
    res.json({ call });
  });

  router.get('/:id', async (req, res) => {
    const call = await getCall(String(req.params.id));
    if (!call) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ call });
  });

  return router;
}
