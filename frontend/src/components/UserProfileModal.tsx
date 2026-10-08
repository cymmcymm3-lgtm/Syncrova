import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, Briefcase, Building2, Calendar, Clock, Globe2, Image as ImageIcon, Loader2, Mail, MessageCircle, PlayCircle, User, UserCheck, UserPlus, Users, UserX, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { resolveMediaUrl } from '../utils/media';
import { formatStoryAge, getStoryListForActiveStory, groupActiveStoriesByOwner } from '../utils/stories';
import { useNavigate } from 'react-router-dom';
import GameRankBadge, { GameRankEmblem, resolveHighestGameRank } from './GameRankBadge';
import { useAuth } from '../context/AuthContext';
import VideoThumbnail from './VideoThumbnail';
import { DeveloperAvatarFrame, DeveloperBadge } from './DeveloperIdentity';
import AnimatedEmojiText from './AnimatedEmojiText';

const StoryViewer = lazy(() => import('./StoryViewer'));

const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');

const getPostAttachments = (post: Record<string, any> = {}) => {
  const attachments = Array.isArray(post.attachments)
    ? post.attachments.filter(item => item?.fileUrl)
    : [];
  if (attachments.length) return attachments;
  if (post.fileUrl) {
    return [{
      fileUrl: post.fileUrl,
      fileType: post.fileType || 'file',
      fileName: post.fileName || post.title || 'Post media'
    }];
  }
  return [];
};

const formatPostTime = (value) => {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return formatDistanceToNow(date, { addSuffix: true });
};

const getReactionCount = (post: Record<string, any> = {}) => (
  (post.reactions?.length || 0) + (post.likes?.length || 0)
);

const formatMemberSince = (value) => {
  if (!value) return 'Recently joined';
  return new Date(value).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

export default function UserProfileModal({ isOpen, user, userId, onClose }) {
  const [profile, setProfile] = useState(user || null);
  const [friendship, setFriendship] = useState(user?.friendship || { status: 'none' });
  const [loading, setLoading] = useState(false);
  const [friendAction, setFriendAction] = useState('');
  const [stories, setStories] = useState([]);
  const [activeStory, setActiveStory] = useState(null);
  const [storyCommenting, setStoryCommenting] = useState(false);
  const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false);
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const profileId = userId || getEntityId(user);
  const isSelf = profileId && getEntityId(currentUser) === String(profileId);

  useEffect(() => {
    if (!isOpen) {
      setActiveStory(null);
      setAvatarPreviewOpen(false);
      return;
    }
    setProfile(user || null);
    setFriendship(user?.friendship || { status: 'none' });

    if (!profileId) return;
    let cancelled = false;
    const loadProfile = async () => {
      setLoading(true);
      try {
        const [res, storiesRes] = await Promise.all([
          api.get(`/users/${profileId}/public`),
          api.get(`/stories/user/${profileId}/grouped`).catch(() => (
            api.get(`/stories/user/${profileId}`).catch(() => ({ data: [] }))
          ))
        ]);
        if (!cancelled) {
          setProfile(res.data);
          setFriendship(res.data?.friendship || { status: 'none' });
          setStories(Array.isArray(storiesRes.data) ? storiesRes.data : storiesRes.data?.stories || []);
        }
      } catch (err) {
        if (!cancelled && user) {
          setProfile(user);
          setFriendship(user?.friendship || { status: 'none' });
          setStories([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [isOpen, profileId, user]);

  const avatar = resolveMediaUrl(profile?.avatar);
  const coverPhoto = resolveMediaUrl(profile?.coverPhoto);
  const storyGroups = groupActiveStoriesByOwner(stories);
  const profilePosts = useMemo(() => {
    const ownerId = getEntityId(profile) || String(profileId || '');
    if (!ownerId || !Array.isArray(profile?.posts)) return [];

    // The public profile endpoint already filters this server-side. Keep the
    // same rule on the client so an optimistic/fallback user object can never
    // accidentally render posts authored by someone else.
    return profile.posts.filter(post => getEntityId(post?.userId) === ownerId);
  }, [profile, profileId]);
  const mutualFriends = Array.isArray(profile?.mutualFriends) ? profile.mutualFriends : [];
  const highlightItems = useMemo(() => {
    const storyHighlights = storyGroups.map(group => ({
      id: `story-${group.ownerId}`,
      type: 'story',
      title: group.count > 1 ? 'Collection' : group.preview?.caption || 'Story',
      count: group.count,
      story: group.preview,
      fileType: group.preview?.fileType,
      fileUrl: group.preview?.fileUrl,
      age: formatStoryAge(group.preview)
    }));

    const postHighlights = profilePosts.flatMap(post => (
      getPostAttachments(post)
        .filter(attachment => ['image', 'video'].includes(attachment.fileType))
        .slice(0, 1)
        .map(attachment => ({
          id: `post-${getEntityId(post)}-${attachment.fileUrl}`,
          type: 'post',
          title: post.title || 'Post',
          count: getPostAttachments(post).length,
          post,
          fileType: attachment.fileType,
          fileUrl: attachment.fileUrl,
          age: formatPostTime(post.createdAt)
        }))
    ));

    return [...storyHighlights, ...postHighlights].slice(0, 8);
  }, [profilePosts, storyGroups]);
  const activeStoryList = getStoryListForActiveStory(storyGroups, activeStory);
  const initials = useMemo(() => {
    const name = profile?.name || 'User';
    return name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
  }, [profile]);

  const lastSeen = profile?.lastSeen
    ? `Last active ${formatDistanceToNow(new Date(profile.lastSeen), { addSuffix: true })}`
    : 'Activity not available';
  const currentGameRank = profile?.gameStats?.rank;
  const highestGameRank = resolveHighestGameRank(currentGameRank, profile?.gameStats?.highestRank || currentGameRank);

  const openMessages = () => {
    onClose?.();
    navigate(profileId ? `/messages?user=${profileId}` : '/messages');
  };

  const closeModal = (event) => {
    event?.stopPropagation?.();
    onClose?.();
  };

  const syncStory = (updatedStory) => {
    setStories(prev => prev.map(story => getEntityId(story) === getEntityId(updatedStory) ? updatedStory : story));
    setActiveStory(prev => getEntityId(prev) === getEntityId(updatedStory) ? updatedStory : prev);
    window.dispatchEvent(new CustomEvent('storiesUpdated'));
  };

  const openStory = async (story) => {
    setActiveStory(story);
    try {
      const res = await api.post(`/stories/${getEntityId(story)}/view`);
      setStories(prev => prev.map(item => getEntityId(item) === getEntityId(res.data) ? res.data : item));
      setActiveStory(prev => getEntityId(prev) === getEntityId(story) ? res.data : prev);
    } catch {
      // Viewing should stay smooth even if the analytics request fails.
    }
  };

  const reactToStory = async (story, emoji) => {
    try {
      const res = await api.post(`/stories/${getEntityId(story)}/react`, { emoji });
      syncStory(res.data);
      toast.success('Reaction sent');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Reaction failed');
    }
  };

  const commentOnStory = async (story = activeStory, text = '') => {
    const reply = String(text || '').trim();
    if (!story || !reply || storyCommenting) return;
    setStoryCommenting(true);
    try {
      const res = await api.post(`/stories/${getEntityId(story)}/comment`, { text: reply });
      syncStory(res.data?.story || res.data);
      toast.success('Sent to messages');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Comment failed');
    } finally {
      setStoryCommenting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (avatarPreviewOpen) {
        setAvatarPreviewOpen(false);
        return;
      }
      onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [avatarPreviewOpen, isOpen, onClose]);

  const syncFriendBadge = () => {
    window.dispatchEvent(new CustomEvent('friendsUpdated'));
  };

  const updateFriendship = (nextFriendship) => {
    const next = nextFriendship || { status: 'none' };
    setFriendship(next);
    setProfile(prev => prev ? { ...prev, friendship: next } : prev);
    syncFriendBadge();
  };

  const sendFriendRequest = async () => {
    if (!profileId || isSelf) return;
    setFriendAction('send');
    try {
      const res = await api.post(`/friends/request/${profileId}`);
      updateFriendship(res.data?.friendship || { status: 'outgoing' });
      toast.success(res.data?.msg || 'Friend request sent');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Friend request failed');
    } finally {
      setFriendAction('');
    }
  };

  const acceptFriendRequest = async () => {
    if (!friendship?.requestId) return;
    setFriendAction('accept');
    try {
      const res = await api.put(`/friends/requests/${friendship.requestId}/accept`);
      updateFriendship(res.data?.friendship || { status: 'friends', requestId: friendship.requestId });
      toast.success('Friend request accepted');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Accept failed');
    } finally {
      setFriendAction('');
    }
  };

  const declineFriendRequest = async () => {
    if (!friendship?.requestId) return;
    setFriendAction('decline');
    try {
      await api.put(`/friends/requests/${friendship.requestId}/decline`);
      updateFriendship({ status: 'none' });
      toast.success('Friend request declined');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Decline failed');
    } finally {
      setFriendAction('');
    }
  };

  const cancelFriendRequest = async () => {
    if (!friendship?.requestId) return;
    setFriendAction('cancel');
    try {
      const res = await api.delete(`/friends/requests/${friendship.requestId}`);
      updateFriendship(res.data?.friendship || { status: 'none' });
      toast.success('Friend request canceled');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Cancel failed');
    } finally {
      setFriendAction('');
    }
  };

  const renderFriendAction = () => {
    if (isSelf) return null;

    if (friendship?.status === 'friends') {
      return (
        <div className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700 ring-1 ring-inset ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/60">
          <UserCheck size={16} />
          Friends
        </div>
      );
    }

    if (friendship?.status === 'incoming') {
      return (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={acceptFriendRequest}
            disabled={friendAction === 'accept'}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {friendAction === 'accept' ? <Loader2 size={16} className="animate-spin" /> : <UserCheck size={16} />}
            Accept
          </button>
          <button
            type="button"
            onClick={declineFriendRequest}
            disabled={friendAction === 'decline'}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-black text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <UserX size={16} />
            Decline
          </button>
        </div>
      );
    }

    if (friendship?.status === 'outgoing') {
      return (
        <div className="grid gap-2">
          <div className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-black text-amber-700 ring-1 ring-inset ring-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/60">
            <Clock size={16} />
            Request pending
          </div>
          <button
            type="button"
            onClick={cancelFriendRequest}
            disabled={friendAction === 'cancel'}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200 px-3 py-2.5 text-sm font-black text-amber-700 transition hover:bg-amber-50 disabled:opacity-50 dark:border-amber-900/60 dark:text-amber-200 dark:hover:bg-amber-950/30"
          >
            {friendAction === 'cancel' ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
            Cancel friend request
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={sendFriendRequest}
        disabled={friendAction === 'send'}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-black text-[#0b57d0] transition hover:bg-blue-100 disabled:opacity-50 dark:border-blue-900/60 dark:bg-blue-950/25 dark:text-sky-200 dark:hover:bg-blue-950/45"
      >
        {friendAction === 'send' ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
        Add Friend
      </button>
    );
  };

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4"
          onMouseDown={closeModal}
        >
          <div
            className="mobile-profile-modal h-auto max-h-[90svh] w-full max-w-[58rem] overflow-hidden rounded-[1.75rem] border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="max-h-[90svh] overflow-y-auto">
              <div className="relative overflow-hidden bg-gray-950 p-4 text-white sm:p-5">
              {coverPhoto ? (
                <img src={coverPhoto} alt="Profile cover" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(34,211,238,0.22),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(236,72,153,0.24),transparent_34%),linear-gradient(135deg,#050505,#151517_58%,#241b25)]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/45 to-black/15" />
              <button
                type="button"
                onClick={closeModal}
                className="absolute left-3 top-[calc(env(safe-area-inset-top)+0.65rem)] z-30 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-2xl backdrop-blur transition hover:-translate-x-0.5 hover:bg-white/20 hover:text-white sm:left-4 sm:top-4 sm:h-12 sm:w-12"
                aria-label="Back"
              >
                <ArrowLeft size={24} strokeWidth={2.8} />
              </button>
              <div className="relative z-10 flex items-end gap-3 pt-12">
                <DeveloperAvatarFrame user={profile} className="sync-profile-avatar-frame">
                  <button
                    type="button"
                    onClick={() => avatar && setAvatarPreviewOpen(true)}
                    disabled={!avatar}
                    className={`sync-profile-avatar-trigger group relative block rounded-full bg-transparent p-0 ${avatar ? 'cursor-zoom-in' : 'cursor-default'}`}
                    aria-label={avatar ? `View ${profile?.name || 'user'} profile picture` : undefined}
                    title={avatar ? 'View profile picture' : undefined}
                  >
                    <span className="flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-gradient-to-br from-sky-400 to-blue-700 text-xl font-black text-white shadow-lg sm:h-20 sm:w-20">
                      {avatar ? <img src={avatar} alt={profile?.name || 'User'} className="h-full w-full object-cover" /> : initials}
                    </span>
                    {avatar && (
                      <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-slate-950/0 text-[10px] font-black uppercase tracking-wide text-white opacity-0 transition duration-150 group-hover:bg-slate-950/45 group-hover:opacity-100 group-focus-visible:bg-slate-950/45 group-focus-visible:opacity-100">
                        View
                      </span>
                    )}
                  </button>
                </DeveloperAvatarFrame>
                <div className="min-w-0 pb-1">
                  <p className="text-xs font-bold uppercase text-blue-100">Profile</p>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="break-words text-xl font-black">{profile?.name || (loading ? 'Loading...' : 'User')}</h2>
                    <DeveloperBadge user={profile} />
                  </div>
                  <p className="mt-1 truncate text-sm text-white/70">{profile?.course || 'No course added'}</p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-white/55">
                    <Building2 size={13} />
                    {profile?.campus || 'Campus not set'}
                  </p>
                </div>
              </div>
              </div>

              <div className="grid gap-3 p-4 lg:grid-cols-2 lg:items-start">
              <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
                <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-950">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                    <Briefcase size={14} />
                    Campus status
                  </p>
                  <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{profile?.isDeveloper ? 'Developer' : profile?.studentVerificationStatus === 'approved' ? 'Verified' : 'Unverified'}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-950">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                    <Calendar size={14} />
                    Member since
                  </p>
                  <p className="mt-2 text-sm font-bold text-gray-950 dark:text-white">{formatMemberSince(profile?.createdAt)}</p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800 lg:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-2 text-sm font-black text-gray-950 dark:text-white">
                    <Users size={16} className="text-[#1877f2] dark:text-sky-300" />
                    Mutual friends
                  </p>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-black text-gray-600 dark:bg-gray-950 dark:text-gray-300">
                    {profile?.mutualFriendCount || mutualFriends.length}
                  </span>
                </div>
                {mutualFriends.length > 0 ? (
                  <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {mutualFriends.map(friend => {
                      const friendAvatar = resolveMediaUrl(friend.avatar);
                      return (
                        <div
                          key={getEntityId(friend)}
                          className="w-16 shrink-0 text-center"
                        >
                          <span className="mx-auto grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-gray-100 text-sm font-black text-gray-600 ring-1 ring-gray-200 dark:bg-gray-950 dark:text-gray-200 dark:ring-gray-800">
                            {friendAvatar ? <img src={friendAvatar} alt={friend.name || 'Friend'} className="h-full w-full object-cover" /> : (friend.name || 'M').charAt(0).toUpperCase()}
                          </span>
                          <span className="mt-1 block truncate text-[11px] font-black text-gray-600 dark:text-gray-300">{friend.name || 'Friend'}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-sm font-semibold text-gray-500 dark:text-gray-400">No mutual friends to show yet.</p>
                )}
              </div>

              {highlightItems.length > 0 && (
                <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-black text-gray-950 dark:text-white">
                      <ImageIcon size={16} className="text-[#1877f2] dark:text-sky-300" />
                      Highlights
                    </p>
                    <span className="rounded-full bg-pink-50 px-2 py-1 text-xs font-black text-pink-600 dark:bg-pink-950/30 dark:text-pink-200">{highlightItems.length}</span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {highlightItems.map(item => {
                      const mediaUrl = resolveMediaUrl(item.fileUrl);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => item.type === 'story' && item.story ? openStory(item.story) : null}
                          className="relative h-36 w-24 shrink-0 overflow-hidden rounded-2xl bg-gray-950"
                        >
                          {item.fileType === 'image' ? (
                            <img src={mediaUrl} alt={item.title || 'Highlight'} className="h-full w-full object-cover" />
                          ) : (
                            <VideoThumbnail src={mediaUrl} className="h-full w-full" iconSize={20} label={`${profile?.name || 'Member'} highlight video`} />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                          {item.count > 1 && (
                            <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-black text-white backdrop-blur">
                              +{item.count - 1}
                            </span>
                          )}
                          {item.age && (
                            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-black text-white backdrop-blur">
                              {item.age}
                            </span>
                          )}
                          {item.fileType === 'video' && <PlayCircle className={`absolute right-2 text-white ${item.count > 1 ? 'top-9' : 'top-2'}`} size={20} />}
                          <p className="absolute inset-x-2 bottom-2 line-clamp-2 text-left text-xs font-black text-white">{item.title || 'Highlight'}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800">
                <div className="flex items-center gap-3">
                  <GameRankEmblem rank={currentGameRank} size="sm" animated stars={profile?.gameStats?.apexStars} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Current Rank</p>
                    <p className="truncate text-sm font-black text-gray-950 dark:text-white">{currentGameRank?.name || 'Unranked'}</p>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{profile?.gameStats?.highScore || 0} high score - {profile?.gameStats?.totalPlays || 0} runs</p>
                  </div>
                  <GameRankBadge stats={profile?.gameStats} compact />
                </div>
              </div>

              <div className="rounded-xl border border-cyan-100 bg-cyan-50/65 p-3 dark:border-cyan-900/50 dark:bg-cyan-950/15">
                <div className="flex items-center gap-3">
                  <GameRankEmblem rank={highestGameRank} size="sm" animated stars={highestGameRank?.apexStars || profile?.gameStats?.apexStars} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black uppercase text-cyan-700 dark:text-cyan-200">Highest Rank</p>
                    <p className="truncate text-sm font-black text-gray-950 dark:text-white">{highestGameRank?.name || 'Unranked'}</p>
                    <p className="text-xs font-semibold text-cyan-700/80 dark:text-cyan-200/75">{profile?.gameStats?.highestScore || 0} lifetime best score</p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800">
                <p className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-950 dark:text-white">
                  <User size={16} className="text-pink-500" />
                  About
                </p>
                <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">{profile?.bio || 'No bio added yet.'}</p>
              </div>

              <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="flex items-center gap-2 text-sm font-black text-gray-950 dark:text-white">
                    <Globe2 size={16} className="text-[#1877f2] dark:text-sky-300" />
                    Posts
                  </p>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-black text-gray-600 dark:bg-gray-950 dark:text-gray-300">{profilePosts.length}</span>
                </div>
                {profilePosts.length > 0 ? (
                  <div className="space-y-3">
                    {profilePosts.slice(0, 5).map(post => {
                      const attachments = getPostAttachments(post).filter(attachment => ['image', 'video'].includes(attachment.fileType));
                      const firstAttachment = attachments[0];
                      const firstUrl = resolveMediaUrl(firstAttachment?.fileUrl);
                      return (
                        <article key={getEntityId(post)} className="rounded-2xl bg-gray-50 p-3 ring-1 ring-gray-100 dark:bg-gray-950 dark:ring-gray-800">
                          <div className="flex items-center justify-between gap-3">
                            <p className="min-w-0 truncate text-sm font-black text-gray-950 dark:text-white">
                              <AnimatedEmojiText text={post.title || 'Timeline post'} />
                            </p>
                            <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-black uppercase text-gray-500 ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-800">
                              {post.privacy || 'public'}
                            </span>
                          </div>
                          {post.content && (
                            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-gray-600 dark:text-gray-300">
                              <AnimatedEmojiText text={post.content} />
                            </p>
                          )}
                          {firstAttachment && (
                            <div className="mt-3 overflow-hidden rounded-2xl bg-gray-950">
                              {firstAttachment.fileType === 'image' ? (
                                <img src={firstUrl} alt={firstAttachment.fileName || post.title || 'Post media'} className="max-h-64 w-full object-cover" loading="lazy" decoding="async" />
                              ) : (
                                <VideoThumbnail src={firstUrl} className="h-48 w-full" iconSize={24} label={firstAttachment.fileName || post.title || 'Post video'} />
                              )}
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase text-gray-400">
                            <span>{formatPostTime(post.createdAt)}</span>
                            <span>{getReactionCount(post)} reactions</span>
                            <span>{post.comments?.length || 0} comments</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-2xl bg-gray-50 p-3 text-sm font-semibold text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                    No visible posts from this profile yet.
                  </p>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-gray-700 dark:bg-gray-950 dark:text-gray-300">
                  <Mail size={15} className="text-pink-500" />
                  <span className="min-w-0 truncate">{profile?.email || 'No email'}</span>
                </div>
                <div className="rounded-xl bg-gray-50 px-3 py-2 text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                  {lastSeen}
                </div>
              </div>

              <div className="grid gap-2 lg:col-span-2">
                {renderFriendAction()}
                <button
                  type="button"
                  onClick={openMessages}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1877f2] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#0f63d5]"
                >
                  <MessageCircle size={18} />
                  Message
                </button>
              </div>
              </div>
            </div>
          </div>

          {activeStory && (
            <Suspense fallback={(
              <div className="fixed inset-0 z-[140] grid place-items-center bg-slate-950/10 p-4 backdrop-blur-[1px]" role="status" aria-label="Opening story">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-xs font-black text-slate-700 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900/95 dark:text-slate-100 dark:ring-slate-700">
                  <Loader2 size={15} className="animate-spin text-[#1877f2]" />
                  Opening story…
                </span>
              </div>
            )}>
              <StoryViewer
                story={activeStory}
                stories={activeStoryList}
                currentUser={currentUser}
                onClose={() => setActiveStory(null)}
                onNavigate={openStory}
                onReact={reactToStory}
                onComment={commentOnStory}
                zIndexClass="z-[130]"
              />
            </Suspense>
          )}

          {avatarPreviewOpen && avatar && (
            <div
              className="fixed inset-0 z-[145] grid place-items-center bg-slate-950/90 p-4 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-label={`${profile?.name || 'User'} profile picture`}
              onMouseDown={(event) => {
                event.stopPropagation();
                if (event.target === event.currentTarget) setAvatarPreviewOpen(false);
              }}
            >
              <div className="relative flex max-h-full max-w-full items-center justify-center">
                <img
                  src={avatar}
                  alt={`${profile?.name || 'User'} profile picture`}
                  className="max-h-[82svh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
                  decoding="async"
                />
                <button
                  type="button"
                  onClick={() => setAvatarPreviewOpen(false)}
                  className="absolute -right-2 -top-2 inline-grid h-10 w-10 place-items-center rounded-full border border-white/25 bg-slate-950/80 text-white shadow-lg transition hover:bg-white hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  aria-label="Close profile picture"
                >
                  <X size={19} />
                </button>
              </div>
            </div>
          )}
        </div>
  , document.body);
}
