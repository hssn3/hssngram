export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  lastSeenAt: string;
  createdAt: string;
};

export type AttachmentDto = {
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

export type ReactionDto = {
  emoji: string;
  userIds: string[];
};

export type MessageDto = {
  id: string;
  chatId: string;
  seq: number;
  senderId: string | null;
  kind: 'text' | 'image' | 'video' | 'audio' | 'voice' | 'file' | 'system' | 'poll';
  body: string;
  meta: Record<string, unknown>;
  replyTo: { id: string; senderId: string | null; kind: string; body: string } | null;
  attachments: AttachmentDto[];
  reactions: ReactionDto[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  forwardFromName?: string | null;
  groupId?: string | null;
  silent?: boolean;
  scheduledAt?: string | null;
  poll?: {
    question: string;
    options: Array<{ text: string; votes: number }>;
    totalVotes: number;
    multiple: boolean;
    anonymous: boolean;
    closed: boolean;
    myVotes: number[];
  } | null;
};

export type ChatMemberDto = {
  user: PublicUser;
  role: 'owner' | 'admin' | 'member';
  lastReadSeq: number;
};

export type ChatDto = {
  id: string;
  type: 'direct' | 'group' | 'channel';
  title: string;
  avatarUrl: string | null;
  ownerId: string | null;
  members: ChatMemberDto[];
  lastMessage: MessageDto | null;
  pinnedMessage: MessageDto | null;
  unread: number;
  mutedUntil: string | null;
  archived: boolean;
  ttlSeconds?: number | null;
  slowmodeSeconds?: number;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
};

export type CallDto = {
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
