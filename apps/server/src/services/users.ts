import { query, queryOne } from '../db/pool.js';
import { badRequest, notFound } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import type { PublicUser } from '../types.js';

export type UserRow = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  bio: string;
  avatar_key: string | null;
  is_admin: boolean;
  status: 'pending' | 'active' | 'disabled';
  created_at: Date;
  last_seen_at: Date;
  settings: Record<string, unknown>;
};

export const userColumns = `
  u.id, u.username, u.display_name, u.password_hash, u.bio, u.avatar_key,
  u.is_admin, u.status, u.created_at, u.last_seen_at, u.settings
`;

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_key
      ? `/api/avatars/${row.id}?v=${sha256(row.avatar_key).slice(0, 10)}`
      : null,
    isAdmin: row.is_admin,
    lastSeenAt: row.last_seen_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export async function countUsers(): Promise<number> {
  const row = await queryOne<{ count: string }>('select count(*)::text as count from users');
  return Number(row?.count ?? 0);
}

export async function getUserById(id: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`select ${userColumns} from users u where u.id = $1`, [id]);
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`select ${userColumns} from users u where lower(u.username) = lower($1)`, [
    username,
  ]);
}

export async function getPublicUsers(ids: string[]): Promise<PublicUser[]> {
  if (ids.length === 0) return [];
  const rows = await query<UserRow>(
    `select ${userColumns} from users u where u.id = any($1::uuid[])`,
    [ids],
  );
  return rows.map(toPublicUser);
}

export async function insertUser(input: {
  username: string;
  displayName: string;
  passwordHash: string;
  isAdmin: boolean;
  status: 'pending' | 'active';
}): Promise<UserRow> {
  const row = await queryOne<UserRow>(
    `insert into users (username, display_name, password_hash, is_admin, status)
     values ($1, $2, $3, $4, $5)
     returning id, username, display_name, password_hash, bio, avatar_key,
               is_admin, status, created_at, last_seen_at, settings`,
    [input.username, input.displayName, input.passwordHash, input.isAdmin, input.status],
  );
  if (!row) throw new Error('failed to create user');
  return row;
}

export async function updateProfile(
  userId: string,
  patch: { displayName?: string; bio?: string; avatarKey?: string | null },
): Promise<UserRow> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.displayName !== undefined) {
    params.push(patch.displayName);
    sets.push(`display_name = $${params.length}`);
  }
  if (patch.bio !== undefined) {
    params.push(patch.bio);
    sets.push(`bio = $${params.length}`);
  }
  if (patch.avatarKey !== undefined) {
    params.push(patch.avatarKey);
    sets.push(`avatar_key = $${params.length}`);
  }

  if (sets.length === 0) {
    const existing = await getUserById(userId);
    if (!existing) throw notFound('کاربر پیدا نشد');
    return existing;
  }

  params.push(userId);
  const row = await queryOne<UserRow>(
    `update users set ${sets.join(', ')} where id = $${params.length}
     returning id, username, display_name, password_hash, bio, avatar_key,
               is_admin, created_at, last_seen_at, settings`,
    params,
  );
  if (!row) throw notFound('کاربر پیدا نشد');
  return row;
}

export async function searchUsers(
  term: string,
  excludeId: string,
  limit = 20,
): Promise<PublicUser[]> {
  const cleaned = term.trim();
  if (cleaned.length < 2) return [];

  const rows = await query<UserRow>(
    `select ${userColumns} from users u
     where u.id <> $1
       and (u.username ilike $2 or u.display_name ilike $2)
     order by u.display_name asc
     limit $3`,
    [excludeId, `%${cleaned.replace(/[%_]/g, '\\$&')}%`, limit],
  );
  return rows.map(toPublicUser);
}

export async function touchLastSeen(userId: string): Promise<void> {
  await query('update users set last_seen_at = now() where id = $1', [userId]);
}

export async function changePassword(userId: string, passwordHash: string): Promise<void> {
  await query('update users set password_hash = $1 where id = $2', [passwordHash, userId]);
}

export function assertDisplayName(name: string): string {
  const value = name.trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > 64) {
    throw badRequest('نام نمایشی باید بین ۲ تا ۶۴ نویسه باشد');
  }
  return value;
}

export function assertUsername(username: string): string {
  const value = username.trim();
  if (!/^\d{8}$/.test(value)) {
    throw badRequest('شناسه ورود باید یک عدد ۸ رقمی باشد');
  }
  return value;
}

export function assertPassword(password: string): void {
  if (password.length < 6) throw badRequest('گذرواژه باید حداقل ۶ نویسه باشد');
  if (password.length > 200) throw badRequest('گذرواژه بیش از حد بلند است');
}
