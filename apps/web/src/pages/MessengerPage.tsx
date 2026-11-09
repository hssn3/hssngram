import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/useApp';
import { useCall } from '../store/useCall';
import { Sidebar } from '../components/Sidebar';
import { MessageList } from '../components/MessageList';
import { Composer } from '../components/Composer';
import { CallOverlay } from '../components/CallOverlay';
import { AdminDialog, ChatInfoDialog, NewChatDialog, SettingsDialog } from '../components/Dialogs';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { formatLastSeen, formatDuration, displayTitle } from '../lib/format';
import { api } from '../lib/api';

const NO_USER_IDS: string[] = [];

export function MessengerPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const ready = useApp((state) => state.ready);
  const booting = useApp((state) => state.booting);
  const user = useApp((state) => state.user);
  const init = useApp((state) => state.init);
  const activeChatId = useApp((state) => state.activeChatId);
  const chats = useApp((state) => state.chats);
  const dialog = useApp((state) => state.dialog);
  const toast = useApp((state) => state.toast);
  const dismissToast = useApp((state) => state.dismissToast);

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (ready && !user) navigate('/login', { replace: true });
  }, [ready, user, navigate]);

  useEffect(() => {
    if (user) useCall.getState().bind();
  }, [user]);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [chats, activeChatId],
  );

  useEffect(() => {
    setReplyTo(null);
    setInfoOpen(false);
  }, [activeChatId]);

  useEffect(() => {
    const target = params.get('chat');
    if (target && chats.some((chat) => chat.id === target) && target !== activeChatId) {
      void useApp.getState().selectChat(target);
    }
  }, [params, chats, activeChatId]);

  if (booting || !ready) {
    return (
      <div className="empty" style={{ minHeight: '100dvh' }}>
        <img src="/icons/icon-192.png" alt="حسن‌گرام" />
        <h3>حسن‌گرام</h3>
        <p>در حال اتصال به سرور…</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className={`app ${activeChat ? 'chat-open' : ''}`}>
      <Sidebar />

      <main className="main">
        {activeChat ? (
          <>
            <ChatHeader
              chat={activeChat}
              onInfo={() => setInfoOpen(true)}
              onSearch={() => setSearchOpen(true)}
            />
            <MessageList chat={activeChat} onReply={setReplyTo} />
                      <Composer
            chatId={activeChat.id}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            readOnly={
              activeChat.type === 'channel' &&
              activeChat.members.find((member) => member.user.id === user?.id)?.role === 'member'
            }
          />
          </>
        ) : (
          <div className="empty">
            <img src="/icons/icon-192.png" alt="حسن‌گرام" />
            <h3>به حسن‌گرام خوش آمدی، {user.displayName}</h3>
            <p>یکی از گفتگوها را انتخاب کن یا یک گفتگوی تازه بساز.</p>
          </div>
        )}
      </main>

      {dialog === 'new-chat' ? <NewChatDialog /> : null}
      {dialog === 'settings' ? <SettingsDialog /> : null}
      {dialog === 'admin' ? <AdminDialog /> : null}
      {searchOpen && activeChat ? (
        <ChatSearch chatId={activeChat.id} onClose={() => setSearchOpen(false)} />
      ) : null}

      {infoOpen && activeChat ? (
        <ChatInfoDialog chat={activeChat} onClose={() => setInfoOpen(false)} />
      ) : null}

      <CallOverlay />

      {toast ? (
        <button className={`toast ${toast.tone}`} onClick={dismissToast}>
          {toast.text}
        </button>
      ) : null}
    </div>
  );
}

function ChatHeader({
  chat,
  onInfo,
  onSearch,
}: {
  chat: NonNullable<ReturnType<typeof useApp.getState>['chats'][number]>;
  onInfo: () => void;
  onSearch: () => void;
}) {
  const user = useApp((state) => state.user);
  const closeChat = useApp((state) => state.closeChat);
  const presence = useApp((state) => state.presence);
  const typing = useApp((state) => state.typing[chat.id]) ?? NO_USER_IDS;
  const startCall = useCall((state) => state.start);
  const callStatus = useCall((state) => state.status);

  const other = chat.members.find((member) => member.user.id !== user?.id)?.user;
  const otherPresence = other ? presence[other.id] : undefined;
  const online = chat.type === 'direct' ? Boolean(otherPresence?.online) : false;

  const typingNames = typing
    .filter((id) => id !== user?.id)
    .map((id) => chat.members.find((member) => member.user.id === id)?.user.displayName)
    .filter(Boolean) as string[];

  return (
    <header className="chat-head">
      <button className="icon-btn mobile-only" onClick={closeChat} aria-label="بازگشت">
        <Icon name="back" />
      </button>

      <Avatar
        name={displayTitle(chat)}
        src={chat.avatarUrl}
        size="sm"
        online={online}
      />

      <div className="who">
        <div className="name">{displayTitle(chat)}</div>
        <div className={`status ${typingNames.length ? 'typing' : online ? 'online' : ''}`}>
          {typingNames.length > 0
            ? `${typingNames.slice(0, 2).join('، ')} در حال نوشتن…`
            : chat.type === 'group'
              ? `${chat.members.length} عضو`
              : otherPresence
                ? formatLastSeen(otherPresence.lastSeenAt, Boolean(otherPresence.online))
                : 'آخرین بازدید نامشخص'}
        </div>
      </div>

      <button
        className="icon-btn"
        aria-label="تماس صوتی"
        disabled={callStatus !== 'idle'}
        onClick={() => void startCall(chat, 'audio')}
      >
        <Icon name="phone" />
      </button>

      <button
        className="icon-btn"
        aria-label="تماس تصویری"
        disabled={callStatus !== 'idle'}
        onClick={() => void startCall(chat, 'video')}
      >
        <Icon name="video" />
      </button>

      <button className="icon-btn" aria-label="جستجو در گفتگو" onClick={onSearch}>
        <Icon name="search" />
      </button>

      <button className="icon-btn" aria-label="اطلاعات گفتگو" onClick={onInfo}>
        <Icon name={chat.type === 'group' ? 'users' : 'more'} />
      </button>
    </header>
  );
}

function ChatSearch({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Array<{ id: string; body: string; createdAt: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const clean = term.trim();
    if (clean.length < 2) {
      setResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api<{ messages: Array<{ id: string; body: string; createdAt: string }> }>(
          `/chats/${chatId}/search?q=${encodeURIComponent(clean)}`,
        );
        setResults(data.messages);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [term, chatId]);

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <h3>جستجو در این گفتگو</h3>
          <button className="icon-btn" onClick={onClose} aria-label="بستن">
            <Icon name="close" />
          </button>
        </div>
        <div className="dialog-body">
          <div className="search" style={{ padding: '0 14px' }}>
            <Icon name="search" />
            <input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="حداقل دو نویسه…"
            />
          </div>

          {loading ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>در حال جستجو…</p> : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {results.map((message) => (
              <div key={message.id} className="user-row" style={{ padding: 8 }}>
                <span className="info">
                  <span className="n" style={{ fontSize: 13 }}>
                    {message.body.slice(0, 120)}
                  </span>
                  <span className="u">{new Date(message.createdAt).toLocaleString('fa-IR')}</span>
                </span>
              </div>
            ))}

            {!loading && term.trim().length >= 2 && results.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>نتیجه‌ای پیدا نشد.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CallDuration({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return null;
  return <>{(now - startedAt) / 1000 >= 0 ? formatDuration((now - startedAt) / 1000) : '00:00'}</>;
}


