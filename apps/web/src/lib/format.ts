const timeFormatter = new Intl.DateTimeFormat('fa-IR', {
  hour: '2-digit',
  minute: '2-digit',
});

const shortDate = new Intl.DateTimeFormat('fa-IR', {
  day: 'numeric',
  month: 'long',
});

const weekday = new Intl.DateTimeFormat('fa-IR', { weekday: 'long' });

export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return 'امروز';
  if (sameDay(date, yesterday)) return 'دیروز';

  const diff = (today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 7) return weekday.format(date);
  return shortDate.format(date);
}

export function formatListTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const today = new Date();

  if (date.toDateString() === today.toDateString()) return formatTime(iso);

  const diff = (today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 7) return weekday.format(date);
  return shortDate.format(date);
}

export function formatLastSeen(iso: string, online: boolean): string {
  if (online) return 'آنلاین';
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();

  if (diff < 60_000) return 'همین حالا آنلاین بود';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} دقیقه پیش آنلاین بود`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)} ساعت پیش آنلاین بود`;
  return `آخرین بازدید ${shortDate.format(date)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} کیلوبایت`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} گیگابایت`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '؟';
  if (parts.length === 1) return parts[0]!.slice(0, 1);
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`;
}

export function displayTitle(chat: { type: string; title: string; members: Array<{ user: { id: string } }> }): string {
  if (chat.type === 'direct' && chat.members.length === 1) return 'پیام‌های ذخیره‌شده';
  return chat.title;
}

export function previewOf(message: {
  kind: string;
  body: string;
  senderId: string | null;
  attachments: Array<{ name: string }>;
}): string {
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
    default:
      return message.body || 'پیام';
  }
}
