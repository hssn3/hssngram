import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../store/useApp';
import type { Chat, PublicUser } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { formatBytes } from '../lib/format';
import { enablePushNotifications } from '../lib/push';
import { SupportInbox } from '../pages/SupportPage';

function DialogShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="بستن">
            <Icon name="close" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function NewChatDialog() {
  const openDialog = useApp((state) => state.openDialog);
  const createDirect = useApp((state) => state.createDirect);
  const createGroup = useApp((state) => state.createGroup);

  const [tab, setTab] = useState<'direct' | 'group'>('direct');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const data = await api<{ users: PublicUser[] }>(
          `/users/search?q=${encodeURIComponent(term.trim())}`,
        );
        setResults(data.users);
      } catch {
        setResults([]);
      }
    }, 260);

    return () => window.clearTimeout(timer);
  }, [term]);

  const selectedUsers = useMemo(
    () => results.filter((user) => selected.includes(user.id)),
    [results, selected],
  );

  return (
    <DialogShell title="گفتگوی جدید" onClose={() => openDialog(null)}>
      <div className="tabs">
        <button className={tab === 'direct' ? 'active' : ''} onClick={() => setTab('direct')}>
          گفتگوی خصوصی
        </button>
        <button className={tab === 'group' ? 'active' : ''} onClick={() => setTab('group')}>
          گروه
        </button>
      </div>

      <div className="search" style={{ padding: '0 14px' }}>
        <Icon name="search" />
        <input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="جستجوی نام یا شناسه کاربر"
        />
      </div>

      {tab === 'group' ? (
        <div className="field">
          <label>نام گروه</label>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="مثلاً خانواده"
          />
        </div>
      ) : null}

      {tab === 'group' && selectedUsers.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {selectedUsers.map((user) => (
            <span key={user.id} className="chip">
              {user.displayName}
              <button
                onClick={() => setSelected((ids) => ids.filter((id) => id !== user.id))}
                aria-label="حذف"
              >
                <Icon name="close" style={{ width: 13, height: 13 }} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {results.map((user) => {
          const isSelected = selected.includes(user.id);
          return (
            <button
              key={user.id}
              className="user-row"
              onClick={async () => {
                if (busy) return;
                if (tab === 'direct') {
                  setBusy(true);
                  try {
                    await createDirect(user.id);
                  } finally {
                    setBusy(false);
                  }
                  return;
                }
                setSelected((ids) =>
                  isSelected ? ids.filter((id) => id !== user.id) : [...ids, user.id],
                );
              }}
            >
              <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
              <span className="info">
                <span className="n">{user.displayName}</span>
                <span className="u">{user.username}</span>
              </span>
              {tab === 'group' ? (
                <Icon
                  name={isSelected ? 'check' : 'plus'}
                  style={{ color: isSelected ? 'var(--ok)' : 'var(--muted)' }}
                />
              ) : null}
            </button>
          );
        })}

        {term.trim().length >= 2 && results.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>کاربری پیدا نشد.</p>
        ) : null}
        {term.trim().length < 2 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            برای پیدا کردن کاربر، حداقل دو نویسه از نام یا شناسه او را بنویس.
          </p>
        ) : null}
      </div>

      {tab === 'group' ? (
        <button
          className="btn btn-primary"
          disabled={selected.length === 0 || title.trim().length === 0 || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await createGroup(title.trim(), selected);
            } finally {
              setBusy(false);
            }
          }}
        >
          ساخت گروه
        </button>
      ) : null}
    </DialogShell>
  );
}

export function SettingsDialog() {
  const user = useApp((state) => state.user);
  const openDialog = useApp((state) => state.openDialog);
  const updateProfile = useApp((state) => state.updateProfile);
  const uploadAvatar = useApp((state) => state.uploadAvatar);
  const logout = useApp((state) => state.logout);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'dark');
  const [pushState, setPushState] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<{ lastSeen: string; readReceipts: boolean } | null>(null);
  const [blocked, setBlocked] = useState<PublicUser[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordState, setPasswordState] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<{ privacy: { lastSeen: string; readReceipts: boolean } }>(
          '/users/privacy',
        );
        setPrivacy(data.privacy);
        const list = await api<{ users: PublicUser[] }>('/users/blocked');
        setBlocked(list.users);
      } catch {
        // keep the panel hidden when the request fails
      }
    })();
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('hssn-theme', next);
  }

  return (
    <DialogShell title="تنظیمات" onClose={() => openDialog(null)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar name={user?.displayName ?? '?'} src={user?.avatarUrl} size="lg" />
        <div className="field" style={{ flex: 1 }}>
          <label>تصویر پروفایل</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadAvatar(file);
            }}
          />
        </div>
      </div>

      <div className="field">
        <label>شناسه ورود</label>
        <input className="input" value={user?.username ?? ''} dir="ltr" readOnly />
      </div>

      <div className="field">
        <label>نام نمایشی</label>
        <input
          className="input"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>

      <div className="field">
        <label>درباره من</label>
        <textarea
          className="input"
          rows={2}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          placeholder="یک جمله کوتاه"
        />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await updateProfile({ displayName: displayName.trim(), bio });
          }}
        >
          ذخیره تغییرات
        </button>
        <button className="btn" onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'smile' : 'lock'} />
          {theme === 'dark' ? 'حالت روشن' : 'حالت تاریک'}
        </button>
      </div>

      {user?.isAdmin ? (
        <button className="btn" onClick={() => openDialog('admin')}>
          <Icon name="shield" />
          پنل مدیریت و تأیید کاربران
        </button>
      ) : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn"
          onClick={async () => {
            const result = await enablePushNotifications();
            setPushState(
              result === 'ok'
                ? 'اعلان‌ها فعال شد'
                : result === 'denied'
                  ? 'اجازه اعلان داده نشد'
                  : result === 'unsupported'
                    ? 'مرورگر از اعلان پشتیبانی نمی‌کند'
                    : result === 'disabled'
                      ? 'اعلان روی سرور تنظیم نشده است'
                      : 'فعال‌سازی اعلان ناموفق بود',
            );
          }}
        >
          <Icon name="lock" />
          فعال‌سازی اعلان‌ها
        </button>
        {pushState ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pushState}</span> : null}
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>حریم خصوصی</div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn"
            onClick={async () => {
              if (!privacy) return;
              const next = {
                ...privacy,
                lastSeen: privacy.lastSeen === 'everyone' ? 'nobody' : 'everyone',
              };
              setPrivacy(next);
              await api('/users/privacy', { method: 'PATCH', body: next });
            }}
          >
            <Icon name="users" />
            آخرین بازدید: {privacy?.lastSeen === 'nobody' ? 'پنهان' : 'همه'}
          </button>

          <button
            className="btn"
            onClick={async () => {
              if (!privacy) return;
              const next = { ...privacy, readReceipts: !privacy.readReceipts };
              setPrivacy(next);
              await api('/users/privacy', { method: 'PATCH', body: next });
            }}
          >
            <Icon name="checks" />
            تیک خوانده‌شدن: {privacy?.readReceipts ? 'روشن' : 'خاموش'}
          </button>
        </div>

        {blocked.length > 0 ? (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>کاربران مسدود</div>
            {blocked.map((person) => (
              <div key={person.id} className="user-row" style={{ padding: 6 }}>
                <Avatar name={person.displayName} src={person.avatarUrl} size="sm" />
                <span className="info">
                  <span className="n">{person.displayName}</span>
                  <span className="u">{person.username}</span>
                </span>
                <button
                  className="btn"
                  style={{ padding: '4px 10px' }}
                  onClick={async () => {
                    await api(`/users/${person.id}/block`, { method: 'DELETE' });
                    setBlocked((current) => current.filter((item) => item.id !== person.id));
                  }}
                >
                  رفع مسدودی
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
        <div className="field">
          <label>تغییر گذرواژه</label>
          <input
            className="input"
            type="password"
            placeholder="گذرواژه فعلی"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="گذرواژه جدید (حداقل ۶ نویسه)"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn"
              disabled={!currentPassword || newPassword.length < 6}
              onClick={async () => {
                try {
                  await api('/auth/change-password', {
                    method: 'POST',
                    body: { currentPassword, newPassword },
                  });
                  setPasswordState('گذرواژه تغییر کرد؛ دوباره وارد شوید.');
                  setCurrentPassword('');
                  setNewPassword('');
                } catch (error) {
                  setPasswordState((error as Error).message);
                }
              }}
            >
              ذخیره گذرواژه
            </button>
            {passwordState ? (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{passwordState}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
        <button className="btn btn-danger" onClick={() => void logout()}>
          <Icon name="logout" />
          خروج از حساب
        </button>
      </div>

      <p style={{ color: 'var(--muted-2)', fontSize: 12, margin: 0 }}>
        حسن‌گرام نسخه ۰.۱.۰ — میزبانی روی ابر آروان
      </p>
    </DialogShell>
  );
}

type AdminUser = PublicUser & { status: 'pending' | 'active' | 'disabled' };

export function AdminDialog() {
  const openDialog = useApp((state) => state.openDialog);
  const [tab, setTab] = useState<'pending' | 'users' | 'invites' | 'support'>('pending');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pending, setPending] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<
    Array<{ code: string; uses: number; maxUses: number; note: string }>
  >([]);
  const [overview, setOverview] = useState<{ users: number; pending: number; messages: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [newUser, setNewUser] = useState({ loginId: '', displayName: '', password: '' });

  async function reload() {
    setLoading(true);
    try {
      const [all, waiting, overviewData, inviteData] = await Promise.all([
        api<{ users: AdminUser[] }>('/admin/users'),
        api<{ users: AdminUser[] }>('/admin/users?status=pending'),
        api<{ users: number; pending: number; messages: number }>('/admin/overview'),
        api<{ invites: Array<{ code: string; uses: number; maxUses: number; note: string }> }>(
          '/admin/invites',
        ),
      ]);
      setUsers(all.users);
      setPending(waiting.users);
      setOverview(overviewData);
      setInvites(inviteData.invites);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function setStatus(id: string, status: AdminUser['status']) {
    await api(`/admin/users/${id}`, { method: 'PATCH', body: { status } });
    await reload();
  }

  return (
    <DialogShell title="پنل مدیریت" onClose={() => openDialog(null)}>
      <div className="tabs">
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
          در انتظار تأیید {pending.length > 0 ? `(${pending.length})` : ''}
        </button>
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>
          کاربران
        </button>
        <button className={tab === 'invites' ? 'active' : ''} onClick={() => setTab('invites')}>
          کدهای دعوت
        </button>
        <button className={tab === 'support' ? 'active' : ''} onClick={() => setTab('support')}>
          پشتیبانی
        </button>
      </div>

      {overview ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="pill">کاربران: {overview.users}</span>
          <span className="pill warn">در انتظار: {overview.pending}</span>
          <span className="pill">پیام‌ها: {overview.messages}</span>
        </div>
      ) : null}

      {loading ? <p style={{ color: 'var(--muted)' }}>در حال بارگذاری…</p> : null}

      {tab === 'pending' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pending.length === 0 && !loading ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>درخواست تأیید جدیدی نیست.</p>
          ) : null}

          {pending.map((user) => (
            <div key={user.id} className="user-row">
              <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
              <span className="info">
                <span className="n">{user.displayName}</span>
                <span className="u">{user.username}</span>
              </span>
              <button className="btn btn-primary" style={{ padding: '6px 12px' }} onClick={() => void setStatus(user.id, 'active')}>
                تأیید
              </button>
              <button
                className="btn btn-danger"
                style={{ padding: '6px 12px' }}
                onClick={() => void setStatus(user.id, 'disabled')}
              >
                رد
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'users' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="add-user-box">
            <div style={{ fontWeight: 600, fontSize: 13 }}>افزودن کاربر جدید</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input
                className="input"
                style={{ flex: '1 1 110px' }}
                placeholder="شناسه ۸ رقمی"
                dir="ltr"
                maxLength={8}
                value={newUser.loginId}
                onChange={(event) =>
                  setNewUser({ ...newUser, loginId: event.target.value.replace(/\D/g, '') })
                }
              />
              <input
                className="input"
                style={{ flex: '1 1 120px' }}
                placeholder="نام نمایشی"
                value={newUser.displayName}
                onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })}
              />
              <input
                className="input"
                style={{ flex: '1 1 110px' }}
                placeholder="گذرواژه"
                value={newUser.password}
                onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
              />
              <button
                className="btn btn-primary"
                disabled={
                  newUser.loginId.length !== 8 ||
                  newUser.displayName.trim().length < 2 ||
                  newUser.password.length < 6
                }
                onClick={async () => {
                  await api('/admin/users', { method: 'POST', body: newUser });
                  setNewUser({ loginId: '', displayName: '', password: '' });
                  await reload();
                }}
              >
                <Icon name="plus" />
                ساخت
              </button>
            </div>
          </div>

          {users.map((user) => (
            <div key={user.id} className="user-row">
              <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
              <span className="info">
                <span className="n">
                  {user.displayName} {user.isAdmin ? '👑' : ''}
                </span>
                <span className="u">{user.username}</span>
              </span>
              <span
                className={`pill ${user.status === 'active' ? 'ok' : user.status === 'pending' ? 'warn' : 'danger'}`}
              >
                {user.status === 'active' ? 'فعال' : user.status === 'pending' ? 'در انتظار' : 'غیرفعال'}
              </span>
              <button
                className="btn"
                style={{ padding: '6px 10px' }}
                onClick={() => void setStatus(user.id, user.status === 'active' ? 'disabled' : 'active')}
              >
                {user.status === 'active' ? 'غیرفعال' : 'فعال'}
              </button>
              <button
                className="btn btn-danger"
                style={{ padding: '6px 10px' }}
                onClick={async () => {
                  if (!window.confirm(`حساب ${user.displayName} برای همیشه حذف شود؟`)) return;
                  try {
                    await api(`/admin/users/${user.id}`, { method: 'DELETE' });
                    await reload();
                  } catch (error) {
                    useApp.getState().notify((error as Error).message, 'error');
                  }
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'invites' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await api('/admin/invites', {
                method: 'POST',
                body: { note: '', maxUses: 20, expiresInDays: 30 },
              });
              await reload();
            }}
          >
            <Icon name="plus" />
            ساخت کد دعوت
          </button>

          {invites.map((invite) => (
            <div key={invite.code} className="user-row">
              <span className="info">
                <span className="n" style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.14em' }}>
                  {invite.code}
                </span>
                <span className="u">
                  {invite.uses} از {invite.maxUses} استفاده
                </span>
              </span>
              <button
                className="btn"
                style={{ padding: '6px 10px' }}
                onClick={() => void navigator.clipboard.writeText(invite.code)}
              >
                کپی
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'support' ? <SupportInbox /> : null}

      <p style={{ fontSize: 12, color: 'var(--muted-2)', margin: 0 }}>
        کاربران تازه با شناسه ۸ رقمی ثبت‌نام می‌کنند و تا تأیید شما نمی‌توانند وارد شوند.
      </p>
    </DialogShell>
  );
}

export function ChatInfoDialog({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const user = useApp((state) => state.user);
  const refresh = useApp((state) => state.loadChats);
  const selectChat = useApp((state) => state.selectChat);
  const notify = useApp((state) => state.notify);

  const [term, setTerm] = useState('');
  const [found, setFound] = useState<PublicUser[]>([]);

  const me = chat.members.find((member) => member.user.id === user?.id);
  const isManager = me?.role === 'owner' || me?.role === 'admin';

  const [mediaKind, setMediaKind] = useState<'image' | 'video' | 'audio' | 'file'>('image');
  const [mediaItems, setMediaItems] = useState<Array<{ id: string; name: string; kind: string }>>(
    [],
  );
  const [mediaLoading, setMediaLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMediaLoading(true);
    void (async () => {
      try {
        const data = await api<{ items: Array<{ id: string; name: string; kind: string }> }>(
          `/chats/${chat.id}/media?kind=${mediaKind}`,
        );
        if (!cancelled) setMediaItems(data.items);
      } catch {
        if (!cancelled) setMediaItems([]);
      } finally {
        if (!cancelled) setMediaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chat.id, mediaKind]);

  return (
    <DialogShell title="اطلاعات گفتگو" onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar name={chat.title} src={chat.avatarUrl} size="lg" />
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{chat.title}</div>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
            {chat.type === 'group' ? `گروه • ${chat.members.length} عضو` : 'گفتگوی خصوصی'}
          </div>
        </div>
      </div>

      {chat.type === 'group' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {chat.members.map((member) => (
            <div key={member.user.id} className="user-row">
              <Avatar name={member.user.displayName} src={member.user.avatarUrl} size="sm" />
              <span className="info">
                <span className="n">{member.user.displayName}</span>
                <span className="u">{member.user.username}</span>
              </span>
              <span className="pill">
                {member.role === 'owner' ? 'سازنده' : member.role === 'admin' ? 'مدیر' : 'عضو'}
              </span>
              {isManager && member.role !== 'owner' && member.user.id !== user?.id ? (
                <button
                  className="btn btn-danger"
                  style={{ padding: '4px 10px' }}
                  onClick={async () => {
                    await api(`/chats/${chat.id}/members/${member.user.id}`, { method: 'DELETE' });
                    await refresh();
                  }}
                >
                  حذف
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {chat.type === 'group' && isManager ? (
        <div className="field">
          <label>افزودن عضو</label>
          <input
            className="input"
            value={term}
            placeholder="نام کاربر"
            onChange={async (event) => {
              const value = event.target.value;
              setTerm(value);
              if (value.trim().length < 2) {
                setFound([]);
                return;
              }
              const data = await api<{ users: PublicUser[] }>(
                `/users/search?q=${encodeURIComponent(value.trim())}`,
              );
              setFound(data.users.filter((item) => !chat.members.some((m) => m.user.id === item.id)));
            }}
          />
          {found.map((item) => (
            <button
              key={item.id}
              className="user-row"
              onClick={async () => {
                await api(`/chats/${chat.id}/members`, {
                  method: 'POST',
                  body: { userIds: [item.id] },
                });
                setFound([]);
                setTerm('');
                await refresh();
                await selectChat(chat.id);
                notify('عضو اضافه شد');
              }}
            >
              <Avatar name={item.displayName} src={item.avatarUrl} size="sm" />
              <span className="info">
                <span className="n">{item.displayName}</span>
                <span className="u">{item.username}</span>
              </span>
              <Icon name="plus" />
            </button>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn"
          onClick={async () => {
            await api(`/chats/${chat.id}/mute`, { method: 'POST', body: { minutes: 480 } });
            notify('گفتگو برای ۸ ساعت بی‌صدا شد');
          }}
        >
          بی‌صدا کردن
        </button>

        {chat.type === 'group' ? (
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (!window.confirm('از این گروه خارج می‌شوید؟')) return;
              await api(`/chats/${chat.id}/leave`, { method: 'POST' });
              await refresh();
              onClose();
            }}
          >
            خروج از گروه
          </button>
        ) : null}

        {me?.role === 'owner' && chat.type === 'group' ? (
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (!window.confirm('کل گروه و پیام‌هایش حذف شود؟')) return;
              await api(`/chats/${chat.id}`, { method: 'DELETE' });
              await refresh();
              onClose();
            }}
          >
            حذف گروه
          </button>
        ) : null}
      </div>

      <div className="field">
        <label>رسانه‌های گفتگو</label>
        <div className="tabs" style={{ marginBottom: 8 }}>
          {(
            [
              ['image', 'تصاویر'],
              ['video', 'ویدیو'],
              ['audio', 'صدا'],
              ['file', 'فایل'],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              className={mediaKind === kind ? 'active' : ''}
              onClick={() => setMediaKind(kind)}
            >
              {label}
            </button>
          ))}
        </div>

        {mediaLoading ? (
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>در حال بارگذاری…</p>
        ) : mediaItems.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>موردی وجود ندارد.</p>
        ) : (
          <div className="media-grid">
            {mediaItems.map((item) => (
              <div key={item.id} className="media-item" title={item.name}>
                <Icon name={mediaKind === 'image' ? 'image' : mediaKind === 'audio' ? 'mic' : 'file'} />
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {chat.lastMessage ? (
        <p style={{ color: 'var(--muted-2)', fontSize: 12, margin: 0 }}>
          آخرین فعالیت: {new Date(chat.lastMessageAt ?? chat.createdAt).toLocaleString('fa-IR')} —{' '}
          {formatBytes(chat.lastMessage.attachments[0]?.size ?? 0)}
        </p>
      ) : null}
    </DialogShell>
  );
}
