import type { Message, MessageAttachment, User } from '../types';
import { formatMessageTime } from './date';
import { getEntityId } from './ids';
import { getMessageAttachments, resolveMediaUrl, resolveMediaVariantUrl } from './media';

export type MediaKind = 'image' | 'video';

export type MediaViewerItem = {
  id: string;
  url: string;
  type: MediaKind;
  thumbnailUrl?: string;
  senderName: string;
  senderAvatar?: string;
  timestamp?: string;
  fileName?: string;
  width?: number;
  height?: number;
};

export type VoiceRecordingResult = {
  uri: string;
  durationMs: number;
  fileName: string;
  mimeType: string;
  fileType: 'audio';
};

export const formatDuration = (durationMs = 0) => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const isMediaAttachment = (attachment?: MessageAttachment | null) => (
  attachment?.fileType === 'image' || attachment?.fileType === 'video'
);

export const isAudioAttachment = (attachment?: MessageAttachment | null) => (
  attachment?.fileType === 'audio'
);

export const getMediaUrl = (attachment: MessageAttachment) => (
  attachment.fileType === 'image'
    ? resolveMediaVariantUrl(attachment)
    : resolveMediaUrl(attachment.fileUrl)
);

export const getThumbnailUrl = (attachment: MessageAttachment) => {
  if (attachment.fileType !== 'image') return resolveMediaUrl(attachment.thumbnailUrl || '');
  const variants = attachment.variants || {};
  const thumb = variants.thumb;
  const url = typeof thumb === 'string' ? thumb : thumb?.fileUrl || thumb?.url;
  return url ? resolveMediaUrl(url) : resolveMediaVariantUrl(attachment);
};

export const getMessageSender = (message: Partial<Message>, fallback?: User | null) => {
  const sender = typeof message.from === 'object' ? message.from : fallback;
  return {
    id: getEntityId(sender || message.from),
    name: sender?.name || sender?.email || 'Syncrova user',
    avatar: sender?.avatar || sender?.profilePicture || ''
  };
};

export const buildMediaViewerItems = ({
  message,
  sender
}: {
  message: Message;
  sender?: User | null;
}): MediaViewerItem[] => {
  const owner = getMessageSender(message, sender);

  return getMessageAttachments(message)
    .filter(isMediaAttachment)
    .map((attachment, index) => ({
      id: `${getEntityId(message) || message.createdAt || 'media'}-${index}`,
      url: getMediaUrl(attachment),
      type: attachment.fileType === 'video' ? 'video' : 'image',
      thumbnailUrl: getThumbnailUrl(attachment),
      senderName: owner.name,
      senderAvatar: owner.avatar,
      timestamp: message.createdAt,
      fileName: attachment.fileName,
      width: attachment.width,
      height: attachment.height
    }));
};

export const formatMediaTimestamp = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const today = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (today) return `Today at ${formatMessageTime(value)}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${formatMessageTime(value)}`;

  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${formatMessageTime(value)}`;
};

export const seededWaveformBars = (seedSource: string, durationMs = 0) => {
  const count = Math.max(18, Math.min(40, Math.round(Math.max(durationMs, 1000) / 750)));
  let seed = Array.from(seedSource || 'syncrova').reduce((acc, char) => acc + char.charCodeAt(0), 0) || 7;

  return Array.from({ length: count }, () => {
    seed = (seed * 9301 + 49297) % 233280;
    const value = seed / 233280;
    return 0.25 + value * 0.75;
  });
};
