import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Activity, Bell, BellOff, Bookmark, CheckCheck, ChevronDown, ChevronRight, Gamepad2, Home, Search, MessageCircle, User, LogOut, Menu, Trash2, X, Volume2, ShieldCheck, UserPlus, Download, PlusCircle, WifiOff, Settings, RotateCcw, Smartphone, Send, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { resolveMediaUrl } from '../utils/media';
import { installGlobalClickSound, playUiSound } from '../utils/sound';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { AppLogoMark, AppWordmark } from './AppLogo';
import { getNotificationPermissionState, requestNotificationPermission, setupNativePushNotifications, showAppNotification, syncNativeNotificationAuth } from '../utils/notifications';
import './navigation-layout.css';
import type { AppNotification } from '../types/models';

const APP_NAME = 'Syncrova';
const DND_STORAGE_KEY = 'syncrova-dnd';
const LEGACY_DND_STORAGE_KEY = 'workloop-dnd';

const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');

const getDisplayName = (entity, fallback = 'User') => entity?.name || entity?.email || fallback;

const getMessageSnippet = (message) => {
  if (!message) return 'New message';
  if (message.unsent) return 'Message unsent';
  if (message.text?.trim()) return message.text;
  if (message.fileType === 'image') return 'Sent a photo';
  if (message.fileType === 'video') return 'Sent a video';
  if (message.fileType === 'audio') return 'Sent a voice message';
  if (message.fileUrl) return message.fileName || 'Sent an attachment';
  return 'New message';
};

const formatNotificationTime = (value) => {
  if (!value) return 'Now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Now';
  const diffMins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const formatNotificationDateTime = (value) => {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

const getNotificationActionPath = (notification: AppNotification = {}) => {
  const source = notification || {};
  const href = String(source.href || source.meta?.href || source.meta?.path || '').trim();
  if (!href || !href.startsWith('/') || href.startsWith('//')) return '';
  if (/^\/(?:marketplace|groups|group)(?:\/|$)/.test(href)) return '/dashboard';
  return href;
};

const getNotificationActionLabel = (notification: AppNotification = {}) => {
  const source = notification || {};
  if (source.meta?.actionLabel) return String(source.meta.actionLabel).slice(0, 48);
  if (source.meta?.storyId) return 'Open dashboard';
  if (source.meta?.noteId) return 'Open messages';
  if (source.type === 'message') return 'Open conversation';
  if (source.type === 'friend') return 'View friends';
  if (source.type === 'marketplace') return 'Open dashboard';
  if (source.type === 'group') return 'View group';
  if (source.type === 'post' || source.type === 'comment' || source.type === 'reaction') return 'View post';
  return 'Open related page';
};

const isRetiredMarketplaceNotification = (notification: AppNotification = {}) => {
  const source = notification || {};
  const href = String(source.href || source.meta?.href || source.meta?.path || '').trim();
  if (source.type === 'marketplace' || source.type === 'group') return true;
  if (/^\/(?:marketplace|groups|group)(?:\/|$)/.test(href)) return true;

  const text = [source.title, source.body, source.type, href].filter(Boolean).join(' ').toLowerCase();
  return /\b(?:marketplace|listing|buy(?:ing)? and sell(?:ing)?|item sold)\b/.test(text);
};

const getVisibleNotifications = (items = []) => (
  Array.isArray(items) ? items.filter(item => !isRetiredMarketplaceNotification(item)) : []
);

const getNotificationTimestamp = (notification: AppNotification = {}) => {
  const timestamp = new Date(notification?.createdAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getNotificationTargetKey = (notification: AppNotification = {}) => {
  const meta = notification?.meta || {};
  const targetEntries = [
    ['story', meta.storyId],
    ['post', meta.postId],
    ['comment', meta.commentId],
    ['note', meta.noteId],
    ['task', meta.taskId],
    ['file', meta.fileId],
    ['memory', meta.memoryId],
    ['message', meta.messageId]
  ];
  const match = targetEntries.find(([, value]) => getEntityId(value));
  return match ? `${match[0]}:${getEntityId(match[1])}` : '';
};

// Older releases created a fresh alert when someone changed an emoji reaction.
// Keep the newest alert for the same actor and target visible while the backend
// gradually replaces those records with stable `dedupeKey` values.
const getNotificationFeedKey = (notification: AppNotification = {}) => {
  const explicitKey = String(notification?.dedupeKey || notification?.meta?.dedupeKey || '').trim();
  if (explicitKey) return `event:${explicitKey}`;

  if (notification?.type === 'reaction') {
    const targetKey = getNotificationTargetKey(notification);
    const actorKey = getEntityId(notification?.actorId)
      || getEntityId(notification?.meta?.from)
      || getEntityId(notification?.meta?.senderId);
    if (targetKey && actorKey) return `reaction:${targetKey}:actor:${actorKey}`;
  }

  return `notification:${getEntityId(notification) || `${notification?.type || 'activity'}:${getNotificationTimestamp(notification)}:${String(notification?.title || '')}`}`;
};

const normalizeNotificationFeed = (items = [], limit = 40) => {
  const seen = new Set();
  return getVisibleNotifications(items)
    .slice()
    .sort((first, second) => getNotificationTimestamp(second) - getNotificationTimestamp(first))
    .filter(notification => {
      const key = getNotificationFeedKey(notification);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
};

const isMessageNotification = (notification: AppNotification = {}) => {
  const type = String(notification.type || '').toLowerCase();
  const href = String(notification.href || notification.meta?.href || notification.meta?.path || '').trim();
  return type === 'message' || (!type && /^\/messages(?:[/?]|$)/.test(href));
};

type NotificationUnreadSummary = {
  messages: number;
  activity: number;
  total: number;
};

const emptyNotificationUnreadSummary = (): NotificationUnreadSummary => ({
  messages: 0,
  activity: 0,
  total: 0
});

const normalizeNotificationUnreadSummary = (value: unknown): NotificationUnreadSummary | null => {
  if (!value || typeof value !== 'object') return null;
  const summary = value as Record<string, unknown>;
  const messages = Number(summary.messages) > 0 ? 1 : 0;
  const activity = Number(summary.activity) > 0 ? 1 : 0;

  // A category-aware server response is authoritative. Do not use the raw
  // event total here: one active chat should remain one message signal.
  if ('messages' in summary || 'activity' in summary) {
    return { messages, activity, total: messages + activity };
  }

  return null;
};

const getNotificationUnreadSummaryFromItems = (items = []): NotificationUnreadSummary => {
  const summary = normalizeNotificationFeed(items).reduce((next, notification) => {
    if (notification.read) return next;
    if (isMessageNotification(notification)) next.messages = 1;
    else next.activity = 1;
    return next;
  }, { messages: 0, activity: 0 } as Pick<NotificationUnreadSummary, 'messages' | 'activity'>);

  return { ...summary, total: summary.messages + summary.activity };
};

const getVisibleNotificationUnreadSummary = (items = [], reportedSummary: unknown = null) => (
  normalizeNotificationUnreadSummary(reportedSummary)
  || getNotificationUnreadSummaryFromItems(items)
);

const getNotificationActor = (notification: AppNotification = {}) => (
  notification.actorId && typeof notification.actorId === 'object' ? notification.actorId : null
);

const getNotificationActorId = (notification: AppNotification = {}) => (
  getEntityId(notification.actorId)
  || getEntityId(notification.meta?.from)
  || getEntityId(notification.meta?.senderId)
  || getEntityId(notification.fromId)
  || getEntityId(notification.senderId)
);

const getNotificationActorName = (notification: AppNotification = {}) => {
  const actor = getNotificationActor(notification) as { name?: string; email?: string } | null;
  return actor?.name || actor?.email || '';
};

const getNotificationHeadline = (notification: AppNotification = {}) => {
  const actorName = getNotificationActorName(notification);
  const title = String(notification?.title || 'Notification').trim();
  if (!actorName) return title;

  const normalizedTitle = title.toLowerCase();
  if (notification?.type === 'message') {
    if (normalizedTitle.includes('my day reply')) return `${actorName} replied to your My Day`;
    return `${actorName} sent you a message`;
  }
  if (notification?.type === 'reaction') {
    if (normalizedTitle.includes('my day')) return `${actorName} reacted to your My Day`;
    if (normalizedTitle.includes('comment')) return `${actorName} reacted to your comment`;
    if (normalizedTitle.includes('note')) return `${actorName} reacted to your note`;
    return `${actorName} reacted to your post`;
  }
  if (notification?.type === 'friend') {
    if (normalizedTitle.includes('accepted')) return `${actorName} accepted your friend request`;
    if (normalizedTitle.includes('request')) return `${actorName} sent you a friend request`;
  }
  return title;
};

const getMessageNotificationThreadKey = (notification: AppNotification = {}) => {
  const actorId = getNotificationActorId(notification);
  if (actorId) return `actor:${actorId}`;
  return `messages:${notification.href || '/messages'}`;
};

const buildNotificationPanelItems = (items = []) => {
  const rows = [];
  const messageThreads = new Map();

  items.forEach(notification => {
    if (!isMessageNotification(notification)) {
      rows.push({ kind: 'single', key: getEntityId(notification) || `single:${rows.length}`, notification });
      return;
    }

    const key = getMessageNotificationThreadKey(notification);
    const actor = getNotificationActor(notification);
    if (!messageThreads.has(key)) {
      const thread = { kind: 'message-thread', key, actor, items: [] };
      messageThreads.set(key, thread);
      rows.push(thread);
    }

    const thread = messageThreads.get(key);
    if (!thread.actor && actor) thread.actor = actor;
    thread.items.push(notification);
  });

  return rows.map(row => (
    row.kind === 'message-thread'
      ? {
          ...row,
          latest: row.items[0],
          unreadCount: row.items.filter(item => !item.read).length
        }
      : row
  ));
};

const getStoredDndPreference = () => {
  if (typeof window === 'undefined') return false;
  return (localStorage.getItem(DND_STORAGE_KEY) ?? localStorage.getItem(LEGACY_DND_STORAGE_KEY)) === 'true';
};

const isMobileViewport = () => (
  typeof window !== 'undefined'
  && window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches
);

const isDocumentVisible = () => (
  typeof document === 'undefined' || document.visibilityState === 'visible'
);

const triggerMobileHaptic = (duration = 10) => {
  if (typeof navigator === 'undefined' || !isMobileViewport()) return;
  navigator.vibrate?.(duration);
};

export default function Layout({ children }: { children?: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationUnreadSummary, setNotificationUnreadSummary] = useState<NotificationUnreadSummary>(emptyNotificationUnreadSummary);
  const [notifications, setNotifications] = useState([]);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [expandedNotificationThreads, setExpandedNotificationThreads] = useState(() => new Set());
  const [friendBadgeCount, setFriendBadgeCount] = useState(0);
  const [messagePopups, setMessagePopups] = useState([]);
  const [expandedMessagePopupId, setExpandedMessagePopupId] = useState('');
  const [quickReplyDrafts, setQuickReplyDrafts] = useState({});
  const [messagePopupBusyId, setMessagePopupBusyId] = useState('');
  const [dndEnabled, setDndEnabled] = useState(getStoredDndPreference);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [connectionNotice, setConnectionNotice] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [feedAutoplayEnabled, setFeedAutoplayEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('syncrova.home.videoAutoplay') === 'true';
  });
  const [pullRefresh, setPullRefresh] = useState({ distance: 0, refreshing: false });
  const [notificationPermission, setNotificationPermission] = useState('prompt');
  const [isInstalledApp, setIsInstalledApp] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true;
  });
  const [dashboardHeaderHidden, setDashboardHeaderHidden] = useState(false);
  const pullGestureRef = useRef({ tracking: false, startY: 0 });
  const messageTimersRef = useRef({});
  const navigate = useNavigate();
  const location = useLocation();
  const avatarSrc = resolveMediaUrl(user?.avatar);
  const notificationUnreadCount = notificationUnreadSummary.total;
  const hasUnreadMessages = unreadCount > 0;
  const messageBadgeCount = hasUnreadMessages ? 1 : 0;
  const friendBadgeSignal = friendBadgeCount > 0 ? 1 : 0;
  const notificationAttentionLabel = notificationUnreadSummary.messages && notificationUnreadSummary.activity
    ? 'New messages and activity'
    : notificationUnreadSummary.messages
      ? 'New messages'
      : notificationUnreadSummary.activity
        ? 'New activity'
        : "You're all caught up";
  const pageContent = children || <Outlet />;
  const isCompactRoute = location.pathname.startsWith('/messages') || location.pathname.startsWith('/arena') || location.pathname.startsWith('/developer-console') || location.pathname.startsWith('/reels');
  const isDashboardRoute = location.pathname === '/dashboard';
  const mobileChatRouteOpen = location.pathname.startsWith('/messages') && mobileChatOpen;
  const showFacebookMobileTabs = false;
  const useFacebookMobileHome = isDashboardRoute;
  const hideMobileBottomNav = mobileChatRouteOpen;
  const hideMobileTopbar = location.pathname.startsWith('/messages');
  const enableMobilePullRefresh = !useFacebookMobileHome && !mobileChatRouteOpen;

  const handleAppMainScroll = useCallback((event) => {
    if (!isDashboardRoute || isMobileViewport()) {
      setDashboardHeaderHidden(false);
      return;
    }

    const scrollTop = event.currentTarget.scrollTop;
    setDashboardHeaderHidden(previous => {
      if (scrollTop <= 8) return false;
      if (scrollTop >= 80) return true;
      return previous;
    });
  }, [isDashboardRoute]);

  const pageMeta = (() => {
    const arenaGameTitle = {
      blocks: 'Swipe Ninja',
      'jet-fighter': 'Jet Fighter',
      'typing-race': 'Typing Race',
      'reaction-tap': 'Reaction Tap',
      'focus-flow': 'Focus Flow'
    }[location.pathname.match(/^\/arena\/([^/]+)/)?.[1]];
    if (location.pathname.startsWith('/marketplace') || location.pathname.startsWith('/groups') || location.pathname.startsWith('/group/')) return { title: 'Dashboard', helper: 'Today at a glance', action: () => navigate('/dashboard') };
    if (location.pathname.startsWith('/messages')) return { title: 'Messages', helper: 'Realtime chats and media', action: () => navigate('/messages') };
    if (location.pathname.startsWith('/reels')) return { title: 'Gallery', helper: 'Photos and videos', action: () => navigate('/reels') };
    if (location.pathname.startsWith('/friends')) return { title: 'Friends', helper: 'Requests and teammates', action: () => navigate('/friends') };
    if (location.pathname.startsWith('/developer-console')) return { title: 'Developer Console', helper: 'Reports and decisions', action: () => navigate('/developer-console') };
    if (location.pathname.startsWith('/settings')) return { title: 'Settings', helper: 'Account and app controls', action: () => navigate('/settings') };
    if (location.pathname.startsWith('/notifications')) return { title: 'Notifications', helper: 'Activity and updates', action: () => navigate('/notifications') };
    if (location.pathname.startsWith('/search')) return { title: 'Search', helper: 'Find anything', action: () => navigate('/search') };
    if (location.pathname.startsWith('/saved')) return { title: 'Saved', helper: 'Saved items', action: () => navigate('/saved') };
    if (location.pathname.startsWith('/app-health')) return { title: 'App Health', helper: 'System diagnostics', action: () => navigate('/app-health') };
    if (location.pathname.startsWith('/arena')) return { title: arenaGameTitle || 'Games', helper: arenaGameTitle ? 'Game run' : 'Games, reports, ranks', action: () => navigate('/arena') };
    if (location.pathname.startsWith('/profile')) return { title: 'Me', helper: 'Profile and settings', action: () => navigate('/profile') };
    return { title: 'Dashboard', helper: 'Today at a glance', action: () => navigate('/dashboard') };
  })();

  useEffect(() => {
    localStorage.setItem(DND_STORAGE_KEY, String(dndEnabled));
    localStorage.removeItem(LEGACY_DND_STORAGE_KEY);
  }, [dndEnabled]);

  useEffect(() => {
    const syncDndPreference = () => setDndEnabled(getStoredDndPreference());
    window.addEventListener('syncrova:dnd-change', syncDndPreference);
    window.addEventListener('storage', syncDndPreference);
    return () => {
      window.removeEventListener('syncrova:dnd-change', syncDndPreference);
      window.removeEventListener('storage', syncDndPreference);
    };
  }, []);

  useEffect(() => {
    if (!location.pathname.startsWith('/messages')) setMobileChatOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setDashboardHeaderHidden(false);
  }, [isDashboardRoute]);

  useEffect(() => {
    const handleMobileChatState = (event) => {
      setMobileChatOpen(Boolean(event.detail?.open));
    };

    window.addEventListener('syncrova:mobile-chat-state', handleMobileChatState);
    return () => window.removeEventListener('syncrova:mobile-chat-state', handleMobileChatState);
  }, []);

  useEffect(() => {
    const handleNativeBack = (event) => {
      if (selectedNotification) {
        event.preventDefault();
        setSelectedNotification(null);
        return;
      }
      if (settingsOpen) {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }
      if (notificationPanelOpen) {
        event.preventDefault();
        setNotificationPanelOpen(false);
        return;
      }
      if (sidebarOpen) {
        event.preventDefault();
        setSidebarOpen(false);
      }
    };

    window.addEventListener('syncrova:native-back', handleNativeBack);
    return () => window.removeEventListener('syncrova:native-back', handleNativeBack);
  }, [notificationPanelOpen, selectedNotification, settingsOpen, sidebarOpen]);

  useEffect(() => {
    if (!selectedNotification) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setSelectedNotification(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNotification]);

  useEffect(() => installGlobalClickSound(), []);

  useEffect(() => {
    let cancelled = false;
    getNotificationPermissionState().then(state => {
      if (!cancelled) setNotificationPermission(state);
      if (!cancelled && state === 'granted') setupNativePushNotifications().catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    syncNativeNotificationAuth({ user }).catch(() => {});
  }, [user]);

  useEffect(() => {
    const updateOnlineState = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      setConnectionNotice(online ? 'Back online. Syncing latest updates...' : 'No connection. Actions will retry when you are online.');
      if (online) window.setTimeout(() => setConnectionNotice(''), 2600);
    };
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, []);

  useEffect(() => {
    const syncAutoplayPreference = () => {
      setFeedAutoplayEnabled(localStorage.getItem('syncrova.home.videoAutoplay') === 'true');
    };
    window.addEventListener('syncrova:video-autoplay-change', syncAutoplayPreference);
    window.addEventListener('storage', syncAutoplayPreference);
    return () => {
      window.removeEventListener('syncrova:video-autoplay-change', syncAutoplayPreference);
      window.removeEventListener('storage', syncAutoplayPreference);
    };
  }, []);

  useEffect(() => {
    const handleClick = (event) => {
      if (!document.documentElement.classList.contains('syncrova-native-app')) return;
      if (!event.target?.closest?.('button,a,[role="button"],label,input,select')) return;
      triggerMobileHaptic(8);
    };
    window.addEventListener('click', handleClick, true);
    return () => window.removeEventListener('click', handleClick, true);
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalledApp(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => () => {
    Object.values(messageTimersRef.current).forEach(clearTimeout);
    messageTimersRef.current = {};
  }, []);

  useEffect(() => {
    const handler = (e) => {
      setUnreadCount(e.detail?.count || 0);
    };
    window.addEventListener('unreadMessages', handler);
    return () => window.removeEventListener('unreadMessages', handler);
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    let cancelled = false;
    let listenerPromise = null;

    const setupNativeNotificationLinks = async () => {
      if (typeof window === 'undefined' || !window.Capacitor?.isNativePlatform?.()) return;
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        if (cancelled || !LocalNotifications?.addListener) return;
        listenerPromise = LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
          const path = event?.notification?.extra?.path || event?.notification?.extra?.href || '';
          if (path) navigate(path);
        });
      } catch {
        // Native notification actions are optional.
      }
    };

    setupNativeNotificationLinks();

    return () => {
      cancelled = true;
      Promise.resolve(listenerPromise)
        .then(listener => listener?.remove?.())
        .catch(() => {});
    };
  }, [navigate, user]);

  useEffect(() => {
    if (!user) return undefined;

    let cancelled = false;
    const loadBadges = async () => {
      if (!isDocumentVisible()) return;
      try {
        const [messageRes, friendRes] = await Promise.all([
          api.get('/messages/conversations').catch(() => ({ data: [] })),
          api.get('/friends/summary').catch(() => ({ data: { incoming: [] } }))
        ]);
        if (cancelled) return;

        setUnreadCount((messageRes.data || []).reduce((total, item) => total + (item.unreadCount || 0), 0));
        setFriendBadgeCount((friendRes.data?.incoming || []).length);
      } catch (err) {
        console.error('Badge sync failed', err);
      }
    };

    loadBadges();
    const interval = setInterval(loadBadges, 30000);
    const friendsHandler = () => loadBadges();
    const visibilityHandler = () => {
      if (isDocumentVisible()) loadBadges();
    };
    window.addEventListener('friendsUpdated', friendsHandler);
    document.addEventListener('visibilitychange', visibilityHandler);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('friendsUpdated', friendsHandler);
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;

    const socket = getSocket();
    const refreshFriends = () => {
      if (!isDocumentVisible()) return;
      api.get('/friends/summary')
        .then(res => setFriendBadgeCount((res.data?.incoming || []).length))
        .catch(() => {});
      window.dispatchEvent(new CustomEvent('friendsUpdated'));
    };

    socket.on('friend-request-updated', refreshFriends);
    return () => { socket.off('friend-request-updated', refreshFriends); };
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;

    let cancelled = false;
    const loadNotifications = async () => {
      if (!isDocumentVisible()) return;
      try {
        const res = await api.get('/notifications');
        if (cancelled) return;
        const incoming = res.data?.notifications || [];
        setNotifications(normalizeNotificationFeed(incoming));
        setNotificationUnreadSummary(getVisibleNotificationUnreadSummary(incoming, res.data?.unreadSummary));
      } catch {
        // Notification center is non-blocking.
      }
    };

    loadNotifications();
    const interval = setInterval(loadNotifications, 45000);
    const visibilityHandler = () => {
      if (isDocumentVisible()) loadNotifications();
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;

    const socket = getSocket();
    const refreshNotifications = ({ unreadSummary: nextUnreadSummary, notification }: { unreadSummary?: unknown; notification?: AppNotification } = {}) => {
      const isRetiredNotification = isRetiredMarketplaceNotification(notification);
      const normalizedSummary = normalizeNotificationUnreadSummary(nextUnreadSummary);
      if (normalizedSummary) setNotificationUnreadSummary(normalizedSummary);
      if (notification && !isRetiredNotification) {
        setNotifications(prev => normalizeNotificationFeed([
          notification,
          ...prev.filter(item => getEntityId(item) !== getEntityId(notification))
        ]));
      }
      if (notification && !isRetiredNotification && !dndEnabled && notification.type !== 'message') {
        showAppNotification({
          title: notification.title,
          body: notification.body,
          tag: `notification-${getEntityId(notification)}`,
          data: { path: notification.href || '/dashboard', href: notification.href || '/dashboard' }
        });
      }
      // Fresh notification events already include a populated row and the
      // authoritative category summary. Avoid immediately reloading the
      // entire inbox for every incoming chat/reaction; state-changing events
      // (read/delete) carry no row and still get a full reconciliation.
      if (isDocumentVisible() && (!notification || !normalizedSummary)) {
        api.get('/notifications')
          .then(res => {
            const incoming = res.data?.notifications || [];
            setNotifications(normalizeNotificationFeed(incoming));
            setNotificationUnreadSummary(getVisibleNotificationUnreadSummary(incoming, res.data?.unreadSummary));
          })
          .catch(() => {});
      }
    };

    socket.on('notifications-updated', refreshNotifications);
    return () => { socket.off('notifications-updated', refreshNotifications); };
  }, [dndEnabled, user]);

  useEffect(() => {
    if (!user) return undefined;

    const currentUserId = getEntityId(user);
    const socket = getSocket();

    const onReceiveMessage = (message) => {
      const fromId = getEntityId(message.from);
      const toId = getEntityId(message.to);
      const messageId = getEntityId(message) || `${fromId}-${Date.now()}`;
      const isIncoming = toId === currentUserId && fromId !== currentUserId;

      if (!isIncoming) return;

      if (!location.pathname.startsWith('/messages')) {
        setUnreadCount(value => value + 1);
      }

      if (dndEnabled || location.pathname.startsWith('/messages')) return;

      const popup = {
        id: messageId,
        messageId,
        fromId,
        from: message.from,
        body: getMessageSnippet(message),
        createdAt: message.createdAt || new Date().toISOString(),
        fileType: message.fileType || '',
        message
      };

      setMessagePopups(prev => [popup, ...prev.filter(item => item.id !== popup.id)].slice(0, 3));
      playUiSound('message', 0.45);
      showAppNotification({
        title: getDisplayName(message.from, 'New message'),
        body: popup.body,
        tag: `message-${fromId}`,
        data: { path: `/messages?user=${fromId}`, fromId }
      });

      clearTimeout(messageTimersRef.current[popup.id]);
      messageTimersRef.current[popup.id] = setTimeout(() => {
        setMessagePopups(prev => prev.filter(item => item.id !== popup.id));
        setExpandedMessagePopupId(prev => (prev === popup.id ? '' : prev));
        setQuickReplyDrafts(prev => {
          const next = { ...prev };
          delete next[popup.id];
          return next;
        });
        delete messageTimersRef.current[popup.id];
      }, 18000);
    };

    socket.on('receiveMessage', onReceiveMessage);
    return () => { socket.off('receiveMessage', onReceiveMessage); };
  }, [dndEnabled, location.pathname, user]);

  const BrandLogo = ({ compact = false, collapsed = false, mobile = false, inverse = false }) => (
    <div className={`group/brand brand-logo ${mobile ? 'brand-logo--mobile' : ''} inline-flex min-w-0 items-center gap-3`} title={APP_NAME}>
      <AppLogoMark size={mobile ? 'sm' : compact ? 'md' : 'lg'} className={inverse ? 'shadow-none ring-white/20' : ''} />
      <span className={`${collapsed ? 'max-w-0 opacity-0 md:group-hover/sidebar:max-w-[11rem] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-w-[11rem] md:group-focus-within/sidebar:opacity-100' : 'max-w-[11rem] opacity-100'} min-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 ease-out`}>
        <AppWordmark size={mobile ? 'sm' : compact ? 'sm' : 'md'} tone={inverse ? 'inverse' : 'default'} />
      </span>
    </div>
  );

  const DndToggle = ({ compact = false, collapsed = false }) => (
    <button
      type="button"
      aria-pressed={dndEnabled}
      onClick={() => setDndEnabled(value => !value)}
      className={`${compact ? 'flex h-9 min-w-0 items-center justify-center rounded-xl px-2' : collapsed ? 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5' : 'flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm'} transition ${
        dndEnabled
          ? 'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/35 dark:text-rose-300 dark:hover:bg-rose-950/55'
          : compact
            ? 'text-slate-600 hover:bg-blue-50 hover:text-[#0b57d0] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-sky-200'
            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
      }`}
      title={dndEnabled ? 'Do not disturb is on' : 'Message popups are on'}
    >
      {dndEnabled ? <BellOff size={compact ? 17 : 20} /> : <Volume2 size={compact ? 17 : 20} />}
      {!compact && (
        <span className={`${collapsed ? 'max-w-0 opacity-0 md:group-hover/sidebar:max-w-[9rem] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-w-[9rem] md:group-focus-within/sidebar:opacity-100' : 'max-w-[9rem] opacity-100'} overflow-hidden whitespace-nowrap transition-all duration-300 ease-out`}>
          {dndEnabled ? 'Do not disturb' : 'Message alerts'}
        </span>
      )}
    </button>
  );

  const SidebarProfileTools = ({ mobile = false }) => {
    if (!user) return null;

    const profileActive = isNavItemActive('/profile');
    return (
      <section className={`sidebar-profile-card ${mobile ? 'space-y-2' : 'rounded-2xl border border-slate-200 bg-white p-2 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20'}`}>
        <Link
          to="/profile"
          data-sound="tab"
          onClick={() => mobile && setSidebarOpen(false)}
          className={`sidebar-profile-link flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 transition ${
            profileActive
              ? 'bg-blue-50 text-[#0b57d0] dark:bg-blue-950/35 dark:text-sky-200'
              : 'text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800'
          }`}
          title={user.email}
        >
          <div className="sidebar-profile-avatar flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#0b57d0] to-[#2387a8] text-sm font-bold text-white ring-2 ring-white shadow-sm">
            {avatarSrc ? <img src={avatarSrc} alt={user.name} className="h-full w-full object-cover" /> : user.name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black leading-tight">{user.name}</div>
            <div className="truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">{user.email}</div>
          </div>
        </Link>
        <div className="sidebar-quick-controls mt-2 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-950/80" title="Quick account controls">
          <DndToggle compact />
          <button
            type="button"
            onClick={handleLogout}
            data-sound="close"
            className="flex h-9 items-center justify-center rounded-xl text-red-600 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/35"
            title="Logout"
            aria-label="Logout"
          >
            <LogOut size={17} />
          </button>
        </div>
      </section>
    );
  };

  const handleInstallApp = async () => {
    if (!installPrompt) return;

    installPrompt.prompt();
    const result = await installPrompt.userChoice.catch(() => null);
    if (!result || result.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const InstallButton = () => {
    if (!installPrompt || isInstalledApp) return null;

    return (
      <button
        type="button"
        onClick={handleInstallApp}
        className="flex w-full items-center gap-2.5 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-1.5 text-sm font-bold text-cyan-700 transition hover:-translate-y-0.5 hover:bg-cyan-400/15 dark:border-cyan-300/20 dark:text-cyan-200"
      >
        <Download size={19} />
        <span>Install Syncrova</span>
      </button>
    );
  };

  const enableNotifications = async () => {
    await syncNativeNotificationAuth({ user });
    const state = await requestNotificationPermission();
    setNotificationPermission(state);
    if (state === 'granted') {
      await setupNativePushNotifications().catch(() => {});
      toast.success('Phone notifications enabled');
    } else if (state === 'denied') {
      toast.error('Notifications are blocked in your device settings');
    }
  };

  const refreshNotificationUnreadSummary = useCallback(async () => {
    try {
      const res = await api.get('/notifications/unread-count');
      const summary = normalizeNotificationUnreadSummary(res.data?.unreadSummary);
      if (summary) setNotificationUnreadSummary(summary);
    } catch {
      // The list remains usable if this lightweight badge refresh fails.
    }
  }, []);

  const loadNotifications = async () => {
    setNotificationsLoading(true);
    try {
      const res = await api.get('/notifications');
      const incoming = res.data?.notifications || [];
      setNotifications(normalizeNotificationFeed(incoming));
      setNotificationUnreadSummary(getVisibleNotificationUnreadSummary(incoming, res.data?.unreadSummary));
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to load notifications');
    } finally {
      setNotificationsLoading(false);
    }
  };

  const openNotificationCenter = () => {
    setNotificationPanelOpen(value => {
      const next = !value;
      if (!value) loadNotifications();
      return next;
    });
  };

  const markAllNotificationsRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev => prev.map(item => ({ ...item, read: true })));
      setNotificationUnreadSummary(emptyNotificationUnreadSummary());
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to update notifications');
    }
  };

  const openNotification = async (notification) => {
    const id = getEntityId(notification);
    if (!notification.read && id) {
      api.put(`/notifications/${id}/read`)
        .then(() => refreshNotificationUnreadSummary())
        .catch(() => {});
      setNotifications(prev => prev.map(item => getEntityId(item) === id ? { ...item, read: true } : item));
    }
    setNotificationPanelOpen(false);
    setSelectedNotification({ ...notification, title: getNotificationHeadline(notification), read: true });
  };

  const markNotificationGroupRead = async (items = []) => {
    const unreadIds = items
      .filter(item => !item.read)
      .map(getEntityId)
      .filter(Boolean);
    if (!unreadIds.length) return;

    const unreadSet = new Set(unreadIds);
    setNotifications(prev => prev.map(item => (
      unreadSet.has(getEntityId(item)) ? { ...item, read: true } : item
    )));
    await Promise.allSettled(unreadIds.map(id => api.put(`/notifications/${id}/read`)));
    await refreshNotificationUnreadSummary();
  };

  const openNotificationThread = (thread) => {
    markNotificationGroupRead(thread.items);
    setNotificationPanelOpen(false);
    setSelectedNotification({
      ...(thread.latest || {}),
      title: thread.actor?.name ? `Messages from ${thread.actor.name}` : thread.latest?.title || 'Messages',
      body: thread.latest?.body || `${thread.items.length} recent message notifications`,
      href: thread.latest?.href || '/messages',
      read: true,
      meta: {
        ...(thread.latest?.meta || {}),
        actionLabel: 'Open conversation'
      }
    });
  };

  const closeNotificationModal = () => setSelectedNotification(null);

  const openSelectedNotificationAction = () => {
    const actionPath = getNotificationActionPath(selectedNotification);
    if (!actionPath) return;
    setSelectedNotification(null);
    navigate(actionPath);
  };

  const toggleNotificationThread = (event, threadKey) => {
    event.stopPropagation();
    setExpandedNotificationThreads(prev => {
      const next = new Set(prev);
      if (next.has(threadKey)) next.delete(threadKey);
      else next.add(threadKey);
      return next;
    });
  };

  const deleteNotification = async (event, notification) => {
    event.stopPropagation();
    const id = getEntityId(notification);
    if (!id) return;
    try {
      await api.delete(`/notifications/${id}`);
      setNotifications(prev => prev.filter(item => getEntityId(item) !== id));
      await refreshNotificationUnreadSummary();
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Delete failed');
    }
  };

  const deleteNotificationThread = async (event, thread) => {
    event.stopPropagation();
    const ids = thread.items.map(getEntityId).filter(Boolean);
    if (!ids.length) return;
    try {
      await Promise.allSettled(ids.map(id => api.delete(`/notifications/${id}`)));
      const idSet = new Set(ids);
      setNotifications(prev => prev.filter(item => !idSet.has(getEntityId(item))));
      await refreshNotificationUnreadSummary();
      setExpandedNotificationThreads(prev => {
        const next = new Set(prev);
        next.delete(thread.key);
        return next;
      });
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Delete failed');
    }
  };

  const notificationPanelItems = buildNotificationPanelItems(notifications);

  const NotificationButton = ({ compact = false }) => {
    if (notificationPermission === 'granted' || notificationPermission === 'unsupported') return null;

    return (
      <button
        type="button"
        onClick={enableNotifications}
        className={`${compact ? 'rounded-full p-2' : 'flex w-full items-center gap-2.5 rounded-xl border border-blue-300/30 bg-blue-500/10 px-3 py-1.5 text-sm font-bold'} text-blue-700 transition hover:-translate-y-0.5 hover:bg-blue-500/15 dark:text-blue-200`}
        title="Enable phone notifications"
        aria-label="Enable phone notifications"
      >
        <Bell size={compact ? 22 : 19} />
        {!compact && <span>Enable notifications</span>}
      </button>
    );
  };

  const NotificationCenterButton = ({ compact = false, surface = 'default' }) => {
    const compactClasses = surface === 'navy'
      ? 'mobile-topbar-action grid h-10 w-10 place-items-center rounded-xl text-white/90 hover:bg-white/10'
      : 'mobile-topbar-action grid h-10 w-10 place-items-center rounded-xl text-slate-600 hover:bg-blue-50 hover:text-[#0b57d0] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-sky-200';
    const regularClasses = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-blue-50 hover:text-[#0b57d0] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-sky-200';

    return (
    <div className="relative">
      <button
        type="button"
        onClick={openNotificationCenter}
        className={`${compact ? compactClasses : regularClasses} relative transition`}
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={compact ? 21 : 19} />
        {!compact && <span>Notifications</span>}
        {notificationUnreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-black text-white">
            {notificationUnreadCount}
          </span>
        )}
      </button>

      {false && notificationPanelOpen && (
        <div className={`${compact ? 'mobile-notification-panel mobile-bottom-sheet fixed right-2 top-[4.25rem] w-[min(94vw,24rem)]' : 'absolute bottom-full left-0 mb-2 w-[min(22rem,86vw)]'} z-[80] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-gray-950/20 dark:border-slate-800 dark:bg-slate-950`}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-3 dark:border-slate-800">
            <div>
              <p className="text-sm font-black text-slate-950 dark:text-white">Notifications</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{notificationAttentionLabel}</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={markAllNotificationsRead} className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" title="Mark all read">
                <CheckCheck size={17} />
              </button>
              <button type="button" onClick={() => setNotificationPanelOpen(false)} className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" aria-label="Close notifications">
                <X size={17} />
              </button>
            </div>
          </div>
          <div className="max-h-[min(70vh,28rem)] overflow-y-auto p-2">
            {notificationsLoading ? (
              <div className="space-y-2" aria-hidden="true">
                {[0, 1, 2].map(item => (
                  <div key={item} className="mobile-skeleton-card rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
                    <div className="flex items-center gap-3">
                      <span className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800" />
                      <span className="min-w-0 flex-1 space-y-2">
                        <span className="block h-3 w-2/3 rounded-full bg-slate-200 dark:bg-slate-800" />
                        <span className="block h-3 w-4/5 rounded-full bg-slate-200 dark:bg-slate-800" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : notificationPanelItems.length ? notificationPanelItems.map(row => {
              if (row.kind === 'message-thread') {
                const actor = row.actor || {};
                const actorAvatar = resolveMediaUrl(actor.avatar);
                const latest = row.latest || {};
                const isExpanded = expandedNotificationThreads.has(row.key);
                const displayName = actor.name || actor.email || 'Messages';
                return (
                  <article
                    key={row.key}
                    className={`overflow-hidden rounded-2xl transition ${
                      row.unreadCount
                        ? 'bg-blue-50/85 dark:bg-blue-950/25'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-900'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openNotificationThread(row)}
                      className="group flex w-full items-start gap-3 p-3 text-left"
                    >
                      <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#0b57d0] to-[#2387a8] text-sm font-black text-white">
                        {actorAvatar ? <img src={actorAvatar} alt={displayName} className="h-full w-full object-cover" /> : <MessageCircle size={18} />}
                        {row.unreadCount > 0 && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-950" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="line-clamp-1 text-sm font-black text-slate-950 dark:text-white">{displayName}</span>
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#0b57d0] px-1.5 text-[11px] font-black text-white">
                            {row.items.length}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[11px] font-black uppercase text-[#0b57d0] dark:text-sky-300">
                          {row.unreadCount ? `${row.unreadCount} unread messages` : `${row.items.length} recent messages`}
                        </span>
                        {latest.body && <span className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{latest.body}</span>}
                        <span className="mt-1 block text-[11px] font-black uppercase text-slate-400">{formatNotificationTime(latest.createdAt)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={event => toggleNotificationThread(event, row.key)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              toggleNotificationThread(event, row.key);
                            }
                          }}
                          className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-blue-50 hover:text-[#0b57d0] dark:hover:bg-blue-950/35 dark:hover:text-sky-200"
                          title={isExpanded ? 'Hide messages' : 'Show grouped messages'}
                        >
                          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={event => deleteNotificationThread(event, row)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              deleteNotificationThread(event, row);
                            }
                          }}
                          className="grid h-8 w-8 place-items-center rounded-full text-slate-400 opacity-100 transition hover:bg-rose-50 hover:text-rose-600 md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-rose-950/35 dark:hover:text-rose-300"
                          title="Delete message notifications"
                        >
                          <Trash2 size={15} />
                        </span>
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-slate-200/70 bg-white/70 p-1.5 dark:border-slate-800 dark:bg-black/20">
                        {row.items.map(notification => (
                          <button
                            key={getEntityId(notification)}
                            type="button"
                            onClick={() => openNotification(notification)}
                            className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition hover:bg-blue-50 dark:hover:bg-blue-950/25"
                          >
                            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.read ? 'bg-slate-300 dark:bg-slate-700' : 'bg-emerald-400'}`} />
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 text-xs font-bold text-slate-700 dark:text-slate-200">{notification.body || notification.title}</span>
                              <span className="mt-0.5 block text-[10px] font-black uppercase text-slate-400">{formatNotificationTime(notification.createdAt)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                );
              }

              const notification = row.notification;
              const actor = notification.actorId || {};
              const actorAvatar = resolveMediaUrl(actor.avatar);
              return (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={`group flex w-full items-start gap-3 rounded-2xl p-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900 ${notification.read ? '' : 'bg-blue-50/80 dark:bg-blue-950/25'}`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#0b57d0] to-[#2387a8] text-sm font-black text-white">
                    {actorAvatar ? <img src={actorAvatar} alt={actor.name || 'User'} className="h-full w-full object-cover" /> : (actor.name || notification.type || 'N').charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-sm font-black text-slate-950 dark:text-white">{notification.title}</span>
                    {notification.body && <span className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{notification.body}</span>}
                    <span className="mt-1 block text-[11px] font-black uppercase text-[#0b57d0] dark:text-sky-300">{formatNotificationTime(notification.createdAt)}</span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={event => deleteNotification(event, notification)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') deleteNotification(event, notification);
                    }}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:hover:bg-rose-950/35 dark:hover:text-rose-300"
                    title="Delete notification"
                  >
                    <Trash2 size={15} />
                  </span>
                </button>
              );
            }) : (
              <p className="rounded-xl p-5 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">No notifications yet.</p>
            )}
          </div>
          <div className="border-t border-slate-100 p-2 dark:border-slate-800">
            <Link
              to="/notifications"
              onClick={() => setNotificationPanelOpen(false)}
              className="flex items-center justify-center rounded-xl bg-blue-50 px-3 py-2 text-sm font-black text-[#0b57d0] transition hover:bg-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:hover:bg-blue-950/50"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
    );
  };

  const mainNavItems = [
    { path: '/dashboard', icon: Home, label: 'Dashboard', mobileLabel: 'Home' },
    { path: '/messages', icon: MessageCircle, label: 'Messages', mobileLabel: 'Chats' },
    { path: '/friends', icon: UserPlus, label: 'Friends', mobileLabel: 'Friends' },
    { path: '/arena', icon: Gamepad2, label: 'Games', mobileLabel: 'Games' },
    { path: '/profile', icon: User, label: 'Profile', mobileLabel: 'Me' }
  ];
  const toolNavItems = [
    { path: '/search', icon: Search, label: 'Global Search', mobileLabel: 'Search' },
    { path: '/saved', icon: Bookmark, label: 'Saved Items', mobileLabel: 'Saved' },
    { path: '/settings', icon: Settings, label: 'Settings', mobileLabel: 'Settings' },
    { path: '/app-health', icon: Activity, label: 'App Health', mobileLabel: 'Health' }
  ];
  const mobileBottomItems = mainNavItems;
  const mobileTabStyle = { '--mobile-tab-count': mobileBottomItems.length } as React.CSSProperties;
  const tabHeavyMobileRoute = location.pathname.startsWith('/profile')
    || location.pathname.startsWith('/friends')
    || location.pathname.startsWith('/developer-console')
    || location.pathname.startsWith('/arena')
    || location.pathname.startsWith('/settings')
    || location.pathname.startsWith('/notifications')
    || location.pathname.startsWith('/search')
    || location.pathname.startsWith('/saved')
    || location.pathname.startsWith('/app-health');
  const isNavItemActive = (path) => location.pathname === path
    || (path !== '/dashboard' && location.pathname.startsWith(`${path}/`));

  const handleLogout = () => {
    logout();
    toast.success('Logged out');
    navigate('/login');
  };

  const clearMessagePopupTimer = (popupId) => {
    if (!popupId || !messageTimersRef.current[popupId]) return;
    clearTimeout(messageTimersRef.current[popupId]);
    delete messageTimersRef.current[popupId];
  };

  const dismissMessagePopup = (popupId) => {
    clearMessagePopupTimer(popupId);
    setMessagePopups(prev => prev.filter(item => item.id !== popupId));
    setExpandedMessagePopupId(prev => (prev === popupId ? '' : prev));
    setQuickReplyDrafts(prev => {
      const next = { ...prev };
      delete next[popupId];
      return next;
    });
  };

  const toggleMessageHead = (popup) => {
    clearMessagePopupTimer(popup.id);
    triggerMobileHaptic(8);
    setExpandedMessagePopupId(prev => (prev === popup.id ? '' : popup.id));
  };

  const openMessagePopup = (popup) => {
    dismissMessagePopup(popup.id);
    const fromId = popup.fromId || getEntityId(popup.from);
    navigate(fromId ? `/messages?user=${fromId}` : '/messages');
  };

  const reactToMessagePopup = async (event, popup, emoji) => {
    event.stopPropagation();
    if (!popup?.messageId || messagePopupBusyId) return;

    setMessagePopupBusyId(`react-${popup.id}`);
    try {
      await api.post(`/messages/${popup.messageId}/react`, { emoji });
      playUiSound('click', 0.25);
      dismissMessagePopup(popup.id);
      toast.success('Reaction sent');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Could not react');
    } finally {
      setMessagePopupBusyId('');
    }
  };

  const sendQuickMessageReply = async (event, popup) => {
    event.preventDefault();
    event.stopPropagation();
    const text = String(quickReplyDrafts[popup.id] || '').trim();
    const to = popup.fromId || getEntityId(popup.from);
    if (!text || !to || messagePopupBusyId) return;

    setMessagePopupBusyId(`reply-${popup.id}`);
    try {
      await api.post('/messages', {
        to,
        text,
        replyTo: popup.messageId || popup.id
      });
      playUiSound('send', 0.32);
      dismissMessagePopup(popup.id);
      toast.success('Reply sent');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Reply failed');
    } finally {
      setMessagePopupBusyId('');
    }
  };

  const runMobileRefresh = async () => {
    if (pullRefresh.refreshing) return;
    triggerMobileHaptic(18);
    setPullRefresh({ distance: 58, refreshing: true });
    window.dispatchEvent(new CustomEvent('syncrova:mobile-refresh', {
      detail: { pathname: location.pathname }
    }));
    await new Promise(resolve => window.setTimeout(resolve, 900));
    setPullRefresh({ distance: 0, refreshing: false });
  };

  const handleAppTouchStart = (event) => {
    if (!enableMobilePullRefresh || !isMobileViewport() || pullRefresh.refreshing) return;
    if (event.currentTarget.scrollTop > 2) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    pullGestureRef.current = { tracking: true, startY: touch.clientY };
  };

  const handleAppTouchMove = (event) => {
    if (!enableMobilePullRefresh) return;
    const gesture = pullGestureRef.current;
    if (!gesture.tracking || pullRefresh.refreshing) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const distance = Math.max(0, touch.clientY - gesture.startY);
    if (distance <= 0) return;
    if (distance > 12) event.preventDefault();
    setPullRefresh(prev => ({
      ...prev,
      distance: Math.min(86, Math.round(distance * 0.45))
    }));
  };

  const handleAppTouchEnd = () => {
    const shouldRefresh = pullGestureRef.current.tracking && pullRefresh.distance >= 54;
    pullGestureRef.current = { tracking: false, startY: 0 };
    if (shouldRefresh) {
      runMobileRefresh();
      return;
    }
    if (!pullRefresh.refreshing) setPullRefresh({ distance: 0, refreshing: false });
  };

  const setFeedAutoplayPreference = (enabled) => {
    setFeedAutoplayEnabled(enabled);
    localStorage.setItem('syncrova.home.videoAutoplay', enabled ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('syncrova:video-autoplay-change', { detail: { enabled } }));
  };

  const clearAppCache = async () => {
    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }
      toast.success('App cache cleared');
    } catch {
      toast.error('Could not clear cache');
    }
  };

  const renderNavLink = (item, isMobile = false) => {
    const isActive = isNavItemActive(item.path);
    const isMessages = item.path === '/messages';
    const isFriends = item.path === '/friends';
    const badgeCount = isMessages ? messageBadgeCount : isFriends ? friendBadgeSignal : 0;
    const activeClasses = isActive
      ? 'border-blue-200 bg-blue-50 text-[#0b57d0] shadow-sm shadow-blue-500/10 dark:border-blue-400/25 dark:bg-blue-950/35 dark:text-sky-200'
      : 'border-transparent bg-transparent text-slate-700 hover:border-blue-100 hover:bg-blue-50/70 hover:text-[#0b57d0] dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white';
    const navStateClass = isActive ? 'is-active' : 'is-inactive';
    const baseClasses = `sidebar-nav-link ${navStateClass} group/nav flex h-10 w-full items-center gap-2.5 rounded-xl border px-3 text-[0.92rem] font-bold tracking-normal transition-colors ${activeClasses}`;
    const linkContent = (
      <>
        <div className={`relative flex shrink-0 items-center justify-center rounded-lg ${isMobile ? 'h-8 w-8' : 'h-8 w-8'} ${isActive ? 'bg-white shadow-sm dark:bg-white/10 dark:shadow-none' : 'bg-transparent group-hover/nav:bg-white/75 dark:group-hover/nav:bg-white/10'}`}>
          <item.icon size={isMobile ? 21 : 18} strokeWidth={isActive ? 2.6 : 2.25} />
          {badgeCount > 0 && (
            <span className={`absolute -top-1 -right-2 text-white text-xs rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center ${isMessages ? 'bg-red-500' : 'bg-blue-600'}`}>
              {badgeCount}
            </span>
          )}
        </div>
        {!isMobile && (
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap opacity-100 transition-all duration-300 ease-out">
            {item.label}
          </span>
        )}
      </>
    );

    if (isMobile) {
      return (
        <Link
          key={item.path}
          to={item.path}
          data-sound="tab"
          aria-current={isActive ? 'page' : undefined}
          onClick={() => setSidebarOpen(false)}
          className={`sidebar-nav-link mobile-sidebar-nav-link ${navStateClass} flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-sm font-bold transition ${activeClasses}`}
        >
          {linkContent}
          <span>{item.label}</span>
        </Link>
      );
    }

    return (
      <Link key={item.path} to={item.path} data-sound="tab" aria-current={isActive ? 'page' : undefined} className={baseClasses}>
        {linkContent}
      </Link>
    );
  };

  const TopbarIconButton = ({ children, onClick, label, pressed = false }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-xl text-white/90 transition hover:bg-white/10"
    >
      {children}
    </button>
  );

  const selectedNotificationActionPath = getNotificationActionPath(selectedNotification);
  const selectedNotificationActor = selectedNotification?.actorId && typeof selectedNotification.actorId === 'object'
    ? selectedNotification.actorId
    : null;
  const selectedNotificationActorAvatar = resolveMediaUrl(selectedNotificationActor?.avatar);
  const notificationListPanel = (
    <section
      className="notification-panel-shell w-full max-w-md overflow-hidden rounded-[1.35rem] border border-white/80 bg-white text-slate-950 shadow-2xl shadow-slate-950/25 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
      onClick={event => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/55">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-[#0b57d0] shadow-sm ring-1 ring-slate-200 dark:bg-slate-950 dark:text-sky-200 dark:ring-slate-800">
            <Bell size={20} />
          </span>
          <span className="min-w-0">
            <p className="text-base font-black text-slate-950 dark:text-white">Notifications</p>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {notificationAttentionLabel}
            </p>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={markAllNotificationsRead} disabled={!notificationUnreadCount} className="grid h-10 w-10 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 disabled:cursor-default disabled:opacity-35 dark:text-slate-400 dark:hover:bg-slate-800" title="Mark all read" aria-label="Mark all notifications as read">
            <CheckCheck size={17} />
          </button>
          <button type="button" onClick={() => setNotificationPanelOpen(false)} className="grid h-10 w-10 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" aria-label="Close notifications">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="max-h-[min(70vh,28rem)] overflow-y-auto p-2" aria-live="polite">
        {notificationsLoading ? (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map(item => (
              <div key={item} className="mobile-skeleton-card rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
                <div className="flex items-center gap-3">
                  <span className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800" />
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="block h-3 w-2/3 rounded-full bg-slate-200 dark:bg-slate-800" />
                    <span className="block h-3 w-4/5 rounded-full bg-slate-200 dark:bg-slate-800" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : notificationPanelItems.length ? notificationPanelItems.map(row => {
          if (row.kind === 'message-thread') {
            const actor = row.actor || {};
            const actorAvatar = resolveMediaUrl(actor.avatar);
            const latest = row.latest || {};
            const isExpanded = expandedNotificationThreads.has(row.key);
            const displayName = actor.name || actor.email || 'Messages';
            const messageCount = row.items.length;
            const messageLabel = `${messageCount} ${messageCount === 1 ? 'message' : 'messages'}`;
            const statusLabel = row.unreadCount
              ? `${row.unreadCount} unread ${row.unreadCount === 1 ? 'message' : 'messages'}`
              : `${messageLabel} in this conversation`;
            return (
              <article
                key={row.key}
                className={`notification-panel-row overflow-hidden rounded-2xl border shadow-sm transition ${
                  row.unreadCount
                    ? 'border-blue-100 bg-blue-50/70 shadow-blue-100/50 dark:border-blue-900/45 dark:bg-blue-950/18 dark:shadow-black/20'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/75 dark:hover:bg-slate-900'
                }`}
              >
                <div className="flex items-start gap-1 p-2">
                  <button
                    type="button"
                    onClick={() => openNotificationThread(row)}
                    className="group flex min-w-0 flex-1 items-start gap-3 rounded-xl p-1.5 text-left transition hover:bg-white/75 dark:hover:bg-slate-950/45"
                  >
                    <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white text-[#0b57d0] shadow-sm ring-1 ring-blue-100 dark:bg-slate-950 dark:text-sky-200 dark:ring-blue-900/50">
                      {actorAvatar ? <img src={actorAvatar} alt={displayName} className="h-full w-full object-cover" /> : <MessageCircle size={18} />}
                      {row.unreadCount > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-[#0b57d0] ring-2 ring-white dark:ring-slate-950" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="line-clamp-1 text-sm font-black text-slate-950 dark:text-white">{displayName}</span>
                        {messageCount > 1 && (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#0b57d0] px-1.5 text-[11px] font-black text-white">
                            {messageCount}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs font-bold text-[#0b57d0] dark:text-sky-300">{statusLabel}</span>
                      {latest.body && <span className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">{latest.body}</span>}
                      <span className="mt-1 block text-[11px] font-semibold text-slate-400">{formatNotificationTime(latest.createdAt)}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={event => toggleNotificationThread(event, row.key)}
                      className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-blue-50 hover:text-[#0b57d0] dark:hover:bg-blue-950/35 dark:hover:text-sky-200"
                      title={isExpanded ? 'Hide messages' : 'Show grouped messages'}
                      aria-label={isExpanded ? 'Hide messages' : 'Show grouped messages'}
                    >
                      {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <button
                      type="button"
                      onClick={event => deleteNotificationThread(event, row)}
                      className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 dark:hover:bg-rose-950/35 dark:hover:text-rose-300"
                      title="Delete message notifications"
                      aria-label="Delete message notifications"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-slate-200/70 bg-white/80 p-1.5 dark:border-slate-800 dark:bg-black/20">
                    {row.items.map(notification => (
                      <button
                        key={getEntityId(notification)}
                        type="button"
                        onClick={() => openNotification(notification)}
                        className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition hover:bg-blue-50 dark:hover:bg-blue-950/25"
                      >
                        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.read ? 'bg-slate-300 dark:bg-slate-700' : 'bg-[#0b57d0]'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-xs font-bold text-slate-700 dark:text-slate-200">{notification.body || getNotificationHeadline(notification)}</span>
                          <span className="mt-0.5 block text-[10px] font-semibold text-slate-400">{formatNotificationTime(notification.createdAt)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </article>
            );
          }

          const notification = row.notification;
          const actor = notification.actorId && typeof notification.actorId === 'object' ? notification.actorId : {};
          const actorAvatar = resolveMediaUrl(actor.avatar);
          const headline = getNotificationHeadline(notification);
          return (
            <article
              key={row.key}
              className={`notification-panel-row group flex items-start gap-1 rounded-2xl border p-2 shadow-sm transition hover:bg-slate-50 dark:hover:bg-slate-900 ${
                notification.read
                  ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/75'
                  : 'border-blue-100 bg-blue-50/70 dark:border-blue-900/45 dark:bg-blue-950/18'
              }`}
            >
              <button
                type="button"
                onClick={() => openNotification(notification)}
                className="flex min-w-0 flex-1 items-start gap-3 rounded-xl p-1.5 text-left transition hover:bg-white/75 dark:hover:bg-slate-950/45"
              >
                <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white text-[#0b57d0] shadow-sm ring-1 ring-blue-100 dark:bg-slate-950 dark:text-sky-200 dark:ring-blue-900/50">
                  {actorAvatar ? <img src={actorAvatar} alt={actor.name || 'User'} className="h-full w-full object-cover" /> : (actor.name || notification.type || 'N').charAt(0).toUpperCase()}
                  {!notification.read && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-[#0b57d0] ring-2 ring-white dark:ring-slate-950" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-black leading-5 text-slate-950 dark:text-white">{headline}</span>
                  {notification.body && <span className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">{notification.body}</span>}
                  <span className="mt-1 block text-[11px] font-semibold text-slate-400">{formatNotificationTime(notification.createdAt)}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={event => deleteNotification(event, notification)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 dark:hover:bg-rose-950/35 dark:hover:text-rose-300"
                title="Delete notification"
                aria-label="Delete notification"
              >
                <Trash2 size={15} />
              </button>
            </article>
          );
        }) : (
          <p className="rounded-xl p-5 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">No notifications yet.</p>
        )}
      </div>
      <div className="border-t border-slate-100 p-2 dark:border-slate-800">
        <Link
          to="/notifications"
          onClick={() => setNotificationPanelOpen(false)}
          className="flex items-center justify-center rounded-xl bg-blue-50 px-3 py-2 text-sm font-black text-[#0b57d0] transition hover:bg-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:hover:bg-blue-950/50"
        >
          View all notifications
        </Link>
      </div>
    </section>
  );

  return (
    <div className={`portal-shell mobile-app-shell text-slate-900 dark:text-slate-100 ${isDashboardRoute && dashboardHeaderHidden ? 'portal-shell--dashboard-header-hidden' : ''}`}>
      <header className="desktop-topbar fixed inset-x-0 top-0 z-40 hidden h-16 items-center justify-between bg-[#07036f] px-5 text-white shadow-lg shadow-[#07036f]/20 dark:bg-[#050505] dark:shadow-black/35 md:flex">
        <div className="flex min-w-0 items-center gap-3">
          <AppLogoMark size="xs" className="rounded-full bg-white p-1 shadow-none ring-1 ring-white/25" />
          <div className="min-w-0">
            <p className="truncate text-sm font-black tracking-normal">Syncrova</p>
            <p className="truncate text-[11px] font-semibold text-white/70">made by sigmaboyz</p>
          </div>
          <Link
            to="/search"
            className="desktop-header-search ml-3 hidden min-w-[15rem] items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-sm font-bold text-white/75 transition hover:bg-white/15 hover:text-white xl:flex"
          >
            <Search size={16} />
            <span className="truncate">Search Syncrova</span>
          </Link>
        </div>
        <nav className="desktop-primary-nav absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex" aria-label="Primary navigation">
          {mainNavItems.slice(0, 5).map(item => {
            const active = isNavItemActive(item.path);
            return (
              <Link
                key={`desktop-tab-${item.path}`}
                to={item.path}
                data-sound="tab"
                className={`desktop-primary-nav-item ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                title={item.label}
              >
                <item.icon size={21} strokeWidth={active ? 2.7 : 2.2} />
              </Link>
            );
          })}
        </nav>
        <div className="flex min-w-0 items-center gap-2">
          <div className="hidden min-w-0 items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-black text-white/90 lg:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-300" />
            <span className="truncate">{pageMeta.title}</span>
          </div>
          {!isOnline && (
            <span className="hidden items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1.5 text-xs font-black text-amber-100 xl:inline-flex">
              <WifiOff size={14} />
              Offline
            </span>
          )}
          <NotificationCenterButton compact surface="navy" />
          <TopbarIconButton
            label={dndEnabled ? 'Do not disturb is on' : 'Message alerts are on'}
            pressed={dndEnabled}
            onClick={() => setDndEnabled(value => !value)}
          >
            {dndEnabled ? <BellOff size={19} /> : <Volume2 size={19} />}
          </TopbarIconButton>
          {user && (
            <Link to="/profile" data-sound="tab" className="ml-1 flex min-w-0 items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3 text-white transition hover:bg-white/15">
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-white/15 text-sm font-black ring-1 ring-white/20">
                {avatarSrc ? <img src={avatarSrc} alt={user.name} className="h-full w-full object-cover" /> : user.name?.charAt(0)?.toUpperCase()}
              </span>
              <span className="hidden max-w-[9rem] truncate text-sm font-black xl:block">{user.name}</span>
            </Link>
          )}
        </div>
      </header>

      <aside className="desktop-sidebar group/sidebar fixed bottom-0 top-16 z-30 hidden w-72 min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-white text-slate-700 shadow-xl shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:shadow-black/30 md:flex">
        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <SidebarProfileTools />
          <section>
            <p className="mb-2 px-3 text-[10px] font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">Main</p>
            <div className="space-y-1.5">
              {mainNavItems.map(item => renderNavLink(item, false))}
            </div>
          </section>

          {toolNavItems.length > 0 && (
          <section>
            <p className="mb-1.5 px-2.5 text-[10px] font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">Settings</p>
            <div className="space-y-1">
              {toolNavItems.map(item => renderNavLink(item, false))}
            </div>
          </section>
          )}
        </nav>

      </aside>

      <div className="layout-content-frame mobile-layout-content-frame flex min-h-0 flex-col md:ml-72 md:pt-16">
        {!hideMobileTopbar && (
          <header className={`mobile-topbar mobile-app-bar ${useFacebookMobileHome ? 'mobile-home-topbar mobile-app-bar--home' : 'mobile-app-bar--section'} sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#07036f] text-white shadow-lg shadow-[#07036f]/20 dark:bg-[#050505] dark:shadow-black/35 md:hidden`}>
            {useFacebookMobileHome ? (
              <>
                <div className="mobile-home-topbar-title min-w-0">
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="mobile-home-menu-button"
                    aria-label="Open menu"
                    aria-expanded={sidebarOpen}
                  >
                    <Menu size={24} />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/dashboard')}
                    className="mobile-home-brand-button"
                    aria-label="Syncrova home"
                  >
                    <AppLogoMark size="xs" className="mobile-home-brand-logo" />
                    <span className="mobile-home-brand-copy">
                      <AppWordmark size="sm" className="mobile-home-wordmark" />
                      <span>Campus network</span>
                    </span>
                  </button>
                </div>
                <div className="mobile-topbar-actions mobile-home-actions flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('/search')}
                    className="mobile-topbar-action"
                    aria-label="Open global search"
                  >
                    <Search size={21} />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/messages')}
                    className="mobile-topbar-action relative"
                    aria-label="Open messages"
                  >
                    <MessageCircle size={21} />
                    {unreadCount > 0 && (
                      <span className="mobile-home-action-badge">
                        {messageBadgeCount}
                      </span>
                    )}
                  </button>
                  <NotificationCenterButton compact surface="default" />
                </div>
              </>
            ) : (
              <>
                <div className="mobile-topbar-brand min-w-0" title={`${APP_NAME} - ${pageMeta.title}`}>
                  <AppLogoMark size="xs" className="mobile-topbar-logo" />
                  <span className="mobile-topbar-copy min-w-0">
                    <AppWordmark size="sm" className="mobile-topbar-wordmark" />
                    <span className="mobile-topbar-page truncate">{pageMeta.title}</span>
                  </span>
                </div>
                <div className="mobile-topbar-actions flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => navigate('/search')}
                    className="mobile-topbar-action grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition active:scale-95"
                    aria-label="Open global search"
                  >
                    <Search size={18} />
                  </button>
                  <NotificationCenterButton compact surface="default" />
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="mobile-topbar-action grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition active:scale-95"
                    aria-label="Open app settings"
                  >
                    <Settings size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="mobile-topbar-action grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-white/10 text-white ring-1 ring-white/15 transition active:scale-95"
                    aria-label="Open menu"
                    aria-expanded={sidebarOpen}
                  >
                    {user && avatarSrc ? (
                      <img src={avatarSrc} alt={user.name} className="h-full w-full object-cover" />
                    ) : user ? (
                      <span className="text-sm font-black">{user.name?.charAt(0)?.toUpperCase()}</span>
                    ) : (
                      <Menu size={20} />
                    )}
                  </button>
                </div>
              </>
            )}
          </header>
        )}

        {showFacebookMobileTabs && (
          <nav className="mobile-fb-tabbar md:hidden" style={mobileTabStyle} aria-label="Home sections">
            {mobileBottomItems.map(item => {
              const isActive = isNavItemActive(item.path);
              const isMessages = item.path === '/messages';
              const isFriends = item.path === '/friends';
              const badgeCount = isMessages ? messageBadgeCount : isFriends ? friendBadgeSignal : 0;
              return (
                <Link
                  key={`mobile-fb-${item.path}`}
                  to={item.path}
                  data-sound="tab"
                  className={`mobile-fb-tabbar-item ${isActive ? 'is-active' : ''}`}
                  aria-label={item.label}
                >
                  <item.icon size={23} strokeWidth={isActive ? 2.8 : 2.25} />
                  {badgeCount > 0 && (
                    <span className="mobile-fb-tabbar-badge">
                      {badgeCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        )}

        {(connectionNotice || !isOnline) && (
          <div className={`mobile-network-banner md:hidden ${showFacebookMobileTabs ? 'mobile-network-banner--below-tabs' : ''} ${isOnline ? 'is-online' : 'is-offline'}`}>
            <span className={`h-2 w-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span>{connectionNotice || 'No connection. Actions will retry when you are online.'}</span>
          </div>
        )}

        {!tabHeavyMobileRoute && !isDashboardRoute && (
        <div className="mobile-context-panel sticky top-[calc(3.65rem_+_env(safe-area-inset-top))] z-[18] px-2 pt-1.5 md:hidden">
          {!isOnline && (
            <div
              className="mb-2 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 shadow-lg shadow-amber-500/10 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <WifiOff size={15} />
              Offline mode. Some actions will retry when connection returns.
            </div>
          )}
          {!location.pathname.startsWith('/messages') && !location.pathname.startsWith('/reels') && (
            <div className="space-y-2">
              <div className="mobile-page-titlebar flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/92 px-3 py-2.5 shadow-lg shadow-slate-200/40 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/92 dark:shadow-black/25">
                <div className="min-w-0">
                  <p className="truncate text-base font-black text-slate-950 dark:text-white">{pageMeta.title}</p>
                  <p className="truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">{pageMeta.helper}</p>
                </div>
                <button
                  type="button"
                  onClick={pageMeta.action}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#07036f] text-white shadow-lg shadow-[#07036f]/15 transition active:scale-95"
                  aria-label={`Open ${pageMeta.title}`}
                >
                  <PlusCircle size={19} />
                </button>
              </div>
            </div>
          )}
        </div>
        )}

        <div className="flex min-h-0 flex-1">
          <main
            className={`app-main min-w-0 flex-1 overflow-x-hidden overflow-y-auto ${isCompactRoute ? 'app-main--compact' : ''} ${mobileChatRouteOpen ? 'app-main--mobile-chat-open' : ''} ${showFacebookMobileTabs ? 'app-main--mobile-top-tabs' : ''} ${useFacebookMobileHome ? 'app-main--mobile-fb-home' : ''} ${!hideMobileBottomNav ? 'app-main--with-mobile-dock' : ''}`}
            onScroll={handleAppMainScroll}
            onTouchStart={handleAppTouchStart}
            onTouchMove={handleAppTouchMove}
            onTouchEnd={handleAppTouchEnd}
            onTouchCancel={handleAppTouchEnd}
          >
            <div
              className={`mobile-pull-refresh md:hidden ${pullRefresh.refreshing ? 'is-refreshing' : ''}`}
              style={{
                opacity: pullRefresh.distance > 4 || pullRefresh.refreshing ? 1 : 0,
                transform: `translate3d(-50%, ${Math.max(0, pullRefresh.distance - 42)}px, 0)`
              }}
            >
              <RotateCcw size={16} className={pullRefresh.refreshing ? 'animate-spin' : ''} />
              <span>{pullRefresh.refreshing ? 'Refreshing' : 'Pull to refresh'}</span>
            </div>
            <div className="app-page-content min-h-full">{pageContent}</div>
          </main>

        </div>

        {!hideMobileBottomNav && (
        <nav className="mobile-bottom-nav mobile-primary-dock fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/92 shadow-2xl shadow-slate-300/35 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/92 dark:shadow-black/30 md:hidden" style={mobileTabStyle} aria-label="Primary navigation">
          {mobileBottomItems.map(item => {
            const isActive = isNavItemActive(item.path);
            const isMessages = item.path === '/messages';
            const isFriends = item.path === '/friends';
            const badgeCount = isMessages ? messageBadgeCount : isFriends ? friendBadgeSignal : 0;
            return (
              <Link
                key={item.path}
                to={item.path}
                data-sound="tab"
                className={`mobile-nav-item mobile-primary-dock-item relative flex flex-col items-center justify-center gap-0.5 ${isActive ? 'is-active' : ''}`}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <item.icon size={21} strokeWidth={isActive ? 2.6 : 2.2} />
                <span className="max-w-full truncate text-[10px] font-black leading-none">{item.mobileLabel || item.label}</span>
                {badgeCount > 0 && (
                  <span className={`absolute right-1 top-0 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs text-white ${isMessages ? 'bg-red-500' : 'bg-blue-600'}`}>
                    {badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        )}
      </div>

      <div className="pointer-events-none fixed bottom-[5.8rem] right-3 z-[86] flex w-[min(94vw,23rem)] flex-col items-end gap-3 md:bottom-auto md:right-6 md:top-20">
        {messagePopups.map(popup => {
            const popupAvatar = resolveMediaUrl(popup.from?.avatar);
            const senderName = getDisplayName(popup.from, 'Someone');
            const expanded = expandedMessagePopupId === popup.id;
            const replyText = quickReplyDrafts[popup.id] || '';
            const replyBusy = messagePopupBusyId === `reply-${popup.id}`;
            const reactBusy = messagePopupBusyId === `react-${popup.id}`;

            return (
              <div
                key={popup.id}
                className="pointer-events-auto flex w-full items-end justify-end gap-2"
              >
                {expanded && (
                  <div
                    className="min-w-0 flex-1 overflow-hidden rounded-[1.35rem] border border-blue-100 bg-white/96 p-3 text-left text-slate-950 shadow-2xl shadow-blue-500/18 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/96 dark:text-white dark:shadow-black/40"
                    onClick={event => event.stopPropagation()}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#0b57d0] to-[#2387a8] text-sm font-bold text-white">
                        {popupAvatar ? <img src={popupAvatar} alt={senderName} className="h-full w-full object-cover" /> : senderName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black">{senderName}</p>
                            <p className="mt-0.5 text-[11px] font-black uppercase text-[#0b57d0] dark:text-sky-300">{formatNotificationTime(popup.createdAt)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => dismissMessagePopup(popup.id)}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                            aria-label="Close message head"
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm font-semibold text-slate-600 dark:text-slate-300">{popup.body}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-1.5">
                      {['👍', '❤️', '😂', '😮'].map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          disabled={reactBusy || replyBusy}
                          onClick={event => reactToMessagePopup(event, popup, emoji)}
                          className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-lg transition hover:scale-105 hover:bg-blue-50 disabled:opacity-60 dark:bg-slate-900 dark:hover:bg-blue-950/40"
                          aria-label={`React ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => openMessagePopup(popup)}
                        className="ml-auto rounded-full bg-blue-50 px-3 py-2 text-xs font-black text-[#0b57d0] transition hover:bg-blue-100 dark:bg-blue-950/35 dark:text-sky-200 dark:hover:bg-blue-900/45"
                      >
                        Open
                      </button>
                    </div>

                    <form className="mt-3 flex items-center gap-2" onSubmit={event => sendQuickMessageReply(event, popup)}>
                      <input
                        value={replyText}
                        onChange={event => setQuickReplyDrafts(prev => ({ ...prev, [popup.id]: event.target.value }))}
                        placeholder="Reply..."
                        className="h-10 min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-950 outline-none transition focus:border-[#0b57d0] focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:focus:bg-slate-900"
                      />
                      <button
                        type="submit"
                        disabled={!replyText.trim() || replyBusy || reactBusy}
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0b57d0] text-white shadow-lg shadow-blue-500/25 transition hover:bg-[#1877f2] disabled:opacity-55"
                        aria-label="Send quick reply"
                      >
                        {replyBusy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                      </button>
                    </form>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleMessageHead(popup)}
                  className={`relative grid h-16 w-16 shrink-0 place-items-center rounded-full border border-white/80 bg-white text-[#0b57d0] shadow-2xl shadow-blue-500/25 ring-4 ring-blue-500/10 transition hover:scale-105 dark:border-slate-800 dark:bg-slate-950 dark:text-sky-200 dark:shadow-black/40 dark:ring-sky-400/15 ${expanded ? 'scale-105' : ''}`}
                  aria-label={`${expanded ? 'Collapse' : 'Open'} message from ${senderName}`}
                >
                  <AppLogoMark size="md" className="shadow-none" />
                  <span className="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-black text-white ring-2 ring-white dark:ring-slate-950">1</span>
                  <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#0b57d0] to-[#2387a8] text-[11px] font-black text-white ring-2 ring-white dark:ring-slate-950">
                    {popupAvatar ? <img src={popupAvatar} alt={senderName} className="h-full w-full object-cover" /> : senderName.charAt(0).toUpperCase()}
                  </span>
                </button>
              </div>
            );
          })}
      </div>

      {notificationPanelOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
          onClick={() => setNotificationPanelOpen(false)}
        >
          {notificationListPanel}
        </div>
      )}

      {selectedNotification && (
        <div
          className="fixed inset-0 z-[96] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm transition-opacity"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notification-detail-title"
          onClick={closeNotificationModal}
        >
          <section
            className="w-full max-w-md overflow-hidden rounded-[1.6rem] border border-white/70 bg-white text-slate-950 shadow-2xl shadow-slate-950/25 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
            onClick={event => event.stopPropagation()}
          >
            <div className="h-1.5 bg-gradient-to-r from-[#0b57d0] via-sky-400 to-emerald-400" />
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#0b57d0] to-[#2387a8] text-base font-black text-white shadow-lg shadow-blue-500/20">
                  {selectedNotificationActorAvatar ? (
                    <img src={selectedNotificationActorAvatar} alt={selectedNotificationActor?.name || 'Notification actor'} className="h-full w-full object-cover" />
                  ) : (
                    <Bell size={22} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">
                    {selectedNotification.type ? `${selectedNotification.type} notification` : 'Notification'}
                  </p>
                  <h2 id="notification-detail-title" className="mt-1 text-xl font-black leading-tight tracking-normal text-slate-950 dark:text-white">
                    {selectedNotification.title || 'Notification'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeNotificationModal}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  aria-label="Close notification details"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200">
                  {selectedNotification.body || selectedNotification.message || 'No additional details were included with this notification.'}
                </p>
              </div>

              <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">Date and time</span>
                  <span className="text-right text-sm font-black text-slate-800 dark:text-slate-100">
                    {formatNotificationDateTime(selectedNotification.createdAt)}
                  </span>
                </div>
                {selectedNotificationActor ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">From</span>
                    <span className="max-w-[12rem] truncate text-right text-sm font-black text-slate-800 dark:text-slate-100">
                      {selectedNotificationActor.name || selectedNotificationActor.email || 'User'}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">Related action</span>
                  <span className="max-w-[13rem] truncate text-right text-sm font-black text-slate-800 dark:text-slate-100">
                    {selectedNotificationActionPath ? getNotificationActionLabel(selectedNotification) : 'No action available'}
                  </span>
                </div>
              </div>
            </div>

            <div className={`grid gap-2 border-t border-slate-100 p-4 dark:border-slate-800 ${selectedNotificationActionPath ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <button
                type="button"
                onClick={closeNotificationModal}
                className="inline-flex h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                Close
              </button>
              {selectedNotificationActionPath ? (
                <button
                  type="button"
                  onClick={openSelectedNotificationAction}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#0b57d0] px-4 text-sm font-black text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-700"
                >
                  {getNotificationActionLabel(selectedNotification)}
                  <ChevronRight size={17} />
                </button>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-[95] flex items-end bg-slate-950/45 backdrop-blur-sm md:hidden" onClick={() => setSettingsOpen(false)}>
          <section
            className="mobile-settings-sheet mobile-bottom-sheet w-full rounded-t-[1.7rem] border border-slate-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-950 shadow-2xl dark:border-slate-800 dark:bg-slate-950 dark:text-white"
            onClick={event => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-200 dark:bg-slate-800" />
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">Mobile app</p>
                <h2 className="text-xl font-black">App settings</h2>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300"
                aria-label="Close app settings"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                <span className="min-w-0">
                  <span className="block text-sm font-black">Post video autoplay</span>
                  <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Muted autoplay for visible feed videos</span>
                </span>
                <input
                  type="checkbox"
                  checked={feedAutoplayEnabled}
                  onChange={event => setFeedAutoplayPreference(event.target.checked)}
                  className="h-5 w-5 accent-[#0b57d0]"
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                <span className="min-w-0">
                  <span className="block text-sm font-black">Message alerts</span>
                  <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">{dndEnabled ? 'Do not disturb is on' : 'Popups and sounds are on'}</span>
                </span>
                <input
                  type="checkbox"
                  checked={!dndEnabled}
                  onChange={event => setDndEnabled(!event.target.checked)}
                  className="h-5 w-5 accent-[#0b57d0]"
                />
              </label>

              <button
                type="button"
                onClick={enableNotifications}
                className="flex w-full items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 text-left ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-black">Phone notifications</span>
                  <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Status: {notificationPermission}</span>
                </span>
                <Bell size={19} className="text-[#0b57d0] dark:text-sky-300" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  navigate('/developer-console');
                }}
                className="flex w-full items-center justify-between gap-3 rounded-2xl bg-blue-50 p-3 text-left ring-1 ring-blue-100 transition active:scale-[0.99] dark:bg-blue-950/30 dark:ring-blue-900/45"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-black text-slate-950 dark:text-white">Developer Console</span>
                  <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Reports, moderation, and system tools</span>
                </span>
                <ShieldCheck size={19} className="text-[#0b57d0] dark:text-sky-300" />
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={clearAppCache}
                  className="rounded-2xl bg-slate-50 p-3 text-left ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
                >
                  <Trash2 size={18} className="text-rose-500" />
                  <span className="mt-2 block text-sm font-black">Clear cache</span>
                </button>
                <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                  <Smartphone size={18} className="text-[#0b57d0] dark:text-sky-300" />
                  <span className="mt-2 block text-sm font-black">Fullscreen</span>
                  <span className="mt-0.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">Enabled in app</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {sidebarOpen && (
          <>
            <div
              className="mobile-sidebar-backdrop fixed inset-0 z-[88] bg-black/50 md:hidden"
              aria-hidden="true"
              onClick={() => setSidebarOpen(false)}
            />
            <aside
              className="mobile-sidebar-drawer mobile-navigation-drawer fixed bottom-0 left-0 top-0 z-[100] w-[min(86vw,20rem)] border-r border-slate-200 bg-white text-slate-900 shadow-2xl shadow-gray-950/20 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 md:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
            >
              <div className="mobile-sidebar-header flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
                <BrandLogo mobile />
                <button onClick={() => setSidebarOpen(false)} data-sound="close" className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" aria-label="Close menu">
                  <X size={24} />
                </button>
              </div>
              <nav className="mobile-sidebar-nav flex h-[calc(100%-4.5rem)] flex-col gap-4 overflow-y-auto p-4">
                <section className="space-y-2">
                  <p className="px-2 text-[11px] font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">Main</p>
                  {mainNavItems.map(item => renderNavLink(item, true))}
                </section>
                <SidebarProfileTools mobile />

                {toolNavItems.length > 0 && (
                <section className="space-y-2">
                  <p className="px-2 text-[11px] font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">Settings</p>
                  {toolNavItems.map(item => renderNavLink(item, true))}
                </section>
                )}

              </nav>
            </aside>
          </>
        )}
    </div>
  );
}
