import { create } from 'zustand';
import { api, bootstrapSession, getAccessToken, setAccessToken, uploadFile } from '../lib/api';
import { connectSocket, disconnectSocket, getSocket } from '../lib/socket';
import type { Chat, Message, PublicUser } from '../types';

type Toast = { id: number; text: string; tone: 'ok' | 'error' };
type DialogKind = 'new-chat' | 'settings' | 'admin' | null;

type AppState = {
  ready: boolean;
  booting: boolean;
  user: PublicUser | null;
  chats: Chat[];
  messages: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  loadingMessages: Record<string, boolean>;
  activeChatId: string | null;
  presence: Record<string, { online: boolean; lastSeenAt: string }>;
  typing: Record<string, string[]>;
  connected: boolean;
  dialog: DialogKind;
  toast: Toast | null;

  init: () => Promise<void>;
  login: (loginId: string, password: string) => Promise<void>;
  register: (input: {
    loginId: string;
    displayName: string;
    password: string;
  }) => Promise<'active' | 'pending'>;
  logout: () => Promise<void>;

  openDialog: (dialog: DialogKind) => void;
  notify: (text: string, tone?: 'ok' | 'error') => void;
  dismissToast: () => void;

  loadChats: () => Promise<void>;
  selectChat: (chatId: string) => Promise<void>;
  closeChat: () => void;
  loadOlder: (chatId: string) => Promise<void>;
  sendText: (chatId: string, body: string, replyToId?: string | null) => Promise<void>;
  sendPayload: (
    chatId: string,
    payload: {
      body?: string;
      kind?: 'text' | 'poll' | 'image' | 'video' | 'file' | 'audio';
      meta?: Record<string, unknown>;
      silent?: boolean;
      scheduledAt?: string | null;
    },
  ) => Promise<void>;
  votePoll: (messageId: string, optionIndex: number) => Promise<void>;
  sendFiles: (chatId: string, files: File[], caption?: string) => Promise<void>;
  sendVoice: (chatId: string, blob: Blob, duration: number) => Promise<void>;
  editMessage: (messageId: string, body: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  createDirect: (userId: string) => Promise<string>;
  createGroup: (title: string, memberIds: string[]) => Promise<string>;
  forwardMessage: (messageId: string, chatId: string) => Promise<void>;
  pinMessage: (chatId: string, messageId: string | null) => Promise<void>;
  deleteForMe: (messageId: string) => Promise<void>;
  archiveChat: (chatId: string, archived: boolean) => Promise<void>;
  updateProfile: (patch: { displayName?: string; bio?: string }) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  refreshMe: () => Promise<void>;
  markRead: (chatId: string, seq: number) => void;
  emitTyping: (chatId: string, isTyping: boolean) => void;
};

let toastCounter = 0;
let typingTimers: Record<string, number> = {};

const byActivity = (a: Chat, b: Chat) =>
  new Date(b.lastMessageAt ?? b.createdAt).getTime() -
  new Date(a.lastMessageAt ?? a.createdAt).getTime();

function sortMessages(list: Message[]): Message[] {
  return [...list].sort(
    (a, b) => a.seq - b.seq || a.createdAt.localeCompare(b.createdAt),
  );
}

function upsert(list: Message[], incoming: Message): Message[] {
  const byId = list.findIndex((message) => message.id === incoming.id);
  if (byId >= 0) {
    const next = [...list];
    next[byId] = incoming;
    return sortMessages(next);
  }

  const clientId = incoming.meta?.clientId;
  if (typeof clientId === 'string') {
    const byClient = list.findIndex(
      (message) => message.meta?.clientId === clientId && (message.pending || message.failed),
    );
    if (byClient >= 0) {
      const next = [...list];
      next[byClient] = { ...incoming, pending: false, failed: false };
      return sortMessages(next);
    }
  }

  return sortMessages([...list, incoming]);
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  booting: true,
  user: null,
  chats: [],
  messages: {},
  hasMore: {},
  loadingMessages: {},
  activeChatId: null,
  presence: {},
  typing: {},
  connected: false,
  dialog: null,
  toast: null,

  notify: (text, tone = 'ok') => {
    toastCounter += 1;
    const current = toastCounter;
    set({ toast: { id: current, text, tone } });
    setTimeout(() => {
      if (get().toast?.id === current) set({ toast: null });
    }, 4200);
  },

  dismissToast: () => set({ toast: null }),
  openDialog: (dialog) => set({ dialog }),

  init: async () => {
    set({ booting: true });
    const restored = get().user ? true : await bootstrapSession();

    if (!restored) {
      set({ booting: false, ready: true, user: null });
      return;
    }

    try {
      const me = await api<{ user: PublicUser }>('/users');
      set({ user: me.user });
      await get().loadChats();
      bindSocket();
      set({ ready: true, booting: false });
    } catch {
      set({ booting: false, ready: true, user: null });
    }
  },

  login: async (loginId, password) => {
    const result = await api<{ accessToken: string; user: PublicUser }>('/auth/login', {
      method: 'POST',
      body: { loginId, password },
    });
    setAccessToken(result.accessToken);
    set({ user: result.user, ready: true });
    await get().loadChats();
    bindSocket();
  },

  register: async (input) => {
    const result = await api<{ accessToken?: string; user: PublicUser; status?: string }>(
      '/auth/register',
      { method: 'POST', body: input, skipAuthRetry: true },
    );

    if (result.accessToken) {
      setAccessToken(result.accessToken);
      set({ user: result.user, ready: true });
      await get().loadChats();
      bindSocket();
      return 'active';
    }

    return 'pending';
  },

  logout: async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    disconnectSocket();
    setAccessToken(null);
    set({
      user: null,
      chats: [],
      messages: {},
      activeChatId: null,
      hasMore: {},
      typing: {},
      presence: {},
      dialog: null,
      connected: false,
    });
  },

  loadChats: async () => {
    const result = await api<{ chats: Chat[] }>('/chats');
    set({ chats: [...result.chats].sort(byActivity) });
  },

  selectChat: async (chatId) => {
    set({ activeChatId: chatId });
    getSocket()?.emit('chat:subscribe', { chatId });
    set({ loadingMessages: { ...get().loadingMessages, [chatId]: true } });

    try {
      const result = await api<{ messages: Message[] }>(`/chats/${chatId}/messages?limit=40`);
      const pending = (get().messages[chatId] ?? []).filter((m) => m.pending || m.failed);

      set({
        messages: { ...get().messages, [chatId]: sortMessages([...result.messages, ...pending]) },
        hasMore: { ...get().hasMore, [chatId]: result.messages.length === 40 },
        loadingMessages: { ...get().loadingMessages, [chatId]: false },
        chats: get().chats.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)),
      });

      const last = result.messages.at(-1);
      if (last) get().markRead(chatId, last.seq);
    } catch (error) {
      set({ loadingMessages: { ...get().loadingMessages, [chatId]: false } });
      get().notify((error as Error).message, 'error');
    }
  },

  closeChat: () => set({ activeChatId: null }),

  loadOlder: async (chatId) => {
    const list = get().messages[chatId] ?? [];
    const oldest = list.find((message) => !message.pending && !message.failed);
    if (!oldest || get().loadingMessages[chatId]) return;

    set({ loadingMessages: { ...get().loadingMessages, [chatId]: true } });
    try {
      const result = await api<{ messages: Message[] }>(
        `/chats/${chatId}/messages?before=${oldest.seq}&limit=40`,
      );
      set({
        messages: { ...get().messages, [chatId]: sortMessages([...result.messages, ...list]) },
        hasMore: { ...get().hasMore, [chatId]: result.messages.length === 40 },
        loadingMessages: { ...get().loadingMessages, [chatId]: false },
      });
    } catch {
      set({ loadingMessages: { ...get().loadingMessages, [chatId]: false } });
    }
  },

  sendPayload: async (chatId, payload) => {
    try {
      const result = await api<{ message: Message }>(`/chats/${chatId}/messages`, {
        method: 'POST',
        body: {
          body: payload.body,
          kind: payload.kind,
          meta: payload.meta,
          silent: payload.silent,
          scheduledAt: payload.scheduledAt ?? null,
          clientId: `p-${Date.now()}`,
        },
      });
      const current = get().messages[chatId] ?? [];
      set({ messages: { ...get().messages, [chatId]: upsert(current, result.message) } });
      get().notify(result.message.scheduledAt ? 'پیام زمان‌بندی شد' : 'ارسال شد');
    } catch (error) {
      get().notify((error as Error).message, 'error');
    }
  },

  votePoll: async (messageId, optionIndex) => {
    try {
      const result = await api<{ counts: number[]; myVotes: number[] }>(
        `/messages/${messageId}/vote`,
        { method: 'POST', body: { optionIndex } },
      );
      const state = get();
      const next: Record<string, Message[]> = {};
      for (const [chatId, list] of Object.entries(state.messages)) {
        next[chatId] = list.map((message) =>
          message.id === messageId && message.poll
            ? {
                ...message,
                poll: {
                  ...message.poll,
                  options: message.poll.options.map((option, index) => ({
                    ...option,
                    votes: result.counts[index] ?? 0,
                  })),
                  totalVotes: result.counts.reduce((sum, value) => sum + value, 0),
                  myVotes: result.myVotes,
                },
              }
            : message,
        );
      }
      set({ messages: next });
    } catch (error) {
      get().notify((error as Error).message, 'error');
    }
  },

  sendText: async (chatId, body, replyToId) => {
    const text = body.trim();
    if (!text) return;

    const user = get().user;
    const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const localId = `local-${clientId}`;
    const optimistic: Message = {
      id: localId,
      chatId,
      seq: Number.MAX_SAFE_INTEGER,
      senderId: user?.id ?? null,
      kind: 'text',
      body: text,
      meta: { clientId },
      replyTo: null,
      attachments: [],
      reactions: [],
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      clientId,
      pending: true,
    };

    const current = get().messages[chatId] ?? [];
    set({ messages: { ...get().messages, [chatId]: [...current, optimistic] } });
    getSocket()?.emit('typing', { chatId, isTyping: false });

    try {
      const result = await api<{ message: Message }>(`/chats/${chatId}/messages`, {
        method: 'POST',
        body: { body: text, replyToId: replyToId ?? null, clientId },
      });

      const next = (get().messages[chatId] ?? []).map((message) =>
        message.clientId === clientId ? { ...result.message, pending: false } : message,
      );
      set({
        messages: { ...get().messages, [chatId]: sortMessages(next) },
        chats: get().chats.map((chat) =>
          chat.id === chatId
            ? { ...chat, lastMessage: result.message, lastMessageAt: result.message.createdAt }
            : chat,
        ),
      });
    } catch (error) {
      const next = (get().messages[chatId] ?? []).map((message) =>
        message.clientId === clientId ? { ...message, pending: false, failed: true } : message,
      );
      set({ messages: { ...get().messages, [chatId]: next } });
      get().notify((error as Error).message, 'error');
    }
  },

  sendFiles: async (chatId, files, caption) => {
    if (files.length === 0) return;

    for (const file of files.slice(0, 10)) {
      try {
        const attachment = await uploadFile(file);
        const kind = file.type.startsWith('image/')
          ? 'image'
          : file.type.startsWith('video/')
            ? 'video'
            : file.type.startsWith('audio/')
              ? 'audio'
              : 'file';

        const result = await api<{ message: Message }>(`/chats/${chatId}/messages`, {
          method: 'POST',
          body: { body: caption ?? '', kind, attachmentIds: [attachment.id] },
        });
        const current = get().messages[chatId] ?? [];
        set({ messages: { ...get().messages, [chatId]: upsert(current, result.message) } });
      } catch (error) {
        get().notify((error as Error).message, 'error');
      }
    }
  },

  sendVoice: async (chatId, blob, duration) => {
    try {
      const file = new File([blob], `voice-${Date.now()}.webm`, {
        type: blob.type || 'audio/webm',
      });
      const attachment = await uploadFile(file, { kind: 'voice', duration });
      const result = await api<{ message: Message }>(`/chats/${chatId}/messages`, {
        method: 'POST',
        body: { kind: 'voice', attachmentIds: [attachment.id] },
      });
      const current = get().messages[chatId] ?? [];
      set({ messages: { ...get().messages, [chatId]: upsert(current, result.message) } });
    } catch (error) {
      get().notify((error as Error).message, 'error');
    }
  },

  editMessage: async (messageId, body) => {    const result = await api<{ message: Message }>(`/messages/${messageId}`, {
      method: 'PATCH',
      body: { body },
    });
    const current = get().messages[result.message.chatId] ?? [];
    set({
      messages: { ...get().messages, [result.message.chatId]: upsert(current, result.message) },
    });
  },

  deleteMessage: async (messageId) => {
    const result = await api<{ message: Message }>(`/messages/${messageId}`, { method: 'DELETE' });
    const current = get().messages[result.message.chatId] ?? [];
    set({
      messages: { ...get().messages, [result.message.chatId]: upsert(current, result.message) },
    });
  },

  react: async (messageId, emoji) => {
    try {
      await api(`/messages/${messageId}/reactions`, { method: 'POST', body: { emoji } });
    } catch (error) {
      get().notify((error as Error).message, 'error');
    }
  },

  forwardMessage: async (messageId, chatId) => {
    try {
      const result = await api<{ message: Message }>(`/messages/${messageId}/forward`, {
        method: 'POST',
        body: { chatId },
      });
      const current = get().messages[chatId] ?? [];
      set({ messages: { ...get().messages, [chatId]: upsert(current, result.message) } });
      get().notify('پیام هدایت شد');
    } catch (error) {
      get().notify((error as Error).message, 'error');
    }
  },

  pinMessage: async (chatId, messageId) => {
    try {
      const result = await api<{ chat: Chat }>(`/chats/${chatId}/pin`, {
        method: 'POST',
        body: { messageId },
      });
      set({ chats: get().chats.map((chat) => (chat.id === chatId ? result.chat : chat)) });
      get().notify(messageId ? 'پیام سنجاق شد' : 'سنجاق برداشته شد');
    } catch (error) {
      get().notify((error as Error).message, 'error');
    }
  },

  deleteForMe: async (messageId) => {
    try {
      await api(`/messages/${messageId}?scope=me`, { method: 'DELETE' });
      const state = get();
      const next: Record<string, Message[]> = {};
      for (const [chatId, list] of Object.entries(state.messages)) {
        next[chatId] = list.filter((message) => message.id !== messageId);
      }
      set({ messages: next });
    } catch (error) {
      get().notify((error as Error).message, 'error');
    }
  },

  archiveChat: async (chatId, archived) => {
    try {
      await api(`/chats/${chatId}/archive`, { method: 'POST', body: { archived } });
      set({ chats: get().chats.filter((chat) => chat.id !== chatId) });
      get().notify(archived ? 'به آرشیو رفت' : 'از آرشیو خارج شد');
    } catch (error) {
      get().notify((error as Error).message, 'error');
    }
  },

  createDirect: async (userId) => {
    const result = await api<{ chat: Chat }>('/chats/direct', {
      method: 'POST',
      body: { userId },
    });
    const chats = get().chats.some((chat) => chat.id === result.chat.id)
      ? get().chats
      : [result.chat, ...get().chats];
    set({ chats, dialog: null });
    await get().selectChat(result.chat.id);
    return result.chat.id;
  },

  createGroup: async (title, memberIds) => {
    const result = await api<{ chat: Chat }>('/chats/group', {
      method: 'POST',
      body: { title, memberIds },
    });
    set({ chats: [result.chat, ...get().chats], dialog: null });
    await get().selectChat(result.chat.id);
    return result.chat.id;
  },

  updateProfile: async (patch) => {
    const result = await api<{ user: PublicUser }>('/users', { method: 'PATCH', body: patch });
    set({ user: result.user });
    get().notify('پروفایل به‌روزرسانی شد');
  },

  uploadAvatar: async (file) => {
    const token = getAccessToken();
    const response = await fetch('/api/users/avatar', {
      method: 'POST',
      headers: {
        'content-type': file.type,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: file,
      credentials: 'include',
    });

    if (!response.ok) {
      get().notify('بارگذاری تصویر ناموفق بود', 'error');
      return;
    }

    const data = (await response.json()) as { user: PublicUser };
    set({ user: data.user });
    get().notify('تصویر پروفایل به‌روزرسانی شد');
  },

  refreshMe: async () => {
    const result = await api<{ user: PublicUser }>('/users');
    set({ user: result.user });
  },

  markRead: (chatId, seq) => {
    getSocket()?.emit('read', { chatId, seq });
    set({
      chats: get().chats.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)),
    });
  },

  emitTyping: (chatId, isTyping) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('typing', { chatId, isTyping });

    if (isTyping) {
      window.clearTimeout(typingTimers[chatId]);
      typingTimers[chatId] = window.setTimeout(() => {
        socket.emit('typing', { chatId, isTyping: false });
      }, 2500);
    }
  },
}));

function bindSocket(): void {
  const socket = connectSocket(getAccessToken() ?? '');
  if (!socket) return;

  socket.on('connect', () => useApp.setState({ connected: true }));
  socket.on('disconnect', () => useApp.setState({ connected: false }));

  socket.on('message:new', (message: Message) => {
    if (document.hidden && message.senderId !== useApp.getState().user?.id) {
      const original = document.title;
      let flip = false;
      const timer = window.setInterval(() => {
        flip = !flip;
        document.title = flip ? 'پیام جدید' : original;
      }, 1200);
      const stop = () => {
        window.clearInterval(timer);
        document.title = original;
        window.removeEventListener('visibilitychange', stop);
      };
      window.addEventListener('visibilitychange', stop);
    }
    const state = useApp.getState();
    const isActive = state.activeChatId === message.chatId;
    const isOwn = message.senderId === state.user?.id;
    const list = state.messages[message.chatId] ?? [];

    const known = state.chats.some((chat) => chat.id === message.chatId);
    if (!known) {
      void state.loadChats();
      return;
    }

    const chats = state.chats
      .map((chat) =>
        chat.id === message.chatId
          ? {
              ...chat,
              lastMessage: message,
              lastMessageAt: message.createdAt,
              updatedAt: message.createdAt,
              unread: isActive || isOwn ? 0 : chat.unread + 1,
            }
          : chat,
      )
      .sort(byActivity);

    useApp.setState({
      messages: { ...state.messages, [message.chatId]: upsert(list, message) },
      chats,
    });

    if (!isActive && !isOwn) {
      const chat = chats.find((item) => item.id === message.chatId);
      const preview = message.body || (message.kind === 'image' ? 'عکس' : 'پیام جدید');
      state.notify(`${chat?.title ?? 'گفتگو'}: ${preview.slice(0, 50)}`);
    }

    if (isActive && !isOwn) state.markRead(message.chatId, message.seq);
  });

  socket.on('message:update', (message: Message) => {
    const state = useApp.getState();
    const list = state.messages[message.chatId] ?? [];
    useApp.setState({
      messages: { ...state.messages, [message.chatId]: upsert(list, message) },
    });
  });

  socket.on('chat:update', (chat: Chat) => {
    const state = useApp.getState();
    const exists = state.chats.some((item) => item.id === chat.id);
    const chats = exists
      ? state.chats.map((item) => (item.id === chat.id ? { ...chat, unread: item.unread } : chat))
      : [chat, ...state.chats];

    useApp.setState({ chats: chats.sort(byActivity) });
  });

  socket.on('chat:new', (chat: Chat) => {
    const state = useApp.getState();
    if (state.chats.some((item) => item.id === chat.id)) return;
    useApp.setState({ chats: [chat, ...state.chats].sort(byActivity) });
  });

  socket.on('chat:removed', (payload: { chatId: string }) => {
    const state = useApp.getState();
    const messages = { ...state.messages };
    delete messages[payload.chatId];
    useApp.setState({
      chats: state.chats.filter((chat) => chat.id !== payload.chatId),
      messages,
      activeChatId: state.activeChatId === payload.chatId ? null : state.activeChatId,
    });
  });

  socket.on(
    'typing',
    (payload: { chatId: string; userId: string; isTyping: boolean }) => {
      const state = useApp.getState();
      const current = new Set(state.typing[payload.chatId] ?? []);

      if (payload.isTyping) current.add(payload.userId);
      else current.delete(payload.userId);

      useApp.setState({ typing: { ...state.typing, [payload.chatId]: [...current] } });

      if (payload.isTyping) {
        window.setTimeout(() => {
          const latest = useApp.getState();
          const set2 = new Set(latest.typing[payload.chatId] ?? []);
          set2.delete(payload.userId);
          useApp.setState({ typing: { ...latest.typing, [payload.chatId]: [...set2] } });
        }, 4000);
      }
    },
  );

  socket.on('presence', (payload: { userId: string; online: boolean; lastSeenAt: string }) => {
    const state = useApp.getState();
    useApp.setState({
      presence: {
        ...state.presence,
        [payload.userId]: { online: payload.online, lastSeenAt: payload.lastSeenAt },
      },
    });
  });

  socket.on(
    'reaction',
    (payload: { messageId: string; chatId: string; emoji: string; userIds: string[] }) => {
      const state = useApp.getState();
      const list = state.messages[payload.chatId] ?? [];
      const next = list.map((message) => {
        if (message.id !== payload.messageId) return message;
        const others = message.reactions.filter((reaction) => reaction.emoji !== payload.emoji);
        return {
          ...message,
          reactions: payload.userIds.length
            ? [...others, { emoji: payload.emoji, userIds: payload.userIds }]
            : others,
        };
      });
      useApp.setState({ messages: { ...state.messages, [payload.chatId]: next } });
    },
  );

  socket.on('read', (payload: { chatId: string; userId: string; seq: number }) => {
    const state = useApp.getState();
    useApp.setState({
      chats: state.chats.map((chat) =>
        chat.id === payload.chatId
          ? {
              ...chat,
              members: chat.members.map((member) =>
                member.user.id === payload.userId
                  ? { ...member, lastReadSeq: payload.seq }
                  : member,
              ),
            }
          : chat,
      ),
    });
  });
}

