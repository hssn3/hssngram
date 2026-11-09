import { query, queryOne } from '../db/pool.js';
import { assertMembership } from './chats.js';

export type ChatStats = {
  messages: number;
  images: number;
  videos: number;
  files: number;
  links: number;
  members: number;
  storageBytes: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
};

/** Aggregated numbers for the chat info panel. */
export async function chatStats(chatId: string, userId: string): Promise<ChatStats> {
  await assertMembership(chatId, userId);

  const counts = await queryOne<{
    messages: string;
    images: string;
    videos: string;
    files: string;
    links: string;
    first_at: Date | null;
    last_at: Date | null;
  }>(
    `select
       count(*)::text as messages,
       count(*) filter (where kind = 'image')::text as images,
       count(*) filter (where kind = 'video')::text as videos,
       count(*) filter (where kind = 'file')::text as files,
       count(*) filter (where body ~* 'https?://')::text as links,
       min(created_at) as first_at,
       max(created_at) as last_at
     from messages
     where chat_id = $1 and deleted_at is null and seq is not null`,
    [chatId],
  );

  const members = await queryOne<{ count: string }>(
    'select count(*)::text as count from chat_members where chat_id = $1',
    [chatId],
  );

  const storage = await queryOne<{ total: string | null }>(
    `select sum(a.size)::text as total
     from attachments a join messages m on m.id = a.message_id
     where m.chat_id = $1 and a.status = 'ready'`,
    [chatId],
  );

  return {
    messages: Number(counts?.messages ?? 0),
    images: Number(counts?.images ?? 0),
    videos: Number(counts?.videos ?? 0),
    files: Number(counts?.files ?? 0),
    links: Number(counts?.links ?? 0),
    members: Number(members?.count ?? 0),
    storageBytes: Number(storage?.total ?? 0),
    firstMessageAt: counts?.first_at ? counts.first_at.toISOString() : null,
    lastMessageAt: counts?.last_at ? counts.last_at.toISOString() : null,
  };
}

export type ChatLink = { messageId: string; url: string; createdAt: string; senderId: string | null };

/** All links shared in the chat, newest first (Telegram-style "Links" tab). */
export async function chatLinks(chatId: string, userId: string, limit = 50): Promise<ChatLink[]> {
  await assertMembership(chatId, userId);

  const rows = await query<{
    id: string;
    body: string;
    created_at: Date;
    sender_id: string | null;
  }>(
    `select id, body, created_at, sender_id from messages
     where chat_id = $1 and deleted_at is null and body ~* 'https?://'
     order by seq desc limit $2`,
    [chatId, limit],
  );

  const result: ChatLink[] = [];
  for (const row of rows) {
    const matches = row.body.match(/https?:\/\/[^\s]+/g) ?? [];
    for (const url of matches.slice(0, 3)) {
      result.push({
        messageId: row.id,
        url,
        createdAt: row.created_at.toISOString(),
        senderId: row.sender_id,
      });
    }
  }

  return result.slice(0, limit);
}

export async function markAllChatsRead(userId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `with updated as (
       update chat_members cm
       set last_read_seq = coalesce((select max(seq) from messages m where m.chat_id = cm.chat_id), 0)
       where cm.user_id = $1
       returning 1
     )
     select count(*)::text as count from updated`,
    [userId],
  );

  return Number(rows[0]?.count ?? 0);
}

export type AccountStats = {
  chats: number;
  messages: number;
  files: number;
  storageBytes: number;
  contacts: number;
};

export async function accountStats(userId: string): Promise<AccountStats> {
  const row = await queryOne<{
    chats: string;
    messages: string;
    files: string;
    total: string | null;
  }>(
    `select
       (select count(*) from chat_members where user_id = $1)::text as chats,
       (select count(*) from messages m
          join chat_members cm on cm.chat_id = m.chat_id and cm.user_id = $1
         where m.deleted_at is null)::text as messages,
       (select count(*) from attachments a
          join messages m on m.id = a.message_id
          join chat_members cm on cm.chat_id = m.chat_id and cm.user_id = $1)::text as files,
       (select sum(a.size) from attachments a
          join messages m on m.id = a.message_id
          join chat_members cm on cm.chat_id = m.chat_id and cm.user_id = $1)::text as total`,
    [userId],
  );

  const contacts = await queryOne<{ count: string }>(
    `select count(distinct cm2.user_id)::text as count
     from chat_members cm1
     join chat_members cm2 on cm2.chat_id = cm1.chat_id and cm2.user_id <> cm1.user_id
     where cm1.user_id = $1`,
    [userId],
  );

  return {
    chats: Number(row?.chats ?? 0),
    messages: Number(row?.messages ?? 0),
    files: Number(row?.files ?? 0),
    storageBytes: Number(row?.total ?? 0),
    contacts: Number(contacts?.count ?? 0),
  };
}
