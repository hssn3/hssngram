import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getAccessToken } from '../lib/api';
import { useApp } from '../store/useApp';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import type { Chat, PublicUser } from '../types';

type Folder = { id: string; name: string; count: number };
type Session = { id: string; userAgent: string; ip: string; lastUsedAt: string; current: boolean };
type Stats = { chats: number; messages: number; files: number; storageBytes: number; contacts: number };
type SearchHit = { id: string; chatId: string; chatTitle: string; body: string; kind: string; createdAt: string };

/**
 * Tools hub: folders, global search, account stats, sessions, export and
 * bulk actions — everything that is not tied to a single conversation.
 */
export function ToolsPage() {
  const navigate = useNavigate();
  const user = useApp((state) => state.user);
  const chats = useApp((state) => state.chats);
  const notify = useApp((state) => state.notify);
  const loadChats = useApp((state) => state.loadChats);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderName, setFolderName] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [blocked, setBlocked] = useState<PublicUser[]>([]);

  const [term, setTerm] = useState('');
  const [kind, setKind] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const app = useApp.getState();
        if (!app.user) await app.init();

        const [folderData, sessionData, statsData, blockedData] = await Promise.all([
          api<{ folders: Folder[] }>('/folders'),
          api<{ sessions: Session[] }>('/auth/sessions'),
          api<{ stats: Stats }>('/me/stats'),
          api<{ users: PublicUser[] }>('/users/blocked'),
        ]);
        setFolders(folderData.folders);
        setSessions(sessionData.sessions);
        setStats(statsData.stats);
        setBlocked(blockedData.users);
      } catch {
        // ignore
      }
    })();
  }, []);

  async function runSearch() {
    const clean = term.trim();
    if (clean.length < 2) return;
    setSearching(true);
    try {
      const data = await api<{ messages: SearchHit[] }>(
        `/search?q=${encodeURIComponent(clean)}${kind ? `&kind=${kind}` : ''}`,
      );
      setHits(data.messages);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  async function addToFolder(folderId: string, chatId: string) {
    await api(`/folders/${folderId}/chats`, { method: 'POST', body: { chatId } });
    setFolders((current) =>
      current.map((folder) =>
        folder.id === folderId ? { ...folder, count: folder.count + 1 } : folder,
      ),
    );
    notify('به پوشه اضافه شد');
  }

  return (
    <div className="support-page">
      <header className="support-head">
        <button className="btn btn-ghost" onClick={() => navigate('/app')}>
          <Icon name="back" /> بازگشت به گفتگوها
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/icons/icon-192.png" alt="HssNGram" width={32} height={32} />
          <strong>ابزارها</strong>
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="auth-card" style={{ maxWidth: '100%' }}>
          <h3 style={{ marginTop: 0 }}>پوشه‌های چت</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 180px' }}
              placeholder="نام پوشه (مثلاً خانواده)"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
            />
            <button
              className="btn btn-primary"
              disabled={folderName.trim().length === 0}
              onClick={async () => {
                const data = await api<{ folder: Folder }>('/folders', {
                  method: 'POST',
                  body: { name: folderName.trim() },
                });
                setFolders((current) => [...current, data.folder]);
                setFolderName('');
              }}
            >
              <Icon name="plus" /> ساخت
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {folders.map((folder) => (
              <div key={folder.id} className="user-row">
                <span className="info">
                  <span className="n">{folder.name}</span>
                  <span className="u">{folder.count} گفتگو</span>
                </span>

                <select
                  className="input"
                  style={{ width: 'auto' }}
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) void addToFolder(folder.id, event.target.value);
                    event.target.value = '';
                  }}
                >
                  <option value="">افزودن گفتگو…</option>
                  {chats.slice(0, 20).map((chat: Chat) => (
                    <option key={chat.id} value={chat.id}>
                      {chat.title}
                    </option>
                  ))}
                </select>

                <button
                  className="btn btn-danger"
                  style={{ padding: '4px 10px' }}
                  onClick={async () => {
                    await api(`/folders/${folder.id}`, { method: 'DELETE' });
                    setFolders((current) => current.filter((item) => item.id !== folder.id));
                  }}
                >
                  حذف
                </button>
              </div>
            ))}
            {folders.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>هنوز پوشه‌ای نساخته‌ای.</p>
            ) : null}
          </div>
        </section>

        <section className="auth-card" style={{ maxWidth: '100%' }}>
          <h3 style={{ marginTop: 0 }}>جستجوی سراسری</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 200px' }}
              placeholder="متن پیام…"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runSearch();
              }}
            />
            <select
              className="input"
              style={{ width: 'auto' }}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">همه انواع</option>
              <option value="text">متن</option>
              <option value="image">عکس</option>
              <option value="video">ویدیو</option>
              <option value="voice">صدا</option>
              <option value="file">فایل</option>
            </select>
            <button className="btn btn-primary" disabled={searching} onClick={() => void runSearch()}>
              <Icon name="search" /> جستجو
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {hits.map((hit) => (
              <button
                key={hit.id}
                className="user-row"
                onClick={() => {
                  void useApp.getState().selectChat(hit.chatId);
                  navigate('/app');
                }}
              >
                <span className="info">
                  <span className="n" style={{ fontSize: 13 }}>
                    {hit.body.slice(0, 90)}
                  </span>
                  <span className="u">
                    {hit.chatTitle || 'گفتگو'} • {new Date(hit.createdAt).toLocaleDateString('fa-IR')}
                  </span>
                </span>
              </button>
            ))}
            {!searching && term.trim().length >= 2 && hits.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>نتیجه‌ای پیدا نشد.</p>
            ) : null}
          </div>
        </section>

        <section className="auth-card" style={{ maxWidth: '100%' }}>
          <h3 style={{ marginTop: 0 }}>حساب من</h3>
          {stats ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="pill">گفتگو: {stats.chats}</span>
              <span className="pill">پیام: {stats.messages}</span>
              <span className="pill">فایل: {stats.files}</span>
              <span className="pill">حجم: {Math.round(stats.storageBytes / 1024)} KB</span>
              <span className="pill">مخاطب: {stats.contacts}</span>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>در حال بارگذاری…</p>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <button
              className="btn"
              onClick={async () => {
                const result = await api<{ updated: number }>('/chats/read-all', { method: 'POST' });
                await loadChats();
                notify(`${result.updated} گفتگو خوانده‌شده شد`);
              }}
            >
              <Icon name="checks" /> خواندن همه گفتگوها
            </button>

            <button
              className="btn"
              onClick={async () => {
                const data = await api<unknown>('/export');
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'hssngram-export.json';
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Icon name="download" /> خروجی داده
            </button>

            <button
              className="btn btn-danger"
              onClick={async () => {
                await api('/auth/sessions', { method: 'DELETE' });
                const data = await api<{ sessions: Session[] }>('/auth/sessions');
                setSessions(data.sessions);
                notify('بقیه نشست‌ها بسته شدند');
              }}
            >
              <Icon name="logout" /> خروج از دستگاه‌های دیگر
            </button>
          </div>

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>نشست‌های فعال</div>
            {sessions.map((session) => (
              <div key={session.id} className="user-row" style={{ padding: 6 }}>
                <span className="info">
                  <span className="n" style={{ fontSize: 12 }}>
                    {session.userAgent ? session.userAgent.slice(0, 50) : 'دستگاه ناشناس'}
                  </span>
                  <span className="u">
                    {session.ip} • {new Date(session.lastUsedAt).toLocaleDateString('fa-IR')}
                  </span>
                </span>
                {session.current ? (
                  <span className="pill ok">فعلی</span>
                ) : (
                  <button
                    className="btn"
                    style={{ padding: '4px 10px' }}
                    onClick={async () => {
                      await api(`/auth/sessions/${session.id}`, { method: 'DELETE' });
                      setSessions((current) => current.filter((item) => item.id !== session.id));
                    }}
                  >
                    پایان
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="auth-card" style={{ maxWidth: '100%' }}>
          <h3 style={{ marginTop: 0 }}>امنیت و دسترسی</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={user?.displayName ?? '?'} src={user?.avatarUrl} size="sm" />
            <div>
              <div style={{ fontWeight: 600 }}>{user?.displayName}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', direction: 'ltr' }}>
                {user?.username}
              </div>
            </div>
            <span className="pill">{getAccessToken() ? 'نشست فعال' : 'بدون نشست'}</span>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              کاربران مسدود ({blocked.length})
            </div>
            {blocked.map((person) => (
              <div key={person.id} className="user-row" style={{ padding: 6 }}>
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
        </section>
      </div>
    </div>
  );
}
