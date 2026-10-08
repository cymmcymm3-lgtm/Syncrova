import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bookmark,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Search,
  User,
  Users
} from 'lucide-react';
import api from '../services/api';
import { resolveMediaUrl } from '../utils/media';
import { ListSkeleton } from './SkeletonLoader';

const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');

const resultTypes = [
  { key: 'all', label: 'All', icon: Search },
  { key: 'users', label: 'People', icon: User },
  { key: 'posts', label: 'Posts', icon: FileText },
  { key: 'messages', label: 'Messages', icon: MessageCircle },
  { key: 'files', label: 'Files', icon: ImageIcon }
];

const resultTypeKeys = new Set(resultTypes.map(type => type.key));
const normalizeResultType = (type) => resultTypeKeys.has(type) ? type : 'all';

const formatDate = (value) => {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const ResultCard = ({ icon: Icon, title, helper, meta, image, to, actionLabel = 'Open' }) => (
  <Link
    to={to}
    className="group flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white/92 p-3 shadow-sm shadow-slate-200/45 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20"
  >
    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-blue-50 text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50">
      {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <Icon size={21} />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="line-clamp-1 text-sm font-black text-slate-950 dark:text-white">{title}</span>
      {helper && <span className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{helper}</span>}
      {meta && <span className="mt-1 block text-[11px] font-black uppercase text-[#0b57d0] dark:text-sky-300">{meta}</span>}
    </span>
    <span className="hidden rounded-xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-600 ring-1 ring-slate-200 group-hover:bg-blue-50 group-hover:text-[#0b57d0] dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800 sm:inline-flex">
      {actionLabel}
    </span>
  </Link>
);

export default function GlobalSearchPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const [activeType, setActiveType] = useState(normalizeResultType(params.get('type') || 'all'));
  const [results, setResults] = useState({ users: [], posts: [], messages: [], files: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setQuery(params.get('q') || '');
    setActiveType(normalizeResultType(params.get('type') || 'all'));
  }, [params]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults({ users: [], posts: [], messages: [], files: [] });
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get('/search', { params: { q: trimmed } });
        setResults(res.data || {});
      } catch {
        setResults({ users: [], posts: [], messages: [], files: [] });
      } finally {
        setLoading(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query]);

  const counts = useMemo(() => ({
    users: results.users?.length || 0,
    posts: results.posts?.length || 0,
    messages: results.messages?.length || 0,
    files: results.files?.length || 0
  }), [results]);
  const totalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);

  const submitSearch = (event) => {
    event.preventDefault();
    const trimmed = query.trim();
    setParams(trimmed ? { q: trimmed, type: activeType } : {});
  };

  const setFilter = (type) => {
    setActiveType(type);
    const trimmed = query.trim();
    setParams(trimmed ? { q: trimmed, type } : { type });
  };

  const show = (type) => activeType === 'all' || activeType === type;

  return (
    <div className="mobile-page global-search-page mx-auto max-w-6xl space-y-4 px-0 py-1 sm:px-6 sm:py-4 lg:px-8">
      <section className="rounded-[1.45rem] border border-slate-200 bg-white/92 p-5 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900/92 dark:shadow-black/25">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">Global Search</p>
            <h1 className="mt-1 text-3xl font-black text-slate-950 dark:text-white">Find anything in Syncrova</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
              Search people, posts, messages, and files from one professional command center.
            </p>
          </div>
          <Link to="/saved" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm font-black text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50">
            <Bookmark size={17} />
            Saved items
          </Link>
        </div>
        <form onSubmit={submitSearch} className="mt-5 flex gap-2">
          <label className="relative min-w-0 flex-1">
            <Search size={19} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search Syncrova"
              className="h-13 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-base font-semibold text-slate-950 outline-none focus:border-[#0b57d0] focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950/50"
              autoFocus
            />
          </label>
          <button type="submit" className="rounded-2xl bg-[#07036f] px-5 text-sm font-black text-white">
            {loading ? <Loader2 size={18} className="animate-spin" /> : 'Search'}
          </button>
        </form>
      </section>

      <section className="flex gap-2 overflow-x-auto rounded-[1.2rem] border border-slate-200 bg-white/92 p-2 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
        {resultTypes.map(type => {
          const Icon = type.icon;
          const active = activeType === type.key;
          const count = type.key === 'all' ? totalCount : counts[type.key] || 0;
          return (
            <button
              key={type.key}
              type="button"
              onClick={() => setFilter(type.key)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-black transition ${
                active ? 'bg-[#0b57d0] text-white' : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-white dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800'
              }`}
            >
              <Icon size={16} />
              {type.label}
              <span className="rounded-full bg-white/20 px-1.5">{count}</span>
            </button>
          );
        })}
      </section>

      {query.trim().length < 2 ? (
        <section className="rounded-[1.25rem] border border-dashed border-slate-300 bg-white/92 p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <Search className="mx-auto text-[#0b57d0]" size={34} />
          <h2 className="mt-3 text-xl font-black text-slate-950 dark:text-white">Start with at least 2 letters</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Try a name, post caption, message, or file name.</p>
        </section>
      ) : (
        <div className="space-y-5">
          {loading && <ListSkeleton count={4} />}

          {show('users') && counts.users > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-black text-slate-950 dark:text-white">People</h2>
              {results.users.map(person => (
                <ResultCard key={getEntityId(person)} icon={User} title={person.name} helper={`${person.email || ''} ${person.course ? `- ${person.course}` : ''}`} meta={person.campus} image={resolveMediaUrl(person.avatar)} to={`/messages?user=${getEntityId(person)}`} actionLabel="Message" />
              ))}
            </section>
          )}

          {show('posts') && counts.posts > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Posts</h2>
              {results.posts.map(post => (
                <ResultCard key={getEntityId(post)} icon={FileText} title={post.title || 'Post'} helper={post.content} meta={`${post.userId?.name || 'Member'} - ${formatDate(post.createdAt)}`} image={resolveMediaUrl(post.fileUrl)} to={`/dashboard?post=${getEntityId(post)}`} />
              ))}
            </section>
          )}

          {show('messages') && counts.messages > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Messages</h2>
              {results.messages.map(message => (
                <ResultCard key={getEntityId(message)} icon={MessageCircle} title={message.otherUser?.name || 'Conversation'} helper={message.text || message.fileName || 'Message attachment'} meta={formatDate(message.createdAt)} image={resolveMediaUrl(message.otherUser?.avatar)} to={`/messages?user=${getEntityId(message.otherUser)}`} />
              ))}
            </section>
          )}

          {show('files') && counts.files > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Files</h2>
              {results.files.map(file => (
                <ResultCard key={getEntityId(file)} icon={ImageIcon} title={file.originalName || file.filename} helper={file.mimeType || 'Shared file'} meta={`${file.groupId?.name || 'Campus'} - ${formatDate(file.uploadDate)}`} image={resolveMediaUrl(file.url)} to="/saved" />
              ))}
            </section>
          )}

          {!loading && totalCount === 0 && (
            <section className="rounded-[1.25rem] border border-dashed border-slate-300 bg-white/92 p-8 text-center dark:border-slate-800 dark:bg-slate-900">
              <Users className="mx-auto text-[#0b57d0]" size={34} />
              <h2 className="mt-3 text-xl font-black text-slate-950 dark:text-white">No results found</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Try a different spelling or open a related tab.</p>
              <button type="button" onClick={() => navigate('/dashboard')} className="mt-4 rounded-xl bg-[#07036f] px-4 py-2.5 text-sm font-black text-white">Back home</button>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
