import { query, queryOne, tx } from '../db/pool.js';
import { env } from '../env.js';
import {
  badRequest,
  conflict,
  forbidden,
  HttpError,
  notFound,
  unauthorized,
} from '../lib/errors.js';
import { hashPassword, randomToken, randomUUID, sha256, verifyPassword } from '../lib/crypto.js';
import { signAccessToken } from '../lib/jwt.js';
import type { PublicUser } from '../types.js';
import {
  assertDisplayName,
  assertPassword,
  assertUsername,
  countUsers,
  getUserByUsername,
  toPublicUser,
  type UserRow,
} from './users.js';

const REFRESH_DAYS = env.REFRESH_TOKEN_DAYS;

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
};

export type RegistrationResult =
  | ({ status: 'active' } & TokenPair)
  | { status: 'pending'; user: PublicUser };

async function issueSession(
  user: UserRow,
  meta: { userAgent: string; ip: string },
  family?: string,
): Promise<TokenPair> {
  const refreshToken = randomToken(48);
  const sessionId = await tx(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into sessions (user_id, refresh_hash, family, user_agent, ip)
       values ($1, $2, $3, $4, $5) returning id`,
      [user.id, sha256(refreshToken), family ?? randomUUID(), meta.userAgent, meta.ip],
    );
    return inserted.rows[0]!.id;
  });

  const accessToken = await signAccessToken({
    userId: user.id,
    isAdmin: user.is_admin,
    sessionId,
  });

  return { accessToken, refreshToken, user: toPublicUser(user) };
}

export async function register(input: {
  username: string;
  displayName: string;
  password: string;
  inviteCode?: string;
  userAgent: string;
  ip: string;
}): Promise<RegistrationResult> {
  const username = assertUsername(input.username);
  const displayName = assertDisplayName(input.displayName);
  assertPassword(input.password);

  const total = await countUsers();
  const isFirstUser = total === 0;

  if (!isFirstUser) {
    if (env.REGISTRATION_MODE === 'closed') {
      throw forbidden('ثبت‌نام در این سرور بسته است');
    }
    if (env.REGISTRATION_MODE === 'invite') {
      if (!input.inviteCode) throw forbidden('کد دعوت لازم است');
      await consumeInvite(input.inviteCode.trim().toUpperCase());
    }
  }

  const existing = await getUserByUsername(username);
  if (existing) throw conflict('این شناسه قبلاً ثبت شده است');

  const passwordHash = await hashPassword(input.password);
  const mustWaitForApproval = !isFirstUser && env.REQUIRE_APPROVAL;

  const user = await tx(async (client) => {
    const inserted = await client.query<UserRow>(
      `insert into users (username, display_name, password_hash, is_admin, status)
       values ($1, $2, $3, $4, $5)
       returning id, username, display_name, password_hash, bio, avatar_key,
                 is_admin, status, created_at, last_seen_at, settings`,
      [
        username,
        displayName,
        passwordHash,
        isFirstUser,
        mustWaitForApproval ? 'pending' : 'active',
      ],
    );
    return inserted.rows[0]!;
  });

  if (mustWaitForApproval) {
    return { status: 'pending', user: toPublicUser(user) };
  }

  const session = await issueSession(user, { userAgent: input.userAgent, ip: input.ip });
  return { status: 'active', ...session };
}

async function consumeInvite(code: string): Promise<void> {
  const updated = await query(
    `update invites
     set uses = uses + 1
     where code = $1
       and revoked = false
       and uses < max_uses
       and (expires_at is null or expires_at > now())
     returning code`,
    [code],
  );
  if (updated.length === 0) throw forbidden('کد دعوت معتبر نیست یا منقضی شده است');
}

export async function login(input: {
  username: string;
  password: string;
  userAgent: string;
  ip: string;
}): Promise<TokenPair> {
  const user = await getUserByUsername(input.username.trim());
  if (!user) {
    // Keep timing roughly constant so ids cannot be enumerated quickly.
    await hashPassword(input.password);
    throw unauthorized('شناسه یا گذرواژه نادرست است');
  }

  const valid = await verifyPassword(input.password, user.password_hash);
  if (!valid) throw unauthorized('شناسه یا گذرواژه نادرست است');

  if (user.status === 'pending') {
    throw new HttpError(
      403,
      'pending_approval',
      'حساب شما هنوز تأیید نشده است. پس از تأیید مدیر می‌توانید وارد شوید.',
    );
  }
  if (user.status === 'disabled' || (user.settings && user.settings.disabled === true)) {
    throw forbidden('این حساب غیرفعال شده است');
  }

  await query('update users set last_seen_at = now() where id = $1', [user.id]);
  return issueSession(user, { userAgent: input.userAgent, ip: input.ip });
}

export async function refresh(token: string | undefined, meta: { userAgent: string; ip: string }) {
  if (!token) throw unauthorized('نشست یافت نشد');

  const hash = sha256(token);
  const session = await queryOne<{
    id: string;
    user_id: string;
    family: string;
    revoked_at: Date | null;
  }>('select id, user_id, family, revoked_at from sessions where refresh_hash = $1', [hash]);

  if (!session) throw unauthorized('نشست نامعتبر است');

  if (session.revoked_at) {
    // Token reuse: burn the whole family.
    await query(
      'update sessions set revoked_at = now() where family = $1 and revoked_at is null',
      [session.family],
    );
    throw unauthorized('نشست منقضی شده است، دوباره وارد شوید');
  }

  const user = await queryOne<UserRow>(
    `select id, username, display_name, password_hash, bio, avatar_key,
            is_admin, status, created_at, last_seen_at, settings
     from users where id = $1`,
    [session.user_id],
  );
  if (!user) throw unauthorized('حساب کاربری پیدا نشد');
  if (user.settings && user.settings.disabled === true) throw forbidden('این حساب غیرفعال شده است');
  if (user.status !== 'active') throw forbidden('این حساب فعال نیست');

  await query('update sessions set revoked_at = now() where id = $1', [session.id]);

  const pair = await issueSession(user, meta, session.family);
  return pair;
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await query('update sessions set revoked_at = now() where refresh_hash = $1', [sha256(token)]);
}

export async function listSessions(userId: string) {
  const rows = await query<{
    id: string;
    user_agent: string;
    ip: string;
    created_at: Date;
    last_used_at: Date;
  }>(
    `select id, user_agent, ip, created_at, last_used_at
     from sessions
     where user_id = $1 and revoked_at is null
     order by last_used_at desc`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    userAgent: row.user_agent,
    ip: row.ip,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at.toISOString(),
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const rows = await query(
    'update sessions set revoked_at = now() where id = $1 and user_id = $2 returning id',
    [sessionId, userId],
  );
  if (rows.length === 0) throw notFound('نشست پیدا نشد');
}

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  nextPassword: string,
): Promise<void> {
  assertPassword(nextPassword);
  const user = await queryOne<{ password_hash: string }>(
    'select password_hash from users where id = $1',
    [userId],
  );
  if (!user) throw notFound('کاربر پیدا نشد');

  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) throw badRequest('گذرواژه فعلی نادرست است');

  const hash = await hashPassword(nextPassword);
  await query('update users set password_hash = $1 where id = $2', [hash, userId]);
  await query('update sessions set revoked_at = now() where user_id = $1', [userId]);
}

export const refreshCookieName = 'hssn_rt';
export const refreshCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.PUBLIC_URL.startsWith('https://'),
  path: '/api/auth',
  maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000,
};
