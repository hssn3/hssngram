import { query, queryOne, tx } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { MessageDto } from '../types.js';
import { assertMembership } from './chats.js';
import { getMessageById, hydrateMessages, MESSAGE_COLUMNS, type MessageRow } from './message-mapper.js';
import { nextSeq } from './seq.js';
import { storage } from '../storage/index.js';

/** Copies a message (text + attachments) into another chat. */
export async function forwardMessage(
  messageId: string,
  userId: string,
  targetChatId: string,
): Promise<MessageDto> {
  const original = await queryOne<MessageRow>(
    `select ${MESSAGE_COLUMNS} from messages m where m.id = $1`,
    [messageId],
  );
  if (!original) throw notFound('پیام پیدا نشد');
  if (original.deleted_at) throw badRequest('پیام حذف شده قابل هدایت نیست');

  await assertMembership(original.chat_id, userId);
  await assertMembership(targetChatId, userId);

  const attachments = await query<{
    name: string;
    mime: string;
    size: string;
    kind: string;
    storage_key: string | null;
    width: number | null;
    height: number | null;
    duration: string | null;
  }>(
    `select name, mime, size, kind, storage_key, width, height, duration
     from attachments where message_id = $1 and status = 'ready'`,
    [messageId],
  );

  const senderName = original.sender_id
    ? (
        await queryOne<{ display_name: string }>('select display_name from users where id = $1', [
          original.sender_id,
        ])
      )?.display_name ?? 'کاربر'
    : 'کاربر';

  const newId = await tx(async (client) => {
    const seq = await nextSeq(client, targetChatId);
    const inserted = await client.query<{ id: string }>(
      `insert into messages (chat_id, seq, sender_id, kind, body, meta, forward_from_name)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        targetChatId,
        seq,
        userId,
        original.kind,
        original.body,
        JSON.stringify({ forwardedFromMessageId: messageId }),
        senderName,
      ],
    );
    const id = inserted.rows[0]!.id;

    for (const attachment of attachments) {
      await client.query(
        `insert into attachments (owner_id, message_id, name, mime, size, kind, storage_key, width, height, duration, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ready')`,
        [
          userId,
          id,
          attachment.name,
          attachment.mime,
          attachment.size,
          attachment.kind,
          attachment.storage_key,
          attachment.width,
          attachment.height,
          attachment.duration,
        ],
      );
    }

    await client.query(
      'update chats set last_message_at = now(), updated_at = now() where id = $1',
      [targetChatId],
    );

    return id;
  });

  const message = await getMessageById(newId);
  if (!message) throw new Error('forwarded message vanished');
  return message;
}

export async function setPinnedMessage(
  chatId: string,
  userId: string,
  messageId: string | null,
): Promise<void> {
  const membership = await assertMembership(chatId, userId);

  if (messageId) {
    const message = await queryOne<{ chat_id: string }>(
      'select chat_id from messages where id = $1',
      [messageId],
    );
    if (!message || message.chat_id !== chatId) throw badRequest('پیام در این گفتگو نیست');

    if (membership.role === 'member') {
      const chat = await queryOne<{ type: string }>('select type from chats where id = $1', [
        chatId,
      ]);
      // In direct chats every participant may pin; in groups only admins.
      if (chat?.type === 'group') throw forbidden('فقط مدیران گروه می‌توانند پیام سنجاق کنند');
    }
  }

  await query('update chats set pinned_message_id = $2, updated_at = now() where id = $1', [
    chatId,
    messageId,
  ]);
}

/** Hides a message only for one member ("delete for me"). */
export async function hideMessageForUser(messageId: string, userId: string): Promise<void> {
  const message = await queryOne<{ chat_id: string }>(
    'select chat_id from messages where id = $1',
    [messageId],
  );
  if (!message) throw notFound('پیام پیدا نشد');
  await assertMembership(message.chat_id, userId);

  await query(
    `insert into message_hidden (message_id, user_id) values ($1, $2)
     on conflict do nothing`,
    [messageId, userId],
  );
}

export async function searchInChat(
  chatId: string,
  userId: string,
  term: string,
  limit = 30,
): Promise<MessageDto[]> {
  await assertMembership(chatId, userId);
  const cleaned = term.trim();
  if (cleaned.length < 2) return [];

  const rows = await query<MessageRow>(
    `select ${MESSAGE_COLUMNS} from messages m
     where m.chat_id = $1
       and m.deleted_at is null
       and (to_tsvector('simple', m.body) @@ plainto_tsquery('simple', $2)
            or m.body ilike $3)
     order by m.seq desc
     limit $4`,
    [chatId, cleaned, `%${cleaned.replace(/[%_]/g, '\\$&')}%`, limit],
  );

  return hydrateMessages(rows);
}

export async function messageReaders(
  messageId: string,
  userId: string,
): Promise<{ readBy: Array<{ userId: string; displayName: string; at: string }>; total: number }> {
  const message = await queryOne<{ chat_id: string; seq: string }>(
    'select chat_id, seq from messages where id = $1',
    [messageId],
  );
  if (!message) throw notFound('پیام پیدا نشد');
  await assertMembership(message.chat_id, userId);

  const rows = await query<{ user_id: string; display_name: string }>(
    `select cm.user_id, u.display_name
     from chat_members cm
     join users u on u.id = cm.user_id
     where cm.chat_id = $1 and cm.user_id <> $2 and cm.last_read_seq >= $3`,
    [message.chat_id, userId, Number(message.seq)],
  );

  return {
    readBy: rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      at: new Date().toISOString(),
    })),
    total: rows.length,
  };
}

export async function archiveChat(
  chatId: string,
  userId: string,
  archived: boolean,
): Promise<void> {
  await assertMembership(chatId, userId);
  await query('update chat_members set archived = $3 where chat_id = $1 and user_id = $2', [
    chatId,
    userId,
    archived,
  ]);
}

/** Removes a storage object only when no other message references it. */
export async function removeAttachmentIfUnused(storageKey: string): Promise<void> {
  const remaining = await queryOne<{ count: string }>(
    'select count(*)::text as count from attachments where storage_key = $1',
    [storageKey],
  );
  if (Number(remaining?.count ?? 0) === 0) {
    await storage().remove(storageKey);
  }
}
