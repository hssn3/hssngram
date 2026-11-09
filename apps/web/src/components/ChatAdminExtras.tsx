import { useEffect, useState } from 'react';
import { api, getAccessToken } from '../lib/api';
import { useApp } from '../store/useApp';
import type { Chat, Message } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

type Invite = { token: string; uses: number; revoked: boolean };

type Props = {
  chat: Chat;
  notify: (text: string, tone?: 'ok' | 'error') => void;
  onClose: () => void;
};

/**
 * Chat toolbox: rename, avatar, invites, slow mode, read-all, long mute,
 * links, export, clear history, leave/delete and admin promotion.
 */
export function ChatAdminExtras({ chat, notify, onClose }: Props) {
  const user = useApp((state) => state.user);
  const refresh = useApp((state) => state.loadChats);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const [slow, setSlow] = useState(chat.slowmodeSeconds ?? 0);

  const me = chat.members.find((member) => member.user.id === user?.id);
  const isManager = me?.role === 'owner' || me?.role === 'admin';
  const isOwner = me?.role === 'owner';

  useEffect(() => {
    if (!isManager || chat.type === 'direct') return;
    void (async () => {
      try {
        const data = await api<{ invites: Invite[] }>(`/chats/${chat.id}/invites`);
        setInvites(data.invites);
      } catch {
        // ignore
      }
    })();
  }, [chat.id, isManager, chat.type]);

  const lastSeq = chat.lastMessage?.seq ?? 0;

  async function uploadAvatar(file: File) {
    const token = getAccessToken();
    const response = await fetch(`/api/chats/${chat.id}/avatar`, {
      method: 'POST',
      headers: {
        'content-type': file.type,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: file,
      credentials: 'include',
    });

    if (!response.ok) {
      notify('بارگذاری تصویر ناموفق بود', 'error');
      return;
    }

    notify('تصویر گفتگو تغییر کرد');
    await refresh();
    onClose();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {chat.type !== 'direct' && isManager ? (
        <>
          <div className="field">
            <label>نام گروه / کانال</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={busy || title.trim().length < 2 || title === chat.title}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/chats/${chat.id}`, {
                      method: 'PATCH',
                      body: { title: title.trim() },
                    });
                    notify('نام گفتگو تغییر کرد');
                    await refresh();
                    onClose();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                ذخیره
              </button>
            </div>
          </div>

          <div className="field">
            <label>تصویر گفتگو</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAvatar(file);
              }}
            />
          </div>

          <div className="field">
            <label>حالت آهسته</label>
            <select
              className="input"
              value={slow}
              onChange={async (event) => {
                const seconds = Number(event.target.value);
                setSlow(seconds);
                await api(`/chats/${chat.id}/slowmode`, {
                  method: 'POST',
                  body: { seconds },
                });
                notify(seconds ? `هر ${seconds} ثانیه یک پیام` : 'حالت آهسته خاموش شد');
              }}
            >
              <option value={0}>خاموش</option>
              <option value={30}>هر ۳۰ ثانیه</option>
              <option value={60}>هر ۱ دقیقه</option>
              <option value={300}>هر ۵ دقیقه</option>
            </select>
          </div>

          <div className="field">
            <label>لینک دعوت</label>
            <button
              className="btn"
              onClick={async () => {
                const result = await api<{ token: string }>(`/chats/${chat.id}/invites`, {
                  method: 'POST',
                  body: { maxUses: 100, expiresInHours: 168 },
                });
                const link = `${window.location.origin}/join/${result.token}`;
                await navigator.clipboard.writeText(link).catch(() => undefined);
                notify('لینک ساخته و کپی شد');
                const data = await api<{ invites: Invite[] }>(`/chats/${chat.id}/invites`);
                setInvites(data.invites);
              }}
            >
              <Icon name="plus" /> ساخت لینک جدید
            </button>

            {invites.map((invite) => (
              <div key={invite.token} className="user-row" style={{ padding: 6 }}>
                <span className="info">
                  <span className="n" style={{ direction: 'ltr', fontSize: 12 }}>
                    {invite.token}
                  </span>
                  <span className="u">{invite.uses} استفاده</span>
                </span>
                {invite.revoked ? (
                  <span className="pill danger">باطل</span>
                ) : (
                  <button
                    className="btn"
                    style={{ padding: '4px 10px' }}
                    onClick={async () => {
                      await api(`/chats/${chat.id}/invites/${invite.token}`, { method: 'DELETE' });
                      setInvites((current) =>
                        current.map((item) =>
                          item.token === invite.token ? { ...item, revoked: true } : item,
                        ),
                      );
                      notify('لینک باطل شد');
                    }}
                  >
                    ابطال
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="field">
        <label>ابزارهای گفتگو</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            className="btn"
            disabled={busy || lastSeq === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/chats/${chat.id}/read`, { method: 'POST', body: { seq: lastSeq } });
                notify('همه پیام‌ها خوانده‌شده شد');
                await refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="checks" /> خواندن همه
          </button>

          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/chats/${chat.id}/mute`, {
                  method: 'POST',
                  body: { minutes: 525600 },
                });
                notify('برای یک سال بی‌صدا شد');
                await refresh();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="lock" /> بی‌صدا (۱ سال)
          </button>

          <button
            className="btn"
            onClick={async () => {
              const link = `${window.location.origin}/app?chat=${chat.id}`;
              await navigator.clipboard.writeText(link).catch(() => undefined);
              notify('لینک گفتگو کپی شد');
            }}
          >
            <Icon name="file" /> کپی لینک گفتگو
          </button>

          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(chat.id).catch(() => undefined);
              notify('شناسه گفتگو کپی شد');
            }}
          >
            <Icon name="shield" /> کپی شناسه گفتگو
          </button>

          <button
            className="btn"
            onClick={async () => {
              try {
                const data = await api<{ messages: Message[] }>(
                  `/chats/${chat.id}/messages?limit=100`,
                );
                const blob = new Blob([JSON.stringify(data.messages, null, 2)], {
                  type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `hssngram-chat-${chat.id}.json`;
                link.click();
                URL.revokeObjectURL(url);
              } catch (error) {
                notify((error as Error).message, 'error');
              }
            }}
          >
            <Icon name="download" /> خروجی این گفتگو
          </button>

          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('تاریخچه این گفتگو فقط برای شما پاک شود؟')) return;
              setBusy(true);
              try {
                const result = await api<{ hidden: number }>(`/chats/${chat.id}/messages`, {
                  method: 'DELETE',
                });
                notify(`${result.hidden} پیام از فهرست شما پاک شد`);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="trash" /> پاک‌کردن تاریخچه من
          </button>

          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('این گفتگو از فهرست شما حذف شود؟')) return;
              setBusy(true);
              try {
                await api(`/chats/${chat.id}/leave`, { method: 'POST' });
                await refresh();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="logout" /> حذف از فهرست من
          </button>

          {isOwner && chat.type !== 'direct' ? (
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('کل گروه/کانال برای همه حذف شود؟')) return;
                setBusy(true);
                try {
                  await api(`/chats/${chat.id}`, { method: 'DELETE' });
                  await refresh();
                  onClose();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="trash" /> حذف کامل گروه
            </button>
          ) : null}
        </div>
      </div>

      {chat.type !== 'direct' && isManager ? (
        <div className="field">
          <label>مدیران و اعضا</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {chat.members
              .filter((member) => member.role !== 'owner' && member.user.id !== user?.id)
              .slice(0, 8)
              .map((member) => (
                <div key={member.user.id} className="user-row" style={{ padding: 6 }}>
                  <Avatar name={member.user.displayName} src={member.user.avatarUrl} size="sm" />
                  <span className="info">
                    <span className="n">{member.user.displayName}</span>
                    <span className="u">{member.role === 'admin' ? 'مدیر' : 'عضو'}</span>
                  </span>
                  <button
                    className="btn"
                    style={{ padding: '4px 10px' }}
                    onClick={async () => {
                      await api(`/chats/${chat.id}/members/${member.user.id}`, {
                        method: 'PATCH',
                        body: { role: member.role === 'admin' ? 'member' : 'admin' },
                      });
                      notify(member.role === 'admin' ? 'به عضو تبدیل شد' : 'به مدیر ارتقا یافت');
                      await refresh();
                      onClose();
                    }}
                  >
                    {member.role === 'admin' ? 'عضو کن' : 'مدیر کن'}
                  </button>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
