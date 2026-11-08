import { query, queryOne, tx } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { ChatDto, ChatMemberDto, MessageDto } from '../types.js';
import { hydrateMessages, MESSAGE_COLUMNS, type MessageRow } from './message-mapper.js';
import { chatMemberIds, insertSystemMessage } from './seq.js';
import { getPublicUsers, toPublicUser, type UserRow } from './users.js';

export type ChatRow = {
  id: string;
  type: 'direct' | 'group';
  title: string;
  avatar_key: string | null;
  owner_id: string | null;
  direct_key: string | null;
  invite_token: string | null;
  pinned_message_id: string | null;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date | null;
};

type MembershipRow = { role: 'owner' | 'admin' | 'member'; last_read_seq: string };

export async function assertMembership(
  chatId: string,
  userId: string,
): Promise<MembershipRow> {
  const row = await queryOne<MembershipRow>(
    'select role, last_read_seq from chat_members where chat_id = $1 and user_id = $2',
    [chatId, userId],
  );
  if (!row) throw forbidden('شما عضو این گفتگو نیستید');
  return row;
}

export async function isAdminOf(chatId: string, userId: string): Promise<boolean> {
  const row = await queryOne<{ role: string }>(
    'select role from chat_members where chat_id = $1 and user_id = $2',
    [chatId, userId],
  );
  return row?.role === 'owner' || row?.role === 'admin';
}

async function membersFor(chatIds: string[]): Promise<Map<string, ChatMemberDto[]>> {
  const result = new Map<string, ChatMemberDto[]>();
  if (chatIds.length === 0) return result;

  const rows = await query<
    UserRow & { chat_id: string; role: ChatMemberDto['role']; last_read_seq: string }
  >(
    `select cm.chat_id, cm.role, cm.last_read_seq,
            u.id, u.username, u.display_name, u.password_hash, u.bio, u.avatar_key,
            u.is_admin, u.created_at, u.last_seen_at, u.settings
     from chat_members cm
     join users u on u.id = cm.user_id
     where cm.chat_id = any($1::uuid[])
     order by cm.joined_at asc`,
    [chatIds],
  );

  for (const row of rows) {
    const list = result.get(row.chat_id) ?? [];
    list.push({
      user: toPublicUser(row),
      role: row.role,
      lastReadSeq: Number(row.last_read_seq),
    });
    result.set(row.chat_id, list);
  }
  return result;
}

async function lastMessagesFor(chatIds: string[]): Promise<Map<string, MessageDto>> {
  const result = new Map<string, MessageDto>();
  if (chatIds.length === 0) return result;

  const rows = await query<MessageRow & { chat_id: string }>(
    `select distinct on (m.chat_id) ${MESSAGE_COLUMNS}
     from messages m
     where m.chat_id = any($1::uuid[]) and m.deleted_at is null
     order by m.chat_id, m.seq desc`,
    [chatIds],
  );

  const hydrated = await hydrateMessages(rows);
  hydrated.forEach((message, index) => {
    result.set(rows[index]!.chat_id, message);
  });
  return result;
}

function resolveTitle(row: ChatRow, members: ChatMemberDto[], viewerId: string): string {
  if (row.type === 'group') return row.title || 'گروه بدون نام';
  const other = members.find((member) => member.user.id !== viewerId)?.user;
  return other?.displayName ?? other?.username ?? 'گفتگو';
}

function resolveAvatar(row: ChatRow, members: ChatMemberDto[], viewerId: string): string | null {
  if (row.type === 'group') {
    return row.avatar_key ? `/api/chats/${row.id}/avatar` : null;
  }
  const other = members.find((member) => member.user.id !== viewerId)?.user;
  return other?.avatarUrl ?? null;
}

async function pinnedMessagesFor(chatIds: string[]): Promise<Map<string, MessageDto>> {
  const result = new Map<string, MessageDto>();
  if (chatIds.length === 0) return result;

  const rows = await query<MessageRow & { chat_id: string }>(
    `select ${MESSAGE_COLUMNS}, m.chat_id
     from chats c
     join messages m on m.id = c.pinned_message_id
     where c.id = any($1::uuid[]) and m.deleted_at is null`,
    [chatIds],
  );

  const hydrated = await hydrateMessages(rows);
  hydrated.forEach((message, index) => {
    result.set(rows[index]!.chat_id, message);
  });
  return result;
}

export async function listChats(userId: string, includeArchived = false): Promise<ChatDto[]> {
  const rows = await query<
    ChatRow & {
      role: ChatMemberDto['role'];
      last_read_seq: string;
      muted_until: Date | null;
      archived: boolean;
      unread: string;
    }
  >(
    `select c.id, c.type, c.title, c.avatar_key, c.owner_id, c.direct_key, c.invite_token,
            c.pinned_message_id, c.created_at, c.updated_at, c.last_message_at,
            cm.role, cm.last_read_seq, cm.muted_until, cm.archived,
            (select count(*) from messages x
              where x.chat_id = c.id
                and x.seq > cm.last_read_seq
                and x.sender_id is distinct from $1
                and x.deleted_at is null) as unread
     from chat_members cm
     join chats c on c.id = cm.chat_id
     where cm.user_id = $1 and ($2::boolean or cm.archived = false)
     order by coalesce(c.last_message_at, c.created_at) desc`,
    [userId, includeArchived],
  );

  const chatIds = rows.map((row) => row.id);
  const [members, lastMessages, pinned] = await Promise.all([
    membersFor(chatIds),
    lastMessagesFor(chatIds),
    pinnedMessagesFor(chatIds),
  ]);

  return rows.map((row) => {
    const chatMembers = members.get(row.id) ?? [];
    return {
      id: row.id,
      type: row.type,
      title: resolveTitle(row, chatMembers, userId),
      avatarUrl: resolveAvatar(row, chatMembers, userId),
      ownerId: row.owner_id,
      members: chatMembers,
      lastMessage: lastMessages.get(row.id) ?? null,
      pinnedMessage: pinned.get(row.id) ?? null,
      unread: Number(row.unread),
      mutedUntil: row.muted_until ? row.muted_until.toISOString() : null,
      archived: row.archived,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : null,
    } satisfies ChatDto;
  });
}

export async function getChatForUser(chatId: string, userId: string): Promise<ChatDto> {
  const row = await queryOne<ChatRow>(
    `select id, type, title, avatar_key, owner_id, direct_key, invite_token,
            pinned_message_id, created_at, updated_at, last_message_at
     from chats where id = $1`,
    [chatId],
  );
  if (!row) throw notFound('گفتگو پیدا نشد');

  const membership = await queryOne<{
    role: ChatMemberDto['role'];
    last_read_seq: string;
    muted_until: Date | null;
    archived: boolean;
  }>(
    'select role, last_read_seq, muted_until, archived from chat_members where chat_id = $1 and user_id = $2',
    [chatId, userId],
  );
  if (!membership) throw forbidden('شما عضو این گفتگو نیستید');

  const members = (await membersFor([chatId])).get(chatId) ?? [];
  const lastMessage = (await lastMessagesFor([chatId])).get(chatId) ?? null;
  const pinned = (await pinnedMessagesFor([chatId])).get(chatId) ?? null;
  const unread = await queryOne<{ count: string }>(
    `select count(*)::text as count from messages
     where chat_id = $1 and seq > $2 and sender_id is distinct from $3 and deleted_at is null`,
    [chatId, membership.last_read_seq, userId],
  );

  return {
    id: row.id,
    type: row.type,
    title: resolveTitle(row, members, userId),
    avatarUrl: resolveAvatar(row, members, userId),
    ownerId: row.owner_id,
    members,
    lastMessage,
    pinnedMessage: pinned,
    unread: Number(unread?.count ?? 0),
    mutedUntil: membership.muted_until ? membership.muted_until.toISOString() : null,
    archived: membership.archived,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : null,
  };
}

export async function createDirectChat(userId: string, otherUserId: string): Promise<string> {
  const isSelf = userId === otherUserId;

  const other = await queryOne<{ id: string }>('select id from users where id = $1', [otherUserId]);
  if (!other) throw notFound('کاربر پیدا نشد');

  if (!isSelf) {
    const blocked = await queryOne<{ ok: boolean }>(
      `select exists(
         select 1 from user_blocks
         where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)
       ) as ok`,
      [userId, otherUserId],
    );
    if (blocked?.ok) throw forbidden('امکان شروع گفتگو با این کاربر وجود ندارد');
  }

  const directKey = [userId, otherUserId].sort().join(':');

  return tx(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into chats (type, direct_key, owner_id)
       values ('direct', $1, $2)
       on conflict (direct_key) do update set updated_at = now()
       returning id`,
      [directKey, userId],
    );
    const chatId = inserted.rows[0]!.id;

    if (isSelf) {
      await client.query(
        `insert into chat_members (chat_id, user_id, role)
         values ($1, $2, 'owner')
         on conflict (chat_id, user_id) do nothing`,
        [chatId, userId],
      );
    } else {
      await client.query(
        `insert into chat_members (chat_id, user_id, role)
         values ($1, $2, 'member'), ($1, $3, 'member')
         on conflict (chat_id, user_id) do nothing`,
        [chatId, userId, otherUserId],
      );
    }

    return chatId;
  });
}

export async function createGroupChat(
  userId: string,
  title: string,
  memberIds: string[],
): Promise<string> {
  const unique = [...new Set(memberIds.filter((id) => id !== userId))];
  if (unique.length === 0) throw badRequest('حداقل یک عضو دیگر لازم است');
  if (unique.length > 199) throw badRequest('تعداد اعضا بیش از حد مجاز است');

  const existing = await query<{ id: string }>(
    'select id from users where id = any($1::uuid[])',
    [unique],
  );
  if (existing.length !== unique.length) throw badRequest('برخی از کاربران پیدا نشدند');

  return tx(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into chats (type, title, owner_id)
       values ('group', $1, $2) returning id`,
      [title.trim().slice(0, 120) || 'گروه جدید', userId],
    );
    const chatId = inserted.rows[0]!.id;

    await client.query(
      `insert into chat_members (chat_id, user_id, role)
       values ($1, $2, 'owner')`,
      [chatId, userId],
    );

    await client.query(
      `insert into chat_members (chat_id, user_id, role)
       select $1, unnest($2::uuid[]), 'member'
       on conflict (chat_id, user_id) do nothing`,
      [chatId, unique],
    );

    await insertSystemMessage(client, chatId, 'گروه ساخته شد');
    return chatId;
  });
}

export async function addMembers(
  chatId: string,
  actorId: string,
  userIds: string[],
): Promise<void> {
  const membership = await assertMembership(chatId, actorId);
  if (membership.role === 'member') throw forbidden('فقط مدیران گروه می‌توانند عضو اضافه کنند');

  const chat = await queryOne<{ type: string }>('select type from chats where id = $1', [chatId]);
  if (chat?.type !== 'group') throw badRequest('به گفتگوی خصوصی نمی‌توان عضو اضافه کرد');

  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;

  const countRow = await queryOne<{ count: string }>(
    'select count(*)::text as count from chat_members where chat_id = $1',
    [chatId],
  );
  if (Number(countRow?.count ?? 0) + unique.length > 200) {
    throw badRequest('ظرفیت گروه پر شده است');
  }

  await tx(async (client) => {
    await client.query(
      `insert into chat_members (chat_id, user_id, role)
       select $1, unnest($2::uuid[]), 'member'
       on conflict (chat_id, user_id) do nothing`,
      [chatId, unique],
    );

    const users = await client.query<{ display_name: string }>(
      'select display_name from users where id = any($1::uuid[])',
      [unique],
    );
    const names = users.rows.map((row) => row.display_name).join('، ');
    if (names) await insertSystemMessage(client, chatId, `${names} به گروه اضافه شد`);
  });
}

export async function removeMember(
  chatId: string,
  actorId: string,
  userId: string,
): Promise<{ removed: boolean }> {
  const membership = await assertMembership(chatId, actorId);

  if (actorId !== userId && membership.role === 'member') {
    throw forbidden('فقط مدیران گروه می‌توانند عضو حذف کنند');
  }

  if (actorId !== userId) {
    const target = await assertMembership(chatId, userId);
    if (target.role === 'owner') throw forbidden('سازنده گروه را نمی‌توان حذف کرد');
  }

  await tx(async (client) => {
    await client.query('delete from chat_members where chat_id = $1 and user_id = $2', [
      chatId,
      userId,
    ]);

    if (membership.role === 'owner' && actorId === userId) {
      // Transfer ownership to the next admin, then to the oldest member.
      const next = await client.query<{ user_id: string }>(
        `select user_id from chat_members where chat_id = $1
         order by case role when 'admin' then 0 else 1 end, joined_at asc limit 1`,
        [chatId],
      );
      if (next.rows[0]) {
        await client.query('update chats set owner_id = $1 where id = $2', [
          next.rows[0].user_id,
          chatId,
        ]);
        await client.query(
          `update chat_members set role = 'owner' where chat_id = $1 and user_id = $2`,
          [chatId, next.rows[0].user_id],
        );
      }
    }

    const remaining = await client.query<{ count: string }>(
      'select count(*)::text as count from chat_members where chat_id = $1',
      [chatId],
    );
    if (Number(remaining.rows[0]?.count ?? 0) === 0) {
      await client.query('delete from chats where id = $1', [chatId]);
    }
  });

  return { removed: true };
}

export async function updateChat(
  chatId: string,
  actorId: string,
  patch: { title?: string; avatarKey?: string | null },
): Promise<void> {
  const membership = await assertMembership(chatId, actorId);
  if (membership.role === 'member') throw forbidden('فقط مدیران گروه می‌توانند تنظیمات را تغییر دهند');

  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    params.push(patch.title.trim().slice(0, 120));
    sets.push(`title = $${params.length}`);
  }
  if (patch.avatarKey !== undefined) {
    params.push(patch.avatarKey);
    sets.push(`avatar_key = $${params.length}`);
  }
  if (sets.length === 0) return;

  params.push(chatId);
  await query(`update chats set ${sets.join(', ')}, updated_at = now() where id = $${params.length}`, params);
}

export async function markRead(chatId: string, userId: string, seq: number): Promise<void> {
  await query(
    `update chat_members
     set last_read_seq = greatest(last_read_seq, $3)
     where chat_id = $1 and user_id = $2`,
    [chatId, userId, seq],
  );
}

export async function setMuted(chatId: string, userId: string, mutedUntil: Date | null): Promise<void> {
  await query('update chat_members set muted_until = $3 where chat_id = $1 and user_id = $2', [
    chatId,
    userId,
    mutedUntil,
  ]);
}

export async function chatAvatarKey(chatId: string): Promise<string | null> {
  const row = await queryOne<{ avatar_key: string | null }>(
    'select avatar_key from chats where id = $1',
    [chatId],
  );
  if (!row) throw notFound('گفتگو پیدا نشد');
  return row.avatar_key;
}

export async function recipientsFor(chatId: string): Promise<string[]> {
  return chatMemberIds(chatId);
}

export async function membersOf(chatId: string): Promise<string[]> {
  return chatMemberIds(chatId);
}

export { getPublicUsers };
