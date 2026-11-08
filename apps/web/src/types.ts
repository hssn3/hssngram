export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  lastSeenAt: string;
  createdAt: string;
  status?: 'pending' | 'active' | 'disabled';
};

export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'image' | 'video' | 'audio' | 'voice' | 'file';
  url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
};

export type Reaction = { emoji: string; userIds: string[] };

export type Message = {
  id: string;
  chatId: string;
  seq: number;
  senderId: string | null;
  kind: 'text' | 'image' | 'video' | 'audio' | 'voice' | 'file' | 'system';
  body: string;
  meta: Record<string, unknown>;
  replyTo: { id: string; senderId: string | null; kind: string; body: string } | null;
  attachments: Attachment[];
  reactions: Reaction[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  clientId?: string;
  pending?: boolean;
  failed?: boolean;
  forwardFromName?: string | null;
};

export type ChatMember = {
  user: PublicUser;
  role: 'owner' | 'admin' | 'member';
  lastReadSeq: number;
};

export type Chat = {
  id: string;
  type: 'direct' | 'group';
  title: string;
  avatarUrl: string | null;
  ownerId: string | null;
  members: ChatMember[];
  lastMessage: Message | null;
  pinnedMessage: Message | null;
  unread: number;
  mutedUntil: string | null;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
};

export type Call = {
  id: string;
  chatId: string;
  kind: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
  initiatorId: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};
