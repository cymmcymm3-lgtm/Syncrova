// @ts-nocheck
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import {
  Globe2,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  CornerDownRight,
  Bookmark,
  Copy,
  EyeOff,
  Flag,
  MoreHorizontal,
  RefreshCw,
  Reply,
  Send,
  Share2,
  SmilePlus,
  Trash2,
  Users,
  Video,
  X
} from 'lucide-react';
import api from '../services/api';
import { optimizeImageFile, resolveMediaUrl, resolveMediaVariantUrl } from '../utils/media';
import { cancelIdleWork, requestIdleWork } from '../utils/performance';
import { DeveloperAvatarFrame, DeveloperBadge } from './DeveloperIdentity';
import AnimatedEmojiText from './AnimatedEmojiText';
import { SkeletonCard } from './SkeletonLoader';
import './home-feed-reactions.css';

const MediaViewer = lazy(() => import('./MediaViewer'));
const UserProfileModal = lazy(() => import('./UserProfileModal'));

const QUICK_REACTIONS = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F525}', '\u{1F44F}', '\u2705'];
const REACTION_LABELS = {
  '\u{1F44D}': 'Like',
  '\u2764\uFE0F': 'Love',
  '\u{1F602}': 'Haha',
  '\u{1F62E}': 'Wow',
  '\u{1F622}': 'Sad',
  '\u{1F525}': 'Fire',
  '\u{1F44F}': 'Applause',
  '\u2705': 'Support'
};
const MAX_HOME_POST_UPLOAD = 35 * 1024 * 1024;
const HOME_VIDEO_AUTOPLAY_KEY = 'syncrova.home.videoAutoplay';
const MOBILE_FEED_INITIAL_COUNT = 4;
const DESKTOP_FEED_INITIAL_COUNT = 5;
const MOBILE_FEED_LOAD_LIMIT = 18;
const DESKTOP_FEED_LOAD_LIMIT = 18;
const MOBILE_FEED_IDLE_VISIBLE_LIMIT = 10;
const DESKTOP_FEED_IDLE_VISIBLE_LIMIT = 10;

function DeferredFeedModuleFallback({ label = 'Opening…' }) {
  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/10 p-4 backdrop-blur-[1px]" role="status" aria-label={label}>
      <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-xs font-black text-slate-700 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900/95 dark:text-slate-100 dark:ring-slate-700">
        <Loader2 size={15} className="animate-spin text-[#0b57d0]" />
        {label}
      </span>
    </div>
  );
}

const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');

const privacyOptions = {
  public: { label: 'Public', helper: 'Everyone', icon: Globe2 },
  friends: { label: 'Friends', helper: 'Friends only', icon: Users },
  private: { label: 'Only me', helper: 'Private', icon: Lock }
};

const TEXT_BACKGROUND_OPTIONS = [
  { id: '', label: 'Clean', preview: '#f8fafc', style: {} },
  { id: 'ocean', label: 'Ocean', preview: '#0b57d0', style: { background: 'linear-gradient(135deg, #07036f, #0b57d0 52%, #22d3ee)', color: '#ffffff' } },
  { id: 'sunset', label: 'Sunset', preview: '#fb7185', style: { background: 'linear-gradient(135deg, #fb7185, #f97316 54%, #facc15)', color: '#ffffff' } },
  { id: 'mint', label: 'Mint', preview: '#10b981', style: { background: 'linear-gradient(135deg, #ecfdf5, #a7f3d0 48%, #34d399)', color: '#064e3b' } },
  { id: 'midnight', label: 'Midnight', preview: '#020617', style: { background: 'linear-gradient(135deg, #020617, #111827 58%, #312e81)', color: '#ffffff' } }
];

const MOOD_OPTIONS = ['Focused', 'Happy', 'Celebrating', 'Need help', 'Working hard'];
const ACTIVITY_OPTIONS = ['Sharing an update', 'Working on a project', 'Looking for teammates', 'Posting media', 'Asking a question'];

const getTextBackgroundOption = (id) => (
  TEXT_BACKGROUND_OPTIONS.find(option => option.id === id) || TEXT_BACKGROUND_OPTIONS[0]
);

const formatFeedTime = (value) => {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const getPostTitle = (text, fallback = 'Timeline post') => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
};

const isVideoPost = (post) => (
  post?.fileType === 'video' || /\.(mp4|webm|mov|m4v)$/i.test(post?.fileUrl || '')
);

const readVideoAutoplayPreference = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(HOME_VIDEO_AUTOPLAY_KEY) === 'true';
  } catch {
    return false;
  }
};

const saveVideoAutoplayPreference = (enabled) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HOME_VIDEO_AUTOPLAY_KEY, enabled ? 'true' : 'false');
  } catch {
    // Preference storage can be blocked in private modes.
  }
};

const isTouchFeedViewport = () => (
  typeof window !== 'undefined'
  && window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches
);

const useNearViewport = (rootMargin = '900px', eager = false) => {
  const [node, setNode] = useState(null);
  const ref = useCallback((nextNode) => {
    setNode(nextNode);
  }, []);
  const [isNear, setIsNear] = useState(() => (
    eager
    || typeof window === 'undefined'
    || typeof IntersectionObserver === 'undefined'
    || !isTouchFeedViewport()
  ));

  useEffect(() => {
    if (eager || typeof IntersectionObserver === 'undefined') {
      setIsNear(true);
      return undefined;
    }

    if (!node) {
      return undefined;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsNear(Boolean(entry?.isIntersecting));
    }, { rootMargin, threshold: 0.01 });

    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, node, rootMargin]);

  return [ref, isNear];
};

const getInitialFeedVisibleCount = () => (
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches
    ? MOBILE_FEED_INITIAL_COUNT
    : DESKTOP_FEED_INITIAL_COUNT
);

const getFeedLoadLimit = () => (
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches
    ? MOBILE_FEED_LOAD_LIMIT
    : DESKTOP_FEED_LOAD_LIMIT
);

const getFeedIdleVisibleLimit = () => (
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches
    ? MOBILE_FEED_IDLE_VISIBLE_LIMIT
    : DESKTOP_FEED_IDLE_VISIBLE_LIMIT
);

const getLocalMediaType = (file = {}) => {
  const mimeType = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  if (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp|avif|heic|heif)$/i.test(name)) return 'image';
  if (mimeType.startsWith('video/') || /\.(mp4|webm|mov|m4v|3gp|3gpp|mkv|avi)$/i.test(name)) return 'video';
  return '';
};

const getPostAttachments = (post = {}) => {
  const attachments = Array.isArray(post.attachments)
    ? post.attachments.filter(item => item?.fileUrl)
    : [];
  if (attachments.length) return attachments;
  if (!post.fileUrl) return [];
  return [{
    fileUrl: post.fileUrl,
    fileType: isVideoPost(post) ? 'video' : post.fileType || 'image',
    fileName: post.fileName || post.title || 'Post media',
    mimeType: post.mimeType || '',
    fileSize: post.fileSize || 0,
    variants: post.mediaVariants || {}
  }];
};

const formatMediaSize = (bytes = 0) => {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
};

const getCountLabel = (count = 0, singular = 'item', plural = `${singular}s`) => (
  `${count} ${count === 1 ? singular : plural}`
);

const getReactionSummary = (reactions = []) => {
  const counts = new Map();
  reactions.forEach(reaction => {
    const emoji = String(reaction?.emoji || '').trim();
    if (!emoji) return;
    counts.set(emoji, (counts.get(emoji) || 0) + 1);
  });

  const icons = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([emoji]) => emoji);

  return { count: reactions.length || 0, icons };
};

const getShareCount = (post = {}) => (
  Array.isArray(post.shares) ? post.shares.length : Number(post.shareCount || 0)
);

const getCommentId = (comment = {}) => getEntityId(comment._id || comment.id);

const shufflePosts = (items = []) => (
  [...items]
    .map((item, index) => ({ item, index, score: Math.random() }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(entry => entry.item)
);

const normalizeFeedPage = (payload) => {
  if (Array.isArray(payload)) {
    return { items: payload, hasMore: false, nextCursor: '' };
  }

  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    hasMore: Boolean(payload?.hasMore),
    nextCursor: String(payload?.nextCursor || '')
  };
};

const mergePostsById = (previous = [], incoming = []) => {
  const next = [...previous];
  const indexById = new Map(next.map((post, index) => [getEntityId(post), index]).filter(([id]) => id));

  incoming.forEach(post => {
    const postId = getEntityId(post);
    if (!postId) return;
    const existingIndex = indexById.get(postId);
    if (existingIndex >= 0) {
      next[existingIndex] = post;
      return;
    }
    indexById.set(postId, next.length);
    next.push(post);
  });

  return next;
};

const applyOptimisticPostReaction = (post, emoji, currentUser) => {
  const currentUserId = getEntityId(currentUser);
  if (!post || !currentUserId) return post;

  const reactions = Array.isArray(post.reactions) ? post.reactions : [];
  const existingIndex = reactions.findIndex(reaction => getEntityId(reaction.userId) === currentUserId);
  const nextReactions = [...reactions];

  if (existingIndex >= 0) {
    if (nextReactions[existingIndex]?.emoji === emoji) {
      nextReactions.splice(existingIndex, 1);
    } else {
      nextReactions[existingIndex] = { ...nextReactions[existingIndex], emoji };
    }
  } else {
    nextReactions.push({
      userId: currentUser,
      emoji,
      createdAt: new Date().toISOString()
    });
  }

  return { ...post, reactions: nextReactions };
};

function ReactionBurst({ emoji, className = '' }) {
  if (!emoji) return null;
  return (
    <span className={`reaction-motion-zone reaction-burst ${className}`} aria-hidden="true">
      {emoji}
    </span>
  );
}

function ReactionPicker({ onSelect, align = 'left', onKeyDown, pickerRef }) {
  return (
    <div
      ref={pickerRef}
      role="menu"
      aria-label="Choose a reaction"
      onKeyDown={onKeyDown}
      className={`feed-reaction-picker reaction-motion-zone flex gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-2xl shadow-slate-900/16 ring-1 ring-white/80 dark:border-slate-700 dark:bg-slate-900 dark:ring-slate-800/80 ${align === 'right' ? 'origin-bottom-right' : 'origin-bottom-left'}`}
    >
      {QUICK_REACTIONS.map(emoji => (
        <button
          key={emoji}
          type="button"
          role="menuitem"
          onClick={() => onSelect(emoji)}
          className="emoji-pop-button reaction-motion-zone grid h-10 w-10 place-items-center rounded-full text-[22px] hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"
          aria-label={`React with ${REACTION_LABELS[emoji] || emoji}`}
          title={REACTION_LABELS[emoji] || 'React'}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

const ReactionSummary = React.memo(function ReactionSummary({ reactions = [], onOpen }) {
  const { count, icons } = getReactionSummary(reactions);
  if (!count) {
    return <span className="text-xs font-bold text-slate-400 dark:text-slate-500">Be first to react</span>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-1 py-0.5 text-left hover:bg-blue-50 hover:text-[#0b57d0] dark:hover:bg-blue-950/30 dark:hover:text-sky-200"
    >
      <span className="flex shrink-0 -space-x-1">
        {icons.map(emoji => (
          <span key={emoji} className="reaction-motion-zone grid h-5 w-5 place-items-center rounded-full bg-white text-[13px] shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
            <AnimatedEmojiText text={emoji} />
          </span>
        ))}
      </span>
      <span className="truncate">{count}</span>
    </button>
  );
}, (prev, next) => prev.reactions === next.reactions);

const CommentReactionSummary = React.memo(function CommentReactionSummary({ reactions = [], onReact, onOpen }) {
  const { count, icons } = getReactionSummary(reactions);
  const [pickerOpen, setPickerOpen] = useState(false);
  const controlRef = useRef(null);
  const triggerRef = useRef(null);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const closePicker = (event) => {
      if (!controlRef.current?.contains(event.target)) setPickerOpen(false);
    };
    document.addEventListener('pointerdown', closePicker, true);
    return () => document.removeEventListener('pointerdown', closePicker, true);
  }, [pickerOpen]);

  const focusFirstReaction = () => {
    window.requestAnimationFrame(() => pickerRef.current?.querySelector('[role="menuitem"]')?.focus());
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === ' ') {
      event.preventDefault();
      setPickerOpen(true);
      focusFirstReaction();
    }
  };

  const handlePickerKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setPickerOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
    const currentIndex = buttons.indexOf(document.activeElement);
    if (currentIndex < 0 || !buttons.length) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  return (
    <div className="relative inline-flex items-center gap-2">
      {count > 0 && (
        <button
          type="button"
          onClick={onOpen}
          className="reaction-motion-zone inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-black text-slate-600 shadow-sm hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-blue-950/30"
          aria-label={getCountLabel(count, 'comment reaction')}
        >
          <span className="flex -space-x-1">
            {icons.map(emoji => (
              <span key={emoji} className="grid h-4 w-4 place-items-center rounded-full bg-white text-[10px] dark:bg-slate-900">
                <AnimatedEmojiText text={emoji} />
              </span>
            ))}
          </span>
          {count}
        </button>
      )}
      <div ref={controlRef} className={`comment-reactions-control relative group/comment-reactions ${pickerOpen ? 'is-reaction-picker-open' : ''}`}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setPickerOpen(open => !open)}
          onKeyDown={handleTriggerKeyDown}
          className="rounded-full px-1.5 py-0.5 text-[11px] font-black text-slate-500 hover:text-[#0b57d0] dark:text-slate-400 dark:hover:text-sky-200"
          aria-label="Choose a reaction for this comment"
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
        >
          React
        </button>
        <div className="comment-reaction-picker-shell pointer-events-none absolute bottom-full left-0 z-30 mb-2 opacity-0 transition">
          <ReactionPicker
            pickerRef={pickerRef}
            onKeyDown={handlePickerKeyDown}
            onSelect={(emoji) => {
              onReact(emoji);
              setPickerOpen(false);
            }}
          />
        </div>
      </div>
    </div>
  );
}, (prev, next) => prev.reactions === next.reactions);

function ReactionPeopleModal({ title = 'Reactions', reactions = [], onClose, onProfileClick }) {
  const [activeFilter, setActiveFilter] = useState('all');
  const grouped = reactions.reduce((map, reaction) => {
    const emoji = String(reaction?.emoji || '').trim();
    if (!emoji) return map;
    map.set(emoji, (map.get(emoji) || 0) + 1);
    return map;
  }, new Map());
  const tabs = [
    { key: 'all', label: 'All', count: reactions.length },
    ...[...grouped.entries()].sort((a, b) => b[1] - a[1]).map(([emoji, count]) => ({
      key: emoji,
      label: emoji,
      count
    }))
  ];
  const visibleReactions = activeFilter === 'all'
    ? reactions
    : reactions.filter(reaction => reaction?.emoji === activeFilter);

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="max-h-[82vh] w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950" onClick={event => event.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <p className="truncate text-base font-black text-slate-950 dark:text-white">{title}</p>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{getCountLabel(reactions.length, 'reaction')}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Close reactors">
            <X size={18} />
          </button>
        </header>

        <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-4 py-2 dark:border-slate-800">
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveFilter(tab.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${
                activeFilter === tab.key
                  ? 'bg-[#0b57d0] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-[#0b57d0] dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <span><AnimatedEmojiText text={tab.label} /></span>
              <span>{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="max-h-[56vh] overflow-y-auto p-3">
          {visibleReactions.length ? (
            <div className="space-y-1">
              {visibleReactions.map((reaction, index) => {
                const reactor = reaction.userId || {};
                const name = reactor.name || 'Member';
                return (
                  <div key={`${getEntityId(reactor) || name}-${reaction.emoji}-${index}`} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-900">
                    <div className="relative shrink-0">
                      <Avatar user={reactor} size="h-11 w-11" onClick={onProfileClick} />
                      <span className="reaction-motion-zone absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-white text-sm shadow ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                        <AnimatedEmojiText text={reaction.emoji} />
                      </span>
                    </div>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onProfileClick?.(reactor)}
                        className="block max-w-full truncate text-left text-sm font-black text-slate-950 transition hover:text-[#0b57d0] dark:text-white dark:hover:text-sky-200"
                      >
                        {name}
                      </button>
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Reacted with <AnimatedEmojiText text={reaction.emoji} /></p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              No reactors in this filter.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const Avatar = React.memo(function Avatar({ user, size = 'h-11 w-11', onClick }) {
  const avatar = resolveMediaUrl(user?.avatar);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [avatar]);
  const avatarContent = (
    <DeveloperAvatarFrame user={user} className="comment-avatar-frame">
      <span className={`${size} grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#0b57d0] to-[#2387a8] text-sm font-black text-white`}>
        {avatar && !failed ? (
          <img src={avatar} alt={user?.name || 'User'} onError={() => setFailed(true)} className="h-full w-full object-cover" />
        ) : (user?.name || 'U').charAt(0).toUpperCase()}
      </span>
    </DeveloperAvatarFrame>
  );
  if (!onClick) return avatarContent;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick(user);
      }}
      className="shrink-0 rounded-full transition hover:ring-2 hover:ring-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-300"
      aria-label={`View ${user?.name || 'member'} profile`}
    >
      {avatarContent}
    </button>
  );
}, (prev, next) => (
  prev.size === next.size
  && prev.onClick === next.onClick
  && getEntityId(prev.user) === getEntityId(next.user)
  && prev.user?.name === next.user?.name
  && prev.user?.avatar === next.user?.avatar
  && prev.user?.isDeveloper === next.user?.isDeveloper
));

function PrivacyPill({ value = 'public' }) {
  const option = privacyOptions[value] || privacyOptions.public;
  const Icon = option.icon;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <Icon size={11} />
      {option.label}
    </span>
  );
}

const FeedVideoPlayer = React.memo(function FeedVideoPlayer({
  src,
  title = 'Post video',
  className = '',
  videoClassName = '',
  videoKey = '',
  eager = false,
  compactPlaceholder = false,
  autoPlay = false,
  activeVideoKey = '',
  onVideoPlay = () => {}
}) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef(null);
  const [viewportRef, isNearViewport] = useNearViewport('900px', eager);
  const resolvedSrc = resolveMediaUrl(src);
  const ownVideoKey = videoKey || resolvedSrc;
  const shouldMountVideo = Boolean(isNearViewport || activeVideoKey === ownVideoKey);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ownVideoKey) return;
    if (activeVideoKey !== ownVideoKey && !video.paused) video.pause();
  }, [activeVideoKey, ownVideoKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (isNearViewport || !video || video.paused) return;
    video.pause();
  }, [isNearViewport]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !shouldMountVideo || !autoPlay || !resolvedSrc || !ownVideoKey || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      const currentVideo = videoRef.current;
      if (!currentVideo) return;

      if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
        currentVideo.defaultMuted = false;
        currentVideo.muted = false;
        onVideoPlay(ownVideoKey);
        const playPromise = currentVideo.play();
        if (playPromise?.catch) playPromise.catch(() => {});
      } else if (!currentVideo.paused) {
        currentVideo.pause();
      }
    }, { threshold: [0, 0.35, 0.65, 1] });

    observer.observe(video);
    return () => observer.disconnect();
  }, [autoPlay, onVideoPlay, ownVideoKey, resolvedSrc, shouldMountVideo]);

  if (!resolvedSrc) return null;

  if (!shouldMountVideo) {
    return (
      <div ref={viewportRef} className={`feed-video-player feed-video-placeholder ${compactPlaceholder ? 'feed-video-placeholder--compact' : ''} grid min-h-52 place-items-center overflow-hidden rounded-2xl bg-slate-950 p-5 text-center ring-1 ring-slate-200 dark:ring-slate-800 ${className}`}>
        <div>
          <Video className="mx-auto text-white/80" size={30} />
          <p className="mt-3 text-sm font-black text-white">{title}</p>
        </div>
      </div>
    );
  }

  if (failed) {
    return (
      <div ref={viewportRef} className={`grid min-h-52 place-items-center rounded-2xl border border-slate-200 bg-slate-950 p-5 text-center dark:border-slate-800 ${className}`}>
        <div>
          <Video className="mx-auto text-white/80" size={30} />
          <p className="mt-3 text-sm font-black text-white">Video preview unavailable</p>
          <a
            href={resolvedSrc}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-950"
          >
            Open video
          </a>
        </div>
      </div>
    );
  }

  return (
    <div ref={viewportRef} className={`feed-video-player overflow-hidden rounded-2xl bg-black ring-1 ring-slate-200 dark:ring-slate-800 ${className}`}>
      <video
        ref={videoRef}
        src={resolvedSrc}
        controls
        defaultMuted={false}
        playsInline
        preload="metadata"
        title={title}
        onPlay={() => onVideoPlay(ownVideoKey)}
        onError={() => setFailed(true)}
        controlsList="nodownload"
        className={`feed-video-element block max-h-[32rem] w-full bg-black object-contain ${videoClassName}`}
      />
    </div>
  );
}, (prev, next) => (
  prev.src === next.src
  && prev.title === next.title
  && prev.className === next.className
  && prev.videoClassName === next.videoClassName
  && prev.videoKey === next.videoKey
  && prev.eager === next.eager
  && prev.compactPlaceholder === next.compactPlaceholder
  && prev.autoPlay === next.autoPlay
  && prev.activeVideoKey === next.activeVideoKey
));

const FeedImage = React.memo(function FeedImage({ src, alt, className = '', onClick, eager = false, sizes = '(max-width: 767px) 92vw, 640px' }) {
  const [failed, setFailed] = useState(false);
  const [viewportRef, isNearViewport] = useNearViewport('650px', eager);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`grid min-h-44 w-full place-items-center bg-slate-100 p-5 text-center text-slate-500 dark:bg-slate-900 dark:text-slate-400 ${className}`}
      >
        <span>
          <ImageIcon className="mx-auto" size={28} />
          <span className="mt-2 block text-xs font-black uppercase">Media unavailable</span>
        </span>
      </button>
    );
  }

  if (!isNearViewport) {
    return (
      <span
        ref={viewportRef}
        aria-label={alt}
        className={`feed-media-image-placeholder block min-h-52 w-full bg-slate-200/80 dark:bg-slate-900 ${className}`}
      />
    );
  }

  return (
    <img
      ref={viewportRef}
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={eager ? 'high' : 'auto'}
      sizes={sizes}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}, (prev, next) => (
  prev.src === next.src
  && prev.alt === next.alt
  && prev.className === next.className
  && prev.eager === next.eager
  && prev.sizes === next.sizes
));

const hasVideoAttachments = (attachments = []) => (
  attachments.some(attachment => attachment?.fileType === 'video')
);

const FeedMediaGrid = React.memo(function FeedMediaGrid({
  attachments = [],
  title = 'Post media',
  mediaGroupKey = 'post',
  eagerMedia = false,
  autoPlayVideos = false,
  activeVideoKey = '',
  onVideoPlay = () => {},
  onOpenMedia = () => {}
}) {
  const visible = useMemo(() => attachments.slice(0, 4), [attachments]);
  const hiddenCount = Math.max(0, attachments.length - visible.length);
  const isSingle = attachments.length === 1;
  const viewerItems = useMemo(() => attachments.map((attachment, index) => {
    const fileType = attachment.fileType === 'video' ? 'video' : 'image';
    const url = resolveMediaUrl(attachment.fileUrl);
    return {
      type: fileType,
      url,
      name: attachment.fileName || `${title} ${index + 1}`
    };
  }).filter(item => item.url), [attachments, title]);

  return (
    <div className={`feed-media-grid space-y-2 ${isSingle ? 'feed-media-grid--single' : 'feed-media-grid--multi'}`}>
      {attachments.length > 1 && (
        <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50">
          <ImageIcon size={14} />
          {attachments.length} media
        </div>
      )}
      <div className={`grid gap-2 ${isSingle ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {visible.map((attachment, index) => {
          const fileType = attachment.fileType === 'video' ? 'video' : attachment.fileType === 'image' ? 'image' : '';
          const src = fileType === 'image'
            ? resolveMediaVariantUrl(attachment, isSingle ? ['feed', 'large', 'thumb'] : ['thumb', 'feed', 'large'])
            : resolveMediaUrl(attachment.fileUrl);
          const label = attachment.fileName || title;
          const showHiddenOverlay = hiddenCount > 0 && index === visible.length - 1;
          const tileClass = isSingle ? '' : 'aspect-square min-h-0';
          return (
            <div
              key={`${attachment.fileUrl}-${index}`}
              className={`feed-media-tile relative overflow-hidden rounded-2xl bg-slate-950 ring-1 ring-slate-200 dark:ring-slate-800 ${fileType === 'image' ? 'cursor-pointer' : ''} ${tileClass}`}
              onClick={() => fileType === 'image' && onOpenMedia(index, viewerItems)}
            >
              {fileType === 'video' ? (
                <FeedVideoPlayer
                  src={src}
                  title={label}
                  videoKey={`${mediaGroupKey}-${index}-${src}`}
                  eager={eagerMedia}
                  compactPlaceholder={!isSingle}
                  autoPlay={autoPlayVideos && isSingle}
                  activeVideoKey={activeVideoKey}
                  onVideoPlay={onVideoPlay}
                  className={`h-full w-full rounded-none ring-0 ${isSingle ? '' : 'min-h-full'}`}
                  videoClassName={isSingle ? 'max-h-[32rem]' : 'h-full max-h-none object-cover'}
                />
              ) : (
                <FeedImage
                  src={src}
                  alt={label}
                  eager={eagerMedia}
                  sizes={isSingle ? '(max-width: 767px) 92vw, 680px' : '(max-width: 767px) 46vw, 320px'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenMedia(index, viewerItems);
                  }}
                  className={`feed-media-image ${isSingle ? 'max-h-[34rem] object-contain' : 'h-full object-cover'} w-full bg-slate-950`}
                />
              )}
              {showHiddenOverlay && (
                <div className="absolute inset-0 grid place-items-center bg-slate-950/70 text-3xl font-black text-white backdrop-blur-sm">
                  +{hiddenCount}
                </div>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenMedia(index, viewerItems);
                }}
                className="absolute right-2 top-2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-black text-white shadow-lg backdrop-blur transition hover:bg-black/75"
              >
                Open
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}, (prev, next) => (
  prev.attachments === next.attachments
  && prev.title === next.title
  && prev.mediaGroupKey === next.mediaGroupKey
  && prev.eagerMedia === next.eagerMedia
  && prev.autoPlayVideos === next.autoPlayVideos
  && (!hasVideoAttachments(prev.attachments) || prev.activeVideoKey === next.activeVideoKey)
));

export default function HomeFeed({
  currentUser,
  mobileTopSlot = null,
  mobileOverviewSlot = null,
  mobileAfterFirstPost = null,
  mobileVariant = 'default'
}) {
  const useMobileHomeLayout = mobileVariant === 'facebook';
  const mobileHomeVisibilityClass = useMobileHomeLayout ? '' : 'md:hidden';
  const desktopComposerVisibilityClass = useMobileHomeLayout ? 'hidden' : 'hidden md:block';
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [privacy, setPrivacy] = useState('public');
  const [mediaItems, setMediaItems] = useState([]);
  const [composerBackground, setComposerBackground] = useState('');
  const [composerMood, setComposerMood] = useState('');
  const [composerActivity, setComposerActivity] = useState('');
  const [composerTaggedUsers, setComposerTaggedUsers] = useState([]);
  const [friendOptions, setFriendOptions] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [visibleCount, setVisibleCount] = useState(getInitialFeedVisibleCount);
  const [reactionBursts, setReactionBursts] = useState({});
  const [commentReactionBursts, setCommentReactionBursts] = useState({});
  const [reactionViewer, setReactionViewer] = useState(null);
  const [autoPlayVideos, setAutoPlayVideos] = useState(readVideoAutoplayPreference);
  const [activeVideoKey, setActiveVideoKey] = useState('');
  const [mobileComposerOpen, setMobileComposerOpen] = useState(false);
  const [activeReactionPostId, setActiveReactionPostId] = useState('');
  const [reactionTrayAnchor, setReactionTrayAnchor] = useState(null);
  const [commentReplyTargets, setCommentReplyTargets] = useState({});
  const [activeCommentPostId, setActiveCommentPostId] = useState('');
  const [activePostOptionsId, setActivePostOptionsId] = useState('');
  const [hiddenPostIds, setHiddenPostIds] = useState(() => new Set());
  const [mediaViewer, setMediaViewer] = useState(null);
  const [uploadQueue, setUploadQueue] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [feedCursor, setFeedCursor] = useState('');
  const [feedHasMoreRemote, setFeedHasMoreRemote] = useState(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);

  const composerInputRef = useRef(null);
  const commentInputRefs = useRef({});
  const mediaItemsRef = useRef([]);
  const reactionPressTimerRef = useRef(null);
  const reactionPickerOpenedByPressRef = useRef(false);
  const postReactionInFlightRef = useRef(new Set());
  const postReactionButtonRefs = useRef({});
  const postReactionPickerRefs = useRef({});
  const deepLinkHandledRef = useRef(false);
  const uploadProgressFrameRef = useRef(null);
  const pendingUploadProgressRef = useRef({ progress: 0, label: '' });
  const feedIdleRevealRef = useRef(null);
  const feedCursorRef = useRef('');
  const feedHasMoreRemoteRef = useRef(false);
  const loadingMorePostsRef = useRef(false);
  const feedRequestControllerRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);
  const feedAutoLoadAtRef = useRef(0);
  const currentUserId = getEntityId(currentUser);
  const canModeratePosts = Boolean(currentUser?.isDeveloper);
  const canPost = Boolean(composerText.trim() || mediaItems.length) && !posting;
  const filteredPosts = useMemo(
    () => posts.filter(post => !hiddenPostIds.has(getEntityId(post))),
    [hiddenPostIds, posts]
  );
  const visiblePosts = useMemo(
    () => filteredPosts.slice(0, visibleCount),
    [filteredPosts, visibleCount]
  );
  const hasMoreVisiblePosts = visibleCount < filteredPosts.length;
  const hasMoreFeedPosts = hasMoreVisiblePosts || feedHasMoreRemote;
  const visiblePostStep = getInitialFeedVisibleCount();
  const activeReactionPost = useMemo(
    () => posts.find(post => getEntityId(post) === activeReactionPostId),
    [activeReactionPostId, posts]
  );
  const activeCommentPost = useMemo(
    () => posts.find(post => getEntityId(post) === activeCommentPostId),
    [activeCommentPostId, posts]
  );
  const mediaViewerPost = useMemo(
    () => posts.find(post => getEntityId(post) === mediaViewer?.postId),
    [mediaViewer?.postId, posts]
  );
  const PrivacySelectIcon = privacyOptions[privacy]?.icon || Globe2;

  const isMobileReactionMode = () => (
    typeof window !== 'undefined'
    && (
      document.documentElement.classList.contains('syncrova-native-app')
      || window.matchMedia?.('(pointer: coarse), (max-width: 767px)').matches
    )
  );

  const handleFeedVideoPlay = useCallback((videoKey) => {
    if (videoKey) setActiveVideoKey(videoKey);
  }, []);

  const queueUploadProgress = useCallback((progress, label = '') => {
    pendingUploadProgressRef.current = { progress, label };
    if (uploadProgressFrameRef.current || typeof window === 'undefined') return;

    uploadProgressFrameRef.current = window.requestAnimationFrame(() => {
      uploadProgressFrameRef.current = null;
      const next = pendingUploadProgressRef.current;
      setUploadProgress(next.progress);
      setUploadQueue(prev => (
        prev?.status === 'uploading'
          ? { ...prev, progress: next.progress, ...(next.label ? { label: next.label } : {}) }
          : prev
      ));
    });
  }, []);

  const openProfile = useCallback((person) => {
    if (!getEntityId(person)) return;
    setProfileUser(person);
  }, []);

  const toggleVideoAutoplay = () => {
    const nextValue = !autoPlayVideos;
    setAutoPlayVideos(nextValue);
    saveVideoAutoplayPreference(nextValue);
    window.dispatchEvent(new CustomEvent('syncrova:video-autoplay-change', { detail: { enabled: nextValue } }));
    if (!nextValue) setActiveVideoKey('');
  };

  useEffect(() => {
    const syncAutoplayPreference = () => setAutoPlayVideos(readVideoAutoplayPreference());
    window.addEventListener('syncrova:video-autoplay-change', syncAutoplayPreference);
    window.addEventListener('storage', syncAutoplayPreference);
    return () => {
      window.removeEventListener('syncrova:video-autoplay-change', syncAutoplayPreference);
      window.removeEventListener('storage', syncAutoplayPreference);
    };
  }, []);

  useEffect(() => {
    mediaItemsRef.current = mediaItems;
  }, [mediaItems]);

  useEffect(() => () => {
    mediaItemsRef.current.forEach(item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    if (uploadProgressFrameRef.current) window.cancelAnimationFrame(uploadProgressFrameRef.current);
    cancelIdleWork(feedIdleRevealRef.current);
    feedRequestControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    cancelIdleWork(feedIdleRevealRef.current);
    feedIdleRevealRef.current = null;

    if (loading || !hasMoreVisiblePosts) return undefined;
    const idleLimit = Math.min(filteredPosts.length, getFeedIdleVisibleLimit());
    if (visibleCount >= idleLimit) return undefined;

    feedIdleRevealRef.current = requestIdleWork(() => {
      React.startTransition(() => {
        setVisibleCount(count => Math.min(idleLimit, count + (isTouchFeedViewport() ? 2 : 3)));
      });
      feedIdleRevealRef.current = null;
    }, { timeout: 900 });

    return () => {
      cancelIdleWork(feedIdleRevealRef.current);
      feedIdleRevealRef.current = null;
    };
  }, [filteredPosts.length, hasMoreVisiblePosts, loading, visibleCount]);

  useEffect(() => () => {
    window.clearTimeout(reactionPressTimerRef.current);
  }, []);

  const loadFeed = useCallback(async ({ silent = false, append = false } = {}) => {
    const cursor = append ? feedCursorRef.current : '';
    if (append) {
      if (loadingMorePostsRef.current || !feedHasMoreRemoteRef.current || !cursor) return;
      loadingMorePostsRef.current = true;
      setLoadingMorePosts(true);
    } else {
      feedCursorRef.current = '';
      feedHasMoreRemoteRef.current = false;
      setFeedCursor('');
      setFeedHasMoreRemote(false);
      if (!silent) setLoading(true);
    }

    if (!append) feedRequestControllerRef.current?.abort();
    const controller = new AbortController();
    feedRequestControllerRef.current = controller;

    try {
      const params = new URLSearchParams({
        limit: String(getFeedLoadLimit()),
        paged: '1'
      });
      if (isTouchFeedViewport()) params.set('summary', '1');
      if (cursor) params.set('cursor', cursor);
      const res = await api.get(`/posts/home?${params.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const page = normalizeFeedPage(res.data);
      const nextPosts = shufflePosts(page.items || []);
      const hasMoreRemote = Boolean(page.hasMore && page.nextCursor);
      feedCursorRef.current = page.nextCursor || '';
      feedHasMoreRemoteRef.current = hasMoreRemote;
      React.startTransition(() => {
        setFeedCursor(page.nextCursor || '');
        setFeedHasMoreRemote(hasMoreRemote);
        setPosts(previous => (append ? mergePostsById(previous, nextPosts) : nextPosts));
        setVisibleCount(count => (
          append
            ? count + Math.min(getInitialFeedVisibleCount(), Math.max(0, nextPosts.length))
            : Math.max(getInitialFeedVisibleCount(), Math.min(count, nextPosts.length || getInitialFeedVisibleCount()))
        ));
      });
    } catch (err) {
      if (controller.signal.aborted || err?.code === 'ERR_CANCELED') return;
      toast.error(err.response?.data?.msg || 'Failed to load home feed');
    } finally {
      const ownsRequest = feedRequestControllerRef.current === controller;
      if (ownsRequest) feedRequestControllerRef.current = null;
      if (append) {
        loadingMorePostsRef.current = false;
        setLoadingMorePosts(false);
      } else if (!silent && ownsRequest) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    api.get('/friends/summary', { signal: controller.signal })
      .then(res => {
        if (cancelled) return;
        const friends = (res.data?.friends || [])
          .map(item => item.user)
          .filter(Boolean);
        setFriendOptions(friends);
      })
      .catch(error => {
        if (!cancelled && error?.code !== 'ERR_CANCELED') setFriendOptions([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const refresh = () => loadFeed({ silent: true });
    window.addEventListener('syncrova:mobile-refresh', refresh);
    return () => window.removeEventListener('syncrova:mobile-refresh', refresh);
  }, [loadFeed]);

  useEffect(() => {
    if (!mobileComposerOpen) return undefined;
    const handleNativeBack = (event) => {
      event.preventDefault();
      setMobileComposerOpen(false);
    };
    window.addEventListener('syncrova:native-back', handleNativeBack);
    return () => window.removeEventListener('syncrova:native-back', handleNativeBack);
  }, [mobileComposerOpen]);

  useEffect(() => {
    if (!activeReactionPostId) return undefined;
    const closePicker = (event) => {
      if (event.target?.closest?.('.mobile-reaction-tray, .feed-reaction-picker-shell, .feed-reaction-button')) return;
      setActiveReactionPostId('');
      setReactionTrayAnchor(null);
    };
    const closeOnScroll = () => {
      setActiveReactionPostId('');
      setReactionTrayAnchor(null);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setActiveReactionPostId('');
      setReactionTrayAnchor(null);
      postReactionButtonRefs.current[activeReactionPostId]?.focus();
    };
    window.addEventListener('pointerdown', closePicker, true);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closePicker, true);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [activeReactionPostId]);

  useEffect(() => {
    if (!activePostOptionsId) return undefined;
    const closeOptions = (event) => {
      if (event.target?.closest?.('.feed-post-options, [aria-label="Post options"]')) return;
      setActivePostOptionsId('');
    };
    window.addEventListener('pointerdown', closeOptions, true);
    return () => window.removeEventListener('pointerdown', closeOptions, true);
  }, [activePostOptionsId]);

  useEffect(() => {
    if (deepLinkHandledRef.current || !posts.length || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const targetPostId = params.get('post');
    if (!targetPostId) return;
    const targetIndex = posts.findIndex(post => getEntityId(post) === targetPostId);
    if (targetIndex < 0) {
      deepLinkHandledRef.current = true;
      api.get(`/posts/${targetPostId}`)
        .then(res => {
          const targetPost = res.data;
          React.startTransition(() => {
            setPosts(prev => mergePostsById([targetPost], prev));
            setVisibleCount(count => Math.max(count, 1));
          });
          window.setTimeout(() => {
            document.getElementById(`post-${targetPostId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            if (params.get('comment') || isMobileReactionMode()) setActiveCommentPostId(targetPostId);
          }, 120);
        })
        .catch(() => {});
      return;
    }

    deepLinkHandledRef.current = true;
    setVisibleCount(count => Math.max(count, targetIndex + 1));
    window.setTimeout(() => {
      document.getElementById(`post-${targetPostId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (params.get('comment') || isMobileReactionMode()) setActiveCommentPostId(targetPostId);
    }, 120);
  }, [posts]);

  const updatePost = (nextPost) => {
    setPosts(prev => prev.map(post => getEntityId(post) === getEntityId(nextPost) ? nextPost : post));
  };

  const triggerBurst = (setter, key, emoji) => {
    if (!key || !emoji) return;
    setter(prev => ({ ...prev, [key]: emoji }));
    window.setTimeout(() => {
      setter(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 720);
  };

  const openReactionViewer = (title, reactions = []) => {
    if (!reactions.length) return;
    setReactionViewer({ title, reactions });
  };

  const clearMedia = () => {
    mediaItems.forEach(item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setMediaItems([]);
    setUploadProgress(0);
  };

  const resetComposerDetails = () => {
    setComposerText('');
    setComposerBackground('');
    setComposerMood('');
    setComposerActivity('');
    setComposerTaggedUsers([]);
  };

  const updateComposerText = (value) => {
    setComposerText(value);
  };

  const addTaggedUser = (userToTag) => {
    const userId = getEntityId(userToTag);
    if (!userId || composerTaggedUsers.some(item => getEntityId(item) === userId)) return;
    setComposerTaggedUsers(prev => [...prev, userToTag].slice(0, 8));
  };

  const removeTaggedUser = (userId) => {
    setComposerTaggedUsers(prev => prev.filter(item => getEntityId(item) !== userId));
  };

  const removeMediaItem = (itemId) => {
    setMediaItems(prev => {
      const target = prev.find(item => item.id === itemId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(item => item.id !== itemId);
    });
  };

  const moveMediaItem = (itemId, direction) => {
    setMediaItems(prev => {
      const index = prev.findIndex(item => item.id === itemId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const selectMedia = (files) => {
    const nextFiles = Array.from(files || []).filter(Boolean);
    if (!nextFiles.length) return;

    const invalidFile = nextFiles.find(file => !getLocalMediaType(file));
    if (invalidFile) {
      toast.error('Home posts support photos and videos');
      return;
    }
    const tooLargeFile = nextFiles.find(file => file.size > MAX_HOME_POST_UPLOAD);
    if (tooLargeFile) {
      toast.error(`${tooLargeFile.name} is too large. Maximum size is 35MB per file.`);
      return;
    }

    clearMedia();
    setMediaItems(nextFiles.slice(0, 12).map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified || Date.now()}-${index}`,
      file,
      fileType: getLocalMediaType(file),
      previewUrl: URL.createObjectURL(file)
    })));
  };

  const createPost = async (event) => {
    event.preventDefault();
    if (!canPost) return;

    setPosting(true);
    setUploadProgress(0);
    setUploadQueue({
      status: 'uploading',
      label: mediaItems.length ? `Uploading ${getCountLabel(mediaItems.length, 'file')}` : 'Publishing post',
      progress: mediaItems.length ? 1 : 0
    });
    let completed = false;
    try {
      let attachments = [];
      if (mediaItems.length) {
        attachments = await Promise.all(mediaItems.map(async (item, index) => {
          const uploadFile = item.fileType === 'image'
            ? await optimizeImageFile(item.file, { maxDimension: 2048, quality: 0.88, minBytes: 700 * 1024 })
            : item.file;
          const formData = new FormData();
          formData.append('file', uploadFile);
          const uploadRes = await api.post('/posts/upload', formData, {
            onUploadProgress: (progressEvent) => {
              if (!progressEvent.total) return;
              const fileProgress = progressEvent.loaded / progressEvent.total;
              const nextProgress = Math.round(((index + fileProgress) / mediaItems.length) * 100);
              queueUploadProgress(nextProgress, `Uploading ${index + 1} of ${mediaItems.length}`);
            }
          });
          return uploadRes.data || {};
        }));
      }

      const text = String(composerText || composerInputRef.current?.value || '').trim();
      const primaryAttachment = attachments[0] || {};
      const res = await api.post('/posts/home', {
        title: getPostTitle(text, mediaItems.length ? mediaItems[0].file.name : 'Timeline post'),
        content: text,
        privacy,
        background: composerBackground,
        mood: composerMood,
        activity: composerActivity,
        taggedUsers: composerTaggedUsers.map(item => getEntityId(item)).filter(Boolean),
        attachments,
        ...primaryAttachment
      });
      setPosts(prev => shufflePosts([res.data, ...prev]));
      if (composerInputRef.current) composerInputRef.current.value = '';
      resetComposerDetails();
      clearMedia();
      setMobileComposerOpen(false);
      toast.success('Posted');
      completed = true;
    } catch (err) {
      const message = err.response?.data?.msg || (navigator.onLine === false ? 'You appear offline. Connect and retry.' : 'Post failed. Check your connection and retry.');
      setUploadQueue({
        status: 'error',
        label: 'Upload failed',
        message,
        progress: uploadProgress || 0
      });
      toast.error(message);
    } finally {
      setPosting(false);
      if (completed) {
        setUploadProgress(0);
        window.setTimeout(() => setUploadQueue(null), 600);
      }
    }
  };

  const reactToPost = async (post, emoji) => {
    const postId = getEntityId(post);
    if (!postId || postReactionInFlightRef.current.has(postId)) return;
    postReactionInFlightRef.current.add(postId);
    const previousPost = post;
    try {
      triggerBurst(setReactionBursts, postId, emoji);
      updatePost(applyOptimisticPostReaction(post, emoji, currentUser));
      const res = await api.post(`/posts/${postId}/react`, { emoji });
      updatePost(res.data);
    } catch (err) {
      updatePost(previousPost);
      toast.error(err.response?.data?.msg || 'Reaction failed');
    } finally {
      postReactionInFlightRef.current.delete(postId);
    }
  };

  const clearReactionPressTimer = () => {
    window.clearTimeout(reactionPressTimerRef.current);
    reactionPressTimerRef.current = null;
  };

  const getReactionTrayAnchor = (anchorElement) => {
    if (typeof window === 'undefined' || !anchorElement?.getBoundingClientRect) return null;
    const rect = anchorElement.getBoundingClientRect();
    const viewportPadding = 8;
    const trayWidth = Math.min(window.innerWidth - (viewportPadding * 2), 348);
    const trayHeight = 54;
    const left = Math.min(
      Math.max(rect.left + (rect.width / 2) - (trayWidth / 2), viewportPadding),
      Math.max(viewportPadding, window.innerWidth - trayWidth - viewportPadding)
    );
    const canPlaceAbove = rect.top >= trayHeight + viewportPadding;
    const top = canPlaceAbove
      ? rect.top - viewportPadding
      : Math.min(window.innerHeight - trayHeight - viewportPadding, rect.bottom + viewportPadding);
    return { left, top, placement: canPlaceAbove ? 'above' : 'below' };
  };

  const openReactionPicker = (postId, anchorElement = null) => {
    if (!postId) return;
    setReactionTrayAnchor(getReactionTrayAnchor(anchorElement));
    setActiveReactionPostId(postId);
  };

  const handleReactionPressStart = (postId, anchorElement = null) => {
    if (!isMobileReactionMode()) return;
    clearReactionPressTimer();
    reactionPressTimerRef.current = window.setTimeout(() => {
      reactionPickerOpenedByPressRef.current = true;
      openReactionPicker(postId, anchorElement);
      if (navigator.vibrate) navigator.vibrate(12);
    }, 260);
  };

  const handleReactionButtonClick = (post, anchorElement = null) => {
    const postId = getEntityId(post);
    if (isMobileReactionMode()) {
      if (reactionPickerOpenedByPressRef.current) {
        reactionPickerOpenedByPressRef.current = false;
        return;
      }
      setActiveReactionPostId(prev => {
        if (prev === postId) {
          setReactionTrayAnchor(null);
          return '';
        }
        setReactionTrayAnchor(getReactionTrayAnchor(anchorElement));
        return postId;
      });
      return;
    }
    const myReaction = post.reactions?.find(reaction => getEntityId(reaction.userId) === currentUserId);
    reactToPost(post, myReaction?.emoji || QUICK_REACTIONS[0]);
  };

  const choosePostReaction = (post, emoji) => {
    reactToPost(post, emoji);
    reactionPickerOpenedByPressRef.current = false;
    setActiveReactionPostId('');
    setReactionTrayAnchor(null);
  };

  const handlePostReactionPickerKeyDown = (event, postId) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setActiveReactionPostId('');
      setReactionTrayAnchor(null);
      postReactionButtonRefs.current[postId]?.focus();
      return;
    }

    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
    const currentIndex = buttons.indexOf(document.activeElement);
    if (currentIndex < 0 || !buttons.length) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  const handlePostReactionButtonKeyDown = (event, post) => {
    if (!['ArrowDown', ' '].includes(event.key)) return;
    event.preventDefault();
    const postId = getEntityId(post);
    if (!postId) return;
    if (isMobileReactionMode()) {
      openReactionPicker(postId, event.currentTarget);
      window.requestAnimationFrame(() => postReactionPickerRefs.current[postId]?.querySelector('[role="menuitem"]')?.focus());
      return;
    }
    window.requestAnimationFrame(() => postReactionPickerRefs.current[postId]?.querySelector('[role="menuitem"]')?.focus());
  };

  const revealMorePosts = useCallback(() => {
    React.startTransition(() => {
      setVisibleCount(count => count + visiblePostStep);
    });
  }, [visiblePostStep]);

  const loadMoreFeedPosts = useCallback(() => {
    if (hasMoreVisiblePosts) {
      revealMorePosts();
      return;
    }
    loadFeed({ append: true, silent: true });
  }, [hasMoreVisiblePosts, loadFeed, revealMorePosts]);

  useEffect(() => {
    const node = loadMoreSentinelRef.current;
    if (!node || loading || loadingMorePosts || !hasMoreFeedPosts || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      const now = Date.now();
      if (now - feedAutoLoadAtRef.current < 550) return;
      feedAutoLoadAtRef.current = now;
      loadMoreFeedPosts();
    }, { rootMargin: '760px 0px 760px 0px', threshold: 0.01 });

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreFeedPosts, loadMoreFeedPosts, loading, loadingMorePosts]);

  const reactToComment = async (post, comment, emoji) => {
    const postId = getEntityId(post);
    const commentId = getCommentId(comment);
    if (!postId || !commentId) return;

    try {
      triggerBurst(setCommentReactionBursts, `${postId}:${commentId}`, emoji);
      const res = await api.post(`/posts/${postId}/comments/${commentId}/react`, { emoji });
      updatePost(res.data);
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Comment reaction failed');
    }
  };

  const deletePost = async (post) => {
    try {
      await api.delete(`/posts/${getEntityId(post)}`);
      setPosts(prev => prev.filter(item => getEntityId(item) !== getEntityId(post)));
      toast.success('Post deleted');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Delete failed');
    }
  };

  const addComment = async (event, post) => {
    event.preventDefault();
    const postId = getEntityId(post);
    const text = String(commentDrafts[postId] || '').trim();
    if (!text) return;
    const replyTarget = commentReplyTargets[postId];
    const replyTo = getCommentId(replyTarget);

    try {
      const res = await api.post(`/posts/${postId}/comment`, { text, replyTo: replyTo || undefined });
      updatePost(res.data);
      setCommentDrafts(prev => ({ ...prev, [postId]: '' }));
      setCommentReplyTargets(prev => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Comment failed');
    }
  };

  const openCommentsForPost = async (postId) => {
    if (!postId) return;
    const post = posts.find(item => getEntityId(item) === postId);
    if (isMobileReactionMode()) {
      setActiveCommentPostId(postId);
      if (post?.commentsTruncated) {
        try {
          const res = await api.get(`/posts/${postId}`);
          updatePost(res.data);
        } catch (err) {
          toast.error(err.response?.data?.msg || 'Failed to load comments');
        }
      }
      return;
    }
    if (post?.commentsTruncated) {
      try {
        const res = await api.get(`/posts/${postId}`);
        updatePost(res.data);
      } catch {
        // Keep the preview comments visible if the full post fetch fails.
      }
    }
    commentInputRefs.current[postId]?.focus();
  };

  const sharePost = async (post) => {
    const postId = getEntityId(post);
    const text = `${post.userId?.name || 'Syncrova'}: ${post.title || 'Post'}`;
    const url = `${window.location.origin}/dashboard`;
    try {
      if (navigator.share) await navigator.share({ title: 'Syncrova post', text, url });
      else {
        await navigator.clipboard.writeText(url);
      }
      const res = await api.post(`/posts/${postId}/share`);
      updatePost(res.data);
      toast.success(navigator.share ? 'Post shared' : 'Post link copied');
    } catch {
      // Native share sheet was cancelled.
    }
  };

  const savePost = async (post) => {
    const postId = getEntityId(post);
    if (!postId) return;
    try {
      const res = await api.put(`/posts/${postId}/save`);
      updatePost(res.data);
      const saved = (res.data?.savedBy || []).some(userId => getEntityId(userId) === currentUserId);
      toast.success(saved ? 'Post saved' : 'Post removed from saved');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Save failed');
    } finally {
      setActivePostOptionsId('');
    }
  };

  const copyPostLink = async (post) => {
    const postId = getEntityId(post);
    const url = `${window.location.origin}/dashboard?post=${encodeURIComponent(postId)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Post link copied');
    } catch {
      toast.error('Could not copy link');
    } finally {
      setActivePostOptionsId('');
    }
  };

  const hidePost = (post) => {
    const postId = getEntityId(post);
    setHiddenPostIds(prev => new Set([...prev, postId]));
    setActivePostOptionsId('');
    toast.success('Post hidden from this view');
  };

  const reportPost = () => {
    setActivePostOptionsId('');
    toast.success('Thanks. The report option is noted for review.');
  };

  const openMediaViewer = (post, index, items = []) => {
    if (!items.length) return;
    setMediaViewer({
      postId: getEntityId(post),
      index,
      items,
      details: post?.userId?.name || 'Post media'
    });
  };

  const renderMediaViewerActions = () => {
    if (!mediaViewerPost) return null;
    const postId = getEntityId(mediaViewerPost);
    const myReaction = mediaViewerPost.reactions?.find(reaction => getEntityId(reaction.userId) === currentUserId);

    return (
      <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white/10 p-2 text-white backdrop-blur">
        <button
          type="button"
          onClick={() => reactToPost(mediaViewerPost, myReaction?.emoji || QUICK_REACTIONS[0])}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-xs font-black hover:bg-white/20 sm:text-sm"
        >
          <SmilePlus size={16} />
          {myReaction?.emoji || 'React'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMediaViewer(null);
            setActiveCommentPostId(postId);
          }}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-xs font-black hover:bg-white/20 sm:text-sm"
        >
          <MessageCircle size={16} />
          Comment
        </button>
        <button
          type="button"
          onClick={() => sharePost(mediaViewerPost)}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-xs font-black hover:bg-white/20 sm:text-sm"
        >
          <Share2 size={16} />
          Share
        </button>
      </div>
    );
  };

  const renderComposerEnhancements = ({ compact = false } = {}) => {
    const selectedBackground = getTextBackgroundOption(composerBackground);
    const availableFriends = friendOptions.filter(friend => (
      !composerTaggedUsers.some(tagged => getEntityId(tagged) === getEntityId(friend))
    ));
    const hasPreview = Boolean(composerText.trim() || composerMood || composerActivity || composerTaggedUsers.length || composerBackground);

    return (
      <div className={`mt-3 space-y-3 ${compact ? 'text-xs' : 'text-sm'}`}>
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_12rem_13rem]">
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/70">
            <p className="mb-2 text-[11px] font-black uppercase text-slate-500 dark:text-slate-400">Background</p>
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              {TEXT_BACKGROUND_OPTIONS.map(option => (
                <button
                  key={option.id || 'clean'}
                  type="button"
                  onClick={() => setComposerBackground(option.id)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-black transition ${
                    composerBackground === option.id
                      ? 'border-[#0b57d0] bg-white text-[#0b57d0] shadow-sm dark:bg-slate-900 dark:text-sky-200'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ background: option.preview }} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/70">
            <span className="mb-2 block text-[11px] font-black uppercase text-slate-500 dark:text-slate-400">Mood</span>
            <select value={composerMood} onChange={event => setComposerMood(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 outline-none focus:border-[#0b57d0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <option value="">No mood</option>
              {MOOD_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>

          <label className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/70">
            <span className="mb-2 block text-[11px] font-black uppercase text-slate-500 dark:text-slate-400">Activity</span>
            <select value={composerActivity} onChange={event => setComposerActivity(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 outline-none focus:border-[#0b57d0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <option value="">No activity</option>
              {ACTIVITY_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/70">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400">Tag friends</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Mention classmates in the post preview and feed.</p>
            </div>
            <select
              value=""
              onChange={event => {
                const nextFriend = friendOptions.find(friend => getEntityId(friend) === event.target.value);
                if (nextFriend) addTaggedUser(nextFriend);
              }}
              className="h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 outline-none focus:border-[#0b57d0] disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-56"
              disabled={!availableFriends.length}
            >
              <option value="">{availableFriends.length ? 'Choose friend' : 'No friends to tag'}</option>
              {availableFriends.map(friend => <option key={getEntityId(friend)} value={getEntityId(friend)}>{friend.name}</option>)}
            </select>
          </div>
          {composerTaggedUsers.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {composerTaggedUsers.map(friend => (
                <button
                  key={getEntityId(friend)}
                  type="button"
                  onClick={() => removeTaggedUser(getEntityId(friend))}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-2 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700"
                >
                  <Avatar user={friend} size="h-6 w-6" />
                  {friend.name}
                  <X size={12} />
                </button>
              ))}
            </div>
          )}
        </div>

        {hasPreview && (
          <div className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm shadow-blue-100/55 dark:border-blue-900/40 dark:bg-slate-950 dark:shadow-black/20">
            <div className="border-b border-blue-50 px-3 py-2 text-[11px] font-black uppercase text-[#0b57d0] dark:border-slate-800 dark:text-sky-200">
              Post preview
            </div>
            <div className="p-3">
              <div className="flex items-center gap-2">
                <Avatar user={currentUser} size="h-9 w-9" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-950 dark:text-white">{currentUser?.name || 'You'}</p>
                  <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {privacyOptions[privacy]?.label || 'Public'}
                    {composerMood ? ` · feeling ${composerMood}` : ''}
                    {composerActivity ? ` · ${composerActivity}` : ''}
                  </p>
                </div>
              </div>
              {composerTaggedUsers.length > 0 && (
                <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                  with {composerTaggedUsers.map(friend => friend.name).join(', ')}
                </p>
              )}
              {composerText.trim() && (
                <div
                  className={`mt-3 rounded-2xl ${composerBackground ? 'px-4 py-8 text-center text-xl font-black leading-snug shadow-inner' : 'text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200'}`}
                  style={selectedBackground.style}
                >
                  {composerText}
                </div>
              )}
              {mediaItems.length > 0 && (
                <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  {getCountLabel(mediaItems.length, 'media item')} attached in one grouped post
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className={`home-feed space-y-4 ${useMobileHomeLayout ? 'home-feed--facebook-mobile' : ''}`}>
      <div className={`home-feed-composer-card rounded-2xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20 ${mobileHomeVisibilityClass}`}>
        <div className="home-feed-composer-top-row flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileComposerOpen(true)}
            className="home-feed-composer-button flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <Avatar user={currentUser} size="h-10 w-10" />
            <span className="min-w-0 flex-1 rounded-full bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              What's on your mind?
            </span>
          </button>
          <div className="home-feed-composer-inline-actions flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setMobileComposerOpen(true)} className="home-feed-composer-action" aria-label="Start live update" title="Live update">
              <Video size={17} className="text-rose-500" />
              <span className="home-feed-composer-action-label">Update</span>
            </button>
            <label className="home-feed-composer-action cursor-pointer" aria-label="Add photo" title="Add photo">
              <ImageIcon size={17} className="text-emerald-600" />
              <span className="home-feed-composer-action-label">Photo</span>
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={event => {
                  selectMedia(event.target.files);
                  setMobileComposerOpen(true);
                  event.target.value = '';
                }}
              />
            </label>
            <button type="button" onClick={() => setMobileComposerOpen(true)} className="home-feed-composer-action" aria-label="Add feeling" title="Add feeling">
              <SmilePlus size={17} className="text-amber-500" />
              <span className="home-feed-composer-action-label">Feeling</span>
            </button>
          </div>
        </div>
      </div>

      {mobileTopSlot && <div className={`home-feed-mobile-slot ${mobileHomeVisibilityClass}`}>{mobileTopSlot}</div>}

      <form onSubmit={createPost} className={`${desktopComposerVisibilityClass} overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20`}>
        <div className="p-4">
          <div className="flex items-start gap-3">
            <Avatar user={currentUser} />
            <textarea
              ref={composerInputRef}
              value={composerText}
              onChange={event => updateComposerText(event.target.value)}
              rows={3}
              placeholder={`Share something useful, ${currentUser?.name?.split(' ')[0] || 'there'}...`}
              className="min-h-[5rem] min-w-0 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] font-semibold text-slate-900 outline-none focus:border-[#0b57d0] focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:bg-slate-950"
            />
          </div>

          {renderComposerEnhancements()}

          {mediaItems.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-950 dark:text-white">
                    {mediaItems.length} media selected
                  </p>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Photos and videos will be grouped in one post
                  </p>
                </div>
                <button type="button" onClick={clearMedia} className="grid h-8 w-8 place-items-center rounded-full bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-300" aria-label="Remove media">
                  <X size={16} />
                </button>
              </div>
              <div className={`grid gap-2 p-2 ${mediaItems.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'}`}>
                {mediaItems.map((item, index) => (
                  <div key={item.id} className="relative overflow-hidden rounded-xl bg-slate-950 ring-1 ring-slate-200 dark:ring-slate-800">
                    {item.fileType === 'video' ? (
                      <FeedVideoPlayer
                        src={item.previewUrl}
                        title={item.file.name}
                        videoKey={`composer-${item.id}`}
                        eager
                        activeVideoKey={activeVideoKey}
                        onVideoPlay={handleFeedVideoPlay}
                        className="h-full max-h-80 w-full rounded-none ring-0"
                        videoClassName="max-h-80"
                      />
                    ) : (
                      <img src={item.previewUrl} alt={item.file.name} className="max-h-80 w-full object-contain" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeMediaItem(item.id)}
                      className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white backdrop-blur hover:bg-rose-600"
                      aria-label={`Remove ${item.file.name}`}
                    >
                      <X size={15} />
                    </button>
                    {mediaItems.length > 1 && (
                      <div className="absolute left-2 top-2 flex gap-1">
                        <button
                          type="button"
                          onClick={() => moveMediaItem(item.id, -1)}
                          disabled={index === 0}
                          className="grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white backdrop-blur disabled:opacity-35"
                          aria-label="Move media left"
                        >
                          <ChevronLeft size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveMediaItem(item.id, 1)}
                          disabled={index === mediaItems.length - 1}
                          className="grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white backdrop-blur disabled:opacity-35"
                          aria-label="Move media right"
                        >
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    )}
                    <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-black/60 px-2 py-1 text-[11px] font-black text-white">
                      #{index + 1} {item.fileType === 'video' ? 'Video' : 'Photo'} {formatMediaSize(item.file.size)}
                    </span>
                  </div>
                ))}
              </div>
              {posting && uploadProgress > 0 && (
                <div className="h-1.5 bg-slate-200 dark:bg-slate-800">
                  <div className="h-full bg-[#0b57d0]" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/35 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900">
              <ImageIcon size={15} />
              Photo/video
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={event => {
                  selectMedia(event.target.files);
                  event.target.value = '';
                }}
              />
            </label>
            <label className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              <PrivacySelectIcon size={15} />
              <select value={privacy} onChange={event => setPrivacy(event.target.value)} className="bg-transparent outline-none">
                <option value="public">Public</option>
                <option value="friends">Friends</option>
                <option value="private">Only me</option>
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={!canPost}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#07036f] px-5 py-2.5 text-sm font-black text-white hover:bg-[#05004f] disabled:opacity-50"
          >
            {posting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Post
          </button>
        </div>
      </form>

      {mobileComposerOpen && (
        <div className={`home-mobile-composer-backdrop fixed inset-0 z-[92] flex items-end bg-slate-950/45 ${mobileHomeVisibilityClass}`} onClick={() => setMobileComposerOpen(false)}>
          <form
            onSubmit={createPost}
            className="mobile-post-composer-sheet w-full rounded-t-[1.7rem] border border-slate-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl dark:border-slate-800 dark:bg-slate-950"
            onClick={event => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-200 dark:bg-slate-800" />
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar user={currentUser} size="h-10 w-10" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-950 dark:text-white">{currentUser?.name || 'Create post'}</p>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Share an update</p>
                </div>
              </div>
              <button type="button" onClick={() => setMobileComposerOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300" aria-label="Close composer">
                <X size={18} />
              </button>
            </div>

            <textarea
              ref={composerInputRef}
              value={composerText}
              onChange={event => updateComposerText(event.target.value)}
              rows={4}
              autoFocus
              placeholder={`Share something useful, ${currentUser?.name?.split(' ')[0] || 'there'}...`}
              className="mt-4 min-h-[8rem] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[16px] font-semibold text-slate-900 outline-none focus:border-[#0b57d0] focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />

            {renderComposerEnhancements({ compact: true })}

            {mediaItems.length > 0 && (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900">
                <div className={`grid gap-2 ${mediaItems.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {mediaItems.slice(0, 4).map((item, index) => (
                    <div key={item.id} className="feed-media-tile relative h-28 overflow-hidden rounded-xl bg-slate-950">
                      {item.fileType === 'video' ? (
                        <FeedVideoPlayer
                          src={item.previewUrl}
                          title={item.file.name}
                          videoKey={`mobile-composer-${item.id}`}
                          eager
                          activeVideoKey={activeVideoKey}
                          onVideoPlay={handleFeedVideoPlay}
                          className="h-full w-full rounded-none ring-0"
                          videoClassName="h-full max-h-none object-cover"
                        />
                      ) : (
                        <img src={item.previewUrl} alt={item.file.name} className="feed-media-image h-full w-full object-cover" />
                      )}
                      {mediaItems.length > 4 && index === 3 && (
                        <span className="absolute inset-0 grid place-items-center bg-black/55 text-xl font-black text-white">+{mediaItems.length - 4}</span>
                      )}
                      <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-black text-white">
                        #{index + 1}
                      </span>
                    </div>
                  ))}
                </div>
                {mediaItems.length > 1 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {mediaItems.map((item, index) => (
                      <div key={`order-${item.id}`} className="flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-black text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-200 dark:ring-slate-800">
                        <span>#{index + 1}</span>
                        <button type="button" onClick={() => moveMediaItem(item.id, -1)} disabled={index === 0} className="rounded-full p-1 disabled:opacity-30" aria-label="Move media earlier">
                          <ChevronLeft size={13} />
                        </button>
                        <button type="button" onClick={() => moveMediaItem(item.id, 1)} disabled={index === mediaItems.length - 1} className="rounded-full p-1 disabled:opacity-30" aria-label="Move media later">
                          <ChevronRight size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={clearMedia} className="mt-2 w-full rounded-xl bg-white py-2 text-xs font-black text-rose-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800">
                  Remove media
                </button>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <ImageIcon size={15} />
                  Media
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={event => {
                      selectMedia(event.target.files);
                      event.target.value = '';
                    }}
                  />
                </label>
                <label className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <PrivacySelectIcon size={15} />
                  <select value={privacy} onChange={event => setPrivacy(event.target.value)} className="bg-transparent outline-none">
                    <option value="public">Public</option>
                    <option value="friends">Friends</option>
                    <option value="private">Only me</option>
                  </select>
                </label>
              </div>
              <button
                type="submit"
                disabled={!canPost}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#07036f] px-5 text-sm font-black text-white disabled:opacity-50"
              >
                {posting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Post
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="home-feed-autoplay-card flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-blue-50 text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50">
            <Video size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-950 dark:text-white">Video autoplay</p>
            <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
              {autoPlayVideos ? 'On for visible feed videos' : 'Off until you press play'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => loadFeed({ silent: true })}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-blue-50 hover:text-[#0b57d0] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-blue-950/30"
          >
            <RefreshCw size={15} />
            Shuffle
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={autoPlayVideos}
            aria-label="Toggle video autoplay"
            onClick={toggleVideoAutoplay}
            className={`relative h-8 w-14 shrink-0 rounded-full p-1 transition ${
              autoPlayVideos ? 'bg-[#0b57d0]' : 'bg-slate-200 dark:bg-slate-800'
            }`}
          >
            <span className={`block h-6 w-6 rounded-full bg-white shadow-lg transition ${autoPlayVideos ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <>
          <div className={`home-feed-mobile-loading space-y-3 ${mobileHomeVisibilityClass}`}>
            {[0, 1].map(item => (
              <div key={item} className="mobile-skeleton-card rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3">
                  <span className="skeleton-block h-3.5 w-32 rounded-full bg-slate-200 dark:bg-slate-800" />
                  <span className="skeleton-block h-3 w-14 rounded-full bg-slate-200 dark:bg-slate-800" />
                </div>
                <div className="mt-4 space-y-2">
                  <span className="skeleton-block block h-3.5 w-11/12 rounded-full bg-slate-200 dark:bg-slate-800" />
                  <span className="skeleton-block block h-3.5 w-7/12 rounded-full bg-slate-200 dark:bg-slate-800" />
                </div>
                <div className="skeleton-block mt-4 aspect-[4/3] rounded-xl bg-slate-200 dark:bg-slate-800" />
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[0, 1, 2, 3].map(action => (
                    <span key={action} className="skeleton-block h-8 rounded-lg bg-slate-200 dark:bg-slate-800" />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className={`${desktopComposerVisibilityClass} space-y-4`} aria-live="polite">
            <span className="sr-only">Loading home feed</span>
            <SkeletonCard media lines={3} />
            <SkeletonCard media lines={2} />
          </div>
        </>
      ) : visiblePosts.length ? (
        <>
          {visiblePosts.map((post, postIndex) => {
            const postId = getEntityId(post);
            const author = post.userId || {};
            const attachments = getPostAttachments(post);
            const myReaction = post.reactions?.find(reaction => getEntityId(reaction.userId) === currentUserId);
            const isOwner = getEntityId(author) === currentUserId;
            const canRemovePost = isOwner || canModeratePosts;
            const shareCount = getShareCount(post);
            const commentCount = post.commentCount ?? post.comments?.length ?? 0;
            const allComments = post.comments || [];
            const replyTarget = commentReplyTargets[postId];
            const postBackground = getTextBackgroundOption(post.background);
            const hasStyledText = Boolean(post.content && post.background && attachments.length === 0);
            const taggedNames = (post.taggedUsers || []).map(person => person?.name).filter(Boolean);

            return (
              <React.Fragment key={postId}>
              <article id={`post-${postId}`} className={`feed-card mobile-facebook-post ${attachments.length ? 'feed-card--has-media' : ''} overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20`}>
                <header className="feed-card-header flex items-start gap-3 p-4">
                  <Avatar user={author} onClick={openProfile} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openProfile(author)}
                        className="min-w-0 truncate text-left font-black text-slate-950 transition hover:text-[#0b57d0] dark:text-white dark:hover:text-sky-200"
                      >
                        {author.name || 'Member'}
                      </button>
                      <DeveloperBadge user={author} compact />
                      {author.studentVerificationStatus === 'approved' && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black uppercase text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/35 dark:text-emerald-200 dark:ring-emerald-500/20" title="Official campus student">
                          <BadgeCheck size={12} />
                          Verified
                        </span>
                      )}
                      <PrivacyPill value={post.privacy} />
                    </div>
                    <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {formatFeedTime(post.createdAt)}
                      {post.mood ? ` · feeling ${post.mood}` : ''}
                      {post.activity ? ` · ${post.activity}` : ''}
                    </p>
                    {taggedNames.length > 0 && (
                      <p className="mt-0.5 line-clamp-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                        with {taggedNames.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setActivePostOptionsId(prev => (prev === postId ? '' : postId))}
                      className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-[#0b57d0] dark:text-slate-400 dark:hover:bg-slate-800"
                      aria-label="Post options"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {activePostOptionsId === postId && (
                      <div className="feed-post-options absolute right-0 top-10 z-30 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 text-sm font-bold text-slate-700 shadow-2xl shadow-slate-950/15 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                        <button type="button" onClick={() => savePost(post)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-900">
                          <Bookmark size={16} />
                          Save post
                        </button>
                        <button type="button" onClick={() => copyPostLink(post)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-900">
                          <Copy size={16} />
                          Copy link
                        </button>
                        <button type="button" onClick={() => hidePost(post)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-900">
                          <EyeOff size={16} />
                          Hide post
                        </button>
                        <button type="button" onClick={reportPost} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-900">
                          <Flag size={16} />
                          Report
                        </button>
                        {canRemovePost && (
                          <button type="button" onClick={() => deletePost(post)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/35">
                            <Trash2 size={16} />
                            {isOwner ? 'Delete' : 'Remove as developer'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </header>

                <div className="feed-card-body space-y-3 px-4 pb-4">
                  {post.content && (hasStyledText ? (
                    <div
                      className="whitespace-pre-wrap break-words rounded-2xl px-5 py-10 text-center text-2xl font-black leading-snug shadow-inner"
                      style={postBackground.style}
                    >
                      <AnimatedEmojiText text={post.content} />
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-slate-800 dark:text-slate-100"><AnimatedEmojiText text={post.content} /></p>
                  ))}
                  {attachments.length > 0 && (
                    <FeedMediaGrid
                      attachments={attachments}
                      title={post.title || 'Post media'}
                      mediaGroupKey={postId}
                      eagerMedia={postIndex < 2}
                      autoPlayVideos={autoPlayVideos}
                      activeVideoKey={activeVideoKey}
                      onVideoPlay={handleFeedVideoPlay}
                      onOpenMedia={(index, items) => openMediaViewer(post, index, items)}
                    />
                  )}
                </div>

                <div className="feed-card-stats mx-4 flex flex-wrap items-center justify-between gap-2 border-y border-slate-100 py-2 text-xs font-bold text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <ReactionSummary
                    reactions={post.reactions || []}
                    onOpen={() => openReactionViewer('Post reactions', post.reactions || [])}
                  />
                  <div className="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => openCommentsForPost(postId)}
                      className="hover:text-[#0b57d0] dark:hover:text-sky-200"
                    >
                      {commentCount ? getCountLabel(commentCount, 'comment') : 'No comments'}
                    </button>
                    <span>{shareCount ? getCountLabel(shareCount, 'share') : 'Share'}</span>
                  </div>
                </div>

                <div className="feed-card-actions grid grid-cols-3 gap-1 px-4 py-2">
                  <div className="relative group/reactions">
                    <button
                        ref={(node) => {
                          if (node) postReactionButtonRefs.current[postId] = node;
                          else delete postReactionButtonRefs.current[postId];
                        }}
                      type="button"
                      onPointerDown={event => handleReactionPressStart(postId, event.currentTarget)}
                      onPointerUp={clearReactionPressTimer}
                      onPointerCancel={clearReactionPressTimer}
                      onPointerLeave={clearReactionPressTimer}
                      onClick={event => handleReactionButtonClick(post, event.currentTarget)}
                        onKeyDown={event => handlePostReactionButtonKeyDown(event, post)}
                      className={`feed-reaction-button ${myReaction ? 'is-reacted' : ''} flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black ${
                        myReaction ? 'bg-blue-50 text-[#0b57d0] dark:bg-blue-950/30 dark:text-sky-200' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                        aria-label={myReaction ? `Reacted with ${REACTION_LABELS[myReaction.emoji] || myReaction.emoji}. Choose another reaction` : 'React to this post'}
                        aria-haspopup="menu"
                    >
                      <SmilePlus size={17} />
                      <span className="inline-flex items-center gap-1">
                        {myReaction?.emoji && <span className="reaction-motion-zone text-base"><AnimatedEmojiText text={myReaction.emoji} /></span>}
                        {myReaction ? 'Reacted' : 'React'}
                      </span>
                    </button>
                    <ReactionBurst emoji={reactionBursts[postId]} className="right-4 top-0" />
                    <div className="feed-reaction-picker-shell pointer-events-none absolute bottom-full left-0 z-20 mb-2 opacity-0 transition group-hover/reactions:pointer-events-auto group-hover/reactions:opacity-100 group-focus-within/reactions:pointer-events-auto group-focus-within/reactions:opacity-100">
                      <ReactionPicker
                        pickerRef={(node) => {
                          if (node) postReactionPickerRefs.current[postId] = node;
                          else delete postReactionPickerRefs.current[postId];
                        }}
                        onKeyDown={event => handlePostReactionPickerKeyDown(event, postId)}
                        onSelect={(emoji) => choosePostReaction(post, emoji)}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCommentsForPost(postId)}
                    className="feed-card-action-button flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <MessageCircle size={17} />
                    Comment
                  </button>
                  <button type="button" onClick={() => sharePost(post)} className="feed-card-action-button flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
                    <Share2 size={17} />
                    Share
                  </button>
                </div>

                <div className="feed-card-comments space-y-2 px-4 pb-4">
                  {allComments.slice(-3).map((comment, index) => {
                    const commentId = getCommentId(comment) || `${index}-${comment.date || ''}`;
                    const commentReactionKey = `${postId}:${commentId}`;
                    const parentComment = allComments.find(item => getCommentId(item) === getEntityId(comment.replyTo));

                    return (
                      <div key={commentReactionKey} className="flex gap-2">
                        <Avatar user={comment.userId} size="h-8 w-8" onClick={openProfile} />
                        <div className="min-w-0 flex-1">
                          <div className="relative inline-block max-w-full">
                            <div className="min-w-0 rounded-2xl bg-slate-100 px-3 py-2 dark:bg-slate-950">
                              {parentComment && (
                                <div className="mb-1.5 rounded-xl border-l-2 border-[#0b57d0] bg-white/70 px-2 py-1 text-[11px] font-bold text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
                                  <span className="inline-flex max-w-full items-center gap-1">
                                    <CornerDownRight size={12} className="shrink-0 text-[#0b57d0]" />
                                    <span className="truncate">
                                      Replying to {parentComment.userId?.name || 'Member'}: <AnimatedEmojiText text={parentComment.text} />
                                    </span>
                                  </span>
                                </div>
                              )}
                              <div className="flex min-w-0 items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openProfile(comment.userId)}
                                  className="truncate text-left text-xs font-black text-slate-950 transition hover:text-[#0b57d0] dark:text-white dark:hover:text-sky-200"
                                >
                                  {comment.userId?.name || 'Member'}
                                </button>
                                <DeveloperBadge user={comment.userId} compact />
                              </div>
                              <p className="break-words text-sm text-slate-700 dark:text-slate-200"><AnimatedEmojiText text={comment.text} /></p>
                            </div>
                            <ReactionBurst emoji={commentReactionBursts[commentReactionKey]} className="right-1 top-0" />
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 pl-2">
                            <CommentReactionSummary
                              reactions={comment.reactions || []}
                              onReact={(emoji) => reactToComment(post, comment, emoji)}
                              onOpen={() => openReactionViewer('Comment reactions', comment.reactions || [])}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setCommentReplyTargets(prev => ({ ...prev, [postId]: comment }));
                                window.setTimeout(() => commentInputRefs.current[postId]?.focus(), 0);
                              }}
                              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-black text-slate-500 hover:text-[#0b57d0] dark:text-slate-400 dark:hover:text-sky-200"
                            >
                              <Reply size={12} />
                              Reply
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {replyTarget && (
                    <div className="ml-10 flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-sky-100">
                      <span className="min-w-0 truncate">
                        Replying to {replyTarget.userId?.name || 'Member'}: {replyTarget.text}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCommentReplyTargets(prev => {
                          const next = { ...prev };
                          delete next[postId];
                          return next;
                        })}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/80 text-blue-700 dark:bg-slate-900 dark:text-sky-100"
                        aria-label="Cancel reply"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  <form onSubmit={event => addComment(event, post)} className="flex items-center gap-2">
                    <Avatar user={currentUser} size="h-8 w-8" />
                    <input
                      ref={(node) => {
                        if (node) commentInputRefs.current[postId] = node;
                        else delete commentInputRefs.current[postId];
                      }}
                      value={commentDrafts[postId] || ''}
                      onChange={event => setCommentDrafts(prev => ({ ...prev, [postId]: event.target.value }))}
                      placeholder={replyTarget ? `Reply to ${replyTarget.userId?.name || 'Member'}...` : 'Write a comment...'}
                      className="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-[#0b57d0] focus:bg-white dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:bg-slate-950"
                    />
                    <button type="submit" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0b57d0] text-white disabled:opacity-50" disabled={!String(commentDrafts[postId] || '').trim()}>
                      <MessageCircle size={16} />
                    </button>
                  </form>
                </div>
              </article>
              {postIndex === 0 && mobileAfterFirstPost && (
                <div className={`home-feed-mobile-slot home-feed-mobile-after-first-post ${mobileHomeVisibilityClass}`}>
                  {mobileAfterFirstPost}
                </div>
              )}
              </React.Fragment>
            );
          })}

          {hasMoreFeedPosts && (
            <button
              ref={loadMoreSentinelRef}
              type="button"
              onClick={loadMoreFeedPosts}
              disabled={loadingMorePosts}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-[#0b57d0] shadow-sm hover:bg-blue-50 disabled:cursor-wait disabled:opacity-70 dark:border-slate-800 dark:bg-slate-900 dark:text-sky-200 dark:hover:bg-blue-950/20"
            >
              {loadingMorePosts ? 'Loading more posts...' : 'Load more posts'}
            </button>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <Video className="mx-auto text-[#0b57d0]" size={32} />
          <p className="mt-3 font-black text-slate-950 dark:text-white">No posts yet</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Share the first update from the composer above.</p>
        </div>
      )}

      {mobileOverviewSlot && <div className={`home-feed-mobile-slot home-feed-mobile-overview-slot ${mobileHomeVisibilityClass}`}>{mobileOverviewSlot}</div>}

      {activeReactionPost && typeof document !== 'undefined' && createPortal(
        <div
          className={`mobile-reaction-tray-overlay ${mobileHomeVisibilityClass}`}
          onClick={() => {
            setActiveReactionPostId('');
            setReactionTrayAnchor(null);
          }}
        >
          <div
            className={`mobile-reaction-tray mobile-reaction-tray--anchored ${reactionTrayAnchor?.placement === 'below' ? 'mobile-reaction-tray--below' : ''}`}
            style={reactionTrayAnchor ? {
              left: `${reactionTrayAnchor.left}px`,
              top: `${reactionTrayAnchor.top}px`,
              right: 'auto',
              bottom: 'auto'
            } : undefined}
            onClick={event => event.stopPropagation()}
          >
            <ReactionPicker
              pickerRef={(node) => {
                if (node) postReactionPickerRefs.current[getEntityId(activeReactionPost)] = node;
              }}
              onKeyDown={event => handlePostReactionPickerKeyDown(event, getEntityId(activeReactionPost))}
              onSelect={(emoji) => choosePostReaction(activeReactionPost, emoji)}
            />
          </div>
        </div>,
        document.body
      )}

      {uploadQueue && typeof document !== 'undefined' && createPortal(
        <div className={`mobile-upload-queue ${mobileHomeVisibilityClass} ${uploadQueue.status === 'error' ? 'mobile-upload-queue--error' : ''}`}>
          <div className="flex items-center gap-3">
            {uploadQueue.status === 'error' ? (
              <X size={18} className="text-rose-600" />
            ) : (
              <Loader2 size={18} className="animate-spin text-[#0b57d0]" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-slate-950">{uploadQueue.label}</p>
              {uploadQueue.message && <p className="mt-0.5 line-clamp-2 text-xs font-bold text-slate-500">{uploadQueue.message}</p>}
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className={`h-full rounded-full ${uploadQueue.status === 'error' ? 'bg-rose-500' : 'bg-[#0b57d0]'}`} style={{ width: `${Math.max(6, uploadQueue.progress || uploadProgress || 8)}%` }} />
              </div>
            </div>
            {uploadQueue.status === 'error' && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => createPost({ preventDefault() {} })}
                  disabled={posting || !canPost}
                  className="rounded-xl bg-[#0b57d0] px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => setUploadQueue(null)}
                  className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500"
                  aria-label="Dismiss upload error"
                >
                  <X size={15} />
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {activeCommentPost && typeof document !== 'undefined' && createPortal((() => {
        const sheetPostId = getEntityId(activeCommentPost);
        const sheetComments = activeCommentPost.comments || [];
        const sheetReplyTarget = commentReplyTargets[sheetPostId];

        return (
          <div className={`mobile-comment-sheet-overlay ${mobileHomeVisibilityClass}`} onClick={() => setActiveCommentPostId('')}>
            <section className="mobile-comment-sheet" onClick={event => event.stopPropagation()} aria-label="Post comments">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
              <header className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="min-w-0">
                  <p className="text-base font-black text-slate-950">Comments</p>
                  <p className="truncate text-xs font-semibold text-slate-500">{getCountLabel(sheetComments.length, 'comment')}</p>
                </div>
                <button type="button" onClick={() => setActiveCommentPostId('')} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600" aria-label="Close comments">
                  <X size={18} />
                </button>
              </header>

              <div className="mobile-comment-sheet-list">
                {sheetComments.length ? sheetComments.map((comment, index) => {
                  const commentId = getCommentId(comment) || `${index}-${comment.date || ''}`;
                  const commentReactionKey = `${sheetPostId}:${commentId}`;
                  const parentComment = sheetComments.find(item => getCommentId(item) === getEntityId(comment.replyTo));
                  return (
                    <div key={`sheet-${commentReactionKey}`} className="flex gap-2">
                      <Avatar user={comment.userId} size="h-8 w-8" onClick={openProfile} />
                      <div className="min-w-0 flex-1">
                        <div className="relative inline-block max-w-full">
                          <div className="min-w-0 rounded-2xl bg-slate-100 px-3 py-2">
                            {parentComment && (
                              <div className="mb-1.5 rounded-xl border-l-2 border-[#0b57d0] bg-white/80 px-2 py-1 text-[11px] font-bold text-slate-500">
                                <span className="inline-flex max-w-full items-center gap-1">
                                  <CornerDownRight size={12} className="shrink-0 text-[#0b57d0]" />
                                  <span className="truncate">Replying to {parentComment.userId?.name || 'Member'}: <AnimatedEmojiText text={parentComment.text} /></span>
                                </span>
                              </div>
                            )}
                            <div className="flex min-w-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openProfile(comment.userId)}
                                className="truncate text-left text-xs font-black text-slate-950 transition hover:text-[#0b57d0]"
                              >
                                {comment.userId?.name || 'Member'}
                              </button>
                              <DeveloperBadge user={comment.userId} compact />
                            </div>
                            <p className="break-words text-sm text-slate-700"><AnimatedEmojiText text={comment.text} /></p>
                          </div>
                          <ReactionBurst emoji={commentReactionBursts[commentReactionKey]} className="right-1 top-0" />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 pl-2">
                          <CommentReactionSummary
                            reactions={comment.reactions || []}
                            onReact={(emoji) => reactToComment(activeCommentPost, comment, emoji)}
                            onOpen={() => openReactionViewer('Comment reactions', comment.reactions || [])}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setCommentReplyTargets(prev => ({ ...prev, [sheetPostId]: comment }));
                              window.setTimeout(() => commentInputRefs.current[sheetPostId]?.focus(), 0);
                            }}
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-black text-slate-500"
                          >
                            <Reply size={12} />
                            Reply
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500">No comments yet.</p>
                )}
              </div>

              {sheetReplyTarget && (
                <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
                  <span className="min-w-0 truncate">Replying to {sheetReplyTarget.userId?.name || 'Member'}: {sheetReplyTarget.text}</span>
                  <button
                    type="button"
                    onClick={() => setCommentReplyTargets(prev => {
                      const next = { ...prev };
                      delete next[sheetPostId];
                      return next;
                    })}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/80 text-blue-700"
                    aria-label="Cancel reply"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              <form onSubmit={event => addComment(event, activeCommentPost)} className="mobile-comment-sheet-input flex items-center gap-2">
                <Avatar user={currentUser} size="h-8 w-8" />
                <input
                  ref={(node) => {
                    if (node) commentInputRefs.current[sheetPostId] = node;
                    else delete commentInputRefs.current[sheetPostId];
                  }}
                  value={commentDrafts[sheetPostId] || ''}
                  onChange={event => setCommentDrafts(prev => ({ ...prev, [sheetPostId]: event.target.value }))}
                  placeholder={sheetReplyTarget ? `Reply to ${sheetReplyTarget.userId?.name || 'Member'}...` : 'Write a comment...'}
                  className="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-[#0b57d0] focus:bg-white"
                />
                <button type="submit" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0b57d0] text-white disabled:opacity-50" disabled={!String(commentDrafts[sheetPostId] || '').trim()}>
                  <MessageCircle size={16} />
                </button>
              </form>
            </section>
          </div>
        );
      })(), document.body)}

      {mediaViewer && typeof document !== 'undefined' && createPortal(
        <Suspense fallback={<DeferredFeedModuleFallback label="Opening media…" />}>
          <MediaViewer
            media={mediaViewer.items[mediaViewer.index]}
            onClose={() => setMediaViewer(null)}
            onPrevious={mediaViewer.index > 0 ? () => setMediaViewer(prev => ({ ...prev, index: Math.max(0, prev.index - 1) })) : null}
            onNext={mediaViewer.index < mediaViewer.items.length - 1 ? () => setMediaViewer(prev => ({ ...prev, index: Math.min(prev.items.length - 1, prev.index + 1) })) : null}
            positionLabel={`${mediaViewer.index + 1} of ${mediaViewer.items.length}`}
            details={mediaViewer.details}
            footerActions={renderMediaViewerActions()}
          />
        </Suspense>,
        document.body
      )}

      {reactionViewer && typeof document !== 'undefined' && createPortal(
        <ReactionPeopleModal
          title={reactionViewer.title}
          reactions={reactionViewer.reactions}
          onClose={() => setReactionViewer(null)}
          onProfileClick={openProfile}
        />,
        document.body
      )}

      {profileUser && (
        <Suspense fallback={<DeferredFeedModuleFallback label="Opening profile…" />}>
          <UserProfileModal
            isOpen
            user={profileUser}
            onClose={() => setProfileUser(null)}
          />
        </Suspense>
      )}
    </section>
  );
}
