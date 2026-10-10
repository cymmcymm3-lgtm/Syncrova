import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  CheckCheck,
  Filter,
  Gamepad2,
  MessageCircle,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users
} from 'lucide-react';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { resolveMediaUrl } from '../utils/media';
import { ListSkeleton } from './SkeletonLoader';
import type { AppNotification } from '../types/models';

const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');

const formatNotificationTime = (value) => {
  if (!value) return 'Now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Now';
  const diffMins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const typeIcon = {
  message: MessageCircle,
  friend: UserPlus,
  group: Users,
  game: Gamepad2,
  task: CheckCheck,
  story: Bell,
  note: Bell,
  reaction: Bell,
  comment: Bell,
  post: Bell
};

const filters = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'message', label: 'Messages' },
  { id: 'friend', label: 'Friends' },
  { id: 'group', label: 'Groups' },
  { id: 'story', label: 'My Day' }
];

const notificationGroups = {
  message: { label: 'Messages', icon: MessageCircle },
  friend: { label: 'Friends', icon: UserPlus },
  game: { label: 'Games', icon: Gamepad2 },
  activity: { label: 'Activity', icon: Bell }
};

const isRetiredMarketplaceNotification = (notification: AppNotification = {}) => {
  const type = String(notification.type || '').toLowerCase();
  const text = `${notification.title || ''} ${notification.body || ''} ${notification.href || ''}`.toLowerCase();
  return type === 'marketplace'
    || type === 'listing'
    || type === 'group'
    || text.includes('marketplace')
    || text.includes('/marketplace')
    || text.includes('/group/');
};

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

const normalizeNotificationFeed = (items = []) => {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .filter(item => !isRetiredMarketplaceNotification(item))
    .slice()
    .sort((first, second) => getNotificationTimestamp(second) - getNotificationTimestamp(first))
    .filter(notification => {
      const key = getNotificationFeedKey(notification);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const getNotificationGroupKey = (notification: AppNotification = {}) => {
  const type = String(notification.type || '').toLowerCase();
  const href = String(notification.href || notification.meta?.href || notification.meta?.path || '').trim();
  const text = `${notification.title || ''} ${notification.body || ''} ${notification.href || ''}`.toLowerCase();
  if (type === 'message' || (!type && /^\/messages(?:[/?]|$)/.test(href))) return 'message';
  if (type === 'friend' || text.includes('/friends')) return 'friend';
  if (type === 'game' || text.includes('game hub') || text.includes('/arena')) return 'game';
  return 'activity';
};

type NotificationAttentionSummary = {
  messages: number;
  activity: number;
  total: number;
};

const getUnreadAttentionSummary = (items = []): NotificationAttentionSummary => {
  const categories = new Set<string>();
  normalizeNotificationFeed(items).forEach(notification => {
    if (!notification.read) {
      categories.add(getNotificationGroupKey(notification) === 'message' ? 'message' : 'activity');
    }
  });
  const messages = categories.has('message') ? 1 : 0;
  const activity = categories.has('activity') ? 1 : 0;
  return { messages, activity, total: messages + activity };
};

const normalizeUnreadAttentionSummary = (value: unknown): NotificationAttentionSummary | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (!('messages' in source) && !('activity' in source)) return null;
  const messages = Number(source.messages) > 0 ? 1 : 0;
  const activity = Number(source.activity) > 0 ? 1 : 0;
  return { messages, activity, total: messages + activity };
};

const getNotificationAction = (notification: AppNotification = {}) => {
  const groupKey = getNotificationGroupKey(notification);
  if (notification.meta?.storyId) return { label: 'Open dashboard', href: notification.href || '/dashboard' };
  if (notification.meta?.noteId) return { label: 'Open messages', href: notification.href || '/messages' };
  if (groupKey === 'message') return { label: 'Reply', href: notification.href || '/messages' };
  if (groupKey === 'friend') return { label: 'Review', href: notification.href || '/friends' };
  if (groupKey === 'game') return { label: 'Open Games', href: notification.href || '/arena' };
  return { label: 'Open', href: notification.href || '/notifications' };
};

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
    return normalizedTitle.includes('my day reply')
      ? `${actorName} replied to your My Day`
      : `${actorName} sent you a message`;
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

const getMessageThreadKey = (notification: AppNotification = {}) => {
  const actorId = getNotificationActorId(notification);
  if (actorId) return `actor:${actorId}`;
  return `messages:${notification.href || '/messages'}`;
};

const buildMessageThreads = (items = []) => {
  const threads = new Map();
  items.forEach(notification => {
    const key = getMessageThreadKey(notification);
    const actor = getNotificationActor(notification);
    if (!threads.has(key)) {
      threads.set(key, {
        key,
        actor,
        items: []
      });
    }
    const thread = threads.get(key);
    if (!thread.actor && actor) thread.actor = actor;
    thread.items.push(notification);
  });

  return Array.from(threads.values()).map(thread => ({
    ...thread,
    latest: thread.items[0],
    unreadCount: thread.items.filter(item => !item.read).length
  }));
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadSummary, setUnreadSummary] = useState<NotificationAttentionSummary>({ messages: 0, activity: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedMessageThreads, setExpandedMessageThreads] = useState(() => new Set());

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications');
      const items = normalizeNotificationFeed(res.data?.notifications || []);
      setNotifications(items);
      setUnreadSummary(normalizeUnreadAttentionSummary(res.data?.unreadSummary) || getUnreadAttentionSummary(items));
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshUnreadSummary = useCallback(async () => {
    try {
      const res = await api.get('/notifications/unread-count');
      const summary = normalizeUnreadAttentionSummary(res.data?.unreadSummary);
      if (summary) setUnreadSummary(summary);
    } catch {
      // A badge refresh should not interrupt opening or deleting an alert.
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const refresh = () => loadNotifications();
    const socket = getSocket();
    socket.on('notifications-updated', refresh);
    window.addEventListener('syncrova:mobile-refresh', refresh);
    return () => {
      socket.off('notifications-updated', refresh);
      window.removeEventListener('syncrova:mobile-refresh', refresh);
    };
  }, [loadNotifications]);

  // The notification center summarizes attention categories. Individual
  // message threads still retain their exact unread count below.
  const unreadCount = unreadSummary.total;
  const filteredNotifications = useMemo(() => {
    const query = search.trim().toLowerCase();
    return notifications.filter(item => {
      const filterMatch = filter === 'all'
        || (filter === 'unread' ? !item.read : (item.type === filter || getNotificationGroupKey(item) === filter));
      const textMatch = !query
        || item.title?.toLowerCase().includes(query)
        || item.body?.toLowerCase().includes(query)
        || item.actorId?.name?.toLowerCase().includes(query);
      return filterMatch && textMatch;
    });
  }, [filter, notifications, search]);
  const groupedNotifications = useMemo(() => {
    const groups = new Map();
    filteredNotifications.forEach(notification => {
      const key = getNotificationGroupKey(notification);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(notification);
    });
    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      meta: notificationGroups[key] || notificationGroups.activity,
      items
    }));
  }, [filteredNotifications]);

  const markAllRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev => prev.map(item => ({ ...item, read: true })));
      setUnreadSummary({ messages: 0, activity: 0, total: 0 });
      toast.success('Notifications marked as read');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to update notifications');
    }
  };

  const openNotification = async (notification) => {
    const id = getEntityId(notification);
    if (!notification.read && id) {
      api.put(`/notifications/${id}/read`)
        .then(() => refreshUnreadSummary())
        .catch(() => {});
      setNotifications(prev => prev.map(item => getEntityId(item) === id ? { ...item, read: true } : item));
    }
    if (notification.href && !isRetiredMarketplaceNotification(notification)) navigate(notification.href);
  };

  const markNotificationsRead = async (items = []) => {
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
    await refreshUnreadSummary();
  };

  const openMessageThread = (thread) => {
    void markNotificationsRead(thread.items);
    navigate(thread.latest?.href || '/messages');
  };

  const toggleMessageThread = (event, threadKey) => {
    event.stopPropagation();
    setExpandedMessageThreads(prev => {
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
      await refreshUnreadSummary();
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
      await refreshUnreadSummary();
      setExpandedMessageThreads(prev => {
        const next = new Set(prev);
        next.delete(thread.key);
        return next;
      });
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Delete failed');
    }
  };

  const renderMessageThreads = (items = []) => buildMessageThreads(items).map(thread => {
    const actor = thread.actor || {};
    const actorAvatar = resolveMediaUrl(actor.avatar);
    const latest = thread.latest || {};
    const isExpanded = expandedMessageThreads.has(thread.key);
    const displayName = actor.name || actor.email || 'Messages';
    const messageCount = thread.items.length;
    const messageNoun = messageCount === 1 ? 'message' : 'messages';
    const unreadNoun = thread.unreadCount === 1 ? 'message' : 'messages';
    const unreadLabel = thread.unreadCount
      ? `${thread.unreadCount} unread ${unreadNoun}`
      : `${messageCount} ${messageNoun}`;

    return (
      <article
        key={thread.key}
        className={`overflow-hidden rounded-[1.25rem] border shadow-sm transition ${
          thread.unreadCount
            ? 'border-blue-200 bg-blue-50/85 shadow-blue-200/45 dark:border-blue-900/50 dark:bg-blue-950/20 dark:shadow-black/20'
            : 'border-slate-200 bg-white/92 shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20'
        }`}
      >
        <div className="group flex items-start gap-1 p-3">
          <button
            type="button"
            onClick={() => openMessageThread(thread)}
            className="flex min-w-0 flex-1 items-start gap-3 rounded-2xl p-1 text-left transition hover:bg-white/55 dark:hover:bg-white/[0.03]"
          >
            <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-[1.1rem] bg-gradient-to-br from-[#0b57d0] to-[#2387a8] text-sm font-black text-white">
              {actorAvatar ? <img src={actorAvatar} alt={displayName} className="h-full w-full object-cover" /> : <MessageCircle size={23} />}
              {thread.unreadCount > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-950" />}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="line-clamp-1 text-base font-black text-slate-950 dark:text-white">{displayName}</span>
                {messageCount > 1 && (
                  <span className="rounded-full bg-[#0b57d0] px-2.5 py-1 text-[11px] font-black text-white shadow-sm shadow-blue-500/20">
                    {messageCount}
                  </span>
                )}
              </span>
              <span className="mt-1 block text-xs font-bold text-[#0b57d0] dark:text-sky-300">{unreadLabel}</span>
              {latest.body && <span className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-slate-600 dark:text-slate-300">{latest.body}</span>}
              <span className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-400">{formatNotificationTime(latest.createdAt)}</span>
                <span className="text-[11px] font-black text-[#0b57d0] dark:text-sky-200">Open chat</span>
              </span>
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={event => toggleMessageThread(event, thread.key)}
              className="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition hover:bg-blue-50 hover:text-[#0b57d0] dark:text-slate-300 dark:hover:bg-blue-950/35 dark:hover:text-sky-200"
              title={isExpanded ? 'Hide messages' : 'View grouped messages'}
              aria-label={isExpanded ? 'Hide messages' : 'View grouped messages'}
            >
              {isExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            </button>
            <button
              type="button"
              onClick={event => deleteNotificationThread(event, thread)}
              className="grid h-9 w-9 place-items-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 dark:hover:bg-rose-950/35 dark:hover:text-rose-300"
              title="Delete this notification group"
              aria-label="Delete this notification group"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t border-slate-200 bg-white/70 p-2 dark:border-slate-800 dark:bg-black/15">
            {thread.items.map(notification => (
              <button
                key={getEntityId(notification)}
                type="button"
                onClick={() => openNotification(notification)}
                className={`flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-blue-50 dark:hover:bg-blue-950/25 ${
                  notification.read ? '' : 'bg-white/85 dark:bg-slate-950/50'
                }`}
              >
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${notification.read ? 'bg-slate-300 dark:bg-slate-700' : 'bg-emerald-400'}`} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-bold text-slate-800 dark:text-slate-100">{notification.body || getNotificationHeadline(notification)}</span>
                  <span className="mt-1 block text-[11px] font-semibold text-slate-400">{formatNotificationTime(notification.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </article>
    );
  });

  return (
    <div className="mobile-page notifications-page mx-auto max-w-6xl space-y-4 px-0 py-1 sm:px-6 sm:py-4 lg:px-8">
      <section className="rounded-[1.45rem] border border-slate-200 bg-white/92 p-5 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900/92 dark:shadow-black/25">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Notification center
            </div>
            <h1 className="mt-4 text-3xl font-black text-slate-950 dark:text-white">Notifications</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
              Reactions, comments, My Day replies, messages, and system updates in one clean inbox.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[18rem]">
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-slate-950/55 dark:ring-slate-800">
              <p className="text-xs font-black uppercase text-slate-400">Needs attention</p>
              <p className="mt-1 text-3xl font-black text-slate-950 dark:text-white">{unreadCount}</p>
            </div>
            <button
              type="button"
              onClick={markAllRead}
              disabled={!unreadCount}
              className="rounded-2xl bg-[#07036f] p-4 text-left text-white shadow-sm shadow-[#07036f]/20 transition hover:bg-[#05004f] disabled:cursor-default disabled:opacity-45"
            >
              <CheckCheck size={20} />
              <span className="mt-2 block text-sm font-black">Mark all read</span>
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[1.25rem] border border-slate-200 bg-white/92 p-3 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900/92 dark:shadow-black/25">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <label className="relative">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search notifications"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#0b57d0] focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950/50"
            />
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
            {filters.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`shrink-0 rounded-xl px-3 py-2 text-sm font-black transition ${
                  filter === item.id
                    ? 'bg-[#0b57d0] text-white shadow-sm shadow-blue-500/20'
                    : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-white dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        {loading ? (
          <ListSkeleton count={6} />
        ) : filteredNotifications.length ? groupedNotifications.map(group => {
          const GroupIcon = group.meta.icon;
          return (
            <div key={group.key} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#0b57d0] text-white">
                  <GroupIcon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-950 dark:text-white">{group.meta.label}</p>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{group.items.length} update{group.items.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              {group.key === 'message' ? renderMessageThreads(group.items) : group.items.map(notification => {
                const actor = notification.actorId || {};
                const actorAvatar = resolveMediaUrl(actor.avatar);
                const Icon = typeIcon[notification.type] || group.meta.icon || Bell;
                const action = getNotificationAction(notification);
                return (
                  <article
                    key={getEntityId(notification)}
                    className={`group flex items-start gap-1 rounded-[1.25rem] border p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                      notification.read
                        ? 'border-slate-200 bg-white/92 shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20'
                        : 'border-blue-200 bg-blue-50/85 shadow-blue-200/45 dark:border-blue-900/50 dark:bg-blue-950/25 dark:shadow-black/20'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openNotification(notification)}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded-2xl p-1 text-left transition hover:bg-white/55 dark:hover:bg-white/[0.03]"
                    >
                      <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#0b57d0] to-[#2387a8] text-sm font-black text-white">
                        {actorAvatar ? <img src={actorAvatar} alt={actor.name || 'User'} className="h-full w-full object-cover" /> : <Icon size={21} />}
                        {!notification.read && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="line-clamp-2 text-base font-black leading-5 text-slate-950 dark:text-white">{getNotificationHeadline(notification)}</span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black uppercase text-[#0b57d0] ring-1 ring-blue-100 dark:bg-slate-900 dark:text-sky-200 dark:ring-blue-900/50">{group.meta.label}</span>
                        </span>
                        {notification.body && <span className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-slate-600 dark:text-slate-300">{notification.body}</span>}
                        <span className="mt-2 block text-xs font-bold text-slate-400">{formatNotificationTime(notification.createdAt)}</span>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openNotification({ ...notification, href: action.href })}
                        className="rounded-xl bg-[#0b57d0] px-3 py-2 text-[11px] font-black text-white shadow-sm shadow-blue-500/20 transition hover:bg-blue-700"
                      >
                        {action.label}
                      </button>
                      <button
                        type="button"
                        onClick={event => deleteNotification(event, notification)}
                        className="grid h-9 w-9 place-items-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 dark:hover:bg-rose-950/35 dark:hover:text-rose-300"
                        title="Delete notification"
                        aria-label="Delete notification"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          );
        }) : (
          <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-white/92 p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <Filter className="mx-auto text-[#0b57d0]" size={32} />
            <p className="mt-3 text-lg font-black text-slate-950 dark:text-white">No notifications found</p>
            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Try another filter or come back after new activity.</p>
            <Link to="/dashboard" className="mt-4 inline-flex rounded-xl bg-[#07036f] px-4 py-2.5 text-sm font-black text-white">
              Back to home
            </Link>
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link to="/messages" className="rounded-2xl border border-slate-200 bg-white/92 p-4 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
          <MessageCircle size={20} className="text-[#0b57d0] dark:text-sky-300" />
          <p className="mt-2 text-sm font-black text-slate-950 dark:text-white">Messages</p>
          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Open chats and replies</p>
        </Link>
        <Link to="/friends" className="rounded-2xl border border-slate-200 bg-white/92 p-4 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
          <UserPlus size={20} className="text-[#0b57d0] dark:text-sky-300" />
          <p className="mt-2 text-sm font-black text-slate-950 dark:text-white">Friends</p>
          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Review requests</p>
        </Link>
        <Link to="/settings" className="rounded-2xl border border-slate-200 bg-white/92 p-4 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
          <ShieldCheck size={20} className="text-[#0b57d0] dark:text-sky-300" />
          <p className="mt-2 text-sm font-black text-slate-950 dark:text-white">Settings</p>
          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Manage alerts</p>
        </Link>
      </section>
    </div>
  );
}
