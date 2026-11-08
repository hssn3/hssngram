import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/useApp';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { ForwardDialog } from './ForwardDialog';
import { api } from '../lib/api';
import { formatBytes, formatDayLabel, formatDuration, formatTime } from '../lib/format';
import { renderRichText } from '../lib/rich-text';
import type { Attachment, Chat, Message } from '../types';

type Props = {
  chat: Chat;
  onReply: (messageId: string) => void;
};

const EMPTY_MESSAGES: Message[] = [];

export function MessageList({ chat, onReply }: Props) {
  const user = useApp((state) => state.user);
  const messages = useApp((state) => state.messages[chat.id]) ?? EMPTY_MESSAGES;
  const loadOlder = useApp((state) => state.loadOlder);
  const hasMore = useApp((state) => state.hasMore[chat.id] ?? false);
  const loading = useApp((state) => state.loadingMessages[chat.id] ?? false);

  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [actionsFor, setActionsFor] = useState<Message | null>(null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages.length, chat.id]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    stickToBottom.current = true;
  }, [chat.id]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const onScroll = () => {
      stickToBottom.current =
        element.scrollHeight - element.scrollTop - element.clientHeight < 120;
      if (element.scrollTop < 80 && hasMore && !loading) {
        void loadOlder(chat.id);
      }
    };

    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [chat.id, hasMore, loading, loadOlder]);

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of chat.members) map.set(member.user.id, member.user.displayName);
    return map;
  }, [chat.members]);

  let lastDay = '';

  return (
    <div className="messages" ref={containerRef}>
      {chat.pinnedMessage ? (
        <div className="pinned-bar">
          <Icon name="lock" />
          <span className="pinned-text">
            {chat.pinnedMessage.kind === 'text'
              ? chat.pinnedMessage.body.slice(0, 80)
              : 'پیوست سنجاق‌شده'}
          </span>
          <button
            className="icon-btn"
            aria-label="برداشتن سنجاق"
            onClick={() => void useApp.getState().pinMessage(chat.id, null)}
          >
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      {loading && messages.length === 0 ? (
        <div className="day-sep">در حال بارگذاری…</div>
      ) : null}

      {messages.map((message, index) => {
        const day = formatDayLabel(message.createdAt);
        const showDay = day !== lastDay;
        lastDay = day;

        const previous = messages[index - 1];
        const next = messages[index + 1];
        const isOwn = message.senderId === user?.id;
        const sameSenderNext = next?.senderId === message.senderId && next && !next.deletedAt;
        const showName =
          chat.type === 'group' && !isOwn && (!previous || previous.senderId !== message.senderId);

        return (
          <div key={message.id} style={{ display: 'contents' }}>
            {showDay ? <div className="day-sep">{day}</div> : null}
            <MessageRow
              message={message}
              chat={chat}
              isOwn={isOwn}
              isTail={!sameSenderNext}
              showName={showName}
              senderName={message.senderId ? (memberName.get(message.senderId) ?? 'کاربر') : 'سیستم'}
              replyName={
                message.replyTo?.senderId ? (memberName.get(message.replyTo.senderId) ?? '') : ''
              }
              onReply={onReply}
              onOpenMedia={setLightbox}
              onForward={setForwarding}
              onActions={setActionsFor}
            />
          </div>
        );
      })}

      {forwarding ? (
        <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />
      ) : null}

      {actionsFor ? (
        <MessageActionSheet
          message={actionsFor}
          chat={chat}
          onClose={() => setActionsFor(null)}
          onReply={onReply}
          onForward={setForwarding}
        />
      ) : null}

      {lightbox ? (
        <div className="lightbox" onClick={() => setLightbox(null)} role="presentation">
          <button className="close icon-btn" aria-label="بستن">
            <Icon name="close" />
          </button>
          {lightbox.kind === 'video' ? (
            <video src={lightbox.url} controls autoPlay />
          ) : (
            <img src={lightbox.url} alt={lightbox.name} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function MessageRow({
  message,
  chat,
  isOwn,
  isTail,
  showName,
  senderName,
  replyName,
  onReply,
  onOpenMedia,
  onForward,
  onActions,
}: {
  message: Message;
  chat: Chat;
  isOwn: boolean;
  isTail: boolean;
  showName: boolean;
  senderName: string;
  replyName: string;
  onReply: (messageId: string) => void;
  onOpenMedia: (attachment: Attachment) => void;
  onForward: (message: Message) => void;
  onActions: (message: Message) => void;
}) {
  const user = useApp((state) => state.user);
  const editMessage = useApp((state) => state.editMessage);
  const deleteMessage = useApp((state) => state.deleteMessage);
  const deleteForMe = useApp((state) => state.deleteForMe);
  const pinMessage = useApp((state) => state.pinMessage);
  const react = useApp((state) => state.react);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);

  const sender = chat.members.find((member) => member.user.id === message.senderId)?.user;
  const readByOthers = chat.members.some(
    (member) => member.user.id !== user?.id && member.lastReadSeq >= message.seq,
  );

  if (message.kind === 'system') {
    return <div className="bubble system">{message.body}</div>;
  }

  const deleted = Boolean(message.deletedAt);
  const canEdit = isOwn && !deleted && message.kind === 'text';
  const canDelete = !deleted && (isOwn || chat.members.find((m) => m.user.id === user?.id)?.role !== 'member');

  async function save() {
    const text = draft.trim();
    setEditing(false);
    if (!text || text === message.body) return;
    await editMessage(message.id, text);
  }

  return (
    <div className={`msg ${isOwn ? 'mine' : 'theirs'} ${isTail ? 'tail' : ''}`}>
      {chat.type === 'group' && !isOwn ? (
        <Avatar name={sender?.displayName ?? '?'} src={sender?.avatarUrl} size="sm" />
      ) : null}

      <div className="bubble-wrap">
        <div className={`bubble ${deleted ? 'deleted' : ''}`}>
          {showName ? <div className="sender">{senderName}</div> : null}
          {message.forwardFromName ? (
            <div className="forwarded">هدایت‌شده از {message.forwardFromName}</div>
          ) : null}

          {message.replyTo ? (
            <span className="reply-quote">
              {replyName ? `${replyName}: ` : ''}
              {message.replyTo.kind === 'text' ? message.replyTo.body.slice(0, 90) : 'پیوست'}
            </span>
          ) : null}

          {deleted ? (
            'این پیام حذف شد'
          ) : editing ? (
            <div style={{ minWidth: 240 }}>
              <textarea
                className="input"
                value={draft}
                rows={2}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void save();
                  }
                  if (event.key === 'Escape') setEditing(false);
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="btn btn-primary" style={{ padding: '6px 12px' }} onClick={save}>
                  ذخیره
                </button>
                <button
                  className="btn"
                  style={{ padding: '6px 12px' }}
                  onClick={() => {
                    setDraft(message.body);
                    setEditing(false);
                  }}
                >
                  انصراف
                </button>
              </div>
            </div>
          ) : (
            <MessageContent message={message} onOpenMedia={onOpenMedia} />
          )}

          <div className="meta">
            {message.editedAt ? <span>ویرایش شد</span> : null}
            <span>{formatTime(message.createdAt)}</span>
            {isOwn ? (
              <span className="tick">
                {message.pending ? (
                  <span className="pending-dot">…</span>
                ) : message.failed ? (
                  <span className="failed">!</span>
                ) : (
                  <Icon name={readByOthers ? 'checks' : 'check'} style={{ width: 14, height: 14 }} />
                )}
              </span>
            ) : null}
          </div>
        </div>

        {message.reactions.length > 0 ? (
          <div className="reactions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                className={`reaction ${reaction.userIds.includes(user?.id ?? '') ? 'mine' : ''}`}
                onClick={() => void react(message.id, reaction.emoji)}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.userIds.length}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!deleted ? (
        <button
          className="msg-more"
          aria-label="منوی پیام"
          onClick={() => onActions(message)}
        >
          <Icon name="more" />
        </button>
      ) : null}

      {!deleted ? (
        <div className="msg-tools">
          <button aria-label="پاسخ" onClick={() => onReply(message.id)}>
            <Icon name="reply" />
          </button>
          <button aria-label="واکنش" onClick={() => void react(message.id, '❤️')}>
            <Icon name="smile" />
          </button>
          <button aria-label="هدایت" onClick={() => onForward(message)}>
            <Icon name="send" />
          </button>
          <button aria-label="سنجاق" onClick={() => void pinMessage(chat.id, message.id)}>
            <Icon name="lock" />
          </button>
          <button
            aria-label="حذف برای من"
            onClick={() => {
              if (window.confirm('این پیام فقط برای شما پنهان شود؟')) void deleteForMe(message.id);
            }}
          >
            <Icon name="close" />
          </button>
          {canEdit ? (
            <button aria-label="ویرایش" onClick={() => setEditing(true)}>
              <Icon name="edit" />
            </button>
          ) : null}
          {canDelete ? (
            <button
              aria-label="حذف"
              onClick={() => {
                if (window.confirm('این پیام برای همه حذف شود؟')) void deleteMessage(message.id);
              }}
            >
              <Icon name="trash" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MessageContent({
  message,
  onOpenMedia,
}: {
  message: Message;
  onOpenMedia: (attachment: Attachment) => void;
}) {

  return (
    <>
      {message.poll ? <PollCard message={message} /> : null}

      {message.attachments.length > 0 ? (
        <div
          className={
            message.attachments.length > 1 && message.attachments.every((item) => item.kind === 'image')
              ? 'attachments album'
              : 'attachments'
          }
        >
          {message.attachments.map((attachment) => {
            if (attachment.kind === 'image') {
              return (
                <img
                  key={attachment.id}
                  src={attachment.url}
                  alt={attachment.name}
                  loading="lazy"
                  onClick={() => onOpenMedia(attachment)}
                />
              );
            }

            if (attachment.kind === 'video') {
              return (
                <video
                  key={attachment.id}
                  src={attachment.url}
                  controls
                  preload="metadata"
                  onClick={() => onOpenMedia(attachment)}
                />
              );
            }

            if (attachment.kind === 'voice' || attachment.kind === 'audio') {
              return (
                <div key={attachment.id} className="voice-row">
                  <span className="play">
                    <Icon name="play" />
                  </span>
                  <div className="waveform">
                    {Array.from({ length: 22 }).map((_, index) => (
                      <i
                        key={index}
                        style={{ height: `${6 + ((index * 7) % 16)}px`, opacity: 0.55 + (index % 3) * 0.15 }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>
                    {attachment.duration ? formatDuration(attachment.duration) : 'صدا'}
                  </span>
                  <audio src={attachment.url} controls hidden />
                </div>
              );
            }

            return (
              <a
                key={attachment.id}
                className="file-card"
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                download
              >
                <Icon name="file" />
                <span className="info">
                  <span className="fname">{attachment.name}</span>
                  <span className="fsize">{formatBytes(attachment.size)}</span>
                </span>
                <Icon name="download" />
              </a>
            );
          })}
        </div>
      ) : null}

      {message.body ? <div className="text">{renderRichText(message.body)}</div> : null}
    </>
  );
}

function PollCard({ message }: { message: Message }) {
  const votePoll = useApp((state) => state.votePoll);
  const poll = message.poll;
  if (!poll) return null;

  const total = Math.max(poll.totalVotes, 1);

  return (
    <div className="poll">
      <div className="poll-question">{poll.question}</div>
      <div className="poll-meta">
        {poll.anonymous ? 'ناشناس' : 'عمومی'} • {poll.totalVotes} رأی
        {poll.multiple ? ' • چندگزینه‌ای' : ''}
      </div>
      <div className="poll-options">
        {poll.options.map((option, index) => {
          const mine = poll.myVotes.includes(index);
          const percent = Math.round((option.votes / total) * 100);
          return (
            <button
              key={index}
              className={`poll-option ${mine ? 'mine' : ''}`}
              disabled={poll.closed}
              onClick={() => void votePoll(message.id, index)}
            >
              <span className="poll-bar" style={{ width: `${percent}%` }} />
              <span className="poll-label">
                <span className="poll-check">{mine ? '●' : '○'}</span>
                {option.text}
              </span>
              <span className="poll-count">{percent}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MessageActionSheet({
  message,
  chat,
  onClose,
  onReply,
  onForward,
}: {
  message: Message;
  chat: Chat;
  onClose: () => void;
  onReply: (messageId: string) => void;
  onForward: (message: Message) => void;
}) {
  const user = useApp((state) => state.user);
  const react = useApp((state) => state.react);
  const pinMessage = useApp((state) => state.pinMessage);
  const deleteForMe = useApp((state) => state.deleteForMe);
  const deleteMessage = useApp((state) => state.deleteMessage);
  const editMessage = useApp((state) => state.editMessage);

  const me = chat.members.find((member) => member.user.id === user?.id);
  const isOwn = message.senderId === user?.id;
  const canEdit = isOwn && message.kind === 'text';
  const canDelete = isOwn || me?.role === 'owner' || me?.role === 'admin';

  const close = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div className="dialog action-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <h3>عملیات پیام</h3>
          <button className="icon-btn" onClick={onClose} aria-label="بستن">
            <Icon name="close" />
          </button>
        </div>
        <div className="action-list">
          <button onClick={close(() => onReply(message.id))}>
            <Icon name="reply" /> پاسخ
          </button>
          <button onClick={close(() => void react(message.id, '❤️'))}>
            <Icon name="smile" /> واکنش با ❤️
          </button>
          <button
            onClick={close(() => {
              onClose();
              onForward(message);
            })}
          >
            <Icon name="send" /> هدایت به گفتگو
          </button>
          <button onClick={close(() => void pinMessage(chat.id, message.id))}>
            <Icon name="lock" /> سنجاق در گفتگو
          </button>
          {canEdit ? (
            <button
              onClick={close(() => {
                const next = window.prompt('متن جدید پیام', message.body);
                if (next && next.trim() && next.trim() !== message.body) {
                  void editMessage(message.id, next.trim());
                }
              })}
            >
              <Icon name="edit" /> ویرایش
            </button>
          ) : null}
          <button onClick={close(() => void deleteForMe(message.id))}>
            <Icon name="close" /> حذف برای من
          </button>
          <button
            onClick={close(() => {
              void navigator.clipboard.writeText(message.body).catch(() => undefined);
            })}
          >
            <Icon name="file" /> کپی متن
          </button>
          <button
            onClick={close(async () => {
              try {
                const data = await api<{ readBy: Array<{ displayName: string }> }>(
                  `/messages/${message.id}/readers`,
                );
                useApp
                  .getState()
                  .notify(
                    data.readBy.length
                      ? `خوانده‌شده توسط: ${data.readBy.map((row) => row.displayName).join('، ')}`
                      : 'هنوز کسی این پیام را نخوانده است',
                  );
              } catch {
                useApp.getState().notify('دریافت اطلاعات خوانندگان ناموفق بود', 'error');
              }
            })}
          >
            <Icon name="checks" /> چه کسی خوانده است؟
          </button>
          {canDelete ? (
            <button
              className="danger"
              onClick={close(() => {
                if (window.confirm('این پیام برای همه حذف شود؟')) void deleteMessage(message.id);
              })}
            >
              <Icon name="trash" /> حذف برای همه
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

