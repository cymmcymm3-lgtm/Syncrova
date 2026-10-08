import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, FileText, Image as ImageIcon, MessageCircle, PlayCircle, Search } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { resolveMediaUrl } from '../utils/media';
import { CardGridSkeleton } from './SkeletonLoader';

const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');

const formatDate = (value) => {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const SavedCard = ({ icon: Icon, title, helper, meta, image, to }) => (
  <Link to={to} className="group overflow-hidden rounded-[1.2rem] border border-slate-200 bg-white/92 shadow-sm shadow-slate-200/45 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
    <div className="aspect-video bg-slate-100 dark:bg-slate-950">
      {image ? (
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-[#0b57d0] dark:text-sky-300">
          <Icon size={34} />
        </div>
      )}
    </div>
    <div className="p-4">
      <p className="line-clamp-1 font-black text-slate-950 dark:text-white">{title}</p>
      <p className="mt-1 line-clamp-2 text-sm font-semibold text-slate-500 dark:text-slate-400">{helper}</p>
      <p className="mt-3 text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">{meta}</p>
    </div>
  </Link>
);

export default function SavedItemsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState({ posts: [], reels: [], messages: [] });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.get('/saved');
        if (mounted) setItems(res.data || { posts: [], reels: [], messages: [] });
      } catch {
        if (mounted) setItems({ posts: [], reels: [], messages: [] });
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const normalizedItems = useMemo(() => {
    const posts = (items.posts || []).map(post => ({
      id: `post-${getEntityId(post)}`,
      type: 'posts',
      icon: FileText,
      title: post.title || 'Saved post',
      helper: post.content || post.fileName || 'Timeline post',
      meta: `${post.userId?.name || 'Member'} - ${formatDate(post.createdAt)}`,
      image: resolveMediaUrl(post.fileUrl || post.attachments?.[0]?.fileUrl),
      to: `/dashboard?post=${getEntityId(post)}`
    }));
    const reels = (items.reels || []).map(reel => ({
      id: `reel-${getEntityId(reel)}`,
      type: 'reels',
      icon: PlayCircle,
      title: reel.title || 'Saved reel',
      helper: reel.caption || reel.authorName || 'Gallery video',
      meta: `${reel.providerName || 'Reel'} - ${formatDate(reel.updatedAt || reel.createdAt)}`,
      image: resolveMediaUrl(reel.thumbnailUrl),
      to: '/reels'
    }));
    const messages = (items.messages || []).map(message => {
      const currentUserId = getEntityId(user);
      const other = getEntityId(message.from) === currentUserId ? message.to : message.from;
      return {
        id: `message-${getEntityId(message)}`,
        type: 'messages',
        icon: MessageCircle,
        title: message.text || message.fileName || 'Pinned message',
        helper: `${message.from?.name || 'Member'} to ${message.to?.name || 'Member'}`,
        meta: formatDate(message.createdAt),
        image: resolveMediaUrl(message.fileUrl || message.attachments?.[0]?.fileUrl),
        to: `/messages?user=${getEntityId(other)}`
      };
    });
    const all = [...posts, ...reels, ...messages];
    const needle = query.trim().toLowerCase();
    return all.filter(item => (
      (filter === 'all' || item.type === filter)
      && (!needle || item.title.toLowerCase().includes(needle) || item.helper.toLowerCase().includes(needle))
    ));
  }, [filter, items, query, user]);

  const counts = {
    all: (items.posts?.length || 0) + (items.reels?.length || 0) + (items.messages?.length || 0),
    posts: items.posts?.length || 0,
    reels: items.reels?.length || 0,
    messages: items.messages?.length || 0
  };

  return (
    <div className="mobile-page saved-items-page mx-auto max-w-6xl space-y-4 px-0 py-1 sm:px-6 sm:py-4 lg:px-8">
      <section className="rounded-[1.45rem] border border-slate-200 bg-white/92 p-5 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900/92 dark:shadow-black/25">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">Saved</p>
            <h1 className="mt-1 text-3xl font-black text-slate-950 dark:text-white">Saved items</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
              Posts, reels, and pinned messages you want to return to later.
            </p>
          </div>
          <div className="rounded-2xl bg-blue-50 p-4 text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50">
            <Bookmark size={22} />
            <p className="mt-2 text-2xl font-black">{counts.all}</p>
            <p className="text-xs font-black uppercase">total saved</p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-[1.2rem] border border-slate-200 bg-white/92 p-3 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20 lg:grid-cols-[minmax(0,1fr)_auto]">
        <label className="relative">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search saved items" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#0b57d0] focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950/50" />
        </label>
        <div className="flex gap-2 overflow-x-auto">
          {[
            { id: 'all', label: 'All' },
            { id: 'posts', label: 'Posts' },
            { id: 'reels', label: 'Reels' },
            { id: 'messages', label: 'Pinned' }
          ].map(item => (
            <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-black ${filter === item.id ? 'bg-[#0b57d0] text-white' : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800'}`}>
              {item.label} {counts[item.id] ? `(${counts[item.id]})` : ''}
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <CardGridSkeleton count={6} media />
      ) : normalizedItems.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {normalizedItems.map(item => <SavedCard key={item.id} {...item} />)}
        </section>
      ) : (
        <section className="rounded-[1.25rem] border border-dashed border-slate-300 bg-white/92 p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <ImageIcon className="mx-auto text-[#0b57d0]" size={34} />
          <h2 className="mt-3 text-xl font-black text-slate-950 dark:text-white">Nothing saved yet</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Save posts or reels and they will show up here.</p>
          <Link to="/dashboard" className="mt-4 inline-flex rounded-xl bg-[#07036f] px-4 py-2.5 text-sm font-black text-white">Browse feed</Link>
        </section>
      )}
    </div>
  );
}
