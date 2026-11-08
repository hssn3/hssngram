import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../store/useApp';
import { formatTime } from '../lib/format';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';

type SupportMessage = {
  id: string;
  threadId: string;
  author: 'guest' | 'admin' | 'system';
  adminId: string | null;
  body: string;
  createdAt: string;
};

type SessionResponse = {
  guest: { id: string; displayName: string; converted: boolean } | null;
  thread?: { id: string; status: 'open' | 'closed' };
  messages?: SupportMessage[];
};

export function SupportPage() {
  const [loading, setLoading] = useState(true);
  const [guest, setGuest] = useState<SessionResponse['guest']>(null);
  const [thread, setThread] = useState<SessionResponse['thread'] | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const lastSeen = useRef<string | null>(null);

  async function bootstrap() {
    try {
      const data = await api<SessionResponse>('/support/session');
      setGuest(data.guest);
      setThread(data.thread ?? null);
      setMessages(data.messages ?? []);
      lastSeen.current = data.messages?.at(-1)?.createdAt ?? null;
    } catch {
      setGuest(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!guest) return;
    const timer = window.setInterval(async () => {
      try {
        const since = lastSeen.current;
        const data = await api<{ messages: SupportMessage[]; status: string }>(
          `/support/messages${since ? `?since=${encodeURIComponent(since)}` : ''}`,
        );
        if (data.messages.length > 0) {
          setMessages((current) => {
            const map = new Map(current.map((message) => [message.id, message]));
            for (const message of data.messages) map.set(message.id, message);
            return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          });
          lastSeen.current = data.messages.at(-1)?.createdAt ?? since;
        }
        setThread((current) => (current ? { ...current, status: data.status as 'open' | 'closed' } : current));
      } catch {
        // keep polling silently
      }
    }, 4000);

    return () => window.clearInterval(timer);
  }, [guest]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError('نام خود را وارد کنید');
      return;
    }

    try {
      await api('/support/start', { method: 'POST', body: { displayName: name.trim(), note } });
      await bootstrap();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text || sending) return;

    setSending(true);
    setBody('');
    try {
      const result = await api<{ message: SupportMessage }>('/support/messages', {
        method: 'POST',
        body: { body: text },
      });
      setMessages((current) => [...current, result.message]);
      lastSeen.current = result.message.createdAt;
    } catch (caught) {
      setError((caught as Error).message);
      setBody(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="support-page">
      <header className="support-head">
        <a className="brand-lockup" href="/login" style={{ gap: 10 }}>
          <img src="/icons/icon-192.png" alt="حسن‌گرام" width={40} height={40} />
          <div>
            <div style={{ fontWeight: 700 }}>پشتیبانی حسن‌گرام</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>گفتگوی مستقیم با مدیر</div>
          </div>
        </a>
        <a className="btn btn-ghost" href="/login">
          ورود
        </a>
      </header>

      {loading ? (
        <div className="empty">
          <p>در حال بارگذاری…</p>
        </div>
      ) : !guest ? (
        <div className="support-start">
          <div className="auth-card">
            <h3>سلام! چطور می‌توانیم کمک کنیم؟</h3>
            <p className="sub">
              بدون حساب هم می‌توانید پیام بدهید. اگر مناسب بود، مدیر برایتان حساب می‌سازد و همین
              گفتگو به حساب شما وصل می‌شود.
            </p>

            <form className="auth-form" onSubmit={start}>
              <div className="field">
                <label htmlFor="guestName">نام شما</label>
                <input
                  id="guestName"
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="مثلاً مریم"
                />
              </div>
              <div className="field">
                <label htmlFor="guestNote">توضیح کوتاه (اختیاری)</label>
                <input
                  id="guestNote"
                  className="input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="مثلاً از طرف حسن"
                />
              </div>
              {error ? <div className="form-error">{error}</div> : null}
              <button className="btn btn-primary" type="submit">
                شروع گفتگو
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="support-chat">
          <div className="support-banner">
            <Avatar name={guest.displayName} size="sm" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{guest.displayName}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {thread?.status === 'closed' ? 'این گفتگو بسته شده است' : 'معمولاً چند دقیقه‌ای پاسخ می‌دهیم'}
              </div>
            </div>
            {guest.converted ? <span className="pill ok">حساب ساخته شد</span> : null}
          </div>

          <div className="support-messages" ref={listRef}>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`support-bubble ${message.author === 'guest' ? 'mine' : message.author}`}
              >
                {message.author === 'system' ? (
                  <span className="support-system">{message.body}</span>
                ) : (
                  <>
                    <div>{message.body}</div>
                    <div className="support-time">{formatTime(message.createdAt)}</div>
                  </>
                )}
              </div>
            ))}
          </div>

          <form className="support-composer" onSubmit={send}>
            <input
              className="input"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={thread?.status === 'closed' ? 'گفتگو بسته شده است' : 'پیام خود را بنویسید…'}
              disabled={thread?.status === 'closed'}
            />
            <button className="send" type="submit" disabled={sending || thread?.status === 'closed'}>
              <Icon name="send" />
            </button>
          </form>

          {error ? <div className="form-error" style={{ margin: '0 18px 12px' }}>{error}</div> : null}
        </div>
      )}
    </div>
  );
}

/** Admin inbox: threads, conversation and "convert to user". */
export function SupportInbox() {
  const notify = useApp((state) => state.notify);
  const loadChats = useApp((state) => state.loadChats);

  const [threads, setThreads] = useState<
    Array<{
      id: string;
      status: 'open' | 'closed';
      unreadForAdmin: number;
      guest: { id: string; displayName: string; note: string; converted: boolean };
      lastMessage: SupportMessage | null;
      lastMessageAt: string;
    }>
  >([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [created, setCreated] = useState<{ loginId: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const active = useMemo(
    () => threads.find((thread) => thread.id === activeId) ?? null,
    [threads, activeId],
  );

  async function loadThreads() {
    const data = await api<{ threads: typeof threads }>('/admin/support');
    setThreads(data.threads);
    if (!activeId && data.threads[0]) setActiveId(data.threads[0].id);
  }

  async function loadThread(id: string) {
    const data = await api<{ thread: unknown; messages: SupportMessage[] }>(`/admin/support/${id}`);
    setMessages(data.messages);
    void loadThreads();
  }

  useEffect(() => {
    void loadThreads();
    const timer = window.setInterval(() => void loadThreads(), 8000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeId) void loadThread(activeId);
  }, [activeId]);

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    if (!activeId || !reply.trim()) return;
    setBusy(true);
    try {
      const result = await api<{ message: SupportMessage }>(
        `/admin/support/${activeId}/messages`,
        { method: 'POST', body: { body: reply.trim() } },
      );
      setMessages((current) => [...current, result.message]);
      setReply('');
      void loadThreads();
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function convert(event: React.FormEvent) {
    event.preventDefault();
    if (!activeId) return;
    setBusy(true);
    try {
      const result = await api<{ loginId: string; password: string; chatId: string }>(
        `/admin/support/${activeId}/convert`,
        { method: 'POST', body: { loginId, password } },
      );
      setCreated({ loginId: result.loginId, password: result.password });
      notify('حساب ساخته شد و گفتگو به آن وصل شد');
      await loadChats();
      await loadThread(activeId);
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inbox">
      <div className="inbox-list">
        {threads.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, padding: 12 }}>
            هنوز کسی از صفحهٔ پشتیبانی پیام نداده است.
          </p>
        ) : null}

        {threads.map((thread) => (
          <button
            key={thread.id}
            className={`chat-item ${thread.id === activeId ? 'active' : ''}`}
            onClick={() => {
              setActiveId(thread.id);
              setCreated(null);
            }}
          >
            <Avatar name={thread.guest.displayName} />
            <div style={{ minWidth: 0 }}>
              <div className="title">{thread.guest.displayName}</div>
              <div className="preview">{thread.lastMessage?.body ?? 'بدون پیام'}</div>
            </div>
            <div className="meta">
              <span className="time">{formatTime(thread.lastMessageAt)}</span>
              {thread.unreadForAdmin > 0 ? (
                <span className="badge">{thread.unreadForAdmin}</span>
              ) : null}
            </div>
          </button>
        ))}
      </div>

      <div className="inbox-chat">
        {!active ? (
          <div className="empty">
            <p>یک گفتگو را انتخاب کنید</p>
          </div>
        ) : (
          <>
            <div className="inbox-head">
              <Avatar name={active.guest.displayName} size="sm" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{active.guest.displayName}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {active.guest.note || 'مهمان بدون توضیح'}
                </div>
              </div>
              {active.guest.converted ? (
                <span className="pill ok">تبدیل شده</span>
              ) : (
                <span className="pill warn">مهمان</span>
              )}
            </div>

            <div className="inbox-messages">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`support-bubble ${message.author === 'admin' ? 'mine' : message.author}`}
                >
                  {message.author === 'system' ? (
                    <span className="support-system">{message.body}</span>
                  ) : (
                    <>
                      <div>{message.body}</div>
                      <div className="support-time">{formatTime(message.createdAt)}</div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <form className="support-composer" onSubmit={sendReply}>
              <input
                className="input"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="پاسخ به مهمان…"
              />
              <button className="send" disabled={busy || !reply.trim()}>
                <Icon name="send" />
              </button>
            </form>

            {!active.guest.converted ? (
              <form className="convert-box" onSubmit={convert}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>تبدیل به کاربر</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    className="input"
                    style={{ flex: '1 1 130px' }}
                    placeholder="شناسه ۸ رقمی"
                    dir="ltr"
                    maxLength={8}
                    value={loginId}
                    onChange={(event) => setLoginId(event.target.value.replace(/\D/g, ''))}
                  />
                  <input
                    className="input"
                    style={{ flex: '1 1 130px' }}
                    placeholder="گذرواژه"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={busy || password.length < 6 || loginId.length !== 8}
                  >
                    ساخت حساب
                  </button>
                </div>
              </form>
            ) : null}

            {created ? (
              <div className="convert-done">
                حساب ساخته شد — شناسه <strong>{created.loginId}</strong> و گذرواژه{' '}
                <strong>{created.password}</strong>. همین را به کاربر بدهید.
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
