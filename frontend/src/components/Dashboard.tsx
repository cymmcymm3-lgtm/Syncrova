// @ts-nocheck
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowRight,
  ChevronRight,
  Loader2,
  Plus,
  PlayCircle,
  PlusCircle,
  RotateCw,
  Send,
  SlidersHorizontal,
  Trophy,
  X
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';
import { optimizeImageFile, resolveMediaUrl, resolveMediaVariantUrl } from '../utils/media';
import { MEDIA_FILTERS, applyImageEdits, getDefaultMediaEdit, getMediaEditPreviewStyle } from '../utils/mediaEditor';
import { formatStoryAge, getStoryListForActiveStory, groupActiveStoriesByOwner } from '../utils/stories';
import { DeveloperAvatarFrame, DeveloperBadge } from './DeveloperIdentity';
import OnboardingTour from './OnboardingTour';
import VideoThumbnail from './VideoThumbnail';
import HomeFeed from './HomeFeed';
import { isNativeMediaLibraryAvailable, nativeMediaAssetToFile } from '../utils/nativeMediaLibrary';
import './dashboard-feed.css';

const NativeMediaLibrarySheet = lazy(() => import('./NativeMediaLibrarySheet'));
const StoryViewer = lazy(() => import('./StoryViewer'));

const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');

const MAX_STORY_MEDIA_SELECTION = 10;
const MAX_STORY_UPLOAD_SIZE = 30 * 1024 * 1024;
const DASHBOARD_RANK_TIMEOUT_MS = 3500;

function DeferredDashboardModuleFallback({ label = 'Opening…' }) {
  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/10 p-4 backdrop-blur-[1px]" role="status" aria-label={label}>
      <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-xs font-black text-slate-700 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900/95 dark:text-slate-100 dark:ring-slate-700">
        <Loader2 size={15} className="animate-spin text-[#0b57d0]" />
        {label}
      </span>
    </div>
  );
}

const compactNumber = (value = 0) => {
  const number = Number(value || 0);
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
  return String(number);
};

const getStoryDraftItems = (draft) => {
  if (!draft) return [];
  if (Array.isArray(draft.items)) return draft.items;
  if (draft.file) {
    return [{
      id: `${draft.file.name}-${draft.file.size}-${draft.file.lastModified || Date.now()}`,
      file: draft.file,
      fileType: draft.fileType,
      previewUrl: draft.previewUrl,
      edit: draft.edit || getDefaultMediaEdit()
    }];
  }
  return [];
};

function Avatar({ user, size = 'h-14 w-14' }) {
  const avatar = resolveMediaUrl(user?.avatar);
  return (
    <span className={`${size} grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#0b57d0] to-[#2387a8] text-lg font-black text-white`}>
      {avatar ? <img src={avatar} alt={user?.name || 'User'} className="h-full w-full object-cover" /> : (user?.name || 'U').charAt(0).toUpperCase()}
    </span>
  );
}

function Panel({ title, helper, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
      <div className="mb-3">
        <h2 className="text-base font-black text-slate-950 dark:text-white">{title}</h2>
        {helper && <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{helper}</p>}
      </div>
      {children}
    </section>
  );
}

function GameLeaderRow({ entry, index }) {
  const user = entry?.user || {};
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/70">
      <span className="w-6 text-center text-sm font-black text-slate-500 dark:text-slate-400">#{index + 1}</span>
      <span className="grid h-14 w-14 shrink-0 place-items-center overflow-visible">
        <GameRankEmblem rank={entry?.stats?.rank} size="sm" animated stars={entry?.stats?.apexStars} />
      </span>
      <Avatar user={user} size="h-9 w-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-slate-950 dark:text-white">{user.name || 'Member'}</p>
        <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
          {entry?.stats?.rank?.shortName || 'Recruit'} - {entry?.stats?.totalPlays || 0} runs
        </p>
      </div>
      <span className="text-sm font-black text-slate-950 dark:text-white">{compactNumber(entry?.stats?.highScore)}</span>
    </div>
  );
}

function HeaderMetric({ icon: Icon, label, value, helper, accent = 'blue' }) {
  const accentClasses = {
    blue: 'bg-blue-50 text-[#0b57d0] ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50',
    teal: 'bg-teal-50 text-teal-700 ring-teal-100 dark:bg-teal-950/30 dark:text-teal-200 dark:ring-teal-900/50',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700'
  };

  return (
    <div className="dashboard-header-metric min-w-0 rounded-2xl border border-slate-200 bg-slate-50/85 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/65">
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ${accentClasses[accent] || accentClasses.blue}`}>
          <Icon size={19} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-1 truncate text-lg font-black text-slate-950 dark:text-white">{value}</p>
          {helper && <p className="mt-0.5 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{helper}</p>}
        </div>
      </div>
    </div>
  );
}

function DashboardWelcomeHeader({ user, now, weather, weatherLoading, gameStats, onProfileClick }) {
  const fullName = user?.name || 'Member';
  const firstName = fullName.split(' ')[0] || fullName;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.replace(/_/g, ' ') || 'Local time';
  const hasTemperature = Number.isFinite(weather?.temperature);
  const weatherValue = hasTemperature
    ? `${Math.round(weather.temperature)}°C`
    : weatherLoading ? 'Updating' : 'Unavailable';
  const weatherHelper = weather && hasTemperature
    ? `${weather.label} - ${weather.locationLabel}`
    : weatherLoading ? 'Checking live weather' : 'Weather will retry on refresh';
  const profileRows = [
    { icon: BookOpen, label: 'Course', value: user?.course || 'Course not set' },
    { icon: Building2, label: 'Campus', value: user?.campus || 'Campus not set' },
    { icon: Trophy, label: 'Rank', value: gameStats?.rank?.name || 'Recruit profile' }
  ];

  return (
    <section className="dashboard-welcome-card overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white/88 p-5 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900/92 dark:shadow-black/25">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:items-stretch">
        <div className="min-w-0 space-y-5">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Dashboard overview
            </div>
            <h1 className="dashboard-welcome-title mt-4 text-2xl font-black tracking-normal text-slate-950 dark:text-white sm:text-3xl">
              Welcome back, {firstName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
              {getGreeting(now)}, {fullName}. Your campus activity, local time, date, and weather are synced in one place.
            </p>
          </div>

          <div className="dashboard-welcome-metrics grid gap-3 sm:grid-cols-3">
            <HeaderMetric
              icon={Clock3}
              label="Local time"
              value={formatTimeWithSeconds(now)}
              helper={timezone}
              accent="blue"
            />
            <HeaderMetric
              icon={CalendarDays}
              label="Date"
              value={formatDateLong(now)}
              helper="Today"
              accent="slate"
            />
            <HeaderMetric
              icon={CloudSun}
              label="Weather"
              value={weatherValue}
              helper={weatherHelper}
              accent="teal"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onProfileClick}
          className="dashboard-profile-snapshot flex min-w-0 flex-col justify-between rounded-[1.15rem] border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-slate-50 p-4 text-left shadow-sm shadow-blue-200/45 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-200/45 dark:border-blue-900/50 dark:from-blue-950/35 dark:via-slate-950 dark:to-slate-900 dark:shadow-black/20"
        >
          <span className="flex min-w-0 items-center gap-3">
            <Avatar user={user} size="h-16 w-16" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-black text-slate-950 dark:text-white">{fullName}</span>
              <span className="mt-1 block truncate text-sm font-semibold text-slate-500 dark:text-slate-400">{user?.email || 'Syncrova member'}</span>
              <span className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-[#0b57d0] ring-1 ring-blue-100 dark:bg-slate-900 dark:text-sky-200 dark:ring-blue-900/50">
                Best {compactNumber(gameStats?.highScore || 0)}
              </span>
            </span>
          </span>

          <span className="mt-4 grid gap-2">
            {profileRows.map(row => {
              const Icon = row.icon;
              return (
                <span key={row.label} className="flex min-w-0 items-center gap-2 rounded-xl bg-white/80 px-3 py-2 ring-1 ring-slate-200/80 dark:bg-slate-900/75 dark:ring-slate-800">
                  <Icon size={15} className="shrink-0 text-[#0b57d0] dark:text-sky-300" />
                  <span className="min-w-0">
                    <span className="block text-[10px] font-black uppercase tracking-wide text-slate-400">{row.label}</span>
                    <span className="block truncate text-sm font-black text-slate-800 dark:text-slate-100">{row.value}</span>
                  </span>
                </span>
              );
            })}
          </span>

          <span className="mt-4 inline-flex items-center justify-between gap-3 rounded-xl bg-[#0b57d0] px-3 py-2 text-sm font-black text-white">
            View profile
            <ArrowRight size={16} />
          </span>
        </button>
      </div>

      {Number.isFinite(weather?.windSpeed) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-950/70">
            <MapPin size={13} />
            {weather.locationLabel}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-950/70">
            <Wind size={13} />
            Wind {Math.round(weather.windSpeed)} km/h
          </span>
        </div>
      )}
    </section>
  );
}

function WelcomeBackPopup({ user, weather, weatherLoading }) {
  const [minimized, setMinimized] = useState(false);
  const [closing, setClosing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const closeTimerRef = useRef(null);
  const quote = useMemo(() => (
    WELCOME_QUOTES[Math.floor(Math.random() * WELCOME_QUOTES.length)] || WELCOME_QUOTES[0]
  ), []);
  const fullName = user?.name || 'Member';
  const firstName = fullName.split(' ')[0] || fullName;
  const hasTemperature = Number.isFinite(weather?.temperature);
  const weatherText = hasTemperature
    ? `${Math.round(weather.temperature)}°C, ${weather.label}`
    : weatherLoading ? 'Checking weather' : 'Weather unavailable';

  const minimizeBrief = () => {
    setClosing(true);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setMinimized(true);
      setClosing(false);
    }, 180);
  };

  useEffect(() => {
    setMinimized(false);
    setClosing(false);
    window.clearTimeout(closeTimerRef.current);
    const timer = window.setTimeout(minimizeBrief, 6500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Only this small popover needs a clock. Keeping the timer here prevents a
  // full dashboard/feed render every second just to update a minute label.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => {
          window.clearTimeout(closeTimerRef.current);
          setClosing(false);
          setMinimized(false);
        }}
        className="dashboard-welcome-mini"
        aria-label="Open welcome update"
      >
        <span>Daily brief</span>
        <CloudSun size={16} />
      </button>
    );
  }

  return (
    <aside className={`dashboard-welcome-popover ${closing ? 'is-exiting' : ''}`} aria-live="polite">
      <div className="dashboard-welcome-popup-card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-wide text-[#0b57d0] dark:text-sky-200">
              {getGreeting(now)}
            </p>
            <h2 className="mt-1 truncate text-lg font-black text-slate-950 dark:text-white">
              Welcome back, {firstName}
            </h2>
            <p className="mt-1 text-sm font-semibold leading-5 text-slate-600 dark:text-slate-300">
              {quote}
            </p>
          </div>
          <button
            type="button"
            onClick={minimizeBrief}
            className="dashboard-welcome-minimize"
            aria-label="Minimize welcome update"
          >
            <X size={16} />
          </button>
        </div>

        <div className="dashboard-welcome-popup-grid">
          <span>
            <Clock3 size={15} />
            {formatTimeShort(now)}
          </span>
          <span>
            <CalendarDays size={15} />
            {formatDateLong(now)}
          </span>
          <span>
            <CloudSun size={15} />
            {weatherText}
          </span>
        </div>
      </div>
    </aside>
  );
}

function DashboardCommandCard({ icon: Icon, label, value, helper, onClick, accent = 'blue' }) {
  const accents = {
    blue: 'bg-blue-50 text-[#0b57d0] ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/50',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/50',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700'
  };
  const Element = onClick ? 'button' : 'div';

  return (
    <Element
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className="dashboard-command-card flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm shadow-slate-200/55 transition hover:border-blue-200 hover:bg-blue-50/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20 dark:hover:border-blue-900/60 dark:hover:bg-blue-950/15"
    >
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 ${accents[accent] || accents.blue}`}>
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
        <span className="mt-1 block truncate text-2xl font-black text-slate-950 dark:text-white">{value}</span>
        {helper && <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{helper}</span>}
      </span>
    </Element>
  );
}

function DashboardRankRow({ entry, index }) {
  const player = entry?.user || {};
  const rank = entry?.stats?.rank || {};
  const rankName = rank.shortName || rank.name || 'Unranked';
  const score = compactNumber(entry?.stats?.highScore || 0);

  return (
    <li className="dashboard-rank-row">
      <span className="dashboard-rank-position" aria-label={`Position ${index + 1}`}>#{index + 1}</span>
      <DeveloperAvatarFrame user={player} className="dashboard-rank-avatar-frame">
        <Avatar user={player} size="h-9 w-9" />
      </DeveloperAvatarFrame>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-sm font-bold text-slate-900 dark:text-white">{player.name || 'Member'}</span>
          <DeveloperBadge user={player} compact />
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{rankName}</span>
      </span>
      <span className="dashboard-rank-score" title={`${entry?.stats?.highScore || 0} best score`}>{score}</span>
    </li>
  );
}

function DashboardRankPanel({ gameStats, leaders, loading, onOpenGameHub }) {
  const currentRank = gameStats?.rank?.shortName || gameStats?.rank?.name || 'Unranked';
  const totalPlays = Number(gameStats?.totalPlays || 0);
  const bestScore = compactNumber(gameStats?.highScore || 0);

  return (
    <aside className="dashboard-rank-panel" aria-label="Player ranks">
      <div className="dashboard-rank-panel-heading">
        <span className="dashboard-rank-panel-icon"><Trophy size={17} /></span>
        <span className="min-w-0 flex-1">
          <h2>Player ranks</h2>
          <p>Top players this season</p>
        </span>
      </div>

      <div className="dashboard-rank-summary">
        <span className="min-w-0">
          <span className="dashboard-rank-summary-label">Your standing</span>
          <strong className="truncate">{currentRank}</strong>
          <small>{totalPlays ? `${totalPlays} ${totalPlays === 1 ? 'run' : 'runs'}` : 'Start a run to rank'}</small>
        </span>
        <span className="dashboard-rank-summary-score">
          <span>Best</span>
          <strong>{bestScore}</strong>
        </span>
      </div>

      <div className="dashboard-rank-list-wrap">
        {loading ? (
          <div className="dashboard-rank-loading space-y-2" role="status" aria-label="Loading player ranks">
            <span className="sr-only">Loading player ranks</span>
            {[0, 1, 2].map(item => (
              <div key={item} className="flex items-center gap-2 rounded-xl bg-slate-100/85 p-2.5 dark:bg-slate-800/75">
                <span className="skeleton-block h-5 w-5 shrink-0 rounded-md bg-slate-200 dark:bg-slate-700" />
                <span className="skeleton-block h-9 w-9 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700" />
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="skeleton-block block h-3 w-3/5 bg-slate-200 dark:bg-slate-700" />
                  <span className="skeleton-block block h-2.5 w-2/5 bg-slate-200 dark:bg-slate-700" />
                </span>
                <span className="skeleton-block h-3 w-8 bg-slate-200 dark:bg-slate-700" />
              </div>
            ))}
          </div>
        ) : leaders?.length ? (
          <ol className="dashboard-rank-list">
            {leaders.slice(0, 5).map((entry, index) => (
              <DashboardRankRow
                key={getEntityId(entry?.user) || `${index}-${entry?.stats?.highScore || ''}`}
                entry={entry}
                index={index}
              />
            ))}
          </ol>
        ) : (
          <p className="dashboard-rank-empty">No ranked runs yet. Your next game can set the first score.</p>
        )}
      </div>

      <button type="button" onClick={onOpenGameHub} className="dashboard-rank-link">
        Open Games
        <ArrowRight size={15} />
      </button>
    </aside>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { stories, storyGroups: presenceStoryGroups } = usePresence();
  const navigate = useNavigate();
  const [gameData, setGameData] = useState(null);
  const [rankLoading, setRankLoading] = useState(true);
  const [activeStory, setActiveStory] = useState(null);
  const [storyUploading, setStoryUploading] = useState(false);
  const [storyDraft, setStoryDraft] = useState(null);
  const [storyMediaLibraryOpen, setStoryMediaLibraryOpen] = useState(false);
  const storyInputRef = useRef(null);
  const storyRailRef = useRef(null);
  const storyDraftRef = useRef(null);

  const currentUserId = getEntityId(user);

  useEffect(() => {
    storyDraftRef.current = storyDraft;
  }, [storyDraft]);

  useEffect(() => () => {
    getStoryDraftItems(storyDraftRef.current).forEach(item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadRanks = async () => {
      if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) {
        setRankLoading(false);
        return;
      }

      setRankLoading(true);
      try {
        const response = await api.get('/games/summary/me', {
          timeout: DASHBOARD_RANK_TIMEOUT_MS,
          signal: controller.signal
        });
        if (!cancelled) setGameData(response.data || null);
      } catch {
        // The feed should remain immediately usable even if ranks are unavailable.
      } finally {
        if (!cancelled) setRankLoading(false);
      }
    };

    loadRanks();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const storyRail = useMemo(() => {
    const groupsSource = presenceStoryGroups?.length ? presenceStoryGroups : groupActiveStoriesByOwner(stories);
    return [...groupsSource]
      .sort((a, b) => {
        const aIsMine = a.ownerId === currentUserId || getEntityId(a.owner) === currentUserId;
        const bIsMine = b.ownerId === currentUserId || getEntityId(b.owner) === currentUserId;
        if (aIsMine === bIsMine) return 0;
        return aIsMine ? -1 : 1;
      })
      .slice(0, 12);
  }, [currentUserId, presenceStoryGroups, stories]);

  const activeStoryList = useMemo(() => (
    getStoryListForActiveStory(storyRail, activeStory)
  ), [activeStory, storyRail]);

  const gameStats = gameData?.stats || gameData?.typingStats;
  const gameLeaders = gameData?.leaderboard || [];

  const openStory = async (story) => {
    setActiveStory(story);
    try {
      const res = await api.post(`/stories/${getEntityId(story)}/view`);
      setActiveStory(prev => getEntityId(prev) === getEntityId(story) ? res.data : prev);
    } catch {
      // Viewing should stay instant even when the counter request fails.
    }
  };

  const syncActiveStory = (updatedStory) => {
    setActiveStory(prev => getEntityId(prev) === getEntityId(updatedStory) ? updatedStory : prev);
    window.dispatchEvent(new CustomEvent('storiesUpdated'));
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
      toast.success('Sent to messages');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Comment failed');
    }
  };

  const deleteStory = async (storyId) => {
    try {
      await api.delete(`/stories/${storyId}`);
      setActiveStory(null);
      window.dispatchEvent(new CustomEvent('storiesUpdated'));
      toast.success('My Day deleted');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Delete failed');
    }
  };

  const openStoryPicker = () => {
    if (isNativeMediaLibraryAvailable()) {
      setStoryMediaLibraryOpen(true);
      return;
    }

    storyInputRef.current?.click();
  };

  const createStoryDraftFromFiles = (incomingFiles = []) => {
    const selectedFiles = Array.from(incomingFiles || []);
    if (!selectedFiles.length || storyUploading) return;

    const files = selectedFiles.slice(0, MAX_STORY_MEDIA_SELECTION);
    if (selectedFiles.length > MAX_STORY_MEDIA_SELECTION) {
      toast.error(`My Day can queue up to ${MAX_STORY_MEDIA_SELECTION} photos or videos`);
    }

    if (files.some(file => !file.type.startsWith('image/') && !file.type.startsWith('video/'))) {
      toast.error('My Day supports photos and videos only');
      return;
    }

    if (files.some(file => file.size > MAX_STORY_UPLOAD_SIZE)) {
      toast.error('My Day upload is too large. Maximum size is 30MB.');
      return;
    }

    setStoryDraft(prev => {
      getStoryDraftItems(prev).forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return {
        items: files.map((file, index) => ({
          id: `${file.name}-${file.size}-${file.lastModified || Date.now()}-${index}`,
          file,
          fileType: file.type.startsWith('video/') ? 'video' : 'image',
          previewUrl: URL.createObjectURL(file),
          edit: getDefaultMediaEdit()
        })),
        activeIndex: 0,
        caption: '',
        privacy: 'public'
      };
    });
  };

  const uploadStoryFromDashboard = (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    createStoryDraftFromFiles(selectedFiles);
  };

  const handleNativeStoryMediaSelect = async (assets = []) => {
    if (!assets.length || storyUploading) return;

    const selectedAssets = assets.slice(0, MAX_STORY_MEDIA_SELECTION);
    const loadingToast = toast.loading('Preparing My Day media...');
    try {
      const files = [];
      for (const asset of selectedAssets) {
        files.push(await nativeMediaAssetToFile(asset));
      }
      createStoryDraftFromFiles(files);
      toast.success('Media ready for My Day', { id: loadingToast });
    } catch (err) {
      toast.error(err?.message || 'Could not prepare selected media', { id: loadingToast });
    }
  };

  const closeStoryDraft = () => {
    setStoryDraft(prev => {
      getStoryDraftItems(prev).forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return null;
    });
  };

  const publishStoryDraft = async () => {
    const draftItems = getStoryDraftItems(storyDraft);
    if (!draftItems.length || storyUploading) return;

    setStoryUploading(true);
    try {
      const createdStories = [];
      for (const item of draftItems) {
        const uploadFile = item.fileType === 'image'
          ? await optimizeImageFile(await applyImageEdits(item.file, item.edit), { maxDimension: 1600, quality: 0.86, minBytes: 600 * 1024 })
          : item.file;
        const formData = new FormData();
        formData.append('media', uploadFile);
        formData.append('privacy', storyDraft.privacy || 'public');
        formData.append('caption', String(storyDraft.caption || '').trim());
        const res = await api.post('/stories', formData);
        createdStories.push(res.data);
      }
      setActiveStory(createdStories[createdStories.length - 1]);
      window.dispatchEvent(new CustomEvent('storiesUpdated'));
      toast.success(draftItems.length > 1 ? `${draftItems.length} My Day updates posted` : 'My Day posted');
      closeStoryDraft();
    } catch (err) {
      toast.error(err.response?.data?.msg || 'My Day upload failed');
    } finally {
      setStoryUploading(false);
    }
  };

  const updateStoryDraftItem = (itemId, changes) => {
    setStoryDraft(prev => {
      const items = getStoryDraftItems(prev);
      if (!items.length) return prev;
      return {
        ...prev,
        items: items.map(item => (
          item.id === itemId
            ? { ...item, edit: { ...getDefaultMediaEdit(), ...(item.edit || {}), ...changes } }
            : item
        ))
      };
    });
  };

  const removeStoryDraftItem = (itemId) => {
    setStoryDraft(prev => {
      const items = getStoryDraftItems(prev);
      const itemToRemove = items.find(item => item.id === itemId);
      if (itemToRemove?.previewUrl) URL.revokeObjectURL(itemToRemove.previewUrl);
      const nextItems = items.filter(item => item.id !== itemId);
      if (!nextItems.length) return null;
      const activeIndex = Math.min(prev.activeIndex || 0, nextItems.length - 1);
      return { ...prev, items: nextItems, activeIndex };
    });
  };

  const scrollStoryRail = () => {
    storyRailRef.current?.scrollBy({ left: 340, behavior: 'smooth' });
  };

  const userAvatarUrl = resolveMediaUrl(user?.avatar);

  const renderStoryPanel = ({ mobile = false } = {}) => (
  <section className={`dashboard-story-panel ${mobile ? 'dashboard-story-panel--fb-mobile dashboard-story-panel--fb-copy' : ''} ${mobile && storyRail.length === 0 ? 'dashboard-story-panel--sparse' : ''} rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20`}>
    {!mobile && (
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-950 dark:text-white">Today at Syncrova</h1>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Stories, posts, active friends, and ranks.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="inline-flex items-center gap-2 rounded-xl bg-[#07036f] px-3 py-2 text-xs font-black text-white transition hover:bg-[#05004f]"
        >
          <PlusCircle size={15} />
          Add stories
        </button>
      </div>
    )}

    {mobile && (
      <>
        <div className="dashboard-mobile-story-heading mb-3">
          <p className="text-base font-black text-slate-950 dark:text-white">Stories</p>
        </div>

        <div className="dashboard-story-rail-shell group/rail relative">
          <div
            ref={storyRailRef}
            className="dashboard-story-rail flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* ===== CREATE STORY CARD - FACEBOOK / META STYLE ===== */}
            <button
              type="button"
              onClick={openStoryPicker}
              disabled={storyUploading}
              className="dashboard-create-story-tile group relative aspect-[2/3] h-[13rem] w-[8rem] shrink-0 overflow-hidden rounded-2xl shadow-lg ring-1 ring-gray-200 transition active:scale-[0.97] disabled:opacity-70 dark:ring-slate-700"
            >
              {/* Top: profile picture as background */}
              <div className="dashboard-create-story-cover absolute inset-x-0 top-0 h-[68%] overflow-hidden bg-blue-100">
                <div className="dashboard-create-story-fallback flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-500 to-blue-700 text-3xl font-black text-white">
                  {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                </div>
                {userAvatarUrl && (
                  <img
                    src={userAvatarUrl}
                    alt="Your story background"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    onError={(event) => { event.currentTarget.style.display = 'none'; }}
                  />
                )}
              </div>

              {/* Bottom label area keeps the create-story action readable. */}
              <div className="dashboard-create-story-caption-surface absolute inset-x-0 bottom-0 h-[32%] bg-white dark:bg-ui-elevated" />

              {/* Plus badge straddling the divider */}
              <div className="dashboard-create-story-plus-wrap absolute bottom-[26%] left-1/2 -translate-x-1/2">
                <div
                  className="dashboard-create-story-plus grid h-9 w-9 place-items-center rounded-full bg-ui-accent text-white shadow-md ring-4 ring-white dark:ring-ui-elevated"
                >
                  {storyUploading ? (
                    <Loader2 size={16} className="animate-spin text-white" />
                  ) : (
                    <Plus size={16} strokeWidth={3} className="text-white" />
                  )}
                </div>
              </div>

              {/* Create story text */}
              <span className="dashboard-create-story-text absolute inset-x-0 bottom-2.5 text-center text-[13px] font-black text-slate-900 dark:text-white">
                Create story
              </span>
            </button>

            {/* ===== USERS' STORIES ===== */}
            {storyRail.map(group => {
              const story = group.preview;
              const owner = group.owner || story.userId || {};
              const storyUrl = story.fileType === 'image'
                ? resolveMediaVariantUrl(story, ['thumb', 'feed', 'large'])
                : resolveMediaUrl(story.fileUrl);
              const seen = group.seen;
              const ownerAvatar = resolveMediaUrl(owner.avatar);
              return (
                <button
                  key={group.ownerId}
                  type="button"
                  onClick={() => openStory(story)}
                  className={`dashboard-story-tile group relative aspect-[2/3] h-[13rem] w-[8rem] shrink-0 overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-black/5 transition active:scale-[0.97] ${seen ? 'is-seen' : 'is-new'}`}
                >
                  <div className="dashboard-story-media absolute inset-0">
                    {story.fileType === 'image' ? (
                      <img
                        src={storyUrl}
                        alt={owner.name || 'Story'}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <VideoThumbnail src={storyUrl} className="h-full w-full" iconSize={28} label={`${owner.name || 'Member'} story video`} />
                    )}
                  </div>

                  <div className="dashboard-story-overlay absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/10" />

                  <div className="dashboard-story-avatar-frame absolute left-2.5 top-2.5">
                    <div className={`rounded-full p-[3px] ${seen ? 'bg-white/50' : 'bg-gradient-to-r from-[#b721ff] to-[#21d4fd]'}`}>
                      <div className="h-9 w-9 overflow-hidden rounded-full border-[2px] border-white bg-slate-300">
                        {ownerAvatar ? (
                          <img src={ownerAvatar} alt={owner.name || 'User'} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0866ff] to-[#2387a8] text-base font-black text-white">
                            {owner.name?.charAt(0)?.toUpperCase() || 'U'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <span className="dashboard-story-name absolute inset-x-2 bottom-2 truncate text-left text-[13px] font-semibold text-white drop-shadow">
                    {owner.name || 'Member'}
                  </span>

                  {group.count > 1 && (
                    <span className="dashboard-story-count absolute right-2 top-2 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-black text-white">
                      {group.count}
                    </span>
                  )}

                  {story.fileType === 'video' && (
                    <span className="dashboard-story-video-icon absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                      <PlayCircle size={30} className="text-white drop-shadow-lg" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {storyRail.length > 3 && (
            <button
              type="button"
              className="dashboard-story-scroll-button absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/95 opacity-0 shadow-md ring-1 ring-slate-200 transition group-hover/rail:opacity-100 dark:bg-slate-800 dark:ring-slate-700"
              onClick={scrollStoryRail}
              aria-label="Scroll stories"
            >
              <ChevronRight size={18} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </>
    )}
    {mobile && (
      <input
        ref={storyInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={uploadStoryFromDashboard}
      />
    )}
  </section>
);

  const storyDraftItems = getStoryDraftItems(storyDraft);
  const activeStoryDraftIndex = Math.min(storyDraft?.activeIndex || 0, Math.max(0, storyDraftItems.length - 1));
  const activeStoryDraftItem = storyDraftItems[activeStoryDraftIndex] || null;

  return (
    <div className="mobile-page dashboard-page mx-auto w-full max-w-none px-0 py-0">
      <div className="dashboard-social-layout">
        <div className="dashboard-feed-column">
          <div className="dashboard-facebook-mobile dashboard-facebook-mobile--unified">
            <HomeFeed
              currentUser={user}
              mobileVariant="facebook"
              mobileTopSlot={renderStoryPanel({ mobile: true })}
            />
          </div>
        </div>

        <DashboardRankPanel
          gameStats={gameStats}
          leaders={gameLeaders}
          loading={rankLoading}
          onOpenGameHub={() => navigate('/arena')}
        />
      </div>

      {storyMediaLibraryOpen && (
        <Suspense fallback={<DeferredDashboardModuleFallback label="Opening media library…" />}>
          <NativeMediaLibrarySheet
            open={storyMediaLibraryOpen}
            initialFilter="all"
            maxSelection={MAX_STORY_MEDIA_SELECTION}
            existingCount={0}
            title="Create story"
            confirmLabel="Add"
            onClose={() => setStoryMediaLibraryOpen(false)}
            onSelect={handleNativeStoryMediaSelect}
          />
        </Suspense>
      )}

      {storyDraft && typeof document !== 'undefined' && createPortal(
        <div className="story-draft-overlay" onClick={closeStoryDraft}>
          <section className="story-draft-sheet" onClick={event => event.stopPropagation()} aria-label="Create story">
<div className="story-draft-side flex w-[22rem] shrink-0 flex-col overflow-y-auto border-r border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
              <header className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
                <div className="min-w-0">
                  <p className="text-base font-black text-slate-950">Create story</p>
                  <p className="text-xs font-semibold text-slate-500">
                    {storyDraftItems.length}/{MAX_STORY_MEDIA_SELECTION} selected - preview before posting
                  </p>
                </div>
                <button type="button" onClick={closeStoryDraft} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200" aria-label="Close story editor">
                  <X size={18} />
                </button>
              </header>
              <div className="flex-1 space-y-3 p-4">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-900/40 dark:bg-blue-950/30">
                  <div className="mb-2 inline-flex items-center gap-2 text-xs font-black uppercase text-[#0b57d0]">
                    <SlidersHorizontal size={14} />
                    Syncrova media tray
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {storyDraftItems.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setStoryDraft(prev => ({ ...prev, activeIndex: index }))}
                        className={`relative h-16 w-12 shrink-0 overflow-hidden rounded-xl bg-slate-950 ring-2 ${
                          activeStoryDraftIndex === index ? 'ring-[#0b57d0]' : 'ring-white'
                        }`}
                        aria-label={`Preview media ${index + 1}`}
                      >
                        {item.fileType === 'video' ? (
                          <VideoThumbnail src={item.previewUrl} className="h-full w-full" iconSize={14} label="Story video thumbnail" />
                        ) : (
                          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" style={getMediaEditPreviewStyle(item.edit)} />
                        )}
                        <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-black text-white">{index + 1}</span>
                      </button>
                    ))}
                  </div>
                </div>
{activeStoryDraftItem?.fileType === 'image' ? (
                  <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => updateStoryDraftItem(activeStoryDraftItem.id, { rotate: ((activeStoryDraftItem.edit?.rotate || 0) + 90) % 360 })}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200"
                      >
                        <RotateCw size={14} />
                        Rotate
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStoryDraftItem(activeStoryDraftItem.id, { flipX: !activeStoryDraftItem.edit?.flipX })}
                        className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200"
                      >
                        Flip
                      </button>
                      {storyDraftItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStoryDraftItem(activeStoryDraftItem.id)}
                          className="rounded-xl bg-white px-3 py-2 text-xs font-black text-rose-600 ring-1 ring-rose-100"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1 overflow-x-auto pb-0.5">
                      {MEDIA_FILTERS.map(filter => (
                        <button
                          key={filter.id}
                          type="button"
                          onClick={() => updateStoryDraftItem(activeStoryDraftItem.id, { filter: filter.id })}
                          className={`shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-black ${
                            (activeStoryDraftItem.edit?.filter || 'original') === filter.id
                              ? 'bg-[#0b57d0] text-white'
                              : 'bg-white text-slate-600 ring-1 ring-slate-200'
                          }`}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
<div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                    Video selected. You can preview it here; trim/crop can be added in a later native editor pass.
                  </div>
                )}
                <label className="block text-xs font-black uppercase text-slate-500">
                  Caption
<textarea
                    value={storyDraft.caption}
                    onChange={event => setStoryDraft(prev => ({ ...prev, caption: event.target.value }))}
                    rows={4}
                    maxLength={160}
                    placeholder="Add a short caption..."
                    className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold normal-case text-slate-900 outline-none focus:border-[#0b57d0] focus:bg-white dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900"
                  />
                </label>
                <label className="block text-xs font-black uppercase text-slate-500">
                  Privacy
<select
                    value={storyDraft.privacy}
                    onChange={event => setStoryDraft(prev => ({ ...prev, privacy: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-black normal-case text-slate-900 outline-none focus:border-[#0b57d0] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="public">Public</option>
                    <option value="friends">Friends</option>
                    <option value="private">Only me</option>
                  </select>
                </label>
              </div>
<div className="border-t border-slate-100 p-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={publishStoryDraft}
                  disabled={storyUploading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#07036f] px-4 py-3 text-sm font-black text-white disabled:opacity-60"
                >
                  {storyUploading ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                  {storyDraftItems.length > 1 ? `Post ${storyDraftItems.length} stories` : 'Post story'}
                </button>
              </div>
            </div>
<div className="story-draft-stage flex flex-1 items-center justify-center bg-slate-100 p-6 dark:bg-slate-950/60">
              <div className="story-draft-preview aspect-[9/16] h-full max-h-full w-auto max-w-full">
                {activeStoryDraftItem?.fileType === 'video' ? (
                  <video src={activeStoryDraftItem.previewUrl} controls playsInline className="h-full w-full rounded-2xl bg-black object-contain" />
                ) : (
                  <img
                    src={activeStoryDraftItem?.previewUrl}
                    alt="Story preview"
                    className="h-full w-full rounded-2xl bg-black object-contain transition"
                    style={getMediaEditPreviewStyle(activeStoryDraftItem?.edit)}
                  />
                )}
              </div>
            </div>
          </section>
        </div>,
        document.body
      )}

      {activeStory && (
        <Suspense fallback={<DeferredDashboardModuleFallback label="Opening story…" />}>
          <StoryViewer
            story={activeStory}
            stories={activeStoryList}
            currentUser={user}
            onClose={() => setActiveStory(null)}
            onNavigate={openStory}
            onReact={reactToStory}
            onComment={commentOnStory}
            onDelete={deleteStory}
          />
        </Suspense>
      )}
      <OnboardingTour user={user} />
    </div>
  );
}
