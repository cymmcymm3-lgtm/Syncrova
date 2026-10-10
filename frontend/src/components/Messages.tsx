// @ts-nocheck
import React, { Suspense, lazy, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  ArrowLeft,
  AtSign,
  Bell,
  BellOff,
  CheckCheck,
  ChevronRight,
  Copy,
  Edit3,
  Download,
  FileText,
  Flame,
  Forward,
  Image as ImageIcon,
  Info,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  MoreVertical,
  Pause,
  Phone,
  PhoneOff,
  Pin,
  PinOff,
  Play,
  Plus,
  Palette,
  Reply,
  RotateCw,
  Search,
  Send,
  SlidersHorizontal,
  Settings,
  Star,
  StickyNote,
  Square,
  Trash2,
  User,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import { optimizeImageFile, resolveMediaUrl, resolveMediaVariantUrl } from '../utils/media';
import { MEDIA_FILTERS, applyImageEdits, getDefaultMediaEdit, getMediaEditPreviewStyle } from '../utils/mediaEditor';
import { playUiSound } from '../utils/sound';
import { getChatHeadsStatus, setChatHeadsEnabled } from '../utils/chatHeads';
import VideoThumbnail from './VideoThumbnail';
import { isNativeMediaLibraryAvailable, nativeMediaAssetToFile } from '../utils/nativeMediaLibrary';
import { DeveloperAvatarFrame, DeveloperBadge } from './DeveloperIdentity';
import AnimatedEmojiText from './AnimatedEmojiText';
import './Messages.css';
import { CHAT_BACKGROUND_OPTIONS, DEFAULT_CHAT_BACKGROUND_ID, getChatBackground } from '../data/chatBackgroundPresets';
import { getStoryListForActiveStory } from '../utils/stories';
import useRenderDebug from '../hooks/useRenderDebug';
import { createFrameBatcher } from '../utils/performance';

const NewChatModal = lazy(() => import('./NewChatModal'));
const GroupChat = lazy(() => import('./GroupChat'));
const UserProfileModal = lazy(() => import('./UserProfileModal'));
const MediaViewer = lazy(() => import('./MediaViewer'));
const NativeMediaLibrarySheet = lazy(() => import('./NativeMediaLibrarySheet'));
const StoryViewer = lazy(() => import('./StoryViewer'));

let socket;
const SyncrovaNativeBridge = registerPlugin('SyncrovaNativeBridge');

const MAX_MESSAGE_UPLOAD_SIZE = 25 * 1024 * 1024;
const MAX_MESSAGE_MEDIA_SELECTION = 10;
const MESSAGE_RENDER_BATCH = 80;
const MOBILE_MESSAGE_RENDER_BATCH = 24;
const INITIAL_MESSAGE_PAGE_LIMIT = 64;
const OLDER_MESSAGE_PAGE_LIMIT = 56;
const CONVERSATION_ROW_HEIGHT = 90;
const CONVERSATION_VIRTUAL_OVERSCAN = 6;
const SYNCROVA_APP_LOGO_SRC = '/syncrova-app-logo.png';
// Notes and stories remain available elsewhere in the app. Keeping them out of
// the inbox gives this route a faster, conversation-first layout.
const SHOW_INBOX_EXTRAS = false;
const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');
const getPresencePayloadUserId = (payload) => getEntityId(payload?.userId || payload?._id || payload?.id || payload);
const normalizeOnlineUserIds = (payload) => {
  const ids = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.userIds)
      ? payload.userIds
      : Array.isArray(payload?.users)
        ? payload.users
        : [];

  return [...new Set(ids.map(getPresencePayloadUserId).filter(Boolean))];
};
const getStableMessageKey = (message = {}, index = '') => {
  const id = getEntityId(message);
  if (id) return id;
  return [
    message.clientId,
    message.createdAt,
    getEntityId(message.from),
    getEntityId(message.to),
    message.fileUrl,
    String(message.text || '').slice(0, 48),
    index
  ].filter(Boolean).join(':') || `message-${index}`;
};

const shouldAutoFocusComposer = () => (
  typeof window !== 'undefined'
  && window.matchMedia?.('(pointer: fine) and (min-width: 768px)').matches
);

const getMessageRenderBatch = () => (
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
    ? MOBILE_MESSAGE_RENDER_BATCH
    : MESSAGE_RENDER_BATCH
);

const isMobileMessagesViewport = () => (
  typeof window !== 'undefined'
  && window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches
);

const shouldPreloadAdjacentMedia = () => (
  typeof window !== 'undefined'
  && window.matchMedia?.('(pointer: fine) and (min-width: 768px)').matches
);

function DeferredConversationModuleFallback({ label = 'Opening…', inline = false }) {
  return (
    <div
      className={inline
        ? 'grid min-h-0 flex-1 place-items-center bg-white/65 p-5 text-sm font-semibold text-slate-500 dark:bg-slate-950/65 dark:text-slate-400'
        : 'fixed inset-0 z-[130] grid place-items-center bg-slate-950/10 p-4 backdrop-blur-[1px]'}
      role="status"
      aria-label={label}
    >
      <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-xs font-black text-slate-700 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900/95 dark:text-slate-100 dark:ring-slate-700">
        <Loader2 size={15} className="animate-spin text-[#1877f2]" />
        {label}
      </span>
    </div>
  );
}

function SyncrovaAppLogoButton({ onClick, className = '', showLabel = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`messages-main-app-button ${className}`}
      aria-label="Open Syncrova"
      title="Open Syncrova"
    >
      <span className="messages-main-app-logo" aria-hidden="true">
        <img src={SYNCROVA_APP_LOGO_SRC} alt="" draggable={false} />
      </span>
      {showLabel && (
        <span className="messages-main-app-label">
          <span>Syncrova</span>
          <span>Main app</span>
        </span>
      )}
    </button>
  );
}

function MessengerInitialSkeleton() {
  return (
    <div className="messages-pro-shell mobile-chat-shell mobile-messenger-shell messenger-motion-zone messenger-initial-skeleton-shell overflow-hidden rounded-[1.35rem] border border-slate-200/80 bg-white shadow-xl shadow-slate-300/20 dark:border-gray-800/80 dark:bg-gray-950 dark:shadow-black/20">
      <div className="grid h-full min-h-0 gap-0 md:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col border-r border-slate-200/80 p-3 dark:border-gray-800 md:p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="skeleton-motion-zone skeleton-block h-11 w-11 rounded-full bg-slate-200 dark:bg-slate-800" />
              <div className="space-y-2">
                <span className="skeleton-motion-zone skeleton-block block h-4 w-28 rounded-full bg-slate-200 dark:bg-slate-800" />
                <span className="skeleton-motion-zone skeleton-block block h-3 w-20 rounded-full bg-slate-200 dark:bg-slate-800" />
              </div>
            </div>
            <div className="flex gap-2">
              <span className="skeleton-motion-zone skeleton-block h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800" />
              <span className="skeleton-motion-zone skeleton-block h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800" />
            </div>
          </div>
          <span className="skeleton-motion-zone skeleton-block mt-4 h-11 w-full rounded-2xl bg-slate-200 dark:bg-slate-800" />
          <div className="mt-4 flex gap-3 overflow-hidden pb-1">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className="w-16 shrink-0 space-y-2">
                <span className="skeleton-motion-zone skeleton-block block h-14 w-14 rounded-full bg-slate-200 dark:bg-slate-800" />
                <span className="skeleton-motion-zone skeleton-block block h-2.5 w-12 rounded-full bg-slate-200 dark:bg-slate-800" />
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            {[0, 1, 2].map(item => (
              <span key={item} className="skeleton-motion-zone skeleton-block h-9 flex-1 rounded-full bg-slate-200 dark:bg-slate-800" />
            ))}
          </div>
          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-hidden">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 dark:border-gray-800 dark:bg-gray-900/70">
                <span className="skeleton-motion-zone skeleton-block h-12 w-12 shrink-0 rounded-full bg-slate-200 dark:bg-slate-800" />
                <div className="min-w-0 flex-1 space-y-2">
                  <span className="skeleton-motion-zone skeleton-block block h-3.5 w-2/3 rounded-full bg-slate-200 dark:bg-slate-800" />
                  <span className="skeleton-motion-zone skeleton-block block h-3 w-4/5 rounded-full bg-slate-200 dark:bg-slate-800" />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="hidden min-h-0 flex-col justify-end gap-3 bg-slate-50/70 p-5 dark:bg-gray-950 md:flex">
          {[0, 1, 2, 3].map(item => (
            <div key={item} className={`flex ${item % 2 ? 'justify-end' : 'justify-start'}`}>
              <span className={`skeleton-motion-zone skeleton-block h-12 rounded-3xl bg-slate-200 dark:bg-slate-800 ${item % 2 ? 'w-2/5' : 'w-1/3'}`} />
            </div>
          ))}
          <span className="skeleton-motion-zone skeleton-block mt-3 h-12 w-full rounded-full bg-slate-200 dark:bg-slate-800" />
        </section>
      </div>
    </div>
  );
}

const getDisplayName = (entity, fallback = 'User') => entity?.name || fallback;
const getStoryGroupPreview = (group) => group?.preview || group?.stories?.[0] || null;
const hasViewedStory = (story, userId) => (
  (story?.viewers || []).some(viewer => getEntityId(viewer.userId) === userId)
);
const isStoryGroupViewed = (group, userId) => {
  const ownerId = getEntityId(group?.owner || group?.ownerId);
  if (!group || !userId || ownerId === userId) return false;
  const stories = Array.isArray(group.stories) && group.stories.length
    ? group.stories
    : [getStoryGroupPreview(group)].filter(Boolean);
  return stories.length > 0 && stories.every(story => hasViewedStory(story, userId));
};
const getMessageAttachments = (message = {}) => {
  const attachments = Array.isArray(message.attachments) ? message.attachments.filter(item => item?.fileUrl) : [];
  if (attachments.length) return attachments;
  if (!message.fileUrl) return [];
  return [{
    fileUrl: message.fileUrl,
    fileType: message.fileType,
    fileName: message.fileName,
    mimeType: message.mimeType,
    fileSize: message.fileSize,
    storagePath: message.storagePath,
    storageProvider: message.storageProvider,
    variants: message.mediaVariants || {}
  }];
};

// Media arrives after the message shell has already been mounted. Keeping this
// check in one place lets the thread use a non-animated settle for photos,
// videos, voice notes, and files instead of competing smooth-scroll calls.
const hasMessageAttachment = (message = {}) => getMessageAttachments(message).length > 0;

const getSelectedAttachmentItems = (attachment) => {
  if (!attachment) return [];
  if (Array.isArray(attachment.items)) return attachment.items;
  if (!attachment.file) return [];
  return [{
    id: `${attachment.file.name}-${attachment.file.size}-${attachment.file.lastModified || Date.now()}`,
    file: attachment.file,
    fileType: attachment.fileType,
    previewUrl: attachment.previewUrl || ''
  }];
};

const createAttachmentId = (file) => `${file.name}-${file.size}-${file.lastModified || Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const getAttachmentTypeLabel = (items = []) => {
  if (!items.length) return 'Attachment';
  if (items.length === 1) {
    if (items[0].fileType === 'image') return 'Photo';
    if (items[0].fileType === 'video') return 'Video';
    if (items[0].fileType === 'audio') return 'Voice message';
    return 'File attachment';
  }

  const mediaCount = items.filter(item => ['image', 'video'].includes(item.fileType)).length;
  return mediaCount === items.length ? `${items.length} photos/videos` : `${items.length} attachments`;
};
const parseIceUrls = (value = '') => String(value || '')
  .split(',')
  .map(url => url.trim())
  .filter(Boolean);

const DEFAULT_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun.cloudflare.com:3478'
];
const configuredTurnUrls = parseIceUrls(import.meta.env.VITE_TURN_URLS);
const STATIC_CALL_ICE_SERVERS = [
  { urls: DEFAULT_STUN_URLS },
  ...(configuredTurnUrls.length
    ? [{
        urls: configuredTurnUrls,
        username: import.meta.env.VITE_TURN_USERNAME || undefined,
        credential: import.meta.env.VITE_TURN_CREDENTIAL || undefined
      }]
    : [])
];

const normalizeIceServers = (servers = []) => servers
  .map(server => ({
    ...server,
    urls: Array.isArray(server?.urls) ? server.urls.filter(Boolean) : parseIceUrls(server?.urls)
  }))
  .filter(server => server.urls.length);

const hasTurnServer = (servers = []) => servers.some(server => (
  (Array.isArray(server?.urls) ? server.urls : [server?.urls])
    .filter(Boolean)
    .some(url => /^turns?:/i.test(String(url)))
));

const getIceCandidateType = (candidate) => {
  const text = typeof candidate === 'string' ? candidate : String(candidate?.candidate || '');
  const match = text.match(/\btyp\s+(host|srflx|prflx|relay)\b/i);
  return match?.[1]?.toLowerCase() || '';
};

const getSafeTurnErrorMessage = (event = {}) => {
  const text = String(event.errorText || '').trim();
  if (/host lookup/i.test(text)) return 'Relay lookup failed. Retrying with another route...';
  if (/unauthor/i.test(text) || event.errorCode === 401) return 'Relay credentials were rejected. Refresh TURN credentials.';
  if (/timeout/i.test(text)) return 'Relay timed out. Retrying...';
  return text || `Relay error ${event.errorCode || ''}`.trim();
};

const isEnabledFlag = (value) => (
  value === true || ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase())
);

const shouldForceTurnRelay = () => isEnabledFlag(import.meta.env.VITE_CALL_FORCE_RELAY);

const CALL_ICE_CACHE_MS = 5 * 60_000;
const MAX_CALL_ICE_RESTARTS = 2;

const shouldUseRelayOnly = (servers = [], config = {}) => (
  hasTurnServer(servers) && (isEnabledFlag(config.forceRelay) || Boolean(config.relayOnlyRetry) || shouldForceTurnRelay())
);

const createCallId = () => `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const serializeCallUser = (person) => ({
  _id: getEntityId(person),
  id: getEntityId(person),
  name: person?.name || person?.email || 'User',
  email: person?.email || '',
  avatar: person?.avatar || person?.profilePicture || '',
  profilePicture: person?.profilePicture || person?.avatar || ''
});

const formatCallDuration = (seconds = 0) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const getCallMediaErrorMessage = (err, mode = 'audio') => {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `${mode === 'video' ? 'Camera and microphone' : 'Microphone'} permission is blocked. Allow it in app/browser settings, then try again.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return mode === 'video'
      ? 'No camera or microphone was found on this device.'
      : 'No microphone was found on this device.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `${mode === 'video' ? 'Camera or microphone' : 'Microphone'} is being used by another app. Close it and try again.`;
  }
  if (name === 'OverconstrainedError') {
    return 'This device cannot start the requested call quality. Try again or switch to audio call.';
  }
  return err?.message || 'Could not access microphone or camera.';
};

const getCallSetupErrorMessage = (err, fallback = 'Could not start the call.') => {
  const status = err?.response?.status;
  const serverMessage = err?.response?.data?.msg;
  if (status === 503) {
    return serverMessage || 'Calls are not configured on the server yet. Add the LiveKit environment variables and redeploy.';
  }
  if (serverMessage) return serverMessage;
  return err?.message || fallback;
};

const toSessionDescription = (description) => (
  typeof RTCSessionDescription !== 'undefined'
    ? new RTCSessionDescription(description)
    : description
);

const toIceCandidate = (candidate) => (
  typeof RTCIceCandidate !== 'undefined'
    ? new RTCIceCandidate(candidate)
    : candidate
);

const MY_DAY_REPLY_PREFIX = 'Replied to your My Day:';
const MY_DAY_NAMED_REPLY_PATTERN = /^Replied to (.+?)'s My Day:\s*/i;

const parseMyDayReply = (text = '') => {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  if (normalized.toLowerCase().startsWith(MY_DAY_REPLY_PREFIX.toLowerCase())) {
    return {
      targetName: 'your',
      body: normalized.replace(new RegExp(`^${MY_DAY_REPLY_PREFIX}\\s*`, 'i'), '').trim()
    };
  }
  const namedMatch = normalized.match(MY_DAY_NAMED_REPLY_PATTERN);
  if (namedMatch) {
    return {
      targetName: namedMatch[1],
      body: normalized.replace(MY_DAY_NAMED_REPLY_PATTERN, '').trim()
    };
  }
  return null;
};

const isMyDayReplyMessage = (message) => (
  Boolean(parseMyDayReply(message?.text))
);

const getMyDayReplyBody = (text = '') => (
  parseMyDayReply(text)?.body || ''
);

const getMyDayReplyLabel = (message, isMe = false) => {
  const parsed = parseMyDayReply(message?.text);
  if (!parsed) return 'My Day reply';
  if (isMe && parsed.targetName && parsed.targetName !== 'your') return `You replied to ${parsed.targetName}'s My Day`;
  return 'Replied to your My Day';
};

const NOTE_REPLY_PATTERN = /^Replied to (.+?)'s Note:\s*/i;

const parseNoteReply = (text = '') => {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  const match = normalized.match(NOTE_REPLY_PATTERN);
  if (!match) return null;
  return {
    targetName: match[1],
    body: normalized.replace(NOTE_REPLY_PATTERN, '').trim()
  };
};

const isNoteReplyMessage = (message) => (
  Boolean(parseNoteReply(message?.text))
);

const getNoteReplyBody = (text = '') => (
  parseNoteReply(text)?.body || ''
);

const getNoteReplyLabel = (message, isMe = false) => {
  const parsed = parseNoteReply(message?.text);
  if (!parsed) return 'Note reply';
  return isMe ? `You replied to ${parsed.targetName}'s Note` : 'Replied to your Note';
};

const getNoteTimeLeft = (expiresAt) => {
  const date = new Date(expiresAt || 0);
  if (Number.isNaN(date.getTime())) return '1 day left';
  const remainingMs = date.getTime() - Date.now();
  if (remainingMs <= 0) return 'Expired';
  const hours = Math.floor(remainingMs / 3600000);
  const minutes = Math.max(1, Math.floor((remainingMs % 3600000) / 60000));
  if (hours >= 1) return `${hours}h left`;
  return `${minutes}m left`;
};

const formatBytes = (bytes = 0) => {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatAudioTime = (seconds = 0) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const getPreferredAudioMimeType = () => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4'
  ].find(type => MediaRecorder.isTypeSupported(type)) || '';
};

const getAudioFileExtension = (mimeType = '') => {
  const normalized = String(mimeType).toLowerCase();
  if (normalized.includes('mp4')) return 'm4a';
  if (normalized.includes('ogg')) return 'ogg';
  return 'webm';
};

const getSystemMessageText = (message = {}, currentUserId = '') => {
  if (message.systemType !== 'nickname_changed') return message.text || 'Conversation updated.';

  const data = message.systemData || {};
  const actorId = getEntityId(data.actorId || message.from);
  const targetUserId = getEntityId(data.targetUserId || message.to);
  const actorName = data.actorName || getDisplayName(message.from, 'Someone');
  const targetName = data.targetName || getDisplayName(message.to, 'this user');
  const nickname = String(data.nickname || '').trim();
  const isActor = actorId === currentUserId;
  const isTarget = targetUserId === currentUserId;

  if (nickname) {
    if (isTarget) return `${actorName} set your nickname to ${nickname}.`;
    if (isActor) return `You set ${targetName}'s nickname to ${nickname}.`;
    return `${actorName} set ${targetName}'s nickname to ${nickname}.`;
  }

  if (isTarget) return `${actorName} cleared your nickname.`;
  if (isActor) return `You cleared ${targetName}'s nickname.`;
  return `${actorName} cleared ${targetName}'s nickname.`;
};

const getFileType = (file) => {
  if (file?.type?.startsWith('image/')) return 'image';
  if (file?.type?.startsWith('video/')) return 'video';
  if (file?.type?.startsWith('audio/')) return 'audio';
  return 'file';
};

const getMessageSnippet = (message) => {
  if (!message) return '';
  const attachments = getMessageAttachments(message);
  if (message.unsent) return 'Message unsent';
  if (isMyDayReplyMessage(message)) return `My Day reply: ${getMyDayReplyBody(message.text) || 'Reply'}`;
  if (isNoteReplyMessage(message)) return `Note reply: ${getNoteReplyBody(message.text) || 'Reply'}`;
  if (message.text?.trim()) return message.text;
  if (attachments.length > 1) return getAttachmentTypeLabel(attachments);
  if (message.fileType === 'image') return 'Photo';
  if (message.fileType === 'video') return 'Video';
  if (message.fileType === 'audio') return 'Voice message';
  if (message.fileUrl) return message.fileName || 'File attachment';
  return 'Message';
};

const readStoredValue = (key, legacyKey) => {
  if (typeof window === 'undefined') return null;
  const currentValue = window.localStorage.getItem(key);
  if (currentValue !== null || !legacyKey) return currentValue;

  const legacyValue = window.localStorage.getItem(legacyKey);
  if (legacyValue !== null) window.localStorage.setItem(key, legacyValue);
  return legacyValue;
};

const readStoredIdSet = (key, legacyKey) => {
  if (typeof window === 'undefined') return new Set();
  try {
    return new Set(JSON.parse(readStoredValue(key, legacyKey) || '[]').map(String));
  } catch {
    return new Set();
  }
};

const readStoredObject = (key, legacyKey) => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(readStoredValue(key, legacyKey) || '{}') || {};
  } catch {
    return {};
  }
};

const STORAGE_KEYS = {
  favoriteChats: 'syncrova-favorite-chats',
  mutedChats: 'syncrova-muted-chats',
  pinnedChats: 'syncrova-pinned-chats',
  chatNicknames: 'syncrova-chat-nicknames',
  chatThemes: 'syncrova-chat-themes'
};

const LEGACY_STORAGE_KEYS = {
  favoriteChats: 'studenthub-favorite-chats',
  mutedChats: 'studenthub-muted-chats',
  pinnedChats: 'studenthub-pinned-chats',
  chatNicknames: 'studenthub-chat-nicknames',
  chatThemes: 'studenthub-chat-themes'
};

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '✅'];

function ReactionBurst({ emoji, className = '' }) {
  if (!emoji) return null;
  return (
    <span className={`reaction-motion-zone reaction-burst ${className}`} aria-hidden="true">
      {emoji}
    </span>
  );
}

const CHAT_THEMES = {
  default: {
    label: 'Messenger Blue',
    own: 'from-[#0084ff] to-[#00b2ff]',
    accent: 'text-[#0084ff] dark:text-sky-300'
  },
  blue: {
    label: 'Facebook',
    own: 'from-[#1877f2] to-[#0a58ca]',
    accent: 'text-[#1877f2] dark:text-blue-300'
  },
  violet: {
    label: 'Violet',
    own: 'from-violet-600 to-fuchsia-600',
    accent: 'text-violet-600 dark:text-violet-300'
  },
  emerald: {
    label: 'Emerald',
    own: 'from-emerald-600 to-teal-600',
    accent: 'text-emerald-600 dark:text-emerald-300'
  }
};

const isValidChatBackgroundId = (value) => CHAT_BACKGROUND_OPTIONS.some(option => option.id === value);
const normalizeChatBackgroundKey = (value) => (
  isValidChatBackgroundId(value) ? value : DEFAULT_CHAT_BACKGROUND_ID
);

function VoiceMessagePlayer({ src, fileName = '', fileSize = 0, isMe = false }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackError, setPlaybackError] = useState(false);

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    try {
      if (audio.paused) {
        await audio.play();
        setPlaying(true);
      } else {
        audio.pause();
        setPlaying(false);
      }
    } catch {
      setPlaybackError(true);
      setPlaying(false);
    }
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const handlePause = () => setPlaying(false);
    const handlePlay = () => setPlaying(true);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlay);
    return () => {
      audio.pause();
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlay);
    };
  }, [src]);

  return (
    <div className={`voice-message-player ${isMe ? 'is-own' : ''}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime || 0)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => setPlaybackError(true)}
      />
      <button
        type="button"
        onClick={togglePlayback}
        className="voice-message-play-button"
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
      </button>
      <span className="voice-message-wave" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, index) => (
          <span key={index} style={{ height: `${7 + ((index * 7) % 18)}px` }} />
        ))}
      </span>
      <span className="voice-message-meta">
        <span className="voice-message-label">{fileName || 'Voice message'}</span>
        <span className="voice-message-time">
          {formatAudioTime(currentTime || duration)}
          {fileSize > 0 ? ` - ${formatBytes(fileSize)}` : ''}
        </span>
        <span className="voice-message-progress" style={{ '--voice-progress': `${progress}%` }} />
        {playbackError && (
          <a href={src} target="_blank" rel="noopener noreferrer" className="voice-message-fallback">
            Open audio
          </a>
        )}
      </span>
    </div>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    callHistory: sharedCallHistory,
    callIsActive: sharedCallIsActive,
    canCallUser: canStartSharedCallWith,
    formatCallDuration: formatSharedCallDuration,
    getCallStatusLabel: getSharedCallStatusLabel,
    startCall: startSharedCall
  } = useCall();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [showGroupChats, setShowGroupChats] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [conversationFilter, setConversationFilter] = useState('all');
  const [acceptedFriendIds, setAcceptedFriendIds] = useState(null);
  const [pendingFriendRequestIds, setPendingFriendRequestIds] = useState(() => new Set());
  const [friendActionUserId, setFriendActionUserId] = useState('');
  const [favoriteConversationIds, setFavoriteConversationIds] = useState(() => readStoredIdSet(STORAGE_KEYS.favoriteChats, LEGACY_STORAGE_KEYS.favoriteChats));
  const [mutedConversationIds, setMutedConversationIds] = useState(() => readStoredIdSet(STORAGE_KEYS.mutedChats, LEGACY_STORAGE_KEYS.mutedChats));
  const [pinnedConversationIds, setPinnedConversationIds] = useState(() => readStoredIdSet(STORAGE_KEYS.pinnedChats, LEGACY_STORAGE_KEYS.pinnedChats));
  const [conversationNicknames, setConversationNicknames] = useState(() => readStoredObject(STORAGE_KEYS.chatNicknames, LEGACY_STORAGE_KEYS.chatNicknames));
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);
  const [conversationThemes, setConversationThemes] = useState(() => readStoredObject(STORAGE_KEYS.chatThemes, LEGACY_STORAGE_KEYS.chatThemes));
  const [conversationBackgrounds, setConversationBackgrounds] = useState({});
  const [showBackgroundPicker, setShowBackgroundPicker] = useState(false);
  const [pendingBackgroundKey, setPendingBackgroundKey] = useState(DEFAULT_CHAT_BACKGROUND_ID);
  const [savingBackground, setSavingBackground] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [visibleMessageCount, setVisibleMessageCount] = useState(() => getMessageRenderBatch());
  const [composerHasText, setComposerHasText] = useState(false);
  const [editingMessage, setEditingMessage] = useState(null);
  const [messageSearch, setMessageSearch] = useState('');
  const [messageSearchIndex, setMessageSearchIndex] = useState(0);
  const [selectedMessageInfo, setSelectedMessageInfo] = useState(null);
  const [unreadDividerMessageId, setUnreadDividerMessageId] = useState(null);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [oldestMessageCursor, setOldestMessageCursor] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [groupDraftName, setGroupDraftName] = useState('');
  const [groupMemberQuery, setGroupMemberQuery] = useState('');
  const [groupMemberResults, setGroupMemberResults] = useState([]);
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupSettingsName, setGroupSettingsName] = useState('');
  const [groupSettingsPhoto, setGroupSettingsPhoto] = useState(null);
  const [groupSettingsBackgroundKey, setGroupSettingsBackgroundKey] = useState(DEFAULT_CHAT_BACKGROUND_ID);
  const [savingGroupSettings, setSavingGroupSettings] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [presenceReady, setPresenceReady] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [emojiPickerMessageId, setEmojiPickerMessageId] = useState(null);
  const [reactionViewerMessageId, setReactionViewerMessageId] = useState(null);
  const [messageReactionBursts, setMessageReactionBursts] = useState({});
  const [replyingTo, setReplyingTo] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [chatHeadsStatus, setChatHeadsStatus] = useState({ supported: false, enabled: false, canDrawOverlays: false });
  const [selectedAttachment, setSelectedAttachment] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const [mediaLibraryFilter, setMediaLibraryFilter] = useState('all');
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [actionMenuMessageId, setActionMenuMessageId] = useState(null);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [showChatDetails, setShowChatDetails] = useState(false);
  const [focusedMessageId, setFocusedMessageId] = useState(null);
  const [lastSeenByUser, setLastSeenByUser] = useState({});
  const [myNote, setMyNote] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [showNoteComposer, setShowNoteComposer] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [userNotes, setUserNotes] = useState({});
  const [storyGroups, setStoryGroups] = useState([]);
  const [activeStory, setActiveStory] = useState(null);
  const [activeNote, setActiveNote] = useState(null);
  const [noteReplyText, setNoteReplyText] = useState('');
  const [noteReactionBursts, setNoteReactionBursts] = useState({});
  const [mediaPreview, setMediaPreview] = useState(null);
  const [conversationListScrollTop, setConversationListScrollTop] = useState(0);
  const [conversationListViewportHeight, setConversationListViewportHeight] = useState(0);
  const [, setPresenceClock] = useState(0);
  const [callState, setCallState] = useState('idle');
  const [callMode, setCallMode] = useState('audio');
  const [callPartner, setCallPartner] = useState(null);
  const [activeCallId, setActiveCallId] = useState('');
  const [incomingCall, setIncomingCall] = useState(null);
  const [callError, setCallError] = useState('');
  const [localStreamReady, setLocalStreamReady] = useState(false);
  const [remoteStreamReady, setRemoteStreamReady] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState(null);
  const [callClock, setCallClock] = useState(Date.now());
  const [callRelayReady, setCallRelayReady] = useState(() => hasTurnServer(STATIC_CALL_ICE_SERVERS));
  const [callIceStatus, setCallIceStatus] = useState({ relayCandidate: false, lastCandidateType: '', turnError: '', retrying: false, relayOnly: false });
  const [callProvider, setCallProvider] = useState('livekit');
  const [chatStreak, setChatStreak] = useState(null);

  const conversationListRef = useRef(null);
  const conversationScrollFrameRef = useRef(null);
  const pendingConversationScrollTopRef = useRef(0);
  const messageThreadRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingCancelledRef = useRef(false);
  const recordingTimerRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const lastTypingEmitRef = useRef(0);
  const latestFetchIdRef = useRef(0);
  const openingConversationRef = useRef(false);
  const composerTextRef = useRef('');
  const pendingDraftRef = useRef('');
  const typingUsersTimeoutRef = useRef({});
  const selectedUserRef = useRef(null);
  const messageRefs = useRef({});
  const reactionPressTimerRef = useRef(null);
  const swipeMessageActionRef = useRef(null);
  const loadingOlderMessagesRef = useRef(false);
  const pendingAutoScrollRef = useRef(false);
  const pendingAutoScrollBehaviorRef = useRef('smooth');
  const mediaBottomPinUntilRef = useRef(0);
  const uploadProgressFrameRef = useRef(null);
  const pendingUploadProgressRef = useRef(0);
  const preserveNextMessageScrollRef = useRef(false);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const liveKitRoomRef = useRef(null);
  const liveKitTracksRef = useRef({ localVideo: null, remoteVideo: null, remoteAudio: null });
  const pendingIceCandidatesRef = useRef([]);
  const iceServersRef = useRef({
    servers: null,
    fetchedAt: 0,
    forceRelay: shouldForceTurnRelay(),
    relayConfigured: hasTurnServer(STATIC_CALL_ICE_SERVERS),
    relayOnlyRetry: false,
    ttlMs: CALL_ICE_CACHE_MS
  });
  const iceRestartAttemptsRef = useRef({});
  const activeCallRef = useRef({
    state: 'idle',
    callId: '',
    partnerId: '',
    mode: 'audio',
    provider: 'livekit'
  });

  const currentUserId = getEntityId(user);
  const deferredConversationSearch = useDeferredValue(conversationSearch);
  const selectedUserId = getEntityId(selectedUser);
  const selectedGroupId = getEntityId(selectedGroup);
  const hasOpenConversation = Boolean(selectedUser || selectedGroup);
  const targetUserId = searchParams.get('user');
  const targetDraftText = searchParams.get('draft') || '';

  const openMainSyncrova = useCallback(async () => {
    const path = '/dashboard';
    const isAndroidNative = (
      (Capacitor?.getPlatform?.() || window.Capacitor?.getPlatform?.()) === 'android'
      && (Capacitor?.isNativePlatform?.() || window.Capacitor?.isNativePlatform?.())
    );

    if (isAndroidNative && SyncrovaNativeBridge?.openMainApp) {
      try {
        const result = await SyncrovaNativeBridge.openMainApp({ path });
        if (result?.opened) return;
      } catch {
        // Old APKs may not expose this bridge method yet; keep the web fallback below.
      }
    }

    if (typeof window !== 'undefined' && window.__SYNCROVA_MESSENGER_APP__ === true) {
      try {
        window.location.href = `syncrova://open${path}`;
        return;
      } catch {
        // Fall through to router navigation for web previews.
      }
    }

    navigate(path);
  }, [navigate]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.dispatchEvent(new CustomEvent('syncrova:mobile-chat-state', {
      detail: { open: Boolean(selectedUser || selectedGroup) }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent('syncrova:mobile-chat-state', {
        detail: { open: false }
      }));
    };
  }, [selectedGroup, selectedUser]);

  const focusComposerInput = useCallback(() => {
    if (shouldAutoFocusComposer()) inputRef.current?.focus();
  }, []);

  const toggleStoredId = useCallback((storageKey, setter, rawId) => {
    const id = getEntityId(rawId);
    if (!id) return;

    setter(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      }

      return next;
    });
  }, []);

  const toggleFavoriteConversation = useCallback((rawId) => {
    toggleStoredId(STORAGE_KEYS.favoriteChats, setFavoriteConversationIds, rawId);
  }, [toggleStoredId]);

  const toggleMuteConversation = useCallback((rawId) => {
    toggleStoredId(STORAGE_KEYS.mutedChats, setMutedConversationIds, rawId);
  }, [toggleStoredId]);

  const togglePinnedConversation = useCallback((rawId) => {
    toggleStoredId(STORAGE_KEYS.pinnedChats, setPinnedConversationIds, rawId);
  }, [toggleStoredId]);

  const updateStoredObject = useCallback((storageKey, setter, rawId, value) => {
    const id = getEntityId(rawId);
    if (!id) return;

    setter(prev => {
      const next = { ...prev };
      if (!value) delete next[id];
      else next[id] = value;

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      }

      return next;
    });
  }, []);

  const cacheConversationNickname = useCallback((rawId, value) => {
    updateStoredObject(STORAGE_KEYS.chatNicknames, setConversationNicknames, rawId, String(value || '').trim());
  }, [updateStoredObject]);

  const syncConversationNicknamesFromItems = useCallback((items = []) => {
    setConversationNicknames(prev => {
      let changed = false;
      const next = { ...prev };

      items.forEach(item => {
        const userId = getEntityId(item?.user || item?.userId || item);
        if (!userId) return;

        const nickname = String(item?.conversation?.nicknames?.[userId] || '').trim();
        if (nickname) {
          if (next[userId] !== nickname) {
            next[userId] = nickname;
            changed = true;
          }
        } else if (next[userId]) {
          delete next[userId];
          changed = true;
        }
      });

      if (changed && typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEYS.chatNicknames, JSON.stringify(next));
      }

      return changed ? next : prev;
    });
  }, []);

  const updateConversationTheme = useCallback((rawId, value) => {
    updateStoredObject(STORAGE_KEYS.chatThemes, setConversationThemes, rawId, value === 'default' ? '' : value);
  }, [updateStoredObject]);

  const cacheConversationBackground = useCallback((rawId, value) => {
    const id = getEntityId(rawId);
    if (!id) return;
    const backgroundId = normalizeChatBackgroundKey(value);
    setConversationBackgrounds(prev => {
      if ((prev[id] || DEFAULT_CHAT_BACKGROUND_ID) === backgroundId) return prev;
      return { ...prev, [id]: backgroundId };
    });
  }, []);

  const updateConversationBackground = useCallback(async (rawId, value) => {
    const id = getEntityId(rawId);
    if (!id || savingBackground) return;
    const backgroundId = normalizeChatBackgroundKey(value);

    setSavingBackground(true);
    try {
      const res = await api.put(`/messages/${id}/background`, { backgroundId });
      const nextBackgroundId = normalizeChatBackgroundKey(res.data?.conversation?.backgroundId || backgroundId);
      cacheConversationBackground(id, nextBackgroundId);
      if (res.data?.message && getEntityId(selectedUserRef.current) === id) {
        const systemMessage = res.data.message;
        setMessages(prev => (
          prev.some(message => getEntityId(message) === getEntityId(systemMessage))
            ? prev
            : [...prev, systemMessage]
        ));
      }
      setPendingBackgroundKey(nextBackgroundId);
      setShowBackgroundPicker(false);
      toast.success(res.data?.changed ? 'Conversation background updated' : 'Background already selected');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to update background');
    } finally {
      setSavingBackground(false);
    }
  }, [cacheConversationBackground, savingBackground]);

  const clearTargetUserParam = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('user');
      next.delete('draft');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // A conversation is its own focused view on every screen size.  Keeping
  // this in one handler also makes a deep-linked /messages?user=... route
  // reliably return to the inbox instead of immediately opening again.
  const returnToInbox = useCallback(() => {
    setShowChatDetails(false);
    setShowPinnedPanel(false);
    setShowBackgroundPicker(false);
    setSelectedMessageInfo(null);
    setSelectedGroup(null);
    setSelectedUser(null);
    clearTargetUserParam();
  }, [clearTargetUserParam]);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  useEffect(() => () => clearReactionPressTimer(), []);

  useEffect(() => {
    if (!actionMenuMessageId && !emojiPickerMessageId) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setActionMenuMessageId(null);
        setEmojiPickerMessageId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actionMenuMessageId, emojiPickerMessageId]);

  useEffect(() => {
    if (!showBackgroundPicker) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowBackgroundPicker(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showBackgroundPicker]);

  const scrollThreadToBottomNow = useCallback(() => {
    const thread = messageThreadRef.current;
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
      return;
    }

    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, []);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    requestAnimationFrame(() => {
      const thread = messageThreadRef.current;
      if (thread) {
        if (behavior === 'auto') {
          thread.scrollTop = thread.scrollHeight;
          return;
        }

        thread.scrollTo({ top: thread.scrollHeight, behavior });
        return;
      }

      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  const isThreadNearBottom = useCallback((threshold = 180) => {
    const thread = messageThreadRef.current;
    if (!thread) return true;
    return thread.scrollHeight - thread.scrollTop - thread.clientHeight <= threshold;
  }, []);

  // Images and video metadata can increase a message row after it has been
  // appended.  When the person is already reading the latest message, keep
  // that edge pinned without forcing a jump for someone browsing older chat.
  const armMediaBottomPin = useCallback((force = false) => {
    if (!force && !isThreadNearBottom(220)) return false;
    // A slow mobile connection can decode a large photo well after its
    // upload completes. Keep the newest edge stable long enough for that
    // decode, unless the person deliberately starts browsing the thread.
    mediaBottomPinUntilRef.current = Date.now() + 30_000;
    return true;
  }, [isThreadNearBottom]);

  const cancelMediaBottomPin = useCallback(() => {
    mediaBottomPinUntilRef.current = 0;
  }, []);

  const stabilizeOpeningScroll = useCallback(() => {
    const frames = [];
    const timers = [];
    const run = () => scrollThreadToBottomNow();

    run();
    frames.push(requestAnimationFrame(() => {
      run();
      frames.push(requestAnimationFrame(run));
    }));

    if (typeof window !== 'undefined') {
      timers.push(
        window.setTimeout(run, 80),
        window.setTimeout(run, 220),
        window.setTimeout(run, 520)
      );
    }

    return () => {
      frames.forEach(cancelAnimationFrame);
      timers.forEach(window.clearTimeout);
    };
  }, [scrollThreadToBottomNow]);

  const keepOpeningThreadPinned = useCallback(() => {
    if (!openingConversationRef.current) return;
    scrollThreadToBottomNow();
    if (typeof window !== 'undefined') window.setTimeout(scrollThreadToBottomNow, 60);
  }, [scrollThreadToBottomNow]);

  const settleThreadAfterMediaLoad = useCallback(() => {
    if (openingConversationRef.current) {
      keepOpeningThreadPinned();
      return;
    }

    if (mediaBottomPinUntilRef.current <= Date.now()) return;
    requestAnimationFrame(() => {
      if (mediaBottomPinUntilRef.current > Date.now()) {
        scrollThreadToBottomNow();
      }
    });
  }, [keepOpeningThreadPinned, scrollThreadToBottomNow]);

  // Upload progress can fire many times per second. Rendering the whole chat
  // on every network tick is noticeable on a phone, especially with albums.
  // Coalesce those updates into one paint frame.
  const scheduleUploadProgress = useCallback((value) => {
    const nextValue = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    pendingUploadProgressRef.current = nextValue;

    if (uploadProgressFrameRef.current || typeof window === 'undefined') {
      if (typeof window === 'undefined') setUploadProgress(nextValue);
      return;
    }

    uploadProgressFrameRef.current = window.requestAnimationFrame(() => {
      uploadProgressFrameRef.current = null;
      const progress = pendingUploadProgressRef.current;
      setUploadProgress(previous => previous === progress ? previous : progress);
    });
  }, []);

  const resetUploadProgress = useCallback(() => {
    if (uploadProgressFrameRef.current && typeof window !== 'undefined') {
      window.cancelAnimationFrame(uploadProgressFrameRef.current);
      uploadProgressFrameRef.current = null;
    }
    pendingUploadProgressRef.current = 0;
    setUploadProgress(0);
  }, []);

  const keepComposerAtLatest = useCallback(() => {
    if (!selectedUserId) return;
    pendingAutoScrollRef.current = true;
    scrollThreadToBottomNow();
    requestAnimationFrame(scrollThreadToBottomNow);
    if (typeof window !== 'undefined') window.setTimeout(scrollThreadToBottomNow, 80);
  }, [scrollThreadToBottomNow, selectedUserId]);

  const setComposerText = useCallback((value = '') => {
    composerTextRef.current = value;
    if (inputRef.current) inputRef.current.value = value;
    setComposerHasText(Boolean(value.trim()));
  }, []);

  const clearComposerText = useCallback(() => {
    setComposerText('');
  }, [setComposerText]);

  useEffect(() => {
    if (!selectedUserId || !pendingDraftRef.current) return undefined;
    const draft = pendingDraftRef.current;
    pendingDraftRef.current = '';
    const frame = window.requestAnimationFrame(() => {
      setComposerText(draft);
      focusComposerInput();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusComposerInput, selectedUserId, setComposerText]);

  const clearAttachment = useCallback(() => {
    setSelectedAttachment(prev => {
      getSelectedAttachmentItems(prev).forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return null;
    });
    resetUploadProgress();
    setAttachmentPreview(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [resetUploadProgress]);

  const refreshChatHeadsStatus = useCallback(async () => {
    const status = await getChatHeadsStatus();
    setChatHeadsStatus(status);
    return status;
  }, []);

  useEffect(() => {
    refreshChatHeadsStatus();
    const handleFocus = () => refreshChatHeadsStatus();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshChatHeadsStatus]);

  const handleToggleChatHeads = useCallback(async () => {
    const nextEnabled = !chatHeadsStatus.enabled;
    const status = await setChatHeadsEnabled(nextEnabled);
    setChatHeadsStatus(status);

    if (nextEnabled && !status.canDrawOverlays) {
      toast('Allow Syncrova Messenger to display over other apps to use chat heads.');
      return;
    }

    toast.success(nextEnabled ? 'Chat heads enabled' : 'Chat heads disabled');
  }, [chatHeadsStatus.enabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleNativeBack = (event) => {
      if (mediaPreview) {
        event.preventDefault();
        setMediaPreview(null);
        return;
      }

      if (profileUser) {
        event.preventDefault();
        setProfileUser(null);
        return;
      }

      if (selectedMessageInfo) {
        event.preventDefault();
        setSelectedMessageInfo(null);
        return;
      }

      if (reactionViewerMessageId) {
        event.preventDefault();
        setReactionViewerMessageId(null);
        return;
      }

      if (showBackgroundPicker) {
        event.preventDefault();
        setShowBackgroundPicker(false);
        return;
      }

      if (showChatDetails) {
        event.preventDefault();
        setShowChatDetails(false);
        return;
      }

      if (showModal) {
        event.preventDefault();
        setShowModal(false);
        setForwardingMessage(null);
        return;
      }

      if (showGroupCreate) {
        event.preventDefault();
        setShowGroupCreate(false);
        resetGroupCreateForm();
        return;
      }

      if (showGroupSettings) {
        event.preventDefault();
        setShowGroupSettings(false);
        return;
      }

      if (showPinnedPanel) {
        event.preventDefault();
        setShowPinnedPanel(false);
        return;
      }

      if (emojiPickerMessageId || actionMenuMessageId) {
        event.preventDefault();
        setEmojiPickerMessageId(null);
        setActionMenuMessageId(null);
        return;
      }

      if (replyingTo || editingMessage || selectedAttachment) {
        event.preventDefault();
        setReplyingTo(null);
        setEditingMessage(null);
        clearAttachment();
        return;
      }

      if (selectedUser || selectedGroup) {
        event.preventDefault();
        returnToInbox();
      }
    };

    window.addEventListener('syncrova:native-back', handleNativeBack);
    return () => window.removeEventListener('syncrova:native-back', handleNativeBack);
  }, [
    actionMenuMessageId,
    clearAttachment,
    editingMessage,
    emojiPickerMessageId,
    mediaPreview,
    profileUser,
    replyingTo,
    reactionViewerMessageId,
    selectedAttachment,
    selectedGroup,
    selectedMessageInfo,
    selectedUser,
    returnToInbox,
    showBackgroundPicker,
    showChatDetails,
    showGroupCreate,
    showGroupSettings,
    showModal,
    showPinnedPanel
  ]);

  const updateUnreadBadge = (items) => {
    const unreadTotal = items.reduce((total, item) => total + (item.unreadCount || 0), 0);
    window.dispatchEvent(new CustomEvent('unreadMessages', { detail: { count: unreadTotal } }));
  };

  const rememberLastSeen = (items = []) => {
    setLastSeenByUser(prev => {
      const next = { ...prev };
      items.forEach(item => {
        const person = item?.user || item;
        const personId = getEntityId(person);
        if (personId && person?.lastSeen) next[personId] = person.lastSeen;
      });
      return next;
    });
  };

  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.get('/messages/conversations');
      const items = Array.isArray(res.data) ? res.data : [];
      setConversations(items);
      syncConversationNicknamesFromItems(items);
      setConversationBackgrounds(prev => {
        let changed = false;
        const next = { ...prev };
        items.forEach(item => {
          const userId = getEntityId(item.user);
          if (!userId) return;
          const backgroundId = normalizeChatBackgroundKey(item.conversation?.backgroundId);
          if ((next[userId] || DEFAULT_CHAT_BACKGROUND_ID) !== backgroundId) {
            next[userId] = backgroundId;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      rememberLastSeen(items);
      updateUnreadBadge(items);
      return items;
    } catch (err) {
      console.error(err);
      return [];
    }
  }, [syncConversationNicknamesFromItems]);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await api.get('/groups');
      const items = Array.isArray(res.data) ? res.data : [];
      setGroups(items);
      setSelectedGroup(prev => {
        const selectedId = getEntityId(prev);
        if (!selectedId) return prev;
        return items.find(group => getEntityId(group) === selectedId) || prev;
      });
      return items;
    } catch (err) {
      console.error('Groups failed', err);
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshFriends = () => {
      api.get('/friends/summary')
        .then(res => {
          if (cancelled) return;
          const ids = new Set((res.data?.friends || [])
            .map(item => getEntityId(item.user))
            .filter(Boolean));
          setAcceptedFriendIds(ids);
        })
        .catch(() => {
          if (!cancelled) setAcceptedFriendIds(new Set());
        });
    };

    refreshFriends();
    window.addEventListener('friendsUpdated', refreshFriends);
    return () => {
      cancelled = true;
      window.removeEventListener('friendsUpdated', refreshFriends);
    };
  }, []);

  const fetchUserNotes = useCallback(async () => {
    try {
      const [myNoteRes, activeNotesRes, storiesRes] = await Promise.all([
        api.get('/notes/me'),
        api.get('/notes/active'),
        api.get('/stories/active/grouped').catch(() => ({ data: { groups: [] } }))
      ]);

      setMyNote(myNoteRes.data || null);
      setNoteText(myNoteRes.data?.text || '');
      setUserNotes((activeNotesRes.data || []).reduce((map, note) => {
        const noteUserId = getEntityId(note.userId);
        if (noteUserId) map[noteUserId] = note;
        return map;
      }, {}));
      setStoryGroups(Array.isArray(storiesRes.data?.groups) ? storiesRes.data.groups : []);
    } catch (err) {
      console.error('User notes failed', err);
    }
  }, []);

  const syncUserNote = useCallback((note) => {
    const noteUserId = getEntityId(note?.userId);
    if (!note?._id || !noteUserId) return;

    setUserNotes(prev => ({ ...prev, [noteUserId]: note }));
    if (noteUserId === currentUserId) {
      setMyNote(note);
      setNoteText(note.text || '');
    }
    setActiveNote(prev => (getEntityId(prev) === getEntityId(note) ? note : prev));
  }, [currentUserId]);

  const removeUserNoteFromState = useCallback(({ noteId, userId } = {}) => {
    const removedNoteId = getEntityId(noteId);
    const removedUserId = getEntityId(userId);
    setUserNotes(prev => {
      const next = { ...prev };
      if (removedUserId) delete next[removedUserId];
      Object.entries(next).forEach(([key, note]) => {
        if (getEntityId(note) === removedNoteId) delete next[key];
      });
      return next;
    });
    if (removedUserId === currentUserId || getEntityId(myNote) === removedNoteId) {
      setMyNote(null);
      setNoteText('');
    }
    setActiveNote(prev => (getEntityId(prev) === removedNoteId ? null : prev));
  }, [currentUserId, myNote]);

  const markChatAsRead = useCallback(async (otherUserId) => {
    const id = getEntityId(otherUserId);
    if (!id || !currentUserId) return;

    try {
      const res = await api.put(`/messages/read/${id}`);
      setMessages(prev => prev.map(message => {
        const fromId = getEntityId(message.from);
        const toId = getEntityId(message.to);

        if (fromId === id && toId === currentUserId) {
          return {
            ...message,
            read: true,
            readAt: res.data?.readAt || message.readAt
          };
        }

        return message;
      }));
      fetchConversations();
    } catch (err) {
      console.error(err);
    }
  }, [currentUserId, fetchConversations]);

  const fetchMessages = useCallback(async (userId) => {
    const id = getEntityId(userId);
    if (!id) return;

    const fetchId = latestFetchIdRef.current + 1;
    latestFetchIdRef.current = fetchId;
    openingConversationRef.current = true;
    setLoading(true);
    setVisibleMessageCount(getMessageRenderBatch());
    setHasOlderMessages(false);
    setOldestMessageCursor(null);
    setLoadingOlderMessages(false);
    loadingOlderMessagesRef.current = false;

    try {
      const res = await api.get(`/messages/${id}`, {
        params: {
          paginated: 1,
          limit: INITIAL_MESSAGE_PAGE_LIMIT
        }
      });
      if (latestFetchIdRef.current !== fetchId) return;

      const payload = res.data || {};
      const loadedMessages = Array.isArray(payload) ? payload : (payload.items || []);
      if (!Array.isArray(payload)) {
        cacheConversationBackground(id, payload.conversation?.backgroundId);
        cacheConversationNickname(id, payload.conversation?.nicknames?.[id] || '');
      }
      setMessages(loadedMessages);
      setHasOlderMessages(Boolean(!Array.isArray(payload) && payload.hasMore));
      setOldestMessageCursor(Array.isArray(payload) ? null : (payload.nextCursor || null));
      const firstUnreadIncoming = loadedMessages.find(message => (
        getEntityId(message.from) === id
        && getEntityId(message.to) === currentUserId
        && !message.read
        && !message.unsent
      ));
      setUnreadDividerMessageId(getEntityId(firstUnreadIncoming));
      rememberLastSeen(loadedMessages.flatMap(message => [message.from, message.to]));
      await markChatAsRead(id);
    } catch (err) {
      toast.error('Failed to load messages');
    } finally {
      if (latestFetchIdRef.current === fetchId) setLoading(false);
    }
  }, [cacheConversationBackground, cacheConversationNickname, currentUserId, markChatAsRead]);

  const fetchChatStreak = useCallback(async (userId) => {
    const id = getEntityId(userId);
    if (!id) {
      setChatStreak(null);
      return null;
    }

    try {
      const res = await api.get(`/messages/streak/${id}`);
      setChatStreak(res.data || null);
      return res.data;
    } catch (err) {
      console.error('Chat streak failed', err);
      setChatStreak(null);
      return null;
    }
  }, []);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedUserId || !hasOlderMessages || loading || loadingOlderMessagesRef.current) return;
    const before = oldestMessageCursor || messages[0]?.createdAt;
    if (!before) {
      setHasOlderMessages(false);
      return;
    }

    const thread = messageThreadRef.current;
    const previousScrollHeight = thread?.scrollHeight || 0;
    const previousScrollTop = thread?.scrollTop || 0;
    preserveNextMessageScrollRef.current = true;
    setLoadingOlderMessages(true);
    loadingOlderMessagesRef.current = true;

    try {
      const res = await api.get(`/messages/${selectedUserId}`, {
        params: {
          paginated: 1,
          limit: OLDER_MESSAGE_PAGE_LIMIT,
          before
        }
      });
      const payload = res.data || {};
      const olderMessages = Array.isArray(payload) ? payload : (payload.items || []);

      setMessages(prev => {
        const seenIds = new Set(prev.map(message => getEntityId(message)));
        const uniqueOlder = olderMessages.filter(message => {
          const messageId = getEntityId(message);
          return messageId && !seenIds.has(messageId);
        });
        if (!uniqueOlder.length) return prev;
        return [...uniqueOlder, ...prev];
      });
      setHasOlderMessages(Boolean(!Array.isArray(payload) && payload.hasMore));
      setOldestMessageCursor(Array.isArray(payload) ? null : (payload.nextCursor || null));

      requestAnimationFrame(() => {
        const node = messageThreadRef.current;
        if (node) {
          const nextScrollHeight = node.scrollHeight;
          node.scrollTop = previousScrollTop + (nextScrollHeight - previousScrollHeight);
        }
        preserveNextMessageScrollRef.current = false;
      });
    } catch (err) {
      preserveNextMessageScrollRef.current = false;
      toast.error(err.response?.data?.msg || 'Failed to load earlier messages');
    } finally {
      setLoadingOlderMessages(false);
      loadingOlderMessagesRef.current = false;
    }
  }, [hasOlderMessages, loading, messages, oldestMessageCursor, selectedUserId]);

  const revealEarlierLocalMessages = useCallback(() => {
    const thread = messageThreadRef.current;
    const previousScrollHeight = thread?.scrollHeight || 0;
    const previousScrollTop = thread?.scrollTop || 0;
    preserveNextMessageScrollRef.current = true;

    setVisibleMessageCount(count => Math.min(messages.length, count + getMessageRenderBatch()));

    requestAnimationFrame(() => {
      const node = messageThreadRef.current;
      if (node) {
        const nextScrollHeight = node.scrollHeight;
        node.scrollTop = previousScrollTop + (nextScrollHeight - previousScrollHeight);
      }
      preserveNextMessageScrollRef.current = false;
    });
  }, [messages.length]);

  const emitCallSignal = useCallback((eventName, payload = {}) => {
    const activeSocket = socket || getSocket();
    if (!activeSocket.connected) activeSocket.connect();
    activeSocket.emit(eventName, payload);
  }, []);

  const clearLiveKitTracks = useCallback(() => {
    Object.values(liveKitTracksRef.current || {}).forEach(track => {
      try {
        track?.detach?.();
      } catch {
        // Ignore detach failures during call cleanup.
      }
    });
    liveKitTracksRef.current = { localVideo: null, remoteVideo: null, remoteAudio: null };
  }, []);

  const attachLiveKitMedia = useCallback(() => {
    const { localVideo, remoteVideo, remoteAudio } = liveKitTracksRef.current || {};
    if (localVideoRef.current && localVideo) {
      localVideo.attach(localVideoRef.current);
      localVideoRef.current.muted = true;
      localVideoRef.current.playsInline = true;
    }
    if (remoteVideoRef.current && remoteVideo) {
      remoteVideo.attach(remoteVideoRef.current);
      remoteVideoRef.current.playsInline = true;
    }
    if (remoteAudioRef.current && remoteAudio) {
      remoteAudio.attach(remoteAudioRef.current);
      remoteAudioRef.current.autoplay = true;
    }
  }, []);

  const cleanupCallMedia = useCallback(() => {
    const liveKitRoom = liveKitRoomRef.current;
    liveKitRoomRef.current = null;
    clearLiveKitTracks();
    if (liveKitRoom) {
      liveKitRoom.removeAllListeners?.();
      liveKitRoom.disconnect();
    }

    const peer = peerConnectionRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.close();
      peerConnectionRef.current = null;
    }

    localStreamRef.current?.getTracks().forEach(track => track.stop());
    remoteStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    pendingIceCandidatesRef.current = [];
    iceRestartAttemptsRef.current = {};
    iceServersRef.current = { ...iceServersRef.current, relayOnlyRetry: false };

    [localVideoRef, remoteVideoRef, remoteAudioRef].forEach(ref => {
      if (ref.current) ref.current.srcObject = null;
    });

    setLocalStreamReady(false);
    setRemoteStreamReady(false);
  }, [clearLiveKitTracks]);

  const resetCall = useCallback((nextError = '') => {
    cleanupCallMedia();
    activeCallRef.current = {
      state: 'idle',
      callId: '',
      partnerId: '',
      mode: 'audio',
      provider: 'livekit'
    };
    setCallState('idle');
    setCallMode('audio');
    setCallProvider('livekit');
    setCallPartner(null);
    setActiveCallId('');
    setIncomingCall(null);
    setCallError(nextError);
    setMicMuted(false);
    setCameraOff(false);
    setCallStartedAt(null);
    setCallIceStatus({ relayCandidate: false, lastCandidateType: '', turnError: '', retrying: false, relayOnly: false });
  }, [cleanupCallMedia]);

  const flushPendingIceCandidates = useCallback(async (peer = peerConnectionRef.current, callId = activeCallRef.current.callId) => {
    if (!peer || !peer.remoteDescription) return;

    const matchingCandidates = [];
    const remainingCandidates = [];

    pendingIceCandidatesRef.current.forEach(item => {
      const itemCallId = item?.callId || '';
      if (!itemCallId || !callId || itemCallId === callId) matchingCandidates.push(item);
      else remainingCandidates.push(item);
    });
    pendingIceCandidatesRef.current = remainingCandidates;

    for (const item of matchingCandidates) {
      try {
        const candidate = item?.candidate || item;
        await peer.addIceCandidate(toIceCandidate(candidate));
      } catch (err) {
        console.warn('Failed to apply queued call candidate', err);
      }
    }
  }, []);

  const markCallConnected = useCallback(() => {
    setCallState('connected');
    setCallStartedAt(prev => prev || Date.now());
  }, []);

  const setLiveKitRemoteTrack = useCallback((track) => {
    if (!track) return;
    if (track.kind === Track.Kind.Video) {
      liveKitTracksRef.current.remoteVideo?.detach?.();
      liveKitTracksRef.current.remoteVideo = track;
      setRemoteStreamReady(true);
      attachLiveKitMedia();
      return;
    }

    if (track.kind === Track.Kind.Audio) {
      liveKitTracksRef.current.remoteAudio?.detach?.();
      liveKitTracksRef.current.remoteAudio = track;
      if (activeCallRef.current.mode !== 'video') setRemoteStreamReady(true);
      attachLiveKitMedia();
    }
  }, [attachLiveKitMedia]);

  const connectLiveKitCall = useCallback(async ({ mode, partnerId, callId, roomName }) => {
    cleanupCallMedia();
    setCallProvider('livekit');
    setCallRelayReady(true);
    setCallIceStatus({
      relayCandidate: true,
      lastCandidateType: 'sfu',
      turnError: '',
      retrying: false,
      relayOnly: true
    });

    const res = await api.post('/calls/livekit-token', {
      callId,
      roomName,
      mode,
      partnerId
    });
    const livekitUrl = res.data?.url;
    const token = res.data?.token;
    const nextRoomName = res.data?.roomName || roomName || `syncrova-call-${callId}`;
    if (!livekitUrl || !token) throw new Error('LiveKit token is missing.');

    const room = new Room({
      adaptiveStream: true,
      dynacast: true
    });
    liveKitRoomRef.current = room;

    room.on(RoomEvent.TrackSubscribed, (track) => {
      setLiveKitRemoteTrack(track);
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      try {
        track?.detach?.();
      } catch {
        // Track may already be detached by the SDK.
      }
      if (liveKitTracksRef.current.remoteVideo === track) {
        liveKitTracksRef.current.remoteVideo = null;
        if (activeCallRef.current.mode === 'video') setRemoteStreamReady(false);
      }
      if (liveKitTracksRef.current.remoteAudio === track) {
        liveKitTracksRef.current.remoteAudio = null;
        if (activeCallRef.current.mode !== 'video') setRemoteStreamReady(false);
      }
    });

    room.on(RoomEvent.ParticipantDisconnected, () => {
      setRemoteStreamReady(false);
      if (activeCallRef.current.state === 'connected') {
        setCallError('The other participant left the call.');
      }
    });

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      setCallIceStatus(prev => ({
        ...prev,
        lastCandidateType: state === ConnectionState.Connected ? 'sfu' : prev.lastCandidateType,
        retrying: state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting
      }));
      if (state === ConnectionState.Connected) setCallError('');
      if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
        setCallError('Reconnecting call...');
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      if (liveKitRoomRef.current !== room) return;
      if (activeCallRef.current.state !== 'idle') {
        setCallError('Call connection closed.');
      }
    });

    await room.connect(livekitUrl, token, { autoSubscribe: true });
    await room.localParticipant.setMicrophoneEnabled(true);
    setLocalStreamReady(true);
    setMicMuted(false);

    if (mode === 'video') {
      const publication = await room.localParticipant.setCameraEnabled(true);
      liveKitTracksRef.current.localVideo = publication?.track
        || room.localParticipant.getTrackPublication(Track.Source.Camera)?.track
        || null;
      setCameraOff(false);
      attachLiveKitMedia();
    } else {
      setCameraOff(true);
    }

    room.remoteParticipants.forEach(participant => {
      participant.trackPublications.forEach(publication => {
        if (publication.track) setLiveKitRemoteTrack(publication.track);
      });
    });

    return { roomName: nextRoomName };
  }, [attachLiveKitMedia, cleanupCallMedia, setLiveKitRemoteTrack]);

  const getLocalCallStream = useCallback(async (mode) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Calls are not supported in this browser.');
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === 'video'
          ? {
              width: { ideal: 640, max: 1280 },
              height: { ideal: 480, max: 720 },
              frameRate: { ideal: 24, max: 30 },
              facingMode: 'user'
            }
          : false
      });
    } catch (err) {
      throw new Error(getCallMediaErrorMessage(err, mode));
    }
  }, []);

  const loadCallIceServers = useCallback(async ({ fresh = false } = {}) => {
    const cached = iceServersRef.current;
    if (!fresh && cached?.servers && Date.now() - cached.fetchedAt < (cached.ttlMs || CALL_ICE_CACHE_MS)) return cached.servers;

    let nextIceServers = normalizeIceServers(STATIC_CALL_ICE_SERVERS);
    let nextConfig = {
      ...cached,
      servers: nextIceServers,
      fetchedAt: Date.now(),
      forceRelay: shouldForceTurnRelay(),
      relayConfigured: hasTurnServer(nextIceServers),
      relayOnlyRetry: Boolean(cached?.relayOnlyRetry),
      ttlMs: CALL_ICE_CACHE_MS
    };

    try {
      const res = await api.get('/app/ice-servers');
      const remoteIceServers = normalizeIceServers(res.data?.iceServers || []);
      if (remoteIceServers.length) nextIceServers = remoteIceServers;
      const transportPolicy = String(res.data?.iceTransportPolicy || '').toLowerCase();
      nextConfig = {
        ...nextConfig,
        servers: nextIceServers,
        forceRelay: isEnabledFlag(res.data?.forceRelay) || transportPolicy === 'relay' || shouldForceTurnRelay(),
        relayConfigured: Boolean(res.data?.relayConfigured) || hasTurnServer(nextIceServers),
        ttlMs: Math.max(30_000, Number(res.data?.ttlSeconds || 300) * 1000)
      };
      setCallRelayReady(nextConfig.relayConfigured);
    } catch (err) {
      nextConfig = {
        ...nextConfig,
        servers: nextIceServers,
        relayConfigured: hasTurnServer(nextIceServers)
      };
      setCallRelayReady(nextConfig.relayConfigured);
      console.warn('Call ICE server config fallback is active', err);
    }

    iceServersRef.current = nextConfig;
    return nextIceServers;
  }, []);

  const createPeerConnection = useCallback((partnerId, nextCallId, iceServers = STATIC_CALL_ICE_SERVERS) => {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('Calls are not supported in this browser.');
    }

    const relayReady = hasTurnServer(iceServers);
    const relayOnly = shouldUseRelayOnly(iceServers, iceServersRef.current);
    setCallRelayReady(relayReady);
    setCallIceStatus({ relayCandidate: false, lastCandidateType: '', turnError: '', retrying: false, relayOnly });

    const peer = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: relayReady ? 10 : 4,
      iceTransportPolicy: relayOnly ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });

    peer.onicecandidate = (event) => {
      if (!event.candidate || !partnerId || !currentUserId) return;
      const candidateType = getIceCandidateType(event.candidate);
      if (candidateType) {
        setCallIceStatus(prev => ({
          ...prev,
          lastCandidateType: candidateType,
          relayCandidate: prev.relayCandidate || candidateType === 'relay',
          retrying: false,
          turnError: candidateType === 'relay' ? '' : prev.turnError
        }));
      }
      emitCallSignal('call:ice-candidate', {
        callId: nextCallId,
        from: currentUserId,
        to: partnerId,
        type: activeCallRef.current.mode,
        candidate: event.candidate
      });
    };

    peer.onicecandidateerror = (event) => {
      const url = String(event?.url || '');
      if (!/^turns?:/i.test(url)) return;
      console.warn('TURN candidate error', {
        code: event?.errorCode,
        text: event?.errorText,
        url: url.replace(/\/\/.*@/, '//***@')
      });
      setCallIceStatus(prev => ({
        ...prev,
        turnError: prev.relayCandidate ? '' : getSafeTurnErrorMessage(event),
        retrying: !prev.relayCandidate
      }));
      iceServersRef.current = { ...iceServersRef.current, servers: null, fetchedAt: 0 };
    };

    peer.ontrack = (event) => {
      if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
      const incomingTracks = event.streams?.[0]?.getTracks?.() || [event.track].filter(Boolean);
      incomingTracks.forEach(track => {
        const alreadyAdded = remoteStreamRef.current.getTracks().some(item => item.id === track.id);
        if (!alreadyAdded) remoteStreamRef.current.addTrack(track);
      });
      setRemoteStreamReady(remoteStreamRef.current.getTracks().length > 0);
    };

    peer.onconnectionstatechange = async () => {
      if (peer.connectionState === 'connected') {
        markCallConnected();
        setCallIceStatus(prev => ({ ...prev, retrying: false, turnError: '' }));
        return;
      }

      if (peer.connectionState === 'failed') {
        const restarted = await sendIceRestartOffer();
        if (!restarted) {
          iceServersRef.current = { ...iceServersRef.current, servers: null, fetchedAt: 0 };
          setCallError('Call connection failed. Please try again.');
        }
      }
    };

    const sendIceRestartOffer = async () => {
      const attempts = iceRestartAttemptsRef.current[nextCallId] || 0;
      if (!partnerId || !currentUserId || attempts >= MAX_CALL_ICE_RESTARTS || peer.signalingState !== 'stable') return false;

      iceRestartAttemptsRef.current[nextCallId] = attempts + 1;
      const retryWithRelayOnly = relayReady;
      const nextRelayOnly = shouldUseRelayOnly(iceServers, {
        ...iceServersRef.current,
        relayOnlyRetry: retryWithRelayOnly
      });

      iceServersRef.current = {
        ...iceServersRef.current,
        servers: iceServers,
        fetchedAt: Date.now(),
        relayConfigured: relayReady,
        relayOnlyRetry: retryWithRelayOnly || Boolean(iceServersRef.current.relayOnlyRetry)
      };
      setCallIceStatus(prev => ({
        ...prev,
        retrying: true,
        relayOnly: nextRelayOnly,
        turnError: prev.turnError || (nextRelayOnly ? 'Retrying through call relay...' : 'Retrying call route...')
      }));
      setCallError(nextRelayOnly ? 'Retrying through call relay...' : 'Retrying call connection...');

      try {
        try {
          peer.setConfiguration?.({
            iceServers,
            iceTransportPolicy: nextRelayOnly ? 'relay' : 'all'
          });
        } catch (configErr) {
          console.warn('Call ICE configuration update failed', configErr);
        }

        peer.restartIce?.();
        const offer = await peer.createOffer({ iceRestart: true });
        await peer.setLocalDescription(offer);
        emitCallSignal('call:offer', {
          callId: nextCallId,
          from: currentUserId,
          to: partnerId,
          type: activeCallRef.current.mode,
          offer,
          restart: true
        });
        return true;
      } catch (err) {
        console.warn('ICE restart failed', err);
        return false;
      }
    };

    peer.oniceconnectionstatechange = async () => {
      if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
        markCallConnected();
        setCallError('');
        setCallIceStatus(prev => ({ ...prev, retrying: false, turnError: '' }));
        return;
      }

      if (peer.iceConnectionState === 'disconnected') {
        setCallError('Reconnecting call...');
      }

      if (peer.iceConnectionState === 'failed') {
        const restarted = await sendIceRestartOffer();
        if (!restarted) setCallError('Call connection is unstable. End the call and try again if it does not recover.');
      }
    };

    peerConnectionRef.current = peer;
    return peer;
  }, [currentUserId, emitCallSignal, markCallConnected]);

  const prepareLocalCall = useCallback(async (mode, partnerId, nextCallId) => {
    const preservedCandidates = pendingIceCandidatesRef.current.filter(item => {
      const itemCallId = item?.callId || '';
      return !itemCallId || itemCallId === nextCallId;
    });
    cleanupCallMedia();
    pendingIceCandidatesRef.current = preservedCandidates;
    iceRestartAttemptsRef.current = {};
    const stream = await getLocalCallStream(mode);
    localStreamRef.current = stream;
    remoteStreamRef.current = new MediaStream();
    setLocalStreamReady(true);
    setRemoteStreamReady(false);
    setMicMuted(false);
    setCameraOff(mode !== 'video');

    const iceServers = await loadCallIceServers();
    const peer = createPeerConnection(partnerId, nextCallId, iceServers);
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    return peer;
  }, [cleanupCallMedia, createPeerConnection, getLocalCallStream, loadCallIceServers]);

  useEffect(() => {
    activeCallRef.current = {
      state: callState,
      callId: activeCallId,
      partnerId: getEntityId(callPartner),
      mode: callMode,
      provider: callProvider
    };
  }, [activeCallId, callMode, callPartner, callProvider, callState]);

  useEffect(() => {
    if (callProvider === 'livekit') {
      attachLiveKitMedia();
      return;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [attachLiveKitMedia, callProvider, callState, localStreamReady]);

  useEffect(() => {
    if (callProvider === 'livekit') {
      attachLiveKitMedia();
      return;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
    }
  }, [attachLiveKitMedia, callProvider, callState, remoteStreamReady]);

  useEffect(() => {
    if (!callStartedAt) return undefined;
    const timer = setInterval(() => setCallClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [callStartedAt]);

  useEffect(() => () => cleanupCallMedia(), [cleanupCallMedia]);

  const startCall = useCallback(async (mode = 'audio') => {
    const partnerId = selectedUserId;
    if (!currentUserId || !partnerId || !selectedUser) return;

    if (activeCallRef.current.state !== 'idle') {
      toast.error('Finish your current call first.');
      return;
    }

    if (!onlineUsers.has(partnerId)) {
      toast.error(`${getDisplayName(selectedUser, 'This user')} is offline right now.`);
      return;
    }

    const nextCallId = createCallId();
    const partner = serializeCallUser(selectedUser);
    const caller = serializeCallUser(user);

    activeCallRef.current = {
      state: 'calling',
      callId: nextCallId,
      partnerId,
      mode,
      provider: 'livekit'
    };
    setCallState('calling');
    setCallMode(mode);
    setCallProvider('livekit');
    setCallPartner(partner);
    setActiveCallId(nextCallId);
    setIncomingCall(null);
    setCallError('');

    try {
      const roomName = `syncrova-call-${nextCallId}`;
      const livekit = await connectLiveKitCall({ mode, partnerId, callId: nextCallId, roomName });
      emitCallSignal('call:start', {
        callId: nextCallId,
        from: currentUserId,
        to: partnerId,
        type: mode,
        caller,
        provider: 'livekit',
        livekit: true,
        roomName: livekit.roomName
      });
      setCallState('connecting');
    } catch (err) {
      console.error('Start call failed', err);
      const message = getCallSetupErrorMessage(err, 'Could not start the call.');
      resetCall(message);
      toast.error(message);
    }
  }, [connectLiveKitCall, currentUserId, emitCallSignal, onlineUsers, resetCall, selectedUser, selectedUserId, user]);

  const acceptCall = useCallback(async () => {
    const pendingCall = incomingCall;
    const callerId = getEntityId(pendingCall?.from);
    const nextCallId = pendingCall?.callId;
    const mode = pendingCall?.type || 'audio';
    const isLiveKitCall = pendingCall?.livekit || pendingCall?.provider === 'livekit' || pendingCall?.roomName;

    if (!pendingCall || !callerId || !nextCallId) return;
    if (!isLiveKitCall && !pendingCall.offer) {
      toast.error('Call is still connecting. Please wait a second.');
      return;
    }

    activeCallRef.current = {
      state: 'connecting',
      callId: nextCallId,
      partnerId: callerId,
      mode,
      provider: isLiveKitCall ? 'livekit' : 'webrtc'
    };
    setCallState('connecting');
    setCallMode(mode);
    setCallProvider(isLiveKitCall ? 'livekit' : 'webrtc');
    setCallPartner(pendingCall.caller || { _id: callerId, id: callerId, name: 'Caller' });
    setActiveCallId(nextCallId);
    setCallError('');

    try {
      if (isLiveKitCall) {
        const livekit = await connectLiveKitCall({
          mode,
          partnerId: callerId,
          callId: nextCallId,
          roomName: pendingCall.roomName || `syncrova-call-${nextCallId}`
        });
        emitCallSignal('call:answer', {
          callId: nextCallId,
          from: currentUserId,
          to: callerId,
          type: mode,
          accepted: true,
          provider: 'livekit',
          livekit: true,
          roomName: livekit.roomName
        });
        setIncomingCall(null);
        markCallConnected();
        return;
      }

      const peer = await prepareLocalCall(mode, callerId, nextCallId);
      await peer.setRemoteDescription(toSessionDescription(pendingCall.offer));
      await flushPendingIceCandidates(peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      emitCallSignal('call:answer', {
        callId: nextCallId,
        from: currentUserId,
        to: callerId,
        type: mode,
        answer
      });
      setIncomingCall(null);
    } catch (err) {
      console.error('Accept call failed', err);
      const message = getCallSetupErrorMessage(err, 'Could not join the call.');
      emitCallSignal('call:reject', {
        callId: nextCallId,
        from: currentUserId,
        to: callerId,
        type: mode,
        reason: 'media-error'
      });
      resetCall(message);
      toast.error(message);
    }
  }, [connectLiveKitCall, currentUserId, emitCallSignal, flushPendingIceCandidates, incomingCall, markCallConnected, prepareLocalCall, resetCall]);

  const endCall = useCallback((reason = 'ended', notify = true) => {
    const activeCall = activeCallRef.current;
    if (notify && activeCall.callId && activeCall.partnerId && currentUserId) {
      emitCallSignal('call:end', {
        callId: activeCall.callId,
        from: currentUserId,
        to: activeCall.partnerId,
        type: activeCall.mode,
        reason
      });
    }
    resetCall();
  }, [currentUserId, emitCallSignal, resetCall]);

  const rejectCall = useCallback((reason = 'declined') => {
    const pendingCall = incomingCall || activeCallRef.current;
    const partnerId = getEntityId(pendingCall.from || pendingCall.partnerId);
    const nextCallId = pendingCall.callId;
    const mode = pendingCall.type || pendingCall.mode || callMode;

    if (nextCallId && partnerId && currentUserId) {
      emitCallSignal('call:reject', {
        callId: nextCallId,
        from: currentUserId,
        to: partnerId,
        type: mode,
        reason
      });
    }

    resetCall();
  }, [callMode, currentUserId, emitCallSignal, incomingCall, resetCall]);

  useEffect(() => {
    if (!activeCallId || !['calling', 'connecting'].includes(callState)) return undefined;
    const expectedCallId = activeCallId;
    const timer = window.setTimeout(() => {
      const activeCall = activeCallRef.current;
      if (activeCall.callId !== expectedCallId || !['calling', 'connecting'].includes(activeCall.state)) return;
      endCall('timeout');
      setCallError('Call timed out. Please try again.');
      toast.error('Call timed out. Please try again.');
    }, 35000);

    return () => window.clearTimeout(timer);
  }, [activeCallId, callState, endCall]);

  const toggleCallMic = useCallback(async () => {
    const room = liveKitRoomRef.current;
    if (callProvider === 'livekit' && room) {
      const nextMuted = !micMuted;
      try {
        await room.localParticipant.setMicrophoneEnabled(!nextMuted);
        setMicMuted(nextMuted);
        setLocalStreamReady(true);
      } catch (err) {
        console.warn('LiveKit mic toggle failed', err);
        toast.error('Could not update microphone.');
      }
      return;
    }

    const audioTracks = localStreamRef.current?.getAudioTracks?.() || [];
    if (!audioTracks.length) return;
    const nextMuted = !micMuted;
    audioTracks.forEach(track => {
      track.enabled = !nextMuted;
    });
    setMicMuted(nextMuted);
  }, [callProvider, micMuted]);

  const toggleCallCamera = useCallback(async () => {
    const room = liveKitRoomRef.current;
    if (callProvider === 'livekit' && room) {
      const nextCameraOff = !cameraOff;
      try {
        const publication = await room.localParticipant.setCameraEnabled(!nextCameraOff);
        if (nextCameraOff) {
          liveKitTracksRef.current.localVideo?.detach?.();
          liveKitTracksRef.current.localVideo = null;
        } else {
          liveKitTracksRef.current.localVideo = publication?.track
            || room.localParticipant.getTrackPublication(Track.Source.Camera)?.track
            || null;
          attachLiveKitMedia();
        }
        setCameraOff(nextCameraOff);
      } catch (err) {
        console.warn('LiveKit camera toggle failed', err);
        toast.error('Could not update camera.');
      }
      return;
    }

    const videoTracks = localStreamRef.current?.getVideoTracks?.() || [];
    if (!videoTracks.length) return;
    const nextCameraOff = !cameraOff;
    videoTracks.forEach(track => {
      track.enabled = !nextCameraOff;
    });
    setCameraOff(nextCameraOff);
  }, [attachLiveKitMedia, callProvider, cameraOff]);

  const handleIncomingCallStart = useCallback((payload = {}) => {
    const fromId = getEntityId(payload.from);
    const toId = getEntityId(payload.to);
    if (!fromId || fromId === currentUserId || (toId && toId !== currentUserId)) return;

    if (activeCallRef.current.state !== 'idle') {
      emitCallSignal('call:busy', {
        callId: payload.callId,
        from: currentUserId,
        to: fromId,
        type: payload.type || 'audio',
        reason: 'busy'
      });
      return;
    }

    const nextCallId = payload.callId || createCallId();
    const mode = payload.type || 'audio';
    const caller = payload.caller || { _id: fromId, id: fromId, name: payload.callerName || 'Incoming call' };
    const isLiveKitCall = payload.livekit || payload.provider === 'livekit' || payload.roomName;

    activeCallRef.current = {
      state: 'incoming',
      callId: nextCallId,
      partnerId: fromId,
      mode,
      provider: isLiveKitCall ? 'livekit' : 'webrtc'
    };
    setCallState('incoming');
    setCallMode(mode);
    setCallProvider(isLiveKitCall ? 'livekit' : 'webrtc');
    setCallPartner(caller);
    setActiveCallId(nextCallId);
    setIncomingCall(prev => ({
      ...(prev || {}),
      ...payload,
      callId: nextCallId,
      from: fromId,
      type: mode,
      caller,
      provider: isLiveKitCall ? 'livekit' : payload.provider,
      livekit: Boolean(isLiveKitCall),
      roomName: payload.roomName || (isLiveKitCall ? `syncrova-call-${nextCallId}` : '')
    }));
    setCallError('');

    if (soundEnabled) playUiSound('ringtone', 0.45);
  }, [currentUserId, emitCallSignal, soundEnabled]);

  const handleCallOffer = useCallback(async (payload = {}) => {
    const fromId = getEntityId(payload.from);
    const toId = getEntityId(payload.to);
    if (!fromId || fromId === currentUserId || (toId && toId !== currentUserId)) return;

    const nextCallId = payload.callId || createCallId();
    const activeCall = activeCallRef.current;
    if (payload.livekit || payload.provider === 'livekit' || activeCall.provider === 'livekit') return;

    if (payload.offer && activeCall.callId === nextCallId && peerConnectionRef.current && activeCall.state !== 'idle') {
      const peer = peerConnectionRef.current;
      try {
        await peer.setRemoteDescription(toSessionDescription(payload.offer));
        await flushPendingIceCandidates(peer, nextCallId);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        emitCallSignal('call:answer', {
          callId: nextCallId,
          from: currentUserId,
          to: fromId,
          type: payload.type || activeCall.mode || 'audio',
          answer,
          restart: Boolean(payload.restart)
        });
        setCallState('connecting');
        setCallError('');
        setCallIceStatus(prev => ({ ...prev, retrying: Boolean(payload.restart), turnError: payload.restart ? 'Refreshing relay route...' : prev.turnError }));
      } catch (err) {
        console.error('Call re-offer failed', err);
        setCallError('Call had trouble refreshing the connection.');
      }
      return;
    }

    if (activeCall.state !== 'idle' && activeCall.callId !== nextCallId) {
      emitCallSignal('call:busy', {
        callId: nextCallId,
        from: currentUserId,
        to: fromId,
        type: payload.type || 'audio',
        reason: 'busy'
      });
      return;
    }

    const mode = payload.type || activeCall.mode || 'audio';
    const fallbackCaller = payload.caller || callPartner || { _id: fromId, id: fromId, name: 'Incoming call' };

    activeCallRef.current = {
      state: 'incoming',
      callId: nextCallId,
      partnerId: fromId,
      mode,
      provider: 'webrtc'
    };
    setCallState('incoming');
    setCallMode(mode);
    setCallProvider('webrtc');
    setCallPartner(prev => payload.caller || prev || fallbackCaller);
    setActiveCallId(nextCallId);
    setIncomingCall(prev => ({
      ...(prev || {}),
      ...payload,
      callId: nextCallId,
      from: fromId,
      type: mode,
      caller: payload.caller || prev?.caller || fallbackCaller,
      offer: payload.offer
    }));
  }, [callPartner, currentUserId, emitCallSignal, flushPendingIceCandidates]);

  const handleCallAnswer = useCallback(async (payload = {}) => {
    const activeCall = activeCallRef.current;
    if (payload.callId !== activeCall.callId) return;
    if (payload.livekit || payload.provider === 'livekit' || activeCall.provider === 'livekit') {
      markCallConnected();
      setCallError('');
      return;
    }
    if (!payload.answer) return;

    const peer = peerConnectionRef.current;
    if (!peer) return;

    try {
      await peer.setRemoteDescription(toSessionDescription(payload.answer));
      await flushPendingIceCandidates(peer);
      if (payload.restart) {
        setCallError('');
        setCallIceStatus(prev => ({ ...prev, retrying: false, turnError: '' }));
      }
    } catch (err) {
      console.error('Call answer failed', err);
      resetCall('Call failed while connecting.');
    }
  }, [flushPendingIceCandidates, markCallConnected, resetCall]);

  const handleCallIceCandidate = useCallback(async (payload = {}) => {
    const activeCall = activeCallRef.current;
    if (payload.livekit || payload.provider === 'livekit' || activeCall.provider === 'livekit') return;
    if (!payload.candidate) return;
    if (payload.callId && activeCall.callId && payload.callId !== activeCall.callId) return;

    const candidateEntry = {
      callId: payload.callId || activeCall.callId || '',
      candidate: payload.candidate
    };

    const peer = peerConnectionRef.current;
    if (!peer || !peer.remoteDescription) {
      pendingIceCandidatesRef.current.push(candidateEntry);
      return;
    }

    try {
      await peer.addIceCandidate(toIceCandidate(payload.candidate));
    } catch (err) {
      console.warn('Failed to apply call candidate', err);
    }
  }, []);

  const handleRemoteCallEnd = useCallback((payload = {}) => {
    if (payload.callId && payload.callId !== activeCallRef.current.callId) return;
    resetCall();
    if (payload.reason !== 'replaced') toast.success('Call ended');
  }, [resetCall]);

  const handleRemoteCallRejected = useCallback((payload = {}) => {
    if (payload.callId && payload.callId !== activeCallRef.current.callId) return;
    resetCall(payload.reason === 'busy' ? 'User is on another call.' : '');
    toast.error(payload.reason === 'busy' ? 'User is on another call.' : 'Call declined');
  }, [resetCall]);

  const handleCallUnavailable = useCallback((payload = {}) => {
    if (payload.callId && payload.callId !== activeCallRef.current.callId) return;
    resetCall('User is offline right now.');
    toast.error('User is offline right now.');
  }, [resetCall]);

  useEffect(() => {
    const load = async () => {
      setInitialLoading(true);
      // Keep the inbox quick to open. Notes and stories are deliberately not
      // loaded with the core conversation data, since the streamlined inbox
      // does not render their tray.
      await Promise.all([fetchConversations(), fetchGroups()]);
      setInitialLoading(false);
    };

    load();
  }, [fetchConversations, fetchGroups]);

  useEffect(() => {
    if (!targetUserId || !currentUserId || initialLoading) return undefined;

    if (targetDraftText.trim()) pendingDraftRef.current = targetDraftText;

    if (targetUserId === currentUserId) {
      clearTargetUserParam();
      return undefined;
    }

    const existingConversation = conversations.find(item => getEntityId(item.user) === targetUserId);
    if (existingConversation?.user) {
      setSelectedUser(existingConversation.user);
      clearTargetUserParam();
      return undefined;
    }

    let cancelled = false;
    const openTargetConversation = async () => {
      try {
        const res = await api.get(`/users/${targetUserId}/public`);
        if (!cancelled) {
          setSelectedUser(res.data);
          clearTargetUserParam();
        }
      } catch (err) {
        if (!cancelled) {
          toast.error('Could not open that conversation');
          clearTargetUserParam();
        }
      }
    };

    openTargetConversation();
    return () => {
      cancelled = true;
    };
  }, [clearTargetUserParam, conversations, currentUserId, initialLoading, targetDraftText, targetUserId]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    socket = getSocket();

    const syncOnlineUsers = async () => {
      try {
        const res = await api.get('/presence/online');
        setOnlineUsers(new Set(normalizeOnlineUserIds(res.data)));
        setPresenceReady(true);
      } catch (err) {
        console.error('Presence fallback failed', err);
      }
    };

    const announceOnline = () => {
      setSocketConnected(true);
      socket.emit('user-online', currentUserId, (users = []) => {
        setOnlineUsers(new Set(normalizeOnlineUserIds(users)));
        setPresenceReady(true);
      });
      socket.emit('get-online-users', (users = []) => {
        setOnlineUsers(new Set(normalizeOnlineUserIds(users)));
        setPresenceReady(true);
      });
    };

    const onOnlineUsers = (users = []) => {
      setOnlineUsers(new Set(normalizeOnlineUserIds(users)));
      setPresenceReady(true);
    };

    const onDisconnect = () => {
      setSocketConnected(false);
      setPresenceReady(false);
      syncOnlineUsers();
    };

    const onUserOnline = (payload) => {
      const normalizedUserId = getPresencePayloadUserId(payload);
      if (!normalizedUserId) return;
      setOnlineUsers(prev => {
        const next = new Set(prev);
        next.add(normalizedUserId);
        return next;
      });
    };

    const onUserOffline = (payload) => {
      const userId = getPresencePayloadUserId(payload);
      if (!userId) return;
      if (payload?.lastSeen) {
        setLastSeenByUser(prev => ({ ...prev, [userId]: payload.lastSeen }));
      }

      setOnlineUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    };

    const onUserStatusChange = (payload = {}) => {
      const userId = getPresencePayloadUserId(payload);
      if (!userId) return;
      if (payload.online || payload.status === 'online') {
        onUserOnline(userId);
        return;
      }
      onUserOffline(payload);
    };

    const onTyping = ({ from }) => {
      const fromId = getEntityId(from);
      if (!fromId) return;

      setTypingUsers(prev => {
        const next = new Set(prev);
        next.add(fromId);
        return next;
      });
      clearTimeout(typingUsersTimeoutRef.current[fromId]);
      typingUsersTimeoutRef.current[fromId] = setTimeout(() => {
        setTypingUsers(prev => {
          const next = new Set(prev);
          next.delete(fromId);
          return next;
        });
        if (getEntityId(selectedUserRef.current) === fromId) {
          setOtherUserTyping(false);
        }
      }, 3500);

      if (getEntityId(selectedUserRef.current) === getEntityId(from)) {
        setOtherUserTyping(true);
      }
    };

    const onStopTyping = ({ from }) => {
      const fromId = getEntityId(from);

      setTypingUsers(prev => {
        const next = new Set(prev);
        next.delete(fromId);
        return next;
      });
      clearTimeout(typingUsersTimeoutRef.current[fromId]);
      delete typingUsersTimeoutRef.current[fromId];

      if (getEntityId(selectedUserRef.current) === fromId) {
        setOtherUserTyping(false);
      }
    };

    let realtimeRefreshTimerId = 0;
    let readBatchFrameId = 0;
    let chatStreakTimerId = 0;
    const pendingReadUserIds = new Set();
    const pendingStreakUserIds = new Set();

    const scheduleRealtimeRefresh = () => {
      if (typeof window === 'undefined') {
        fetchConversations();
        fetchGroups();
        return;
      }
      if (realtimeRefreshTimerId) return;
      realtimeRefreshTimerId = window.setTimeout(() => {
        realtimeRefreshTimerId = 0;
        React.startTransition(() => {
          fetchConversations();
          fetchGroups();
        });
      }, isMobileMessagesViewport() ? 220 : 120);
    };

    const scheduleMarkChatAsRead = (userId) => {
      const id = getEntityId(userId);
      if (!id) return;
      pendingReadUserIds.add(id);
      if (readBatchFrameId || typeof window === 'undefined') return;
      readBatchFrameId = window.requestAnimationFrame(() => {
        readBatchFrameId = 0;
        const ids = Array.from(pendingReadUserIds);
        pendingReadUserIds.clear();
        ids.forEach(markChatAsRead);
      });
    };

    const scheduleChatStreakRefresh = (userId) => {
      const id = getEntityId(userId);
      if (!id) return;
      pendingStreakUserIds.add(id);
      if (chatStreakTimerId || typeof window === 'undefined') return;
      chatStreakTimerId = window.setTimeout(() => {
        chatStreakTimerId = 0;
        const selectedId = getEntityId(selectedUserRef.current);
        const ids = Array.from(pendingStreakUserIds);
        pendingStreakUserIds.clear();
        const targetId = ids.includes(selectedId) ? selectedId : ids[ids.length - 1];
        if (targetId) fetchChatStreak(targetId);
      }, isMobileMessagesViewport() ? 900 : 500);
    };

    const openMessageBatcher = createFrameBatcher((batch) => {
      const selectedId = getEntityId(selectedUserRef.current);
      if (!selectedId) return;

      const incomingMessages = batch.filter(message => {
        const fromId = getEntityId(message.from);
        const toId = getEntityId(message.to);
        return (
          (fromId === selectedId && toId === currentUserId) ||
          (toId === selectedId && fromId === currentUserId)
        );
      });
      if (!incomingMessages.length) return;

      const shouldAutoScroll = incomingMessages.some(message => getEntityId(message.from) === currentUserId) || isThreadNearBottom();
      const includesAttachment = incomingMessages.some(hasMessageAttachment);
      // A local send explicitly arms this below. Socket echoes and incoming
      // media should only pin when the person is still reading the latest
      // messages, so a manual scroll cannot be pulled back down later.
      if (shouldAutoScroll && includesAttachment) armMediaBottomPin();
      pendingAutoScrollRef.current = shouldAutoScroll;
      pendingAutoScrollBehaviorRef.current = incomingMessages.length > 1 || (shouldAutoScroll && includesAttachment)
        ? 'auto'
        : 'smooth';

      React.startTransition(() => {
        setMessages(prev => {
          const seenIds = new Set(prev.map(getEntityId));
          const uniqueMessages = incomingMessages.filter(message => {
            const messageId = getEntityId(message);
            return messageId && !seenIds.has(messageId);
          });
          return uniqueMessages.length ? [...prev, ...uniqueMessages] : prev;
        });
      });
      setOtherUserTyping(false);
    });

    const updatedMessageBatcher = createFrameBatcher((batch) => {
      const selectedId = getEntityId(selectedUserRef.current);
      if (!selectedId) return;

      const latestById = new Map();
      batch.forEach(updatedMessage => {
        const fromId = getEntityId(updatedMessage.from);
        const toId = getEntityId(updatedMessage.to);
        const belongsToOpenChat = (
          (fromId === selectedId && toId === currentUserId) ||
          (toId === selectedId && fromId === currentUserId)
        );
        const messageId = getEntityId(updatedMessage);
        if (belongsToOpenChat && messageId) latestById.set(messageId, updatedMessage);
      });
      if (!latestById.size) return;

      React.startTransition(() => {
        setMessages(prev => prev.map(message => latestById.get(getEntityId(message)) || message));
      });
    });

    const readReceiptBatcher = createFrameBatcher((batch) => {
      const latestReadByReader = new Map();
      batch.forEach(({ readerId, senderId, readAt }) => {
        if (getEntityId(senderId) !== currentUserId) return;
        const reader = getEntityId(readerId);
        if (reader) latestReadByReader.set(reader, readAt);
      });
      if (!latestReadByReader.size) return;

      React.startTransition(() => {
        setMessages(prev => prev.map(message => {
          const recipientId = getEntityId(message.to);
          if (getEntityId(message.from) === currentUserId && latestReadByReader.has(recipientId)) {
            const readAt = latestReadByReader.get(recipientId);
            return { ...message, read: true, readAt: readAt || message.readAt };
          }
          return message;
        }));
      });
    });

    const onReceiveMessage = (message) => {
      const fromId = getEntityId(message.from);
      const toId = getEntityId(message.to);
      const messageId = getEntityId(message);
      const selectedId = getEntityId(selectedUserRef.current);
      const belongsToCurrentUser = fromId === currentUserId || toId === currentUserId;
      const belongsToOpenChat = selectedId && (
        (fromId === selectedId && toId === currentUserId) ||
        (toId === selectedId && fromId === currentUserId)
      );

      if (!messageId || !belongsToCurrentUser) return;

      scheduleRealtimeRefresh();

      if (belongsToOpenChat) {
        openMessageBatcher.push(message);

        if (fromId !== currentUserId && !message.system) {
          if (soundEnabled && !mutedConversationIds.has(fromId)) playUiSound('message', 0.5);
          scheduleMarkChatAsRead(fromId);
        }
        scheduleChatStreakRefresh(fromId === currentUserId ? toId : fromId);
      } else if (toId === currentUserId && fromId !== currentUserId && !message.system) {
        if (!mutedConversationIds.has(fromId)) {
          if (soundEnabled) playUiSound('message', 0.5);
          toast.success(`New message from ${getDisplayName(message.from, 'someone')}`);
        }
      }
    };

    const onMessagesRead = ({ readerId, senderId, readAt }) => {
      readReceiptBatcher.push({ readerId, senderId, readAt });
      scheduleRealtimeRefresh();
    };

    const onMessageUpdated = (updatedMessage) => {
      updatedMessageBatcher.push(updatedMessage);
      scheduleRealtimeRefresh();
    };

    const onMessageHidden = ({ messageId }) => {
      setMessages(prev => prev.filter(message => getEntityId(message) !== getEntityId(messageId)));
      scheduleRealtimeRefresh();
    };

    const onConversationDeleted = ({ userId }) => {
      const deletedUserId = getEntityId(userId);
      setConversations(prev => prev.filter(conversation => getEntityId(conversation.user) !== deletedUserId));

      if (getEntityId(selectedUserRef.current) === deletedUserId) {
        setSelectedUser(null);
        setMessages([]);
      }
    };

    const onConversationBackgroundUpdated = (payload = {}) => {
      const participants = Array.isArray(payload.participants)
        ? payload.participants.map(getEntityId).filter(Boolean)
        : [];
      if (participants.length && !participants.includes(currentUserId)) return;

      const otherUserId = participants.find(id => id !== currentUserId)
        || getEntityId(payload.otherUserId)
        || getEntityId(payload.userId);
      if (!otherUserId || otherUserId === currentUserId) return;

      const backgroundId = normalizeChatBackgroundKey(payload.conversation?.backgroundId || payload.backgroundId);
      cacheConversationBackground(otherUserId, backgroundId);
      setConversations(prev => prev.map(conversation => (
        getEntityId(conversation.user) === otherUserId
          ? {
              ...conversation,
              conversation: {
                ...(conversation.conversation || {}),
                backgroundId
              }
            }
          : conversation
      )));

      if (getEntityId(selectedUserRef.current) === otherUserId) {
        setPendingBackgroundKey(backgroundId);
      }
    };

    const onConversationNicknameUpdated = (payload = {}) => {
      const participants = Array.isArray(payload.participants)
        ? payload.participants.map(getEntityId).filter(Boolean)
        : [];
      if (participants.length && !participants.includes(currentUserId)) return;

      const otherUserId = participants.find(id => id !== currentUserId)
        || getEntityId(payload.otherUserId)
        || getEntityId(payload.userId);
      if (!otherUserId || otherUserId === currentUserId) return;

      const nextNicknames = payload.conversation?.nicknames || {};
      const nextNickname = String(nextNicknames[otherUserId] || '').trim();
      cacheConversationNickname(otherUserId, nextNickname);
      setConversations(prev => prev.map(conversation => (
        getEntityId(conversation.user) === otherUserId
          ? {
              ...conversation,
              conversation: {
                ...(conversation.conversation || {}),
                nicknames: nextNicknames
              }
            }
          : conversation
      )));

      if (getEntityId(selectedUserRef.current) === otherUserId) {
        setNicknameDraft(nextNickname);
      }
    };

    const onUserNoteUpdated = (note) => {
      syncUserNote(note);
    };

    const onUserNoteDeleted = (payload) => {
      removeUserNoteFromState(payload);
    };

    const onGroupUpdated = (group) => {
      const groupId = getEntityId(group);
      if (!groupId) return;
      setGroups(prev => (
        prev.some(item => getEntityId(item) === groupId)
          ? prev.map(item => (getEntityId(item) === groupId ? { ...item, ...group } : item))
          : [group, ...prev]
      ));
      setSelectedGroup(prev => (getEntityId(prev) === groupId ? { ...prev, ...group } : prev));
    };

    socket.on('connect', announceOnline);
    socket.on('disconnect', onDisconnect);
    socket.on('online-users', onOnlineUsers);
    socket.on('user-online', onUserOnline);
    socket.on('user-offline', onUserOffline);
    socket.on('user-status-change', onUserStatusChange);
    socket.on('user-typing', onTyping);
    socket.on('user-stop-typing', onStopTyping);
    socket.on('receiveMessage', onReceiveMessage);
    socket.on('messages-read', onMessagesRead);
    socket.on('message-updated', onMessageUpdated);
    socket.on('message-hidden', onMessageHidden);
    socket.on('conversation-deleted', onConversationDeleted);
    socket.on('conversation-background-updated', onConversationBackgroundUpdated);
    socket.on('conversation-nickname-updated', onConversationNicknameUpdated);
    socket.on('group-updated', onGroupUpdated);
    socket.on('user-note-updated', onUserNoteUpdated);
    socket.on('user-note-deleted', onUserNoteDeleted);
    if (socket.connected) {
      announceOnline();
    } else {
      socket.connect();
    }

    syncOnlineUsers();

    const heartbeat = setInterval(() => {
      announceOnline();
      syncOnlineUsers();
    }, 15000);

    return () => {
      socket.off('connect', announceOnline);
      socket.off('disconnect', onDisconnect);
      socket.off('online-users', onOnlineUsers);
      socket.off('user-online', onUserOnline);
      socket.off('user-offline', onUserOffline);
      socket.off('user-status-change', onUserStatusChange);
      socket.off('user-typing', onTyping);
      socket.off('user-stop-typing', onStopTyping);
      socket.off('receiveMessage', onReceiveMessage);
      socket.off('messages-read', onMessagesRead);
      socket.off('message-updated', onMessageUpdated);
      socket.off('message-hidden', onMessageHidden);
      socket.off('conversation-deleted', onConversationDeleted);
      socket.off('conversation-background-updated', onConversationBackgroundUpdated);
      socket.off('conversation-nickname-updated', onConversationNicknameUpdated);
      socket.off('group-updated', onGroupUpdated);
      socket.off('user-note-updated', onUserNoteUpdated);
      socket.off('user-note-deleted', onUserNoteDeleted);
      openMessageBatcher.cancel();
      updatedMessageBatcher.cancel();
      readReceiptBatcher.cancel();
      if (realtimeRefreshTimerId) window.clearTimeout(realtimeRefreshTimerId);
      if (readBatchFrameId) window.cancelAnimationFrame(readBatchFrameId);
      if (chatStreakTimerId) window.clearTimeout(chatStreakTimerId);
      clearInterval(heartbeat);
    };
  }, [
    armMediaBottomPin,
    cacheConversationBackground,
    cacheConversationNickname,
    currentUserId,
    fetchConversations,
    fetchGroups,
    fetchChatStreak,
    handleCallAnswer,
    handleCallIceCandidate,
    handleCallOffer,
    handleCallUnavailable,
    handleIncomingCallStart,
    isThreadNearBottom,
    handleRemoteCallEnd,
    handleRemoteCallRejected,
    markChatAsRead,
    mutedConversationIds,
    removeUserNoteFromState,
    scrollToBottom,
    soundEnabled,
    syncUserNote
  ]);

  useEffect(() => {
    mediaBottomPinUntilRef.current = 0;
    if (selectedUser) {
      setMessages([]);
      setVisibleMessageCount(getMessageRenderBatch());
      setHasOlderMessages(false);
      setOldestMessageCursor(null);
      setLoadingOlderMessages(false);
      loadingOlderMessagesRef.current = false;
      openingConversationRef.current = true;
      fetchMessages(selectedUser._id || selectedUser.id);
      fetchChatStreak(selectedUser._id || selectedUser.id);
    } else {
      setMessages([]);
      setHasOlderMessages(false);
      setOldestMessageCursor(null);
      setLoadingOlderMessages(false);
      loadingOlderMessagesRef.current = false;
      openingConversationRef.current = false;
      setChatStreak(null);
    }

    setReplyingTo(null);
    setEditingMessage(null);
    setMessageSearch('');
    setMessageSearchIndex(0);
    setSelectedMessageInfo(null);
    setEmojiPickerMessageId(null);
    setActionMenuMessageId(null);
    setShowBackgroundPicker(false);
    setShowPinnedPanel(false);
    setFocusedMessageId(null);
    clearAttachment();
    clearComposerText();
    setOtherUserTyping(false);
  }, [clearAttachment, clearComposerText, fetchChatStreak, fetchMessages, selectedUser]);

  useEffect(() => {
    const refresh = () => {
      fetchConversations();
      if (selectedUserRef.current) {
        const nextUserId = getEntityId(selectedUserRef.current);
        fetchMessages(nextUserId);
        fetchChatStreak(nextUserId);
      }
    };
    window.addEventListener('syncrova:mobile-refresh', refresh);
    return () => window.removeEventListener('syncrova:mobile-refresh', refresh);
  }, [fetchChatStreak, fetchConversations, fetchGroups, fetchMessages]);

  useLayoutEffect(() => {
    if (loading || !messages.length || !selectedUserId || !openingConversationRef.current) return;
    scrollThreadToBottomNow();
  }, [loading, messages.length, scrollThreadToBottomNow, selectedUserId]);

  useEffect(() => {
    if (!messages.length || loading) return undefined;

    if (preserveNextMessageScrollRef.current) return undefined;

    if (openingConversationRef.current) {
      const cleanupScroll = stabilizeOpeningScroll();
      const finishTimer = window.setTimeout(() => {
        scrollThreadToBottomNow();
        openingConversationRef.current = false;
      }, 700);

      return () => {
        cleanupScroll();
        window.clearTimeout(finishTimer);
      };
    }

    if (pendingAutoScrollRef.current || isThreadNearBottom()) {
      pendingAutoScrollRef.current = false;
      const behavior = pendingAutoScrollBehaviorRef.current || 'smooth';
      pendingAutoScrollBehaviorRef.current = 'smooth';
      scrollToBottom(behavior);
    }

    return undefined;
  }, [isThreadNearBottom, loading, messages.length, scrollThreadToBottomNow, scrollToBottom, selectedUserId, stabilizeOpeningScroll]);

  useEffect(() => {
    return () => {
      clearTimeout(typingTimeoutRef.current);
      clearInterval(recordingTimerRef.current);
      if (uploadProgressFrameRef.current && typeof window !== 'undefined') {
        window.cancelAnimationFrame(uploadProgressFrameRef.current);
        uploadProgressFrameRef.current = null;
      }
      if (mediaRecorderRef.current?.state === 'recording') {
        recordingCancelledRef.current = true;
        mediaRecorderRef.current.stop();
      }
      Object.values(typingUsersTimeoutRef.current).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setPresenceClock(value => value + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const uploadMessageAttachment = async (file, fileType = '', onProgress = null, edit = null) => {
    const editedFile = fileType === 'image' ? await applyImageEdits(file, edit) : file;
    const uploadFile = fileType === 'image' ? await optimizeImageFile(editedFile) : editedFile;
    const formData = new FormData();
    formData.append('file', uploadFile);

    const res = await api.post('/messages/upload', formData, {
      onUploadProgress: (progressEvent) => {
        if (!progressEvent.total) return;
        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        if (onProgress) onProgress(progress);
        else scheduleUploadProgress(progress);
      }
    });

    return res.data;
  };

  const sendMessage = async (overrideAttachment = null) => {
    const draftText = composerTextRef.current;
    const text = draftText.trim();
    const attachment = overrideAttachment || selectedAttachment;
    const attachmentItems = getSelectedAttachmentItems(attachment);
    if ((!text && attachmentItems.length === 0) || !selectedUser || sending) return;

    setSending(true);
    clearComposerText();
    stopTyping();

    try {
      const payload = { to: getEntityId(selectedUser), text };
      if (replyingTo) payload.replyTo = getEntityId(replyingTo);

      if (attachmentItems.length) {
        const uploadedAttachments = [];
        for (let index = 0; index < attachmentItems.length; index += 1) {
          const item = attachmentItems[index];
          const upload = await uploadMessageAttachment(item.file, item.fileType, (progress) => {
            const totalProgress = Math.round(((index + (progress / 100)) / attachmentItems.length) * 100);
            scheduleUploadProgress(totalProgress);
          }, item.edit);
          uploadedAttachments.push(upload);
        }

        payload.attachments = uploadedAttachments;
        Object.assign(payload, uploadedAttachments[0]);
      }

      const res = await api.post('/messages', payload);
      const sentAttachment = attachmentItems.length > 0 || hasMessageAttachment(res.data);
      if (sentAttachment) armMediaBottomPin(true);
      pendingAutoScrollRef.current = true;
      pendingAutoScrollBehaviorRef.current = sentAttachment ? 'auto' : 'smooth';
      setMessages(prev => {
        if (prev.some(item => getEntityId(item) === getEntityId(res.data))) return prev;
        return [...prev, res.data];
      });
      fetchConversations();
      setReplyingTo(null);
      clearAttachment();
      fetchChatStreak(getEntityId(selectedUser));
      if (soundEnabled) playUiSound('send', 0.35);
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to send');
      if (!overrideAttachment) setComposerText(draftText);
    } finally {
      setSending(false);
      resetUploadProgress();
    }
  };

  const handleEditMessage = async () => {
    const messageId = getEntityId(editingMessage);
    const text = composerTextRef.current.trim();
    if (!messageId || !text || sending) return;

    setSending(true);
    try {
      const res = await api.put(`/messages/${messageId}`, { text });
      setMessages(prev => prev.map(message => getEntityId(message) === messageId ? res.data : message));
      setEditingMessage(null);
      clearComposerText();
      setActionMenuMessageId(null);
      fetchConversations();
      toast.success('Message edited');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to edit message');
    } finally {
      setSending(false);
    }
  };

  const submitComposer = () => {
    if (editingMessage) {
      handleEditMessage();
      return;
    }
    sendMessage();
  };

  const startEditMessage = (message) => {
    setEditingMessage(message);
    setReplyingTo(null);
    clearAttachment();
    setComposerText(message.text || '');
    setActionMenuMessageId(null);
    requestAnimationFrame(focusComposerInput);
  };

  const handleSaveNote = async (event) => {
    event.preventDefault();
    const text = noteText.trim();
    if (!text) return;

    setSavingNote(true);
    try {
      const res = await api.post('/notes/me', { text });
      syncUserNote(res.data);
      setShowNoteComposer(false);
      playUiSound('success');
      toast.success('Note posted for 1 day');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to post note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleClearNote = async () => {
    setSavingNote(true);
    try {
      await api.delete('/notes/me');
      removeUserNoteFromState({ noteId: getEntityId(myNote), userId: currentUserId });
      setShowNoteComposer(false);
      toast.success('Note removed');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to remove note');
    } finally {
      setSavingNote(false);
    }
  };

  const triggerNoteReactionBurst = (noteId, emoji) => {
    if (!noteId || !emoji) return;
    setNoteReactionBursts(prev => ({ ...prev, [noteId]: emoji }));
    window.setTimeout(() => {
      setNoteReactionBursts(prev => {
        const next = { ...prev };
        delete next[noteId];
        return next;
      });
    }, 720);
  };

  const syncActiveStory = (updatedStory) => {
    setActiveStory(prev => getEntityId(prev) === getEntityId(updatedStory) ? updatedStory : prev);
    fetchUserNotes();
    window.dispatchEvent(new CustomEvent('storiesUpdated'));
  };

  const openStory = async (story) => {
    if (!story) return;
    setActiveStory(story);
    try {
      const res = await api.post(`/stories/${getEntityId(story)}/view`);
      setActiveStory(prev => getEntityId(prev) === getEntityId(story) ? res.data : prev);
      fetchUserNotes();
      window.dispatchEvent(new CustomEvent('storiesUpdated'));
    } catch {
      // Story viewing should still open even when the view counter request fails.
    }
  };

  const reactToStory = async (story, emoji) => {
    try {
      const res = await api.post(`/stories/${getEntityId(story)}/react`, { emoji });
      syncActiveStory(res.data);
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Reaction failed');
    }
  };

  const commentOnStory = async (story, text) => {
    const reply = String(text || '').trim();
    if (!reply) return;
    try {
      const res = await api.post(`/stories/${getEntityId(story)}/comment`, { text: reply });
      syncActiveStory(res.data?.story || res.data);
      fetchConversations();
      toast.success('Sent to messages');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Comment failed');
    }
  };

  const deleteStory = async (storyId) => {
    try {
      await api.delete(`/stories/${storyId}`);
      setActiveStory(null);
      fetchUserNotes();
      window.dispatchEvent(new CustomEvent('storiesUpdated'));
      toast.success('My Day deleted');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Delete failed');
    }
  };

  const handleOpenNote = (item) => {
    if (item?.isMe) {
      setNoteText(item?.note?.text || myNote?.text || '');
      setShowNoteComposer(true);
      return;
    }
    if (item?.hasStory && !item?.hasNote) {
      openStory(getStoryGroupPreview(item.storyGroup));
      return;
    }
    if (item?.note) {
      setActiveNote(item.note);
      setNoteReplyText('');
      const noteId = getEntityId(item.note);
      if (noteId) {
        api.post(`/notes/${noteId}/view`)
          .then(res => syncUserNote(res.data))
          .catch(() => {});
      }
      return;
    }

    if (item?.person) {
      setProfileUser(item.person);
    }
  };

  const handleOpenTrayStory = (item) => {
    const story = getStoryGroupPreview(item?.storyGroup);
    if (story) {
      openStory(story);
      return;
    }
    handleOpenNote(item);
  };

  const handleTrayFriendRequest = async (event, person) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const personId = getEntityId(person);
    if (!personId || personId === currentUserId || friendActionUserId) return;

    setFriendActionUserId(personId);
    try {
      const res = await api.post(`/friends/request/${personId}`);
      setPendingFriendRequestIds(prev => {
        const next = new Set(prev);
        next.add(personId);
        return next;
      });
      window.dispatchEvent(new CustomEvent('friendsUpdated'));
      toast.success(res.data?.msg || 'Friend request sent');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Friend request failed');
    } finally {
      setFriendActionUserId('');
    }
  };

  const toggleGroupMember = (person) => {
    const personId = getEntityId(person);
    if (!personId || personId === currentUserId) return;
    setSelectedGroupMembers(prev => (
      prev.some(member => getEntityId(member) === personId)
        ? prev.filter(member => getEntityId(member) !== personId)
        : [...prev, person]
    ));
  };

  const resetGroupCreateForm = () => {
    setGroupDraftName('');
    setGroupMemberQuery('');
    setGroupMemberResults([]);
    setSelectedGroupMembers([]);
    setCreatingGroup(false);
  };

  const createGroupChat = async (event) => {
    event?.preventDefault?.();
    const name = groupDraftName.trim();
    if (!name) {
      toast.error('Group name is required');
      return;
    }
    if (selectedGroupMembers.length === 0) {
      toast.error('Add at least one classmate');
      return;
    }

    setCreatingGroup(true);
    try {
      const res = await api.post('/groups', {
        name,
        memberIds: selectedGroupMembers.map(member => getEntityId(member)).filter(Boolean)
      });
      const nextGroup = res.data;
      setGroups(prev => [nextGroup, ...prev.filter(group => getEntityId(group) !== getEntityId(nextGroup))]);
      setSelectedUser(null);
      setSelectedGroup(nextGroup);
      setShowGroupCreate(false);
      resetGroupCreateForm();
      toast.success('Group chat created');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to create group chat');
    } finally {
      setCreatingGroup(false);
    }
  };

  const openGroupSettings = () => {
    if (!selectedGroup) return;
    setGroupSettingsName(selectedGroup.name || '');
    setGroupSettingsPhoto(null);
    setGroupSettingsBackgroundKey(normalizeChatBackgroundKey(selectedGroup.backgroundId));
    setShowGroupSettings(true);
  };

  const updateGroupInState = (nextGroup) => {
    if (!nextGroup) return;
    setGroups(prev => prev.map(group => (
      getEntityId(group) === getEntityId(nextGroup) ? nextGroup : group
    )));
    setSelectedGroup(prev => (getEntityId(prev) === getEntityId(nextGroup) ? nextGroup : prev));
  };

  const saveGroupSettings = async (event) => {
    event?.preventDefault?.();
    if (!selectedGroupId) return;
    const name = groupSettingsName.trim();
    if (canManageSelectedGroup && !name) {
      toast.error('Group name is required');
      return;
    }

    setSavingGroupSettings(true);
    try {
      let nextGroup = selectedGroup;
      if (canManageSelectedGroup && name !== (selectedGroup?.name || '')) {
        const res = await api.put(`/groups/${selectedGroupId}`, {
          name,
          description: selectedGroup?.description || '',
          subject: selectedGroup?.subject || ''
        });
        nextGroup = res.data;
        updateGroupInState(nextGroup);
      }

      if (canManageSelectedGroup && groupSettingsPhoto) {
        const formData = new FormData();
        formData.append('photo', groupSettingsPhoto);
        const res = await api.post(`/groups/${selectedGroupId}/photo`, formData);
        nextGroup = res.data;
        updateGroupInState(nextGroup);
      }

      const nextBackgroundId = normalizeChatBackgroundKey(groupSettingsBackgroundKey);
      if (nextBackgroundId !== normalizeChatBackgroundKey(nextGroup?.backgroundId)) {
        const res = await api.put(`/groups/${selectedGroupId}/background`, { backgroundId: nextBackgroundId });
        nextGroup = res.data?.group || { ...nextGroup, backgroundId: nextBackgroundId };
        updateGroupInState(nextGroup);
      }

      setShowGroupSettings(false);
      toast.success('Group chat updated');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to update group chat');
    } finally {
      setSavingGroupSettings(false);
    }
  };

  useEffect(() => {
    if (!showGroupCreate) return undefined;
    const query = groupMemberQuery.trim();
    if (!query) {
      setGroupMemberResults([]);
      return undefined;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      api.get(`/users/search?q=${encodeURIComponent(query)}`)
        .then(res => {
          if (cancelled) return;
          setGroupMemberResults((Array.isArray(res.data) ? res.data : [])
            .filter(person => getEntityId(person) !== currentUserId));
        })
        .catch(() => {
          if (!cancelled) toast.error('User search failed');
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [currentUserId, groupMemberQuery, showGroupCreate]);

  const handleNoteReaction = async (note, emoji) => {
    const noteId = getEntityId(note);
    if (!noteId) return;
    try {
      triggerNoteReactionBurst(noteId, emoji);
      const res = await api.post(`/notes/${noteId}/react`, { emoji });
      syncUserNote(res.data);
      playUiSound('click', 0.12);
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to react to note');
    }
  };

  const handleNoteReply = async (event) => {
    event.preventDefault();
    const noteId = getEntityId(activeNote);
    const text = noteReplyText.trim();
    if (!noteId || !text) return;

    setSavingNote(true);
    try {
      const res = await api.post(`/notes/${noteId}/comments`, { text });
      syncUserNote(res.data);
      setNoteReplyText('');
      fetchConversations();
      playUiSound('send', 0.22);
      toast.success('Reply sent');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to reply to note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleNoteCommentReaction = async (note, comment, emoji) => {
    const noteId = getEntityId(note);
    const commentId = getEntityId(comment);
    if (!noteId || !commentId) return;
    try {
      triggerNoteReactionBurst(`${noteId}:${commentId}`, emoji);
      const res = await api.post(`/notes/${noteId}/comments/${commentId}/react`, { emoji });
      syncUserNote(res.data);
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to react to reply');
    }
  };

  const handleTyping = () => {
    const selectedId = getEntityId(selectedUser);
    if (!socket || !selectedId || !currentUserId) return;

    const now = Date.now();
    if (now - lastTypingEmitRef.current > 700) {
      lastTypingEmitRef.current = now;
      socket.emit('typing', { to: selectedId, from: currentUserId });
    }

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop-typing', { to: selectedId, from: currentUserId });
    }, 1200);
  };

  const stopTyping = () => {
    const selectedId = getEntityId(selectedUser);
    if (!socket || !selectedId || !currentUserId) return;

    clearTimeout(typingTimeoutRef.current);
    lastTypingEmitRef.current = 0;
    socket.emit('stop-typing', { to: selectedId, from: currentUserId });
  };

  const addAttachmentFiles = (incomingFiles = [], expectedType = null) => {
    const currentItems = getSelectedAttachmentItems(selectedAttachment);
    const availableSlots = Math.max(0, MAX_MESSAGE_MEDIA_SELECTION - currentItems.length);
    const selectedFiles = Array.from(incomingFiles || []);
    if (!selectedFiles.length) return;

    if (availableSlots <= 0) {
      toast.error(`You can send up to ${MAX_MESSAGE_MEDIA_SELECTION} photos or videos at once`);
      return;
    }

    const files = selectedFiles.slice(0, availableSlots);
    if (selectedFiles.length > availableSlots) {
      toast.error(`Only ${MAX_MESSAGE_MEDIA_SELECTION} media items can be sent at once`);
    }

    const oversizedFiles = files.filter(file => file.size > MAX_MESSAGE_UPLOAD_SIZE);
    if (oversizedFiles.length) {
      toast.error('Maximum attachment size is 25MB per file');
      return;
    }

    const items = files.map(file => ({
      id: createAttachmentId(file),
      file,
      fileType: getFileType(file),
      edit: getDefaultMediaEdit(),
      previewUrl: ['image', 'video', 'audio'].includes(getFileType(file)) ? URL.createObjectURL(file) : ''
    }));

    if (expectedType && items.some(item => item.fileType !== expectedType)) {
      items.forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      toast.error(`Please choose a ${expectedType} file`);
      return;
    }

    const nextItems = [...currentItems, ...items];
    setSelectedAttachment({
      items: nextItems,
      file: nextItems[0].file,
      fileType: nextItems.length > 1 ? 'album' : nextItems[0].fileType
    });
    setAttachmentPreview(nextItems.length === 1 ? nextItems[0].previewUrl : null);
  };

  const handleAttachmentSelect = (event, expectedType = null) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    addAttachmentFiles(selectedFiles, expectedType);
  };

  const openMediaLibrary = (filter = 'all') => {
    if (isNativeMediaLibraryAvailable()) {
      setMediaLibraryFilter(filter);
      setMediaLibraryOpen(true);
      return;
    }

    if (filter === 'video') videoInputRef.current?.click();
    else fileInputRef.current?.click();
  };

  const handleNativeMediaSelect = async (assets = []) => {
    if (!assets.length) return;

    const currentItems = getSelectedAttachmentItems(selectedAttachment);
    const availableSlots = Math.max(0, MAX_MESSAGE_MEDIA_SELECTION - currentItems.length);
    if (availableSlots <= 0) {
      toast.error(`You can send up to ${MAX_MESSAGE_MEDIA_SELECTION} photos or videos at once`);
      return;
    }

    const selectedAssets = assets.slice(0, availableSlots);
    const loadingToast = toast.loading('Preparing selected media...');
    try {
      const files = [];
      for (const asset of selectedAssets) {
        files.push(await nativeMediaAssetToFile(asset));
      }
      addAttachmentFiles(files);
      toast.success('Media added to composer', { id: loadingToast });
    } catch (err) {
      toast.error(err?.message || 'Could not prepare selected media', { id: loadingToast });
    }
  };

  const startRecording = async () => {
    if (!selectedUser || recording || sending) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Voice recording is not supported in this browser');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = getPreferredAudioMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recordingCancelledRef.current = false;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const mimeType = recorder.mimeType || preferredMimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];
        setRecording(false);
        clearInterval(recordingTimerRef.current);
        setRecordingSeconds(0);

        if (blob.size === 0 || recordingCancelledRef.current) return;

        const voiceFile = new File([blob], `voice-${Date.now()}.${getAudioFileExtension(mimeType)}`, { type: mimeType });
        await sendMessage({ file: voiceFile, fileType: 'audio' });
      };

      recorder.start();
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(seconds => seconds + 1);
      }, 1000);
    } catch (err) {
      console.error(err);
      toast.error('Microphone permission was not granted');
    }
  };

  const stopRecording = () => {
    recordingCancelledRef.current = false;
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleRemoveForMe = async (messageId) => {
    if (!window.confirm('Remove this message for you?')) return;

    try {
      await api.delete(`/messages/${messageId}/me`);
      setMessages(prev => prev.filter(message => getEntityId(message) !== messageId));
      setActionMenuMessageId(null);
      fetchConversations();
      toast.success('Removed for you');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to remove message');
    }
  };

  const handleUnsendForEveryone = async (messageId) => {
    if (!window.confirm('Unsend this message for everyone?')) return;

    try {
      const res = await api.delete(`/messages/${messageId}/everyone`);
      setMessages(prev => prev.map(message => getEntityId(message) === messageId ? res.data : message));
      setActionMenuMessageId(null);
      fetchConversations();
      toast.success('Message unsent');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to unsend message');
    }
  };

  const getForwardedMessageText = (message) => {
    const snippet = getMessageSnippet(message).trim();
    if (!snippet) return 'Forwarded message';
    return snippet.startsWith('Forwarded:') ? snippet : `Forwarded: ${snippet}`;
  };

  const handleCopyMessage = async (message) => {
    const text = getMessageSnippet(message).trim();
    if (!text) {
      toast.error('Nothing to copy');
      return;
    }

    try {
      await navigator.clipboard?.writeText(text);
      toast.success('Message copied');
    } catch {
      toast.error('Copy is not available on this device');
    } finally {
      setActionMenuMessageId(null);
    }
  };

  const handleForwardMessage = (message) => {
    setForwardingMessage(message);
    setActionMenuMessageId(null);
    setEmojiPickerMessageId(null);
    setShowModal(true);
  };

  const handleReplyFromMenu = (message) => {
    setReplyingTo(message);
    setActionMenuMessageId(null);
    setEmojiPickerMessageId(null);
    focusComposerInput();
  };

  const handleDeleteConversation = async () => {
    const selectedId = getEntityId(selectedUser);
    if (!selectedId) return;
    if (!window.confirm(`Delete conversation with ${selectedDisplayName}? This only removes it for you.`)) return;

    try {
      await api.delete(`/messages/conversation/${selectedId}`);
      setMessages([]);
      setSelectedUser(null);
      await fetchConversations();
      toast.success('Conversation deleted');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to delete conversation');
    }
  };

  const handlePin = async (messageId) => {
    try {
      const res = await api.put(`/messages/${messageId}/pin`);
      setMessages(prev => prev.map(message => getEntityId(message) === messageId ? res.data : message));
      setShowPinnedPanel(false);
      toast.success(res.data.pinned ? 'Pinned' : 'Unpinned');
    } catch (err) {
      toast.error('Failed to pin');
    }
  };

  const triggerMessageReactionBurst = (messageId, emoji) => {
    if (!messageId || !emoji) return;
    setMessageReactionBursts(prev => ({ ...prev, [messageId]: emoji }));
    window.setTimeout(() => {
      setMessageReactionBursts(prev => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    }, 720);
  };

  const handleReaction = async (messageId, emoji) => {
    try {
      triggerMessageReactionBurst(messageId, emoji);
      const res = await api.post(`/messages/${messageId}/react`, { emoji });
      setMessages(prev => prev.map(message => getEntityId(message) === messageId ? res.data : message));
      setEmojiPickerMessageId(null);
      setActionMenuMessageId(null);
      setReactionViewerMessageId(null);
    } catch (err) {
      toast.error('Failed to add reaction');
    }
  };

  const handleRemoveReaction = async (messageId, emoji) => {
    try {
      const res = await api.post(`/messages/${messageId}/react`, { emoji });
      setMessages(prev => prev.map(message => getEntityId(message) === messageId ? res.data : message));
    } catch (err) {
      console.error(err);
    }
  };

  const openReactionViewer = (messageId) => {
    if (!messageId) return;
    setEmojiPickerMessageId(null);
    setActionMenuMessageId(null);
    setReactionViewerMessageId(messageId);
  };

  const isTouchReactionMode = () => (
    typeof window !== 'undefined'
    && window.matchMedia?.('(pointer: coarse)').matches
  );

  const clearReactionPressTimer = () => {
    if (reactionPressTimerRef.current) {
      clearTimeout(reactionPressTimerRef.current);
      reactionPressTimerRef.current = null;
    }
  };

  const startMessageOptionsPress = (message, delay = 430) => {
    if (!message || message.unsent || message.system) return;
    clearReactionPressTimer();
    reactionPressTimerRef.current = setTimeout(() => {
      setActionMenuMessageId(null);
      setEmojiPickerMessageId(getEntityId(message));
      playUiSound('click', 0.1);
      navigator.vibrate?.(10);
    }, delay);
  };

  const startSwipeMessageAction = (event, message) => {
    if (!isTouchReactionMode() || message?.unsent || message?.system) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    swipeMessageActionRef.current = {
      message,
      startX: touch.clientX,
      startY: touch.clientY,
      axis: '',
      completed: false
    };
  };

  const moveSwipeMessageAction = (event) => {
    const gesture = swipeMessageActionRef.current;
    if (!gesture || gesture.completed) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!gesture.axis && (absX > 12 || absY > 12)) {
      gesture.axis = absX > absY * 1.35 ? 'x' : 'y';
    }

    if (gesture.axis !== 'x' || absX < 78) return;
    gesture.completed = true;
    clearReactionPressTimer();

    if (dx > 0) {
      setActionMenuMessageId(null);
      setEmojiPickerMessageId(null);
      setReplyingTo(gesture.message);
      focusComposerInput();
    } else {
      const messageId = getEntityId(gesture.message);
      setReplyingTo(null);
      setEmojiPickerMessageId(null);
      setActionMenuMessageId(messageId);
    }

    playUiSound('click', 0.12);
    navigator.vibrate?.(12);
  };

  const clearSwipeMessageAction = () => {
    swipeMessageActionRef.current = null;
  };

  const jumpToMessage = (messageId) => {
    const id = getEntityId(messageId);
    if (!id) return;
    const targetIndex = messages.findIndex(message => getEntityId(message) === id);
    if (targetIndex >= 0) {
      setVisibleMessageCount(count => Math.max(count, messages.length - targetIndex));
    }
    setFocusedMessageId(id);
    setShowPinnedPanel(false);
    window.setTimeout(() => {
      messageRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    setTimeout(() => setFocusedMessageId(null), 1800);
  };

  const formatMessageTime = (date) => {
    if (!date) return '';
    const msgDate = new Date(date);
    if (Number.isNaN(msgDate.getTime())) return '';
    const now = new Date();
    const diffMins = Math.floor((now - msgDate) / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return format(msgDate, 'h:mm a');
    return formatDistanceToNow(msgDate, { addSuffix: true });
  };

  const getMessageDateKey = (date) => {
    const msgDate = new Date(date);
    if (Number.isNaN(msgDate.getTime())) return '';
    return format(msgDate, 'yyyy-MM-dd');
  };

  const formatMessageDateLabel = (date) => {
    const msgDate = new Date(date);
    if (Number.isNaN(msgDate.getTime())) return '';
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = format(yesterday, 'yyyy-MM-dd');
    const messageKey = format(msgDate, 'yyyy-MM-dd');

    if (messageKey === todayKey) return 'Today';
    if (messageKey === yesterdayKey) return 'Yesterday';
    return format(msgDate, 'MMM d, yyyy');
  };

  const getUserAvatar = (userData) => {
    if (userData?.avatar && userData.avatar !== '') {
      return resolveMediaUrl(userData.avatar);
    }

    return null;
  };

  const getConversationPresenceMeta = (person) => {
    const personId = getEntityId(person);
    const isOnline = personId ? onlineUsers.has(personId) : false;
    if (isOnline) {
      return {
        label: 'Active now',
        title: 'Active now',
        online: true
      };
    }

    const lastSeen = personId ? lastSeenByUser[personId] || person?.lastSeen : person?.lastSeen;
    if (!lastSeen) {
      return {
        label: '',
        title: 'Offline',
        online: false
      };
    }

    const lastSeenDate = new Date(lastSeen);
    if (Number.isNaN(lastSeenDate.getTime())) {
      return {
        label: '',
        title: 'Offline',
        online: false
      };
    }

    const diffMins = Math.max(0, Math.floor((Date.now() - lastSeenDate.getTime()) / 60000));
    const label = diffMins < 1
      ? 'Now'
      : diffMins < 60
        ? `${diffMins}m ago`
        : diffMins < 1440
          ? `${Math.floor(diffMins / 60)}h ago`
          : diffMins < 43200
            ? `${Math.floor(diffMins / 1440)}d ago`
            : format(lastSeenDate, 'MMM d');

    return {
      label,
      title: `Active ${formatDistanceToNow(lastSeenDate, { addSuffix: true })}`,
      online: false
    };
  };

  const latestOwnMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (getEntityId(message.from) === currentUserId) return getEntityId(message);
    }
    return '';
  }, [currentUserId, messages]);

  const pinnedMessages = useMemo(() => (
    messages
      .filter(message => message.pinned && !message.unsent && !message.system)
      .sort((a, b) => (
        new Date(b.updatedAt || b.createdAt || 0).getTime()
        - new Date(a.updatedAt || a.createdAt || 0).getTime()
      ))
  ), [messages]);
  const primaryPinnedMessage = pinnedMessages[0] || null;
  const activeActionMessage = useMemo(() => (
    actionMenuMessageId
      ? messages.find(message => getEntityId(message) === actionMenuMessageId) || null
      : null
  ), [actionMenuMessageId, messages]);
  const activeReactionMessage = useMemo(() => (
    emojiPickerMessageId
      ? messages.find(message => getEntityId(message) === emojiPickerMessageId) || null
      : null
  ), [emojiPickerMessageId, messages]);
  const reactionViewerMessage = useMemo(() => (
    reactionViewerMessageId
      ? messages.find(message => getEntityId(message) === reactionViewerMessageId) || null
      : null
  ), [reactionViewerMessageId, messages]);

  const scrollToPinnedMessage = (messageId) => {
    jumpToMessage(messageId);
  };

  const unreadTotal = useMemo(
    () => conversations.reduce((total, conversation) => total + (conversation.unreadCount || 0), 0),
    [conversations]
  );

  const filteredConversations = useMemo(() => {
    const query = deferredConversationSearch.trim().toLowerCase();

    return conversations.filter(({ user: conversationUser, lastMessage, unreadCount }) => {
      const conversationId = getEntityId(conversationUser);
      const isMessageRequest = acceptedFriendIds instanceof Set && !acceptedFriendIds.has(conversationId);
      const isMutedConversation = mutedConversationIds.has(conversationId);
      if (conversationFilter === 'unread' && !unreadCount) return false;
      if (conversationFilter === 'favorites' && !favoriteConversationIds.has(conversationId)) return false;
      if (conversationFilter === 'muted' && !isMutedConversation) return false;
      if (conversationFilter === 'pinned' && !pinnedConversationIds.has(conversationId)) return false;
      if (conversationFilter === 'requests' && !isMessageRequest) return false;
      if (conversationFilter === 'primary' && (isMessageRequest || isMutedConversation)) return false;
      if (conversationFilter !== 'requests' && isMessageRequest && conversationFilter === 'all') return true;
      if (!query) return true;

      return (
        conversationUser?.name?.toLowerCase().includes(query) ||
        conversationUser?.email?.toLowerCase().includes(query) ||
        lastMessage?.toLowerCase().includes(query)
      );
    }).sort((a, b) => {
      const aPinned = pinnedConversationIds.has(getEntityId(a.user));
      const bPinned = pinnedConversationIds.has(getEntityId(b.user));
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return new Date(b.lastTime || 0) - new Date(a.lastTime || 0);
    });
  }, [acceptedFriendIds, conversationFilter, conversations, deferredConversationSearch, favoriteConversationIds, mutedConversationIds, pinnedConversationIds]);

  const filteredGroups = useMemo(() => {
    if (!['all', 'primary'].includes(conversationFilter)) return [];
    const query = deferredConversationSearch.trim().toLowerCase();
    return groups
      .filter(group => {
        if (!query) return true;
        return [
          group?.name,
          group?.description,
          group?.subject,
          group?.joinCode
        ].some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  }, [conversationFilter, deferredConversationSearch, groups]);

  const renderHighlightedText = (value = '', className = '') => {
    const text = String(value || '');
    const query = deferredConversationSearch.trim();
    if (!query) return <span className={className}>{text}</span>;
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index < 0) return <span className={className}>{text}</span>;
    return (
      <span className={className}>
        {text.slice(0, index)}
        <mark className="rounded bg-yellow-200 px-0.5 text-slate-950 dark:bg-yellow-400/30 dark:text-yellow-100">
          {text.slice(index, index + query.length)}
        </mark>
        {text.slice(index + query.length)}
      </span>
    );
  };

  const measureConversationViewport = useCallback(() => {
    const nextHeight = conversationListRef.current?.clientHeight || 0;
    setConversationListViewportHeight(prev => (prev === nextHeight ? prev : nextHeight));
  }, []);

  const handleConversationListScroll = useCallback((event) => {
    pendingConversationScrollTopRef.current = event.currentTarget.scrollTop || 0;
    if (conversationScrollFrameRef.current) return;

    conversationScrollFrameRef.current = requestAnimationFrame(() => {
      conversationScrollFrameRef.current = null;
      const nextScrollTop = pendingConversationScrollTopRef.current;
      setConversationListScrollTop(prev => (prev === nextScrollTop ? prev : nextScrollTop));
    });
  }, []);

  useEffect(() => {
    measureConversationViewport();
  }, [filteredConversations.length, measureConversationViewport]);

  useEffect(() => {
    setConversationListScrollTop(0);
    if (conversationListRef.current) conversationListRef.current.scrollTop = 0;
  }, [conversationFilter, deferredConversationSearch]);

  useEffect(() => {
    window.addEventListener('resize', measureConversationViewport);
    return () => window.removeEventListener('resize', measureConversationViewport);
  }, [measureConversationViewport]);

  useEffect(() => () => {
    if (conversationScrollFrameRef.current) cancelAnimationFrame(conversationScrollFrameRef.current);
  }, []);

  const virtualizedConversationState = useMemo(() => {
    const total = filteredConversations.length;
    const canVirtualize = total > 30 && conversationListViewportHeight > 0;
    if (!canVirtualize) {
      return {
        enabled: false,
        startIndex: 0,
        items: filteredConversations,
        paddingTop: 0,
        paddingBottom: 0
      };
    }

    const visibleRows = Math.ceil(conversationListViewportHeight / CONVERSATION_ROW_HEIGHT);
    const startIndex = Math.max(0, Math.floor(conversationListScrollTop / CONVERSATION_ROW_HEIGHT) - CONVERSATION_VIRTUAL_OVERSCAN);
    const endIndex = Math.min(
      total,
      startIndex + visibleRows + (CONVERSATION_VIRTUAL_OVERSCAN * 2)
    );
    const items = filteredConversations.slice(startIndex, endIndex);
    const paddingTop = startIndex * CONVERSATION_ROW_HEIGHT;
    const paddingBottom = Math.max(0, (total - endIndex) * CONVERSATION_ROW_HEIGHT);

    return {
      enabled: true,
      startIndex,
      items,
      paddingTop,
      paddingBottom
    };
  }, [conversationListScrollTop, conversationListViewportHeight, filteredConversations]);

  const selectedIsOnline = selectedUserId ? onlineUsers.has(selectedUserId) : false;
  const selectedIsFavorite = selectedUserId ? favoriteConversationIds.has(selectedUserId) : false;
  const selectedIsMuted = selectedUserId ? mutedConversationIds.has(selectedUserId) : false;
  const selectedIsPinned = selectedUserId ? pinnedConversationIds.has(selectedUserId) : false;
  const selectedNickname = selectedUserId ? conversationNicknames[selectedUserId] || '' : '';
  const selectedDisplayName = selectedNickname || selectedUser?.name || 'User';

  useEffect(() => {
    setNicknameDraft(selectedNickname);
  }, [selectedNickname, selectedUserId]);

  const saveConversationNickname = useCallback(async (event) => {
    event?.preventDefault?.();
    const id = getEntityId(selectedUser);
    if (!id || savingNickname) return;

    const nickname = nicknameDraft.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (nickname === selectedNickname) return;

    setSavingNickname(true);
    try {
      const res = await api.put(`/messages/${id}/nickname`, { nickname });
      const nextNickname = String(res.data?.conversation?.nicknames?.[id] || '').trim();
      cacheConversationNickname(id, nextNickname);
      setNicknameDraft(nextNickname);
      setConversations(prev => prev.map(conversation => (
        getEntityId(conversation.user) === id
          ? {
              ...conversation,
              conversation: {
                ...(conversation.conversation || {}),
                nicknames: (() => {
                  const nextNicknames = { ...(conversation.conversation?.nicknames || {}) };
                  if (nextNickname) nextNicknames[id] = nextNickname;
                  else delete nextNicknames[id];
                  return nextNicknames;
                })()
              }
            }
          : conversation
      )));
      if (res.data?.message && getEntityId(selectedUserRef.current) === id) {
        const systemMessage = res.data.message;
        setMessages(prev => (
          prev.some(message => getEntityId(message) === getEntityId(systemMessage))
            ? prev
            : [...prev, systemMessage]
        ));
      }
      fetchConversations();
      toast.success(nextNickname ? 'Nickname saved' : 'Nickname cleared');
    } catch (err) {
      toast.error(err?.response?.data?.msg || 'Could not save nickname');
    } finally {
      setSavingNickname(false);
    }
  }, [
    cacheConversationNickname,
    fetchConversations,
    nicknameDraft,
    savingNickname,
    selectedNickname,
    selectedUser
  ]);

  const selectedThemeKey = selectedUserId ? conversationThemes[selectedUserId] || 'default' : 'default';
  const selectedTheme = CHAT_THEMES[selectedThemeKey] || CHAT_THEMES.default;
  const selectedBackgroundKey = selectedUserId
    ? normalizeChatBackgroundKey(conversationBackgrounds[selectedUserId])
    : DEFAULT_CHAT_BACKGROUND_ID;
  const selectedBackground = getChatBackground(selectedBackgroundKey);
  const selectedBackgroundStyle = selectedBackground?.image
    ? { '--chat-background-image': `url("${selectedBackground.image}")` }
    : undefined;
  const selectedGroupBackgroundKey = normalizeChatBackgroundKey(selectedGroup?.backgroundId);
  const selectedGroupBackground = getChatBackground(selectedGroupBackgroundKey);
  const selectedGroupBackgroundStyle = selectedGroupBackground?.image
    ? { '--chat-background-image': `url("${selectedGroupBackground.image}")` }
    : undefined;
  const selectedGroupMembersList = selectedGroup?.members || [];
  const canManageSelectedGroup = Boolean(
    selectedGroupId
    && (
      getEntityId(selectedGroup?.creator) === currentUserId
      || (selectedGroup?.coCreators || []).some(member => getEntityId(member) === currentUserId)
    )
  );
  const selectedLastSeen = selectedUserId ? lastSeenByUser[selectedUserId] || selectedUser?.lastSeen : null;
  const callIsActive = callState !== 'idle';
  const callPartnerName = getDisplayName(callPartner, selectedDisplayName);
  const canStartCall = Boolean(selectedUserId && currentUserId && socketConnected && selectedIsOnline && !sharedCallIsActive && canStartSharedCallWith(selectedUser));
  const selectedConversationCallHistory = useMemo(() => (
    sharedCallHistory
      .filter(entry => getEntityId(entry.partnerId || entry.partner) === selectedUserId)
  ), [selectedUserId, sharedCallHistory]);
  const selectedCallHistory = useMemo(() => (
    selectedConversationCallHistory
      .slice(0, 5)
  ), [selectedConversationCallHistory]);
  const callDurationText = callStartedAt ? formatCallDuration(Math.floor((callClock - callStartedAt) / 1000)) : '';
  const selectedAttachmentItems = getSelectedAttachmentItems(selectedAttachment);
  const canAddMoreMedia = selectedAttachmentItems.length > 0 && selectedAttachmentItems.length < MAX_MESSAGE_MEDIA_SELECTION && !sending && !recording && !editingMessage;
  const updateAttachmentItem = useCallback((itemId, changes) => {
    setSelectedAttachment(prev => {
      const items = getSelectedAttachmentItems(prev);
      if (!items.length) return prev;
      const nextItems = items.map(item => (
        item.id === itemId
          ? { ...item, edit: { ...getDefaultMediaEdit(), ...(item.edit || {}), ...changes } }
          : item
      ));
      return {
        ...prev,
        items: nextItems,
        file: nextItems[0].file,
        fileType: nextItems.length > 1 ? 'album' : nextItems[0].fileType
      };
    });
  }, []);
  const removeAttachmentItem = useCallback((itemId) => {
    const itemToRemove = selectedAttachmentItems.find(item => item.id === itemId);
    if (itemToRemove?.previewUrl) URL.revokeObjectURL(itemToRemove.previewUrl);
    const nextItems = selectedAttachmentItems.filter(item => item.id !== itemId);
    if (!nextItems.length) {
      setSelectedAttachment(null);
      resetUploadProgress();
      return;
    }
    setSelectedAttachment(prev => ({
      ...prev,
      items: nextItems,
      file: nextItems[0].file,
      fileType: nextItems.length > 1 ? 'album' : nextItems[0].fileType
    }));
  }, [resetUploadProgress, selectedAttachmentItems]);
  const chatStreakCount = chatStreak?.currentStreak || 0;
  const chatStreakText = chatStreakCount > 0
    ? `${chatStreakCount} day${chatStreakCount === 1 ? '' : 's'}`
    : 'Start streak';
  const callStatusText = callState === 'incoming'
    ? `${callMode === 'video' ? 'Video' : 'Audio'} call`
    : callState === 'calling'
      ? 'Ringing...'
      : callState === 'connecting'
        ? 'Connecting...'
        : callState === 'connected'
          ? callDurationText || 'Connected'
          : callError || '';
  const isLiveKitCall = callProvider === 'livekit';
  const callNetworkHint = isLiveKitCall
    ? callIceStatus.retrying && ['calling', 'connecting', 'connected'].includes(callState)
      ? callIceStatus.turnError || 'Reconnecting through LiveKit...'
      : ['calling', 'connecting'].includes(callState)
        ? 'LiveKit cloud room is connecting for stronger mobile calls.'
        : ''
    : !callRelayReady && ['calling', 'connecting'].includes(callState)
      ? 'TURN relay is not configured yet. Calls may only connect on some networks.'
      : callIceStatus.retrying && ['calling', 'connecting'].includes(callState)
        ? callIceStatus.turnError || 'Refreshing relay route...'
      : callIceStatus.turnError && ['calling', 'connecting'].includes(callState) && !callIceStatus.relayCandidate
        ? callIceStatus.turnError
      : callRelayReady && ['calling', 'connecting'].includes(callState)
        ? callIceStatus.relayCandidate
          ? 'TURN relay candidate found for cross-network call.'
          : 'TURN relay is configured. Waiting for relay candidate...'
        : callRelayReady && callState === 'connected'
          ? callIceStatus.relayCandidate
            ? 'Connected with relay available for cross-network stability.'
            : 'Connected. Relay fallback remains available if the route changes.'
      : '';
  const callQualityPills = isLiveKitCall
    ? [
        'LiveKit cloud route',
        localStreamReady ? (callMode === 'video' ? 'Camera/mic ready' : 'Mic ready') : 'Waiting for permission',
        remoteStreamReady ? 'Remote media live' : callState === 'incoming' ? 'Incoming request' : 'Waiting for remote',
        callIceStatus.retrying ? 'Reconnecting' : callIceStatus.lastCandidateType ? `Route: ${callIceStatus.lastCandidateType}` : ''
      ].filter(Boolean)
    : [
        callRelayReady ? (callIceStatus.relayOnly ? 'Relay-only route' : callIceStatus.relayCandidate ? 'Relay candidate found' : callIceStatus.retrying ? 'Relay retrying' : 'TURN relay ready') : 'Direct network mode',
        localStreamReady ? (callMode === 'video' ? 'Camera/mic ready' : 'Mic ready') : 'Waiting for permission',
        remoteStreamReady ? 'Remote media live' : callState === 'incoming' ? 'Incoming request' : 'Waiting for remote',
        callIceStatus.lastCandidateType ? `ICE: ${callIceStatus.lastCandidateType}` : ''
      ].filter(Boolean);
  const offlineText = selectedLastSeen
    ? `Offline ${formatDistanceToNow(new Date(selectedLastSeen), { addSuffix: true })}`
    : 'Offline';
  const presenceText = !socketConnected
    ? 'Reconnecting...'
    : !presenceReady
      ? 'Checking status...'
      : selectedIsOnline
        ? 'Active now'
        : offlineText;

  const requestConversationCount = useMemo(() => {
    if (!(acceptedFriendIds instanceof Set)) return 0;
    return conversations.filter(conversation => !acceptedFriendIds.has(getEntityId(conversation.user))).length;
  }, [acceptedFriendIds, conversations]);
  const primaryConversationCount = useMemo(() => {
    if (!(acceptedFriendIds instanceof Set)) return conversations.length;
    return conversations.filter(conversation => {
      const conversationId = getEntityId(conversation.user);
      return acceptedFriendIds.has(conversationId) && !mutedConversationIds.has(conversationId);
    }).length;
  }, [acceptedFriendIds, conversations, mutedConversationIds]);
  const totalConversationCount = conversations.length + groups.length;

  const conversationFilters = useMemo(() => ([
    { id: 'all', label: 'All', count: totalConversationCount },
    { id: 'requests', label: 'Requests', count: requestConversationCount },
    { id: 'pinned', label: 'Pinned', count: pinnedConversationIds.size },
    { id: 'unread', label: 'Unread', count: unreadTotal },
    { id: 'favorites', label: 'Favorites', count: favoriteConversationIds.size },
    { id: 'muted', label: 'Muted', count: mutedConversationIds.size }
  ]), [favoriteConversationIds.size, mutedConversationIds.size, pinnedConversationIds.size, requestConversationCount, totalConversationCount, unreadTotal]);
  const mobileConversationFilters = useMemo(() => ([
    { id: 'all', label: 'All', count: totalConversationCount },
    { id: 'primary', label: 'Primary', count: primaryConversationCount + groups.length },
    { id: 'muted', label: 'Muted', count: mutedConversationIds.size },
    { id: 'pinned', label: 'Pinned', count: pinnedConversationIds.size },
    { id: 'requests', label: 'Requests', count: requestConversationCount }
  ]), [groups.length, mutedConversationIds.size, pinnedConversationIds.size, primaryConversationCount, requestConversationCount, totalConversationCount]);
  const storyGroupByOwner = useMemo(() => (
    new Map((storyGroups || [])
      .map(group => [getEntityId(group.owner || group.ownerId), group])
      .filter(([id]) => id))
  ), [storyGroups]);
  const selectedStoryGroup = selectedUserId ? storyGroupByOwner.get(selectedUserId) : null;
  const selectedHasStory = Boolean(selectedStoryGroup);
  const selectedStoryViewed = isStoryGroupViewed(selectedStoryGroup, currentUserId);
  const activeStoryList = useMemo(() => (
    getStoryListForActiveStory(storyGroups, activeStory)
  ), [activeStory, storyGroups]);
  const noteTrayItems = useMemo(() => {
    const items = [];

    if (user) {
      const myStoryGroup = storyGroupByOwner.get(currentUserId);
      items.push({
        id: 'me',
        person: user,
        note: myNote,
        storyGroup: myStoryGroup,
        storyViewed: isStoryGroupViewed(myStoryGroup, currentUserId),
        text: myNote?.text || (myStoryGroup ? 'My Day' : 'Create note'),
        isMe: true,
        hasNote: Boolean(myNote?.text),
        hasStory: Boolean(myStoryGroup)
      });
    }

    Object.values(userNotes)
      .filter(note => getEntityId(note.userId) && getEntityId(note.userId) !== currentUserId)
      .slice(0, 12)
      .forEach(note => {
        items.push({
          id: getEntityId(note.userId),
          person: note.userId,
          note,
          storyGroup: storyGroupByOwner.get(getEntityId(note.userId)),
          storyViewed: isStoryGroupViewed(storyGroupByOwner.get(getEntityId(note.userId)), currentUserId),
          text: note.text,
          isMe: false,
          hasNote: true,
          hasStory: storyGroupByOwner.has(getEntityId(note.userId))
        });
      });

    (storyGroups || []).forEach(group => {
      const ownerId = getEntityId(group.owner || group.ownerId);
      if (!ownerId || ownerId === currentUserId) return;
      if (items.some(item => item.id === ownerId)) return;
      items.push({
        id: ownerId,
        person: group.owner,
        note: null,
        storyGroup: group,
        storyViewed: isStoryGroupViewed(group, currentUserId),
        text: 'My Day',
        isMe: false,
        hasNote: false,
        hasStory: true
      });
    });

    return items;
  }, [currentUserId, myNote, storyGroupByOwner, storyGroups, user, userNotes]);

  const messageSearchMatches = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();
    if (!query) return [];
    return messages
      .filter(message => !message.unsent && getMessageSnippet(message).toLowerCase().includes(query))
      .map(message => getEntityId(message))
      .filter(Boolean);
  }, [messageSearch, messages]);
  const messageSearchMatchSet = useMemo(() => new Set(messageSearchMatches), [messageSearchMatches]);

  useEffect(() => {
    setMessageSearchIndex(0);
  }, [messageSearch, selectedUserId]);

  useEffect(() => {
    setShowChatDetails(false);
    setVisibleMessageCount(getMessageRenderBatch());
  }, [selectedUserId]);

  const goToSearchMatch = (direction = 0) => {
    if (!messageSearchMatches.length) return;
    const nextIndex = direction === 0
      ? messageSearchIndex
      : (messageSearchIndex + direction + messageSearchMatches.length) % messageSearchMatches.length;
    setMessageSearchIndex(nextIndex);
    jumpToMessage(messageSearchMatches[nextIndex]);
  };

  const mediaGalleryItems = useMemo(() => (
    messages
      .filter(message => !message.unsent)
      .flatMap(message => {
        const messageId = getEntityId(message);
        const senderName = getEntityId(message.from) === currentUserId
          ? 'You'
          : getDisplayName(message.from, selectedDisplayName);
        const sentTime = message.createdAt ? formatMessageTime(message.createdAt) : '';

        return getMessageAttachments(message)
          .map((attachment, index) => ({ attachment, index }))
          .filter(item => ['image', 'video'].includes(item.attachment.fileType))
          .map(({ attachment, index }) => {
            const mediaTypeLabel = attachment.fileType === 'image' ? 'Photo' : 'Video';
            return {
              id: `${messageId}-${index}`,
              messageId,
              attachmentIndex: index,
              type: attachment.fileType,
              url: resolveMediaUrl(attachment.fileUrl),
              name: attachment.fileName || mediaTypeLabel,
              details: [senderName, sentTime].filter(Boolean).join(' - ')
            };
          });
      })
  ), [currentUserId, messages, selectedDisplayName]);

  const mediaPreviewIndex = mediaPreview
    ? mediaGalleryItems.findIndex(item => item.id === mediaPreview.id)
    : -1;
  const currentMediaPreview = mediaPreviewIndex >= 0 ? mediaGalleryItems[mediaPreviewIndex] : mediaPreview;
  const hasMediaNavigation = mediaPreviewIndex >= 0 && mediaGalleryItems.length > 1;
  const mediaPositionLabel = currentMediaPreview
    ? [
        mediaPreviewIndex >= 0 ? `${mediaPreviewIndex + 1} of ${mediaGalleryItems.length}` : '',
        currentMediaPreview.details
      ].filter(Boolean).join(' - ')
    : '';

  const openMediaPreview = (message, attachmentIndex = 0) => {
    const messageId = getEntityId(message);
    const galleryItem = mediaGalleryItems.find(item => item.messageId === messageId && item.attachmentIndex === attachmentIndex);
    if (galleryItem) {
      setMediaPreview(galleryItem);
      return;
    }

    const attachment = getMessageAttachments(message)[attachmentIndex] || getMessageAttachments(message)[0] || message;
    const mediaTypeLabel = attachment.fileType === 'image' ? 'Photo' : 'Video';
    setMediaPreview({
      id: `${messageId}-${attachmentIndex}`,
      messageId,
      attachmentIndex,
      type: attachment.fileType,
      url: resolveMediaUrl(attachment.fileUrl),
      name: attachment.fileName || mediaTypeLabel,
      details: mediaTypeLabel
    });
  };

  const moveMediaPreview = (direction) => {
    if (!hasMediaNavigation) return;
    const nextIndex = (mediaPreviewIndex + direction + mediaGalleryItems.length) % mediaGalleryItems.length;
    setMediaPreview(mediaGalleryItems[nextIndex]);
  };

  const sharedMediaItems = useMemo(() => (
    messages
      .filter(message => !message.unsent && getMessageAttachments(message).some(attachment => ['image', 'video'].includes(attachment.fileType)))
      .reverse()
  ), [messages]);

  useEffect(() => {
    if (!hasMediaNavigation || !shouldPreloadAdjacentMedia()) return;

    [-1, 1].forEach(direction => {
      const item = mediaGalleryItems[(mediaPreviewIndex + direction + mediaGalleryItems.length) % mediaGalleryItems.length];
      if (item?.type === 'image') {
        const image = new window.Image();
        image.src = item.url;
      }
    });
  }, [hasMediaNavigation, mediaGalleryItems, mediaPreviewIndex]);

  const sharedFileItems = useMemo(() => (
    messages
      .filter(message => !message.unsent)
      .flatMap(message => {
        const messageId = getEntityId(message);
        return getMessageAttachments(message)
          .map((attachment, index) => ({ attachment, index }))
          .filter(item => !['image', 'video'].includes(item.attachment.fileType))
          .map(({ attachment, index }) => ({
            id: `${messageId}-file-${index}`,
            fileUrl: attachment.fileUrl,
            fileType: attachment.fileType,
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            createdAt: message.createdAt
          }));
      })
      .slice(-8)
      .reverse()
  ), [messages]);

  const messageWindowingEnabled = !messageSearch && !focusedMessageId && !showPinnedPanel;
  const renderedMessages = useMemo(() => {
    if (!messageWindowingEnabled || messages.length <= visibleMessageCount) return messages;
    return messages.slice(-visibleMessageCount);
  }, [messageWindowingEnabled, messages, visibleMessageCount]);
  const hiddenLocalMessageCount = messageWindowingEnabled ? Math.max(0, messages.length - renderedMessages.length) : 0;
  const renderedTimelineItems = useMemo(() => {
    const messageItems = renderedMessages.map((message, index) => ({
      id: `message-${getStableMessageKey(message, index)}`,
      type: 'message',
      timestamp: new Date(message.createdAt || 0).getTime() || 0,
      message
    }));
    const oldestRenderedMessageTime = renderedMessages.length
      ? (new Date(renderedMessages[0].createdAt || 0).getTime() || 0)
      : 0;
    const callItems = selectedConversationCallHistory
      .map(entry => ({
        id: `call-${entry.id || entry.callId || entry.endedAt || entry.startedAt}`,
        type: 'call',
        timestamp: new Date(entry.endedAt || entry.startedAt || 0).getTime() || 0,
        entry
      }))
      .filter(item => !oldestRenderedMessageTime || item.timestamp >= oldestRenderedMessageTime);

    const sortedItems = [...messageItems, ...callItems].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      if (a.type === b.type) return 0;
      return a.type === 'call' ? 1 : -1;
    });

    const timeline = [];
    let previousDateKey = '';
    sortedItems.forEach(timelineItem => {
      const dateKey = getMessageDateKey(timelineItem.timestamp);
      if (dateKey && dateKey !== previousDateKey) {
        timeline.push({
          id: `date-${dateKey}`,
          type: 'date',
          timestamp: timelineItem.timestamp,
          label: formatMessageDateLabel(timelineItem.timestamp)
        });
        previousDateKey = dateKey;
      }
      timeline.push(timelineItem);
    });
    return timeline;
  }, [renderedMessages, selectedConversationCallHistory]);
  const hiddenMessageCount = hiddenLocalMessageCount + (hasOlderMessages ? 1 : 0);
  const hiddenMessageStep = getMessageRenderBatch();

  useRenderDebug('Messages', () => ({
    selectedUserId,
    totalMessages: messages.length,
    renderedMessages: renderedMessages.length,
    timelineItems: renderedTimelineItems.length,
    mediaMessages: renderedMessages.filter(message => getMessageAttachments(message).length > 0).length,
    storyReplies: renderedMessages.filter(isMyDayReplyMessage).length,
    noteReplies: renderedMessages.filter(isNoteReplyMessage).length,
    sending
  }));

  useEffect(() => {
    if (!selectedUserId || !socket) return undefined;

    let cancelled = false;
    const updateStatus = (payload) => {
      const isOnline = typeof payload === 'object' ? payload.online : payload;
      const lastSeen = typeof payload === 'object' ? payload.lastSeen : null;
      setOnlineUsers(prev => {
        const next = new Set(prev);
        if (isOnline) next.add(selectedUserId);
        else next.delete(selectedUserId);
        return next;
      });
      if (lastSeen) {
        setLastSeenByUser(prev => ({ ...prev, [selectedUserId]: lastSeen }));
      }
      setPresenceReady(true);
    };

    socket.emit('check-online', selectedUserId, (isOnline) => {
      if (cancelled) return;
      updateStatus(isOnline);
    });

    api.get(`/presence/online/${selectedUserId}`)
      .then(res => {
        if (!cancelled) updateStatus({ online: !!res.data?.online, lastSeen: res.data?.lastSeen });
      })
      .catch(err => console.error('Presence status fallback failed', err));

    return () => {
      cancelled = true;
    };
  }, [selectedUserId]);

  const renderAvatar = (person, sizeClass = 'h-11 w-11', iconSize = 22) => {
    const avatar = getUserAvatar(person);

    return (
      <DeveloperAvatarFrame user={person}>
        <div className={`${sizeClass} relative overflow-hidden rounded-full bg-gradient-to-br from-[#1877f2] to-[#00b2ff] shadow-sm`}>
          {avatar ? (
            <img src={avatar} alt={getDisplayName(person)} loading="lazy" decoding="async" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white">
              <User size={iconSize} />
            </div>
          )}
        </div>
      </DeveloperAvatarFrame>
    );
  };

  const renderGroupAvatar = (group, sizeClass = 'h-12 w-12') => {
    const photoUrl = resolveMediaUrl(group?.photo);
    const groupMembers = group?.members || [];
    if (photoUrl) {
      return (
        <span className={`${sizeClass} flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 shadow-sm`}>
          <img src={photoUrl} alt={group?.name || 'Group'} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        </span>
      );
    }

    return (
      <span className={`${sizeClass} flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm`}>
        {groupMembers.length > 1 ? (
          <span className="flex -space-x-3">
            {groupMembers.slice(0, 3).map(member => (
              <span key={getEntityId(member)} className="rounded-full border-2 border-white/90">
                {renderAvatar(member, 'h-8 w-8', 14)}
              </span>
            ))}
          </span>
        ) : (
          <Users size={22} />
        )}
      </span>
    );
  };

  const getMessageSender = (message, isMe) => {
    const fromObject = message?.from && typeof message.from === 'object' ? message.from : null;
    if (isMe) {
      return {
        ...(user || {}),
        ...(fromObject || {}),
        isDeveloper: Boolean(fromObject?.isDeveloper ?? user?.isDeveloper)
      };
    }

    return {
      ...(selectedUser || {}),
      ...(fromObject || {}),
      isDeveloper: Boolean(fromObject?.isDeveloper ?? selectedUser?.isDeveloper)
    };
  };

  const renderMessageStatus = (message, isLatestOwn) => {
    if (getEntityId(message.from) !== currentUserId) return null;
    const seenAvatar = getUserAvatar(selectedUser);
    const seenDate = message.readAt ? new Date(message.readAt) : null;
    const seenTime = seenDate && !Number.isNaN(seenDate.getTime()) ? format(seenDate, 'h:mm a') : '';

    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${message.read ? 'text-sky-500' : 'text-gray-400'}`}>
        {message.read && isLatestOwn && seenAvatar ? (
          <img src={seenAvatar} alt={`${selectedDisplayName} seen`} className="h-4 w-4 rounded-full object-cover ring-1 ring-sky-300/70" />
        ) : (
          <CheckCheck size={13} />
        )}
        {isLatestOwn && (
          <span>{message.read ? `Seen${seenTime ? ` ${seenTime}` : ''}` : 'Delivered'}</span>
        )}
      </span>
    );
  };

  const renderReplyPreview = (message, isMe) => {
    if (!message.replyTo) return null;

    const replySenderId = getEntityId(message.replyTo.from);
    const replySender = replySenderId === currentUserId ? 'You' : getDisplayName(message.replyTo.from, selectedUser?.name || 'User');

    return (
      <button
        type="button"
        onClick={() => jumpToMessage(message.replyTo)}
        className={`mb-1 block w-full rounded-xl border-l-2 px-3 py-2 text-left text-xs ${
        isMe
          ? 'border-white/70 bg-white/15 text-white/90'
          : 'border-[#1877f2] bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
      }`}>
        <div className="font-semibold">{replySender}</div>
        <div className="line-clamp-2 opacity-80">{getMessageSnippet(message.replyTo)}</div>
      </button>
    );
  };

  const renderMessageAttachment = (message, isMe, isMyDayReply = false, loadEager = false) => {
    if (message.unsent) {
      return <p className="text-sm italic opacity-75">This message was unsent</p>;
    }

    const attachments = getMessageAttachments(message);
    const primaryAttachment = attachments[0] || message;
    const mediaUrl = primaryAttachment.fileType === 'image'
      ? resolveMediaVariantUrl(primaryAttachment, ['feed', 'large', 'thumb'])
      : resolveMediaUrl(primaryAttachment.fileUrl);

    if (attachments.length > 1) {
      const visibleAttachments = attachments.slice(0, 4);
      const extraCount = attachments.length - visibleAttachments.length;

      return (
        <div className="message-album-attachment relative overflow-hidden rounded-2xl bg-black/5 p-1 dark:bg-white/5">
          <div className={`grid gap-1 ${visibleAttachments.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {visibleAttachments.map((attachment, index) => {
              const isMedia = ['image', 'video'].includes(attachment.fileType);
              const itemUrl = attachment.fileType === 'image'
                ? resolveMediaVariantUrl(attachment, ['thumb', 'feed', 'large'])
                : resolveMediaUrl(attachment.fileUrl);
              const isLastWithMore = extraCount > 0 && index === visibleAttachments.length - 1;

              const content = (
                <span className="relative block aspect-square overflow-hidden rounded-xl bg-slate-900">
                  {attachment.fileType === 'image' ? (
	                    <img
	                      src={itemUrl}
	                      alt={attachment.fileName || 'Album photo'}
	                      loading={loadEager && index === 0 ? 'eager' : 'lazy'}
	                      decoding="async"
	                      fetchPriority={loadEager && index === 0 ? 'high' : 'low'}
	                      sizes="(max-width: 767px) 40vw, 220px"
	                      draggable={false}
	                      onLoad={settleThreadAfterMediaLoad}
	                      className="h-full w-full object-cover"
                    />
                  ) : attachment.fileType === 'video' ? (
                    <VideoThumbnail
                      src={itemUrl}
                      className="h-full w-full"
                      videoClassName="h-full w-full object-cover opacity-95"
                      iconSize={22}
                      label={attachment.fileName || 'Album video'}
                      preload={loadEager && index === 0 ? 'metadata' : 'none'}
                      onReady={settleThreadAfterMediaLoad}
                    />
                  ) : (
                    <span className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-100 p-3 text-slate-600 dark:bg-gray-900 dark:text-gray-300">
                      <FileText size={24} />
                      <span className="max-w-full truncate text-xs font-bold">{attachment.fileName || 'Attachment'}</span>
                    </span>
                  )}
                  {isLastWithMore && (
                    <span className="absolute inset-0 grid place-items-center bg-black/55 text-2xl font-black text-white">
                      +{extraCount}
                    </span>
                  )}
                </span>
              );

              return isMedia ? (
                <button
                  key={`${attachment.fileUrl}-${index}`}
                  type="button"
                  onClick={() => openMediaPreview(message, index)}
                  className="block min-w-0"
                  aria-label={`Open album item ${index + 1}`}
                >
                  {content}
                </button>
              ) : (
                <a
                  key={`${attachment.fileUrl}-${index}`}
                  href={itemUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block min-w-0"
                >
                  {content}
                </a>
              );
            })}
          </div>
          <span className={`absolute right-2 top-2 rounded-full px-2 py-1 text-xs font-black shadow-sm ${
            isMe ? 'bg-white text-[#1877f2]' : 'bg-slate-950/80 text-white'
          }`}>
            {attachments.length}
          </span>
        </div>
      );
    }

    if (primaryAttachment.fileUrl && primaryAttachment.fileType === 'image') {
      return (
        <button
          type="button"
          onClick={() => openMediaPreview(message)}
          className={`message-media-attachment block overflow-hidden rounded-2xl ${
            isMyDayReply ? 'bg-gray-100 p-1 dark:bg-gray-950/80' : 'bg-black/5 dark:bg-white/5'
          }`}
          aria-label="View photo"
        >
	          <img
	            src={mediaUrl}
	            alt={primaryAttachment.fileName || 'Attachment'}
	            loading={loadEager ? 'eager' : 'lazy'}
	            decoding="async"
	            fetchPriority={loadEager ? 'high' : 'low'}
	            sizes="(max-width: 767px) 76vw, 420px"
	            draggable={false}
	            onLoad={settleThreadAfterMediaLoad}
	            className={`${isMyDayReply ? 'max-h-72 rounded-[1rem]' : 'max-h-80'} w-full object-contain`}
          />
        </button>
      );
    }

    if (primaryAttachment.fileUrl && primaryAttachment.fileType === 'video') {
      return (
        <button
          type="button"
          onClick={() => openMediaPreview(message)}
          className="message-media-attachment block w-full overflow-hidden rounded-2xl"
          aria-label="View video"
        >
          <span className="relative block overflow-hidden rounded-2xl bg-black">
            <VideoThumbnail
              src={mediaUrl}
              className="max-h-80 w-full"
              videoClassName="max-h-80 object-contain opacity-95"
              iconSize={25}
              label={primaryAttachment.fileName || 'Video attachment'}
              preload={loadEager ? 'metadata' : 'none'}
              onReady={settleThreadAfterMediaLoad}
            />
          </span>
        </button>
      );
    }

    if (primaryAttachment.fileUrl && primaryAttachment.fileType === 'audio') {
      return (
        <VoiceMessagePlayer
          src={mediaUrl}
          fileName={primaryAttachment.fileName}
          fileSize={primaryAttachment.fileSize}
          isMe={isMe}
        />
      );
    }

    if (primaryAttachment.fileUrl) {
      return (
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-3 rounded-2xl border p-3 text-sm transition ${
            isMe
              ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
              : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
          }`}
        >
          <FileText size={20} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{primaryAttachment.fileName || 'Attachment'}</span>
            {primaryAttachment.fileSize > 0 && <span className="text-xs opacity-75">{formatBytes(primaryAttachment.fileSize)}</span>}
          </span>
          <Download size={17} />
        </a>
      );
    }

    return null;
  };

  const BackgroundSelector = ({ className = '' }) => (
    <div className={`rounded-3xl border border-slate-200 bg-slate-50 p-3 dark:border-gray-800 dark:bg-gray-900 ${className}`}>
      <label className="flex items-center gap-2 text-xs font-black uppercase text-slate-400">
        <ImageIcon size={14} />
        Conversation background
      </label>
      <button
        type="button"
        onClick={() => {
          setPendingBackgroundKey(selectedBackgroundKey);
          setShowBackgroundPicker(true);
        }}
        className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/50 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-900/60 dark:hover:bg-blue-950/20"
      >
        <span
          className="h-12 w-12 shrink-0 rounded-2xl border border-white/70 shadow-inner ring-1 ring-slate-200 dark:border-white/10 dark:ring-white/10"
          style={{ background: selectedBackground.preview }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-black text-slate-950 dark:text-white">{selectedBackground.label}</span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500 dark:text-gray-400">
            Shared with this conversation
          </span>
        </span>
        <ChevronRight size={17} className="shrink-0 text-slate-400" />
      </button>
    </div>
  );

  const renderChatDetailsContent = (compact = false) => (
    <div className={`${compact ? 'min-h-0 flex-1 overflow-y-auto px-4 pb-6 lg:max-h-[calc(90svh-4.5rem)]' : ''}`}>
      <div className="border-b border-slate-200/80 p-5 text-center dark:border-gray-800">
        <button type="button" onClick={() => setProfileUser(selectedUser)} className="mx-auto block" aria-label="View profile">
          <span className={`conversation-profile-target relative mx-auto block w-fit rounded-full ${selectedIsOnline ? 'is-online' : ''}`}>
            {renderAvatar(selectedUser, 'h-20 w-20', 32)}
          </span>
        </button>
        <h3 className="mt-3 truncate text-lg font-black text-slate-950 dark:text-white">{selectedDisplayName}</h3>
        <p className={`text-sm font-semibold ${selectedIsOnline ? 'text-emerald-500' : 'text-slate-500 dark:text-gray-400'}`}>
          {otherUserTyping ? 'Typing...' : presenceText}
        </p>
        <div className={`mx-auto mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-black ${
          chatStreakCount > 0
            ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-200'
            : 'bg-slate-100 text-slate-500 dark:bg-gray-900 dark:text-gray-300'
        }`}>
          <Flame size={16} className={chatStreakCount > 0 ? 'fill-orange-500 text-orange-500' : 'text-slate-400'} />
          {chatStreakText}
          {chatStreak?.longestStreak > chatStreakCount && (
            <span className="text-xs font-bold opacity-70">best {chatStreak.longestStreak}</span>
          )}
        </div>
        {userNotes[selectedUserId] && (
          <p className="mx-auto mt-3 line-clamp-2 rounded-2xl bg-pink-50 px-3 py-2 text-sm font-semibold text-pink-700 dark:bg-pink-950/30 dark:text-pink-200">
            {userNotes[selectedUserId].text}
          </p>
        )}
      </div>

        <div className={`${compact ? 'pt-4' : 'p-4'} space-y-4`}>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => togglePinnedConversation(selectedUserId)}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left text-sm font-bold text-slate-700 hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Pin size={18} className={`mb-2 ${selectedIsPinned ? 'fill-pink-500 text-pink-500' : 'text-pink-500'}`} />
            {selectedIsPinned ? 'Pinned' : 'Pin chat'}
          </button>
          <button
            type="button"
            onClick={() => toggleMuteConversation(selectedUserId)}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left text-sm font-bold text-slate-700 hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {selectedIsMuted ? <BellOff size={18} className="mb-2 text-pink-500" /> : <Bell size={18} className="mb-2 text-pink-500" />}
            {selectedIsMuted ? 'Muted' : 'Alerts on'}
          </button>
          <button
            type="button"
            onClick={() => toggleFavoriteConversation(selectedUserId)}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left text-sm font-bold text-slate-700 hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Star size={18} className={`mb-2 ${selectedIsFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-pink-500'}`} />
            {selectedIsFavorite ? 'Favorite' : 'Star'}
          </button>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-slate-400">Call history</p>
              <p className="mt-0.5 text-sm font-black text-slate-950 dark:text-white">Voice and video</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => startSharedCall(selectedUser, 'audio')}
                disabled={!canStartCall}
                className="grid h-9 w-9 place-items-center rounded-full bg-white text-[#1877f2] ring-1 ring-slate-200 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-950 dark:text-sky-300 dark:ring-gray-800"
                aria-label="Start audio call"
              >
                <Phone size={16} />
              </button>
              <button
                type="button"
                onClick={() => startSharedCall(selectedUser, 'video')}
                disabled={!canStartCall}
                className="grid h-9 w-9 place-items-center rounded-full bg-white text-[#1877f2] ring-1 ring-slate-200 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-950 dark:text-sky-300 dark:ring-gray-800"
                aria-label="Start video call"
              >
                <Video size={16} />
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {selectedCallHistory.length > 0 ? selectedCallHistory.map(entry => {
              const CallIcon = entry.mode === 'video' ? Video : Phone;
              return (
                <div key={entry.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200 dark:bg-gray-950 dark:ring-gray-800">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                    entry.status === 'missed' || entry.status === 'failed'
                      ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300'
                      : 'bg-blue-50 text-[#1877f2] dark:bg-blue-950/25 dark:text-sky-300'
                  }`}>
                    <CallIcon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-slate-950 dark:text-white">
                      {entry.direction === 'incoming' ? 'Incoming' : 'Outgoing'} {entry.mode === 'video' ? 'video' : 'voice'}
                    </span>
                    <span className="block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {getSharedCallStatusLabel(entry)} - {entry.endedAt ? formatMessageTime(entry.endedAt) : formatMessageTime(entry.startedAt)}
                    </span>
                  </span>
                  {entry.durationSeconds > 0 && (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-500 dark:bg-gray-900 dark:text-gray-300">
                      {formatSharedCallDuration(entry.durationSeconds)}
                    </span>
                  )}
                </div>
              );
            }) : (
              <p className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-500 ring-1 ring-slate-200 dark:bg-gray-950 dark:text-gray-400 dark:ring-gray-800">
                No calls with this chat yet.
              </p>
            )}
          </div>
        </div>

        <form onSubmit={saveConversationNickname} className="rounded-3xl border border-slate-200 bg-slate-50 p-3 dark:border-gray-800 dark:bg-gray-900">
          <label className="text-xs font-black uppercase text-slate-400">Nickname</label>
          <div className="mt-2 flex gap-2">
            <input
              value={nicknameDraft}
              onChange={event => setNicknameDraft(event.target.value.slice(0, 40))}
              placeholder={selectedUser?.name || 'Friend'}
              maxLength={40}
              className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-pink-300 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
            />
            <button
              type="submit"
              disabled={savingNickname || nicknameDraft.trim().replace(/\s+/g, ' ').slice(0, 40) === selectedNickname}
              className="rounded-2xl bg-[#1877f2] px-3 py-2 text-xs font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-45"
            >
              {savingNickname ? <Loader2 size={15} className="animate-spin" /> : 'Save'}
            </button>
          </div>
          <p className="mt-2 text-xs font-semibold text-slate-400">Visible to both people in this chat.</p>
        </form>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3 dark:border-gray-800 dark:bg-gray-900">
          <label className="flex items-center gap-2 text-xs font-black uppercase text-slate-400">
            <Palette size={14} />
            Chat theme
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {Object.entries(CHAT_THEMES).map(([key, theme]) => (
              <button
                key={key}
                type="button"
                onClick={() => updateConversationTheme(selectedUserId, key)}
                className={`rounded-2xl border p-2 text-left text-xs font-black ${
                  selectedThemeKey === key
                    ? 'border-pink-300 bg-white text-slate-950 dark:bg-gray-950 dark:text-white'
                    : 'border-transparent bg-white/70 text-slate-500 dark:bg-gray-950/60 dark:text-gray-400'
                }`}
              >
                <span className={`mb-1 block h-4 rounded-full bg-gradient-to-r ${theme.own}`} />
                {theme.label}
              </button>
            ))}
          </div>
        </div>

        <BackgroundSelector />

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-black text-slate-950 dark:text-white">Media</h4>
            <span className="text-xs font-bold text-slate-400">{sharedMediaItems.length}</span>
          </div>
          {sharedMediaItems.length > 0 ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-3">
              {sharedMediaItems.slice(0, 8).map(message => {
                const mediaAttachmentIndex = getMessageAttachments(message).findIndex(attachment => ['image', 'video'].includes(attachment.fileType));
                const mediaAttachment = getMessageAttachments(message)[mediaAttachmentIndex] || getMessageAttachments(message)[0] || message;
                const mediaUrl = mediaAttachment.fileType === 'image'
                  ? resolveMediaVariantUrl(mediaAttachment, ['thumb', 'feed', 'large'])
                  : resolveMediaUrl(mediaAttachment.fileUrl);
                return (
                  <button
                    key={getEntityId(message)}
                    type="button"
                    onClick={() => {
                      setShowChatDetails(false);
                      openMediaPreview(message, Math.max(0, mediaAttachmentIndex));
                    }}
                    className="aspect-square overflow-hidden rounded-2xl bg-slate-100 dark:bg-gray-900"
                    aria-label="Open shared media"
                  >
                    {mediaAttachment.fileType === 'image' ? (
              <img src={mediaUrl} alt={mediaAttachment.fileName || 'Shared media'} loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
            ) : (
              <VideoThumbnail src={mediaUrl} className="h-full w-full" iconSize={21} label={mediaAttachment.fileName || 'Shared video'} preload="none" />
            )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-gray-900 dark:text-gray-400">Shared photos and videos will appear here.</p>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-black text-slate-950 dark:text-white">Files and voice</h4>
            <span className="text-xs font-bold text-slate-400">{sharedFileItems.length}</span>
          </div>
          <div className="space-y-2">
            {sharedFileItems.length > 0 ? sharedFileItems.map(item => (
              <a
                key={item.id}
                href={resolveMediaUrl(item.fileUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {item.fileType === 'audio' ? <Mic size={18} className="text-[#1877f2]" /> : <FileText size={18} className="text-[#1877f2]" />}
                <span className="min-w-0 flex-1 truncate">{item.fileName || (item.fileType === 'audio' ? 'Voice message' : 'Attachment')}</span>
                <Download size={15} className="text-slate-400" />
              </a>
            )) : (
              <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-gray-900 dark:text-gray-400">No files or voice messages shared yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );

  if (initialLoading) {
    return <MessengerInitialSkeleton />;
  }

  return (
    <div className={`messages-pro-shell messages-clean-shell mobile-chat-shell mobile-messenger-shell messenger-motion-zone overflow-hidden rounded-[1.35rem] border border-slate-200/80 bg-white shadow-xl shadow-slate-300/20 dark:border-gray-800/80 dark:bg-gray-950 dark:shadow-black/20 ${hasOpenConversation ? 'mobile-chat-selected is-conversation-open' : ''}`}>
      <div className="messages-clean-layout flex h-full min-h-0">
        <aside className="messages-tools-rail hidden w-56 shrink-0 flex-col border-r border-slate-200/80 bg-slate-50/90 p-4 dark:border-gray-800 dark:bg-gray-950/95">
          <SyncrovaAppLogoButton onClick={openMainSyncrova} className="px-1 py-2" showLabel />

          <nav className="mt-6 space-y-1">
            {[
              { label: 'Chats', icon: MessageCircle, active: true, count: unreadTotal },
              { label: 'Mentions', icon: AtSign, count: 0 },
              { label: 'All Contacts', icon: Users, count: conversations.length },
              { label: 'Favorites', icon: Star, count: favoriteConversationIds.size },
              { label: 'Pinned', icon: Pin, count: pinnedMessages.length },
              { label: 'Settings', icon: Settings }
            ].map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    if (item.label === 'Favorites') setConversationFilter('favorites');
                    if (item.label === 'Pinned') setShowPinnedPanel(value => !value);
                  }}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold ${
                    item.active
                      ? 'bg-white text-pink-600 shadow-sm ring-1 ring-slate-200 dark:bg-gray-900 dark:text-pink-300 dark:ring-gray-800'
                      : 'text-slate-600 hover:bg-white/80 hover:text-slate-950 dark:text-gray-300 dark:hover:bg-gray-900 dark:hover:text-white'
                  }`}
                >
                  <Icon size={19} />
                  <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                  {item.count > 0 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-gray-800 dark:text-gray-300">
                      {item.count > 99 ? '99+' : item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto rounded-3xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            Notes now live above your chat list, just like Messenger.
          </div>
        </aside>

        <aside className={`${hasOpenConversation ? 'hidden' : 'flex'} mobile-conversation-list messages-conversation-column messages-clean-list w-full flex-col border-r border-slate-200/80 bg-white dark:border-gray-800 dark:bg-gray-950 md:w-[22rem] md:max-w-none xl:w-[23rem]`}>
          <div className="messages-clean-list-header border-b border-gray-200/80 p-3 dark:border-gray-800 md:p-4">
            <div className="messages-mobile-hero mb-4 flex items-center justify-between md:hidden">
              <SyncrovaAppLogoButton onClick={openMainSyncrova} className="min-w-0" showLabel />
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => toast('Open a conversation to start a video call')}
                  className="messages-mobile-action-button"
                  aria-label="Start video call"
                >
                  <Video size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(true)}
                  className="messages-mobile-action-button"
                  aria-label="Start new message"
                >
                  <Edit3 size={20} />
                </button>
              </div>
            </div>

            <div className="messages-clean-list-title mb-3 hidden items-center justify-between md:mb-4 md:flex">
              <div>
                <h2 className="text-xl font-black tracking-normal text-gray-950 dark:text-white md:text-2xl">Messages</h2>
                <p className="text-sm text-slate-500 dark:text-gray-400">
                  {socketConnected ? 'Your conversations' : 'Connecting to messages'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSoundEnabled(value => !value)}
                  className="grid h-9 w-9 place-items-center rounded-2xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-pink-600 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900 dark:hover:text-pink-300 md:h-10 md:w-10"
                  aria-label={soundEnabled ? 'Mute message sound' : 'Enable message sound'}
                >
                  {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(true)}
                  className="grid h-9 w-9 place-items-center rounded-2xl bg-[#1877f2] text-white shadow-sm hover:bg-[#0f63d5] md:h-10 md:w-10"
                  aria-label="Start new chat"
                >
                  <Plus size={19} />
                </button>
              </div>
            </div>

            <div className="relative">
              <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={conversationSearch}
                onChange={event => setConversationSearch(event.target.value)}
                placeholder="Search messages"
                className="messages-search-input w-full rounded-2xl border border-gray-200 bg-slate-50 py-3 pl-10 pr-12 text-sm outline-none focus:border-pink-300 focus:bg-white dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:border-pink-500"
              />
              <button
                type="button"
                onClick={() => setConversationFilter(conversationFilter === 'pinned' ? 'all' : 'pinned')}
                className="messages-search-filter-button absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-gray-400 transition hover:bg-white/80 hover:text-white"
                aria-label={conversationFilter === 'pinned' ? 'Show all chats' : 'Show pinned chats'}
              >
                <SlidersHorizontal size={18} />
              </button>
            </div>

            {chatHeadsStatus.supported && (
              <div className="messenger-chat-head-setting mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/92 px-3 py-2.5 shadow-sm dark:border-white/10 dark:bg-zinc-900/88">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1877f2]/10 text-[#1877f2] dark:bg-sky-400/10 dark:text-sky-200">
                  <MessageCircle size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-slate-900 dark:text-white">Chat heads</span>
                  <span className="block truncate text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    {chatHeadsStatus.enabled
                      ? (chatHeadsStatus.canDrawOverlays ? 'Opens Syncrova Messenger over other apps' : 'Allow display over other apps to finish setup')
                      : 'Off for this device'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={handleToggleChatHeads}
                  className={`messenger-chat-head-switch ${chatHeadsStatus.enabled ? 'is-on' : ''}`}
                  aria-pressed={chatHeadsStatus.enabled}
                  aria-label={chatHeadsStatus.enabled ? 'Disable chat heads' : 'Enable chat heads'}
                >
                  <span />
                </button>
              </div>
            )}

            {SHOW_INBOX_EXTRAS && (
              <>
            <div className="messenger-notes-tray mt-3 -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              <button
                type="button"
                onClick={() => {
                  setNoteText(myNote?.text || '');
                  setShowNoteComposer(true);
                }}
                className="messenger-room-tile messenger-note-create-tile group w-[4.75rem] shrink-0 text-center"
              >
                <span className="mx-auto grid h-[4.75rem] w-[4.75rem] place-items-center rounded-3xl bg-blue-50 text-[#1877f2] shadow-sm ring-1 ring-blue-100 transition group-hover:bg-blue-100 dark:bg-blue-950/25 dark:text-sky-200 dark:ring-blue-900/40">
                  <Plus size={26} strokeWidth={2.4} />
                </span>
                <span className="mt-1 block text-[11px] font-bold leading-tight text-slate-600 dark:text-gray-300">
                  Create note
                </span>
              </button>
              {noteTrayItems.map(item => {
                const personId = getEntityId(item.person);
                const friendshipKnown = acceptedFriendIds instanceof Set;
                const isFriend = item.isMe || (friendshipKnown && acceptedFriendIds.has(personId));
                const friendRequestPending = pendingFriendRequestIds.has(personId);
                const showAddFriend = friendshipKnown && !item.isMe && personId && !isFriend;
                const noteAvatar = renderAvatar(item.person, 'h-12 w-12', 20);
                const storyOnly = item.hasStory && !item.hasNote;
                const storyRingClass = item.hasStory
                  ? item.storyViewed
                    ? ' is-story-viewed'
                    : ' is-story-unviewed'
                  : '';
                return (
                  <div
                    key={item.id}
                    className={`messenger-note-head group w-[5.35rem] shrink-0 text-center ${storyOnly ? 'is-story-only' : ''}`}
                  >
                    <span className="messenger-note-card relative mx-auto flex min-h-[5.75rem] w-[5.25rem] flex-col items-center justify-end">
                      {!storyOnly && (
                        <button
                          type="button"
                          onClick={() => handleOpenNote(item)}
                          className={`messenger-note-bubble line-clamp-2 min-h-7 max-w-[5.05rem] rounded-2xl px-2 py-1 text-[10px] font-black leading-tight shadow-sm ring-1 ${
                          item.hasNote
                            ? 'bg-white text-slate-800 ring-slate-200 dark:bg-gray-900 dark:text-white dark:ring-gray-700'
                            : 'bg-[#1877f2] text-white ring-blue-300'
                        }`}
                          aria-label={item.hasNote ? `Open ${item.isMe ? 'your' : item.person?.name || 'friend'} note` : 'Create note'}
                        >
                          {item.text}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => (item.hasStory ? handleOpenTrayStory(item) : handleOpenNote(item))}
                        className={`messenger-note-avatar mt-1 rounded-full ring-2 ring-white transition group-hover:ring-[#1877f2] dark:ring-gray-950${storyRingClass}`}
                        aria-label={item.hasStory ? `View ${item.isMe ? 'your' : item.person?.name || 'friend'} My Day` : `Open ${item.isMe ? 'your' : item.person?.name || 'friend'} note`}
                      >
                        {noteAvatar}
                      </button>
                      {showAddFriend && (
                        <button
                          type="button"
                          onClick={event => handleTrayFriendRequest(event, item.person)}
                          disabled={friendRequestPending || friendActionUserId === personId}
                          className={`messenger-note-friend-add ${friendRequestPending ? 'is-pending' : ''}`}
                          aria-label={friendRequestPending ? 'Friend request sent' : `Add ${item.person?.name || 'user'} as friend`}
                          title={friendRequestPending ? 'Friend request sent' : 'Add friend'}
                        >
                          {friendActionUserId === personId ? (
                            <Loader2 size={12} className="skeleton-motion-zone animate-spin" />
                          ) : friendRequestPending ? (
                            <CheckCheck size={12} strokeWidth={3} />
                          ) : (
                            <UserPlus size={12} strokeWidth={3} />
                          )}
                        </button>
                      )}
                      {item.isMe && !storyOnly && (
                        <button
                          type="button"
                          onClick={() => handleOpenNote(item)}
                          className="messenger-note-add absolute bottom-0 right-3 z-20 grid h-5 w-5 place-items-center rounded-full bg-[#1877f2] text-white ring-2 ring-white dark:ring-gray-950"
                          aria-label="Edit your note"
                        >
                          <Plus size={12} strokeWidth={3} />
                        </button>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleOpenNote(item)}
                      className="mt-1 block w-full truncate text-[11px] font-bold text-slate-600 transition hover:text-[#1877f2] dark:text-gray-300 dark:hover:text-sky-200"
                    >
                      {item.isMe ? 'Your note' : item.person?.name || 'Friend'}
                    </button>
                  </div>
                );
              })}
            </div>

            {showNoteComposer && (
              <form onSubmit={handleSaveNote} className="note-composer-form mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-black uppercase text-[#1877f2] dark:text-sky-300">
                    <StickyNote size={14} />
                    Your note
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-400">1 day</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNoteComposer(false);
                        setNoteText(myNote?.text || '');
                      }}
                      className="grid h-7 w-7 place-items-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700 dark:hover:bg-gray-900 dark:hover:text-white"
                      aria-label="Close note composer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    value={noteText}
                    onChange={event => setNoteText(event.target.value.slice(0, 140))}
                    placeholder="Share a quick note..."
                    className="min-w-0 flex-1 rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#1877f2] dark:border-blue-900/50 dark:bg-gray-950 dark:text-white"
                  />
                  <button
                    type="submit"
                    disabled={savingNote || !noteText.trim()}
                    className="rounded-xl bg-[#1877f2] px-3 py-2 text-xs font-black text-white disabled:opacity-45"
                  >
                    {myNote ? 'Update' : 'Post'}
                  </button>
                  {myNote && (
                    <button type="button" onClick={handleClearNote} disabled={savingNote} className="rounded-xl px-2 text-xs font-black text-rose-500">
                      Clear
                    </button>
                  )}
                </div>
              </form>
            )}
              </>
            )}

            <div className="mobile-fixed-tabbar mobile-fixed-tabbar--chat messages-filter-tabs messages-filter-tabs--mobile mt-3 flex gap-2 overflow-x-auto pb-1 md:hidden">
              {mobileConversationFilters.map(filter => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setConversationFilter(filter.id)}
                  className={`messages-filter-tab inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-black ring-1 ${
                    conversationFilter === filter.id
                      ? 'is-active bg-[#1877f2] text-white ring-[#1877f2]'
                      : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-zinc-800'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <div className="messages-filter-tabs messages-filter-tabs--desktop mt-3 hidden gap-2 overflow-x-auto pb-1 md:flex">
              {conversationFilters.map(filter => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setConversationFilter(filter.id)}
                  className={`messages-filter-tab inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-black ring-1 ${
                    conversationFilter === filter.id
                      ? 'is-active bg-[#1877f2] text-white ring-[#1877f2]'
                      : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-zinc-800'
                  }`}
                >
                  {filter.label}
                  {filter.count > 0 && <span className="rounded-full bg-white/20 px-1.5">{filter.count > 99 ? '99+' : filter.count}</span>}
                </button>
              ))}
            </div>

          </div>

          <div
            ref={conversationListRef}
            onScroll={handleConversationListScroll}
            className="messages-clean-conversation-scroll min-h-0 flex-1 overflow-y-auto p-2"
          >
            {filteredConversations.length === 0 && filteredGroups.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center text-gray-500">
                <div className="mb-3 rounded-full bg-pink-50 p-4 text-pink-600 dark:bg-pink-950/30 dark:text-pink-300">
                  <MessageCircle size={34} />
                </div>
                <p className="font-bold text-gray-700 dark:text-gray-200">
                  {conversationFilter === 'requests' ? 'No message requests' : 'No conversations found'}
                </p>
                <p className="mt-1 text-sm">
                  {conversationFilter === 'requests'
                    ? 'New chats from people outside your friends list will appear here first.'
                    : 'Start a chat or try another filter.'}
                </p>
              </div>
            ) : (
              <div
                style={{
                  paddingBottom: virtualizedConversationState.paddingBottom
                }}
              >
                {filteredGroups.length > 0 && (
                  <div className="messenger-group-section mb-2">
                    <div className="messenger-group-toggle-row flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowGroupChats(value => !value)}
                        className="messenger-group-toggle flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-3 text-left"
                        aria-expanded={showGroupChats}
                      >
                        <span className="messenger-group-toggle-icon grid h-10 w-10 shrink-0 place-items-center rounded-full">
                          <Users size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-black text-slate-950 dark:text-white">Group chats</span>
                          <span className="block truncate text-xs font-bold text-slate-500 dark:text-slate-400">
                            {filteredGroups.length} group{filteredGroups.length === 1 ? '' : 's'}
                          </span>
                        </span>
                        <ChevronRight size={18} className={`shrink-0 text-slate-400 transition ${showGroupChats ? 'rotate-90' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowGroupCreate(true)}
                        className="messenger-group-create grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
                        aria-label="Create group chat"
                        title="Create group chat"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    {showGroupChats && (
                      <div className="mt-2 space-y-1">
                        {filteredGroups.map(group => {
                          const groupId = getEntityId(group);
                          const isActive = selectedGroupId === groupId;
                          const memberCount = group.members?.length || 0;
                          return (
                            <button
                              key={groupId}
                              type="button"
                              onClick={() => {
                                setSelectedUser(null);
                                setSelectedGroup(group);
                              }}
                              className={`conversation-list-row messenger-group-row mb-1 flex w-full items-center gap-3 rounded-2xl p-3 text-left ${
                                isActive
                                  ? 'bg-blue-50 ring-1 ring-blue-100 dark:bg-blue-950/30 dark:ring-blue-900/50'
                                  : 'hover:bg-slate-100/80 dark:hover:bg-gray-900'
                              }`}
                            >
                              {renderGroupAvatar(group, 'h-12 w-12')}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  {renderHighlightedText(group.name || 'Group chat', 'truncate font-bold text-gray-950 dark:text-white')}
                                  <div className="shrink-0 text-xs text-gray-400">
                                    {memberCount} members
                                  </div>
                                </div>
                                <p className="mt-1 truncate text-sm text-gray-500">
                                  {group.backgroundId && group.backgroundId !== DEFAULT_CHAT_BACKGROUND_ID
                                    ? 'Custom chat background'
                                    : group.joinCode ? `Room code ${group.joinCode}` : 'Group conversation'}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {virtualizedConversationState.paddingTop > 0 && (
                  <div style={{ height: virtualizedConversationState.paddingTop }} aria-hidden="true" />
                )}
                {virtualizedConversationState.items.map((conversation, localIndex) => {
                const otherUser = conversation.user;
                const otherUserId = getEntityId(otherUser);
                const presenceMeta = getConversationPresenceMeta(otherUser);
                const isTyping = typingUsers.has(otherUserId);
                const isActive = selectedUserId === otherUserId;
                const conversationStoryGroup = storyGroupByOwner.get(otherUserId);
                const conversationHasStory = Boolean(conversationStoryGroup);
                const conversationStoryViewed = isStoryGroupViewed(conversationStoryGroup, currentUserId);
                const isFavorite = favoriteConversationIds.has(otherUserId);
                const isMuted = mutedConversationIds.has(otherUserId);
                const isPinned = pinnedConversationIds.has(otherUserId);
                const displayName = conversationNicknames[otherUserId] || otherUser.name;
                const absoluteIndex = virtualizedConversationState.startIndex + localIndex;
                const previousConversation = filteredConversations[absoluteIndex - 1];
                const previousPinned = previousConversation ? pinnedConversationIds.has(getEntityId(previousConversation.user)) : false;
                const previousUnread = previousConversation ? Number(previousConversation.unreadCount || 0) > 0 : false;
                const showPinnedDivider = isPinned && !previousPinned;
                const showUnreadListDivider = Number(conversation.unreadCount || 0) > 0 && !previousUnread && !showPinnedDivider;

                return (
                  <React.Fragment key={otherUserId}>
                  {showPinnedDivider && (
                    <div className="mb-2 mt-1 px-2 text-[11px] font-black uppercase tracking-normal text-slate-400 dark:text-slate-500">
                      Pinned chats
                    </div>
                  )}
                  {showUnreadListDivider && (
                    <div className="mb-2 mt-1 flex items-center gap-2 px-2">
                      <span className="h-px flex-1 bg-blue-100 dark:bg-white/10" />
                      <span className="rounded-full bg-[#1877f2] px-2.5 py-1 text-[10px] font-black uppercase text-white shadow-sm shadow-blue-500/20">
                        Unread messages
                      </span>
                      <span className="h-px flex-1 bg-blue-100 dark:bg-white/10" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGroup(null);
                      setSelectedUser(otherUser);
                    }}
                    className={`conversation-list-row mb-1 flex w-full items-center gap-3 rounded-2xl p-3 text-left ${
                      isActive
                        ? 'bg-blue-50 ring-1 ring-blue-100 dark:bg-blue-950/30 dark:ring-blue-900/50'
                        : 'hover:bg-slate-100/80 dark:hover:bg-gray-900'
                    }`}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (conversationHasStory) {
                          openStory(getStoryGroupPreview(conversationStoryGroup));
                        } else {
                          setProfileUser(otherUser);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (conversationHasStory) {
                          openStory(getStoryGroupPreview(conversationStoryGroup));
                        } else {
                          setProfileUser(otherUser);
                        }
                      }}
                      title={conversationHasStory ? `View ${displayName}'s My Day` : `View ${displayName}'s profile`}
                      className={`conversation-profile-target relative shrink-0 cursor-pointer rounded-full ${presenceMeta.online ? 'is-online' : ''} ${conversationHasStory ? 'has-story' : ''} ${conversationHasStory && !conversationStoryViewed ? 'has-unviewed-story' : ''}`}
                    >
                      {renderAvatar(otherUser, 'h-12 w-12', 22)}
                      {presenceMeta.label ? (
                        <span
                          title={presenceMeta.title}
                          aria-label={presenceMeta.title}
                          className={`conversation-presence-badge absolute -bottom-1 left-1/2 z-10 max-w-[3.85rem] -translate-x-1/2 truncate rounded-full border px-1.5 py-[2px] text-[9px] font-black leading-none shadow-sm ${
                            presenceMeta.online
                              ? 'border-emerald-100 bg-emerald-500 text-white dark:border-emerald-900'
                              : 'border-white bg-slate-950/90 text-white shadow-black/30 dark:border-white/15 dark:bg-black/92 dark:text-white dark:shadow-black/50'
                          }`}
                        >
                          {presenceMeta.label}
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          {renderHighlightedText(displayName, 'truncate font-bold text-gray-950 dark:text-white')}
                          <DeveloperBadge user={otherUser} compact />
                          {isPinned && <Pin size={13} className="shrink-0 fill-pink-500 text-pink-500" />}
                          {isFavorite && <Star size={13} className="shrink-0 fill-yellow-400 text-yellow-400" />}
                          {isMuted && <BellOff size={13} className="shrink-0 text-slate-400" />}
                        </div>
                        <div className="shrink-0 text-xs text-gray-400">{formatMessageTime(conversation.lastTime)}</div>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className={`truncate text-sm ${isTyping ? 'font-semibold text-[#1877f2] dark:text-sky-300' : conversation.unreadCount ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-500'}`}>
                          {isTyping ? 'Typing...' : renderHighlightedText(conversation.lastMessage || 'New message')}
                        </p>
                        {conversation.unreadCount > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#1877f2] px-1.5 text-xs font-bold text-white">
                            {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  </React.Fragment>
                );
                })}
              </div>
            )}
          </div>
        </aside>

          {selectedGroup ? (
            <section
              className={`mobile-conversation-panel messages-clean-thread-panel messages-full-conversation-panel ${selectedGroupBackground.className} flex min-w-0 flex-1 flex-col bg-slate-50/90 dark:bg-gray-950/70`}
              style={selectedGroupBackgroundStyle}
            >
              <header className="mobile-chat-header messages-clean-thread-header mobile-group-chat-header flex items-center gap-2 border-b border-gray-200/80 bg-white/95 px-3 py-3 dark:border-gray-800 dark:bg-gray-950/95 sm:gap-3 sm:px-4">
                <button
                  type="button"
                  onClick={returnToInbox}
                  className="messages-conversation-back mobile-chat-icon-button flex h-10 shrink-0 items-center justify-center rounded-2xl text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800"
                  aria-label="Back to messages"
                  title="Back to messages"
                >
                  <ArrowLeft size={21} strokeWidth={2.7} />
                  <span className="messages-conversation-back-label">Messages</span>
                </button>
                <button
                  type="button"
                  onClick={openGroupSettings}
                  className="mobile-chat-avatar relative shrink-0 rounded-full ring-2 ring-transparent transition hover:ring-blue-200"
                  title="Group settings"
                >
                  {renderGroupAvatar(selectedGroup, 'h-12 w-12')}
                </button>
                <button type="button" onClick={openGroupSettings} className="min-w-0 flex-1 text-left" title="Group settings">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate font-semibold text-gray-950 dark:text-white">{selectedGroup.name || 'Group chat'}</div>
                  </div>
                  <div className="mt-0.5 truncate text-xs font-medium text-gray-500 dark:text-gray-400">
                    {selectedGroupMembersList.length} members
                  </div>
                </button>
                <button
                  type="button"
                  onClick={openGroupSettings}
                  className="mobile-chat-icon-button mobile-chat-details-button rounded-full p-2 text-gray-500 transition hover:bg-blue-50 hover:text-[#1877f2] dark:hover:bg-blue-950/30 dark:hover:text-sky-300"
                  aria-label="Open group details"
                  title="Group details"
                >
                  <MoreVertical size={18} />
                </button>
              </header>
              <Suspense fallback={<DeferredConversationModuleFallback label="Opening group chat…" inline />}>
                <GroupChat
                  key={selectedGroupId}
                  groupId={selectedGroupId}
                  group={selectedGroup}
                  members={selectedGroupMembersList}
                  onUserClick={setProfileUser}
                  background={selectedGroupBackground}
                  onOpenSettings={openGroupSettings}
                  embedded
                />
              </Suspense>
            </section>
          ) : selectedUser ? (
            <section
              className={`mobile-conversation-panel messages-clean-thread-panel messages-full-conversation-panel ${selectedBackground.className} flex min-w-0 flex-1 flex-col bg-slate-50/90 dark:bg-gray-950/70`}
              style={selectedBackgroundStyle}
            >
              <header className="mobile-chat-header messages-clean-thread-header flex items-center gap-2 border-b border-gray-200/80 bg-white/95 px-3 py-3 dark:border-gray-800 dark:bg-gray-950/95 sm:gap-3 sm:px-4">
                <button
                  type="button"
                  onClick={returnToInbox}
                  className="messages-conversation-back mobile-chat-icon-button flex h-10 shrink-0 items-center justify-center rounded-2xl text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800"
                  aria-label="Back to messages"
                  title="Back to messages"
                >
                  <ArrowLeft size={21} strokeWidth={2.7} />
                  <span className="messages-conversation-back-label">Messages</span>
                </button>
                <button
                  type="button"
                  onClick={() => (selectedHasStory ? openStory(getStoryGroupPreview(selectedStoryGroup)) : setProfileUser(selectedUser))}
                  className={`mobile-chat-avatar conversation-profile-target relative shrink-0 cursor-pointer rounded-full transition hover:ring-pink-300 ${selectedIsOnline ? 'is-online' : ''} ${selectedHasStory ? 'has-story' : ''} ${selectedHasStory && !selectedStoryViewed ? 'has-unviewed-story' : ''}`}
                  title={selectedHasStory ? 'View My Day' : 'View profile'}
                >
                  {renderAvatar(selectedUser, 'h-12 w-12', 22)}
                </button>
                <button type="button" onClick={() => setProfileUser(selectedUser)} className="min-w-0 flex-1 text-left" title="View profile">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate font-semibold text-gray-950 dark:text-white">{selectedDisplayName}</div>
                    <DeveloperBadge user={selectedUser} compact />
                    <span className={`hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black sm:inline-flex ${
                      chatStreakCount > 0
                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-200'
                        : 'bg-slate-100 text-slate-500 dark:bg-gray-800 dark:text-gray-300'
                    }`}>
                      <Flame size={12} className={chatStreakCount > 0 ? 'fill-orange-500 text-orange-500' : 'text-slate-400'} />
                      {chatStreakText}
                    </span>
                  </div>
                  <div className={`mt-0.5 text-xs font-medium ${otherUserTyping ? 'text-[#1877f2] dark:text-sky-300' : selectedIsOnline ? 'text-emerald-500' : !socketConnected || !presenceReady ? 'text-amber-500' : 'text-gray-500'}`}>
                    {otherUserTyping ? 'Typing...' : presenceText}
                  </div>
                </button>
                <div className="mobile-chat-call-actions flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startSharedCall(selectedUser, 'video')}
                    disabled={!canStartCall}
                    className="mobile-chat-icon-button mobile-chat-call-button rounded-full p-2 text-[#1877f2] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-sky-300 dark:hover:bg-blue-950/30"
                    aria-label="Start video call"
                    title={selectedIsOnline ? 'Video call' : 'User must be online to call'}
                  >
                    <Video size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => startSharedCall(selectedUser, 'audio')}
                    disabled={!canStartCall}
                    className="mobile-chat-icon-button mobile-chat-call-button rounded-full p-2 text-[#1877f2] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-sky-300 dark:hover:bg-blue-950/30"
                    aria-label="Start audio call"
                    title={selectedIsOnline ? 'Audio call' : 'User must be online to call'}
                  >
                    <Phone size={18} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowChatDetails(true)}
                  className="mobile-chat-icon-button mobile-chat-details-button rounded-full p-2 text-gray-500 transition hover:bg-blue-50 hover:text-[#1877f2] dark:hover:bg-blue-950/30 dark:hover:text-sky-300"
                  aria-label="Open chat details"
                  title="Chat details"
                >
                  <MoreVertical size={18} />
                </button>
              </header>

              <div className="mobile-chat-search-bar messages-clean-thread-search border-b border-gray-200/80 bg-white/95 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/95">
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={messageSearch}
                      onChange={event => setMessageSearch(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          goToSearchMatch(event.shiftKey ? -1 : 1);
                        }
                      }}
                      placeholder="Search in conversation"
                      className="h-10 w-full rounded-2xl border border-gray-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold text-gray-900 outline-none focus:border-pink-300 focus:bg-white dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    />
                  </div>
                  {messageSearch && (
                    <div className="flex items-center gap-1">
                      <span className="hidden rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500 dark:bg-gray-800 dark:text-gray-300 sm:inline-flex">
                        {messageSearchMatches.length ? `${messageSearchIndex + 1}/${messageSearchMatches.length}` : '0'}
                      </span>
                      <button type="button" onClick={() => goToSearchMatch(-1)} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300" aria-label="Previous search result">
                        <ArrowLeft size={16} />
                      </button>
                      <button type="button" onClick={() => goToSearchMatch(1)} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300" aria-label="Next search result">
                        <ArrowLeft size={16} className="rotate-180" />
                      </button>
                      <button type="button" onClick={() => setMessageSearch('')} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300" aria-label="Clear search">
                        <X size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {primaryPinnedMessage && (
                <div className="pinned-message-preview border-b border-slate-200/80 bg-white/95 px-3 py-2 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-950/95 sm:px-4">
                  <div className="flex min-w-0 items-center gap-2 rounded-2xl px-2 py-2 transition hover:bg-slate-100/80 dark:hover:bg-gray-900">
                    <button
                      type="button"
                      onClick={() => scrollToPinnedMessage(getEntityId(primaryPinnedMessage))}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-yellow-50 text-yellow-600 ring-1 ring-yellow-100 dark:bg-yellow-950/30 dark:text-yellow-200 dark:ring-yellow-900/50">
                        <Pin size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-black uppercase tracking-normal text-yellow-600 dark:text-yellow-200">
                          Pinned message
                        </span>
                        <span className="block truncate text-sm font-bold text-slate-700 dark:text-gray-200">
                          {getMessageSnippet(primaryPinnedMessage) || 'Attachment'}
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-xs font-bold text-slate-400 sm:inline">
                        {formatMessageTime(primaryPinnedMessage.createdAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePin(getEntityId(primaryPinnedMessage))}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      aria-label="Unpin message"
                    >
                      <PinOff size={15} />
                    </button>
                  </div>
                </div>
              )}

              {showPinnedPanel && pinnedMessages.length > 0 && (
                  <div className="border-b border-yellow-200 bg-yellow-50/95 px-4 py-3 shadow-sm dark:border-yellow-900/60 dark:bg-yellow-950/20">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-bold text-yellow-800 dark:text-yellow-200">
                        <Pin size={15} />
                        Pinned messages
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowPinnedPanel(false)}
                        className="rounded-full p-1 text-yellow-700 transition hover:bg-yellow-100 dark:text-yellow-200 dark:hover:bg-yellow-950/50"
                        aria-label="Close pinned messages"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {pinnedMessages.map(message => {
                        const isMe = getEntityId(message.from) === currentUserId;
                        const sender = getMessageSender(message, isMe);
                        const messageId = getEntityId(message);

                        return (
                          <button
                            key={messageId}
                            type="button"
                            onClick={() => scrollToPinnedMessage(messageId)}
                            className="min-w-[220px] max-w-xs rounded-xl border border-yellow-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-yellow-900/60 dark:bg-gray-900"
                          >
                            <span className="block truncate text-xs font-bold text-yellow-700 dark:text-yellow-300">{isMe ? 'You' : sender?.name}</span>
                            <span className="mt-1 block truncate text-gray-700 dark:text-gray-200">{getMessageSnippet(message)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

              <div
                ref={messageThreadRef}
                className="mobile-message-thread messages-clean-thread min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-5"
                onWheel={cancelMediaBottomPin}
                onTouchStart={cancelMediaBottomPin}
                onPointerDown={cancelMediaBottomPin}
              >
                {loading ? (
                  <div className="space-y-4">
                    {[0, 1, 2].map(item => (
                      <div key={item} className={`flex animate-pulse ${item % 2 ? 'justify-end' : 'justify-start'}`}>
                        <div className="h-14 w-2/5 rounded-3xl bg-gray-200 dark:bg-gray-800" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <>
                      {hiddenMessageCount > 0 && (
                        <div className="mb-4 flex justify-center">
                          <button
                            type="button"
                            onClick={hiddenLocalMessageCount > 0 ? revealEarlierLocalMessages : loadOlderMessages}
                            disabled={hiddenLocalMessageCount === 0 && loadingOlderMessages}
                            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 shadow-sm transition hover:border-blue-200 hover:text-[#1877f2] dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-blue-900/60 dark:hover:text-sky-200"
                          >
                            {hiddenLocalMessageCount > 0
                              ? `Show ${Math.min(hiddenMessageStep, hiddenLocalMessageCount)} earlier messages`
                              : (loadingOlderMessages ? 'Loading earlier messages...' : 'Show earlier messages')}
                          </button>
                        </div>
                      )}

                      {renderedTimelineItems.map((item) => {
                        if (item.type === 'date') {
                          return (
                            <div key={item.id} className="message-date-divider my-5 flex items-center gap-4">
                              <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                              <span className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-500 shadow-sm dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-300">
                                {item.label}
                              </span>
                              <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                            </div>
                          );
                        }

                        if (item.type === 'call') {
                          const entry = item.entry || {};
                          const CallIcon = entry.mode === 'video' ? Video : Phone;
                          const statusLabel = getSharedCallStatusLabel(entry);
                          const durationText = entry.durationSeconds > 0 ? formatSharedCallDuration(entry.durationSeconds) : '';
                          const endedLabel = entry.status === 'completed' ? 'ended' : statusLabel;
                          const callTitle = [
                            entry.direction === 'incoming' ? 'Incoming' : 'Outgoing',
                            entry.mode === 'video' ? 'video call' : 'voice call',
                            endedLabel
                          ].filter(Boolean).join(' ');

                          return (
                            <div key={item.id} className="message-call-event my-4 flex justify-center">
                              <div className="inline-flex max-w-[min(92%,28rem)] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200">
                                <CallIcon size={14} className="shrink-0 text-[#1877f2] dark:text-sky-300" />
                                <span className="min-w-0 truncate">{callTitle}</span>
                                {durationText && (
                                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-zinc-800 dark:text-zinc-300">
                                    {durationText}
                                  </span>
                                )}
                                <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
                                  {formatMessageTime(entry.endedAt || entry.startedAt)}
                                </span>
                              </div>
                            </div>
                          );
                        }

                        const message = item.message;
                        const messageId = getEntityId(message);
                        const isMe = getEntityId(message.from) === currentUserId;
                        const sender = getMessageSender(message, isMe);
                        const reactions = message.reactions || [];
                        const isLatestOwn = messageId === latestOwnMessageId;
                        const isLatestRenderedMessage = messageId === getEntityId(renderedMessages[renderedMessages.length - 1]);
                        const isSearchMatch = messageSearchMatchSet.has(messageId);
                        const showUnreadDivider = unreadDividerMessageId && unreadDividerMessageId === messageId;
                        if (message.system) {
                          const SystemIcon = message.systemType === 'nickname_changed' ? AtSign : Palette;
                          return (
                            <React.Fragment key={item.id}>
                              {showUnreadDivider && (
                                <div className="my-4 flex items-center gap-3">
                                  <span className="h-px flex-1 bg-pink-200 dark:bg-pink-900/60" />
                                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-[#1877f2] dark:bg-blue-950/40 dark:text-sky-200">New messages</span>
                                  <span className="h-px flex-1 bg-pink-200 dark:bg-pink-900/60" />
                                </div>
                              )}
                              <div
                                ref={(node) => {
                                  if (node) messageRefs.current[messageId] = node;
                                  else delete messageRefs.current[messageId];
                                }}
                                className="system-message-row my-3 flex justify-center scroll-mt-24"
                                role="status"
                              >
                                <span className="system-message-bubble inline-flex max-w-[min(92%,28rem)] items-center gap-2 rounded-full border border-slate-200 bg-white/88 px-3 py-2 text-center text-xs font-black text-slate-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-950/82 dark:text-zinc-200">
                                  <SystemIcon size={13} className="shrink-0 text-[#1877f2] dark:text-sky-300" />
                                  <span className="min-w-0">{getSystemMessageText(message, currentUserId)}</span>
                                  <span className="hidden shrink-0 font-bold opacity-60 sm:inline">
                                    {formatMessageTime(message.createdAt)}
                                  </span>
                                </span>
                              </div>
                            </React.Fragment>
                          );
                        }
                        const isMyDayReply = isMyDayReplyMessage(message);
                        const isNoteReply = isNoteReplyMessage(message);
                        const isContextReply = isMyDayReply || isNoteReply;
                        const contextReplyLabel = isNoteReply ? getNoteReplyLabel(message, isMe) : getMyDayReplyLabel(message, isMe);
                        const contextReplyBody = isNoteReply ? getNoteReplyBody(message.text) : getMyDayReplyBody(message.text);
                        const hasReactions = reactions.length > 0 && !message.unsent;
                        const bubbleClassName = isContextReply
                          ? `my-day-reply-bubble relative rounded-3xl border border-gray-200 bg-white px-3 py-3 text-gray-950 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-white ${hasReactions ? 'message-bubble-has-reactions' : ''} ${
                              isMe ? 'rounded-br-xl' : 'rounded-bl-xl'
                            }`
                          : `message-bubble relative rounded-3xl px-4 py-3 shadow-sm ${hasReactions ? 'message-bubble-has-reactions' : ''} ${
                              isMe
                                ? `own-message-bubble rounded-br-lg bg-gradient-to-br ${selectedTheme.own} text-white shadow-blue-500/15`
                                : 'rounded-bl-lg border border-gray-200 bg-white text-gray-950 dark:border-gray-800 dark:bg-gray-900 dark:text-white'
                            } ${isMe && isLatestOwn ? 'ring-2 ring-blue-300/40 shadow-xl shadow-blue-500/20' : ''}`;

	                        return (
	                          <React.Fragment key={item.id}>
                            {showUnreadDivider && (
                              <div className="my-4 flex items-center gap-3">
                                <span className="h-px flex-1 bg-pink-200 dark:bg-pink-900/60" />
                                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-[#1877f2] dark:bg-blue-950/40 dark:text-sky-200">New messages</span>
                                <span className="h-px flex-1 bg-pink-200 dark:bg-pink-900/60" />
                              </div>
                            )}
                            <div
                              ref={(node) => {
                                if (node) messageRefs.current[messageId] = node;
                                else delete messageRefs.current[messageId];
                              }}
                              className={`message-row mb-4 flex scroll-mt-24 ${isMe ? 'justify-end' : 'justify-start'} group ${focusedMessageId === messageId || isSearchMatch ? 'rounded-3xl bg-yellow-100/70 py-2 dark:bg-yellow-950/30' : ''}`}
                            >
                            {!isMe && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setProfileUser(sender);
                                }}
                                className="mr-2 mt-5 shrink-0 rounded-full transition hover:ring-2 hover:ring-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300"
                                aria-label={`View ${getDisplayName(sender, selectedDisplayName)} profile`}
                              >
                                {renderAvatar(sender, 'h-8 w-8', 16)}
                              </button>
                            )}

                            <div className={`max-w-[82%] md:max-w-[68%] ${isMe ? 'items-end' : 'items-start'}`}>
                              <div className={`mb-1 px-1 text-xs text-gray-500 ${isMe ? 'text-right' : 'text-left'}`}>
                                <span className={`inline-flex max-w-full items-center gap-1.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setProfileUser(sender);
                                    }}
                                    className="min-w-0 truncate text-left transition hover:text-[#1877f2] dark:hover:text-sky-300"
                                    aria-label={`View ${isMe ? 'your' : getDisplayName(sender, selectedDisplayName)} profile`}
                                  >
                                    {isMe ? 'You' : getDisplayName(sender, selectedDisplayName)}
                                  </button>
                                  <DeveloperBadge user={sender} compact />
                                </span>
                              </div>

                              <div
                                onTouchStart={(event) => {
                                  if (message.unsent) return;
                                  startSwipeMessageAction(event, message);
                                }}
                                onMouseDown={(event) => {
                                  if (message.unsent || event.button !== 0 || isTouchReactionMode()) return;
                                  startMessageOptionsPress(message, 520);
                                }}
                                onMouseUp={clearReactionPressTimer}
                                onMouseLeave={clearReactionPressTimer}
                                onTouchEnd={() => {
                                  clearReactionPressTimer();
                                  clearSwipeMessageAction();
                                }}
                                onTouchMove={(event) => {
                                  clearReactionPressTimer();
                                  moveSwipeMessageAction(event);
                                }}
                                onTouchCancel={() => {
                                  clearReactionPressTimer();
                                  clearSwipeMessageAction();
                                }}
                                onContextMenu={(event) => {
                                  if (message.unsent) return;
                                  event.preventDefault();
                                  setEmojiPickerMessageId(null);
                                  setActionMenuMessageId(messageId);
                                }}
                                className={bubbleClassName}
                              >
                                {renderReplyPreview(message, isMe)}
                                <div className="space-y-2">
                                  {renderMessageAttachment(message, isMe, isContextReply, isLatestRenderedMessage)}
                                  {message.text && !message.unsent && (
                                    isContextReply ? (
                                      <div className="rounded-2xl bg-gray-50 px-3 py-2.5 text-left ring-1 ring-gray-100 dark:bg-gray-950/60 dark:ring-gray-800">
                                        <p className="text-[11px] font-black uppercase tracking-normal text-gray-400 dark:text-gray-500">{contextReplyLabel}</p>
                                        <p className="mt-1 whitespace-pre-wrap break-words text-[15px] font-semibold leading-relaxed text-gray-950 dark:text-white">
                                          <AnimatedEmojiText text={contextReplyBody || 'Reply'} />
                                        </p>
                                      </div>
                                    ) : (
                                      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                                        <AnimatedEmojiText text={message.text} />
                                      </p>
                                    )
                                  )}
                                  {message.editedAt && !message.unsent && (
                                    <span className={`text-[11px] font-semibold ${isMe && !isContextReply ? 'text-white/65' : 'text-gray-400'}`}>Edited</span>
                                  )}
                                  {message.pinned && !message.unsent && (
                                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                      isMe && !isContextReply ? 'bg-white/15 text-white/85' : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-200'
                                    }`}>
                                      <Pin size={11} />
                                      Pinned
                                    </span>
                                  )}
                                  {!message.unsent && (
                                    <span className={`message-bubble-time ${isMe && !isContextReply ? 'text-white/70' : 'text-gray-400 dark:text-white/45'}`}>
                                      {formatMessageTime(message.createdAt)}
                                    </span>
                                  )}
                                </div>

                                {messageReactionBursts[messageId] && !message.unsent && (
                                  <span className={`reaction-motion-zone reaction-burst ${isMe ? 'right-3' : 'left-3'} top-0`} aria-hidden="true">
                                    {messageReactionBursts[messageId]}
                                  </span>
                                )}

                              </div>

                              {hasReactions && (
                                <div className={`message-reaction-pill reaction-motion-zone -mt-2 mb-0.5 flex min-h-[1.45rem] w-fit items-center gap-0.5 rounded-full border border-gray-200 bg-white px-1.5 py-0 text-xs leading-none shadow-md dark:border-gray-700 dark:bg-gray-800 ${isMe ? 'ml-auto mr-2' : 'ml-2'}`}>
                                  {reactions.map((reaction, index) => (
                                    <button
                                      key={`${reaction.emoji}-${index}`}
                                      type="button"
                                      onClick={() => openReactionViewer(messageId)}
                                      className="emoji-pop-button reaction-motion-zone grid h-5 w-5 place-items-center rounded-full leading-none hover:opacity-80"
                                      aria-label="View message reactions"
                                    >
                                      <AnimatedEmojiText text={reaction.emoji} />
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => openReactionViewer(messageId)}
                                    className="reaction-motion-zone grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-black leading-none text-slate-500 dark:text-slate-300"
                                    aria-label="View who reacted"
                                  >
                                    {reactions.length}
                                  </button>
                                </div>
                              )}

                              <div className={`mobile-message-actions ${hasReactions ? 'message-actions-has-reactions' : ''} mt-1.5 flex items-center gap-2 px-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                                <span className="message-action-time text-[11px] text-gray-400">{formatMessageTime(message.createdAt)}</span>
                                {renderMessageStatus(message, isLatestOwn)}
                              </div>
                            </div>
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </>

                    {otherUserTyping && (
                        <div className="mb-4 flex items-end gap-2">
                          {renderAvatar(selectedUser, 'h-8 w-8', 16)}
                          <div className="flex items-center gap-1 rounded-3xl rounded-bl-lg border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                            {[0, 1, 2].map(dot => (
                              <span
                                key={dot}
                                className="h-2 w-2 animate-bounce rounded-full bg-[#0084ff]"
                                style={{ animationDelay: `${dot * 120}ms` }}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              <footer className="message-composer-footer messages-clean-composer border-t border-gray-200/80 bg-white/95 p-2 dark:border-gray-800 dark:bg-gray-950/95 sm:p-3">
                {editingMessage && (
                    <div className="mb-2 flex items-center justify-between rounded-2xl border border-cyan-100 bg-cyan-50 px-3 py-2 dark:border-cyan-900/60 dark:bg-cyan-950/20">
                      <div className="min-w-0 text-sm">
                        <div className="font-semibold text-cyan-700 dark:text-cyan-300">Editing message</div>
                        <p className="truncate text-xs text-gray-500">{getMessageSnippet(editingMessage)}</p>
                      </div>
                      <button
                        onClick={() => {
                          setEditingMessage(null);
                          clearComposerText();
                        }}
                        className="rounded-full p-1 text-gray-500 hover:bg-white dark:hover:bg-gray-900"
                        aria-label="Cancel edit"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}

                {replyingTo && (
                    <div className="mb-2 flex items-center justify-between rounded-2xl border border-pink-100 bg-pink-50 px-3 py-2 dark:border-pink-900/60 dark:bg-pink-950/20">
                      <div className="min-w-0 text-sm">
                        <div className="font-semibold text-pink-700 dark:text-pink-300">
                          Replying to {getEntityId(replyingTo.from) === currentUserId ? 'yourself' : getDisplayName(replyingTo.from, selectedDisplayName)}
                        </div>
                        <p className="truncate text-xs text-gray-500">{getMessageSnippet(replyingTo)}</p>
                      </div>
                      <button
                        onClick={() => setReplyingTo(null)}
                        className="rounded-full p-1 text-gray-500 hover:bg-white dark:hover:bg-gray-900"
                        aria-label="Cancel reply"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}

                {selectedAttachmentItems.length > 0 && (
                    <div className="message-media-composer mb-2 rounded-2xl border border-blue-100 bg-blue-50/55 p-2 dark:border-blue-900/50 dark:bg-blue-950/20">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-2 text-xs font-black uppercase text-[#1877f2] dark:text-sky-300">
                            <SlidersHorizontal size={14} />
                            Syncrova media
                          </div>
                          <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {selectedAttachmentItems.length}/{MAX_MESSAGE_MEDIA_SELECTION} selected - edit before sending
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {canAddMoreMedia && (
                            <button
                              type="button"
                              onClick={() => openMediaLibrary('all')}
                              className="grid h-8 w-8 place-items-center rounded-full bg-white text-[#1877f2] shadow-sm ring-1 ring-blue-100 dark:bg-gray-950 dark:ring-blue-900/50"
                              aria-label="Add more media"
                            >
                              <Plus size={16} />
                            </button>
                          )}
                          <button onClick={clearAttachment} className="grid h-8 w-8 place-items-center rounded-full bg-white text-gray-500 shadow-sm ring-1 ring-slate-200 transition hover:text-rose-500 dark:bg-gray-950 dark:ring-gray-800" aria-label="Remove all media">
                            <X size={17} />
                          </button>
                        </div>
                      </div>
                      <div className="message-media-tray flex gap-2 overflow-x-auto pb-1">
                        {selectedAttachmentItems.map(item => (
                          <div key={item.id} className="w-[8.2rem] shrink-0 overflow-hidden rounded-2xl border border-white bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950">
                            <div className="relative aspect-[4/5] overflow-hidden bg-slate-950">
                              {item.fileType === 'image' && item.previewUrl && (
                                <img
                                  src={item.previewUrl}
                                  alt={item.file.name}
                                  className="h-full w-full object-cover transition"
                                  style={getMediaEditPreviewStyle(item.edit)}
                                />
                              )}
                              {item.fileType === 'video' && item.previewUrl && (
                                <VideoThumbnail
                                  src={item.previewUrl}
                                  className="h-full w-full"
                                  iconSize={22}
                                  rounded="rounded-none"
                                  label="Selected video preview"
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => removeAttachmentItem(item.id)}
                                className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white backdrop-blur"
                                aria-label={`Remove ${item.file.name}`}
                              >
                                <X size={14} />
                              </button>
                              <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-black uppercase text-white backdrop-blur">
                                {item.fileType}
                              </span>
                            </div>
                            <div className="space-y-2 p-2">
                              <p className="truncate text-[11px] font-black text-slate-900 dark:text-white">{item.file.name}</p>
                              {item.fileType === 'image' ? (
                                <>
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      onClick={() => updateAttachmentItem(item.id, { rotate: ((item.edit?.rotate || 0) + 90) % 360 })}
                                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 px-2 py-1.5 text-[10px] font-black text-slate-600 dark:bg-gray-900 dark:text-gray-300"
                                    >
                                      <RotateCw size={12} />
                                      Rotate
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => updateAttachmentItem(item.id, { flipX: !item.edit?.flipX })}
                                      className="rounded-lg bg-slate-100 px-2 py-1.5 text-[10px] font-black text-slate-600 dark:bg-gray-900 dark:text-gray-300"
                                    >
                                      Flip
                                    </button>
                                  </div>
                                  <div className="flex gap-1 overflow-x-auto pb-0.5">
                                    {MEDIA_FILTERS.map(filter => (
                                      <button
                                        key={filter.id}
                                        type="button"
                                        onClick={() => updateAttachmentItem(item.id, { filter: filter.id })}
                                        className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${
                                          (item.edit?.filter || 'original') === filter.id
                                            ? 'bg-[#1877f2] text-white'
                                            : 'bg-slate-100 text-slate-500 dark:bg-gray-900 dark:text-gray-300'
                                        }`}
                                      >
                                        {filter.label}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                  Video preview ready. Trimming will come in a native editor pass.
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {sending && uploadProgress > 0 && (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                          <div className="h-full rounded-full bg-[#1877f2] transition-all" style={{ width: `${uploadProgress}%` }} />
                        </div>
                      )}
                    </div>
                  )}

                {recording && (
                  <div className="mb-2 flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                      Recording voice message: {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}
                    </span>
                    <button onClick={stopRecording} className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white transition hover:bg-rose-700">
                      <Square size={13} /> Stop
                    </button>
                  </div>
                )}

                <div className="message-composer-grid">
                  <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={event => handleAttachmentSelect(event)} />
                  <input ref={videoInputRef} type="file" accept="video/*" multiple className="hidden" onChange={event => handleAttachmentSelect(event, 'video')} />

                  <button
                    onClick={() => openMediaLibrary('all')}
                    disabled={sending || recording || Boolean(editingMessage)}
                    className="message-composer-action"
                    aria-label="Send photos or videos"
                  >
                    <ImageIcon size={19} />
                  </button>
                  <button
                    onClick={() => openMediaLibrary('video')}
                    disabled={sending || recording || Boolean(editingMessage)}
                    className="message-composer-action"
                    aria-label="Send video"
                  >
                    <Video size={19} />
                  </button>
                  <button
                    onClick={recording ? stopRecording : startRecording}
                    disabled={sending || Boolean(editingMessage)}
                    className={`message-composer-action ${
                      recording
                        ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300'
                        : ''
                    }`}
                    aria-label={recording ? 'Stop recording' : 'Record voice message'}
                  >
                    {recording ? <Square size={18} /> : <Mic size={19} />}
                  </button>

                  <input
                    ref={inputRef}
                    type="text"
                    onFocus={keepComposerAtLatest}
                    onChange={event => {
                      const value = event.target.value;
                      composerTextRef.current = value;
                      setComposerHasText(prev => {
                        const next = Boolean(value.trim());
                        return prev === next ? prev : next;
                      });
                      keepComposerAtLatest();
                      handleTyping();
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !sending && !recording) {
                        event.preventDefault();
                        submitComposer();
                      }
                    }}
                    placeholder="Aa"
                    className="message-composer-input"
                    disabled={sending || recording}
                  />
                  <button
                    onClick={submitComposer}
                    disabled={(!composerHasText && selectedAttachmentItems.length === 0) || sending || recording}
                    className="message-composer-send"
                    aria-label="Send message"
                  >
                    {sending ? <Loader2 size={19} className="animate-spin" /> : <Send size={19} />}
                  </button>
                </div>
              </footer>
            </section>
          ) : (
            <section className="messages-reference-empty-state messages-clean-empty-state hidden flex-1 items-center justify-center p-8 text-center md:flex">
              <div className="messages-clean-empty-inner">
                <span className="messages-clean-empty-icon" aria-hidden="true">
                  <MessageCircle size={28} strokeWidth={2.1} />
                </span>
                <h3>Your messages</h3>
                <p>Choose a chat from the list, or send a new message.</p>
                <button
                  type="button"
                  onClick={() => setShowModal(true)}
                  className="messages-clean-new-message"
                >
                  <Edit3 size={16} />
                  New message
                </button>
              </div>
            </section>
          )}

          {selectedUser && (
            <aside className="messages-details-panel hidden w-[18.5rem] shrink-0 flex-col border-l border-slate-200/80 bg-white dark:border-gray-800 dark:bg-gray-950">
              <div className="border-b border-slate-200/80 p-5 text-center dark:border-gray-800">
                <button type="button" onClick={() => setProfileUser(selectedUser)} className="mx-auto block" aria-label="View profile">
                  <span className={`conversation-profile-target relative mx-auto block w-fit rounded-full ${selectedIsOnline ? 'is-online' : ''}`}>
                    {renderAvatar(selectedUser, 'h-20 w-20', 32)}
                  </span>
                </button>
                <h3 className="mt-3 truncate text-lg font-black text-slate-950 dark:text-white">{selectedDisplayName}</h3>
                <p className={`text-sm font-semibold ${selectedIsOnline ? 'text-emerald-500' : 'text-slate-500 dark:text-gray-400'}`}>
                  {otherUserTyping ? 'Typing...' : presenceText}
                </p>
                {userNotes[selectedUserId] && (
                  <p className="mx-auto mt-3 line-clamp-2 rounded-2xl bg-pink-50 px-3 py-2 text-sm font-semibold text-pink-700 dark:bg-pink-950/30 dark:text-pink-200">
                    {userNotes[selectedUserId].text}
                  </p>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => togglePinnedConversation(selectedUserId)}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left text-sm font-bold text-slate-700 hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    <Pin size={18} className={`mb-2 ${selectedIsPinned ? 'fill-pink-500 text-pink-500' : 'text-pink-500'}`} />
                    {selectedIsPinned ? 'Pinned' : 'Pin chat'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleMuteConversation(selectedUserId)}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left text-sm font-bold text-slate-700 hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    {selectedIsMuted ? <BellOff size={18} className="mb-2 text-pink-500" /> : <Bell size={18} className="mb-2 text-pink-500" />}
                    {selectedIsMuted ? 'Muted' : 'Alerts on'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleFavoriteConversation(selectedUserId)}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left text-sm font-bold text-slate-700 hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    <Star size={18} className={`mb-2 ${selectedIsFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-pink-500'}`} />
                    {selectedIsFavorite ? 'Favorite' : 'Add star'}
                  </button>
                </div>

                <form onSubmit={saveConversationNickname} className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-3 dark:border-gray-800 dark:bg-gray-900">
                  <label className="text-xs font-black uppercase text-slate-400">Nickname</label>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={nicknameDraft}
                      onChange={event => setNicknameDraft(event.target.value.slice(0, 40))}
                      placeholder={selectedUser?.name || 'Friend'}
                      maxLength={40}
                      className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-pink-300 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                    />
                    <button
                      type="submit"
                      disabled={savingNickname || nicknameDraft.trim().replace(/\s+/g, ' ').slice(0, 40) === selectedNickname}
                      className="rounded-2xl bg-[#1877f2] px-3 py-2 text-xs font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {savingNickname ? <Loader2 size={15} className="animate-spin" /> : 'Save'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-slate-400">Visible to both people in this chat.</p>
                </form>

                <div className="mt-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 dark:border-gray-800 dark:bg-gray-900">
                  <label className="flex items-center gap-2 text-xs font-black uppercase text-slate-400">
                    <Palette size={14} />
                    Chat theme
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {Object.entries(CHAT_THEMES).map(([key, theme]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => updateConversationTheme(selectedUserId, key)}
                        className={`rounded-2xl border p-2 text-left text-xs font-black ${
                          selectedThemeKey === key
                            ? 'border-pink-300 bg-white text-slate-950 dark:bg-gray-950 dark:text-white'
                            : 'border-transparent bg-white/70 text-slate-500 dark:bg-gray-950/60 dark:text-gray-400'
                        }`}
                      >
                        <span className={`mb-1 block h-4 rounded-full bg-gradient-to-r ${theme.own}`} />
                        {theme.label}
                      </button>
                    ))}
                  </div>
                </div>

                <BackgroundSelector className="mt-3" />

                <div className="mt-4 space-y-2">
                  <button type="button" onClick={() => setProfileUser(selectedUser)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 dark:text-gray-200 dark:hover:bg-gray-900">
                    <Info size={18} className="text-pink-500" />
                    View profile
                    <ChevronRight size={16} className="ml-auto text-slate-400" />
                  </button>
                  <button type="button" onClick={() => setShowPinnedPanel(value => !value)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 dark:text-gray-200 dark:hover:bg-gray-900">
                    <Pin size={18} className="text-yellow-500" />
                    Pinned messages
                    <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-gray-800 dark:text-gray-300">{pinnedMessages.length}</span>
                  </button>
                  <button type="button" onClick={handleDeleteConversation} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-bold text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30">
                    <Trash2 size={18} />
                    Delete conversation
                  </button>
                </div>

                <section className="mt-5">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-950 dark:text-white">Media</h4>
                    <span className="text-xs font-bold text-slate-400">{sharedMediaItems.length}</span>
                  </div>
                  {sharedMediaItems.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                    {sharedMediaItems.slice(0, 6).map(message => {
                        const mediaAttachmentIndex = getMessageAttachments(message).findIndex(attachment => ['image', 'video'].includes(attachment.fileType));
                        const mediaAttachment = getMessageAttachments(message)[mediaAttachmentIndex] || getMessageAttachments(message)[0] || message;
                        const mediaUrl = mediaAttachment.fileType === 'image'
                          ? resolveMediaVariantUrl(mediaAttachment, ['thumb', 'feed', 'large'])
                          : resolveMediaUrl(mediaAttachment.fileUrl);
                        return (
                          <button
                            key={getEntityId(message)}
                            type="button"
                            onClick={() => openMediaPreview(message, Math.max(0, mediaAttachmentIndex))}
                            className="aspect-square overflow-hidden rounded-2xl bg-slate-100 dark:bg-gray-900"
                            aria-label="Open shared media"
                          >
                            {mediaAttachment.fileType === 'image' ? (
                              <img src={mediaUrl} alt={mediaAttachment.fileName || 'Shared media'} loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
                            ) : (
                              <VideoThumbnail src={mediaUrl} className="h-full w-full" iconSize={21} label={mediaAttachment.fileName || 'Shared video'} preload="none" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-gray-900 dark:text-gray-400">Shared photos and videos will appear here.</p>
                  )}
                </section>

                <section className="mt-5">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-950 dark:text-white">Files and voice</h4>
                    <span className="text-xs font-bold text-slate-400">{sharedFileItems.length}</span>
                  </div>
                  <div className="space-y-2">
                    {sharedFileItems.length > 0 ? sharedFileItems.map(item => (
                      <a
                        key={item.id}
                        href={resolveMediaUrl(item.fileUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                      >
                        {item.fileType === 'audio' ? <Mic size={18} className="text-[#1877f2]" /> : <FileText size={18} className="text-[#1877f2]" />}
                        <span className="min-w-0 flex-1 truncate">{item.fileName || (item.fileType === 'audio' ? 'Voice message' : 'Attachment')}</span>
                        <Download size={15} className="text-slate-400" />
                      </a>
                    )) : (
                      <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-gray-900 dark:text-gray-400">No files or voice messages shared yet.</p>
                    )}
                  </div>
                </section>
              </div>
            </aside>
          )}
        </div>

      {callIsActive && (
        <div className="call-overlay fixed inset-0 z-[105] flex items-center justify-center bg-slate-950/88 p-3 backdrop-blur-sm sm:p-4">
          <div className="call-shell w-full max-w-3xl overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950 text-white shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wide text-sky-300">
                  {callMode === 'video' ? 'Video call' : 'Audio call'}
                </p>
                <h3 className="truncate text-xl font-black">{callPartnerName}</h3>
                <p className="mt-0.5 text-sm font-semibold text-slate-300">{callStatusText}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {callQualityPills.map(item => (
                    <span key={item} className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black text-white/75 ring-1 ring-white/10">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => (callState === 'incoming' ? rejectCall() : endCall())}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-slate-200 transition hover:bg-white/15"
                aria-label="Close call"
              >
                <X size={18} />
              </button>
            </div>

            <div className="call-body p-5">
              {callMode === 'video' ? (
                <div className="call-video-stage relative aspect-video overflow-hidden rounded-3xl bg-slate-900 ring-1 ring-white/10">
                  <audio ref={remoteAudioRef} autoPlay className="hidden" />
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className={`h-full w-full object-cover ${remoteStreamReady ? 'opacity-100' : 'opacity-0'}`}
                  />
                  {!remoteStreamReady && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 text-center">
                      {renderAvatar(callPartner || selectedUser, 'h-24 w-24', 40)}
                      <p className="mt-4 text-lg font-black">{callPartnerName}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-400">{callStatusText}</p>
                    </div>
                  )}
                  {localStreamReady && (
                    <div className="call-self-preview absolute bottom-4 right-4 h-28 w-20 overflow-hidden rounded-2xl border border-white/20 bg-black shadow-xl sm:h-36 sm:w-28">
                      <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                      {cameraOff && (
                        <div className="absolute inset-0 grid place-items-center bg-slate-900/95">
                          <VideoOff size={22} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="call-audio-stage flex min-h-[18rem] flex-col items-center justify-center rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 p-8 text-center ring-1 ring-white/10">
                  {renderAvatar(callPartner || selectedUser, 'h-28 w-28', 46)}
                  <h3 className="mt-5 max-w-full truncate text-2xl font-black">{callPartnerName}</h3>
                  <p className="mt-2 text-sm font-semibold text-slate-300">{callStatusText}</p>
                  <audio ref={remoteAudioRef} autoPlay />
                </div>
              )}

              {callError && (
                <p className="mt-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100 ring-1 ring-rose-400/20">
                  {callError}
                </p>
              )}
              {callNetworkHint && (
                <p className="mt-4 rounded-2xl bg-sky-500/10 px-4 py-3 text-sm font-semibold text-sky-100 ring-1 ring-sky-400/20">
                  {callNetworkHint}
                </p>
              )}

              <div className="call-actions mt-5 flex flex-wrap items-center justify-center gap-3">
                {callState === 'incoming' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => rejectCall()}
                      className="flex h-12 min-w-32 items-center justify-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-black text-white transition hover:bg-rose-500"
                    >
                      <PhoneOff size={18} />
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={acceptCall}
                      disabled={!incomingCall?.livekit && !incomingCall?.roomName && !incomingCall?.offer}
                      className="flex h-12 min-w-32 items-center justify-center gap-2 rounded-full bg-[#1877f2] px-5 text-sm font-black text-white transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60"
                    >
                      {callMode === 'video' ? <Video size={18} /> : <Phone size={18} />}
                      Accept
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={toggleCallMic}
                      className={`grid h-12 w-12 place-items-center rounded-full transition ${
                        micMuted ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-white hover:bg-white/15'
                      }`}
                      aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
                    >
                      {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
                    </button>
                    {callMode === 'video' && (
                      <button
                        type="button"
                        onClick={toggleCallCamera}
                        className={`grid h-12 w-12 place-items-center rounded-full transition ${
                          cameraOff ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-white hover:bg-white/15'
                        }`}
                        aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
                      >
                        {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => endCall()}
                      className="flex h-12 min-w-36 items-center justify-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-black text-white transition hover:bg-rose-500"
                    >
                      <PhoneOff size={18} />
                      End call
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <Suspense fallback={<DeferredConversationModuleFallback label="Opening new chat…" />}>
          <NewChatModal
            title={forwardingMessage ? 'Forward message' : 'New chat'}
            helper={forwardingMessage ? 'Choose who should receive this message draft.' : 'Search classmates by name or email.'}
            onClose={() => {
              setShowModal(false);
              setForwardingMessage(null);
            }}
            onSelectUser={(newUser) => {
              setSelectedGroup(null);
              setSelectedUser(newUser);
              setShowModal(false);
              if (forwardingMessage) {
                const forwardedText = getForwardedMessageText(forwardingMessage);
                setForwardingMessage(null);
                window.setTimeout(() => {
                  setComposerText(forwardedText);
                  setReplyingTo(null);
                  focusComposerInput();
                }, 80);
              }
            }}
          />
        </Suspense>
      )}

      {showGroupCreate && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-sm">
          <form
            onSubmit={createGroupChat}
            className="flex max-h-[min(42rem,calc(100svh_-_2rem))] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-bold text-gray-950 dark:text-white">Create group chat</h2>
                <p className="text-sm text-gray-500">Add classmates and start a shared conversation.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowGroupCreate(false);
                  resetGroupCreateForm();
                }}
                className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
                aria-label="Close group creator"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <label className="text-xs font-black uppercase text-slate-400">Group name</label>
              <input
                value={groupDraftName}
                onChange={event => setGroupDraftName(event.target.value)}
                maxLength={80}
                placeholder="e.g. Math Study Group"
                className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-950 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />

              {selectedGroupMembers.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedGroupMembers.map(member => (
                    <button
                      key={getEntityId(member)}
                      type="button"
                      onClick={() => toggleGroupMember(member)}
                      className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-2 py-1 text-xs font-black text-[#1877f2] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/40"
                    >
                      {renderAvatar(member, 'h-6 w-6', 12)}
                      <span className="max-w-[9rem] truncate">{member.name}</span>
                      <X size={12} />
                    </button>
                  ))}
                </div>
              )}

              <label className="mt-4 block text-xs font-black uppercase text-slate-400">Add members</label>
              <div className="relative mt-2">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={groupMemberQuery}
                  onChange={event => setGroupMemberQuery(event.target.value)}
                  placeholder="Search by name or email"
                  className="w-full rounded-full border border-gray-200 bg-gray-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
                {groupMemberQuery.trim() && groupMemberResults.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
                    No matching users found.
                  </div>
                )}
                {groupMemberResults.map(person => {
                  const personId = getEntityId(person);
                  const selected = selectedGroupMembers.some(member => getEntityId(member) === personId);
                  return (
                    <button
                      key={personId}
                      type="button"
                      onClick={() => toggleGroupMember(person)}
                      className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${
                        selected
                          ? 'bg-blue-50 ring-1 ring-blue-100 dark:bg-blue-950/25 dark:ring-blue-900/40'
                          : 'hover:bg-slate-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      {renderAvatar(person, 'h-11 w-11', 20)}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-gray-950 dark:text-white">{person.name}</div>
                        <div className="truncate text-sm text-gray-500">{person.email}</div>
                      </div>
                      <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-black ${
                        selected ? 'bg-[#1877f2] text-white' : 'bg-slate-100 text-slate-400 dark:bg-gray-700'
                      }`}>
                        {selected ? <CheckCheck size={14} /> : <Plus size={13} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="shrink-0 border-t border-gray-100 p-4 dark:border-gray-800">
              <button
                type="submit"
                disabled={creatingGroup || !groupDraftName.trim() || selectedGroupMembers.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1877f2] px-4 py-3 text-sm font-black text-white shadow-lg shadow-blue-500/20 transition hover:bg-[#0f6ae8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingGroup && <Loader2 size={16} className="animate-spin" />}
                Create group chat
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedGroup && showGroupSettings && (
        <div className="fixed inset-0 z-[89] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form
            onSubmit={saveGroupSettings}
            className="mobile-bottom-sheet flex max-h-[92svh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[1.65rem] border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-950 sm:rounded-[1.65rem]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-gray-800">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-[#1877f2] dark:text-sky-300">Group chat settings</p>
                <h3 className="truncate text-lg font-black text-slate-950 dark:text-white">{selectedGroup.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGroupSettings(false)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                aria-label="Close group settings"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              <div>
                <label className="text-xs font-black uppercase text-slate-400">Group name</label>
                <input
                  value={groupSettingsName}
                  onChange={event => setGroupSettingsName(event.target.value)}
                  maxLength={80}
                  disabled={!canManageSelectedGroup}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-300 focus:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-white"
                />
                {!canManageSelectedGroup && (
                  <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-gray-400">Only group admins can rename the group.</p>
                )}
              </div>

              <div>
                <label className="text-xs font-black uppercase text-slate-400">Group photo</label>
                <label className={`mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 transition dark:border-gray-800 dark:bg-gray-900 ${
                  canManageSelectedGroup ? 'cursor-pointer hover:border-blue-200 hover:bg-white dark:hover:border-blue-900/60' : 'cursor-not-allowed opacity-70'
                }`}>
                  {renderGroupAvatar(selectedGroup, 'h-12 w-12')}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-slate-950 dark:text-white">
                      {groupSettingsPhoto ? groupSettingsPhoto.name : 'Choose a new photo'}
                    </span>
                    <span className="text-xs font-semibold text-slate-500 dark:text-gray-400">Images up to 8MB</span>
                  </span>
                  <ImageIcon size={18} className="text-[#1877f2]" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={!canManageSelectedGroup}
                    onChange={event => setGroupSettingsPhoto(event.target.files?.[0] || null)}
                  />
                </label>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="text-xs font-black uppercase text-slate-400">Conversation background</label>
                  <button
                    type="button"
                    onClick={() => setGroupSettingsBackgroundKey(DEFAULT_CHAT_BACKGROUND_ID)}
                    className="text-xs font-black text-[#1877f2] disabled:opacity-50"
                    disabled={groupSettingsBackgroundKey === DEFAULT_CHAT_BACKGROUND_ID}
                  >
                    Reset
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {CHAT_BACKGROUND_OPTIONS.map(background => {
                    const selected = groupSettingsBackgroundKey === background.id;
                    return (
                      <button
                        key={background.id}
                        type="button"
                        onClick={() => setGroupSettingsBackgroundKey(background.id)}
                        className={`chat-background-preview-card rounded-2xl border p-2 text-left transition ${
                          selected
                            ? 'is-selected border-[#1877f2] bg-blue-50 text-slate-950 shadow-sm dark:bg-blue-950/20 dark:text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-200 hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200'
                        }`}
                      >
                        <span
                          className="chat-background-preview mb-2 block h-20 rounded-xl border border-white/80 shadow-inner ring-1 ring-slate-200 dark:border-white/10 dark:ring-white/10"
                          style={{ background: background.preview }}
                          aria-hidden="true"
                        />
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-black">{background.label}</span>
                          {selected && (
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#1877f2] text-white">
                              <CheckCheck size={14} />
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 p-3 dark:border-gray-800 dark:bg-zinc-950/95 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={() => setShowGroupSettings(false)}
                disabled={savingGroupSettings}
                className="rounded-2xl px-4 py-2.5 text-sm font-black text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingGroupSettings || !groupSettingsName.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1877f2] px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-500/20 transition hover:bg-[#0f6ae8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingGroupSettings && <Loader2 size={16} className="animate-spin" />}
                Save changes
              </button>
            </div>
          </form>
        </div>
      )}

      {mediaLibraryOpen && (
        <Suspense fallback={<DeferredConversationModuleFallback label="Opening media library…" />}>
          <NativeMediaLibrarySheet
            open={mediaLibraryOpen}
            initialFilter={mediaLibraryFilter}
            maxSelection={MAX_MESSAGE_MEDIA_SELECTION}
            existingCount={selectedAttachmentItems.length}
            title="Send media"
            confirmLabel="Add"
            onClose={() => setMediaLibraryOpen(false)}
            onSelect={handleNativeMediaSelect}
          />
        </Suspense>
      )}

      {profileUser && (
        <Suspense fallback={<DeferredConversationModuleFallback label="Opening profile…" />}>
          <UserProfileModal
            isOpen
            user={profileUser}
            onClose={() => setProfileUser(null)}
          />
        </Suspense>
      )}

      {selectedUser && showChatDetails && (
        <div className="fixed inset-0 z-[88] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-4">
          <div className="chat-details-modal flex max-h-[90svh] w-full max-w-2xl flex-col overflow-hidden rounded-[1.55rem] border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-950">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-gray-800">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-[#1877f2] dark:text-sky-300">Chat details</p>
                <h3 className="truncate text-lg font-black text-slate-950 dark:text-white">{selectedDisplayName}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowChatDetails(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                aria-label="Close chat settings"
              >
                <X size={18} />
              </button>
            </div>
            {renderChatDetailsContent(true)}
          </div>
        </div>
      )}

      {selectedUser && showBackgroundPicker && typeof document !== 'undefined' && createPortal(
        <div
          className="chat-background-picker-overlay fixed inset-0 z-[89] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => {
            setPendingBackgroundKey(selectedBackgroundKey);
            setShowBackgroundPicker(false);
          }}
        >
          <div
            className="chat-background-picker-modal flex max-h-[92svh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[1.65rem] border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-950 sm:rounded-[1.65rem]"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-gray-800">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-[#1877f2] dark:text-sky-300">Conversation background</p>
                <h3 className="truncate text-lg font-black text-slate-950 dark:text-white">{selectedDisplayName}</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingBackgroundKey(selectedBackgroundKey);
                  setShowBackgroundPicker(false);
                }}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                aria-label="Cancel background picker"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {CHAT_BACKGROUND_OPTIONS.map(background => {
                  const isSelected = pendingBackgroundKey === background.id;
                  return (
                    <button
                      key={background.id}
                      type="button"
                      onClick={() => setPendingBackgroundKey(background.id)}
                      className={`chat-background-preview-card rounded-2xl border p-2 text-left transition ${
                        isSelected
                          ? 'is-selected border-[#1877f2] bg-blue-50 text-slate-950 shadow-sm dark:bg-blue-950/20 dark:text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-200 hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-blue-900/60 dark:hover:bg-gray-900/80'
                      }`}
                    >
                      <span
                        className="chat-background-preview mb-2 block h-24 rounded-xl border border-white/80 shadow-inner ring-1 ring-slate-200 dark:border-white/10 dark:ring-white/10"
                        style={{ background: background.preview }}
                        aria-hidden="true"
                      />
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-black">{background.label}</span>
                          <span className="mt-0.5 block truncate text-[11px] font-semibold opacity-65">{background.description}</span>
                        </span>
                        {isSelected && (
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#1877f2] text-white">
                            <CheckCheck size={14} />
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 p-3 dark:border-gray-800 dark:bg-zinc-950/95 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setPendingBackgroundKey(selectedBackgroundKey);
                  setShowBackgroundPicker(false);
                }}
                disabled={savingBackground}
                className="rounded-2xl px-4 py-2.5 text-sm font-black text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => updateConversationBackground(selectedUserId, DEFAULT_CHAT_BACKGROUND_ID)}
                disabled={savingBackground || selectedBackgroundKey === DEFAULT_CHAT_BACKGROUND_ID}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Reset to default
              </button>
              <button
                type="button"
                onClick={() => updateConversationBackground(selectedUserId, pendingBackgroundKey)}
                disabled={savingBackground || pendingBackgroundKey === selectedBackgroundKey}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1877f2] px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-500/20 transition hover:bg-[#0f6ae8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingBackground && <Loader2 size={16} className="animate-spin" />}
                Apply background
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {activeActionMessage && typeof document !== 'undefined' && createPortal((() => {
        const message = activeActionMessage;
        const messageId = getEntityId(message);
        const isMe = getEntityId(message.from) === currentUserId;
        const snippet = getMessageSnippet(message) || (getMessageAttachments(message).length ? 'Attachment' : 'Message');

        return (
          <div
            className="message-options-overlay fixed inset-0 z-[89] flex items-end justify-center bg-black/35 p-3 backdrop-blur-sm sm:items-center"
            onClick={() => {
              setActionMenuMessageId(null);
              setEmojiPickerMessageId(null);
            }}
          >
            <div
              className="message-options-sheet w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950"
              onClick={event => event.stopPropagation()}
            >
              <div className="border-b border-slate-200/80 p-4 dark:border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase text-[#1877f2] dark:text-sky-300">Message options</p>
                    <p className="mt-1 line-clamp-2 text-sm font-semibold text-slate-700 dark:text-gray-200">{snippet}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActionMenuMessageId(null)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                    aria-label="Close message options"
                  >
                    <X size={17} />
                  </button>
                </div>

                {!message.unsent && (
                  <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5">
                    {QUICK_REACTIONS.map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleReaction(messageId, emoji)}
                        className="emoji-pop-button reaction-motion-zone grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-xl transition hover:scale-105 hover:bg-slate-200 dark:bg-gray-900 dark:hover:bg-gray-800"
                        aria-label={`React ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 p-3">
                {!message.unsent && (
                  <>
                    <button type="button" onClick={() => handleReplyFromMenu(message)} className="message-options-action">
                      <Reply size={17} /> Reply
                    </button>
                    <button type="button" onClick={() => handleCopyMessage(message)} className="message-options-action">
                      <Copy size={17} /> Copy
                    </button>
                    <button type="button" onClick={() => handleForwardMessage(message)} className="message-options-action">
                      <Forward size={17} /> Forward
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActionMenuMessageId(null);
                        handlePin(messageId);
                      }}
                      className="message-options-action"
                    >
                      {message.pinned ? <PinOff size={17} /> : <Pin size={17} />}
                      {message.pinned ? 'Unpin' : 'Pin'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMessageInfo(message);
                    setActionMenuMessageId(null);
                  }}
                  className="message-options-action"
                >
                  <Info size={17} /> Info
                </button>
                {isMe && message.text && !message.unsent && (
                  <button type="button" onClick={() => startEditMessage(message)} className="message-options-action">
                    <Edit3 size={17} /> Edit
                  </button>
                )}
                <button type="button" onClick={() => handleRemoveForMe(messageId)} className="message-options-action">
                  <Trash2 size={17} /> Remove
                </button>
                {isMe && !message.unsent && (
                  <button type="button" onClick={() => handleUnsendForEveryone(messageId)} className="message-options-action message-options-action-danger">
                    <X size={17} /> Unsend
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })(), document.body)}

      {activeReactionMessage && typeof document !== 'undefined' && createPortal((() => {
        const message = activeReactionMessage;
        const messageId = getEntityId(message);
        const snippet = getMessageSnippet(message) || (getMessageAttachments(message).length ? 'Attachment' : 'Message');

        return (
          <div
            className="message-reaction-overlay fixed inset-0 z-[89] flex items-end justify-center bg-black/20 p-3 sm:items-center"
            onClick={() => setEmojiPickerMessageId(null)}
          >
            <div
              className="message-reaction-sheet w-full max-w-sm overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950"
              onClick={event => event.stopPropagation()}
            >
              <div className="border-b border-slate-100 px-4 py-3 dark:border-gray-800">
                <p className="line-clamp-1 text-xs font-black uppercase text-[#1877f2] dark:text-sky-300">React to message</p>
                <p className="mt-1 line-clamp-2 text-sm font-semibold text-slate-600 dark:text-gray-300">{snippet}</p>
              </div>
              <div className="reaction-motion-zone flex items-center justify-center gap-2 px-3 py-3">
                {QUICK_REACTIONS.map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleReaction(messageId, emoji)}
                    className="emoji-pop-button reaction-motion-zone grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-[1.45rem] dark:bg-gray-900"
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3 dark:border-gray-800">
                <button type="button" onClick={() => handleReplyFromMenu(message)} className="message-options-action">
                  <Reply size={17} /> Reply
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmojiPickerMessageId(null);
                    setActionMenuMessageId(messageId);
                  }}
                  className="message-options-action"
                >
                  <MoreVertical size={17} /> More
                </button>
              </div>
            </div>
          </div>
        );
      })(), document.body)}

      {selectedMessageInfo && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div className="mobile-bottom-sheet w-full max-w-md rounded-t-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-950 sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-pink-500">Message details</p>
                <h3 className="text-xl font-black text-slate-950 dark:text-white">Message info</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMessageInfo(null)}
                className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                aria-label="Close message info"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-2xl bg-slate-50 p-3 dark:bg-gray-900">
                <p className="text-xs font-black uppercase text-slate-400">From</p>
                <p className="mt-1 font-bold text-slate-950 dark:text-white">
                  {getEntityId(selectedMessageInfo.from) === currentUserId ? 'You' : getDisplayName(selectedMessageInfo.from, selectedDisplayName)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-gray-900">
                  <p className="text-xs font-black uppercase text-slate-400">Sent</p>
                  <p className="mt-1 font-bold text-slate-950 dark:text-white">{formatMessageTime(selectedMessageInfo.createdAt)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-gray-900">
                  <p className="text-xs font-black uppercase text-slate-400">Status</p>
                  <p className="mt-1 font-bold text-slate-950 dark:text-white">
                    {selectedMessageInfo.unsent ? 'Unsent' : selectedMessageInfo.read ? 'Seen' : 'Delivered'}
                  </p>
                </div>
              </div>
              {selectedMessageInfo.editedAt && (
                <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-100">
                  Edited {formatMessageTime(selectedMessageInfo.editedAt)}
                </div>
              )}
              {selectedMessageInfo.fileUrl && (
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-gray-900">
                  <p className="text-xs font-black uppercase text-slate-400">Attachment</p>
                  <p className="mt-1 truncate font-bold text-slate-950 dark:text-white">{selectedMessageInfo.fileName || selectedMessageInfo.fileType || 'File'}</p>
                  {selectedMessageInfo.fileSize > 0 && <p className="text-xs text-slate-500">{formatBytes(selectedMessageInfo.fileSize)}</p>}
                </div>
              )}
              <div className="rounded-2xl bg-slate-50 p-3 dark:bg-gray-900">
                <p className="text-xs font-black uppercase text-slate-400">Reactions</p>
                {selectedMessageInfo.reactions?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedMessageInfo.reactions.map((reaction, index) => (
                      <span key={`${reaction.emoji}-${index}`} className="rounded-full bg-white px-3 py-1.5 text-sm font-bold text-slate-700 ring-1 ring-slate-200 dark:bg-gray-950 dark:text-gray-200 dark:ring-gray-800">
                        {reaction.emoji} {getDisplayName(reaction.userId, 'Member')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-slate-500 dark:text-gray-400">No reactions yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {reactionViewerMessage && typeof document !== 'undefined' && createPortal((
        <div className="message-reaction-viewer-overlay fixed inset-0 z-[91] flex items-center justify-center bg-black/40 p-4" onClick={() => setReactionViewerMessageId(null)}>
          <div className="message-reaction-viewer w-[min(92vw,28rem)] max-w-md rounded-[1.55rem] border border-slate-200 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-950" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-[#1877f2] dark:text-sky-300">Reactions</p>
                <h3 className="truncate text-lg font-black text-slate-950 dark:text-white">
                  {reactionViewerMessage.reactions?.length || 0} reacted
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReactionViewerMessageId(null)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-gray-900 dark:text-gray-300"
                aria-label="Close reactions"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 max-h-[min(55svh,20rem)] space-y-2 overflow-y-auto pr-1">
              {reactionViewerMessage.reactions?.length ? reactionViewerMessage.reactions.map((reaction, index) => {
                const reactor = reaction.userId || {};
                const reactorId = getEntityId(reactor);
                const isOwnReaction = reactorId === currentUserId;
                return (
                  <div key={`${reactorId || 'reactor'}-${reaction.emoji}-${index}`} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2 dark:bg-gray-900">
                    <div className="relative shrink-0">
                      {renderAvatar(reactor, 'h-11 w-11', 18)}
                      <span className="reaction-motion-zone absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-white text-sm shadow-sm ring-1 ring-slate-200 dark:bg-gray-950 dark:ring-gray-700">
                        <AnimatedEmojiText text={reaction.emoji} />
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-slate-950 dark:text-white">
                        {isOwnReaction ? 'You' : getDisplayName(reactor, 'Member')}
                      </p>
                      <p className="text-xs font-semibold text-slate-500 dark:text-gray-400">Reacted with {reaction.emoji}</p>
                    </div>
                    {isOwnReaction && (
                      <button
                        type="button"
                        onClick={() => handleRemoveReaction(getEntityId(reactionViewerMessage), reaction.emoji)}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-600 ring-1 ring-slate-200 dark:bg-gray-950 dark:text-gray-200 dark:ring-gray-800"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              }) : (
                <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-sm font-semibold text-slate-500 dark:border-gray-800 dark:text-gray-400">
                  No reactions yet.
                </p>
              )}
            </div>
          </div>
        </div>
      ), document.body)}

      {activeNote && typeof document !== 'undefined' && createPortal((() => {
        const noteId = getEntityId(activeNote);
        const noteOwner = activeNote.userId || {};
        const noteOwnerId = getEntityId(noteOwner);
        const noteComments = activeNote.comments || [];
        const noteReactions = activeNote.reactions || [];
        const noteViews = activeNote.views || [];
        const myNoteReaction = noteReactions.find(reaction => getEntityId(reaction.userId) === currentUserId);
        const noteIsMine = noteOwnerId === currentUserId;
        const expiresLabel = activeNote.expiresAt
          ? `${getNoteTimeLeft(activeNote.expiresAt)} - expires ${formatDistanceToNow(new Date(activeNote.expiresAt), { addSuffix: true })}`
          : 'Available for 1 day';

        return (
          <div className="note-viewer-overlay" onClick={() => setActiveNote(null)}>
            <div className="note-viewer-sheet" onClick={event => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setProfileUser(noteOwner)}
                  className="flex min-w-0 items-center gap-3 rounded-2xl text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:hover:bg-gray-900"
                >
                  {renderAvatar(noteOwner, 'h-12 w-12', 22)}
                  <div className="min-w-0">
                    <p className="truncate text-base font-black text-slate-950 dark:text-white">
                      {noteIsMine ? 'Your note' : `${noteOwner?.name || 'Friend'}'s note`}
                    </p>
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{expiresLabel}</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveNote(null)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-gray-900 dark:text-gray-300"
                  aria-label="Close note"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="relative mt-4 rounded-[1.35rem] bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-4 shadow-inner ring-1 ring-blue-100 dark:from-gray-900 dark:via-gray-950 dark:to-blue-950/30 dark:ring-blue-900/40">
                <p className="whitespace-pre-wrap break-words text-lg font-black leading-relaxed text-slate-950 dark:text-white">{activeNote.text}</p>
                <ReactionBurst emoji={noteReactionBursts[noteId]} className="right-4 top-2" />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => handleNoteReaction(activeNote, myNoteReaction?.emoji || QUICK_REACTIONS[0])}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-black ${
                    myNoteReaction
                      ? 'bg-blue-50 text-[#1877f2] dark:bg-blue-950/30 dark:text-sky-200'
                      : 'bg-slate-100 text-slate-600 dark:bg-gray-900 dark:text-gray-300'
                  }`}
                >
                  <span className="text-base">{myNoteReaction?.emoji || QUICK_REACTIONS[0]}</span>
                  {myNoteReaction ? 'Reacted' : 'React'}
                </button>
                <div className="flex -space-x-1">
                  {QUICK_REACTIONS.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleNoteReaction(activeNote, emoji)}
                      className="emoji-pop-button reaction-motion-zone grid h-9 w-9 place-items-center rounded-full bg-white text-xl shadow-sm ring-1 ring-slate-200 dark:bg-gray-900 dark:ring-gray-800"
                      aria-label={`React ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3">
                {noteReactions.length ? (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {noteReactions.map((reaction, index) => (
                      <span key={`${reaction.emoji}-${index}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600 dark:bg-gray-900 dark:text-gray-200">
                        {reaction.emoji} {getDisplayName(reaction.userId, 'Member')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mb-3 text-xs font-bold text-slate-400">Be first to react to this note.</p>
                )}

                <div className="mb-3 grid grid-cols-3 gap-2">
                  {[
                    { label: 'Views', value: noteViews.length },
                    { label: 'Reactions', value: noteReactions.length },
                    { label: 'Replies', value: noteComments.length }
                  ].map(item => (
                    <div key={item.label} className="rounded-2xl bg-slate-50 px-3 py-2 text-center ring-1 ring-slate-100 dark:bg-gray-900 dark:ring-gray-800">
                      <p className="text-base font-black text-slate-950 dark:text-white">{item.value}</p>
                      <p className="text-[10px] font-black uppercase text-slate-400">{item.label}</p>
                    </div>
                  ))}
                </div>

                {noteIsMine && noteViews.length > 0 && (
                  <div className="mb-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100 dark:bg-gray-900 dark:ring-gray-800">
                    <p className="mb-2 text-xs font-black uppercase text-slate-400">Viewed by</p>
                    <div className="flex -space-x-2">
                      {noteViews.slice(0, 8).map(view => (
                        <span key={getEntityId(view.userId)} className="rounded-full ring-2 ring-white dark:ring-gray-900" title={view.userId?.name || 'Viewer'}>
                          {renderAvatar(view.userId, 'h-8 w-8', 15)}
                        </span>
                      ))}
                      {noteViews.length > 8 && (
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-200 text-[11px] font-black text-slate-600 ring-2 ring-white dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-900">
                          +{noteViews.length - 8}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
                  {noteComments.map(comment => {
                    const commentId = getEntityId(comment);
                    return (
                      <div key={commentId} className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setProfileUser(comment.userId)}
                          className="h-8 w-8 shrink-0 rounded-full transition hover:ring-2 hover:ring-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300"
                          aria-label={`View ${comment.userId?.name || 'Member'} profile`}
                        >
                          {renderAvatar(comment.userId, 'h-8 w-8', 16)}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="relative inline-block max-w-full rounded-2xl bg-slate-100 px-3 py-2 dark:bg-gray-900">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-xs font-black text-slate-950 dark:text-white">{comment.userId?.name || 'Member'}</span>
                              <DeveloperBadge user={comment.userId} compact />
                            </div>
                            <p className="break-words text-sm text-slate-700 dark:text-gray-200">{comment.text}</p>
                            <ReactionBurst emoji={noteReactionBursts[`${noteId}:${commentId}`]} className="right-1 top-0" />
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 pl-2">
                            <span className="text-[11px] font-bold text-slate-400">{formatDistanceToNow(new Date(comment.date || activeNote.createdAt), { addSuffix: true })}</span>
                            <div className="flex gap-1">
                              {QUICK_REACTIONS.slice(0, 4).map(emoji => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => handleNoteCommentReaction(activeNote, comment, emoji)}
                                  className="emoji-pop-button reaction-motion-zone rounded-full px-1 text-sm hover:bg-slate-100 dark:hover:bg-gray-900"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                            {comment.reactions?.length > 0 && (
                              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-slate-600 ring-1 ring-slate-200 dark:bg-gray-950 dark:text-gray-200 dark:ring-gray-800">
                                {comment.reactions.map(reaction => reaction.emoji).slice(0, 3).join(' ')} {comment.reactions.length}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <form onSubmit={handleNoteReply} className="mt-4 flex items-center gap-2">
                  {renderAvatar(user, 'h-9 w-9', 17)}
                  <input
                    value={noteReplyText}
                    onChange={event => setNoteReplyText(event.target.value.slice(0, 300))}
                    placeholder={noteIsMine ? 'Add a reply...' : `Reply to ${noteOwner?.name || 'this note'}...`}
                    className="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-[#1877f2] focus:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-white"
                  />
                  <button
                    type="submit"
                    disabled={savingNote || !noteReplyText.trim()}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1877f2] text-white disabled:opacity-45"
                    aria-label="Send note reply"
                  >
                    <Send size={17} />
                  </button>
                </form>
              </div>
            </div>
          </div>
        );
      })(), document.body)}

      {activeStory && (
        <Suspense fallback={<DeferredConversationModuleFallback label="Opening story…" />}>
          <StoryViewer
            story={activeStory}
            stories={activeStoryList}
            currentUser={user}
            onClose={() => setActiveStory(null)}
            onNavigate={openStory}
            onReact={reactToStory}
            onComment={commentOnStory}
            onDelete={deleteStory}
            zIndexClass="z-[120]"
          />
        </Suspense>
      )}

      {currentMediaPreview && (
        <Suspense fallback={<DeferredConversationModuleFallback label="Opening media…" />}>
          <MediaViewer
            media={currentMediaPreview}
            onClose={() => setMediaPreview(null)}
            onPrevious={hasMediaNavigation ? () => moveMediaPreview(-1) : undefined}
            onNext={hasMediaNavigation ? () => moveMediaPreview(1) : undefined}
            positionLabel={mediaPositionLabel}
          />
        </Suspense>
      )}
    </div>
  );
}
