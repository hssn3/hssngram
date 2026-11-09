import { query, queryOne } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { assertMembership } from './chats.js';

export type FolderRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: Date;
};

export async function listFolders(userId: string) {
  const rows = await query<FolderRow & { count: string }>(
    `select f.*, count(i.chat_id)::text as count
     from chat_folders f
     left join chat_folder_items i on i.folder_id = f.id
     where f.user_id = $1
     group by f.id
     order by f.created_at asc`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    count: Number(row.count),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function createFolder(userId: string, name: string) {
  const clean = name.trim().slice(0, 40);
  if (clean.length < 1) throw badRequest('نام پوشه لازم است');

  const existing = await queryOne<{ count: string }>(
    'select count(*)::text as count from chat_folders where user_id = $1',
    [userId],
  );
  if (Number(existing?.count ?? 0) >= 10) throw badRequest('حداکثر ۱۰ پوشه');

  const row = await queryOne<FolderRow>(
    'insert into chat_folders (user_id, name) values ($1, $2) returning *',
    [userId, clean],
  );
  if (!row) throw new Error('failed to create folder');

  return { id: row.id, name: row.name, count: 0, createdAt: row.created_at.toISOString() };
}

export async function deleteFolder(userId: string, folderId: string): Promise<void> {
  const row = await queryOne<FolderRow>('select * from chat_folders where id = $1', [folderId]);
  if (!row) throw notFound('پوشه پیدا نشد');
  if (row.user_id !== userId) throw forbidden('این پوشه برای شما نیست');

  await query('delete from chat_folders where id = $1', [folderId]);
}

export async function addChatToFolder(
  userId: string,
  folderId: string,
  chatId: string,
): Promise<void> {
  const row = await queryOne<FolderRow>('select * from chat_folders where id = $1', [folderId]);
  if (!row) throw notFound('پوشه پیدا نشد');
  if (row.user_id !== userId) throw forbidden('این پوشه برای شما نیست');

  await assertMembership(chatId, userId);
  await query(
    `insert into chat_folder_items (folder_id, chat_id) values ($1, $2) on conflict do nothing`,
    [folderId, chatId],
  );
}

export async function removeChatFromFolder(
  userId: string,
  folderId: string,
  chatId: string,
): Promise<void> {
  const row = await queryOne<FolderRow>('select * from chat_folders where id = $1', [folderId]);
  if (!row) throw notFound('پوشه پیدا نشد');
  if (row.user_id !== userId) throw forbidden('این پوشه برای شما نیست');

  await query('delete from chat_folder_items where folder_id = $1 and chat_id = $2', [
    folderId,
    chatId,
  ]);
}

export async function folderChatIds(userId: string, folderId: string): Promise<string[]> {
  const row = await queryOne<FolderRow>('select * from chat_folders where id = $1', [folderId]);
  if (!row) throw notFound('پوشه پیدا نشد');
  if (row.user_id !== userId) throw forbidden('این پوشه برای شما نیست');

  const rows = await query<{ chat_id: string }>(
    'select chat_id from chat_folder_items where folder_id = $1',
    [folderId],
  );
  return rows.map((item) => item.chat_id);
}
