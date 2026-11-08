import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../store/useApp';
import type { Chat } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

type Invite = { token: string; uses: number; revoked: boolean };

/** Invite link management, admin promotion, mute durations and leaving a chat. */
export function ChatAdminExtras({
  chat,
  notify,
  onClose,
}: {
  chat: Chat;
  notify: (text: string, tone?: 'ok' | 'error') => void;
  onClose: () => void;
}) {
  const user = useApp((state) => state.user);
  const refresh = useApp((state) => state.loadChats);
  const [invites, setInvites] = useState<Invite[]>([]);

  const me = chat.members.find((member) => member.user.id === user?.id);
  const isManager = me?.role === 'owner' || me?.role === 'admin';

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

  if (chat.type === 'direct') {
    return (
      <div className="field">
        <label>گفتگو</label>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (!window.confirm('این گفتگو از فهرست شما حذف شود؟')) return;
            await api(`/chats/${chat.id}/leave`, { method: 'POST' });
            await refresh();
            onClose();
          }}
        >
          <Icon name="trash" /> حذف گفتگو از فهرست من
        </button>
      </div>
    );
  }

  if (!isManager) return null;

  return (
    <div className="field">
      <label>لینک‌های دعوت</label>

      {invites.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>هنوز لینکی ساخته نشده است.</p>
      )}

      <label style={{ marginTop: 10 }}>مدیران و اعضا</label>
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

      <select
        className="input"
        style={{ width: 'auto', marginTop: 10 }}
        defaultValue=""
        onChange={async (event) => {
          const minutes = Number(event.target.value);
          if (!minutes) return;
          await api(`/chats/${chat.id}/mute`, {
            method: 'POST',
            body: { minutes: minutes === -1 ? null : minutes },
          });
          notify(minutes === -1 ? 'صدا روشن شد' : 'گفتگو بی‌صدا شد');
          event.target.value = '';
        }}
      >
        <option value="">بی‌صدا کردن…</option>
        <option value="60">۱ ساعت</option>
        <option value="480">۸ ساعت</option>
        <option value="10080">۱ هفته</option>
        <option value="-1">روشن کردن صدا</option>
      </select>
    </div>
  );
}
