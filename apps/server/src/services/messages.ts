import { query, queryOne, tx } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { MessageDto } from '../types.js';
import { assertMembership } from './chats.js';
import { hydrateMessages, getMessageById, MESSAGE_COLUMNS, type MessageRow } from './message-mapper.js';
import { nextSeq } from './seq.js';
import { removeAttachmentIfUnused } from './message-extras.js';
import { randomUUID } from 'node:crypto';
import { assertCanSend } from './channel.js';

const ALLOWED_KINDS = new Set<MessageDto['kind']>([
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'file',
  'system',
  'poll',
]);

export type SendMessageInput = {
  chatId: string;
  senderId: string;
  kind?: MessageDto['kind'];
  body?: string;
  replyToId?: string | null;
  attachmentIds?: string[];
  meta?: Record<string, unknown>;
  silent?: boolean;
  scheduledAt?: string | null;
  ttlSeconds?: number | null;
};

export async function sendMessage(input: SendMessageInput): Promise<MessageDto> {
  const body = (input.body ?? '').trim();
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];

  if (input.kind && !ALLOWED_KINDS.has(input.kind)) throw badRequest('نوع پیام نامعتبر است');
  if (input.kind === 'system') throw badRequest('پیام سیستمی مجاز نیست');
  if (body.length === 0 && attachmentIds.length === 0) throw badRequest('پیام خالی است');
  if (body.length > 8000) throw badRequest('متن پیام بیش از حد بلند است');
  if (attachmentIds.length > 10) throw badRequest('حداکثر ۱۰ فایل برای هر پیام');

  await assertCanSend(input.chatId, input.senderId);

  const messageId = await tx(async (client) => {
    await client.query('select 1 from chat_members where chat_id = $1 and user_id = $2', [
      input.chatId,
      input.senderId,
    ]).then((result) => {
      if (result.rowCount === 0) throw forbidden('شما عضو این گفتگو نیستید');
    });

    if (input.replyToId) {
      const reply = await client.query(
        'select 1 from messages where id = $1 and chat_id = $2',
        [input.replyToId, input.chatId],
      );
      if (reply.rowCount === 0) throw badRequest('پیام پاسخ پیدا نشد');
    }

    let kind: MessageDto['kind'] = input.kind ?? 'text';

    if (attachmentIds.length > 0) {
      const attachments = await client.query<{ id: string; kind: string; mime: string }>(
        `select id, kind, mime from attachments
         where id = any($1::uuid[]) and owner_id = $2 and status = 'ready' and message_id is null`,
        [attachmentIds, input.senderId],
      );
      if (attachments.rowCount !== attachmentIds.length) {
        throw badRequest('یکی از فایل‌ها آماده نیست یا متعلق به شما نیست');
      }
      if (kind === 'text') kind = attachments.rows[0]!.kind as MessageDto['kind'];
    }

    if (input.kind === 'poll') {
      const options = (input.meta?.options as unknown[] | undefined) ?? [];
      if (!Array.isArray(options) || options.length < 2 || options.length > 10) {
        throw badRequest('نظرسنجی باید بین ۲ تا ۱۰ گزینه داشته باشد');
      }
    }

    const member = await client.query<{ ttl_seconds: number | null }>(
      'select ttl_seconds from chat_members where chat_id = $1 and user_id = $2',
      [input.chatId, input.senderId],
    );
    const ttlSeconds = input.ttlSeconds ?? member.rows[0]?.ttl_seconds ?? null;

    const scheduled = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const isFuture = Boolean(scheduled && scheduled.getTime() > Date.now() + 1500);
    const seq = isFuture ? null : await nextSeq(client, input.chatId);
    const groupId = attachmentIds.length > 1 ? randomUUID() : null;
    const expiresAt = ttlSeconds && ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : null;

    const inserted = await client.query<{ id: string }>(
      `insert into messages
         (chat_id, seq, sender_id, kind, body, meta, reply_to, silent, expires_at, group_id, scheduled_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning id`,
      [
        input.chatId,
        seq,
        input.senderId,
        kind,
        body,
        JSON.stringify(input.meta ?? {}),
        input.replyToId ?? null,
        input.silent === true,
        expiresAt,
        groupId,
        isFuture ? scheduled : null,
      ],
    );
    const id = inserted.rows[0]!.id;

    if (attachmentIds.length > 0) {
      await client.query(
        'update attachments set message_id = $1 where id = any($2::uuid[])',
        [id, attachmentIds],
      );
    }

    if (!isFuture) {
      await client.query(
        'update chats set last_message_at = now(), updated_at = now() where id = $1',
        [input.chatId],
      );
    }

    return id;
  });

  const message = await getMessageById(messageId);
  if (!message) throw new Error('message vanished after insert');
  return message;
}

export { getMessageById };

export async function listMessages(
  chatId: string,
  userId: string,
  options: { beforeSeq?: number; limit?: number } = {},
): Promise<MessageDto[]> {
  await assertMembership(chatId, userId);

  const limit = Math.min(Math.max(options.limit ?? 40, 1), 100);
  const rows = await query<MessageRow>(
    `select ${MESSAGE_COLUMNS} from messages m
     where m.chat_id = $1
       and m.seq is not null
       and m.scheduled_at is null
       and ($2::bigint is null or m.seq < $2)
       and not exists (
         select 1 from message_hidden h where h.message_id = m.id and h.user_id = $4
       )
     order by m.seq desc
     limit $3`,
    [chatId, options.beforeSeq ?? null, limit, userId],
  );

  const hydrated = await hydrateMessages(rows);
  return hydrated.reverse();
}

export async function editMessage(
  messageId: string,
  userId: string,
  body: string,
): Promise<MessageDto> {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw badRequest('متن پیام خالی است');
  if (trimmed.length > 8000) throw badRequest('متن پیام بیش از حد بلند است');

  const row = await queryOne<{ sender_id: string | null; chat_id: string; deleted_at: Date | null }>(
    'select sender_id, chat_id, deleted_at from messages where id = $1',
    [messageId],
  );
  if (!row) throw notFound('پیام پیدا نشد');
  if (row.sender_id !== userId) throw forbidden('فقط فرستنده می‌تواند پیام را ویرایش کند');
  if (row.deleted_at) throw badRequest('پیام حذف شده است');

  await query('update messages set body = $2, edited_at = now() where id = $1', [messageId, trimmed]);
  const message = await getMessageById(messageId);
  if (!message) throw notFound('پیام پیدا نشد');
  return message;
}

export async function deleteMessage(messageId: string, userId: string): Promise<MessageDto> {
  const row = await queryOne<{ sender_id: string | null; chat_id: string; deleted_at: Date | null }>(
    'select sender_id, chat_id, deleted_at from messages where id = $1',
    [messageId],
  );
  if (!row) throw notFound('پیام پیدا نشد');

  if (row.sender_id !== userId) {
    const membership = await assertMembership(row.chat_id, userId);
    if (membership.role === 'member') {
      throw forbidden('فقط فرستنده یا مدیران گفتگو می‌توانند پیام را حذف کنند');
    }
  }

  if (!row.deleted_at) {
    await query('update messages set deleted_at = now(), body = \'\', meta = \'{}\'::jsonb where id = $1', [
      messageId,
    ]);

    const attachments = await query<{ storage_key: string | null }>(
      'select storage_key from attachments where message_id = $1',
      [messageId],
    );
    await query('delete from attachments where message_id = $1', [messageId]);
    for (const attachment of attachments) {
      if (attachment.storage_key) void removeAttachmentIfUnused(attachment.storage_key);
    }
  }

  const message = await getMessageById(messageId);
  if (!message) throw notFound('پیام پیدا نشد');
  return message;
}

export async function toggleReaction(
  messageId: string,
  userId: string,
  emoji: string,
): Promise<{ emoji: string; userIds: string[] }> {
  const clean = emoji.trim().slice(0, 8);
  if (!clean) throw badRequest('واکنش نامعتبر است');

  const message = await queryOne<{ chat_id: string }>(
    'select chat_id from messages where id = $1',
    [messageId],
  );
  if (!message) throw notFound('پیام پیدا نشد');
  await assertMembership(message.chat_id, userId);

  const existing = await queryOne(
    'select 1 from message_reactions where message_id = $1 and user_id = $2 and emoji = $3',
    [messageId, userId, clean],
  );

  if (existing) {
    await query(
      'delete from message_reactions where message_id = $1 and user_id = $2 and emoji = $3',
      [messageId, userId, clean],
    );
  } else {
    await query(
      `insert into message_reactions (message_id, user_id, emoji)
       values ($1, $2, $3) on conflict do nothing`,
      [messageId, userId, clean],
    );
  }

  const rows = await query<{ user_id: string }>(
    'select user_id from message_reactions where message_id = $1 and emoji = $2',
    [messageId, clean],
  );

  return { emoji: clean, userIds: rows.map((row) => row.user_id) };
}

export async function searchMessages(
  userId: string,
  term: string,
  limit = 30,
  kind: string | null = null,
  from: string | null = null,
  to: string | null = null,
): Promise<Array<MessageDto & { chatTitle: string }>> {
  const cleaned = term.trim();
  if (cleaned.length < 2) return [];

  const rows = await query<MessageRow & { chat_title: string }>(
    `select ${MESSAGE_COLUMNS}, c.title as chat_title
     from messages m
     join chat_members cm on cm.chat_id = m.chat_id and cm.user_id = $1
     join chats c on c.id = m.chat_id
     where m.deleted_at is null
       and ($5::text is null or m.kind = $5)
       and ($6::timestamptz is null or m.created_at >= $6)
       and ($7::timestamptz is null or m.created_at <= $7)
       and (to_tsvector('simple', m.body) @@ plainto_tsquery('simple', $2)
            or m.body ilike $3)
     order by m.created_at desc
     limit $4`,
    [
      userId,
      cleaned,
      `%${cleaned.replace(/[%_]/g, '\\$&')}%`,
      limit,
      kind,
      from,
      to,
    ],
  );

  const hydrated = await hydrateMessages(rows);
  return hydrated.map((message, index) => ({
    ...message,
    chatTitle: rows[index]!.chat_title,
  }));
}



