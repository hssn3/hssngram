import { randomToken } from '../lib/crypto.js';
import { query, queryOne, tx } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { assertMembership, getChatForUser } from './chats.js';
import { insertSystemMessage } from './seq.js';
import type { ChatDto } from '../types.js';

export type ChatRights = {
  sendMessages?: boolean;
  pinMessages?: boolean;
  deleteMessages?: boolean;
  inviteUsers?: boolean;
  manageChat?: boolean;
};

export async function createChannel(userId: string, title: string): Promise<string> {
  const clean = title.trim().slice(0, 120);
  if (clean.length < 2) throw badRequest('نام کانال را کامل وارد کنید');

  return tx(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into chats (type, title, owner_id) values ('channel', $1, $2) returning id`,
      [clean, userId],
    );
    const chatId = inserted.rows[0]!.id;

    await client.query(
      `insert into chat_members (chat_id, user_id, role, rights)
       values ($1, $2, 'owner', '{"sendMessages":true,"pinMessages":true,"deleteMessages":true,"inviteUsers":true,"manageChat":true}'::jsonb)`,
      [chatId, userId],
    );

    await insertSystemMessage(client, chatId, 'کانال ساخته شد');
    return chatId;
  });
}

/** Channel/group posting rules: rights, slow mode and read-only channels. */
export async function assertCanSend(chatId: string, userId: string): Promise<void> {
  const row = await queryOne<{
    type: string;
    slowmode_seconds: number;
    role: string;
    rights: ChatRights;
  }>(
    `select c.type, c.slowmode_seconds, cm.role, cm.rights
     from chats c join chat_members cm on cm.chat_id = c.id
     where c.id = $1 and cm.user_id = $2`,
    [chatId, userId],
  );

  if (!row) throw forbidden('شما عضو این گفتگو نیستید');

  if (row.type === 'channel' && row.role === 'member') {
    throw forbidden('در کانال فقط مدیران می‌توانند پیام بگذارند');
  }

  if (row.rights?.sendMessages === false) {
    throw forbidden('ارسال پیام برای شما محدود شده است');
  }

  if (row.slowmode_seconds > 0 && row.role === 'member') {
    const last = await queryOne<{ at: Date | null }>(
      `select max(created_at) as at from messages
       where chat_id = $1 and sender_id = $2 and deleted_at is null`,
      [chatId, userId],
    );
    if (last?.at) {
      const wait = row.slowmode_seconds * 1000 - (Date.now() - new Date(last.at).getTime());
      if (wait > 0) {
        throw badRequest(`حالت آهسته: ${Math.ceil(wait / 1000)} ثانیه دیگر تلاش کنید`);
      }
    }
  }
}

export async function setSlowMode(
  chatId: string,
  actorId: string,
  seconds: number,
): Promise<number> {
  const membership = await assertMembership(chatId, actorId);
  if (membership.role === 'member') throw forbidden('فقط مدیران می‌توانند حالت آهسته را تنظیم کنند');

  const value = Math.max(0, Math.min(seconds, 3600));
  await query('update chats set slowmode_seconds = $2 where id = $1', [chatId, value]);
  return value;
}

export async function setMemberRights(
  chatId: string,
  actorId: string,
  targetId: string,
  patch: { rights?: ChatRights; role?: 'admin' | 'member' },
): Promise<void> {
  const actor = await assertMembership(chatId, actorId);
  if (actor.role === 'member') throw forbidden('فقط مدیران می‌توانند مجوز بدهند');

  if (targetId === actorId && patch.role === 'member') {
    throw badRequest('نمی‌توانید نقش خودتان را پایین بیاورید');
  }

  const current = await assertMembership(chatId, targetId);
  if (current.role === 'owner') throw forbidden('سازنده را نمی‌توان تغییر داد');

  const nextRights = { ...(patch.rights ?? {}) };
  await query(
    `update chat_members
     set role = coalesce($3, role),
         rights = rights || $4::jsonb
     where chat_id = $1 and user_id = $2`,
    [chatId, targetId, patch.role ?? null, JSON.stringify(nextRights)],
  );
}

export async function createInvite(
  chatId: string,
  actorId: string,
  input: { maxUses?: number | null; expiresInHours?: number | null },
): Promise<{ token: string; expiresAt: string | null; maxUses: number | null }> {
  const membership = await assertMembership(chatId, actorId);
  const chat = await queryOne<{ type: string }>('select type from chats where id = $1', [chatId]);
  if (!chat || chat.type === 'direct') throw badRequest('برای گفتگوی خصوصی لینک دعوت معنا ندارد');

  const canInvite = membership.role !== 'member';
  if (!canInvite) throw forbidden('فقط مدیران می‌توانند لینک دعوت بسازند');

  const token = randomToken(9).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  const maxUses = input.maxUses && input.maxUses > 0 ? Math.min(input.maxUses, 10_000) : null;
  const expiresAt =
    input.expiresInHours && input.expiresInHours > 0
      ? new Date(Date.now() + input.expiresInHours * 3600_000)
      : null;

  await query(
    `insert into chat_invites (token, chat_id, created_by, max_uses, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [token, chatId, actorId, maxUses, expiresAt],
  );

  return { token, expiresAt: expiresAt?.toISOString() ?? null, maxUses };
}

export async function listInvites(chatId: string, actorId: string) {
  const membership = await assertMembership(chatId, actorId);
  if (membership.role === 'member') throw forbidden('فقط مدیران می‌توانند لینک‌ها را ببینند');

  const rows = await query<{
    token: string;
    uses: number;
    max_uses: number | null;
    expires_at: Date | null;
    revoked: boolean;
    created_at: Date;
  }>(
    `select token, uses, max_uses, expires_at, revoked, created_at
     from chat_invites where chat_id = $1 order by created_at desc limit 50`,
    [chatId],
  );

  return rows.map((row) => ({
    token: row.token,
    uses: row.uses,
    maxUses: row.max_uses,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    revoked: row.revoked,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function revokeInvite(chatId: string, actorId: string, token: string): Promise<void> {
  const membership = await assertMembership(chatId, actorId);
  if (membership.role === 'member') throw forbidden('فقط مدیران می‌توانند لینک را باطل کنند');

  await query('update chat_invites set revoked = true where chat_id = $1 and token = $2', [
    chatId,
    token,
  ]);
}

export async function joinByInvite(
  token: string,
  userId: string,
): Promise<{ chat: ChatDto; alreadyMember: boolean }> {
  const invite = await queryOne<{
    token: string;
    chat_id: string;
    max_uses: number | null;
    uses: number;
    expires_at: Date | null;
    revoked: boolean;
  }>('select * from chat_invites where token = $1', [token]);

  if (!invite || invite.revoked) throw notFound('لینک دعوت معتبر نیست');
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    throw badRequest('لینک دعوت منقضی شده است');
  }
  if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
    throw badRequest('ظرفیت این لینک دعوت پر شده است');
  }

  const existing = await queryOne('select 1 from chat_members where chat_id = $1 and user_id = $2', [
    invite.chat_id,
    userId,
  ]);

  if (!existing) {
    await tx(async (client) => {
      await client.query(
        `insert into chat_members (chat_id, user_id, role) values ($1, $2, 'member')
         on conflict (chat_id, user_id) do nothing`,
        [invite.chat_id, userId],
      );
      await client.query('update chat_invites set uses = uses + 1 where token = $1', [token]);
      await insertSystemMessage(client, invite.chat_id, 'یک عضو با لینک دعوت اضافه شد');
    });
  }

  return { chat: await getChatForUser(invite.chat_id, userId), alreadyMember: Boolean(existing) };
}
