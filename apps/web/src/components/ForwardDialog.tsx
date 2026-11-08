import { useState } from 'react';
import { useApp } from '../store/useApp';
import type { Message } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { previewOf } from '../lib/format';

export function ForwardDialog({
  message,
  onClose,
}: {
  message: Message;
  onClose: () => void;
}) {
  const chats = useApp((state) => state.chats);
  const forwardMessage = useApp((state) => state.forwardMessage);
  const [busy, setBusy] = useState<string | null>(null);
  const [term, setTerm] = useState('');

  const filtered = chats.filter((chat) => chat.title.includes(term.trim()));

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <h3>هدایت پیام به…</h3>
          <button className="icon-btn" onClick={onClose} aria-label="بستن">
            <Icon name="close" />
          </button>
        </div>

        <div className="dialog-body">
          <div className="forward-source">
            <Icon name="reply" />
            <span>{previewOf(message)}</span>
          </div>

          <input
            className="input"
            placeholder="جستجوی گفتگو"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filtered.map((chat) => (
              <button
                key={chat.id}
                className="user-row"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(chat.id);
                  await forwardMessage(message.id, chat.id);
                  setBusy(null);
                  onClose();
                }}
              >
                <Avatar name={chat.title} src={chat.avatarUrl} size="sm" />
                <span className="info">
                  <span className="n">{chat.title}</span>
                  <span className="u">
                    {chat.type === 'group' ? `${chat.members.length} عضو` : 'گفتگوی خصوصی'}
                  </span>
                </span>
                {busy === chat.id ? <span className="pill">…</span> : <Icon name="send" />}
              </button>
            ))}

            {filtered.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>گفتگویی پیدا نشد.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
