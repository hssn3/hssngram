import { queryOne } from '../db/pool.js';
import { emitToUsers } from '../realtime/index.js';
import type { CallDto, ChatDto, MessageDto } from '../types.js';
import { isOnline } from './presence.js';
import { sendToUsers } from './push.js';

export function messagePreview(message: MessageDto): string {
  switch (message.kind) {
    case 'image':
      return '🖼 عکس';
    case 'video':
      return '🎬 ویدیو';
    case 'voice':
      return '🎤 پیام صوتی';
    case 'audio':
      return '🎵 فایل صوتی';
    case 'file':
      return `📎 ${message.attachments[0]?.name ?? 'فایل'}`;
    case 'system':
      return message.body;
    default:
      return message.body.slice(0, 90);
  }
}

export async function notifyNewMessage(
  memberIds: string[],
  message: MessageDto,
  chat: ChatDto,
): Promise<void> {
  emitToUsers(memberIds, 'message:new', message);
  emitToUsers(memberIds, 'chat:update', chat);

  const sender = message.senderId
    ? await queryOne<{ display_name: string }>('select display_name from users where id = $1', [
        message.senderId,
      ])
    : null;

  const recipients = memberIds.filter(
    (id) => id !== message.senderId && !isOnline(id) && !chat.mutedUntil,
  );

  if (recipients.length > 0) {
    await sendToUsers(recipients, {
      title: chat.type === 'group' ? chat.title : (sender?.display_name ?? 'حسن‌گرام'),
      body:
        chat.type === 'group' && sender
          ? `${sender.display_name}: ${messagePreview(message)}`
          : messagePreview(message),
      chatId: chat.id,
      tag: `chat-${chat.id}`,
      url: `/app?chat=${chat.id}`,
    });
  }
}

export async function notifyCall(
  memberIds: string[],
  kind: 'incoming' | 'state',
  payload: { call: CallDto; chat?: ChatDto; from?: string },
): Promise<void> {
  emitToUsers(memberIds, kind === 'incoming' ? 'call:incoming' : 'call:state', payload);

  if (kind === 'incoming' && payload.chat) {
    const recipients = memberIds.filter((id) => id !== payload.from && !isOnline(id));
    if (recipients.length > 0) {
      await sendToUsers(recipients, {
        title: payload.call.kind === 'video' ? 'تماس تصویری' : 'تماس صوتی',
        body: `${payload.chat.title} در حال تماس است`,
        url: `/app?chat=${payload.chat.id}&call=${payload.call.id}`,
        tag: `call-${payload.call.id}`,
      });
    }
  }
}
