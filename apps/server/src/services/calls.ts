import { query, queryOne } from '../db/pool.js';
import { env } from '../env.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { turnCredentials } from '../lib/crypto.js';
import type { CallDto, IceServer } from '../types.js';
import { assertMembership } from './chats.js';

type CallRow = {
  id: string;
  chat_id: string;
  initiator_id: string | null;
  kind: 'audio' | 'video';
  status: CallDto['status'];
  created_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
};

export function mapCall(row: CallRow): CallDto {
  return {
    id: row.id,
    chatId: row.chat_id,
    kind: row.kind,
    status: row.status,
    initiatorId: row.initiator_id,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
  };
}

export function iceServers(userId: string): IceServer[] {
  const servers: IceServer[] = [];

  const stun = env.STUN_URLS.split(',').map((url) => url.trim()).filter(Boolean);
  if (stun.length > 0) servers.push({ urls: stun });

  if (env.TURN_URLS && env.TURN_SECRET) {
    const urls = env.TURN_URLS.split(',').map((url) => url.trim()).filter(Boolean);
    const credentials = turnCredentials(userId, env.TURN_SECRET, env.TURN_TTL_SECONDS);
    servers.push({
      urls,
      username: credentials.username,
      credential: credentials.credential,
    });
  }

  return servers;
}

export async function startCall(
  chatId: string,
  userId: string,
  kind: 'audio' | 'video',
): Promise<{ call: CallDto; participants: string[] }> {
  await assertMembership(chatId, userId);

  const members = await query<{ user_id: string }>(
    'select user_id from chat_members where chat_id = $1',
    [chatId],
  );

  const call = await queryOne<CallRow>(
    `insert into calls (chat_id, initiator_id, kind, status)
     values ($1, $2, $3, 'ringing') returning *`,
    [chatId, userId, kind],
  );
  if (!call) throw new Error('failed to create call');

  await query(
    `insert into call_participants (call_id, user_id, state)
     select $1, unnest($2::uuid[]),
            case when u = $3 then 'joined' else 'invited' end
     from unnest($2::uuid[]) as u
     on conflict (call_id, user_id) do nothing`,
    [call.id, members.map((member) => member.user_id), userId],
  );

  await query(
    `update call_participants set joined_at = now() where call_id = $1 and user_id = $2`,
    [call.id, userId],
  );

  return { call: mapCall(call), participants: members.map((member) => member.user_id) };
}

export async function joinCall(
  callId: string,
  userId: string,
): Promise<{ call: CallDto; participants: string[] }> {
  const call = await queryOne<CallRow>('select * from calls where id = $1', [callId]);
  if (!call) throw notFound('تماس پیدا نشد');
  await assertMembership(call.chat_id, userId);
  if (call.status === 'ended' || call.status === 'declined' || call.status === 'missed') {
    throw badRequest('این تماس پایان یافته است');
  }

  const current = await queryOne<{ state: string }>(
    'select state from call_participants where call_id = $1 and user_id = $2',
    [callId, userId],
  );
  const joined = await queryOne<{ count: string }>(
    `select count(*)::text as count from call_participants where call_id = $1 and state = 'joined'`,
    [callId],
  );

  if (current?.state !== 'joined' && Number(joined?.count ?? 0) >= env.MAX_CALL_PARTICIPANTS) {
    throw badRequest(`ظرفیت این تماس پر است (حداکثر ${env.MAX_CALL_PARTICIPANTS} نفر)`);
  }

  await query(
    `insert into call_participants (call_id, user_id, state, joined_at)
     values ($1, $2, 'joined', now())
     on conflict (call_id, user_id)
     do update set state = 'joined', joined_at = coalesce(call_participants.joined_at, now()), left_at = null`,
    [callId, userId],
  );

  if (call.status === 'ringing') {
    await query(`update calls set status = 'active', started_at = coalesce(started_at, now()) where id = $1`, [
      callId,
    ]);
    call.status = 'active';
    call.started_at = new Date();
  }

  const participants = await query<{ user_id: string }>(
    `select user_id from call_participants where call_id = $1 and state = 'joined'`,
    [callId],
  );

  return { call: mapCall(call), participants: participants.map((row) => row.user_id) };
}

export async function declineCall(callId: string, userId: string): Promise<CallDto> {
  const call = await queryOne<CallRow>('select * from calls where id = $1', [callId]);
  if (!call) throw notFound('تماس پیدا نشد');
  await assertMembership(call.chat_id, userId);

  await query(
    `update call_participants set state = 'declined', left_at = now()
     where call_id = $1 and user_id = $2`,
    [callId, userId],
  );

  const joined = await query<{ count: string }>(
    `select count(*)::text as count from call_participants where call_id = $1 and state = 'joined'`,
    [callId],
  );

  if (Number(joined[0]?.count ?? 0) === 0) {
    await query(
      `update calls set status = 'declined', ended_at = now() where id = $1 and status = 'ringing'`,
      [callId],
    );
    call.status = 'declined';
    call.ended_at = new Date();
  }

  return mapCall(call);
}

export async function leaveCall(callId: string, userId: string): Promise<CallDto> {
  const call = await queryOne<CallRow>('select * from calls where id = $1', [callId]);
  if (!call) throw notFound('تماس پیدا نشد');
  await assertMembership(call.chat_id, userId);

  await query(
    `update call_participants set state = 'left', left_at = now()
     where call_id = $1 and user_id = $2`,
    [callId, userId],
  );

  const remaining = await query<{ count: string }>(
    `select count(*)::text as count from call_participants where call_id = $1 and state = 'joined'`,
    [callId],
  );

  if (Number(remaining[0]?.count ?? 0) === 0) {
    await query(`update calls set status = 'ended', ended_at = now() where id = $1`, [callId]);
    call.status = 'ended';
    call.ended_at = new Date();
  }

  return mapCall(call);
}

export async function endCall(callId: string, userId: string): Promise<CallDto> {
  const call = await queryOne<CallRow>('select * from calls where id = $1', [callId]);
  if (!call) throw notFound('تماس پیدا نشد');
  await assertMembership(call.chat_id, userId);

  const membership = await queryOne<{ role: string }>(
    'select role from chat_members where chat_id = $1 and user_id = $2',
    [call.chat_id, userId],
  );

  const joined = await query<{ user_id: string }>(
    `select user_id from call_participants where call_id = $1 and state = 'joined'`,
    [callId],
  );

  // Only the initiator, a chat admin, or the last remaining participant may end a call for everyone.
  if (
    call.initiator_id !== userId &&
    membership?.role === 'member' &&
    joined.length > 1
  ) {
    throw forbidden('فقط میزبان یا مدیر گروه می‌تواند تماس را پایان دهد');
  }

  await query(`update calls set status = 'ended', ended_at = now() where id = $1`, [callId]);
  await query(
    `update call_participants set state = case when state = 'joined' then 'left' else state end,
            left_at = coalesce(left_at, now())
     where call_id = $1`,
    [callId],
  );

  call.status = 'ended';
  call.ended_at = new Date();
  return mapCall(call);
}

export async function getCall(callId: string): Promise<CallDto | null> {
  const row = await queryOne<CallRow>('select * from calls where id = $1', [callId]);
  return row ? mapCall(row) : null;
}

export async function callHistory(userId: string, limit = 30): Promise<CallDto[]> {
  const rows = await query<CallRow>(
    `select c.* from calls c
     join chat_members cm on cm.chat_id = c.chat_id and cm.user_id = $1
     order by c.created_at desc
     limit $2`,
    [userId, limit],
  );
  return rows.map(mapCall);
}
