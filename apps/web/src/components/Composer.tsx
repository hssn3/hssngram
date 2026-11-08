import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/useApp';
import { Icon } from './Icon';
import { formatDuration } from '../lib/format';
import type { Message } from '../types';

const EMOJIS = [
  '😀','😂','🥰','😍','😊','🙏','👍','👌','❤️','🔥','🎉','😘',
  '😎','🤝','💐','🌹','☀️','🌙','⭐','✅','🙌','😅','🤔','😢',
  '😡','🥳','🍰','☕','🎁','📷','🎤','📎',
];

type Props = {
  chatId: string;
  replyTo: string | null;
  onClearReply: () => void;
};

const NO_MESSAGES: Message[] = [];

export function Composer({ chatId, replyTo, onClearReply }: Props) {
  const sendText = useApp((state) => state.sendText);
  const sendFiles = useApp((state) => state.sendFiles);
  const sendVoice = useApp((state) => state.sendVoice);
  const sendPayload = useApp((state) => state.sendPayload);
  const emitTyping = useApp((state) => state.emitTyping);
  const messages = useApp((state) => state.messages[chatId]) ?? NO_MESSAGES;
  const notify = useApp((state) => state.notify);

  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [silent, setSilent] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const secondsRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const typingRef = useRef<number | null>(null);

  const replyMessage = replyTo ? messages.find((message) => message.id === replyTo) : null;

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (typingRef.current) window.clearTimeout(typingRef.current);
      recorderRef.current?.state === 'recording' && recorderRef.current.stop();
    };
  }, []);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    const saved = localStorage.getItem(`hssn-draft-${chatId}`);
    if (saved) setText(saved);
  }, [chatId]);

  useEffect(() => {
    const key = `hssn-draft-${chatId}`;
    if (text.trim()) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  }, [text, chatId]);

  function wrapSelection(marker: string) {
    const element = textareaRef.current;
    if (!element) return;
    const start = element.selectionStart ?? text.length;
    const end = element.selectionEnd ?? text.length;
    const selected = text.slice(start, end) || 'متن';
    onTextChange(`${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`);
    window.requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + marker.length, start + marker.length + selected.length);
    });
    setMenuOpen(false);
  }

  function onTextChange(value: string) {
    setText(value);
    emitTyping(chatId, value.length > 0);
    if (typingRef.current) window.clearTimeout(typingRef.current);
    typingRef.current = window.setTimeout(() => emitTyping(chatId, false), 3000);
  }

  async function submit() {
    const value = text.trim();
    if (!value) return;
    setText('');
    onClearReply();
    emitTyping(chatId, false);

    if (silent) {
      await sendPayload(chatId, { body: value, silent: true });
      return;
    }

    await sendText(chatId, value, replyTo);
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    await sendFiles(chatId, list);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      notify('ضبط صدا در این مرورگر پشتیبانی نمی‌شود', 'error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

      chunksRef.current = [];
      secondsRef.current = 0;
      setSeconds(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (timerRef.current) window.clearInterval(timerRef.current);
        setRecording(false);

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];

        if (blob.size > 1500) {
          void sendVoice(chatId, blob, secondsRef.current);
        } else {
          notify('پیام صوتی خیلی کوتاه بود', 'error');
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);
    } catch {
      notify('دسترسی به میکروفون ممکن نشد', 'error');
    }
  }

  function stopRecording(cancel: boolean) {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (cancel) chunksRef.current = [];
    recorder.stop();
    recorderRef.current = null;
  }

  return (
    <div className="composer" style={{ position: 'relative' }}>
      {pollOpen ? (
        <div className="overlay" onClick={() => setPollOpen(false)} role="presentation">
          <div className="dialog" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-head">
              <h3>نظرسنجی جدید</h3>
              <button className="icon-btn" onClick={() => setPollOpen(false)} aria-label="بستن">
                <Icon name="close" />
              </button>
            </div>
            <div className="dialog-body">
              <div className="field">
                <label>سؤال</label>
                <input
                  className="input"
                  value={pollQuestion}
                  onChange={(event) => setPollQuestion(event.target.value)}
                  placeholder="مثلاً ناهار چی بخوریم؟"
                />
              </div>
              <div className="field">
                <label>گزینه‌ها (هر خط یک گزینه)</label>
                <textarea
                  className="input"
                  rows={4}
                  value={pollOptions}
                  onChange={(event) => setPollOptions(event.target.value)}
                  placeholder={'قرمه سبزی\nکوکو سبزی\nپیتزا'}
                />
              </div>
              <button
                className="btn btn-primary"
                disabled={
                  pollQuestion.trim().length < 2 ||
                  pollOptions.split('\n').filter((line) => line.trim()).length < 2
                }
                onClick={async () => {
                  const options = pollOptions
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .slice(0, 10);
                  await sendPayload(chatId, {
                    kind: 'poll',
                    body: pollQuestion.trim(),
                    meta: { question: pollQuestion.trim(), options, multiple: false, anonymous: false },
                  });
                  setPollOpen(false);
                  setPollQuestion('');
                  setPollOptions('');
                }}
              >
                ساخت نظرسنجی
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {replyMessage ? (
        <div className="reply-bar">
          <span className="bar" />
          <span className="content">
            {replyMessage.senderId ? 'پاسخ: ' : ''}
            {replyMessage.kind === 'text' ? replyMessage.body.slice(0, 80) : 'پیوست'}
          </span>
          <button className="icon-btn" onClick={onClearReply} aria-label="بستن پاسخ">
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      {emojiOpen ? (
        <div className="emoji-pop">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                onTextChange(text + emoji);
                textareaRef.current?.focus();
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}

      <div className="composer-row">
        <button
          className="icon-btn"
          aria-label="پیوست"
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon name="attach" />
        </button>

        <button
          className={`icon-btn ${menuOpen ? 'active' : ''}`}
          aria-label="گزینه‌های بیشتر"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name="more" />
        </button>

        {menuOpen ? (
          <div className="composer-menu">
            <button onClick={() => wrapSelection('*')}>
              <strong>B</strong> بولد
            </button>
            <button onClick={() => wrapSelection('_')}>
              <em>I</em> ایتالیک
            </button>
            <button onClick={() => wrapSelection('`')}>
              <span className="rich-code">{'<>'}</span> کد
            </button>
            <button onClick={() => wrapSelection('||')}>
              <Icon name="lock" /> اسپویلر
            </button>
            <button
              onClick={() => {
                setSilent((value) => !value);
                setMenuOpen(false);
              }}
            >
              <Icon name="lock" /> {silent ? 'ارسال با صدا' : 'ارسال بی‌صدا'}
            </button>
            <button
              onClick={() => {
                setPollOpen(true);
                setMenuOpen(false);
              }}
            >
              <Icon name="users" /> نظرسنجی
            </button>
            <button
              onClick={() => {
                const draft = text.trim();
                if (!draft) return;
                setText('');
                setMenuOpen(false);
                void sendPayload(chatId, {
                  body: draft,
                  silent,
                  scheduledAt: new Date(Date.now() + 10 * 60_000).toISOString(),
                });
              }}
            >
              <Icon name="settings" /> ارسال ۱۰ دقیقه بعد
            </button>
            <button
              onClick={() => {
                const draft = text.trim();
                if (!draft) return;
                setText('');
                setMenuOpen(false);
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(9, 0, 0, 0);
                void sendPayload(chatId, { body: draft, silent, scheduledAt: tomorrow.toISOString() });
              }}
            >
              <Icon name="send" /> ارسال فردا ۹ صبح
            </button>
          </div>
        ) : null}

        <button
          className={`icon-btn ${emojiOpen ? 'active' : ''}`}
          aria-label="ایموجی"
          onClick={() => setEmojiOpen((open) => !open)}
        >
          <Icon name="smile" />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => void onFiles(event.target.files)}
        />

        {recording ? (
          <div className="recording">
            <span className="rec-dot" />
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDuration(seconds)}</span>
            <span style={{ color: 'var(--muted)', fontWeight: 400 }}>در حال ضبط…</span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={() => stopRecording(true)}>
              لغو
            </button>
            <button className="btn btn-primary" onClick={() => stopRecording(false)}>
              ارسال
            </button>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            rows={1}
            dir="auto"
            enterKeyHint="send"
            autoComplete="off"
            placeholder="پیام…"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) {
                event.preventDefault();
                void sendFiles(chatId, files);
              }
            }}
          />
        )}

        {text.trim() ? (
          <button className="send" onClick={() => void submit()} aria-label="ارسال">
            <Icon name="send" />
          </button>
        ) : (
          <button
            className="send"
            onClick={() => (recording ? stopRecording(false) : void startRecording())}
            aria-label={recording ? 'پایان ضبط' : 'پیام صوتی'}
            style={recording ? { background: 'linear-gradient(135deg,#ef4444,#f43f5e)' } : undefined}
          >
            <Icon name={recording ? 'stop' : 'mic'} />
          </button>
        )}
      </div>
    </div>
  );
}


