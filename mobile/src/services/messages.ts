import type { ImagePickerAsset } from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE_URL } from '../config';
import api, { getApiToken } from './api';
import type {
  ChatStreak,
  Conversation,
  ConversationSettings,
  Group,
  GroupMessage,
  Message,
  Story,
  StoryGroup,
  UploadedAttachment,
  User,
  UserNote
} from '../types';

export const fetchConversations = async () => {
  const res = await api.get<Conversation[]>('/messages/conversations');
  return Array.isArray(res.data) ? res.data : [];
};

export const fetchMessages = async (chatId: string, before?: string) => {
  const res = await api.get<{
    items: Message[];
    hasMore: boolean;
    nextCursor?: string | null;
    conversation?: ConversationSettings;
  } | Message[]>(
    `/messages/${chatId}`,
    {
      params: {
        paginated: 1,
        limit: before ? 56 : 64,
        before
      }
    }
  );

  if (Array.isArray(res.data)) {
    return { items: res.data, hasMore: false, nextCursor: undefined, conversation: undefined };
  }

  return {
    items: Array.isArray(res.data?.items) ? res.data.items : [],
    hasMore: Boolean(res.data?.hasMore),
    nextCursor: res.data?.nextCursor || undefined,
    conversation: res.data?.conversation
  };
};

export const markMessagesRead = (chatId: string) => api.put(`/messages/read/${chatId}`);

export const deleteConversation = (chatId: string) => api.delete(`/messages/conversation/${chatId}`);

export const fetchChatStreak = async (chatId: string) => {
  const res = await api.get<ChatStreak>(`/messages/streak/${chatId}`);
  return res.data;
};

export const updateConversationBackground = async (chatId: string, backgroundId: string) => {
  const res = await api.put<{
    conversation?: ConversationSettings;
    backgroundId?: string;
    changed?: boolean;
    message?: Message | null;
  }>(`/messages/${chatId}/background`, { backgroundId });
  return res.data;
};

export const updateConversationNickname = async (chatId: string, nickname: string) => {
  const res = await api.put<{
    conversation?: ConversationSettings;
    nickname?: string;
    changed?: boolean;
    message?: Message | null;
  }>(`/messages/${chatId}/nickname`, { nickname });
  return res.data;
};

export const editMessage = async (messageId: string, text: string) => {
  const res = await api.put<Message>(`/messages/${messageId}`, { text });
  return res.data;
};

export const reactToMessage = async (messageId: string, emoji: string) => {
  const res = await api.post<Message>(`/messages/${messageId}/react`, { emoji });
  return res.data;
};

export const pinMessage = async (messageId: string) => {
  const res = await api.put<Message>(`/messages/${messageId}/pin`);
  return res.data;
};

export const hideMessageForMe = async (messageId: string) => api.delete(`/messages/${messageId}/me`);

export const unsendMessageForEveryone = async (messageId: string) => {
  const res = await api.delete<Message>(`/messages/${messageId}/everyone`);
  return res.data;
};

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', '3gp', 'webm', 'mkv']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif']);

const getUriExtension = (uri?: string) => {
  const cleanUri = String(uri || '').split('?')[0].split('#')[0];
  const match = cleanUri.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() || '';
};

const sanitizeUploadFileName = (name: string) => name
  .trim()
  .replace(/[^\w.\-()+ ]/g, '-')
  .replace(/\s+/g, '-')
  .slice(0, 140) || `syncrova-${Date.now()}.bin`;

const getAssetUploadMeta = (asset: ImagePickerAsset) => {
  const rawName = String(asset.fileName || '').trim();
  const rawMimeType = String(asset.mimeType || '').trim();
  const mimeType = rawMimeType.toLowerCase();
  const extensionFromName = rawName.split('.').pop()?.toLowerCase() || '';
  const extensionFromUri = getUriExtension(asset.uri);
  const extension = extensionFromName || extensionFromUri;
  const isVideo = asset.type === 'video' || mimeType.startsWith('video/') || VIDEO_EXTENSIONS.has(extension);
  const isImage = asset.type === 'image' || mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension);
  const fileType = isVideo ? 'video' : isImage ? 'image' : 'file';
  const fallbackExtension = isVideo ? 'mp4' : isImage ? 'jpg' : 'bin';
  const fileName = rawName || `syncrova-${Date.now()}.${extension || fallbackExtension}`;
  const uploadMimeType = rawMimeType || (isVideo ? 'video/mp4' : isImage ? 'image/jpeg' : 'application/octet-stream');

  return { fileName, fileType, mimeType: uploadMimeType };
};

type MultipartUploadInput = {
  uri: string;
  fileName: string;
  mimeType: string;
  fieldName: string;
  endpoint: string;
  parameters?: Record<string, string>;
};

const UPLOAD_RETRY_DELAYS_MS = [650, 1400];

const sleep = (ms: number) => new Promise(resolve => {
  setTimeout(resolve, ms);
});

const isRetryableUploadError = (error: unknown) => {
  const uploadError = error as { response?: { status?: number }; message?: string };
  const status = uploadError?.response?.status;
  if (!status) return true;
  if (status === 408 || status === 429) return true;
  return status >= 500;
};

const parseUploadResponse = <T,>(result: FileSystem.FileSystemUploadResult): T => {
  let data: unknown = {};
  try {
    data = result.body ? JSON.parse(result.body) : {};
  } catch {
    data = { msg: result.body || 'Upload failed' };
  }

  if (result.status < 200 || result.status >= 300) {
    const message = (data as { msg?: string; message?: string; error?: string })?.msg
      || (data as { message?: string })?.message
      || (data as { error?: string })?.error
      || `Upload failed with status ${result.status}`;
    const error = new Error(message) as Error & { response?: { status: number; data: unknown } };
    error.response = { status: result.status, data };
    throw error;
  }

  return data as T;
};

const withUploadFileName = async (uri: string, fileName: string) => {
  const safeName = sanitizeUploadFileName(fileName);
  const sourceExtension = getUriExtension(uri);
  const namedExtension = safeName.split('.').pop()?.toLowerCase() || '';
  const hasUsableName = uri.startsWith('file://') && namedExtension && sourceExtension === namedExtension;

  if (hasUsableName) {
    return { uri, cleanup: async () => {} };
  }

  const cacheRoot = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!cacheRoot) return { uri, cleanup: async () => {} };

  const target = `${cacheRoot}syncrova-upload-${Date.now()}-${safeName}`;
  try {
    await FileSystem.copyAsync({ from: uri, to: target });
    return {
      uri: target,
      cleanup: async () => {
        await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      }
    };
  } catch {
    return { uri, cleanup: async () => {} };
  }
};

const uploadMultipartFile = async <T,>({
  uri,
  fileName,
  mimeType,
  fieldName,
  endpoint,
  parameters
}: MultipartUploadInput): Promise<T> => {
  const prepared = await withUploadFileName(uri, fileName);
  const token = await getApiToken();

  try {
    let lastError: unknown;
    for (let attempt = 0; attempt <= UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const result = await FileSystem.uploadAsync(`${API_BASE_URL}${endpoint}`, prepared.uri, {
          fieldName,
          headers: token ? { 'x-auth-token': token } : undefined,
          httpMethod: 'POST',
          mimeType,
          parameters,
          uploadType: FileSystem.FileSystemUploadType.MULTIPART
        });

        return parseUploadResponse<T>(result);
      } catch (error) {
        lastError = error;
        const delay = UPLOAD_RETRY_DELAYS_MS[attempt];
        if (!delay || !isRetryableUploadError(error)) throw error;
        await sleep(delay);
      }
    }

    throw lastError;
  } finally {
    await prepared.cleanup();
  }
};

export const uploadMessageAsset = async (asset: ImagePickerAsset): Promise<UploadedAttachment> => {
  const meta = getAssetUploadMeta(asset);
  const data = await uploadMultipartFile<UploadedAttachment>({
    endpoint: '/messages/upload',
    fieldName: 'file',
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    uri: asset.uri
  });

  return {
    ...data,
    fileName: data.fileName || meta.fileName,
    fileType: data.fileType || meta.fileType,
    mimeType: data.mimeType || meta.mimeType
  };
};

export const uploadLocalMessageAsset = async (asset: {
  uri: string;
  fileName: string;
  mimeType: string;
  fileType: string;
  durationMs?: number;
}): Promise<UploadedAttachment> => {
  const data = await uploadMultipartFile<UploadedAttachment>({
    endpoint: '/messages/upload',
    fieldName: 'file',
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    uri: asset.uri
  });

  return {
    ...data,
    fileName: data.fileName || asset.fileName,
    fileType: asset.fileType || data.fileType,
    mimeType: data.mimeType || asset.mimeType,
    durationMs: asset.durationMs || 0
  };
};

export const createStory = async ({
  asset,
  caption = '',
  privacy = 'friends'
}: {
  asset: ImagePickerAsset;
  caption?: string;
  privacy?: 'friends' | 'public' | 'private';
}) => {
  const meta = getAssetUploadMeta(asset);
  if (meta.fileType !== 'image' && meta.fileType !== 'video') {
    throw new Error('My Day supports photos and videos only');
  }

  return uploadMultipartFile<Story>({
    endpoint: '/stories',
    fieldName: 'media',
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    parameters: {
      privacy,
      ...(caption.trim() ? { caption: caption.trim() } : {})
    },
    uri: asset.uri
  });
};

export const sendMessage = async (payload: {
  to: string;
  text?: string;
  replyTo?: string;
  attachments?: UploadedAttachment[];
}) => {
  const body: Record<string, unknown> = {
    to: payload.to,
    text: payload.text || ''
  };

  if (payload.replyTo) body.replyTo = payload.replyTo;
  if (payload.attachments?.length) {
    body.attachments = payload.attachments;
    Object.assign(body, payload.attachments[0]);
  }

  const res = await api.post<Message>('/messages', body);
  return res.data;
};

export const fetchContacts = async () => {
  const res = await api.get<{ friends?: Array<{ user?: User } | User> }>('/friends/summary');
  const rows = Array.isArray(res.data?.friends) ? res.data.friends : [];
  return rows
    .map(item => ('user' in item ? item.user : item))
    .filter(Boolean) as User[];
};

export const fetchOnlineUsers = async () => {
  const res = await api.get<string[] | { users?: string[]; userIds?: string[] }>('/presence/online');
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.data?.userIds)) return res.data.userIds;
  if (Array.isArray(res.data?.users)) return res.data.users;
  return [];
};

export const fetchUserPresence = async (userId: string) => {
  const res = await api.get<{ online?: boolean; lastSeen?: string | null }>(`/presence/online/${userId}`);
  return {
    online: Boolean(res.data?.online),
    lastSeen: res.data?.lastSeen || null
  };
};

export const fetchGroups = async () => {
  const res = await api.get<Group[]>('/groups');
  return Array.isArray(res.data) ? res.data : [];
};

export const createGroup = async (payload: { name: string; memberIds: string[] }) => {
  const res = await api.post<Group>('/groups', payload);
  return res.data;
};

export const updateGroupBackground = async (groupId: string, backgroundId: string) => {
  const res = await api.put<{ group?: Group; backgroundId?: string; changed?: boolean; message?: GroupMessage | null }>(
    `/groups/${groupId}/background`,
    { backgroundId }
  );
  return res.data;
};

export const fetchGroupMessages = async (groupId: string) => {
  const res = await api.get<GroupMessage[]>(`/group-chat/${groupId}`);
  return Array.isArray(res.data) ? res.data : [];
};

export const markGroupMessagesSeen = (groupId: string, messageIds?: string[]) => (
  api.put(`/group-chat/${groupId}/seen`, { messageIds: messageIds || [] })
);

export const sendGroupMessage = async (payload: {
  groupId: string;
  text?: string;
  fileUrl?: string;
  fileType?: string;
  replyTo?: string;
}) => {
  const res = await api.post<GroupMessage>('/group-chat', payload);
  return res.data;
};

export const reactToGroupMessage = async (messageId: string, emoji: string) => {
  const res = await api.post<GroupMessage>(`/group-chat/${messageId}/react`, { emoji });
  return res.data;
};

export const pinGroupMessage = async (messageId: string) => {
  const res = await api.put<GroupMessage>(`/group-chat/${messageId}/pin`);
  return res.data;
};

export const hideGroupMessageForMe = async (messageId: string) => api.delete(`/group-chat/me/${messageId}`);

export const deleteGroupMessageForEveryone = async (messageId: string) => (
  api.delete(`/group-chat/everyone/${messageId}`)
);

export const fetchMyNote = async () => {
  const res = await api.get<UserNote | null>('/notes/me');
  return res.data || null;
};

export const fetchActiveNotes = async () => {
  const res = await api.get<UserNote[]>('/notes/active');
  return Array.isArray(res.data) ? res.data : [];
};

export const saveMyNote = async (text: string) => {
  const res = await api.post<UserNote>('/notes/me', { text });
  return res.data;
};

export const deleteMyNote = () => api.delete('/notes/me');

export const reactToNote = async (noteId: string, emoji: string) => {
  const res = await api.post<UserNote>(`/notes/${noteId}/react`, { emoji });
  return res.data;
};

export const viewNote = async (noteId: string) => {
  const res = await api.post<UserNote>(`/notes/${noteId}/view`);
  return res.data;
};

export const replyToNote = async (noteId: string, text: string) => {
  const res = await api.post<UserNote>(`/notes/${noteId}/comments`, { text });
  return res.data;
};

export const fetchStoryGroups = async () => {
  const res = await api.get<{ groups?: StoryGroup[]; stories?: Story[] }>('/stories/active/grouped');
  return Array.isArray(res.data?.groups) ? res.data.groups : [];
};

export const viewStory = async (storyId: string) => {
  const res = await api.post<Story>(`/stories/${storyId}/view`);
  return res.data;
};

export const reactToStory = async (storyId: string, emoji: string) => {
  const res = await api.post<Story>(`/stories/${storyId}/react`, { emoji });
  return res.data;
};

export const replyToStory = async (storyId: string, text: string) => {
  const res = await api.post<{ story?: Story; message?: Message }>(`/stories/${storyId}/comment`, { text });
  return res.data;
};
