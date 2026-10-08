import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Activity,
  Bell,
  Bookmark,
  Bug,
  ChevronRight,
  Download,
  Gamepad2,
  History,
  Image as ImageIcon,
  Info,
  Lock,
  MessageCircle,
  Phone,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  User,
  Video,
  Volume2,
  Zap
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import { RELEASE_VERSION_NAME } from '../generated/releaseInfo';
import { resolveMediaUrl } from '../utils/media';
import { getNotificationPermissionState, requestNotificationPermission } from '../utils/notifications';

const VIDEO_AUTOPLAY_KEY = 'syncrova.home.videoAutoplay';
const MEDIA_QUALITY_KEY = 'syncrova.media.quality';
const PRIVACY_KEY = 'syncrova-profile-privacy';
const STORY_PRIVACY_KEY = 'syncrova-story-privacy';

const getStored = (key, fallback = '') => {
  if (typeof window === 'undefined') return fallback;
  return window.localStorage.getItem(key) ?? fallback;
};

const Section = ({ eyebrow, title, helper, children }) => (
  <section className="settings-section rounded-[1.35rem] border border-slate-200 bg-white/92 p-5 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900/92 dark:shadow-black/25 sm:p-6">
    <div className="mb-5">
      {eyebrow && <p className="text-xs font-black uppercase tracking-wide text-[#0b57d0] dark:text-sky-300">{eyebrow}</p>}
      <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">{title}</h2>
      {helper && <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">{helper}</p>}
    </div>
    <div className="space-y-3.5">{children}</div>
  </section>
);

const ToggleRow = ({ icon: Icon, title, helper, checked, onChange }) => (
  <label className="settings-row flex items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-slate-950/55 dark:ring-slate-800">
    <span className="flex min-w-0 items-center gap-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-blue-50 text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/35 dark:text-sky-200 dark:ring-blue-900/50">
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-black text-slate-950 dark:text-white">{title}</span>
        <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">{helper}</span>
      </span>
    </span>
    <input
      type="checkbox"
      checked={checked}
      onChange={event => onChange(event.target.checked)}
      className="h-5 w-5 shrink-0 accent-[#0b57d0]"
    />
  </label>
);

const SelectRow = ({ icon: Icon, title, helper, value, onChange, options }) => (
  <label className="settings-row grid gap-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-slate-950/55 dark:ring-slate-800 lg:grid-cols-[minmax(16rem,1fr)_minmax(12rem,15rem)] lg:items-center">
    <span className="flex min-w-0 items-center gap-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-blue-50 text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/35 dark:text-sky-200 dark:ring-blue-900/50">
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-black text-slate-950 dark:text-white">{title}</span>
        <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">{helper}</span>
      </span>
    </span>
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-800 outline-none focus:border-[#0b57d0] focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-blue-950/50"
    >
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
);

const LinkRow = ({ icon: Icon, title, helper, to, tone = 'blue' }) => {
  const toneClass = tone === 'rose'
    ? 'bg-rose-50 text-rose-600 ring-rose-100 dark:bg-rose-950/35 dark:text-rose-300 dark:ring-rose-900/45'
    : 'bg-blue-50 text-[#0b57d0] ring-blue-100 dark:bg-blue-950/35 dark:text-sky-200 dark:ring-blue-900/50';
  return (
    <Link
      to={to}
      className="settings-row flex items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md hover:shadow-slate-200/50 dark:bg-slate-950/55 dark:ring-slate-800 dark:hover:bg-slate-900 dark:hover:shadow-black/25"
    >
      <span className="flex min-w-0 items-center gap-4">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ring-1 ${toneClass}`}>
          <Icon size={18} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-black text-slate-950 dark:text-white">{title}</span>
          <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">{helper}</span>
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-slate-400" />
    </Link>
  );
};

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { callHistory, formatCallDuration, getCallStatusLabel } = useCall();
  const navigate = useNavigate();
  const [autoplay, setAutoplay] = useState(() => getStored(VIDEO_AUTOPLAY_KEY, 'false') === 'true');
  const [messageAlerts, setMessageAlerts] = useState(() => getStored('syncrova-dnd', 'false') !== 'true');
  const [profilePrivacy, setProfilePrivacy] = useState(() => getStored(PRIVACY_KEY, 'friends'));
  const [storyPrivacy, setStoryPrivacy] = useState(() => getStored(STORY_PRIVACY_KEY, 'friends'));
  const [mediaQuality, setMediaQuality] = useState(() => getStored(MEDIA_QUALITY_KEY, 'balanced'));
  const [notificationPermission, setNotificationPermission] = useState('prompt');
  const avatarSrc = resolveMediaUrl(user?.avatar);
  const recentCalls = callHistory.slice(0, 4);

  useEffect(() => {
    let mounted = true;
    getNotificationPermissionState().then(state => {
      if (mounted) setNotificationPermission(state);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const updateAutoplay = (enabled) => {
    setAutoplay(enabled);
    localStorage.setItem(VIDEO_AUTOPLAY_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('syncrova:video-autoplay-change', { detail: { enabled } }));
  };

  const updateMessageAlerts = (enabled) => {
    setMessageAlerts(enabled);
    localStorage.setItem('syncrova-dnd', enabled ? 'false' : 'true');
    window.dispatchEvent(new CustomEvent('syncrova:dnd-change', { detail: { enabled: !enabled } }));
    toast.success(enabled ? 'Message alerts enabled' : 'Do not disturb enabled');
  };

  const updateProfilePrivacy = (value) => {
    setProfilePrivacy(value);
    localStorage.setItem(PRIVACY_KEY, value);
  };

  const updateStoryPrivacy = (value) => {
    setStoryPrivacy(value);
    localStorage.setItem(STORY_PRIVACY_KEY, value);
  };

  const updateMediaQuality = (value) => {
    setMediaQuality(value);
    localStorage.setItem(MEDIA_QUALITY_KEY, value);
  };

  const enableNotifications = async () => {
    const state = await requestNotificationPermission();
    setNotificationPermission(state);
    toast[state === 'granted' ? 'success' : 'error'](
      state === 'granted' ? 'Phone notifications enabled' : 'Notifications are blocked in settings'
    );
  };

  const clearCache = () => {
    const keep = new Set(['token', 'user', 'syncrova-call-history', VIDEO_AUTOPLAY_KEY, PRIVACY_KEY, STORY_PRIVACY_KEY, MEDIA_QUALITY_KEY]);
    Object.keys(localStorage).forEach(key => {
      if (!keep.has(key) && key.startsWith('syncrova')) localStorage.removeItem(key);
    });
    toast.success('App cache cleaned');
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mobile-page settings-page mx-auto max-w-7xl space-y-5 px-0 py-1 sm:px-6 sm:py-4 lg:px-8">
      <section className="settings-hero overflow-hidden rounded-[1.45rem] border border-slate-200 bg-white/92 p-5 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900/92 dark:shadow-black/25">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] lg:items-center">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Control center
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-normal text-slate-950 dark:text-white">Settings</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
              Manage your account, privacy, calls, media, notifications, and developer tools in one place.
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-3 rounded-[1.15rem] border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-slate-50 p-4 shadow-sm shadow-blue-200/45 dark:border-blue-900/50 dark:from-blue-950/35 dark:via-slate-950 dark:to-slate-900">
            <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#0b57d0] text-xl font-black text-white">
              {avatarSrc ? <img src={avatarSrc} alt={user?.name || 'Profile'} className="h-full w-full object-cover" /> : user?.name?.charAt(0)?.toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-lg font-black text-slate-950 dark:text-white">{user?.name || 'Syncrova member'}</span>
              <span className="mt-1 block truncate text-sm font-semibold text-slate-500 dark:text-slate-400">{user?.email || 'Account signed in'}</span>
              <span className="mt-2 inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase text-[#0b57d0] ring-1 ring-blue-100 dark:bg-slate-900 dark:text-sky-200 dark:ring-blue-900/50">
                Light interface
              </span>
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
        <div className="space-y-5">
          <Section eyebrow="Support" title="Reports and console tools" helper="Send issues from here so Games stays focused on playing.">
            <LinkRow icon={Bug} title="Submit a Report" helper="Send a private issue or suggestion to the developer" to="/arena?view=report" />
            <LinkRow icon={ShieldCheck} title="Developer Console" helper="Reports, moderation queue, and response threads" to="/developer-console" />
            <LinkRow icon={Gamepad2} title="Games" helper="Open games, ranks, season goals, and leaderboard" to="/arena" />
            <LinkRow icon={Activity} title="App Health" helper="API, socket, storage, calls, and updater diagnostics" to="/app-health" />
          </Section>

          <Section eyebrow="Account" title="Profile and identity" helper="Keep your public account details easy to manage.">
            <LinkRow icon={User} title="Edit profile" helper="Name, course, campus, avatar, and cover photo" to="/profile?tab=about" />
            <SelectRow
              icon={Lock}
              title="Profile visibility"
              helper="Choose who can see your profile details"
              value={profilePrivacy}
              onChange={updateProfilePrivacy}
              options={[
                { value: 'public', label: 'Public' },
                { value: 'friends', label: 'Friends only' },
                { value: 'private', label: 'Only me' }
              ]}
            />
          </Section>

          <Section eyebrow="Social" title="Feed, My Day, and media" helper="Tune the most visible parts of the app.">
            <ToggleRow icon={ImageIcon} title="Post video autoplay" helper="Automatically play visible feed videos" checked={autoplay} onChange={updateAutoplay} />
            <SelectRow
              icon={ImageIcon}
              title="My Day default privacy"
              helper="Default audience when posting a story"
              value={storyPrivacy}
              onChange={updateStoryPrivacy}
              options={[
                { value: 'public', label: 'Public' },
                { value: 'friends', label: 'Friends only' },
                { value: 'private', label: 'Only me' }
              ]}
            />
            <SelectRow
              icon={Zap}
              title="Media upload quality"
              helper="Balanced keeps uploads smooth on mobile"
              value={mediaQuality}
              onChange={updateMediaQuality}
              options={[
                { value: 'balanced', label: 'Balanced' },
                { value: 'high', label: 'High quality' },
                { value: 'original', label: 'Original files' }
              ]}
            />
          </Section>

        </div>

        <div className="space-y-5">
          <Section eyebrow="Library" title="Find and revisit" helper="Fast access to the new search and saved item pages.">
            <LinkRow icon={Search} title="Global Search" helper="Find people, posts, messages, and files" to="/search" />
            <LinkRow icon={Bookmark} title="Saved Items" helper="Saved posts, reels, and pinned messages" to="/saved" />
          </Section>

          <Section eyebrow="Alerts" title="Notifications" helper="Control how Syncrova gets your attention.">
            <ToggleRow icon={Volume2} title="Message alerts" helper={messageAlerts ? 'Popups and sounds are active' : 'Do not disturb is active'} checked={messageAlerts} onChange={updateMessageAlerts} />
            <button
              type="button"
              onClick={enableNotifications}
              className="settings-row flex w-full items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 text-left ring-1 ring-slate-200 transition hover:bg-white dark:bg-slate-950/55 dark:ring-slate-800 dark:hover:bg-slate-900"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-blue-50 text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/35 dark:text-sky-200 dark:ring-blue-900/50">
                  <Bell size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-black text-slate-950 dark:text-white">Phone notifications</span>
                  <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Status: {notificationPermission}</span>
                </span>
              </span>
              <ChevronRight size={18} className="text-slate-400" />
            </button>
            <LinkRow icon={Bell} title="Notification Center" helper="View reactions, replies, invites, and system alerts" to="/notifications" />
          </Section>

          <Section eyebrow="Calls" title="Voice and video" helper="Quick access to chat and relay-sensitive call tools.">
            <LinkRow icon={Phone} title="Call settings" helper="Open Messages and test voice/video behavior" to="/messages" />
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-slate-950/55 dark:ring-slate-800">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
                  <History size={17} className="text-[#0b57d0] dark:text-sky-300" />
                  Call history
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800">
                  {callHistory.length}
                </span>
              </div>
              <div className="space-y-2">
                {recentCalls.length > 0 ? recentCalls.map(entry => {
                  const CallIcon = entry.mode === 'video' ? Video : Phone;
                  return (
                    <div key={entry.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-50 text-[#0b57d0] dark:bg-blue-950/25 dark:text-sky-300">
                        <CallIcon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black text-slate-950 dark:text-white">{entry.partner?.name || 'Syncrova user'}</span>
                        <span className="block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                          {entry.direction === 'incoming' ? 'Incoming' : 'Outgoing'} - {getCallStatusLabel(entry)}
                        </span>
                      </span>
                      {entry.durationSeconds > 0 && (
                        <span className="shrink-0 text-xs font-black text-slate-400">{formatCallDuration(entry.durationSeconds)}</span>
                      )}
                    </div>
                  );
                }) : (
                  <p className="rounded-xl bg-white px-3 py-3 text-sm font-semibold text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-800">
                    Recent calls will appear here after your first voice or video call.
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-slate-950/55 dark:ring-slate-800">
              <p className="text-sm font-black text-slate-950 dark:text-white">Network tip</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
                Calls now stay active through the shared LiveKit room while you move around the app. Keep the LiveKit server keys configured on the backend for reliable voice and video.
              </p>
            </div>
          </Section>

          <Section eyebrow="App" title="Device and about" helper="Install, cache, and release information.">
            <button type="button" onClick={clearCache} className="settings-row flex w-full items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 text-left ring-1 ring-slate-200 transition hover:bg-white dark:bg-slate-950/55 dark:ring-slate-800 dark:hover:bg-slate-900">
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-100 dark:bg-rose-950/35 dark:text-rose-300 dark:ring-rose-900/45">
                  <Trash2 size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-black text-slate-950 dark:text-white">Clear cache</span>
                  <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Clean temporary Syncrova preferences</span>
                </span>
              </span>
            </button>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-950/55 dark:ring-slate-800">
                <Smartphone size={18} className="text-[#0b57d0] dark:text-sky-300" />
                <p className="mt-2 text-sm font-black text-slate-950 dark:text-white">Mobile ready</p>
                <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Fullscreen layout</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-950/55 dark:ring-slate-800">
                <Download size={18} className="text-[#0b57d0] dark:text-sky-300" />
                <p className="mt-2 text-sm font-black text-slate-950 dark:text-white">Updates</p>
                <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">In-app updater</p>
              </div>
            </div>
            <div className="rounded-2xl bg-blue-50 p-3 ring-1 ring-blue-100 dark:bg-blue-950/30 dark:ring-blue-900/45">
              <Info size={18} className="text-[#0b57d0] dark:text-sky-300" />
              <p className="mt-2 text-sm font-black text-slate-950 dark:text-white">Syncrova</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Version {RELEASE_VERSION_NAME} - made by sigmaboyz</p>
            </div>
            <button type="button" onClick={handleLogout} className="w-full rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-white shadow-sm shadow-rose-600/20 transition hover:bg-rose-700">
              Logout
            </button>
          </Section>
        </div>
      </div>
    </div>
  );
}
