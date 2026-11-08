import { randomUUID } from 'node:crypto';
import { query, queryOne } from '../db/pool.js';
import { uploadLimitBytes } from '../env.js';
import { badRequest, forbidden, notFound, payloadTooLarge } from '../lib/errors.js';
import { extensionFor, kindForMime, signMediaToken } from '../lib/http-tokens.js';
import { storage } from '../storage/index.js';
import type { AttachmentDto, MessageDto } from '../types.js';

const BLOCKED_EXTENSIONS = [
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.vbs', '.js', '.jse',
  '.wsf', '.wsh', '.ps1', '.psm1', '.jar', '.reg', '.hta', '.cpl', '.dll',
];

export type AttachmentRecord = {
  id: string;
  owner_id: string | null;
  message_id: string | null;
  name: string;
  mime: string;
  size: string | number;
  kind: AttachmentDto['kind'];
  storage_key: string | null;
  width: number | null;
  height: number | null;
  duration: string | number | null;
  status: 'pending' | 'ready';
};

function sanitizeName(name: string): string {
  const base = name.replace(/[\\/\u0000-\u001f]/g, '_').trim();
  return base.slice(0, 160) || 'file';
}

function assertAllowed(name: string, mime: string): void {
  const lower = name.toLowerCase();
  if (BLOCKED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    throw badRequest('ارسال فایل‌های اجرایی مجاز نیست');
  }
  if (!mime || mime.length > 120) throw badRequest('نوع فایل نامعتبر است');
}

export async function initUpload(input: {
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  kind?: AttachmentDto['kind'];
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}): Promise<{
  id: string;
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  maxSize: number;
}> {
  const name = sanitizeName(input.name);
  assertAllowed(name, input.mime);

  const size = Math.floor(input.size);
  if (!Number.isFinite(size) || size <= 0) throw badRequest('حجم فایل نامعتبر است');
  if (size > uploadLimitBytes) throw payloadTooLarge();

  const derivedKind = kindForMime(input.mime);
  const kind = input.kind === 'voice' ? 'voice' : derivedKind;

  const key = `${input.ownerId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${extensionFor(
    input.mime,
  )}`;

  const inserted = await queryOne<{ id: string }>(
    `insert into attachments (owner_id, name, mime, size, kind, storage_key, width, height, duration, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
     returning id`,
    [
      input.ownerId,
      name,
      input.mime,
      size,
      kind,
      key,
      input.width ?? null,
      input.height ?? null,
      input.duration ?? null,
    ],
  );
  if (!inserted) throw new Error('failed to create attachment');

  const target = await storage().uploadTarget(key, input.mime);

  return {
    id: inserted.id,
    uploadUrl: target.url,
    method: target.method,
    headers: target.headers,
    maxSize: uploadLimitBytes,
  };
}

export async function completeUpload(id: string, ownerId: string): Promise<AttachmentDto> {
  const row = await queryOne<AttachmentRecord>('select * from attachments where id = $1', [id]);
  if (!row) throw notFound('فایل پیدا نشد');
  if (row.owner_id !== ownerId) throw forbidden('این فایل متعلق به شما نیست');

  if (row.status === 'pending') {
    if (!row.storage_key) throw badRequest('فایل بارگذاری نشده است');
    const info = await storage().stat(row.storage_key);
    if (!info || info.size === 0) throw badRequest('فایل روی سرور پیدا نشد');
    if (info.size > uploadLimitBytes) {
      await storage().remove(row.storage_key);
      throw payloadTooLarge();
    }

    await query(`update attachments set status = 'ready', size = $2 where id = $1`, [
      id,
      info.size,
    ]);
    row.size = info.size;
    row.status = 'ready';
  }

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

export async function getAttachment(id: string): Promise<AttachmentRecord | null> {
  return queryOne<AttachmentRecord>('select * from attachments where id = $1', [id]);
}

export async function canAccessAttachment(
  attachment: AttachmentRecord,
  userId: string,
): Promise<boolean> {
  if (attachment.status !== 'ready') return false;
  if (attachment.owner_id === userId) return true;
  if (!attachment.message_id) return false;

  const row = await queryOne<{ ok: boolean }>(
    `select exists(
       select 1 from messages m
       join chat_members cm on cm.chat_id = m.chat_id
       where m.id = $1 and cm.user_id = $2
     ) as ok`,
    [attachment.message_id, userId],
  );
  return Boolean(row?.ok);
}

export function attachmentKindLabel(kind: MessageDto['kind']): string {
  switch (kind) {
    case 'image':
      return 'تصویر';
    case 'video':
      return 'ویدیو';
    case 'audio':
      return 'صدا';
    case 'voice':
      return 'پیام صوتی';
    default:
      return 'فایل';
  }
}
