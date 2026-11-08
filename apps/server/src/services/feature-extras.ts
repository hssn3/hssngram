import { query, queryOne, tx } from '../db/pool.js';
import { forbidden, badRequest, notFound } from '../lib/errors.js';
import type { MessageDto, PublicUser } from '../types.js';
import { getMessageById, MESSAGE_COLUMNS, type MessageRow } from './message-mapper.js';
import { nextSeq } from './seq.js';
import { membersOf } from './seq.js';
import { emitToUsers } from '../realtime/index.js';
import { getChatForUser } from './chats.js';
import { notifyNewMessage } from './notify.js';
import { toPublicUser, type UserRow, getUserById } from './users.js';

/** Publishes messages whose scheduled time has arrived. */
export async function publishDueMessages(): Promise<number> {
  const due = await query<{ id: string; chat_id: string }>(
    `select id, chat_id from messages
     where scheduled_at is not null and scheduled_at <= now() and deleted_at is null
     order by scheduled_at asc limit 50`,
  );

  let published = 0;

  for (const row of due) {
    const messageId = await tx(async (client) => {
      const locked = await client.query<{ id: string }>(
        `select id from messages where id = $1 and scheduled_at is not null for update`,
        [row.id],
      );
      if (locked.rowCount === 0) return null;

      const seq = await nextSeq(client, row.chat_id);
      await client.query(
        `update messages set seq = $2, scheduled_at = null, created_at = now() where id = $1`,
        [row.id, seq],
      );
      await client.query(
        'update chats set last_message_at = now(), updated_at = now() where id = $1',
        [row.chat_id],
      );
      return row.id;
    });

    if (!messageId) continue;
    published += 1;

    const message = await getMessageById(messageId);
    if (!message) continue;

    const memberIds = await membersOf(message.chatId);
    const chat = await getChatForUser(message.chatId, message.senderId ?? memberIds[0]!);
    await notifyNewMessage(memberIds, message, { ...chat, unread: 0 });
  }

  return published;
}

/** Deletes messages that reached their TTL. */
export async function purgeExpiredMessages(): Promise<number> {
  const rows = await query<{ id: string; chat_id: string }>(
    `update messages
     set deleted_at = now(), body = '', meta = '{}'::jsonb
     where expires_at is not null and expires_at <= now() and deleted_at is null
     returning id, chat_id`,
  );

  for (const row of rows) {
    const message = await getMessageById(row.id);
    if (!message) continue;
    emitToUsers(await membersOf(row.chat_id), 'message:update', message);
  }

  return rows.length;
}

export async function listScheduled(chatId: string, userId: string): Promise<MessageDto[]> {
  await assertMember(chatId, userId);
  const rows = await query<MessageRow>(
    `select ${MESSAGE_COLUMNS} from messages m
     where m.chat_id = $1 and m.scheduled_at is not null and m.deleted_at is null
     order by m.scheduled_at asc limit 100`,
    [chatId],
  );
  const { hydrateMessages } = await import('./message-mapper.js');
  return hydrateMessages(rows);
}

export async function cancelScheduled(messageId: string, userId: string): Promise<void> {
  const row = await queryOne<{ sender_id: string | null; scheduled_at: Date | null }>(
    'select sender_id, scheduled_at from messages where id = $1',
    [messageId],
  );
  if (!row) throw notFound('پیام پیدا نشد');
  if (row.sender_id !== userId) throw forbidden('فقط فرستنده می‌تواند پیام زمان‌بندی‌شده را حذف کند');
  if (!row.scheduled_at) throw badRequest('این پیام زمان‌بندی نشده است');

  await query('update messages set deleted_at = now(), body = \'\' where id = $1', [messageId]);
}

async function assertMember(chatId: string, userId: string): Promise<void> {
  const row = await queryOne('select 1 from chat_members where chat_id = $1 and user_id = $2', [
    chatId,
    userId,
  ]);
  if (!row) throw forbidden('شما عضو این گفتگو نیستید');
}

export async function setChatTtl(
  chatId: string,
  userId: string,
  seconds: number | null,
): Promise<void> {
  await assertMember(chatId, userId);
  const value = seconds === null ? null : Math.max(0, Math.min(seconds, 365 * 24 * 3600));
  await query('update chat_members set ttl_seconds = $3 where chat_id = $1 and user_id = $2', [
    chatId,
    userId,
    value,
  ]);
}

/** Polls: one vote per member, multiple options allowed when configured. */
export async function votePoll(
  messageId: string,
  userId: string,
  optionIndex: number,
): Promise<{ counts: number[]; myVotes: number[] }> {
  const message = await queryOne<{
    chat_id: string;
    kind: string;
    meta: { options?: string[]; multiple?: boolean; closed?: boolean } | null;
    deleted_at: Date | null;
  }>('select chat_id, kind, meta, deleted_at from messages where id = $1', [messageId]);

  if (!message || message.deleted_at) throw notFound('نظرسنجی پیدا نشد');
  if (message.kind !== 'poll') throw badRequest('این پیام نظرسنجی نیست');
  if (message.meta?.closed) throw badRequest('این نظرسنجی بسته شده است');

  await assertMember(message.chat_id, userId);

  const options = message.meta?.options ?? [];
  if (optionIndex < 0 || optionIndex >= options.length) throw badRequest('گزینه نامعتبر است');

  const existing = await queryOne<{ option_index: number }>(
    'select option_index from poll_votes where message_id = $1 and user_id = $2',
    [messageId, userId],
  );

  if (existing?.option_index === optionIndex) {
    await query('delete from poll_votes where message_id = $1 and user_id = $2', [messageId, userId]);
  } else {
    await query(
      `insert into poll_votes (message_id, user_id, option_index) values ($1, $2, $3)
       on conflict (message_id, user_id) do update set option_index = excluded.option_index`,
      [messageId, userId, optionIndex],
    );
  }

  const counts = await query<{ option_index: number; total: string }>(
    `select option_index, count(*)::text as total from poll_votes
     where message_id = $1 group by option_index`,
    [messageId],
  );
  const tally = Array.from({ length: options.length }, () => 0);
  for (const row of counts) {
    if (row.option_index >= 0 && row.option_index < tally.length) {
      tally[row.option_index] = Number(row.total);
    }
  }

  await query(`update messages set meta = jsonb_set(meta, '{counts}', $2::jsonb) where id = $1`, [
    messageId,
    JSON.stringify(tally),
  ]);

  return pollResults(messageId, userId);
}

export async function pollResults(
  messageId: string,
  userId: string,
): Promise<{ counts: number[]; myVotes: number[] }> {
  const message = await queryOne<{ meta: { options?: string[] } | null }>(
    'select meta from messages where id = $1',
    [messageId],
  );
  const size = message?.meta?.options?.length ?? 0;

  const rows = await query<{ option_index: number; user_id: string }>(
    'select option_index, user_id from poll_votes where message_id = $1',
    [messageId],
  );

  const counts = Array.from({ length: size }, () => 0);
  const mine: number[] = [];
  for (const row of rows) {
    if (row.option_index >= 0 && row.option_index < size) counts[row.option_index]! += 1;
    if (row.user_id === userId) mine.push(row.option_index);
  }

  return { counts, myVotes: mine };
}

/** Media / files / links tabs of a chat. */
export async function chatMedia(
  chatId: string,
  userId: string,
  kind: 'image' | 'video' | 'audio' | 'file',
  limit = 60,
) {
  await assertMember(chatId, userId);

  const rows = await query<{
    id: string;
    name: string;
    mime: string;
    size: string;
    kind: string;
    width: number | null;
    height: number | null;
    duration: string | null;
    message_id: string;
    created_at: Date;
  }>(
    `select a.id, a.name, a.mime, a.size, a.kind, a.width, a.height, a.duration,
            a.message_id, a.created_at
     from attachments a
     join messages m on m.id = a.message_id
     where m.chat_id = $1 and m.deleted_at is null and a.status = 'ready' and a.kind = $2
     order by a.created_at desc limit $3`,
    [chatId, kind, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: Number(row.size),
    kind: row.kind,
    width: row.width,
    height: row.height,
    duration: row.duration === null ? null : Number(row.duration),
    messageId: row.message_id,
    createdAt: row.created_at.toISOString(),
  }));
}

/** Block / unblock, and privacy switches stored in users.settings. */
export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw badRequest('خودتان را نمی‌توانید مسدود کنید');
  await query(
    `insert into user_blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing`,
    [blockerId, blockedId],
  );
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await query('delete from user_blocks where blocker_id = $1 and blocked_id = $2', [
    blockerId,
    blockedId,
  ]);
}

export async function blockedUsers(userId: string): Promise<PublicUser[]> {
  const rows = await query<UserRow>(
    `select u.* from user_blocks b join users u on u.id = b.blocked_id
     where b.blocker_id = $1 order by b.created_at desc`,
    [userId],
  );
  return rows.map(toPublicUser);
}

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `select exists(
       select 1 from user_blocks
       where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)
     ) as ok`,
    [a, b],
  );
  return Boolean(row?.ok);
}

export type PrivacySettings = {
  lastSeen: 'everyone' | 'nobody';
  readReceipts: boolean;
  profilePhoto: 'everyone' | 'nobody';
};

export const defaultPrivacy: PrivacySettings = {
  lastSeen: 'everyone',
  readReceipts: true,
  profilePhoto: 'everyone',
};

export async function getPrivacy(userId: string): Promise<PrivacySettings> {
  const user = await getUserById(userId);
  const stored = (user?.settings as { privacy?: Partial<PrivacySettings> } | undefined)?.privacy;
  return { ...defaultPrivacy, ...(stored ?? {}) };
}

export async function setPrivacy(
  userId: string,
  patch: Partial<PrivacySettings>,
): Promise<PrivacySettings> {
  const current = await getPrivacy(userId);
  const next: PrivacySettings = { ...current, ...patch };

  const user = await getUserById(userId);
  const settings = { ...(user?.settings ?? {}), privacy: next };
  await query('update users set settings = $2 where id = $1', [userId, JSON.stringify(settings)]);
  return next;
}

export function applyPrivacy(user: PublicUser, privacy: PrivacySettings, viewerId: string) {
  if (user.id === viewerId) return user;
  if (privacy.profilePhoto === 'nobody') return { ...user, avatarUrl: null };
  return user;
}

/** Full JSON export of everything the user can see (Telegram-style export). */
export async function exportAccount(userId: string) {
  const chats = await query<{ id: string; type: string; title: string }>(
    `select c.id, c.type, c.title from chats c
     join chat_members cm on cm.chat_id = c.id and cm.user_id = $1
     order by c.created_at asc`,
    [userId],
  );

  const result: Array<{
    chat: { id: string; type: string; title: string };
    messages: Array<Record<string, unknown>>;
  }> = [];

  for (const chat of chats) {
    const messages = await query<{
      id: string;
      seq: string | null;
      sender_id: string | null;
      kind: string;
      body: string;
      created_at: Date;
    }>(
      `select id, seq, sender_id, kind, body, created_at from messages
       where chat_id = $1 and seq is not null order by seq asc limit 5000`,
      [chat.id],
    );

    result.push({
      chat: { id: chat.id, type: chat.type, title: chat.title },
      messages: messages.map((message) => ({
        id: message.id,
        seq: message.seq ? Number(message.seq) : null,
        senderId: message.sender_id,
        kind: message.kind,
        body: message.body,
        createdAt: message.created_at.toISOString(),
      })),
    });
  }

  return { exportedAt: new Date().toISOString(), chats: result };
}
