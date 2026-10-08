export type EntityId = string;
export type ClientSendStatus = 'queued' | 'sending' | 'uploading' | 'failed';

export type User = {
  _id?: EntityId;
  id?: EntityId;
  name?: string;
  email?: string;
  avatar?: string;
  profilePicture?: string;
  coverPhoto?: string;
  lastSeen?: string;
  bio?: string;
  course?: string;
  campus?: string;
  isDeveloper?: boolean;
};

export type MessageAttachment = {
  fileUrl: string;
  fileType?: 'image' | 'video' | 'audio' | 'file' | string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  localUri?: string;
  storagePath?: string;
  storageProvider?: string;
  variants?: Record<string, string | { fileUrl?: string; url?: string }>;
};

export type Message = {
  _id?: EntityId;
  id?: EntityId;
  clientId?: string;
  clientStatus?: ClientSendStatus;
  clientError?: string;
  from?: User | EntityId;
  to?: User | EntityId;
  text?: string;
  createdAt?: string;
  read?: boolean;
  readAt?: string;
  editedAt?: string;
  pinned?: boolean;
  unsent?: boolean;
  unsentAt?: string;
  system?: boolean;
  systemType?: string;
  systemData?: Record<string, unknown>;
  replyTo?: Message | EntityId | null;
  reactions?: Array<{ emoji: string; userId?: User | EntityId }>;
  attachments?: MessageAttachment[];
  fileUrl?: string;
  fileType?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  durationMs?: number;
  storagePath?: string;
  storageProvider?: string;
  mediaVariants?: Record<string, string | { fileUrl?: string; url?: string }>;
};

export type ConversationSettings = {
  backgroundId?: string;
  nicknames?: Record<string, string>;
};

export type Conversation = {
  user: User;
  lastMessage?: string;
  lastTime?: string;
  unreadCount?: number;
  conversation?: ConversationSettings;
};

export type ChatStreak = {
  currentStreak: number;
  longestStreak: number;
  mutualDays: number;
  todayActive: boolean;
  lastMutualDay?: string | null;
};

export type Group = {
  _id?: EntityId;
  id?: EntityId;
  name?: string;
  description?: string;
  subject?: string;
  photo?: string;
  backgroundId?: string;
  creator?: User | EntityId;
  coCreators?: Array<User | EntityId>;
  members?: Array<User | EntityId>;
  joinCode?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type GroupMessage = {
  _id?: EntityId;
  id?: EntityId;
  clientId?: string;
  clientStatus?: ClientSendStatus;
  clientError?: string;
  groupId?: Group | EntityId;
  userId?: User | EntityId;
  text?: string;
  createdAt?: string;
  editedAt?: string;
  fileUrl?: string;
  fileType?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  durationMs?: number;
  pinned?: boolean;
  pinnedAt?: string;
  system?: boolean;
  systemType?: string;
  systemData?: Record<string, unknown>;
  replyTo?: GroupMessage | EntityId | null;
  reactions?: Array<{ emoji: string; userId?: User | EntityId }>;
  seenBy?: Array<{ userId?: User | EntityId; seenAt?: string }>;
};

export type UserNote = {
  _id?: EntityId;
  id?: EntityId;
  userId?: User | EntityId;
  text?: string;
  reactions?: Array<{ emoji: string; userId?: User | EntityId }>;
  views?: Array<{ userId?: User | EntityId; viewedAt?: string }>;
  comments?: Array<{
    _id?: EntityId;
    id?: EntityId;
    userId?: User | EntityId;
    text?: string;
    date?: string;
    reactions?: Array<{ emoji: string; userId?: User | EntityId }>;
  }>;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Story = {
  _id?: EntityId;
  id?: EntityId;
  userId?: User | EntityId;
  caption?: string;
  fileUrl?: string;
  fileType?: 'image' | 'video' | string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  mediaVariants?: Record<string, string | { fileUrl?: string; url?: string }>;
  variants?: Record<string, string | { fileUrl?: string; url?: string }>;
  reactions?: Array<{ emoji: string; userId?: User | EntityId }>;
  viewers?: Array<{ userId?: User | EntityId; viewedAt?: string }>;
  comments?: Array<{ userId?: User | EntityId; text?: string; createdAt?: string }>;
  expiresAt?: string;
  createdAt?: string;
};

export type StoryGroup = {
  ownerId?: EntityId;
  owner?: User;
  stories?: Story[];
  preview?: Story;
  count?: number;
};

export type UploadedAttachment = {
  fileUrl: string;
  fileType: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  durationMs?: number;
  storagePath?: string;
  storageProvider?: string;
  variants?: Record<string, unknown>;
};

export type ThreadMode = 'direct' | 'group';

export type RootStackParamList = {
  Login: undefined;
  SyncrovaMain: undefined;
  ChatList: undefined;
  ChatRoom: {
    chatId: string;
    userName: string;
    avatar?: string;
    user?: User;
    mode?: ThreadMode;
    group?: Group;
    conversation?: ConversationSettings;
  };
  Profile: undefined;
  Settings: undefined;
};
