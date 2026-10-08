import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Eye, Heart, Loader2, MessageCircle, Send, Trash2, X } from 'lucide-react';
import { resolveMediaUrl, resolveMediaVariantUrl } from '../utils/media';
import { formatStoryAge } from '../utils/stories';
import './story-viewer.css';

const STORY_REACTIONS = ['❤️', '😂', '🔥', '👏', '😮'];
const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');
const STORY_REACTIONS_CLEAN = STORY_REACTIONS
  .map((_, index) => ['\u2764\uFE0F', '\u{1F602}', '\u{1F525}', '\u{1F44F}', '\u{1F62E}'][index])
  .filter(Boolean);

const formatStoryTime = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
};

const getPerson = (entry) => entry?.userId || entry || {};

function PersonRow({ person, meta, detail, right }: { person: any; meta?: string; detail?: React.ReactNode; right?: React.ReactNode }) {
  const avatar = resolveMediaUrl(person?.avatar);
  const name = person?.name || 'Member';

  return (
    <div className="story-activity-person flex items-center gap-3 rounded-xl px-2 py-2 transition">
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#1877f2] to-[#00b2ff] text-sm font-black text-white">
        {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="story-activity-person__name block truncate text-sm font-black">{name}</span>
        {meta && <span className="story-activity-person__meta block truncate text-xs font-semibold">{meta}</span>}
        {detail && <span className="story-activity-person__detail mt-1 block text-xs font-semibold leading-snug">{detail}</span>}
      </span>
      {right && <span className="shrink-0">{right}</span>}
    </div>
  );
}

type StoryViewerProps = {
  story: any;
  stories?: any[];
  currentUser: any;
  onClose: () => void;
  onNavigate: (story: any) => void | Promise<void>;
  onReact: (story: any, emoji: any) => void | Promise<void>;
  onComment: (story?: any, text?: string) => void | Promise<void>;
  onDelete?: (storyId: string) => void | Promise<void>;
  zIndexClass?: string;
};

export default function StoryViewer({
  story,
  stories = [],
  currentUser,
  onClose,
  onNavigate,
  onReact,
  onComment,
  onDelete,
  zIndexClass = 'z-[95]'
}: StoryViewerProps) {
  const [comment, setComment] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const [activePanel, setActivePanel] = useState('viewers');
  const [showOwnerActivity, setShowOwnerActivity] = useState(false);
  const [storyProgress, setStoryProgress] = useState(0);
  const [progressPaused, setProgressPaused] = useState(false);
  const [storyClock, setStoryClock] = useState(Date.now());

  const storyList = useMemo(() => {
    const source = Array.isArray(stories) && stories.length ? stories : story ? [story] : [];
    const seen = new Set();
    return source.filter(item => {
      const id = getEntityId(item);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [stories, story]);

  const activeIndex = Math.max(0, storyList.findIndex(item => getEntityId(item) === getEntityId(story)));
  const currentStory = storyList[activeIndex] || story;
  const hasMultipleStories = storyList.length > 1;
  const owner = currentStory?.userId || {};
  const isOwner = getEntityId(owner) === getEntityId(currentUser);
  const viewers = currentStory?.viewers || [];
  const reactions = currentStory?.reactions || [];
  const comments = currentStory?.comments || [];

  const reactionSummary = useMemo(() => (
    Object.entries(reactions.reduce((summary, reaction) => {
      if (!reaction?.emoji) return summary;
      summary[reaction.emoji] = (summary[reaction.emoji] || 0) + 1;
      return summary;
    }, {}))
  ), [reactions]);

  const reactionByUser = useMemo(() => {
    const map = new Map();
    reactions.forEach(reaction => {
      const id = getEntityId(reaction.userId);
      if (id) map.set(id, reaction);
    });
    return map;
  }, [reactions]);
  const currentUserReaction = reactionByUser.get(getEntityId(currentUser));
  const activeStoryId = getEntityId(currentStory);
  const storyAge = formatStoryAge(currentStory, storyClock);

  useEffect(() => {
    if (!currentStory) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [currentStory]);

  useEffect(() => {
    if (!currentStory) return undefined;
    const interval = window.setInterval(() => setStoryClock(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, [currentStory]);

  useEffect(() => {
    setComment('');
    setPendingAction('');
    setActivePanel('viewers');
    setShowOwnerActivity(false);
    setStoryProgress(0);
    setProgressPaused(false);
  }, [activeStoryId]);

  useEffect(() => {
    if (!currentStory || progressPaused) return undefined;
    const duration = currentStory.fileType === 'video' ? 12000 : 7000;
    const intervalMs = 120;
    const step = (intervalMs / duration) * 100;
    const interval = window.setInterval(() => {
      setStoryProgress(prev => {
        if (prev >= 100) return prev;
        const next = Math.min(100, prev + step);
        if (next >= 100 && hasMultipleStories && activeIndex < storyList.length - 1 && onNavigate) {
          const nextStory = storyList[activeIndex + 1];
          window.setTimeout(() => onNavigate(nextStory), 0);
        }
        return next;
      });
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [activeIndex, activeStoryId, currentStory, hasMultipleStories, onNavigate, progressPaused, storyList]);

  useEffect(() => {
    if (!currentStory) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
      if (event.key === 'ArrowRight' && hasMultipleStories && onNavigate) {
        const nextStory = storyList[(activeIndex + 1) % storyList.length];
        onNavigate(nextStory);
      }
      if (event.key === 'ArrowLeft' && hasMultipleStories && onNavigate) {
        const previousStory = storyList[(activeIndex - 1 + storyList.length) % storyList.length];
        onNavigate(previousStory);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, currentStory, hasMultipleStories, onClose, onNavigate, storyList]);

  if (!currentStory) return null;

  const ownerAvatar = resolveMediaUrl(owner?.avatar);

  const goToStory = async (direction) => {
    if (!hasMultipleStories || !onNavigate) return;
    const nextIndex = direction === 'next'
      ? (activeIndex + 1) % storyList.length
      : (activeIndex - 1 + storyList.length) % storyList.length;
    setComment('');
    setPendingAction('');
    setActivePanel('viewers');
    setShowOwnerActivity(false);
    await onNavigate(storyList[nextIndex]);
  };

  const openOwnerActivity = (panel) => {
    setActivePanel(panel);
    setShowOwnerActivity(true);
  };

  const submitComment = async (event) => {
    event.preventDefault();
    const text = comment.trim();
    if (!text || !onComment || pendingAction) return;

    setPendingAction('comment');
    try {
      await onComment(currentStory, text);
      setComment('');
    } finally {
      setPendingAction('');
    }
  };

  const reactToStory = async (emoji) => {
    if (!onReact || pendingAction) return;
    setPendingAction(`react-${emoji}`);
    try {
      await onReact(currentStory, emoji);
    } finally {
      setPendingAction('');
    }
  };

  const deleteStory = async () => {
    if (!onDelete || pendingAction) return;
    setPendingAction('delete');
    try {
      await onDelete(getEntityId(currentStory));
    } finally {
      setPendingAction('');
    }
  };

  if (typeof document === 'undefined') return null;

  const viewer = (
    <div
      className={`story-viewer-overlay fixed inset-0 ${zIndexClass} flex items-center justify-center p-0 sm:p-4`}
      onMouseDown={event => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className={`story-viewer-shell ${isOwner ? 'story-viewer-shell--owner' : ''} relative grid h-[100dvh] w-full overflow-hidden rounded-none shadow-2xl sm:h-[min(94dvh,840px)] sm:rounded-3xl ${
          isOwner
            ? 'max-w-[1180px] md:grid-cols-[15rem_minmax(0,1fr)_22rem] md:grid-rows-1'
            : 'max-w-none sm:max-w-[430px]'
        }`}
        onMouseDown={event => event.stopPropagation()}
        onFocusCapture={() => setProgressPaused(true)}
        onBlurCapture={() => setProgressPaused(false)}
      >
        {isOwner && (
          <aside className="story-owner-rail hidden min-w-0 flex-col justify-between p-5 md:flex">
            <div className="min-w-0">
              <button
                type="button"
                onClick={onClose}
                className="story-control-button mb-6 grid h-10 w-10 place-items-center rounded-full transition"
                aria-label="Close My Day"
              >
                <X size={18} />
              </button>
              <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#1877f2] to-[#00b2ff] text-lg font-black text-white ring-2 ring-[#1877f2]">
                {ownerAvatar ? <img src={ownerAvatar} alt={owner?.name || 'Member'} className="h-full w-full object-cover" /> : (owner?.name || 'M').charAt(0).toUpperCase()}
              </span>
              <h2 className="story-owner-name mt-3 truncate text-base font-black">{owner?.name || 'Member'}</h2>
              <p className="story-owner-subtitle text-sm font-semibold">My Day{storyAge ? ` - ${storyAge}` : ''}</p>
              {formatStoryTime(currentStory.createdAt) && (
                <p className="story-owner-time mt-2 text-xs font-bold">Posted {formatStoryTime(currentStory.createdAt)}</p>
              )}
              {currentStory.caption && (
                <p className="story-owner-caption mt-4 line-clamp-5 text-sm font-semibold leading-6">{currentStory.caption}</p>
              )}
            </div>
            <div className="story-owner-totals grid grid-cols-3 gap-2 rounded-2xl p-2">
              <div className="text-center">
                <p className="story-owner-totals__value text-sm font-black">{viewers.length}</p>
                <p className="story-owner-totals__label text-[10px] font-bold uppercase">Views</p>
              </div>
              <div className="text-center">
                <p className="story-owner-totals__value text-sm font-black">{reactions.length}</p>
                <p className="story-owner-totals__label text-[10px] font-bold uppercase">Reacts</p>
              </div>
              <div className="text-center">
                <p className="story-owner-totals__value text-sm font-black">{comments.length}</p>
                <p className="story-owner-totals__label text-[10px] font-bold uppercase">Replies</p>
              </div>
            </div>
          </aside>
        )}

        <div className="story-viewer-stage relative min-h-0 overflow-hidden">
          {currentStory.fileType === 'image' ? (
            <img src={resolveMediaVariantUrl(currentStory, ['large', 'feed', 'thumb'])} alt={currentStory.caption || 'My Day'} decoding="async" className="story-viewer-media h-full w-full object-contain" />
          ) : (
            <video key={getEntityId(currentStory)} src={resolveMediaUrl(currentStory.fileUrl)} controls autoPlay playsInline preload="metadata" className="story-viewer-media h-full w-full object-contain" />
          )}

          <div className="story-viewer-topbar absolute inset-x-0 top-0 z-20 p-3 pt-[calc(env(safe-area-inset-top)+0.9rem)] sm:p-4 sm:pt-[calc(env(safe-area-inset-top)+1rem)]">
            <div className="mb-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${storyList.length || 1}, minmax(0, 1fr))` }}>
              {storyList.map((item, index) => {
                const width = index < activeIndex ? '100%' : index === activeIndex ? `${storyProgress}%` : '0%';
                return (
                  <span key={getEntityId(item)} className="story-progress-track h-1 overflow-hidden rounded-full">
                    <span className="story-progress-value block h-full rounded-full transition-[width]" style={{ width }} />
                  </span>
                );
              })}
            </div>
            <div className="story-viewer-heading flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#1877f2] to-[#00b2ff] text-sm font-black text-white ring-2 ring-[#1877f2]">
                  {ownerAvatar ? <img src={ownerAvatar} alt={owner?.name || 'Member'} className="h-full w-full object-cover" /> : (owner?.name || 'M').charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="story-viewer-heading__name block truncate text-sm font-black">{owner?.name || 'Member'}</span>
                  <span className="story-viewer-heading__meta block truncate text-xs font-semibold">
                    My Day{storyAge ? ` - ${storyAge}` : ''}{hasMultipleStories ? ` - ${activeIndex + 1} of ${storyList.length}` : ''}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isOwner && onDelete && (
                  <button
                    type="button"
                    onClick={deleteStory}
                    disabled={pendingAction === 'delete'}
                    className="story-control-button story-control-button--delete grid h-10 w-10 place-items-center rounded-full transition disabled:opacity-50"
                    aria-label="Delete My Day"
                  >
                    {pendingAction === 'delete' ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="story-control-button grid h-10 w-10 place-items-center rounded-full transition"
                  aria-label="Close My Day"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>

          {hasMultipleStories && (
            <>
              <button
                type="button"
                onClick={() => goToStory('previous')}
                className="story-nav-button absolute left-2 top-1/2 z-30 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full transition sm:left-3 sm:h-11 sm:w-11"
                aria-label="Previous My Day"
              >
                <ChevronLeft size={24} />
              </button>
              <button
                type="button"
                onClick={() => goToStory('next')}
                className="story-nav-button absolute right-2 top-1/2 z-30 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full transition sm:right-3 sm:h-11 sm:w-11"
                aria-label="Next My Day"
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}

          {isOwner && (
            <div className="story-owner-actions absolute inset-x-0 bottom-0 z-20 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-16">
              {currentStory.caption && <p className="story-owner-actions__caption mb-3 line-clamp-2 text-sm font-bold leading-snug">{currentStory.caption}</p>}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => openOwnerActivity('viewers')}
                  className="story-owner-action flex items-center justify-center gap-1.5 rounded-2xl px-2 py-2 text-xs font-black transition"
                >
                  <Eye size={15} />
                  {viewers.length}
                </button>
                <button
                  type="button"
                  onClick={() => openOwnerActivity('reactions')}
                  className="story-owner-action flex items-center justify-center gap-1.5 rounded-2xl px-2 py-2 text-xs font-black transition"
                >
                  <Heart size={15} />
                  {reactions.length}
                </button>
                <button
                  type="button"
                  onClick={() => openOwnerActivity('replies')}
                  className="story-owner-action flex items-center justify-center gap-1.5 rounded-2xl px-2 py-2 text-xs font-black transition"
                >
                  <MessageCircle size={15} />
                  {comments.length}
                </button>
              </div>
            </div>
          )}

          {!isOwner && (
            <div className="story-viewer-replybar absolute inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-20">
              {currentStory.caption && <p className="story-viewer-replybar__caption mb-3 text-sm font-bold leading-snug">{currentStory.caption}</p>}
              <div className="mb-3 flex items-center justify-center gap-2">
                {STORY_REACTIONS_CLEAN.map(emoji => {
                  const isSelected = currentUserReaction?.emoji === emoji;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => reactToStory(emoji)}
                      disabled={Boolean(pendingAction)}
                      className={`grid h-11 w-11 place-items-center rounded-full text-xl shadow-lg transition hover:-translate-y-0.5 disabled:opacity-50 ${
                        isSelected ? 'story-reaction-button--selected' : 'story-reaction-button'
                      }`}
                      aria-label={`React ${emoji}`}
                    >
                      {pendingAction === `react-${emoji}` ? <Loader2 size={16} className="animate-spin" /> : emoji}
                    </button>
                  );
                })}
              </div>
              {reactionSummary.length > 0 && (
                <div className="mb-3 flex justify-center">
                  <div className="story-reaction-summary inline-flex max-w-full items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black">
                    {reactionSummary.slice(0, 3).map(([emoji]) => <span key={emoji}>{emoji}</span>)}
                    <span className="story-reaction-summary__count ml-1">{reactions.length}</span>
                  </div>
                </div>
              )}
              {onComment && (
                <form onSubmit={submitComment} className="story-reply-form flex items-center gap-2 rounded-full p-1.5">
                  <input
                    value={comment}
                    onChange={event => setComment(event.target.value)}
                    placeholder="Reply to story..."
                    className="story-reply-form__input min-w-0 flex-1 bg-transparent px-3 py-2 text-sm font-semibold outline-none"
                  />
                  <button
                    type="submit"
                    disabled={pendingAction === 'comment' || !comment.trim()}
                    className="story-reply-form__send grid h-10 w-10 shrink-0 place-items-center rounded-full text-white transition disabled:opacity-50"
                    aria-label="Send My Day reply"
                  >
                    {pendingAction === 'comment' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        {isOwner && (
          <aside className={`story-owner-activity story-owner-activity-sheet ${showOwnerActivity ? 'flex' : 'hidden'} absolute inset-x-2 bottom-2 z-40 max-h-[min(66svh,31rem)] min-h-0 flex-col overflow-hidden rounded-3xl shadow-2xl md:static md:flex md:max-h-none md:rounded-none md:shadow-none`}>
            <div className="story-owner-activity__header p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="story-owner-activity__eyebrow text-xs font-black uppercase tracking-wide">My Day activity</p>
                <button
                  type="button"
                  onClick={() => setShowOwnerActivity(false)}
                  className="story-control-button grid h-8 w-8 place-items-center rounded-full md:hidden"
                  aria-label="Close My Day activity"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="story-activity-stat rounded-2xl p-3 text-center">
                  <Eye className="mx-auto text-[#1877f2]" size={18} />
                  <p className="story-activity-stat__value mt-1 text-lg font-black">{viewers.length}</p>
                  <p className="story-activity-stat__label text-[11px] font-bold">Viewers</p>
                </div>
                <div className="story-activity-stat rounded-2xl p-3 text-center">
                  <Heart className="mx-auto text-pink-500" size={18} />
                  <p className="story-activity-stat__value mt-1 text-lg font-black">{reactions.length}</p>
                  <p className="story-activity-stat__label text-[11px] font-bold">Reacts</p>
                </div>
                <div className="story-activity-stat rounded-2xl p-3 text-center">
                  <MessageCircle className="mx-auto text-emerald-500" size={18} />
                  <p className="story-activity-stat__value mt-1 text-lg font-black">{comments.length}</p>
                  <p className="story-activity-stat__label text-[11px] font-bold">Replies</p>
                </div>
              </div>
              {reactionSummary.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {reactionSummary.map(([emoji, count]) => (
                    <span key={String(emoji)} className="story-owner-reaction-pill rounded-full px-3 py-1.5 text-xs font-black">
                      {emoji} {Number(count)}
                    </span>
                  ))}
                </div>
              )}
              <div className="story-activity-tabs mt-3 grid grid-cols-3 gap-1 rounded-2xl p-1">
                <button
                  type="button"
                  onClick={() => setActivePanel('viewers')}
                  className={`story-activity-tab rounded-xl px-2 py-2 text-xs font-black transition ${activePanel === 'viewers' ? 'story-activity-tab--active-viewers' : ''}`}
                >
                  Viewers
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel('reactions')}
                  className={`story-activity-tab rounded-xl px-2 py-2 text-xs font-black transition ${activePanel === 'reactions' ? 'story-activity-tab--active-reactions' : ''}`}
                >
                  Reactions
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel('replies')}
                  className={`story-activity-tab rounded-xl px-2 py-2 text-xs font-black transition ${activePanel === 'replies' ? 'story-activity-tab--active-replies' : ''}`}
                >
                  Replies
                </button>
              </div>
            </div>

            <div className="story-viewer-activity-list min-h-0 flex-1 overflow-y-auto p-3">
              {activePanel === 'viewers' ? (
                viewers.length ? viewers.map(viewer => {
                  const person = getPerson(viewer);
                  const reaction = reactionByUser.get(getEntityId(person));
                  return (
                    <PersonRow
                      key={`${getEntityId(person)}-${viewer.viewedAt || ''}`}
                      person={person}
                      meta={formatStoryTime(viewer.viewedAt) || 'Viewed'}
                      right={reaction?.emoji ? <span className="text-xl">{reaction.emoji}</span> : null}
                    />
                  );
                }) : (
                  <p className="story-activity-empty rounded-2xl border border-dashed p-4 text-center text-sm font-semibold">No viewers yet.</p>
                )
              ) : activePanel === 'reactions' ? reactions.length ? reactions.map((reaction, index) => {
                const person = getPerson(reaction);
                return (
                  <PersonRow
                    key={`${getEntityId(person)}-${reaction.emoji}-${index}`}
                    person={person}
                    meta={formatStoryTime(reaction.createdAt) || 'Reacted'}
                    right={<span className="text-xl">{reaction.emoji}</span>}
                  />
                );
              }) : (
                <p className="story-activity-empty rounded-2xl border border-dashed p-4 text-center text-sm font-semibold">No reactions yet.</p>
              ) : comments.length ? comments.map((reply, index) => {
                const person = getPerson(reply);
                return (
                  <PersonRow
                    key={`${getEntityId(person)}-${reply.createdAt || index}`}
                    person={person}
                    meta={formatStoryTime(reply.createdAt) || 'Replied'}
                    detail={reply.text}
                    right={<MessageCircle size={16} className="text-emerald-300" />}
                  />
                );
              }) : (
                <p className="story-activity-empty rounded-2xl border border-dashed p-4 text-center text-sm font-semibold">No replies yet.</p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );

  return createPortal(viewer, document.body);
}
