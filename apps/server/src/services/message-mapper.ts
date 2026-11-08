import { query, queryOne } from '../db/pool.js';
import { signMediaToken } from '../lib/http-tokens.js';
import type { AttachmentDto, MessageDto, ReactionDto } from '../types.js';

export type MessageRow = {
  id: string;
  chat_id: string;
  seq: string | number;
  sender_id: string | null;
  kind: MessageDto['kind'];
  body: string;
  meta: Record<string, unknown> | null;
  reply_to: string | null;
  forward_from_name: string | null;
  group_id: string | null;
  silent: boolean;
  scheduled_at: Date | null;
  edited_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
};

export type AttachmentRow = {
  id: string;
  message_id: string | null;
  name: string;
  mime: string;
  size: string | number;
  kind: AttachmentDto['kind'];
  width: number | null;
  height: number | null;
  duration: string | number | null;
  status: string;
  storage_key: string | null;
};

export type ReactionRow = {
  message_id: string;
  emoji: string;
  user_id: string;
};

export const MESSAGE_COLUMNS = `
  m.id, m.chat_id, m.seq, m.sender_id, m.kind, m.body, m.meta, m.reply_to,
  m.forward_from_name, m.group_id, m.silent, m.scheduled_at,
  m.edited_at, m.deleted_at, m.created_at
`;

export function mapAttachment(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: Number(row.size),
    kind: row.kind,
    url: `/api/media/${row.id}?token=${signMediaToken(row.id)}`,
    width: row.width,
    height: row.height,
    duration: row.duration === null ? null : Number(row.duration),
  };
}

export function mapMessage(
  row: MessageRow,
  attachments: AttachmentRow[] = [],
  reactions: ReactionRow[] = [],
  reply: { id: string; sender_id: string | null; kind: string; body: string } | null = null,
): MessageDto {
  const grouped = new Map<string, string[]>();
  for (const reaction of reactions) {
    const list = grouped.get(reaction.emoji) ?? [];
    list.push(reaction.user_id);
    grouped.set(reaction.emoji, list);
  }

  const reactionDtos: ReactionDto[] = [...grouped.entries()].map(([emoji, userIds]) => ({
    emoji,
    userIds,
  }));

  const rawMeta = (row.meta ?? {}) as {
    options?: string[];
    counts?: number[];
    question?: string;
    multiple?: boolean;
    anonymous?: boolean;
    closed?: boolean;
  };

  const poll =
    row.kind === 'poll' && Array.isArray(rawMeta.options)
      ? {
          question: rawMeta.question ?? '',
          options: rawMeta.options.map((text, index) => ({
            text,
            votes: Number(rawMeta.counts?.[index] ?? 0),
          })),
          totalVotes: (rawMeta.counts ?? []).reduce((sum, value) => sum + Number(value), 0),
          multiple: rawMeta.multiple === true,
          anonymous: rawMeta.anonymous === true,
          closed: rawMeta.closed === true,
          myVotes: [] as number[],
        }
      : null;

  return {
    id: row.id,
    chatId: row.chat_id,
    seq: Number(row.seq),
    senderId: row.sender_id,
    kind: row.kind,
    body: row.deleted_at ? '' : row.body,
    meta: row.deleted_at ? {} : (row.meta ?? {}),
    replyTo: row.deleted_at
      ? null
      : reply
        ? { id: reply.id, senderId: reply.sender_id, kind: reply.kind, body: reply.body }
        : null,
    attachments: row.deleted_at ? [] : attachments.map(mapAttachment),
    reactions: row.deleted_at ? [] : reactionDtos,
    editedAt: row.edited_at ? row.edited_at.toISOString() : null,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    forwardFromName: row.forward_from_name ?? null,
    groupId: row.group_id ?? null,
    silent: row.silent ?? false,
    scheduledAt: row.scheduled_at ? row.scheduled_at.toISOString() : null,
    poll,
  };
}

export async function loadRelations(messageIds: string[]): Promise<{
  attachments: Map<string, AttachmentRow[]>;
  reactions: Map<string, ReactionRow[]>;
  replies: Map<string, { id: string; sender_id: string | null; kind: string; body: string }>;
}> {
  const attachments = new Map<string, AttachmentRow[]>();
  const reactions = new Map<string, ReactionRow[]>();
  const replies = new Map<string, { id: string; sender_id: string | null; kind: string; body: string }>();

  if (messageIds.length === 0) return { attachments, reactions, replies };

  const attachmentRows = await query<AttachmentRow>(
    `select id, message_id, name, mime, size, kind, width, height, duration, status, storage_key
     from attachments
     where message_id = any($1::uuid[]) and status = 'ready'
     order by created_at asc`,
    [messageIds],
  );
  for (const row of attachmentRows) {
    const list = attachments.get(row.message_id!) ?? [];
    list.push(row);
    attachments.set(row.message_id!, list);
  }

  const reactionRows = await query<ReactionRow>(
    'select message_id, emoji, user_id from message_reactions where message_id = any($1::uuid[])',
    [messageIds],
  );
  for (const row of reactionRows) {
    const list = reactions.get(row.message_id) ?? [];
    list.push(row);
    reactions.set(row.message_id, list);
  }

  const replyIds = (
    await query<{ reply_to: string }>(
      'select distinct reply_to from messages where id = any($1::uuid[]) and reply_to is not null',
      [messageIds],
    )
  ).map((row) => row.reply_to);

  if (replyIds.length > 0) {
    const replyRows = await query<{
      id: string;
      sender_id: string | null;
      kind: string;
      body: string;
    }>('select id, sender_id, kind, body from messages where id = any($1::uuid[])', [replyIds]);
    for (const row of replyRows) replies.set(row.id, row);
  }

  return { attachments, reactions, replies };
}

export async function getMessageById(messageId: string): Promise<MessageDto | null> {
  const row = await queryOne<MessageRow>(
    `select ${MESSAGE_COLUMNS} from messages m where m.id = $1`,
    [messageId],
  );
  if (!row) return null;
  const [message] = await hydrateMessages([row]);
  return message ?? null;
}

export async function hydrateMessages(rows: MessageRow[]): Promise<MessageDto[]> {
  const { attachments, reactions, replies } = await loadRelations(rows.map((row) => row.id));
  return rows.map((row) =>
    mapMessage(
      row,
      attachments.get(row.id) ?? [],
      reactions.get(row.id) ?? [],
      row.reply_to ? (replies.get(row.reply_to) ?? null) : null,
    ),
  );
}
