import { useMemo, useState } from 'react';
import { useApp } from '../store/useApp';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { formatListTime, previewOf } from '../lib/format';

export function Sidebar() {
  const user = useApp((state) => state.user);
  const chats = useApp((state) => state.chats);
  const activeChatId = useApp((state) => state.activeChatId);
  const selectChat = useApp((state) => state.selectChat);
  const openDialog = useApp((state) => state.openDialog);
  const typing = useApp((state) => state.typing);
  const presence = useApp((state) => state.presence);
  const connected = useApp((state) => state.connected);

  const [term, setTerm] = useState('');

  const filtered = useMemo(() => {
    const clean = term.trim();
    if (!clean) return chats;
    return chats.filter(
      (chat) =>
        chat.title.includes(clean) ||
        chat.members.some((member) => member.user.displayName.includes(clean)),
    );
  }, [chats, term]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title">
          <img src="/icons/icon-192.png" alt="حسن‌گرام" />
          <div>
            <div className="name">حسن‌گرام</div>
            <div className="sub">{connected ? 'متصل' : 'در حال اتصال…'}</div>
          </div>
        </div>

        <button className="icon-btn" aria-label="گفتگوی جدید" onClick={() => openDialog('new-chat')}>
          <Icon name="plus" />
        </button>

        <button
          className="icon-btn"
          aria-label="تنظیمات"
          onClick={() => openDialog('settings')}
          style={{ padding: 0 }}
        >
          <Avatar name={user?.displayName ?? '؟'} src={user?.avatarUrl} size="sm" />
        </button>
      </div>

      <div className="search-wrap">
        <div className="search">
          <Icon name="search" />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="جستجو در گفتگوها"
            aria-label="جستجو"
          />
        </div>
      </div>

      <div className="chat-list">
        {filtered.length === 0 ? (
          <div className="empty" style={{ padding: '40px 16px' }}>
            <p>هنوز گفتگویی نداری. با دکمه + یک گفتگوی تازه بساز.</p>
          </div>
        ) : null}

        {filtered.map((chat) => {
          const other = chat.members.find((member) => member.user.id !== user?.id)?.user;
          const online =
            chat.type === 'direct' ? Boolean(other && presence[other.id]?.online) : false;
          const typingIds = (typing[chat.id] ?? []).filter((id) => id !== user?.id);

          return (
            <button
              key={chat.id}
              className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`}
              onClick={() => void selectChat(chat.id)}
            >
              <Avatar name={chat.title} src={chat.avatarUrl} online={online} />

              <div style={{ minWidth: 0 }}>
                <div className="title-row">
                  <span className="title">{chat.title}</span>
                  {chat.type === 'group' ? <Icon name="users" style={{ width: 13, height: 13, opacity: 0.5 }} /> : null}
                </div>
                <div className={`preview ${typingIds.length ? 'typing' : ''}`}>
                  {typingIds.length
                    ? 'در حال نوشتن…'
                    : chat.lastMessage
                      ? `${chat.type === 'group' && chat.lastMessage.senderId !== user?.id ? '' : ''}${previewOf({
                          kind: chat.lastMessage.kind,
                          body: chat.lastMessage.body,
                          senderId: chat.lastMessage.senderId,
                          attachments: chat.lastMessage.attachments,
                        })}`
                      : 'شروع گفتگو'}
                </div>
              </div>

              <div className="meta">
                <span className="time">
                  {formatListTime(chat.lastMessageAt ?? chat.createdAt)}
                </span>
                {chat.unread > 0 ? <span className="badge">{chat.unread}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
