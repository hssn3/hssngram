import { query, queryOne } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { MessageDto } from '../types.js';
import { assertMembership } from './chats.js';
import { hydrateMessages, MESSAGE_COLUMNS, type MessageRow } from './message-mapper.js';

export async function listPins(chatId: string, userId: string): Promise<MessageDto[]> {
  await assertMembership(chatId, userId);

  const rows = await query<MessageRow>(
    `select ${MESSAGE_COLUMNS}
     from chat_pins p
     join messages m on m.id = p.message_id
     where p.chat_id = $1 and m.deleted_at is null
     order by p.created_at desc
     limit 50`,
    [chatId],
  );

  return hydrateMessages(rows);
}

export async function addPin(
  chatId: string,
  userId: string,
  messageId: string,
): Promise<void> {
  const membership = await assertMembership(chatId, userId);

  const message = await queryOne<{ chat_id: string }>(
    'select chat_id from messages where id = $1 and deleted_at is null',
    [messageId],
  );
  if (!message || message.chat_id !== chatId) throw badRequest('پیام در این گفتگو نیست');

  const chat = await queryOne<{ type: string }>('select type from chats where id = $1', [chatId]);
  if (membership.role === 'member' && chat?.type !== 'direct') {
    throw forbidden('فقط مدیران گروه می‌توانند پیام سنجاق کنند');
  }

  await query(
    `insert into chat_pins (chat_id, message_id, pinned_by) values ($1, $2, $3)
     on conflict (chat_id, message_id) do nothing`,
    [chatId, messageId, userId],
  );

  // Keep the headline pin in sync for the chat list preview.
  await query('update chats set pinned_message_id = $2, updated_at = now() where id = $1', [
    chatId,
    messageId,
  ]);
}

export async function removePin(chatId: string, userId: string, messageId: string): Promise<void> {
  const membership = await assertMembership(chatId, userId);
  const chat = await queryOne<{ type: string }>('select type from chats where id = $1', [chatId]);
  if (membership.role === 'member' && chat?.type !== 'direct') {
    throw forbidden('فقط مدیران گروه می‌توانند سنجاق را بردارند');
  }

  await query('delete from chat_pins where chat_id = $1 and message_id = $2', [chatId, messageId]);

  const next = await queryOne<{ message_id: string }>(
    `select message_id from chat_pins where chat_id = $1 order by created_at desc limit 1`,
    [chatId],
  );
  await query('update chats set pinned_message_id = $2 where id = $1', [
    chatId,
    next?.message_id ?? null,
  ]);
}

export async function isPinned(chatId: string, messageId: string): Promise<boolean> {
  const row = await queryOne('select 1 from chat_pins where chat_id = $1 and message_id = $2', [
    chatId,
    messageId,
  ]);
  return Boolean(row);
}

export async function requirePinnedChat(messageId: string): Promise<string | null> {
  const row = await queryOne<{ chat_id: string }>(
    'select chat_id from chat_pins where message_id = $1 limit 1',
    [messageId],
  );
  return row?.chat_id ?? null;
}

export { notFound };
