import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  Globe2,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Send,
  Share2,
  SmilePlus,
  Users
} from 'lucide-react';
import api from '../services/api';
import { resolveMediaUrl } from '../utils/media';
import VideoThumbnail from './VideoThumbnail';
import { DeveloperAvatarFrame, DeveloperBadge } from './DeveloperIdentity';
import AnimatedEmojiText from './AnimatedEmojiText';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '👏'];
const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');

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

const getPostTitle = (text, fallback = 'Update') => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
};

function Avatar({ user, size = 'h-11 w-11' }) {
  const avatar = resolveMediaUrl(user?.avatar);
  return (
    <DeveloperAvatarFrame user={user}>
      <span className={`${size} grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#1877f2] to-[#00b2ff] text-sm font-black text-white`}>
        {avatar ? <img src={avatar} alt={user?.name || 'User'} className="h-full w-full object-cover" /> : (user?.name || 'U').charAt(0).toUpperCase()}
      </span>
    </DeveloperAvatarFrame>
  );
}

export default function SocialFeed({ groups = [], currentUser }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [composerText, setComposerText] = useState('');
  const [commentDrafts, setCommentDrafts] = useState({});
  const [visibleCount, setVisibleCount] = useState(8);

  const currentUserId = getEntityId(currentUser);
  const activeGroups = useMemo(() => groups.filter(group => getEntityId(group)), [groups]);

  useEffect(() => {
    if (!selectedGroupId && activeGroups.length) {
      setSelectedGroupId(getEntityId(activeGroups[0]));
    }
  }, [activeGroups, selectedGroupId]);

  const loadFeed = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/posts/feed');
      setPosts(res.data || []);
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to load feed');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadFeed();
  }, []);

  const updatePost = (nextPost) => {
    setPosts(prev => prev.map(post => getEntityId(post) === getEntityId(nextPost) ? nextPost : post));
  };

  const createPost = async (event) => {
    event.preventDefault();
    const text = composerText.trim();
    if (!text || !selectedGroupId || posting) return;

    setPosting(true);
    try {
      const res = await api.post('/posts', {
        groupId: selectedGroupId,
        title: getPostTitle(text, 'Timeline update'),
        content: text
      });
      setPosts(prev => [res.data, ...prev]);
      setComposerText('');
      toast.success('Posted to feed');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Post failed');
    } finally {
      setPosting(false);
    }
  };

  const reactToPost = async (post, emoji) => {
    try {
      const res = await api.post(`/posts/${getEntityId(post)}/react`, { emoji });
      updatePost(res.data);
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Reaction failed');
    }
  };

  const savePost = async (post) => {
    try {
      const res = await api.put(`/posts/${getEntityId(post)}/save`);
      updatePost(res.data);
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Save failed');
    }
  };

  const addComment = async (event, post) => {
    event.preventDefault();
    const postId = getEntityId(post);
    const text = String(commentDrafts[postId] || '').trim();
    if (!text) return;

    try {
      const res = await api.post(`/posts/${postId}/comment`, { text });
      updatePost(res.data);
      setCommentDrafts(prev => ({ ...prev, [postId]: '' }));
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Comment failed');
    }
  };

  const sharePost = async (post) => {
    const groupName = post.groupId?.name || 'Syncrova';
    const text = `${post.title || 'Post'} - ${groupName}`;
    const url = `${window.location.origin}/group/${getEntityId(post.groupId)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: post.title || 'Syncrova post', text, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('Post link copied');
      }
    } catch {
      // User cancelled native share sheet.
    }
  };

  const visiblePosts = posts.slice(0, visibleCount);

  return (
    <section className="social-feed space-y-4">
      <form onSubmit={createPost} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start gap-3">
          <Avatar user={currentUser} />
          <div className="min-w-0 flex-1">
            <textarea
              value={composerText}
              onChange={event => setComposerText(event.target.value)}
              rows={3}
              placeholder={`What's on your mind, ${currentUser?.name?.split(' ')[0] || 'there'}?`}
              className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-900 outline-none transition focus:border-[#1877f2] focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-black text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200">
                  <Users size={15} />
                  <select
                    value={selectedGroupId}
                    onChange={event => setSelectedGroupId(event.target.value)}
                    className="max-w-[13rem] bg-transparent outline-none"
                  >
                    {activeGroups.map(group => (
                      <option key={getEntityId(group)} value={getEntityId(group)}>{group.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </label>
                <span className="inline-flex items-center gap-1 rounded-xl bg-blue-50 px-3 py-2 text-xs font-black text-[#1877f2] dark:bg-blue-950/30 dark:text-sky-200">
                  <Globe2 size={14} />
                  Workspace feed
                </span>
              </div>
              <button
                type="submit"
                disabled={!composerText.trim() || !selectedGroupId || posting}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1877f2] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#0f63d5] disabled:opacity-50"
              >
                {posting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Post
              </button>
            </div>
          </div>
        </div>
      </form>

      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm font-semibold text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          Loading feed...
        </div>
      ) : visiblePosts.length ? (
        <>
          {visiblePosts.map(post => {
            const postId = getEntityId(post);
            const author = post.userId || {};
            const group = post.groupId || {};
            const myReaction = post.reactions?.find(reaction => getEntityId(reaction.userId) === currentUserId);
            const saved = post.savedBy?.some(userId => getEntityId(userId) === currentUserId);
            const mediaUrl = resolveMediaUrl(post.fileUrl);

            return (
              <article key={postId} className="feed-card rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <header className="flex items-start gap-3">
                  <Avatar user={author} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 truncate font-black text-gray-950 dark:text-white">{author.name || 'Member'}</span>
                      <DeveloperBadge user={author} compact />
                      <span className="text-xs font-bold text-gray-400">posted in</span>
                      <span className="truncate text-xs font-black text-[#1877f2] dark:text-sky-300">{group.name || 'Workspace'}</span>
                    </div>
                    <p className="mt-0.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {formatFeedTime(post.createdAt)} · Workspace members
                    </p>
                  </div>
                </header>

                <div className="mt-3 space-y-3">
                  {post.title && <h3 className="text-base font-black text-gray-950 dark:text-white"><AnimatedEmojiText text={post.title} /></h3>}
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-700 dark:text-gray-200"><AnimatedEmojiText text={post.content} /></p>
                  {post.fileUrl && (
                    post.fileUrl.match(/\.(mp4|webm|mov)$/i) ? (
                      <VideoThumbnail src={mediaUrl} className="max-h-[28rem] w-full rounded-2xl" />
                    ) : (
                      <img src={mediaUrl} alt={post.title || 'Post media'} loading="lazy" decoding="async" className="max-h-[32rem] w-full rounded-2xl object-cover" />
                    )
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-y border-gray-100 py-2 text-xs font-bold text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <span>{post.reactions?.length || 0} reactions</span>
                  <span>{post.comments?.length || 0} comments</span>
                </div>

                <div className="grid grid-cols-3 gap-1 py-2">
                  <div className="relative group/reactions">
                    <button
                      type="button"
                      onClick={() => reactToPost(post, myReaction?.emoji || '👍')}
                      className={`flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black transition ${myReaction ? 'bg-blue-50 text-[#1877f2] dark:bg-blue-950/30 dark:text-sky-200' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'}`}
                    >
                      <SmilePlus size={17} />
                      {myReaction?.emoji ? <AnimatedEmojiText text={myReaction.emoji} /> : 'React'}
                    </button>
                    <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 flex translate-y-1 gap-1 rounded-2xl border border-gray-200 bg-white p-1 opacity-0 shadow-xl transition group-hover/reactions:pointer-events-auto group-hover/reactions:translate-y-0 group-hover/reactions:opacity-100 dark:border-gray-700 dark:bg-gray-900">
                      {QUICK_REACTIONS.map(emoji => (
                        <button key={emoji} type="button" onClick={() => reactToPost(post, emoji)} className="grid h-9 w-9 place-items-center rounded-xl text-xl hover:bg-gray-100 dark:hover:bg-gray-800">
                          <AnimatedEmojiText text={emoji} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <button type="button" onClick={() => savePost(post)} className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black text-gray-600 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800">
                    {saved ? <BookmarkCheck size={17} className="text-[#1877f2]" /> : <Bookmark size={17} />}
                    {saved ? 'Saved' : 'Save'}
                  </button>
                  <button type="button" onClick={() => sharePost(post)} className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-black text-gray-600 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800">
                    <Share2 size={17} />
                    Share
                  </button>
                </div>

                <div className="space-y-2">
                  {(post.comments || []).slice(-3).map((comment, index) => (
                    <div key={`${postId}-${index}-${comment.date}`} className="flex gap-2">
                      <Avatar user={comment.userId} size="h-8 w-8" />
                      <div className="min-w-0 rounded-2xl bg-gray-100 px-3 py-2 dark:bg-gray-950">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-xs font-black text-gray-950 dark:text-white">{comment.userId?.name || 'Member'}</span>
                          <DeveloperBadge user={comment.userId} compact />
                        </div>
                        <p className="break-words text-sm text-gray-700 dark:text-gray-200"><AnimatedEmojiText text={comment.text} /></p>
                      </div>
                    </div>
                  ))}
                  <form onSubmit={event => addComment(event, post)} className="flex items-center gap-2">
                    <Avatar user={currentUser} size="h-8 w-8" />
                    <input
                      value={commentDrafts[postId] || ''}
                      onChange={event => setCommentDrafts(prev => ({ ...prev, [postId]: event.target.value }))}
                      placeholder="Write a comment..."
                      className="min-w-0 flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold outline-none focus:border-[#1877f2] focus:bg-white dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                    />
                    <button type="submit" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1877f2] text-white disabled:opacity-50" disabled={!String(commentDrafts[postId] || '').trim()}>
                      <MessageCircle size={16} />
                    </button>
                  </form>
                </div>
              </article>
            );
          })}

          {visibleCount < posts.length && (
            <button type="button" onClick={() => setVisibleCount(count => count + 8)} className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-black text-[#1877f2] shadow-sm transition hover:bg-blue-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-blue-950/20">
              Load more posts
            </button>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
          <ImageIcon className="mx-auto text-[#1877f2]" size={32} />
          <p className="mt-3 font-black text-gray-950 dark:text-white">No posts yet</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Share the first workspace update from the composer above.</p>
        </div>
      )}
    </section>
  );
}
