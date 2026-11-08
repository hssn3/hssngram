import { query } from '../db/pool.js';
import type pg from 'pg';

/** Allocates the next per-chat sequence number inside the caller's transaction. */
export async function nextSeq(client: pg.PoolClient, chatId: string): Promise<number> {
  await client.query('select pg_advisory_xact_lock(hashtext($1)::bigint)', [chatId]);
  const result = await client.query<{ seq: string }>(
    'select coalesce(max(seq), 0) + 1 as seq from messages where chat_id = $1',
    [chatId],
  );
  return Number(result.rows[0]!.seq);
}

export async function insertSystemMessage(
  client: pg.PoolClient,
  chatId: string,
  body: string,
): Promise<void> {
  const seq = await nextSeq(client, chatId);
  await client.query(
    `insert into messages (chat_id, seq, sender_id, kind, body)
     values ($1, $2, null, 'system', $3)`,
    [chatId, seq, body],
  );
  await client.query('update chats set last_message_at = now(), updated_at = now() where id = $1', [
    chatId,
  ]);
}

export async function chatMemberIds(chatId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    'select user_id from chat_members where chat_id = $1',
    [chatId],
  );
  return rows.map((row) => row.user_id);
}

export const membersOf = chatMemberIds;
