import type { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../lib/jwt.js';
import { query } from '../db/pool.js';
import { markRead } from '../services/chats.js';
import { addConnection, persistLastSeen, removeConnection } from '../services/presence.js';
import type { ChatDto, MessageDto } from '../types.js';

type SocketAuth = { userId: string; isAdmin: boolean };

let server: Server | null = null;

export function realtime(): Server | null {
  return server;
}

export function emitToUsers(
  userIds: string[],
  event: string,
  payload: unknown,
): void {
  if (!server) return;
  for (const userId of userIds) {
    server.to(`user:${userId}`).emit(event, payload);
  }
}

export function initRealtime(io: Server): void {
  server = io;

  io.use(async (socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.query.token as string | undefined);

    if (!token) {
      next(new Error('unauthorized'));
      return;
    }

    const claims = await verifyAccessToken(token);
    if (!claims) {
      next(new Error('unauthorized'));
      return;
    }

    (socket.data as SocketAuth & { userId: string }).userId = claims.userId;
    (socket.data as SocketAuth).isAdmin = claims.isAdmin;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const { userId } = socket.data as SocketAuth;
    void onConnect(socket, userId);
  });
}

async function onConnect(socket: Socket, userId: string): Promise<void> {
  const wentOnline = addConnection(userId, socket.id);
  socket.join(`user:${userId}`);

  try {
    const rows = await query<{ chat_id: string }>(
      'select chat_id from chat_members where user_id = $1',
      [userId],
    );
    for (const row of rows) socket.join(`chat:${row.chat_id}`);
  } catch (error) {
    console.error('[socket] failed to join chats', error);
  }

  if (wentOnline) {
    broadcastPresence(userId, true);
  }

  // Replay calls that are still ringing so a user who reconnects mid-ring sees them.
  try {
    const { rows } = await (await import('../db/pool.js')).pool.query<{
      id: string;
      chat_id: string;
      initiator_id: string | null;
      kind: 'audio' | 'video';
      status: 'ringing';
      created_at: Date;
      started_at: Date | null;
      ended_at: Date | null;
    }>(
      `select c.id, c.chat_id, c.initiator_id, c.kind, c.status, c.created_at, c.started_at, c.ended_at
       from calls c
       join call_participants cp on cp.call_id = c.id
       where cp.user_id = $1 and cp.state = 'invited' and c.status = 'ringing'
         and c.created_at > now() - interval '45 seconds'
       order by c.created_at desc limit 3`,
      [userId],
    );

    if (rows.length > 0) {
      const { getChatForUser } = await import('../services/chats.js');
      const { mapCall } = await import('../services/calls.js');
      for (const row of rows) {
        socket.emit('call:incoming', {
          call: mapCall(row),
          chat: await getChatForUser(row.chat_id, userId),
          from: row.initiator_id,
        });
      }
    }
  } catch (error) {
    console.error('[socket] call replay failed', error);
  }

  socket.emit('ready', { userId, online: true });

  socket.on('chat:subscribe', (payload: { chatId?: string }) => {
    if (!payload?.chatId) return;
    void joinChat(socket, userId, payload.chatId);
  });

  socket.on('chat:unsubscribe', (payload: { chatId?: string }) => {
    if (!payload?.chatId) return;
    socket.leave(`chat:${payload.chatId}`);
  });

  socket.on('typing', (payload: { chatId?: string; isTyping?: boolean }) => {
    if (!payload?.chatId) return;
    socket.to(`chat:${payload.chatId}`).emit('typing', {
      chatId: payload.chatId,
      userId,
      isTyping: payload.isTyping === true,
    });
  });

  socket.on('read', (payload: { chatId?: string; seq?: number }) => {
    if (!payload?.chatId || typeof payload.seq !== 'number') return;
    void markRead(payload.chatId, userId, payload.seq)
      .then(() => {
        socket.to(`chat:${payload.chatId}`).emit('read', {
          chatId: payload.chatId,
          userId,
          seq: payload.seq,
        });
      })
      .catch(() => undefined);
  });

  socket.on('presence:ping', () => {
    void persistLastSeen(userId);
  });

  socket.on(
    'call:signal',
    (payload: { callId?: string; to?: string; data?: unknown }) => {
      if (!payload?.to || !payload.data) return;
      emitToUsers([payload.to], 'call:signal', {
        callId: payload.callId,
        from: userId,
        data: payload.data,
      });
    },
  );

  socket.on('disconnect', () => {
    void persistLastSeen(userId);
    const wentOffline = removeConnection(userId, socket.id);
    if (wentOffline) broadcastPresence(userId, false);
  });
}

async function joinChat(socket: Socket, userId: string, chatId: string): Promise<void> {
  const rows = await query<{ ok: boolean }>(
    'select exists(select 1 from chat_members where chat_id = $1 and user_id = $2) as ok',
    [chatId, userId],
  );
  if (rows[0]?.ok) socket.join(`chat:${chatId}`);
}

function broadcastPresence(userId: string, online: boolean): void {
  if (!server) return;
  server.emit('presence', { userId, online, lastSeenAt: new Date().toISOString() });
}

export function publishMessage(memberIds: string[], message: MessageDto): void {
  emitToUsers(memberIds, 'message:new', message);
}

export function publishMessageUpdate(memberIds: string[], message: MessageDto): void {
  emitToUsers(memberIds, 'message:update', message);
}

export function publishChat(userIds: string[], chat: ChatDto): void {
  emitToUsers(userIds, 'chat:update', chat);
}

export function publishNewChat(userIds: string[], chat: ChatDto): void {
  emitToUsers(userIds, 'chat:new', chat);
}
