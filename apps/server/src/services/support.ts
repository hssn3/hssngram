import { randomToken, sha256 } from '../lib/crypto.js';
import { query, queryOne, tx } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { createDirectChat } from './chats.js';
import { assertDisplayName, assertPassword, assertUsername, getUserByUsername } from './users.js';
import { hashPassword } from '../lib/crypto.js';
import { insertSystemMessage } from './seq.js';
import type { PublicUser } from '../types.js';
import { toPublicUser, type UserRow } from './users.js';

export type GuestRow = {
  id: string;
  display_name: string;
  note: string;
  created_at: Date;
  last_seen_at: Date;
  converted_user_id: string | null;
};

export type SupportMessageRow = {
  id: string;
  thread_id: string;
  author: 'guest' | 'admin' | 'system';
  admin_id: string | null;
  body: string;
  created_at: Date;
};

export type SupportThreadRow = {
  id: string;
  guest_id: string;
  status: 'open' | 'closed';
  unread_for_admin: number;
  unread_for_guest: number;
  assigned_admin_id: string | null;
  converted_user_id: string | null;
  last_message_at: Date | null;
  created_at: Date;
};

export function mapSupportMessage(row: SupportMessageRow) {
  return {
    id: row.id,
    threadId: row.thread_id,
    author: row.author,
    adminId: row.admin_id,
    body: row.body,
    createdAt: row.created_at.toISOString(),
  };
}

export function mapSupportThread(
  row: SupportThreadRow,
  guest: GuestRow,
  lastMessage?: SupportMessageRow | null,
) {
  return {
    id: row.id,
    status: row.status,
    unreadForAdmin: row.unread_for_admin,
    unreadForGuest: row.unread_for_guest,
    convertedUserId: row.converted_user_id,
    lastMessageAt: (row.last_message_at ?? row.created_at).toISOString(),
    createdAt: row.created_at.toISOString(),
    guest: {
      id: guest.id,
      displayName: guest.display_name,
      note: guest.note,
      converted: Boolean(guest.converted_user_id),
      createdAt: guest.created_at.toISOString(),
      lastSeenAt: guest.last_seen_at.toISOString(),
    },
    lastMessage: lastMessage ? mapSupportMessage(lastMessage) : null,
  };
}

/** Creates a guest session + its single support thread. */
export async function startSupportSession(input: {
  displayName: string;
  note?: string;
}): Promise<{ guestToken: string; threadId: string }> {
  const displayName = input.displayName.trim().slice(0, 60);
  if (displayName.length < 2) throw badRequest('نام را کامل وارد کنید');

  const token = randomToken(32);

  const result = await tx(async (client) => {
    const guest = await client.query<{ id: string }>(
      `insert into guests (token_hash, display_name, note)
       values ($1, $2, $3) returning id`,
      [sha256(token), displayName, (input.note ?? '').slice(0, 300)],
    );
    const guestId = guest.rows[0]!.id;

    const thread = await client.query<{ id: string }>(
      `insert into support_threads (guest_id) values ($1) returning id`,
      [guestId],
    );

    await client.query(
      `insert into support_messages (thread_id, author, body)
       values ($1, 'system', $2)`,
      [thread.rows[0]!.id, 'گفتگو با پشتیبانی آغاز شد. هر سؤالی داری همین‌جا بنویس.'],
    );

    return { threadId: thread.rows[0]!.id };
  });

  return { guestToken: token, threadId: result.threadId };
}

export async function guestFromToken(token: string | undefined): Promise<GuestRow | null> {
  if (!token) return null;
  const row = await queryOne<GuestRow>('select * from guests where token_hash = $1', [
    sha256(token),
  ]);
  if (!row) return null;
  await query('update guests set last_seen_at = now() where id = $1', [row.id]);
  return row;
}

export async function threadForGuest(guestId: string): Promise<SupportThreadRow | null> {
  return queryOne<SupportThreadRow>('select * from support_threads where guest_id = $1', [
    guestId,
  ]);
}

export async function supportMessages(
  threadId: string,
  since?: string,
): Promise<SupportMessageRow[]> {
  if (since) {
    return query<SupportMessageRow>(
      `select * from support_messages
       where thread_id = $1 and created_at > $2::timestamptz
       order by created_at asc limit 200`,
      [threadId, since],
    );
  }
  return query<SupportMessageRow>(
    'select * from support_messages where thread_id = $1 order by created_at asc limit 300',
    [threadId],
  );
}

export async function postGuestMessage(
  guest: GuestRow,
  body: string,
): Promise<{ message: SupportMessageRow; thread: SupportThreadRow }> {
  const text = body.trim();
  if (!text) throw badRequest('متن پیام خالی است');
  if (text.length > 4000) throw badRequest('متن پیام بیش از حد بلند است');

  const thread = await threadForGuest(guest.id);
  if (!thread) throw notFound('گفتگو پیدا نشد');
  if (thread.status === 'closed') throw forbidden('این گفتگو بسته شده است');

  const message = await queryOne<SupportMessageRow>(
    `insert into support_messages (thread_id, author, body)
     values ($1, 'guest', $2) returning *`,
    [thread.id, text],
  );
  if (!message) throw new Error('failed to store support message');

  await query(
    `update support_threads
     set unread_for_admin = unread_for_admin + 1,
         last_message_at = now(),
         status = 'open'
     where id = $1`,
    [thread.id],
  );

  return { message, thread: { ...thread, unread_for_admin: thread.unread_for_admin + 1 } };
}

export async function listSupportThreads(): Promise<
  Array<ReturnType<typeof mapSupportThread>>
> {
  const rows = await query<SupportThreadRow & { guest_row_id: string; display_name: string; note: string; guest_created_at: Date; guest_last_seen: Date; guest_converted: string | null }>(
    `select t.*,
            g.id as guest_row_id, g.display_name, g.note,
            g.created_at as guest_created_at, g.last_seen_at as guest_last_seen,
            g.converted_user_id as guest_converted
     from support_threads t
     join guests g on g.id = t.guest_id
     order by coalesce(t.last_message_at, t.created_at) desc
     limit 100`,
  );

  const ids = rows.map((row) => row.id);
  const lastMessages = new Map<string, SupportMessageRow>();
  if (ids.length > 0) {
    const messages = await query<SupportMessageRow>(
      `select distinct on (thread_id) * from support_messages
       where thread_id = any($1::uuid[])
       order by thread_id, created_at desc`,
      [ids],
    );
    for (const message of messages) lastMessages.set(message.thread_id, message);
  }

  return rows.map((row) =>
    mapSupportThread(
      row,
      {
        id: row.guest_row_id,
        display_name: row.display_name,
        note: row.note,
        created_at: row.guest_created_at,
        last_seen_at: row.guest_last_seen,
        converted_user_id: row.guest_converted,
      },
      lastMessages.get(row.id) ?? null,
    ),
  );
}

export async function getThread(threadId: string): Promise<{
  thread: SupportThreadRow;
  guest: GuestRow;
}> {
  const row = await queryOne<SupportThreadRow & { g_id: string; display_name: string; note: string; g_created: Date; g_seen: Date; g_converted: string | null }>(
    `select t.*, g.id as g_id, g.display_name, g.note,
            g.created_at as g_created, g.last_seen_at as g_seen,
            g.converted_user_id as g_converted
     from support_threads t join guests g on g.id = t.guest_id
     where t.id = $1`,
    [threadId],
  );
  if (!row) throw notFound('گفتگو پیدا نشد');

  return {
    thread: row,
    guest: {
      id: row.g_id,
      display_name: row.display_name,
      note: row.note,
      created_at: row.g_created,
      last_seen_at: row.g_seen,
      converted_user_id: row.g_converted,
    },
  };
}

export async function postAdminReply(
  threadId: string,
  adminId: string,
  body: string,
): Promise<SupportMessageRow> {
  const text = body.trim();
  if (!text) throw badRequest('متن پیام خالی است');
  if (text.length > 4000) throw badRequest('متن پیام بیش از حد بلند است');

  await getThread(threadId);

  const message = await queryOne<SupportMessageRow>(
    `insert into support_messages (thread_id, author, admin_id, body)
     values ($1, 'admin', $2, $3) returning *`,
    [threadId, adminId, text],
  );
  if (!message) throw new Error('failed to store support reply');

  await query(
    `update support_threads
     set unread_for_guest = unread_for_guest + 1,
         last_message_at = now(),
         assigned_admin_id = coalesce(assigned_admin_id, $2)
     where id = $1`,
    [threadId, adminId],
  );

  return message;
}

export async function markThreadRead(
  threadId: string,
  side: 'admin' | 'guest',
): Promise<void> {
  await query(
    `update support_threads
     set unread_for_admin = case when $2 = 'admin' then 0 else unread_for_admin end,
         unread_for_guest = case when $2 = 'guest' then 0 else unread_for_guest end
     where id = $1`,
    [threadId, side],
  );
}

export async function setThreadStatus(
  threadId: string,
  status: 'open' | 'closed',
): Promise<void> {
  await query('update support_threads set status = $2 where id = $1', [threadId, status]);
}

export type ConvertResult = {
  user: PublicUser;
  chatId: string;
  loginId: string;
  password: string;
};

/** Turns a guest conversation into a real account and opens a direct chat with the admin. */
export async function convertGuestToUser(input: {
  threadId: string;
  adminId: string;
  loginId: string;
  password: string;
  displayName?: string;
}): Promise<ConvertResult> {
  const { thread, guest } = await getThread(input.threadId);
  if (thread.converted_user_id) throw badRequest('این گفتگو قبلاً به کاربر تبدیل شده است');
  if (guest.converted_user_id) throw badRequest('این مهمان قبلاً حساب گرفته است');

  const loginId = assertUsername(input.loginId);
  assertPassword(input.password);
  const displayName = assertDisplayName(input.displayName?.trim() || guest.display_name);

  const existing = await getUserByUsername(loginId);
  if (existing) throw badRequest('این شناسه قبلاً گرفته شده است');

  const passwordHash = await hashPassword(input.password);

  const user = await tx(async (client) => {
    const inserted = await client.query<UserRow>(
      `insert into users (username, display_name, password_hash, is_admin, status)
       values ($1, $2, $3, false, 'active')
       returning id, username, display_name, password_hash, bio, avatar_key,
                 is_admin, status, created_at, last_seen_at, settings`,
      [loginId, displayName, passwordHash],
    );
    const created = inserted.rows[0]!;

    await client.query(
      `update support_threads set converted_user_id = $2, status = 'closed' where id = $1`,
      [thread.id, created.id],
    );
    await client.query('update guests set converted_user_id = $2 where id = $1', [
      guest.id,
      created.id,
    ]);
    await client.query(
      `insert into support_messages (thread_id, author, body)
       values ($1, 'system', $2)`,
      [thread.id, `این گفتگو به حساب ${loginId} تبدیل شد.`],
    );

    return created;
  });

  const chatId = await createDirectChat(input.adminId, user.id);
  await tx(async (client) => {
    await insertSystemMessage(client, chatId, `حساب ${displayName} توسط پشتیبانی ساخته شد`);
  });

  return {
    user: toPublicUser(user),
    chatId,
    loginId,
    password: input.password,
  };
}
