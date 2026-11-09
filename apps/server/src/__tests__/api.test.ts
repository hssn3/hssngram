import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-value-0123456789';
process.env.REGISTRATION_MODE = 'open';
process.env.REQUIRE_APPROVAL = 'true';
process.env.STORAGE_DRIVER = 'local';
process.env.PG_POOL_MAX = '4';
process.env.TURN_URLS = 'turn:turn.example.com:3478';
process.env.TURN_SECRET = 'turn-secret';
process.env.STUN_URLS = 'stun:stun.example.com:3478';

const uploadDir = await mkdtemp(join(tmpdir(), 'hssngram-uploads-'));
process.env.LOCAL_STORAGE_DIR = uploadDir;

const { PGlite } = await import('@electric-sql/pglite');
const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');

const pglite = await PGlite.create();
const socketServer = new PGLiteSocketServer({
  db: pglite,
  port: 0,
  host: '127.0.0.1',
  maxConnections: 4,
});
await socketServer.start();
const serverConn = socketServer.getServerConn();
const [pgHost, pgPort] = serverConn.split(':');
process.env.DATABASE_URL = `postgres://postgres@${pgHost}:${pgPort}/postgres`;

const { runMigrations } = await import('../db/migrate.js');
const { createApp } = await import('../http/app.js');
const { closePool } = await import('../db/pool.js');

await runMigrations(false);

const httpServer: Server = createServer(createApp());
await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
const address = httpServer.address();
if (!address || typeof address === 'string') throw new Error('no port');
const base = `http://127.0.0.1:${address.port}`;

type Json = Record<string, any>;

async function call(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; raw?: Buffer; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Json; headers: Headers }> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });

  const text = await response.text();
  let body: Json = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body, headers: response.headers };
}

after(async () => {
  await closePool();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await socketServer.stop();
  await pglite.close();
  await rm(uploadDir, { recursive: true, force: true });
});

const state: {
  adminToken?: string;
  adminRefresh?: string;
  bobToken?: string;
  carolToken?: string;
  bobId?: string;
  carolId?: string;
  chatId?: string;
  messageId?: string;
  attachmentId?: string;
  mediaUrl?: string;
  newUserId?: string;
} = {};

test('health endpoint responds', async () => {
  const result = await call('GET', '/api/health');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test('the first account is the active admin', async () => {
  const result = await call('POST', '/api/auth/register', {
    body: { loginId: '10000000', displayName: 'حسن', password: '427726' },
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.user.isAdmin, true);
  assert.equal(result.body.user.username, '10000000');

  const cookies = result.headers.getSetCookie();
  assert.equal(cookies.length, 1);
  assert.match(cookies[0]!, /hssn_rt=/);

  state.adminToken = result.body.accessToken;
  state.adminRefresh = cookies[0]!.split(';')[0]!;
});

test('a new numeric id registers as pending and cannot log in yet', async () => {
  const registered = await call('POST', '/api/auth/register', {
    body: { loginId: '20000000', displayName: 'باب', password: 'bobpass' },
  });
  assert.equal(registered.status, 202);
  assert.equal(registered.body.status, 'pending');

  const login = await call('POST', '/api/auth/login', {
    body: { loginId: '20000000', password: 'bobpass' },
  });
  assert.equal(login.status, 403);
  assert.equal(login.body.error, 'pending_approval');

  const invalid = await call('POST', '/api/auth/register', {
    body: { loginId: '1234', displayName: 'کوتاه', password: 'short1' },
  });
  assert.equal(invalid.status, 400);
});

test('the admin sees pending users and can approve them', async () => {
  const pending = await call('GET', '/api/admin/users?status=pending', {
    token: state.adminToken,
  });
  assert.equal(pending.status, 200);
  assert.equal(pending.body.users.length, 1);
  assert.equal(pending.body.users[0].username, '20000000');

  state.bobId = pending.body.users[0].id;

  const approved = await call('PATCH', `/api/admin/users/${state.bobId}`, {
    token: state.adminToken,
    body: { status: 'active' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.user.status, 'active');

  const login = await call('POST', '/api/auth/login', {
    body: { loginId: '20000000', password: 'bobpass' },
  });
  assert.equal(login.status, 200);
  state.bobToken = login.body.accessToken;
});

test('wrong password is rejected', async () => {
  const result = await call('POST', '/api/auth/login', {
    body: { loginId: '20000000', password: 'not-my-password' },
  });
  assert.equal(result.status, 401);
});

test('refresh token rotates the session', async () => {
  const result = await call('POST', '/api/auth/refresh', {
    headers: { cookie: state.adminRefresh! },
  });
  assert.equal(result.status, 200);
  assert.ok(result.body.accessToken);
  assert.notEqual(result.body.accessToken, state.adminToken);
  state.adminToken = result.body.accessToken;
});

test('me returns the authenticated profile', async () => {
  const result = await call('GET', '/api/auth/me', { token: state.adminToken });
  assert.equal(result.status, 200);
  assert.equal(result.body.user.displayName, 'حسن');
});

test('users can be searched by display name', async () => {
  const result = await call('GET', '/api/users/search?q=باب', { token: state.adminToken });
  assert.equal(result.status, 200);
  assert.equal(result.body.users.length, 1);
  assert.equal(result.body.users[0].username, '20000000');

  const registered = await call('POST', '/api/auth/register', {
    body: { loginId: '30000000', displayName: 'کارول', password: 'carolpass' },
  });
  assert.equal(registered.status, 202);
  state.carolId = registered.body.user.id;
});

test('an approved third user can join the conversation', async () => {
  const approved = await call('PATCH', `/api/admin/users/${state.carolId}`, {
    token: state.adminToken,
    body: { status: 'active' },
  });
  assert.equal(approved.status, 200);

  const login = await call('POST', '/api/auth/login', {
    body: { loginId: '30000000', password: 'carolpass' },
  });
  assert.equal(login.status, 200);
  state.carolToken = login.body.accessToken;
});

test('a direct chat can be created once per pair', async () => {
  const carol = await call('GET', '/api/users/search?q=کارول', { token: state.adminToken });
  const carolId = carol.body.users[0].id as string;

  const first = await call('POST', '/api/chats/direct', {
    token: state.adminToken,
    body: { userId: carolId },
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.chat.type, 'direct');
  assert.equal(first.body.chat.members.length, 2);

  const second = await call('POST', '/api/chats/direct', {
    token: state.adminToken,
    body: { userId: carolId },
  });
  assert.equal(second.body.chat.id, first.body.chat.id);

  state.chatId = first.body.chat.id;
});

test('messages are stored with a per-chat sequence and unread counts', async () => {
  const sent = await call('POST', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
    body: { body: 'سلام کارول، خوش آمدی', clientId: 'c-1' },
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.seq, 1);
  assert.equal(sent.body.message.kind, 'text');
  state.messageId = sent.body.message.id;

  const bobChats = await call('GET', '/api/chats', { token: state.bobToken });
  assert.equal(bobChats.body.chats.length, 0, 'unrelated user must not see the chat');

  const carolChats = await call('GET', '/api/chats', { token: state.carolToken });
  assert.equal(carolChats.body.chats.length, 1);
  assert.equal(carolChats.body.chats[0].unread, 1);
  assert.equal(carolChats.body.chats[0].title, 'حسن');

  const read = await call('POST', `/api/chats/${state.chatId}/read`, {
    token: state.carolToken,
    body: { seq: 1 },
  });
  assert.equal(read.status, 200);

  const afterRead = await call('GET', '/api/chats', { token: state.carolToken });
  assert.equal(afterRead.body.chats[0].unread, 0);
});

test('outsiders cannot read messages of a chat', async () => {
  const result = await call('GET', `/api/chats/${state.chatId}/messages`, {
    token: state.bobToken,
  });
  assert.equal(result.status, 403);
});

test('replies, edits and reactions work with the right permissions', async () => {
  const reply = await call('POST', `/api/chats/${state.chatId}/messages`, {
    token: state.carolToken,
    body: { body: 'ممنون حسن جان', replyToId: state.messageId },
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.message.replyTo.id, state.messageId);

  const edited = await call('PATCH', `/api/messages/${state.messageId}`, {
    token: state.adminToken,
    body: { body: 'سلام کارول، خوش آمدی 🌹' },
  });
  assert.equal(edited.status, 200);
  assert.ok(edited.body.message.editedAt);

  const forbiddenEdit = await call('PATCH', `/api/messages/${state.messageId}`, {
    token: state.carolToken,
    body: { body: 'دستکاری' },
  });
  assert.equal(forbiddenEdit.status, 403);

  const reaction = await call('POST', `/api/messages/${reply.body.message.id}/reactions`, {
    token: state.adminToken,
    body: { emoji: '❤️' },
  });
  assert.equal(reaction.status, 200);
  assert.equal(reaction.body.userIds.length, 1);

  const removed = await call('POST', `/api/messages/${reply.body.message.id}/reactions`, {
    token: state.adminToken,
    body: { emoji: '❤️' },
  });
  assert.equal(removed.body.userIds.length, 0);
});

test('file upload, attachment message and signed media access', async () => {
  const payload = Buffer.from('سلام حسن‌گرام — تست فایل', 'utf8');

  const init = await call('POST', '/api/uploads/init', {
    token: state.adminToken,
    body: { name: 'khosh-amadid.txt', mime: 'text/plain', size: payload.length },
  });
  assert.equal(init.status, 201);
  assert.equal(init.body.method, 'PUT');

  const upload = await fetch(`${base}${init.body.uploadUrl}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      authorization: `Bearer ${state.adminToken}`,
    },
    body: payload,
  });
  assert.equal(upload.status, 200);

  const complete = await call('POST', `/api/uploads/${init.body.id}/complete`, {
    token: state.adminToken,
  });
  assert.equal(complete.status, 200);
  assert.equal(complete.body.attachment.size, payload.length);

  const message = await call('POST', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
    body: { body: 'این هم فایل', attachmentIds: [init.body.id] },
  });
  assert.equal(message.status, 201);
  assert.equal(message.body.message.kind, 'file');
  assert.equal(message.body.message.attachments.length, 1);

  state.attachmentId = init.body.id;
  state.mediaUrl = message.body.message.attachments[0].url as string;

  const media = await fetch(`${base}${state.mediaUrl}`);
  assert.equal(media.status, 200);
  assert.equal(await media.text(), payload.toString('utf8'));

  const unsigned = await fetch(`${base}/api/media/${state.attachmentId}`);
  assert.equal(unsigned.status, 403);
});

test('groups are created with a system message and membership controls', async () => {
  const bob = await call('GET', '/api/users/search?q=باب', { token: state.adminToken });
  const bobId = bob.body.users[0].id as string;

  const group = await call('POST', '/api/chats/group', {
    token: state.adminToken,
    body: { title: 'خانواده', memberIds: [bobId] },
  });
  assert.equal(group.status, 201);
  assert.equal(group.body.chat.type, 'group');
  assert.equal(group.body.chat.title, 'خانواده');

  const messages = await call('GET', `/api/chats/${group.body.chat.id}/messages`, {
    token: state.adminToken,
  });
  assert.equal(messages.body.messages[0].kind, 'system');

  const leave = await call('POST', `/api/chats/${group.body.chat.id}/leave`, {
    token: state.bobToken,
  });
  assert.equal(leave.status, 200);

  const bobChats = await call('GET', '/api/chats', { token: state.bobToken });
  assert.equal(bobChats.body.chats.length, 0);
});

test('call lifecycle exposes ICE servers and participants', async () => {
  const ice = await call('GET', '/api/calls/ice', { token: state.adminToken });
  assert.equal(ice.status, 200);
  assert.ok(ice.body.iceServers.length >= 2);
  const turn = ice.body.iceServers.find((server: Json) => server.username);
  assert.ok(turn, 'TURN credentials must be minted');
  assert.match(turn.username, /^\d+:/);

  const started = await call('POST', '/api/calls', {
    token: state.adminToken,
    body: { chatId: state.chatId, kind: 'video' },
  });
  assert.equal(started.status, 201);
  assert.equal(started.body.call.status, 'ringing');

  const joined = await call('POST', `/api/calls/${started.body.call.id}/join`, {
    token: state.carolToken,
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.call.status, 'active');
  assert.equal(joined.body.participants.length, 2);

  const ended = await call('POST', `/api/calls/${started.body.call.id}/end`, {
    token: state.adminToken,
  });
  assert.equal(ended.status, 200);
  assert.equal(ended.body.call.status, 'ended');
});

test('deleting a message clears its content for everyone', async () => {
  const deleted = await call('DELETE', `/api/messages/${state.messageId}`, {
    token: state.adminToken,
  });
  assert.equal(deleted.status, 200);
  assert.ok(deleted.body.message.deletedAt);
  assert.equal(deleted.body.message.body, '');
});

test('message search finds Persian text', async () => {
  const result = await call('GET', '/api/search?q=' + encodeURIComponent('ممنون'), {
    token: state.carolToken,
  });
  assert.equal(result.status, 200);
  assert.ok(result.body.messages.length >= 1);
});

test('disabling a user revokes access immediately', async () => {
  const disabled = await call('PATCH', `/api/admin/users/${state.bobId}`, {
    token: state.adminToken,
    body: { status: 'disabled' },
  });
  assert.equal(disabled.status, 200);

  const me = await call('GET', '/api/auth/me', { token: state.bobToken });
  assert.equal(me.status, 200, 'access token stays valid until it expires');

  const login = await call('POST', '/api/auth/login', {
    body: { loginId: '20000000', password: 'bobpass' },
  });
  assert.equal(login.status, 403);
});

test('admin overview reports counts', async () => {
  const result = await call('GET', '/api/admin/overview', { token: state.adminToken });
  assert.equal(result.status, 200);
  assert.equal(result.body.users, 3);
  assert.ok(result.body.messages >= 3);

  const denied = await call('GET', '/api/admin/overview', { token: state.carolToken });
  assert.equal(denied.status, 403);
});

test('admin can add and delete a user directly', async () => {
  const created = await call('POST', '/api/admin/users', {
    token: state.adminToken,
    body: { loginId: '60000000', displayName: 'مهمان موقت', password: 'temp12345' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.status, 'active');

  const login = await call('POST', '/api/auth/login', {
    body: { loginId: '60000000', password: 'temp12345' },
  });
  assert.equal(login.status, 200);

  const removed = await call('DELETE', `/api/admin/users/${created.body.user.id}`, {
    token: state.adminToken,
  });
  assert.equal(removed.status, 200);

  const after = await call('POST', '/api/auth/login', {
    body: { loginId: '60000000', password: 'temp12345' },
  });
  assert.equal(after.status, 401);
});

test('a guest can chat with the admin and be converted into a user', async () => {
  const started = await call('POST', '/api/support/start', {
    body: { displayName: 'مهمان سایت', note: 'از صفحه پشتیبانی' },
  });
  assert.equal(started.status, 201);

  const cookie = started.headers.getSetCookie()[0]!.split(';')[0]!;
  assert.match(cookie, /hssn_guest=/);

  const guestMessage = await call('POST', '/api/support/messages', {
    body: { body: 'سلام، چطور می‌توانم عضو شوم؟' },
    headers: { cookie },
  });
  assert.equal(guestMessage.status, 201);

  const threads = await call('GET', '/api/admin/support', { token: state.adminToken });
  assert.equal(threads.status, 200);
  assert.equal(threads.body.threads.length, 1);
  assert.equal(threads.body.threads[0].unreadForAdmin, 1);

  const forbidden = await call('GET', '/api/admin/support', { token: state.carolToken });
  assert.equal(forbidden.status, 403, 'normal users must not read the support inbox');

  const threadId = threads.body.threads[0].id as string;
  const detail = await call('GET', `/api/admin/support/${threadId}`, { token: state.adminToken });
  assert.equal(detail.body.messages.at(-1).body, 'سلام، چطور می‌توانم عضو شوم؟');

  const reply = await call('POST', `/api/admin/support/${threadId}/messages`, {
    token: state.adminToken,
    body: { body: 'سلام! یک شناسه ۸ رقمی برایت می‌سازم.' },
  });
  assert.equal(reply.status, 201);

  const guestView = await call('GET', '/api/support/session', { headers: { cookie } });
  assert.equal(guestView.body.messages.at(-1).author, 'admin');

  const converted = await call('POST', `/api/admin/support/${threadId}/convert`, {
    token: state.adminToken,
    body: { loginId: '40000000', password: 'guest12345', displayName: 'مهمان تازه' },
  });
  assert.equal(converted.status, 201);
  assert.equal(converted.body.loginId, '40000000');

  const newUserLogin = await call('POST', '/api/auth/login', {
    body: { loginId: '40000000', password: 'guest12345' },
  });
  assert.equal(newUserLogin.status, 200);
  state.newUserId = newUserLogin.body.user.id;

  const chats = await call('GET', '/api/chats', { token: newUserLogin.body.accessToken });
  assert.equal(chats.body.chats.length, 1);
  assert.equal(chats.body.chats[0].type, 'direct');
});

test('messages can be forwarded, pinned and hidden per user', async () => {
  const sent = await call('POST', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
    body: { body: 'پیامی برای هدایت و سنجاق' },
  });
  assert.equal(sent.status, 201);
  const messageId = sent.body.message.id as string;

  const direct = await call('POST', '/api/chats/direct', {
    token: state.adminToken,
    body: { userId: state.newUserId },
  });
  assert.equal(direct.status, 201);
  const targetChatId = direct.body.chat.id as string;

  const forwarded = await call('POST', `/api/messages/${messageId}/forward`, {
    token: state.adminToken,
    body: { chatId: targetChatId },
  });
  assert.equal(forwarded.status, 201);
  assert.match(forwarded.body.message.forwardFromName, /حسن/);

  const pinned = await call('POST', `/api/chats/${targetChatId}/pin`, {
    token: state.adminToken,
    body: { messageId: forwarded.body.message.id },
  });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.body.chat.pinnedMessage.id, forwarded.body.message.id);

  const hidden = await call('DELETE', `/api/messages/${messageId}?scope=me`, {
    token: state.adminToken,
  });
  assert.equal(hidden.status, 200);

  const listed = await call('GET', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
  });
  assert.equal(listed.body.messages.some((message: Json) => message.id === messageId), false);

  const stillThere = await call('GET', `/api/chats/${state.chatId}/messages`, {
    token: state.carolToken,
  });
  assert.equal(stillThere.body.messages.some((message: Json) => message.id === messageId), true);
});

test('in-chat search returns only that chat messages', async () => {
  const result = await call(
    'GET',
    `/api/chats/${state.chatId}/search?q=${encodeURIComponent('سنجاق')}`,
    { token: state.carolToken },
  );
  assert.equal(result.status, 200);
  assert.ok(result.body.messages.length >= 1);
  assert.ok(result.body.messages.every((message: Json) => message.chatId === state.chatId));
});

test('albums, silent flags and polls work end to end', async () => {
  const first = Buffer.from('album-a', 'utf8');
  const second = Buffer.from('album-b', 'utf8');
  const ids: string[] = [];

  for (const [name, payload] of [
    ['a.txt', first],
    ['b.txt', second],
  ] as const) {
    const init = await call('POST', '/api/uploads/init', {
      token: state.adminToken,
      body: { name, mime: 'text/plain', size: payload.length },
    });
    await fetch(`${base}${init.body.uploadUrl}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        authorization: `Bearer ${state.adminToken}`,
      },
      body: payload,
    });
    await call('POST', `/api/uploads/${init.body.id}/complete`, { token: state.adminToken });
    ids.push(init.body.id);
  }

  const album = await call('POST', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
    body: { body: 'آلبوم', attachmentIds: ids, silent: true },
  });
  assert.equal(album.status, 201);
  assert.ok(album.body.message.groupId, 'two attachments must share a group id');
  assert.equal(album.body.message.silent, true);
  assert.equal(album.body.message.attachments.length, 2);

  const poll = await call('POST', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
    body: {
      kind: 'poll',
      body: 'ناهار چی بخوریم؟',
      meta: { options: ['قرمه', 'کوکو'], multiple: false, anonymous: false },
    },
  });
  assert.equal(poll.status, 201);
  assert.equal(poll.body.message.poll.options.length, 2);

  const vote = await call('POST', `/api/messages/${poll.body.message.id}/vote`, {
    token: state.carolToken,
    body: { optionIndex: 1 },
  });
  assert.equal(vote.status, 200);
  assert.deepEqual(vote.body.counts, [0, 1]);
  assert.deepEqual(vote.body.myVotes, [1]);

  const toggle = await call('POST', `/api/messages/${poll.body.message.id}/vote`, {
    token: state.carolToken,
    body: { optionIndex: 1 },
  });
  assert.deepEqual(toggle.body.counts, [0, 0]);

  const media = await call('GET', `/api/chats/${state.chatId}/media?kind=file`, {
    token: state.adminToken,
  });
  assert.equal(media.status, 200);
  assert.ok(media.body.items.length >= 2);
});

test('scheduled messages stay hidden until published', async () => {
  const sendAt = new Date(Date.now() + 60_000).toISOString();
  const scheduled = await call('POST', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
    body: { body: 'پیام آینده', scheduledAt: sendAt },
  });
  assert.equal(scheduled.status, 202);
  assert.ok(scheduled.body.message.scheduledAt);

  const visible = await call('GET', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
  });
  assert.equal(
    visible.body.messages.some((message: Json) => message.id === scheduled.body.message.id),
    false,
  );

  const list = await call('GET', `/api/chats/${state.chatId}/scheduled`, {
    token: state.adminToken,
  });
  assert.equal(list.body.messages.length, 1);

  const cancel = await call('DELETE', `/api/messages/${scheduled.body.message.id}/scheduled`, {
    token: state.adminToken,
  });
  assert.equal(cancel.status, 200);
});

test('chat TTL marks new messages for auto deletion', async () => {
  const ttl = await call('POST', `/api/chats/${state.chatId}/ttl`, {
    token: state.adminToken,
    body: { seconds: 3600 },
  });
  assert.equal(ttl.status, 200);

  const sent = await call('POST', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
    body: { body: 'این پیام خودتخریب است' },
  });
  assert.equal(sent.status, 201);

  const readBack = await call('GET', `/api/chats/${state.chatId}/ttl`, {
    token: state.adminToken,
  });
  assert.equal(readBack.body.ttlSeconds, 3600);

  await call('POST', `/api/chats/${state.chatId}/ttl`, {
    token: state.adminToken,
    body: { seconds: 0 },
  });
});

test('privacy switches, blocking and data export', async () => {
  const privacy = await call('PATCH', '/api/users/privacy', {
    token: state.carolToken,
    body: { lastSeen: 'nobody', readReceipts: false },
  });
  assert.equal(privacy.status, 200);
  assert.equal(privacy.body.privacy.lastSeen, 'nobody');

  const blocked = await call('POST', `/api/users/${state.newUserId}/block`, {
    token: state.carolToken,
  });
  assert.equal(blocked.status, 200);

  const list = await call('GET', '/api/users/blocked', { token: state.carolToken });
  assert.equal(list.body.users.length, 1);

  const denied = await call('POST', '/api/chats/direct', {
    token: state.carolToken,
    body: { userId: state.newUserId },
  });
  assert.equal(denied.status, 403);

  const unblocked = await call('DELETE', `/api/users/${state.newUserId}/block`, {
    token: state.carolToken,
  });
  assert.equal(unblocked.status, 200);

  const exported = await call('GET', '/api/export', { token: state.adminToken });
  assert.equal(exported.status, 200);
  assert.ok(exported.body.chats.length >= 1);
});

test('saved messages is a chat with yourself', async () => {
  const me = await call('GET', '/api/auth/me', { token: state.adminToken });
  const chat = await call('POST', '/api/chats/direct', {
    token: state.adminToken,
    body: { userId: me.body.user.id },
  });
  assert.equal(chat.status, 201);
  assert.equal(chat.body.chat.members.length, 1);

  const sent = await call('POST', `/api/chats/${chat.body.chat.id}/messages`, {
    token: state.adminToken,
    body: { body: 'یادداشت شخصی' },
  });
  assert.equal(sent.status, 201);

  const media = await call('GET', `/api/chats/${chat.body.chat.id}/media?kind=image`, {
    token: state.adminToken,
  });
  assert.equal(media.status, 200);
});

test('channels are read-only for members and support invite links', async () => {
  const channel = await call('POST', '/api/chats/channel', {
    token: state.adminToken,
    body: { title: 'کانال خانواده' },
  });
  assert.equal(channel.status, 201);
  assert.equal(channel.body.chat.type, 'channel');

  const channelId = channel.body.chat.id as string;
  const posted = await call('POST', `/api/chats/${channelId}/messages`, {
    token: state.adminToken,
    body: { body: 'اولین پست کانال' },
  });
  assert.equal(posted.status, 201);

  const invite = await call('POST', `/api/chats/${channelId}/invites`, {
    token: state.adminToken,
    body: { maxUses: 1, expiresInHours: 24 },
  });
  assert.equal(invite.status, 201);

  const joined = await call('POST', `/api/invites/${invite.body.token}/join`, {
    token: state.carolToken,
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.chat.id, channelId);

  const deniedPost = await call('POST', `/api/chats/${channelId}/messages`, {
    token: state.carolToken,
    body: { body: 'من هم می‌نویسم' },
  });
  assert.equal(deniedPost.status, 403);

  const exhausted = await call('POST', `/api/invites/${invite.body.token}/join`, {
    token: state.bobToken,
  });
  assert.notEqual(exhausted.status, 200);
});

test('slow mode and member rights are enforced server-side', async () => {
  const group = await call('POST', '/api/chats/group', {
    token: state.adminToken,
    body: { title: 'گروه آهسته', memberIds: [state.carolId] },
  });
  assert.equal(group.status, 201);
  const groupId = group.body.chat.id as string;

  const slow = await call('POST', `/api/chats/${groupId}/slowmode`, {
    token: state.adminToken,
    body: { seconds: 60 },
  });
  assert.equal(slow.status, 200);

  const first = await call('POST', `/api/chats/${groupId}/messages`, {
    token: state.carolToken,
    body: { body: 'پیام اول' },
  });
  assert.equal(first.status, 201);

  const second = await call('POST', `/api/chats/${groupId}/messages`, {
    token: state.carolToken,
    body: { body: 'پیام دوم' },
  });
  assert.equal(second.status, 400);

  const ownerPost = await call('POST', `/api/chats/${groupId}/messages`, {
    token: state.adminToken,
    body: { body: 'مدیر معاف است' },
  });
  assert.equal(ownerPost.status, 201);

  const muted = await call('PATCH', `/api/chats/${groupId}/members/${state.carolId}`, {
    token: state.adminToken,
    body: { rights: { sendMessages: false } },
  });
  assert.equal(muted.status, 200);

  await call('POST', `/api/chats/${groupId}/slowmode`, {
    token: state.adminToken,
    body: { seconds: 0 },
  });

  const blocked = await call('POST', `/api/chats/${groupId}/messages`, {
    token: state.carolToken,
    body: { body: 'باید رد شود' },
  });
  assert.equal(blocked.status, 403);
});

test('forwarding can hide the original author', async () => {
  const sent = await call('POST', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
    body: { body: 'برای فوروارد بی‌نام' },
  });
  assert.equal(sent.status, 201);

  const forwarded = await call('POST', `/api/messages/${sent.body.message.id}/forward`, {
    token: state.adminToken,
    body: { chatId: state.chatId, hideAuthor: true },
  });
  assert.equal(forwarded.status, 201);
  assert.equal(forwarded.body.message.forwardFromName, null);
});

test('archive listing, clear history and filtered search', async () => {
  const archived = await call('GET', '/api/chats?archived=true', { token: state.adminToken });
  assert.equal(archived.status, 200);

  const flag = await call('POST', `/api/chats/${state.chatId}/archive`, {
    token: state.adminToken,
    body: { archived: true },
  });
  assert.equal(flag.status, 200);

  const archivedNow = await call('GET', '/api/chats?archived=true', { token: state.adminToken });
  assert.ok(archivedNow.body.chats.some((chat: Json) => chat.id === state.chatId));

  const restored = await call('POST', `/api/chats/${state.chatId}/archive`, {
    token: state.adminToken,
    body: { archived: false },
  });
  assert.equal(restored.status, 200);

  const filtered = await call('GET', '/api/search?q=' + encodeURIComponent('فایل') + '&kind=file', {
    token: state.adminToken,
  });
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.messages.every((message: Json) => message.kind === 'file'));

  const cleared = await call('DELETE', `/api/chats/${state.chatId}/messages`, {
    token: state.carolToken,
  });
  assert.equal(cleared.status, 200);

  const afterClear = await call('GET', `/api/chats/${state.chatId}/messages`, {
    token: state.carolToken,
  });
  assert.ok(afterClear.body.messages.length < 5);

  const stillVisible = await call('GET', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
  });
  assert.ok(stillVisible.body.messages.length >= 5);
});

test('invite links can be listed and revoked', async () => {
  const channel = await call('POST', '/api/chats/channel', {
    token: state.adminToken,
    body: { title: 'کانال لینک‌دار' },
  });
  const channelId = channel.body.chat.id as string;

  const invite = await call('POST', `/api/chats/${channelId}/invites`, {
    token: state.adminToken,
    body: { maxUses: 5, expiresInHours: 24 },
  });
  assert.equal(invite.status, 201);

  const list = await call('GET', `/api/chats/${channelId}/invites`, {
    token: state.adminToken,
  });
  assert.equal(list.status, 200);
  assert.equal(list.body.invites.length, 1);

  const revoke = await call('DELETE', `/api/chats/${channelId}/invites/${invite.body.token}`, {
    token: state.adminToken,
  });
  assert.equal(revoke.status, 200);

  const join = await call('POST', `/api/invites/${invite.body.token}/join`, {
    token: state.carolToken,
  });
  assert.notEqual(join.status, 200);
});

test('chat stats, shared links and read-all', async () => {
  const stats = await call('GET', `/api/chats/${state.chatId}/stats`, {
    token: state.adminToken,
  });
  assert.equal(stats.status, 200);
  assert.ok(stats.body.stats.messages >= 1);
  assert.equal(stats.body.stats.members, 2);

  const sent = await call('POST', `/api/chats/${state.chatId}/messages`, {
    token: state.adminToken,
    body: { body: 'این هم یک لینک https://example.com/test است' },
  });
  assert.equal(sent.status, 201);

  const links = await call('GET', `/api/chats/${state.chatId}/links`, {
    token: state.adminToken,
  });
  assert.equal(links.status, 200);
  assert.ok(links.body.links.some((link: Json) => String(link.url).includes('example.com')));

  const readAll = await call('POST', '/api/chats/read-all', { token: state.carolToken });
  assert.equal(readAll.status, 200);

  const account = await call('GET', '/api/me/stats', { token: state.adminToken });
  assert.ok(account.body.stats.chats >= 1);
});
