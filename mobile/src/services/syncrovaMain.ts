import type { ImagePickerAsset } from 'expo-image-picker';
import api from './api';
import type { Conversation, Group, User } from '../types';

export type DashboardSummary = {
  groupCount?: number;
  ownedCount?: number;
  taskCount?: number;
  openTaskCount?: number;
  assignedOpenTaskCount?: number;
  unreadMessages?: number;
};

export type DashboardData = {
  groups: Group[];
  tasks: Array<Record<string, unknown>>;
  conversations: Conversation[];
  summary: DashboardSummary;
};

export type FeedPost = {
  _id?: string;
  id?: string;
  title?: string;
  content?: string;
  userId?: User;
  user?: User;
  groupId?: Group & { subject?: string };
  group?: Group;
  fileUrl?: string;
  fileType?: string;
  mediaVariants?: Record<string, string | { fileUrl?: string; url?: string }>;
  attachments?: Array<{
    fileUrl?: string;
    fileType?: string;
    variants?: Record<string, string | { fileUrl?: string; url?: string }>;
  }>;
  reactions?: unknown[];
  comments?: unknown[];
  commentCount?: number;
  privacy?: string;
  savedBy?: string[];
  shares?: unknown[];
  createdAt?: string;
};

export type MarketplaceListing = {
  _id?: string;
  id?: string;
  title?: string;
  description?: string;
  price?: number;
  category?: string;
  condition?: string;
  campus?: string;
  seller?: User | null;
  photos?: Array<{ url?: string; fileUrl?: string }>;
  meetupSpot?: string;
  reports?: unknown[];
  status?: string;
  isSaved?: boolean;
  saveCount?: number;
  createdAt?: string;
};

export type UploadedPostMedia = {
  fileUrl: string;
  fileType: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  storagePath?: string;
  storageProvider?: string;
  variants?: Record<string, unknown>;
};

export type MarketplaceStatus = {
  canBuySell?: boolean;
  user?: User & {
    studentVerificationStatus?: string;
    studentVerifiedAt?: string | null;
  };
  verification?: {
    status?: string;
    rejectionReason?: string;
    submittedAt?: string;
    reviewedAt?: string;
  } | null;
  stats?: Record<string, number>;
};

export type FriendsSummary = {
  friends: Array<{ user?: User; since?: string }>;
  incoming: Array<{ requester?: User; createdAt?: string }>;
  outgoing: Array<{ recipient?: User; createdAt?: string }>;
  people: Array<User & { friendship?: Record<string, unknown> }>;
  counts: {
    friends?: number;
    incoming?: number;
    outgoing?: number;
    people?: number;
  };
};

export type GameSummary = {
  me?: Record<string, unknown>;
  leaderboard?: Array<{ user?: User; score?: number; rank?: number; points?: number }>;
  currentUserRank?: Record<string, unknown> | null;
  totalRanked?: number;
};

export type TypingSprintSession = {
  sessionId: string;
  prompt: string;
  sentences: string[];
  durationSeconds: number;
  startedAt?: string;
  expiresAt?: string;
};

export type NotificationSummary = {
  unreadCount: number;
};

export type SyncrovaNotification = {
  _id?: string;
  id?: string;
  actorId?: User | null;
  type?: string;
  title?: string;
  body?: string;
  href?: string;
  read?: boolean;
  meta?: Record<string, unknown>;
  createdAt?: string;
};

export const fetchDashboardSummary = async (): Promise<DashboardData> => {
  const res = await api.get<Partial<DashboardData>>('/dashboard/summary', {
    params: { taskLimit: 80 }
  });

  return {
    groups: Array.isArray(res.data?.groups) ? res.data.groups : [],
    tasks: Array.isArray(res.data?.tasks) ? res.data.tasks : [],
    conversations: Array.isArray(res.data?.conversations) ? res.data.conversations : [],
    summary: res.data?.summary || {}
  };
};

export const fetchFeedPosts = async (): Promise<FeedPost[]> => {
  const res = await api.get<FeedPost[]>('/posts/feed', {
    params: { limit: 18, summary: 1 }
  });
  return Array.isArray(res.data) ? res.data : [];
};

export const fetchHomePosts = async (): Promise<FeedPost[]> => {
  const res = await api.get<FeedPost[]>('/posts/home', {
    params: { limit: 18, summary: 1 }
  });
  return Array.isArray(res.data) ? res.data : [];
};

export const createHomePost = async (payload: {
  content: string;
  privacy?: string;
  fileUrl?: string;
  fileType?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  storagePath?: string;
  storageProvider?: string;
  variants?: Record<string, unknown>;
  attachments?: UploadedPostMedia[];
}) => {
  const { privacy = 'public', ...body } = payload;
  const res = await api.post<FeedPost>('/posts/home', {
    ...body,
    content: payload.content,
    privacy
  });
  return res.data;
};

const getAssetName = (asset: ImagePickerAsset, fallbackPrefix: string) => (
  asset.fileName || `${fallbackPrefix}-${Date.now()}.${asset.type === 'video' ? 'mp4' : 'jpg'}`
);

const getAssetMimeType = (asset: ImagePickerAsset) => (
  asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg')
);

const appendAsset = (form: FormData, fieldName: string, asset: ImagePickerAsset, fallbackPrefix: string) => {
  form.append(fieldName, {
    uri: asset.uri,
    name: getAssetName(asset, fallbackPrefix),
    type: getAssetMimeType(asset)
  } as unknown as Blob);
};

export const uploadPostAsset = async (asset: ImagePickerAsset): Promise<UploadedPostMedia> => {
  const form = new FormData();
  appendAsset(form, 'file', asset, 'syncrova-post');
  const res = await api.post<UploadedPostMedia>('/posts/upload', form);
  return res.data;
};

export const deletePost = (postId: string) => api.delete(`/posts/${postId}`);

export const reactToPost = async (postId: string, emoji = 'heart') => {
  const res = await api.post<FeedPost>(`/posts/${postId}/react`, { emoji });
  return res.data;
};

export const commentOnPost = async (postId: string, text: string) => {
  const res = await api.post<FeedPost>(`/posts/${postId}/comment`, { text });
  return res.data;
};

export const sharePost = async (postId: string) => {
  const res = await api.post<FeedPost>(`/posts/${postId}/share`);
  return res.data;
};

export const savePost = async (postId: string) => {
  const res = await api.put<FeedPost>(`/posts/${postId}/save`);
  return res.data;
};

export const updateProfile = async (payload: { name: string; course?: string; campus?: string; bio?: string }) => {
  const res = await api.put<User>('/users/profile', payload);
  return res.data;
};

export const uploadAvatar = async (asset: ImagePickerAsset) => {
  const form = new FormData();
  appendAsset(form, 'avatar', asset, 'syncrova-avatar');
  const res = await api.post<{ avatar?: string; user?: User }>('/users/avatar', form);
  return res.data;
};

export const uploadCoverPhoto = async (asset: ImagePickerAsset) => {
  const form = new FormData();
  appendAsset(form, 'coverPhoto', asset, 'syncrova-cover');
  const res = await api.post<{ coverPhoto?: string; user?: User }>('/users/cover-photo', form);
  return res.data;
};

export const fetchNotificationSummary = async (): Promise<NotificationSummary> => {
  const res = await api.get<{ count?: number; unreadCount?: number }>('/notifications/unread-count');
  return { unreadCount: Number(res.data?.unreadCount ?? res.data?.count ?? 0) || 0 };
};

export const fetchNotifications = async (): Promise<{ notifications: SyncrovaNotification[]; unreadCount: number }> => {
  const res = await api.get<{ notifications?: SyncrovaNotification[]; unreadCount?: number }>('/notifications');
  return {
    notifications: Array.isArray(res.data?.notifications) ? res.data.notifications : [],
    unreadCount: Number(res.data?.unreadCount || 0)
  };
};

export const markNotificationsRead = () => api.put('/notifications/read-all');

export const markNotificationRead = async (notificationId: string) => {
  const res = await api.put<SyncrovaNotification>(`/notifications/${notificationId}/read`);
  return res.data;
};

export const deleteNotification = (notificationId: string) => api.delete(`/notifications/${notificationId}`);

export const fetchMarketplaceStatus = async (): Promise<MarketplaceStatus> => {
  const res = await api.get<MarketplaceStatus>('/marketplace/status');
  return res.data || {};
};

export const submitMarketplaceVerification = async (payload: {
  documentType: 'campus_id' | 'cor';
  asset: ImagePickerAsset;
}) => {
  const form = new FormData();
  form.append('documentType', payload.documentType);
  appendAsset(form, 'document', payload.asset, 'syncrova-verification');
  const res = await api.post<MarketplaceStatus>('/marketplace/verification', form);
  return res.data;
};

export const fetchMarketplaceListings = async (params: Record<string, string | number> = {}): Promise<MarketplaceListing[]> => {
  const res = await api.get<{ listings?: MarketplaceListing[] }>('/marketplace/listings', {
    params: { status: 'all', sort: 'newest', ...params }
  });
  return Array.isArray(res.data?.listings) ? res.data.listings : [];
};

export const fetchMyMarketplaceListings = async (): Promise<MarketplaceListing[]> => {
  const res = await api.get<{ listings?: MarketplaceListing[] }>('/marketplace/listings/mine');
  return Array.isArray(res.data?.listings) ? res.data.listings : [];
};

export const createMarketplaceListing = async (payload: {
  title: string;
  description?: string;
  price: string;
  category: string;
  condition: string;
  meetupSpot: string;
  photos?: ImagePickerAsset[];
}) => {
  const form = new FormData();
  form.append('title', payload.title);
  form.append('description', payload.description || '');
  form.append('price', payload.price);
  form.append('category', payload.category);
  form.append('condition', payload.condition);
  form.append('meetupSpot', payload.meetupSpot);
  payload.photos?.slice(0, 6).forEach(asset => appendAsset(form, 'photos', asset, 'syncrova-listing'));
  const res = await api.post<{ listing?: MarketplaceListing }>('/marketplace/listings', form);
  return res.data?.listing || null;
};

export const saveMarketplaceListing = async (listingId: string) => {
  const res = await api.put<{ listing?: MarketplaceListing; saved?: boolean }>(`/marketplace/listings/${listingId}/save`);
  return res.data;
};

export const updateMarketplaceListingStatus = async (listingId: string, status: string) => {
  const res = await api.put<{ listing?: MarketplaceListing }>(`/marketplace/listings/${listingId}/status`, { status });
  return res.data?.listing || null;
};

export const reportMarketplaceListing = async (listingId: string, payload: { reason: string; note?: string }) => {
  const res = await api.post<{ listing?: MarketplaceListing; reported?: boolean }>(`/marketplace/listings/${listingId}/report`, payload);
  return res.data;
};

export const deleteMarketplaceListing = (listingId: string) => api.delete(`/marketplace/listings/${listingId}`);

export const fetchFriendsSummary = async (): Promise<FriendsSummary> => {
  const res = await api.get<Partial<FriendsSummary>>('/friends/summary');
  return {
    friends: Array.isArray(res.data?.friends) ? res.data.friends : [],
    incoming: Array.isArray(res.data?.incoming) ? res.data.incoming : [],
    outgoing: Array.isArray(res.data?.outgoing) ? res.data.outgoing : [],
    people: Array.isArray(res.data?.people) ? res.data.people : [],
    counts: res.data?.counts || {}
  };
};

export const sendFriendRequest = async (userId: string) => {
  const res = await api.post(`/friends/request/${userId}`);
  return res.data;
};

export const acceptFriendRequest = async (requestId: string) => {
  const res = await api.put(`/friends/requests/${requestId}/accept`);
  return res.data;
};

export const declineFriendRequest = async (requestId: string) => {
  const res = await api.put(`/friends/requests/${requestId}/decline`);
  return res.data;
};

export const cancelFriendRequest = async (requestId: string) => {
  const res = await api.delete(`/friends/requests/${requestId}`);
  return res.data;
};

export const removeFriend = async (friendshipId: string) => {
  const res = await api.delete(`/friends/${friendshipId}`);
  return res.data;
};

export const fetchGameSummary = async (): Promise<GameSummary> => {
  const res = await api.get<GameSummary>('/users/rankings/me');
  return res.data || {};
};

export const fetchGameHubSummary = async (): Promise<GameSummary> => {
  const res = await api.get<GameSummary>('/games/summary/me');
  return res.data || {};
};

export const fetchGameLeaderboard = async (gameType: string, metric = 'score') => {
  const res = await api.get('/games/leaderboards', {
    params: { gameType, metric, period: 'weekly' }
  });
  return res.data;
};

export const submitReactionTapScore = async (payload: {
  score: number;
  averageReactionMs: number;
  bestReactionMs?: number;
  rounds: number;
  playerPoints?: number;
  targetPoints?: number;
  taps?: number;
  wins?: number;
  elapsedMs?: number;
  wonMatch?: boolean;
}) => {
  const res = await api.post('/games/reaction-tap/submit', payload);
  return res.data;
};

export const submitGameScore = async (gameKey: string, payload: Record<string, number | boolean | string>) => {
  const res = await api.post(`/games/${gameKey}/submit`, payload);
  return res.data;
};

export const startTypingSprint = async (durationSeconds = 60): Promise<TypingSprintSession> => {
  const res = await api.post<TypingSprintSession>('/games/typing-sprint/start', { durationSeconds });
  return res.data;
};

export const submitTypingSprint = async (sessionId: string, payload: {
  text: string;
  typedSentences?: string[];
  mode?: 'sentence-stream';
}) => {
  const res = await api.post(`/games/typing-sprint/${sessionId}/submit`, payload);
  return res.data;
};
