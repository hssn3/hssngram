import { query } from '../db/pool.js';
import type { MessageDto } from '../types.js';

/** Adds the current user's votes to poll messages in one extra query. */
export async function withPollVotes(
  messages: MessageDto[],
  userId: string,
): Promise<MessageDto[]> {
  const pollIds = messages.filter((message) => message.poll).map((message) => message.id);
  if (pollIds.length === 0) return messages;

  const rows = await query<{ message_id: string; option_index: number }>(
    `select message_id, option_index from poll_votes
     where user_id = $1 and message_id = any($2::uuid[])`,
    [userId, pollIds],
  );

  const mine = new Map<string, number[]>();
  for (const row of rows) {
    const list = mine.get(row.message_id) ?? [];
    list.push(row.option_index);
    mine.set(row.message_id, list);
  }

  return messages.map((message) =>
    message.poll
      ? { ...message, poll: { ...message.poll, myVotes: mine.get(message.id) ?? [] } }
      : message,
  );
}
