import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import type { ImagePickerAsset } from 'expo-image-picker';
import { Bell, Camera, Check, Clock3, Gamepad2, Heart, Home, ImagePlus, MapPin, MessageCircle, MoreHorizontal, Search, Settings, Share2, ShieldCheck, SmilePlus, Star, Store, Trash2, Trophy, UserCheck, UserPlus, UserRound, Video, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../components/Avatar';
import AnimatedEmoji from '../components/AnimatedEmoji';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  commentOnPost,
  createMarketplaceListing,
  createHomePost,
  deleteMarketplaceListing,
  deletePost,
  declineFriendRequest,
  fetchDashboardSummary,
  fetchFeedPosts,
  fetchFriendsSummary,
  fetchGameHubSummary,
  fetchGameSummary,
  fetchHomePosts,
  fetchMarketplaceStatus,
  fetchMarketplaceListings,
  fetchMyMarketplaceListings,
  fetchNotificationSummary,
  markNotificationsRead,
  reactToPost,
  reportMarketplaceListing,
  removeFriend,
  saveMarketplaceListing,
  savePost,
  sendFriendRequest,
  sharePost,
  submitGameScore,
  submitMarketplaceVerification,
  submitReactionTapScore,
  updateMarketplaceListingStatus,
  updateProfile,
  uploadAvatar,
  uploadCoverPhoto,
  uploadPostAsset,
  type DashboardData,
  type FeedPost,
  type FriendsSummary,
  type GameSummary,
  type MarketplaceListing,
  type MarketplaceStatus,
  type NotificationSummary
} from '../services/syncrovaMain';
import { createStory, fetchStoryGroups } from '../services/messages';
import {
  connectSocket,
  emitUserOnline,
  normalizeOnlineUsersPayload,
  requestOnlineUsers
} from '../services/socket';
import { useAuth } from '../store/AuthContext';
import { usePresenceStore } from '../store/presenceStore';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList, StoryGroup, User } from '../types';
import { readJsonCache, writeJsonCache } from '../utils/cache';
import { formatConversationTime } from '../utils/date';
import { getEntityId } from '../utils/ids';
import { resolveMediaUrl } from '../utils/media';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'SyncrovaMain'>;
type TabKey = 'home' | 'market' | 'chats' | 'friends' | 'games' | 'me';

type MainSnapshot = {
  dashboard: DashboardData | null;
  posts: FeedPost[];
  storyGroups: StoryGroup[];
  listings: MarketplaceListing[];
  myListings: MarketplaceListing[];
  marketplaceStatus: MarketplaceStatus | null;
  friends: FriendsSummary | null;
  games: GameSummary | null;
  gameHub: GameSummary | null;
  notifications: NotificationSummary | null;
};

const CACHE_TTL_MS = 20 * 60 * 1000;
const emptySnapshot: MainSnapshot = {
  dashboard: null,
  posts: [],
  storyGroups: [],
  listings: [],
  myListings: [],
  marketplaceStatus: null,
  friends: null,
  games: null,
  gameHub: null,
  notifications: null
};
const logoSource = require('../../assets/syncrova-app-logo.png');

const tabs: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }> }> = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'market', label: 'Market', icon: Store },
  { key: 'chats', label: 'Chats', icon: MessageCircle },
  { key: 'friends', label: 'Friends', icon: UserPlus },
  { key: 'games', label: 'Games', icon: Gamepad2 },
  { key: 'me', label: 'Me', icon: UserRound }
];

const marketplaceCategories = [
  ['all', 'All categories'],
  ['books', 'Books'],
  ['gadgets', 'Gadgets'],
  ['school_supplies', 'Supplies'],
  ['uniforms', 'Uniforms'],
  ['services', 'Services'],
  ['other', 'Other']
];

const marketplaceConditions = [
  ['new', 'New'],
  ['like_new', 'Like new'],
  ['good', 'Good'],
  ['fair', 'Fair'],
  ['used', 'Used']
];

const quickGamePresets = [
  {
    key: 'block-stack',
    label: 'Block Stack',
    payload: { score: 1800, moves: 28, linesCleared: 5, maxCombo: 4, boardFill: 24, durationMs: 52000 }
  },
  {
    key: 'focus-flow',
    label: 'Focus Flow',
    payload: { score: 1650, hits: 20, total: 25, perfects: 7, bestStreak: 8, accuracy: 80, misses: 5, elapsedMs: 47000 }
  },
  {
    key: 'flappy-bird',
    label: 'Flappy Scholar',
    payload: { score: 1250, pipesPassed: 9, elapsedMs: 41000 }
  },
  {
    key: 'jet-fighter',
    label: 'Jet Fighter',
    payload: { score: 2200, kills: 16, level: 3, lives: 2, elapsedMs: 62000 }
  },
  {
    key: 'neon-drift',
    label: 'Neon Drift',
    payload: { score: 2400, distance: 360, boosts: 5, dodges: 16, lives: 2, level: 3, elapsedMs: 68000 }
  },
  {
    key: 'space-runner',
    label: 'Space Runner',
    payload: { score: 2300, distance: 330, cores: 6, nearMisses: 14, lives: 2, level: 3, elapsedMs: 65000 }
  },
  {
    key: 'bow-duel',
    label: 'Knife Duel',
    payload: { score: 2100, wins: 2, rounds: 4, totalDamage: 62, bowLevel: 1, shots: 8, hits: 5, hpRemaining: 180, wonMatch: true, elapsedMs: 72000 }
  },
  {
    key: 'bug-hunt',
    label: 'Bug Hunt',
    payload: { score: 1350, foundCount: 8, totalCount: 10, mistakes: 2, accuracy: 80, secondsLeft: 12 }
  }
];

const getUserName = (user?: User | null) => user?.name || user?.email || 'Syncrova user';
const firstName = (value?: string) => (value || 'User').trim().split(/\s+/)[0] || 'User';
const compact = (value?: string, max = 92) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
};

const formatPrice = (price?: number) => {
  if (!Number.isFinite(price)) return 'Price not set';
  const amount = String(Math.max(0, Math.round(Number(price)))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `PHP ${amount}`;
};

const getPostAuthor = (post: FeedPost) => post.user || post.userId || {};
const getPostGroupName = (post: FeedPost) => post.group?.name || post.groupId?.name || post.groupId?.subject || 'Campus feed';
const getPostImage = (post: FeedPost) => {
  const attachment = post.attachments?.find(item => item.fileUrl);
  const variants = attachment?.variants || post.mediaVariants || {};
  const variant = variants.feed || variants.large || variants.thumb;
  const variantUrl = typeof variant === 'string' ? variant : variant?.fileUrl || variant?.url;
  return resolveMediaUrl(variantUrl || attachment?.fileUrl || post.fileUrl || '');
};
const getReactionEmoji = (reaction: unknown) => {
  if (typeof reaction === 'string') return reaction;
  const value = (reaction as { emoji?: string })?.emoji;
  if (!value) return '❤️';
  if (value === 'heart' || value === 'love') return '❤️';
  if (value === 'like') return '👍';
  return value;
};
const getPostReactionCount = (post: FeedPost) => post.reactions?.length || 0;
const getPostCommentCount = (post: FeedPost) => post.commentCount ?? post.comments?.length ?? 0;
const getPostShareCount = (post: FeedPost) => post.shares?.length || 0;
const getStatusText = (status?: string) => {
  const clean = String(status || 'not_submitted').replace(/_/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};
const getListingPhoto = (listing: MarketplaceListing) => {
  const photo = listing.photos?.[0];
  return resolveMediaUrl(photo?.url || photo?.fileUrl || '');
};

const isVideoPost = (post: FeedPost) => {
  const type = String(post.fileType || post.attachments?.[0]?.fileType || '').toLowerCase();
  return type.includes('video');
};

const getCacheKey = (userId: string) => `syncrova:native-main:${userId}`;

function MetricCard({
  label,
  value,
  accent,
  muted,
  surface,
  text
}: {
  label: string;
  value: string | number;
  accent: string;
  muted: string;
  surface: string;
  text: string;
}) {
  return (
    <View style={[styles.metricCard, { backgroundColor: surface, borderColor: `${accent}33` }]}>
      <Text style={[styles.metricValue, { color: text }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: muted }]}>{label}</Text>
      <View style={[styles.metricLine, { backgroundColor: accent }]} />
    </View>
  );
}

function SectionHeader({ title, action, colors }: { title: string; action?: string; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {action ? <Text style={[styles.sectionAction, { color: colors.primary }]}>{action}</Text> : null}
    </View>
  );
}

export default function SyncrovaMainScreen() {
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user, logout, refreshProfile } = useAuth();
  const currentUserId = getEntityId(user);
  const setOnlineUsers = usePresenceStore(state => state.setOnlineUsers);
  const setUserStatus = usePresenceStore(state => state.setUserStatus);
  const setConnected = usePresenceStore(state => state.setConnected);
  const onlineUserIds = usePresenceStore(state => state.onlineUserIds);
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [snapshot, setSnapshot] = useState<MainSnapshot>(emptySnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [postDraft, setPostDraft] = useState('');
  const [postPrivacy, setPostPrivacy] = useState<'public' | 'friends' | 'private'>('public');
  const [postMedia, setPostMedia] = useState<ImagePickerAsset | null>(null);
  const [posting, setPosting] = useState(false);
  const [postActionId, setPostActionId] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [marketQuery, setMarketQuery] = useState('');
  const [marketCategory, setMarketCategory] = useState('all');
  const [marketStatus, setMarketStatus] = useState('all');
  const [marketSort, setMarketSort] = useState('newest');
  const [marketActionId, setMarketActionId] = useState('');
  const [listingDraft, setListingDraft] = useState({
    title: '',
    description: '',
    price: '',
    category: 'books',
    condition: 'good',
    meetupSpot: ''
  });
  const [listingPhoto, setListingPhoto] = useState<ImagePickerAsset | null>(null);
  const [creatingListing, setCreatingListing] = useState(false);
  const [verificationUploading, setVerificationUploading] = useState(false);
  const [friendTab, setFriendTab] = useState<'friends' | 'people' | 'requests'>('friends');
  const [friendActionId, setFriendActionId] = useState('');
  const [reactionState, setReactionState] = useState<'idle' | 'ready' | 'go' | 'done'>('idle');
  const [reactionStartedAt, setReactionStartedAt] = useState(0);
  const [reactionTimes, setReactionTimes] = useState<number[]>([]);
  const [gameActionId, setGameActionId] = useState('');
  const [profileDraft, setProfileDraft] = useState({
    name: user?.name || '',
    course: user?.course || '',
    campus: user?.campus || '',
    bio: user?.bio || ''
  });
  const [profileSaving, setProfileSaving] = useState(false);

  const shell = useMemo(() => {
    return {
      background: '#F3F8FF',
      card: '#FFFFFF',
      soft: '#EAF2FF',
      line: '#C8DAF2',
      text: colors.text,
      muted: colors.mutedText,
      blue: '#0A84FF',
      green: '#22C55E',
      amber: '#F59E0B',
      rose: '#EC4899'
    };
  }, [colors.mutedText, colors.text]);

  useEffect(() => {
    setProfileDraft({
      name: user?.name || '',
      course: user?.course || '',
      campus: user?.campus || '',
      bio: user?.bio || ''
    });
  }, [user?.bio, user?.campus, user?.course, user?.name]);

  const loadMain = useCallback(async ({ showSpinner = false } = {}) => {
    if (showSpinner) setRefreshing(true);
    try {
      const [dashboard, homePosts, feedPosts, storyGroups, listings, myListings, marketplaceStatusData, friends, games, gameHub, notifications] = await Promise.all([
        fetchDashboardSummary().catch(() => null),
        fetchHomePosts().catch(() => []),
        fetchFeedPosts().catch(() => []),
        fetchStoryGroups().catch(() => []),
        fetchMarketplaceListings().catch(() => []),
        fetchMyMarketplaceListings().catch(() => []),
        fetchMarketplaceStatus().catch(() => null),
        fetchFriendsSummary().catch(() => null),
        fetchGameSummary().catch(() => null),
        fetchGameHubSummary().catch(() => null),
        fetchNotificationSummary().catch(() => null)
      ]);
      const nextSnapshot: MainSnapshot = {
        dashboard,
        posts: homePosts.length ? homePosts : feedPosts,
        storyGroups,
        listings,
        myListings,
        marketplaceStatus: marketplaceStatusData,
        friends,
        games,
        gameHub,
        notifications
      };
      setSnapshot(nextSnapshot);
      if (currentUserId) writeJsonCache(getCacheKey(currentUserId), nextSnapshot).catch(() => {});
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [currentUserId]);

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      if (currentUserId) {
        const cached = await readJsonCache<MainSnapshot>(getCacheKey(currentUserId), CACHE_TTL_MS);
        if (cached && mounted) {
          setSnapshot(cached);
          setLoaded(true);
        }
      }
      if (mounted) loadMain();
    };

    bootstrap();
    return () => {
      mounted = false;
    };
  }, [currentUserId, loadMain]);

  useEffect(() => {
    if (!currentUserId) return undefined;
    let mounted = true;
    let cleanup: undefined | (() => void);

    const setupPresence = async () => {
      const socket = await connectSocket();
      const publishOnline = async () => {
        const users = await emitUserOnline(currentUserId);
        if (mounted && users.length) setOnlineUsers(users);
      };
      const refreshOnlineUsers = async () => {
        const users = await requestOnlineUsers();
        if (mounted) setOnlineUsers(users);
      };
      const onOnlineUsers = (payload: unknown) => setOnlineUsers(normalizeOnlineUsersPayload(payload));
      const onUserOnline = (payload: unknown) => {
        const id = typeof payload === 'string' ? payload : getEntityId(payload);
        if (id) setUserStatus(id, true, null);
      };
      const onUserOffline = (payload: unknown) => {
        const data = payload as { userId?: string; lastSeen?: string | Date | null };
        const id = getEntityId(data?.userId || payload);
        if (id) setUserStatus(id, false, data?.lastSeen ? String(data.lastSeen) : null);
      };
      const onStatusChange = (payload: unknown) => {
        const data = payload as { userId?: string; online?: boolean; lastSeen?: string | Date | null };
        const id = getEntityId(data?.userId);
        if (id) setUserStatus(id, Boolean(data.online), data.lastSeen ? String(data.lastSeen) : null);
      };
      const onConnect = () => {
        setConnected(true);
        publishOnline().catch(() => {});
        refreshOnlineUsers().catch(() => {});
      };
      const onDisconnect = () => setConnected(false);

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('online-users', onOnlineUsers);
      socket.on('user-online', onUserOnline);
      socket.on('user-offline', onUserOffline);
      socket.on('user-status-change', onStatusChange);
      onConnect();

      cleanup = () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('online-users', onOnlineUsers);
        socket.off('user-online', onUserOnline);
        socket.off('user-offline', onUserOffline);
        socket.off('user-status-change', onStatusChange);
      };
    };

    setupPresence().catch(() => {});
    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [currentUserId, setConnected, setOnlineUsers, setUserStatus]);

  const setPosts = useCallback((updater: (posts: FeedPost[]) => FeedPost[]) => {
    setSnapshot(prev => ({ ...prev, posts: updater(prev.posts) }));
  }, []);

  const replacePost = useCallback((postId: string, post: FeedPost) => {
    setPosts(posts => posts.map(item => (getEntityId(item) === postId ? post : item)));
  }, [setPosts]);

  const pickLibraryAsset = async (allowVideo = false) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to continue.');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: allowVideo ? ImagePicker.MediaTypeOptions.All : ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.78,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium
    });

    if (result.canceled) return null;
    return result.assets[0] || null;
  };

  const pickCameraAsset = async (allowVideo = false) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow camera access to continue.');
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: allowVideo ? ImagePicker.MediaTypeOptions.All : ImagePicker.MediaTypeOptions.Images,
      quality: 0.78,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium
    });

    if (result.canceled) return null;
    return result.assets[0] || null;
  };

  const handlePickPostMedia = async () => {
    const asset = await pickLibraryAsset(true);
    if (asset) setPostMedia(asset);
  };

  const handleCreateStory = async () => {
    const asset = await pickLibraryAsset(true);
    if (!asset) return;
    setPosting(true);
    try {
      await createStory({ asset, caption: '', privacy: 'friends' });
      const storyGroups = await fetchStoryGroups().catch(() => snapshot.storyGroups);
      setSnapshot(prev => ({ ...prev, storyGroups }));
    } catch (error) {
      const message = (error as { response?: { data?: { msg?: string } }; message?: string })?.response?.data?.msg
        || (error as { message?: string })?.message
        || 'Could not create My Day';
      Alert.alert('My Day failed', message);
    } finally {
      setPosting(false);
    }
  };

  const submitPost = async () => {
    const content = postDraft.trim();
    if ((!content && !postMedia) || posting) return;
    setPosting(true);
    try {
      const uploaded = postMedia ? await uploadPostAsset(postMedia) : null;
      const post = await createHomePost({
        content: content || 'Shared media',
        privacy: postPrivacy,
        ...(uploaded || {}),
        attachments: uploaded ? [uploaded] : undefined
      });
      setPostDraft('');
      setPostMedia(null);
      setPosts(posts => [post, ...posts]);
    } catch (error) {
      const message = (error as { response?: { data?: { msg?: string } }; message?: string })?.response?.data?.msg
        || (error as { message?: string })?.message
        || 'Could not create post';
      Alert.alert('Post failed', message);
    } finally {
      setPosting(false);
    }
  };

  const handlePostSave = async (post: FeedPost) => {
    const postId = getEntityId(post);
    if (!postId || postActionId) return;
    setPostActionId(postId);
    try {
      replacePost(postId, await savePost(postId));
    } catch {
      Alert.alert('Save failed', 'Please try again.');
    } finally {
      setPostActionId('');
    }
  };

  const handlePostDelete = async (post: FeedPost) => {
    const postId = getEntityId(post);
    if (!postId || postActionId) return;
    const authorId = getEntityId(getPostAuthor(post));
    if (authorId !== currentUserId) {
      Alert.alert('Not allowed', 'You can delete your own posts only.');
      return;
    }

    setPostActionId(postId);
    try {
      await deletePost(postId);
      setPosts(posts => posts.filter(item => getEntityId(item) !== postId));
    } catch {
      Alert.alert('Delete failed', 'Please try again.');
    } finally {
      setPostActionId('');
    }
  };

  const handlePostReaction = async (post: FeedPost, emoji = 'heart') => {
    const postId = getEntityId(post);
    if (!postId || postActionId) return;
    setPostActionId(postId);
    try {
      replacePost(postId, await reactToPost(postId, emoji));
    } catch {
      Alert.alert('Reaction failed', 'Please try again.');
    } finally {
      setPostActionId('');
    }
  };

  const handlePostComment = async (post: FeedPost) => {
    const postId = getEntityId(post);
    const text = (commentDrafts[postId] || '').trim();
    if (!postId || !text || postActionId) return;
    setPostActionId(postId);
    try {
      replacePost(postId, await commentOnPost(postId, text));
      setCommentDrafts(prev => ({ ...prev, [postId]: '' }));
    } catch {
      Alert.alert('Comment failed', 'Please try again.');
    } finally {
      setPostActionId('');
    }
  };

  const handlePostShare = async (post: FeedPost) => {
    const postId = getEntityId(post);
    if (!postId || postActionId) return;
    setPostActionId(postId);
    try {
      replacePost(postId, await sharePost(postId));
    } catch {
      Alert.alert('Share failed', 'Please try again.');
    } finally {
      setPostActionId('');
    }
  };

  const reloadMarketplace = async () => {
    const params: Record<string, string> = {
      sort: marketSort,
      status: marketStatus
    };
    if (marketQuery.trim()) params.q = marketQuery.trim();
    if (marketCategory !== 'all') params.category = marketCategory;
    const listings = await fetchMarketplaceListings(params).catch(() => snapshot.listings);
    setSnapshot(prev => ({ ...prev, listings }));
  };

  const refreshMarketplace = async () => {
    const [listings, myListings, marketplaceStatusData] = await Promise.all([
      fetchMarketplaceListings({ sort: marketSort, status: marketStatus }).catch(() => snapshot.listings),
      fetchMyMarketplaceListings().catch(() => snapshot.myListings),
      fetchMarketplaceStatus().catch(() => snapshot.marketplaceStatus)
    ]);
    setSnapshot(prev => ({ ...prev, listings, myListings, marketplaceStatus: marketplaceStatusData }));
  };

  const handleSubmitVerification = async (documentType: 'campus_id' | 'cor') => {
    if (verificationUploading) return;
    const asset = await pickLibraryAsset(false);
    if (!asset) return;
    setVerificationUploading(true);
    try {
      const nextStatus = await submitMarketplaceVerification({ documentType, asset });
      setSnapshot(prev => ({ ...prev, marketplaceStatus: { ...prev.marketplaceStatus, ...nextStatus } }));
      Alert.alert('Submitted', 'Your marketplace verification is now pending review.');
    } catch (error) {
      const message = (error as { response?: { data?: { msg?: string } }; message?: string })?.response?.data?.msg
        || (error as { message?: string })?.message
        || 'Could not submit verification.';
      Alert.alert('Verification failed', message);
    } finally {
      setVerificationUploading(false);
    }
  };

  const handlePickListingPhoto = async () => {
    const asset = await pickLibraryAsset(false);
    if (asset) setListingPhoto(asset);
  };

  const handleCreateListing = async () => {
    if (creatingListing) return;
    const title = listingDraft.title.trim();
    const price = listingDraft.price.trim();
    const meetupSpot = listingDraft.meetupSpot.trim();
    if (!title || !price || !meetupSpot) {
      Alert.alert('Missing info', 'Title, price, and meetup spot are required.');
      return;
    }
    setCreatingListing(true);
    try {
      const listing = await createMarketplaceListing({
        ...listingDraft,
        title,
        price,
        meetupSpot,
        photos: listingPhoto ? [listingPhoto] : []
      });
      setListingDraft({ title: '', description: '', price: '', category: 'books', condition: 'good', meetupSpot: '' });
      setListingPhoto(null);
      if (listing) {
        setSnapshot(prev => ({
          ...prev,
          listings: [listing, ...prev.listings],
          myListings: [listing, ...prev.myListings]
        }));
      }
    } catch (error) {
      const message = (error as { response?: { data?: { msg?: string } }; message?: string })?.response?.data?.msg
        || (error as { message?: string })?.message
        || 'Could not create listing.';
      Alert.alert('Listing failed', message);
    } finally {
      setCreatingListing(false);
    }
  };

  const handleSaveListing = async (listing: MarketplaceListing) => {
    const listingId = getEntityId(listing);
    if (!listingId || marketActionId) return;
    setMarketActionId(listingId);
    try {
      const result = await saveMarketplaceListing(listingId);
      if (result.listing) {
        setSnapshot(prev => ({
          ...prev,
          listings: prev.listings.map(item => (getEntityId(item) === listingId ? result.listing as MarketplaceListing : item))
        }));
      }
    } catch {
      Alert.alert('Save failed', 'Please try again.');
    } finally {
      setMarketActionId('');
    }
  };

  const handleListingStatus = async (listing: MarketplaceListing, status: string) => {
    const listingId = getEntityId(listing);
    if (!listingId || marketActionId) return;
    setMarketActionId(listingId);
    try {
      const updated = await updateMarketplaceListingStatus(listingId, status);
      if (updated) {
        setSnapshot(prev => ({
          ...prev,
          listings: prev.listings.map(item => (getEntityId(item) === listingId ? updated : item)),
          myListings: prev.myListings.map(item => (getEntityId(item) === listingId ? updated : item))
        }));
      }
    } catch {
      Alert.alert('Status failed', 'Please try again.');
    } finally {
      setMarketActionId('');
    }
  };

  const handleReportListing = async (listing: MarketplaceListing) => {
    const listingId = getEntityId(listing);
    if (!listingId || marketActionId) return;
    setMarketActionId(listingId);
    try {
      const result = await reportMarketplaceListing(listingId, { reason: 'other', note: 'Reported from native app' });
      if (result.listing) {
        setSnapshot(prev => ({
          ...prev,
          listings: prev.listings.map(item => (getEntityId(item) === listingId ? result.listing as MarketplaceListing : item))
        }));
      }
      Alert.alert('Reported', 'Thanks. A developer can review this listing.');
    } catch {
      Alert.alert('Report failed', 'Please try again.');
    } finally {
      setMarketActionId('');
    }
  };

  const handleDeleteListing = async (listing: MarketplaceListing) => {
    const listingId = getEntityId(listing);
    if (!listingId || marketActionId) return;
    setMarketActionId(listingId);
    try {
      await deleteMarketplaceListing(listingId);
      setSnapshot(prev => ({
        ...prev,
        listings: prev.listings.filter(item => getEntityId(item) !== listingId),
        myListings: prev.myListings.filter(item => getEntityId(item) !== listingId)
      }));
    } catch {
      Alert.alert('Remove failed', 'Please try again.');
    } finally {
      setMarketActionId('');
    }
  };

  const refreshFriends = async () => {
    const friends = await fetchFriendsSummary();
    setSnapshot(prev => ({ ...prev, friends }));
  };

  const handleFriendAction = async (kind: 'request' | 'accept' | 'decline' | 'cancel' | 'remove', id: string) => {
    if (!id || friendActionId) return;
    setFriendActionId(id);
    try {
      if (kind === 'request') await sendFriendRequest(id);
      if (kind === 'accept') await acceptFriendRequest(id);
      if (kind === 'decline') await declineFriendRequest(id);
      if (kind === 'cancel') await cancelFriendRequest(id);
      if (kind === 'remove') await removeFriend(id);
      await refreshFriends();
    } catch (error) {
      const message = (error as { response?: { data?: { msg?: string } }; message?: string })?.response?.data?.msg
        || (error as { message?: string })?.message
        || 'Please try again.';
      Alert.alert('Action failed', message);
    } finally {
      setFriendActionId('');
    }
  };

  const startReactionTap = () => {
    setReactionTimes([]);
    setReactionState('ready');
    const delay = 750 + Math.round(Math.random() * 1200);
    setTimeout(() => {
      setReactionStartedAt(Date.now());
      setReactionState('go');
    }, delay);
  };

  const handleReactionTap = async () => {
    if (reactionState === 'ready') {
      setReactionState('idle');
      Alert.alert('Too early', 'Wait for the green signal.');
      return;
    }
    if (reactionState !== 'go') {
      startReactionTap();
      return;
    }

    const nextTimes = [...reactionTimes, Math.max(1, Date.now() - reactionStartedAt)];
    setReactionTimes(nextTimes);
    if (nextTimes.length >= 5) {
      setReactionState('done');
      const averageReactionMs = Math.round(nextTimes.reduce((sum, value) => sum + value, 0) / nextTimes.length);
      const bestReactionMs = Math.min(...nextTimes);
      const score = Math.max(100, Math.round(3500 - averageReactionMs * 4 + Math.max(0, 700 - bestReactionMs)));
      submitReactionTapScore({
        averageReactionMs,
        bestReactionMs,
        elapsedMs: nextTimes.reduce((sum, value) => sum + value, 0),
        playerPoints: nextTimes.length,
        rounds: nextTimes.length,
        score,
        taps: nextTimes.length,
        targetPoints: 5,
        wins: nextTimes.filter(value => value <= 450).length,
        wonMatch: averageReactionMs <= 600
      }).then(() => loadMain()).catch(() => {});
      return;
    }

    setReactionState('ready');
    const delay = 700 + Math.round(Math.random() * 1200);
    setTimeout(() => {
      setReactionStartedAt(Date.now());
      setReactionState('go');
    }, delay);
  };

  const handleQuickGameSubmit = async (game: (typeof quickGamePresets)[number]) => {
    if (gameActionId) return;
    setGameActionId(game.key);
    try {
      await submitGameScore(game.key, game.payload as unknown as Record<string, number | boolean | string>);
      const gameHub = await fetchGameHubSummary().catch(() => snapshot.gameHub);
      setSnapshot(prev => ({ ...prev, gameHub, games: gameHub || prev.games }));
      Alert.alert('Score saved', `${game.label} score was submitted.`);
    } catch (error) {
      const message = (error as { response?: { data?: { msg?: string } }; message?: string })?.response?.data?.msg
        || (error as { message?: string })?.message
        || 'Could not submit score.';
      Alert.alert('Game failed', message);
    } finally {
      setGameActionId('');
    }
  };

  const handleProfileSave = async () => {
    if (profileSaving) return;
    const name = profileDraft.name.trim();
    if (!name) {
      Alert.alert('Missing name', 'Name is required.');
      return;
    }
    setProfileSaving(true);
    try {
      await updateProfile({
        name,
        course: profileDraft.course,
        campus: profileDraft.campus,
        bio: profileDraft.bio
      });
      await refreshProfile();
      Alert.alert('Saved', 'Profile updated.');
    } catch (error) {
      const message = (error as { response?: { data?: { msg?: string } }; message?: string })?.response?.data?.msg
        || (error as { message?: string })?.message
        || 'Could not update profile.';
      Alert.alert('Profile failed', message);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleAvatarUpload = async () => {
    const asset = await pickLibraryAsset(false);
    if (!asset) return;
    setProfileSaving(true);
    try {
      await uploadAvatar(asset);
      await refreshProfile();
    } catch {
      Alert.alert('Avatar failed', 'Please try another image.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleCoverUpload = async () => {
    const asset = await pickLibraryAsset(false);
    if (!asset) return;
    setProfileSaving(true);
    try {
      await uploadCoverPhoto(asset);
      await refreshProfile();
    } catch {
      Alert.alert('Cover failed', 'Please try another image.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleReadNotifications = async () => {
    try {
      await markNotificationsRead();
      setSnapshot(prev => ({ ...prev, notifications: { unreadCount: 0 } }));
      Alert.alert('Notifications', 'Activity inbox marked as read.');
    } catch {
      Alert.alert('Notifications', 'Could not update notifications.');
    }
  };

  const renderHome = () => {
    const summary = snapshot.dashboard?.summary || {};
    const posts = snapshot.posts.slice(0, 12);
    const storyGroups = snapshot.storyGroups.slice(0, 8);
    const unread = summary.unreadMessages || 0;
    const groups = summary.groupCount || snapshot.dashboard?.groups.length || 0;
    const openTasks = summary.assignedOpenTaskCount || summary.openTaskCount || 0;

    return (
      <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.storyRail} contentContainerStyle={styles.storyRailContent}>
          <Pressable onPress={handleCreateStory} style={[styles.addStoryCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
            <View style={[styles.storyPreviewSoft, { backgroundColor: shell.soft }]}>
              <Avatar user={user} size={66} storyRing="unviewed" />
              <View style={[styles.storyCamera, { backgroundColor: shell.blue }]}>
                <Camera color="#FFFFFF" size={18} />
              </View>
            </View>
            <Text style={[styles.addStoryText, { color: shell.text }]}>Add stories</Text>
          </Pressable>
          {storyGroups.map(group => {
            const owner = group.owner || {};
            const preview = group.preview || group.stories?.[0];
            const previewUri = resolveMediaUrl(preview?.fileUrl || '');
            return (
              <Pressable key={group.ownerId || getEntityId(owner)} style={styles.storyCard}>
                {previewUri ? (
                  <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: previewUri }} style={styles.storyImage} transition={150} />
                ) : (
                  <View style={[styles.storyImage, { backgroundColor: shell.soft }]} />
                )}
                <View style={styles.storyAvatar}>
                  <Avatar user={owner} size={38} storyRing="unviewed" />
                </View>
                <Text numberOfLines={1} style={styles.storyName}>{firstName(owner.name || owner.email)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.metricsGrid}>
          <MetricCard label="Unread" value={unread} accent={shell.blue} muted={shell.muted} surface={shell.card} text={shell.text} />
          <MetricCard label="Groups" value={groups} accent={shell.green} muted={shell.muted} surface={shell.card} text={shell.text} />
          <MetricCard label="Open tasks" value={openTasks} accent={shell.amber} muted={shell.muted} surface={shell.card} text={shell.text} />
        </View>

        <View style={[styles.composerPanel, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <View style={styles.composerMainRow}>
            <Avatar user={user} size={44} online />
            <TextInput
              multiline
              onChangeText={setPostDraft}
              placeholder="Share a campus update"
              placeholderTextColor={shell.muted}
              style={[styles.postInput, { backgroundColor: shell.soft, color: shell.text }]}
              value={postDraft}
            />
            <Pressable disabled={(!postDraft.trim() && !postMedia) || posting} onPress={submitPost} style={[styles.postButton, { backgroundColor: postDraft.trim() || postMedia ? shell.blue : shell.soft }]}>
              {posting ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.postButtonText}>Post</Text>}
            </Pressable>
          </View>
          {postMedia ? (
            <View style={[styles.selectedMediaRow, { backgroundColor: shell.soft }]}>
              <Text numberOfLines={1} style={[styles.selectedMediaText, { color: shell.text }]}>
                {postMedia.type === 'video' ? 'Video attached' : 'Photo attached'} · {postMedia.fileName || 'ready to upload'}
              </Text>
              <Pressable onPress={() => setPostMedia(null)}>
                <X color={shell.muted} size={18} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.filterRow}>
            {(['public', 'friends', 'private'] as const).map(value => (
              <Pressable key={value} onPress={() => setPostPrivacy(value)} style={[styles.filterChip, { backgroundColor: postPrivacy === value ? shell.blue : shell.soft, borderColor: shell.line, minHeight: 34 }]}>
                <Text style={[styles.filterChipText, { color: postPrivacy === value ? '#FFFFFF' : shell.text }]}>{getStatusText(value)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[styles.composerActions, { borderTopColor: shell.line }]}>
            <Pressable onPress={async () => {
              const asset = await pickCameraAsset(true);
              if (asset) setPostMedia(asset);
            }} style={styles.composerAction}><Video color="#F43F5E" size={19} /><Text style={[styles.composerActionText, { color: shell.text }]}>Camera</Text></Pressable>
            <Pressable onPress={handlePickPostMedia} style={styles.composerAction}><ImagePlus color="#10B981" size={19} /><Text style={[styles.composerActionText, { color: shell.text }]}>Photo</Text></Pressable>
            <Pressable onPress={() => setPostDraft(prev => (prev ? `${prev} 😊` : 'Feeling happy 😊'))} style={styles.composerAction}><SmilePlus color="#F59E0B" size={19} /><Text style={[styles.composerActionText, { color: shell.text }]}>Feeling</Text></Pressable>
            <Pressable onPress={() => setPostDraft(prev => `${prev}${prev ? ' ' : ''}at NEMSU campus`)} style={styles.composerAction}><MapPin color="#EC4899" size={19} /><Text style={[styles.composerActionText, { color: shell.text }]}>Check in</Text></Pressable>
          </View>
        </View>

        <SectionHeader title="Campus Feed" action="Native preview" colors={colors} />
        {posts.length ? posts.map(post => {
          const image = getPostImage(post);
          const author = getPostAuthor(post);
          const postId = getEntityId(post);
          const commentDraft = commentDrafts[postId] || '';
          const firstReaction = post.reactions?.[0] ? getReactionEmoji(post.reactions[0]) : '❤️';
          return (
            <View key={getEntityId(post) || `${post.createdAt}-${post.content}`} style={[styles.feedCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
              <View style={styles.feedHeader}>
                <Avatar user={author} size={38} />
                <View style={styles.flex}>
                  <Text style={[styles.feedAuthor, { color: shell.text }]}>{getUserName(author)}</Text>
                  <Text style={[styles.feedMeta, { color: shell.muted }]}>
                    {getPostGroupName(post)} - {formatConversationTime(post.createdAt)} - {post.privacy || 'Public'}
                  </Text>
                </View>
                <Pressable onPress={() => handlePostSave(post)}>
                  <MoreHorizontal color={shell.muted} size={20} />
                </Pressable>
              </View>
              {post.title ? <Text style={[styles.feedTitle, { color: shell.text }]}>{post.title}</Text> : null}
              {post.content ? <Text style={[styles.feedContent, { color: shell.text }]}>{compact(post.content, 170)}</Text> : null}
              {image ? (
                <View style={styles.feedMediaWrap}>
                  <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: image }} style={styles.feedMedia} transition={150} />
                  {isVideoPost(post) ? <View style={styles.videoPill}><Text style={styles.videoPillText}>Video</Text></View> : null}
                </View>
              ) : null}
              <View style={[styles.feedStatsRow, { borderTopColor: shell.line }]}>
                <View style={styles.reactionCount}>
                  {getPostReactionCount(post) ? <AnimatedEmoji emoji={firstReaction} size={18} /> : null}
                  <Text style={[styles.feedStats, { color: shell.muted }]}>
                    {getPostReactionCount(post) || 'React'}
                  </Text>
                </View>
                <Text style={[styles.feedStats, { color: shell.muted }]}>
                  {getPostCommentCount(post)} comments - {getPostShareCount(post)} shares
                </Text>
              </View>
              <View style={[styles.feedActionRow, { borderTopColor: shell.line }]}>
                <Pressable disabled={postActionId === postId} onPress={() => handlePostReaction(post)} style={styles.feedAction}>
                  <Heart color={shell.rose} size={20} />
                  <Text style={[styles.feedActionText, { color: shell.text }]}>React</Text>
                </Pressable>
                <Pressable style={styles.feedAction}>
                  <MessageCircle color={shell.muted} size={20} />
                  <Text style={[styles.feedActionText, { color: shell.text }]}>Comment</Text>
                </Pressable>
                <Pressable disabled={postActionId === postId} onPress={() => handlePostShare(post)} style={styles.feedAction}>
                  <Share2 color={shell.muted} size={20} />
                  <Text style={[styles.feedActionText, { color: shell.text }]}>Share</Text>
                </Pressable>
              </View>
              <View style={styles.feedMiniRow}>
                <Pressable disabled={postActionId === postId} onPress={() => handlePostSave(post)} style={[styles.miniButton, { backgroundColor: shell.soft }]}>
                  <Star color={shell.muted} size={15} />
                  <Text style={[styles.miniButtonText, { color: shell.text }]}>Save</Text>
                </Pressable>
                {getEntityId(author) === currentUserId ? (
                  <Pressable disabled={postActionId === postId} onPress={() => handlePostDelete(post)} style={[styles.miniButton, { backgroundColor: `${colors.danger}15` }]}>
                    <Trash2 color={colors.danger} size={15} />
                    <Text style={[styles.miniButtonText, { color: colors.danger }]}>Delete</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.commentRow}>
                <TextInput
                  onChangeText={text => setCommentDrafts(prev => ({ ...prev, [postId]: text }))}
                  placeholder="Write a comment"
                  placeholderTextColor={shell.muted}
                  style={[styles.commentInput, { backgroundColor: shell.soft, color: shell.text }]}
                  value={commentDraft}
                />
                <Pressable disabled={!commentDraft.trim() || postActionId === postId} onPress={() => handlePostComment(post)} style={[styles.commentSend, { backgroundColor: commentDraft.trim() ? shell.blue : shell.soft }]}>
                  <Text style={[styles.commentSendText, { color: commentDraft.trim() ? '#FFFFFF' : shell.muted }]}>Send</Text>
                </Pressable>
              </View>
            </View>
          );
        }) : (
          <View style={[styles.emptyCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
            <Text style={[styles.emptyTitle, { color: shell.text }]}>No feed posts yet</Text>
            <Text style={[styles.emptyCopy, { color: shell.muted }]}>Join or create groups to fill your native home feed.</Text>
          </View>
        )}
      </>
    );
  };

  const renderMarket = () => {
    const listings = snapshot.listings.slice(0, 12);
    const status = snapshot.marketplaceStatus;
    const verificationStatus = user?.isDeveloper ? 'developer' : status?.user?.studentVerificationStatus || status?.verification?.status || 'not_submitted';
    const canBuySell = Boolean(user?.isDeveloper || status?.canBuySell);
    const activeCount = listings.filter(item => item.status === 'active' || item.status === 'reserved').length;
    const savedCount = listings.filter(item => item.isSaved).length;
    const photoCount = listings.reduce((count, item) => count + (item.photos?.length || 0), 0);
    return (
      <>
        <View style={[styles.marketHero, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <View style={styles.marketHeroTop}>
            <View style={[styles.marketHeroIcon, { backgroundColor: shell.blue }]}>
              <Store color="#FFFFFF" size={30} />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.eyebrow, { color: shell.blue }]}>Campus-only marketplace</Text>
              <Text style={[styles.marketHeroTitle, { color: shell.text }]}>Student Marketplace</Text>
              <Text style={[styles.heroCopy, { color: shell.muted }]}>Buy and sell books, gadgets, uniforms, and school supplies with verified campus students.</Text>
            </View>
          </View>
          <View style={styles.marketStatsGrid}>
            <MetricCard label="Active" value={activeCount} accent={shell.green} muted={shell.muted} surface={shell.soft} text={shell.text} />
            <MetricCard label="Saved" value={savedCount} accent={shell.blue} muted={shell.muted} surface={shell.soft} text={shell.text} />
            <MetricCard label="Mine" value={snapshot.myListings.length} accent={shell.rose} muted={shell.muted} surface={shell.soft} text={shell.text} />
            <MetricCard label="Photos" value={photoCount} accent={shell.amber} muted={shell.muted} surface={shell.soft} text={shell.text} />
          </View>
          <View style={[styles.verificationBox, { backgroundColor: shell.soft, borderColor: shell.line }]}>
            <View style={styles.verificationHeader}>
              <Text style={[styles.verificationTitle, { color: shell.text }]}>Official student access</Text>
              <View style={[styles.statusPill, { backgroundColor: canBuySell ? `${shell.green}20` : `${shell.muted}18` }]}>
                {canBuySell ? <ShieldCheck color={shell.green} size={16} /> : <Clock3 color={shell.muted} size={16} />}
                <Text style={[styles.statusPillText, { color: canBuySell ? shell.green : shell.muted }]}>{getStatusText(verificationStatus)}</Text>
              </View>
            </View>
            <Text style={[styles.verificationCopy, { color: shell.muted }]}>
              {canBuySell ? 'Marketplace access is unlocked for this account.' : 'Submit your campus ID or COR before using buy and sell.'}
            </Text>
            {!canBuySell ? (
              <View style={styles.feedMiniRow}>
                <Pressable disabled={verificationUploading} onPress={() => handleSubmitVerification('campus_id')} style={[styles.miniButton, { backgroundColor: shell.blue }]}>
                  {verificationUploading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={[styles.miniButtonText, { color: '#FFFFFF' }]}>Submit ID</Text>}
                </Pressable>
                <Pressable disabled={verificationUploading} onPress={() => handleSubmitVerification('cor')} style={[styles.miniButton, { backgroundColor: shell.soft }]}>
                  <Text style={[styles.miniButtonText, { color: shell.text }]}>Submit COR</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        <SectionHeader title="Sell an item" action={canBuySell ? 'Working upload' : 'Verification needed'} colors={colors} />
        <View style={[styles.filterPanel, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <TextInput
            onChangeText={text => setListingDraft(prev => ({ ...prev, title: text }))}
            placeholder="Item title"
            placeholderTextColor={shell.muted}
            style={[styles.searchInput, { backgroundColor: shell.soft, color: shell.text }]}
            value={listingDraft.title}
          />
          <View style={styles.composerMainRow}>
            <TextInput
              keyboardType="numeric"
              onChangeText={text => setListingDraft(prev => ({ ...prev, price: text.replace(/[^\d.]/g, '') }))}
              placeholder="Price"
              placeholderTextColor={shell.muted}
              style={[styles.searchInput, { backgroundColor: shell.soft, color: shell.text, flex: 1 }]}
              value={listingDraft.price}
            />
            <Pressable onPress={handlePickListingPhoto} style={[styles.postButton, { backgroundColor: listingPhoto ? shell.green : shell.soft }]}>
              <ImagePlus color={listingPhoto ? '#FFFFFF' : shell.muted} size={18} />
            </Pressable>
          </View>
          <TextInput
            onChangeText={text => setListingDraft(prev => ({ ...prev, meetupSpot: text }))}
            placeholder="Safe meetup spot"
            placeholderTextColor={shell.muted}
            style={[styles.searchInput, { backgroundColor: shell.soft, color: shell.text }]}
            value={listingDraft.meetupSpot}
          />
          <TextInput
            multiline
            onChangeText={text => setListingDraft(prev => ({ ...prev, description: text }))}
            placeholder="Description"
            placeholderTextColor={shell.muted}
            style={[styles.postInput, { backgroundColor: shell.soft, color: shell.text, minHeight: 72 }]}
            value={listingDraft.description}
          />
          {listingPhoto ? (
            <View style={[styles.selectedMediaRow, { backgroundColor: shell.soft }]}>
              <Text numberOfLines={1} style={[styles.selectedMediaText, { color: shell.text }]}>{listingPhoto.fileName || 'Listing photo selected'}</Text>
              <Pressable onPress={() => setListingPhoto(null)}><X color={shell.muted} size={18} /></Pressable>
            </View>
          ) : null}
          <View style={styles.filterRow}>
            {marketplaceCategories.filter(([value]) => value !== 'all').map(([value, label]) => (
              <Pressable key={value} onPress={() => setListingDraft(prev => ({ ...prev, category: value }))} style={[styles.filterChip, { backgroundColor: listingDraft.category === value ? shell.blue : shell.soft, borderColor: shell.line }]}>
                <Text style={[styles.filterChipText, { color: listingDraft.category === value ? '#FFFFFF' : shell.text }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.filterRow}>
            {marketplaceConditions.map(([value, label]) => (
              <Pressable key={value} onPress={() => setListingDraft(prev => ({ ...prev, condition: value }))} style={[styles.filterChip, { backgroundColor: listingDraft.condition === value ? shell.green : shell.soft, borderColor: shell.line }]}>
                <Text style={[styles.filterChipText, { color: listingDraft.condition === value ? '#FFFFFF' : shell.text }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable disabled={!canBuySell || creatingListing} onPress={handleCreateListing} style={[styles.searchButton, { backgroundColor: canBuySell ? shell.blue : shell.soft }]}>
            {creatingListing ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Store color={canBuySell ? '#FFFFFF' : shell.muted} size={18} />}
            <Text style={[styles.searchButtonText, { color: canBuySell ? '#FFFFFF' : shell.muted }]}>Create listing</Text>
          </Pressable>
        </View>

        <SectionHeader title="Campus Listings" action={`${listings.length} latest`} colors={colors} />
        <View style={[styles.filterPanel, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <TextInput
            onChangeText={setMarketQuery}
            placeholder="Search items"
            placeholderTextColor={shell.muted}
            style={[styles.searchInput, { backgroundColor: shell.soft, color: shell.text }]}
            value={marketQuery}
          />
          <View style={styles.filterRow}>
            {[
              ['all', 'All categories'],
              ['books', 'Books'],
              ['gadgets', 'Gadgets'],
              ['uniforms', 'Uniforms']
            ].map(([value, label]) => (
              <Pressable key={value} onPress={() => setMarketCategory(value)} style={[styles.filterChip, { backgroundColor: marketCategory === value ? shell.blue : shell.soft, borderColor: shell.line }]}>
                <Text style={[styles.filterChipText, { color: marketCategory === value ? '#FFFFFF' : shell.text }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.filterRow}>
            {[
              ['all', 'Available + reserved'],
              ['active', 'Available'],
              ['reserved', 'Reserved'],
              ['sold', 'Sold'],
              ['newest', 'Newest first']
            ].map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => {
                  if (value === 'newest') setMarketSort(value);
                  else setMarketStatus(value);
                }}
                style={[styles.filterChip, { backgroundColor: marketStatus === value || marketSort === value ? shell.blue : shell.soft, borderColor: shell.line }]}
              >
                <Text style={[styles.filterChipText, { color: marketStatus === value || marketSort === value ? '#FFFFFF' : shell.text }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={reloadMarketplace} style={[styles.searchButton, { backgroundColor: shell.blue }]}>
            <Search color="#FFFFFF" size={18} />
            <Text style={styles.searchButtonText}>Search</Text>
          </Pressable>
        </View>
        {listings.map(listing => {
          const photo = getListingPhoto(listing);
          const listingId = getEntityId(listing);
          const sellerId = getEntityId(listing.seller);
          const canManageListing = Boolean(user?.isDeveloper || sellerId === currentUserId);
          return (
            <View key={getEntityId(listing) || listing.title} style={[styles.marketCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
              {photo ? (
                <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: photo }} style={styles.marketImage} transition={150} />
              ) : (
                <View style={[styles.marketImage, styles.marketFallback, { backgroundColor: shell.soft }]}>
                  <Store color={shell.muted} size={24} />
                </View>
              )}
              <View style={styles.marketBody}>
                <Text numberOfLines={1} style={[styles.marketTitle, { color: shell.text }]}>{listing.title || 'Campus listing'}</Text>
                <Text style={[styles.marketPrice, { color: shell.blue }]}>{formatPrice(listing.price)}</Text>
                <Text numberOfLines={1} style={[styles.marketMeta, { color: shell.muted }]}>
                  {listing.category || 'General'} · {listing.status || 'active'} · {listing.campus || 'Campus'}
                </Text>
                <View style={styles.feedMiniRow}>
                  <Pressable disabled={marketActionId === listingId} onPress={() => handleReportListing(listing)} style={[styles.miniButton, { backgroundColor: shell.soft }]}>
                    <Text style={[styles.miniButtonText, { color: shell.text }]}>Report</Text>
                  </Pressable>
                  {canManageListing ? (
                    <>
                      {['active', 'reserved', 'sold'].map(nextStatus => (
                        <Pressable key={nextStatus} disabled={marketActionId === listingId} onPress={() => handleListingStatus(listing, nextStatus)} style={[styles.miniButton, { backgroundColor: listing.status === nextStatus ? shell.blue : shell.soft }]}>
                          <Text style={[styles.miniButtonText, { color: listing.status === nextStatus ? '#FFFFFF' : shell.text }]}>{getStatusText(nextStatus)}</Text>
                        </Pressable>
                      ))}
                      <Pressable disabled={marketActionId === listingId} onPress={() => handleDeleteListing(listing)} style={[styles.miniButton, { backgroundColor: `${colors.danger}15` }]}>
                        <Text style={[styles.miniButtonText, { color: colors.danger }]}>Remove</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </View>
              <Pressable onPress={() => handleSaveListing(listing)} style={[styles.saveListingButton, { backgroundColor: listing.isSaved ? `${shell.blue}20` : shell.soft }]}>
                <Star color={listing.isSaved ? shell.blue : shell.muted} size={19} fill={listing.isSaved ? shell.blue : 'transparent'} />
              </Pressable>
            </View>
          );
        })}
        {!listings.length ? (
          <View style={[styles.emptyCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
            <Text style={[styles.emptyTitle, { color: shell.text }]}>No listings available</Text>
            <Text style={[styles.emptyCopy, { color: shell.muted }]}>Approved marketplace posts will appear here.</Text>
          </View>
        ) : null}
      </>
    );
  };

  const renderFriends = () => {
    const friends = snapshot.friends?.friends || [];
    const incoming = snapshot.friends?.incoming || [];
    const outgoing = snapshot.friends?.outgoing || [];
    const people = snapshot.friends?.people || [];
    const rows = friendTab === 'friends'
      ? friends
      : friendTab === 'people'
        ? people
        : incoming;
    return (
      <>
        <View style={styles.friendTabs}>
          <Pressable onPress={() => setFriendTab('friends')} style={[styles.friendTab, { backgroundColor: friendTab === 'friends' ? shell.blue : shell.card, borderColor: shell.line }]}>
            <UserCheck color={friendTab === 'friends' ? '#FFFFFF' : shell.muted} size={20} />
            <Text style={[styles.friendTabText, { color: friendTab === 'friends' ? '#FFFFFF' : shell.text }]}>All Friends</Text>
            <Text style={[styles.friendTabCount, { color: friendTab === 'friends' ? '#FFFFFF' : shell.muted }]}>{friends.length}</Text>
          </Pressable>
          <Pressable onPress={() => setFriendTab('people')} style={[styles.friendTab, { backgroundColor: friendTab === 'people' ? shell.blue : shell.card, borderColor: shell.line }]}>
            <UserPlus color={friendTab === 'people' ? '#FFFFFF' : shell.muted} size={20} />
            <Text style={[styles.friendTabText, { color: friendTab === 'people' ? '#FFFFFF' : shell.text }]}>Add Friend</Text>
            <Text style={[styles.friendTabCount, { color: friendTab === 'people' ? '#FFFFFF' : shell.muted }]}>{people.length}</Text>
          </Pressable>
          <Pressable onPress={() => setFriendTab('requests')} style={[styles.friendTab, { backgroundColor: friendTab === 'requests' ? shell.blue : shell.card, borderColor: shell.line }]}>
            <Bell color={friendTab === 'requests' ? '#FFFFFF' : shell.muted} size={20} />
            <Text style={[styles.friendTabText, { color: friendTab === 'requests' ? '#FFFFFF' : shell.text }]}>Requests</Text>
            <Text style={[styles.friendTabCount, { color: friendTab === 'requests' ? '#FFFFFF' : shell.muted }]}>{incoming.length}</Text>
          </Pressable>
        </View>
        <View style={[styles.friendsHero, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <View style={styles.flex}>
            <Text style={[styles.eyebrow, { color: shell.blue }]}>Syncrova network</Text>
            <Text style={[styles.marketHeroTitle, { color: shell.text }]}>Friends</Text>
            <Text style={[styles.heroCopy, { color: shell.muted }]}>Manage trusted teammates, review requests, and message classmates.</Text>
          </View>
          <UserPlus color={shell.blue} size={72} />
        </View>
        <View style={styles.metricsGrid}>
          <MetricCard label="Friends" value={snapshot.friends?.counts.friends || friends.length} accent={shell.green} muted={shell.muted} surface={shell.card} text={shell.text} />
          <MetricCard label="Requests" value={snapshot.friends?.counts.incoming || incoming.length} accent={shell.rose} muted={shell.muted} surface={shell.card} text={shell.text} />
          <MetricCard label="Pending" value={snapshot.friends?.counts.outgoing || outgoing.length} accent={shell.amber} muted={shell.muted} surface={shell.card} text={shell.text} />
        </View>
        <SectionHeader title={friendTab === 'people' ? 'People you may know' : friendTab === 'requests' ? 'Friend requests' : 'Friends'} action="Working actions" colors={colors} />
        {rows.slice(0, 16).map(row => {
          const friend = (('user' in row ? row.user : 'requester' in row ? row.requester : row) || {}) as User;
          const id = getEntityId(friend);
          const active = onlineUserIds.includes(id);
          const rowId = getEntityId(row);
          const friendship = (friend as User & { friendship?: { status?: string; requestId?: string; friendshipId?: string } }).friendship;
          const relationStatus = friendship?.status || (friendTab === 'friends' ? 'accepted' : friendTab === 'requests' ? 'incoming' : 'none');
          const actionId = friendship?.requestId || friendship?.friendshipId || rowId || id;
          const since = 'since' in row ? row.since : '';
          return (
            <View key={id || friend.email} style={[styles.personRow, { backgroundColor: shell.card, borderColor: shell.line }]}>
              <Avatar user={friend} size={46} online={active} />
              <View style={styles.flex}>
                <Text style={[styles.personName, { color: shell.text }]}>{getUserName(friend)}</Text>
                <Text style={[styles.personMeta, { color: active ? shell.green : shell.muted }]}>
                  {active ? 'Active now' : since ? `Friends since ${formatConversationTime(since)}` : friend.email || relationStatus}
                </Text>
              </View>
              {friendTab === 'friends' ? (
                <>
                  <Pressable onPress={() => navigation.navigate('ChatRoom', { chatId: id, userName: getUserName(friend), avatar: friend.avatar, user: friend })} style={[styles.friendActionButton, { backgroundColor: shell.blue }]}>
                    <MessageCircle color="#FFFFFF" size={18} />
                  </Pressable>
                  <Pressable disabled={friendActionId === actionId} onPress={() => handleFriendAction('remove', actionId)} style={[styles.friendActionButton, { backgroundColor: shell.soft }]}>
                    <Trash2 color={shell.muted} size={18} />
                  </Pressable>
                </>
              ) : friendTab === 'requests' ? (
                <>
                  <Pressable disabled={friendActionId === actionId} onPress={() => handleFriendAction('accept', actionId)} style={[styles.friendActionButton, { backgroundColor: shell.green }]}>
                    <Check color="#FFFFFF" size={18} />
                  </Pressable>
                  <Pressable disabled={friendActionId === actionId} onPress={() => handleFriendAction('decline', actionId)} style={[styles.friendActionButton, { backgroundColor: shell.soft }]}>
                    <X color={shell.muted} size={18} />
                  </Pressable>
                </>
              ) : (
                <Pressable
                  disabled={friendActionId === actionId || relationStatus !== 'none'}
                  onPress={() => handleFriendAction(relationStatus === 'outgoing' ? 'cancel' : 'request', relationStatus === 'outgoing' ? actionId : id)}
                  style={[styles.addFriendButton, { backgroundColor: relationStatus === 'none' ? shell.blue : shell.soft }]}
                >
                  <Text style={[styles.addFriendText, { color: relationStatus === 'none' ? '#FFFFFF' : shell.muted }]}>
                    {relationStatus === 'none' ? 'Add' : getStatusText(relationStatus)}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}
        {!rows.length ? (
          <View style={[styles.emptyCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
            <Text style={[styles.emptyTitle, { color: shell.text }]}>Nothing here yet</Text>
            <Text style={[styles.emptyCopy, { color: shell.muted }]}>New classmates and requests will appear here.</Text>
          </View>
        ) : null}
      </>
    );
  };

  const renderGames = () => {
    const leaders = snapshot.gameHub?.leaderboard || snapshot.games?.leaderboard || [];
    const average = reactionTimes.length ? Math.round(reactionTimes.reduce((sum, value) => sum + value, 0) / reactionTimes.length) : 0;
    return (
      <>
        <View style={[styles.gamesHero, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <View style={styles.flex}>
            <Text style={[styles.eyebrow, { color: shell.blue }]}>Syncrova arcade</Text>
            <Text style={[styles.marketHeroTitle, { color: shell.text }]}>Game Hub</Text>
            <Text style={[styles.heroCopy, { color: shell.muted }]}>Play native quick games and keep your campus leaderboard progress synced.</Text>
          </View>
          <Trophy color={shell.amber} size={72} />
        </View>
        <View style={[styles.reactionGameCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <View style={styles.verificationHeader}>
            <View>
              <Text style={[styles.gameTitle, { color: shell.text }]}>Reaction Tap</Text>
              <Text style={[styles.gameCopy, { color: shell.muted }]}>5 rounds - submits your average reaction time.</Text>
            </View>
            <Text style={[styles.leaderScore, { color: shell.blue }]}>{average ? `${average}ms` : 'Ready'}</Text>
          </View>
          <Pressable
            onPress={handleReactionTap}
            style={[
              styles.reactionPad,
              {
                backgroundColor: reactionState === 'go' ? shell.green : reactionState === 'ready' ? shell.amber : shell.soft,
                borderColor: reactionState === 'go' ? shell.green : shell.line
              }
            ]}
          >
            <Text style={[styles.reactionPadText, { color: reactionState === 'go' ? '#FFFFFF' : shell.text }]}>
              {reactionState === 'go' ? 'TAP NOW' : reactionState === 'ready' ? 'WAIT...' : reactionState === 'done' ? 'PLAY AGAIN' : 'START'}
            </Text>
            <Text style={[styles.reactionPadSub, { color: reactionState === 'go' ? '#DCFCE7' : shell.muted }]}>
              Round {Math.min(reactionTimes.length + 1, 5)} of 5
            </Text>
          </Pressable>
        </View>
        <SectionHeader title="Game Hub" action="Score routes wired" colors={colors} />
        {quickGamePresets.map((game, index) => (
          <View key={game.key} style={[styles.gameCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
            <View style={[styles.gameIcon, { backgroundColor: [shell.blue, shell.green, shell.amber, shell.rose][index % 4] }]}>
              <Gamepad2 color="#FFFFFF" size={22} />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.gameTitle, { color: shell.text }]}>{game.label}</Text>
              <Text style={[styles.gameCopy, { color: shell.muted }]}>
                Uses the same backend score route as the web game.
              </Text>
            </View>
            <Pressable disabled={gameActionId === game.key} onPress={() => handleQuickGameSubmit(game)} style={[styles.addFriendButton, { backgroundColor: shell.blue }]}>
              {gameActionId === game.key ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={[styles.addFriendText, { color: '#FFFFFF' }]}>Save</Text>}
            </Pressable>
          </View>
        ))}
        <SectionHeader title="Leaderboard" colors={colors} />
        {leaders.slice(0, 5).map((entry, index) => (
          <View key={getEntityId(entry.user) || index} style={[styles.leaderRow, { backgroundColor: shell.card, borderColor: shell.line }]}>
            <Text style={[styles.rank, { color: shell.muted }]}>#{index + 1}</Text>
            <Avatar user={entry.user} size={36} />
            <Text style={[styles.leaderName, { color: shell.text }]}>{getUserName(entry.user)}</Text>
            <Text style={[styles.leaderScore, { color: shell.blue }]}>{entry.score || entry.points || 0}</Text>
          </View>
        ))}
      </>
    );
  };

  const renderMe = () => (
    <>
      <View style={styles.profileTabs}>
        {[
          ['Feed', '3'],
          ['About', '86%'],
          ['Market', String(snapshot.myListings.length)],
          ['Awards', '']
        ].map(([label, count], index) => (
          <View key={label} style={[styles.profileTab, { backgroundColor: index === 0 ? shell.blue : shell.card, borderColor: shell.line }]}>
            <Text style={[styles.profileTabText, { color: index === 0 ? '#FFFFFF' : shell.text }]}>{label}</Text>
            {count ? <Text style={[styles.profileTabCount, { color: index === 0 ? '#DBEAFE' : shell.muted }]}>{count}</Text> : null}
          </View>
        ))}
      </View>
      <View style={[styles.profileHero, { backgroundColor: shell.card, borderColor: shell.line }]}>
        {user?.coverPhoto ? (
          <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: resolveMediaUrl(user.coverPhoto) }} style={styles.profileCover} />
        ) : (
          <View style={[styles.profileCover, { backgroundColor: shell.soft }]} />
        )}
        <View style={styles.profileOverlay} />
        <View style={styles.profileHeroContent}>
          <View style={styles.profileAvatarWrap}>
            <Pressable onPress={handleAvatarUpload}>
              <Avatar user={user} size={86} online />
            </Pressable>
            <Pressable onPress={handleAvatarUpload} style={[styles.storyCamera, { backgroundColor: shell.blue }]}>
              <Camera color="#FFFFFF" size={18} />
            </Pressable>
          </View>
          <View style={styles.flex}>
            <View style={styles.profileBadgeRow}>
              <Text style={styles.profileBadge}>Student profile</Text>
              <Text style={styles.profileBadge}>{user?.isDeveloper ? 'Developer' : 'Verification needed'}</Text>
            </View>
            <Text style={styles.profileHeroName}>{getUserName(user)}</Text>
            <Text style={styles.profileHeroLine}>{user?.email || 'Syncrova account'}</Text>
            <Text style={styles.profileHeroLine}>{user?.course || 'Course not set'}</Text>
            <Text style={styles.profileHeroLine}>{user?.campus || 'Campus not set'}</Text>
          </View>
        </View>
        <Pressable disabled={profileSaving} onPress={handleCoverUpload} style={styles.coverButton}>
          {profileSaving ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Camera color="#FFFFFF" size={16} />}
          <Text style={styles.coverButtonText}>Change cover</Text>
        </Pressable>
        <View style={[styles.profileStats, { backgroundColor: shell.card }]}>
          <View style={styles.profileStat}><Text style={[styles.metricLabel, { color: shell.muted }]}>Member since</Text><Text style={[styles.profileStatValue, { color: shell.text }]}>May 2026</Text></View>
          <View style={styles.profileStat}><Text style={[styles.metricLabel, { color: shell.muted }]}>Current rank</Text><Text style={[styles.profileStatValue, { color: shell.text }]}>Unranked</Text></View>
          <View style={styles.profileStat}><Text style={[styles.metricLabel, { color: shell.muted }]}>Highest rank</Text><Text style={[styles.profileStatValue, { color: shell.green }]}>Unranked</Text></View>
        </View>
      </View>
      <View style={[styles.visibilityCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
        <Text style={[styles.eyebrow, { color: shell.blue }]}>Visibility preview</Text>
        <Text style={[styles.emptyTitle, { color: shell.text }]}>Owner preview</Text>
        <View style={[styles.visibilityTabs, { backgroundColor: shell.soft }]}>
          {['Owner', 'Friend', 'Public'].map((label, index) => (
            <View key={label} style={[styles.visibilityTab, { backgroundColor: index === 0 ? shell.blue : 'transparent' }]}>
              <Text style={[styles.visibilityText, { color: index === 0 ? '#FFFFFF' : shell.muted }]}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={[styles.filterPanel, { backgroundColor: shell.card, borderColor: shell.line }]}>
        <Text style={[styles.sectionTitle, { color: shell.text }]}>Edit profile</Text>
        <TextInput
          onChangeText={text => setProfileDraft(prev => ({ ...prev, name: text }))}
          placeholder="Name"
          placeholderTextColor={shell.muted}
          style={[styles.searchInput, { backgroundColor: shell.soft, color: shell.text }]}
          value={profileDraft.name}
        />
        <TextInput
          onChangeText={text => setProfileDraft(prev => ({ ...prev, course: text }))}
          placeholder="Course"
          placeholderTextColor={shell.muted}
          style={[styles.searchInput, { backgroundColor: shell.soft, color: shell.text }]}
          value={profileDraft.course}
        />
        <TextInput
          onChangeText={text => setProfileDraft(prev => ({ ...prev, campus: text }))}
          placeholder="Campus"
          placeholderTextColor={shell.muted}
          style={[styles.searchInput, { backgroundColor: shell.soft, color: shell.text }]}
          value={profileDraft.campus}
        />
        <TextInput
          multiline
          onChangeText={text => setProfileDraft(prev => ({ ...prev, bio: text }))}
          placeholder="Bio"
          placeholderTextColor={shell.muted}
          style={[styles.postInput, { backgroundColor: shell.soft, color: shell.text, minHeight: 78 }]}
          value={profileDraft.bio}
        />
        <Pressable disabled={profileSaving} onPress={handleProfileSave} style={[styles.searchButton, { backgroundColor: shell.blue }]}>
          {profileSaving ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Check color="#FFFFFF" size={18} />}
          <Text style={styles.searchButtonText}>Save profile</Text>
        </Pressable>
      </View>
      <View style={styles.quickGrid}>
        <Pressable onPress={handleCreateStory} style={[styles.quickCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <Video color={shell.blue} size={26} />
          <Text style={[styles.quickTitle, { color: shell.text }]}>Add My Day</Text>
          <Text style={[styles.quickCopy, { color: shell.muted }]}>{snapshot.storyGroups.length} active stories</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('ChatList')} style={[styles.quickCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <MessageCircle color={shell.blue} size={26} />
          <Text style={[styles.quickTitle, { color: shell.text }]}>Open chats</Text>
          <Text style={[styles.quickCopy, { color: shell.muted }]}>Messages, notes, and calls</Text>
        </Pressable>
        <Pressable onPress={handleReadNotifications} style={[styles.quickCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <Bell color={shell.blue} size={26} />
          <Text style={[styles.quickTitle, { color: shell.text }]}>Activity inbox</Text>
          <Text style={[styles.quickCopy, { color: shell.muted }]}>{snapshot.notifications?.unreadCount || 0} unread activities</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('Settings')} style={[styles.quickCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <Settings color={shell.blue} size={26} />
          <Text style={[styles.quickTitle, { color: shell.text }]}>Settings</Text>
          <Text style={[styles.quickCopy, { color: shell.muted }]}>Privacy and app controls</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => navigation.navigate('Profile')} style={[styles.actionRow, { backgroundColor: shell.card, borderColor: shell.line }]}>
        <UserRound color={shell.blue} size={22} />
        <Text style={[styles.actionText, { color: shell.text }]}>Open profile</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate('Settings')} style={[styles.actionRow, { backgroundColor: shell.card, borderColor: shell.line }]}>
        <Settings color={shell.amber} size={22} />
        <Text style={[styles.actionText, { color: shell.text }]}>Settings</Text>
      </Pressable>
      <Pressable onPress={() => logout()} style={[styles.actionRow, { backgroundColor: shell.card, borderColor: shell.line }]}>
        <UserRound color={colors.danger} size={22} />
        <Text style={[styles.actionText, { color: colors.danger }]}>Sign out</Text>
      </Pressable>
    </>
  );

  const renderBody = () => {
    if (!loaded) {
      return (
        <View style={[styles.loadingCard, { backgroundColor: shell.card, borderColor: shell.line }]}>
          <ActivityIndicator color={shell.blue} />
          <Text style={[styles.loadingText, { color: shell.muted }]}>Opening native Syncrova</Text>
        </View>
      );
    }
    if (activeTab === 'home') return renderHome();
    if (activeTab === 'market') return renderMarket();
    if (activeTab === 'friends') return renderFriends();
    if (activeTab === 'games') return renderGames();
    return renderMe();
  };

  const onTabPress = (key: TabKey) => {
    if (key === 'chats') {
      navigation.navigate('ChatList');
      return;
    }
    setActiveTab(key);
  };

  return (
    <View style={[styles.screen, { backgroundColor: shell.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 104, paddingHorizontal: 16, paddingTop: insets.top + 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={shell.blue} onRefresh={() => loadMain({ showSpinner: true })} />}
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <ExpoImage source={logoSource} style={styles.logo} contentFit="cover" />
            <View style={styles.flex}>
              <Text numberOfLines={1} style={[styles.brandTitle, { color: shell.text }]}>Syncrova</Text>
              <Text numberOfLines={1} style={[styles.brandSubtitle, { color: shell.muted }]}>{getUserName(user)}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={() => {
              if (activeTab === 'market') reloadMarketplace().catch(() => {});
              else loadMain({ showSpinner: true });
            }} style={[styles.iconButton, { backgroundColor: shell.card, borderColor: shell.line }]}>
              <Search color={shell.text} size={21} />
            </Pressable>
            <Pressable onPress={handleReadNotifications} style={[styles.iconButton, { backgroundColor: shell.card, borderColor: shell.line }]}>
              <Bell color={shell.text} size={21} />
              {snapshot.notifications?.unreadCount ? (
                <View style={styles.headerBadge}>
                  <Text style={styles.headerBadgeText}>{Math.min(9, snapshot.notifications.unreadCount)}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </View>
        {renderBody()}
      </ScrollView>

      <View style={[styles.bottomBar, { backgroundColor: '#FFFFFFEE', borderColor: shell.line, paddingBottom: insets.bottom + 8 }]}>
        {tabs.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.key || (tab.key === 'chats' && false);
          return (
            <Pressable key={tab.key} onPress={() => onTabPress(tab.key)} style={[styles.tabButton, active && { backgroundColor: `${shell.blue}1F` }]}>
              <Icon color={active ? shell.blue : shell.muted} size={22} strokeWidth={active ? 2.6 : 2.1} />
              <Text style={[styles.tabLabel, { color: active ? shell.blue : shell.muted }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    padding: 16
  },
  actionText: {
    fontSize: 16,
    fontWeight: '800'
  },
  bottomBar: {
    borderRadius: 28,
    borderWidth: 1,
    bottom: 10,
    flexDirection: 'row',
    gap: 4,
    left: 12,
    paddingHorizontal: 8,
    paddingTop: 8,
    position: 'absolute',
    right: 12
  },
  brandRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minWidth: 0
  },
  brandSubtitle: {
    fontSize: 14,
    fontWeight: '600'
  },
  brandTitle: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0
  },
  composerCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    padding: 14
  },
  composerSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2
  },
  composerText: {
    flex: 1,
    minWidth: 0
  },
  composerTitle: {
    fontSize: 16,
    fontWeight: '900'
  },
  coverButton: {
    alignItems: 'center',
    backgroundColor: '#0B1220AA',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    position: 'absolute',
    right: 16,
    top: 16
  },
  coverButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase'
  },
  emptyCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18
  },
  emptyCopy: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 6
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '900'
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase'
  },
  feedAuthor: {
    fontSize: 15,
    fontWeight: '900'
  },
  feedCard: {
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14
  },
  feedContent: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 21,
    marginTop: 8
  },
  feedHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10
  },
  feedMiniRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 10
  },
  feedMedia: {
    aspectRatio: 1.7,
    borderRadius: 14,
    width: '100%'
  },
  feedMediaWrap: {
    marginTop: 12
  },
  feedMeta: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2
  },
  feedStats: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10
  },
  feedTitle: {
    fontSize: 17,
    fontWeight: '900',
    marginTop: 12
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  gameCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    padding: 14
  },
  gameCopy: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3
  },
  gameIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 46,
    justifyContent: 'center',
    width: 46
  },
  gameTitle: {
    fontSize: 16,
    fontWeight: '900'
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8
  },
  headerBadge: {
    alignItems: 'center',
    backgroundColor: '#EF4444',
    borderRadius: 9,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: -4,
    top: -4,
    width: 18
  },
  headerBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900'
  },
  hero: {
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 12,
    padding: 18
  },
  heroCopy: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 8
  },
  heroText: {
    minWidth: 0
  },
  heroTitle: {
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 4
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  leaderName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    minWidth: 0
  },
  leaderRow: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 12
  },
  leaderScore: {
    fontSize: 14,
    fontWeight: '900'
  },
  loadingCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    justifyContent: 'center',
    marginTop: 36,
    padding: 24
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '700'
  },
  logo: {
    borderRadius: 12,
    height: 54,
    width: 54
  },
  marketBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 2
  },
  marketCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    padding: 10
  },
  marketFallback: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  marketImage: {
    borderRadius: 14,
    height: 74,
    width: 74
  },
  marketMeta: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4
  },
  marketPrice: {
    fontSize: 14,
    fontWeight: '900',
    marginTop: 4
  },
  marketTitle: {
    fontSize: 16,
    fontWeight: '900'
  },
  metricCard: {
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
    padding: 14
  },
  metricGrid: {},
  metricLabel: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4
  },
  metricLine: {
    borderRadius: 2,
    bottom: 0,
    height: 4,
    left: 0,
    position: 'absolute',
    right: 0
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '900'
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12
  },
  miniButton: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  miniButtonText: {
    fontSize: 12,
    fontWeight: '900'
  },
  onlineBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    marginTop: 14,
    paddingHorizontal: 11,
    paddingVertical: 7
  },
  onlineDot: {
    borderRadius: 5,
    height: 10,
    width: 10
  },
  onlineText: {
    fontSize: 12,
    fontWeight: '900'
  },
  personMeta: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2
  },
  personName: {
    fontSize: 16,
    fontWeight: '900'
  },
  personRow: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    padding: 12
  },
  profileCard: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 12,
    padding: 20
  },
  profileMeta: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center'
  },
  profileName: {
    fontSize: 24,
    fontWeight: '900',
    marginTop: 12,
    textAlign: 'center'
  },
  rank: {
    fontSize: 14,
    fontWeight: '900',
    width: 34
  },
  screen: {
    flex: 1
  },
  sectionAction: {
    fontSize: 13,
    fontWeight: '900'
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 14
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900'
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 22,
    flex: 1,
    gap: 3,
    minHeight: 58,
    justifyContent: 'center',
    paddingVertical: 8
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '900'
  },
  addFriendButton: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minWidth: 72,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  addFriendText: {
    fontSize: 13,
    fontWeight: '900'
  },
  addStoryCard: {
    borderRadius: 18,
    borderWidth: 1,
    height: 154,
    overflow: 'hidden',
    width: 116
  },
  addStoryText: {
    fontSize: 15,
    fontWeight: '900',
    paddingHorizontal: 12,
    paddingTop: 14
  },
  commentInput: {
    borderRadius: 18,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  commentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 10
  },
  commentSend: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14
  },
  commentSendText: {
    fontSize: 13,
    fontWeight: '900'
  },
  composerAction: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minWidth: 0
  },
  composerActionText: {
    fontSize: 13,
    fontWeight: '900'
  },
  composerActions: {
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12
  },
  composerMainRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10
  },
  composerPanel: {
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 4,
    padding: 14
  },
  feedAction: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    paddingVertical: 10
  },
  feedActionRow: {
    borderTopWidth: 1,
    flexDirection: 'row',
    marginTop: 10
  },
  feedActionText: {
    fontSize: 14,
    fontWeight: '900'
  },
  feedStatsRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10
  },
  filterChip: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 12
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '900'
  },
  filterPanel: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginBottom: 12,
    padding: 14
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  friendActionButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  friendTab: {
    alignItems: 'center',
    borderRadius: 17,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 9
  },
  friendTabCount: {
    fontSize: 12,
    fontWeight: '900'
  },
  friendTabText: {
    fontSize: 13,
    fontWeight: '900'
  },
  friendTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12
  },
  friendsHero: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    marginBottom: 12,
    padding: 18
  },
  gamesHero: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    marginBottom: 12,
    padding: 18
  },
  marketHero: {
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 14,
    padding: 18
  },
  marketHeroIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 62,
    justifyContent: 'center',
    width: 62
  },
  marketHeroTitle: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 39,
    marginTop: 4
  },
  marketHeroTop: {
    flexDirection: 'row',
    gap: 14
  },
  marketStatsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16
  },
  postButton: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 42,
    minWidth: 64,
    paddingHorizontal: 14
  },
  postButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900'
  },
  postInput: {
    borderRadius: 20,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    maxHeight: 96,
    minHeight: 44,
    paddingHorizontal: 15,
    paddingVertical: 10
  },
  profileAvatarWrap: {
    alignSelf: 'flex-start',
    marginTop: 74
  },
  profileBadge: {
    borderColor: '#FFFFFF66',
    borderRadius: 999,
    borderWidth: 1,
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
    textTransform: 'uppercase'
  },
  profileBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6
  },
  profileCover: {
    height: 330,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  profileHero: {
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 12,
    minHeight: 450,
    overflow: 'hidden'
  },
  profileHeroContent: {
    flexDirection: 'row',
    gap: 16,
    minHeight: 330,
    padding: 20
  },
  profileHeroLine: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 7
  },
  profileHeroName: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 8
  },
  profileOverlay: {
    backgroundColor: '#0F172A88',
    bottom: 120,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  profileStat: {
    alignItems: 'center',
    flex: 1
  },
  profileStatValue: {
    fontSize: 16,
    fontWeight: '900',
    marginTop: 7
  },
  profileStats: {
    bottom: 0,
    flexDirection: 'row',
    left: 0,
    padding: 16,
    position: 'absolute',
    right: 0
  },
  profileTab: {
    alignItems: 'center',
    borderRadius: 17,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 8
  },
  profileTabCount: {
    fontSize: 12,
    fontWeight: '900'
  },
  profileTabText: {
    fontSize: 13,
    fontWeight: '900'
  },
  profileTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12
  },
  quickCard: {
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    minHeight: 132,
    minWidth: '47%',
    padding: 16
  },
  quickCopy: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 7
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12
  },
  quickTitle: {
    fontSize: 16,
    fontWeight: '900',
    marginTop: 20
  },
  reactionCount: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5
  },
  reactionGameCard: {
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16
  },
  reactionPad: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 130
  },
  reactionPadSub: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 6
  },
  reactionPadText: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0
  },
  saveListingButton: {
    alignItems: 'center',
    borderRadius: 15,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  searchButton: {
    alignItems: 'center',
    borderRadius: 15,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44
  },
  searchButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900'
  },
  searchInput: {
    borderRadius: 16,
    fontSize: 16,
    fontWeight: '800',
    minHeight: 48,
    paddingHorizontal: 15
  },
  selectedMediaRow: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  selectedMediaText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    minWidth: 0
  },
  statusPill: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '900'
  },
  storyAvatar: {
    left: 12,
    position: 'absolute',
    top: 12
  },
  storyCamera: {
    alignItems: 'center',
    borderRadius: 16,
    bottom: -4,
    height: 34,
    justifyContent: 'center',
    position: 'absolute',
    right: -4,
    width: 34
  },
  storyCard: {
    borderRadius: 18,
    height: 154,
    overflow: 'hidden',
    width: 116
  },
  storyImage: {
    height: '100%',
    width: '100%'
  },
  storyName: {
    bottom: 12,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    left: 12,
    position: 'absolute',
    right: 12
  },
  storyPreviewSoft: {
    alignItems: 'center',
    height: 96,
    justifyContent: 'center'
  },
  storyRail: {
    marginBottom: 12,
    marginHorizontal: -16,
    paddingLeft: 16
  },
  storyRailContent: {
    gap: 10,
    paddingRight: 16
  },
  verificationBox: {
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 16,
    padding: 14
  },
  verificationCopy: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: 10
  },
  verificationHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between'
  },
  verificationTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '900'
  },
  visibilityCard: {
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 12,
    padding: 18
  },
  visibilityTab: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46
  },
  visibilityTabs: {
    borderRadius: 16,
    flexDirection: 'row',
    marginTop: 14,
    padding: 5
  },
  visibilityText: {
    fontSize: 14,
    fontWeight: '900'
  },
  videoPill: {
    backgroundColor: '#00000099',
    borderRadius: 999,
    bottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    position: 'absolute',
    right: 10
  },
  videoPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900'
  }
});
