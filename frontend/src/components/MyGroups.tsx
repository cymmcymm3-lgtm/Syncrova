import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  ArrowRight,
  Bell,
  Calendar,
  Check,
  Clock3,
  Copy,
  Crown,
  FolderKanban,
  Image as ImageIcon,
  KeyRound,
  ListFilter,
  Loader2,
  LogOut,
  MailCheck,
  PlusCircle,
  RefreshCw,
  Search,
  SortAsc,
  Users,
  X
} from 'lucide-react';
import api from '../services/api';
import LoadingSpinner from './LoadingSpinner';
import { useAuth } from '../context/AuthContext';
import { resolveMediaUrl } from '../utils/media';
import CreateGroupModal from './CreateGroupModal';

const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');

const getInitial = (value) => String(value || '?').charAt(0).toUpperCase();

const getGroupAccent = (value = '') => {
  const colors = ['#0b57d0', '#0f766e', '#16a34a', '#f59e0b', '#475569', '#7c3aed'];
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
  }
  return colors[Math.abs(hash) % colors.length];
};

const formatDate = (value) => {
  if (!value) return 'Recently created';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently created';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatWorkspaceTime = (value) => value.toLocaleTimeString(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

const formatWorkspaceDate = (value) => value.toLocaleDateString(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

const getMemberName = (member) => (
  member?.name || member?.user?.name || member?.email || member?.user?.email || 'Member'
);

const getMemberAvatar = (member) => resolveMediaUrl(member?.avatar || member?.user?.avatar);

const MemberStack = ({ members = [] }) => (
  <div className="flex -space-x-2">
    {members.slice(0, 4).map(member => {
      const name = getMemberName(member);
      const avatar = getMemberAvatar(member);
      return (
        <div
          key={getEntityId(member)}
          className="grid h-8 w-8 place-items-center overflow-hidden rounded-full border-2 border-white bg-slate-900 text-xs font-black text-white dark:border-slate-900 dark:bg-slate-700"
          title={name}
        >
          {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : getInitial(name)}
        </div>
      );
    })}
    {members.length > 4 && (
      <div className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-slate-100 text-xs font-black text-slate-600 dark:border-slate-900 dark:bg-slate-800 dark:text-slate-300">
        +{members.length - 4}
      </div>
    )}
  </div>
);

const toneClasses = {
  blue: 'bg-blue-50 text-[#0b57d0] ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
};

const StatCard = ({ icon: Icon, label, value, helper, tone = 'blue' }) => (
  <div className="workspace-stat-card rounded-[1.1rem] border border-slate-200 bg-white/90 p-4 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-black text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{value}</p>
        <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{helper}</p>
      </div>
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 ${toneClasses[tone] || toneClasses.blue}`}>
        <Icon size={21} />
      </div>
    </div>
  </div>
);

const EmptyWorkspacePanel = ({ onCreate }) => (
  <div className="rounded-[1.1rem] border border-dashed border-slate-300 bg-white/90 p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-[#0b57d0] dark:bg-blue-950/30 dark:text-sky-200">
      <FolderKanban size={26} />
    </div>
    <h3 className="mt-4 text-lg font-black text-slate-950 dark:text-white">No workspaces found</h3>
    <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
      Create a workspace or join one with an access code to start collaborating.
    </p>
    <button
      type="button"
      onClick={onCreate}
      className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-[#07036f] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#05004f]"
    >
      <PlusCircle size={17} />
      Create workspace
    </button>
  </div>
);

export default function MyGroups() {
  const [groups, setGroups] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [respondingInviteIds, setRespondingInviteIds] = useState({});
  const [copiedCode, setCopiedCode] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const [groupsRes, invitesRes] = await Promise.all([
        api.get('/groups'),
        api.get('/groups/invites/me').catch(() => ({ data: [] }))
      ]);
      setGroups(groupsRes.data || []);
      setInvites(invitesRes.data || []);
      window.dispatchEvent(new Event('groupsUpdated'));
    } catch (err) {
      toast.error('Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refresh = () => fetchGroups();
    window.addEventListener('syncrova:mobile-refresh', refresh);
    return () => window.removeEventListener('syncrova:mobile-refresh', refresh);
  }, []);

  const createGroup = async (name, description) => {
    if (!name.trim()) {
      toast.error('Workspace name is required');
      return false;
    }

    try {
      await api.post('/groups', { name, description });
      toast.success('Workspace created');
      await fetchGroups();
      return true;
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to create workspace');
      return false;
    }
  };

  const joinGroup = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      toast.error('Please enter an access code');
      return;
    }

    setJoining(true);
    try {
      await api.post('/groups/join', { joinCode: code });
      toast.success('Joined workspace');
      setJoinCode('');
      await fetchGroups();
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Invalid access code');
    } finally {
      setJoining(false);
    }
  };

  const respondToInvite = async (inviteId, action) => {
    setRespondingInviteIds(prev => ({ ...prev, [inviteId]: true }));
    try {
      await api.put(`/groups/invites/${inviteId}/respond`, { action });
      toast.success(action === 'accept' ? 'Joined workspace' : 'Invitation declined');
      await fetchGroups();
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to update invitation');
    } finally {
      setRespondingInviteIds(prev => {
        const next = { ...prev };
        delete next[inviteId];
        return next;
      });
    }
  };

  const leaveGroup = async (groupId, groupName) => {
    if (!window.confirm(`Leave workspace "${groupName}"? You can rejoin with the access code.`)) return;

    try {
      await api.delete(`/groups/${groupId}/leave`);
      toast.success(`Left ${groupName}`);
      fetchGroups();
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to leave workspace');
    }
  };

  const copyJoinCode = async (code, event) => {
    event.stopPropagation();
    if (!code) {
      toast.error('No access code available');
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      toast.success('Access code copied');
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      toast.error('Could not copy code');
    }
  };

  const currentUserId = getEntityId(user);
  const totalMembers = groups.reduce((sum, group) => sum + (group.members?.length || 0), 0);
  const createdCount = groups.filter(group => getEntityId(group.creator) === currentUserId).length;
  const joinedCount = Math.max(groups.length - createdCount, 0);
  const fullName = user?.name || 'Member';
  const firstName = fullName.split(' ')[0] || fullName;
  const avatarSrc = resolveMediaUrl(user?.avatar);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.replace(/_/g, ' ') || 'Local time';
  const recentGroups = [...groups]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
    .slice(0, 3);

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();

    return groups
      .filter(group => {
        const isCreator = getEntityId(group.creator) === currentUserId;
        const filterMatch = filter === 'all' || (filter === 'owned' ? isCreator : !isCreator);
        const searchMatch = !query
          || group.name?.toLowerCase().includes(query)
          || group.description?.toLowerCase().includes(query)
          || group.subject?.toLowerCase().includes(query)
          || group.joinCode?.toLowerCase().includes(query);
        return filterMatch && searchMatch;
      })
      .sort((a, b) => {
        if (sort === 'name') return (a.name || '').localeCompare(b.name || '');
        if (sort === 'members') return (b.members?.length || 0) - (a.members?.length || 0);
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });
  }, [currentUserId, filter, groups, search, sort]);

  if (loading) {
    return (
      <div className="mobile-page mobile-workspaces-page mx-auto max-w-7xl px-0 py-1 sm:px-6 sm:py-4 lg:px-8">
        <LoadingSpinner label="Loading workspaces" />
      </div>
    );
  }

  return (
    <div className="mobile-page mobile-workspaces-page mx-auto max-w-7xl space-y-4 px-0 py-1 sm:px-6 sm:py-4 lg:px-8">
      <section className="workspace-welcome-card overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white/92 p-5 shadow-sm shadow-slate-200/55 dark:border-slate-800 dark:bg-slate-900/92 dark:shadow-black/25">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] lg:items-stretch">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Workspace overview
            </div>
            <h1 className="mt-4 text-2xl font-black tracking-normal text-slate-950 dark:text-white sm:text-3xl">
              Welcome back, {firstName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
              Review your team spaces, invitations, project members, and access codes from one clean workspace hub.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/55">
                <Clock3 size={18} className="text-[#0b57d0] dark:text-sky-300" />
                <p className="mt-2 text-[11px] font-black uppercase tracking-wide text-slate-400">Local time</p>
                <p className="truncate text-base font-black text-slate-950 dark:text-white">{formatWorkspaceTime(now)}</p>
                <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{timezone}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/55">
                <Calendar size={18} className="text-[#0b57d0] dark:text-sky-300" />
                <p className="mt-2 text-[11px] font-black uppercase tracking-wide text-slate-400">Date</p>
                <p className="truncate text-base font-black text-slate-950 dark:text-white">{formatWorkspaceDate(now)}</p>
                <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">Today</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/55">
                <FolderKanban size={18} className="text-[#0b57d0] dark:text-sky-300" />
                <p className="mt-2 text-[11px] font-black uppercase tracking-wide text-slate-400">Active rooms</p>
                <p className="truncate text-base font-black text-slate-950 dark:text-white">{groups.length} workspaces</p>
                <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{totalMembers} members reached</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="flex min-w-0 flex-col justify-between rounded-[1.15rem] border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-slate-50 p-4 text-left shadow-sm shadow-blue-200/45 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-200/45 dark:border-blue-900/50 dark:from-blue-950/35 dark:via-slate-950 dark:to-slate-900 dark:shadow-black/20"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#0b57d0] to-[#2387a8] text-xl font-black text-white ring-2 ring-white shadow-sm dark:ring-slate-900">
                {avatarSrc ? <img src={avatarSrc} alt={fullName} className="h-full w-full object-cover" /> : getInitial(fullName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-black text-slate-950 dark:text-white">{fullName}</span>
                <span className="mt-1 block truncate text-sm font-semibold text-slate-500 dark:text-slate-400">{user?.email || 'Syncrova member'}</span>
                <span className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-[#0b57d0] ring-1 ring-blue-100 dark:bg-slate-900 dark:text-sky-200 dark:ring-blue-900/50">
                  {createdCount} owned spaces
                </span>
              </span>
            </span>
            <span className="mt-4 inline-flex items-center justify-between gap-3 rounded-xl bg-[#07036f] px-3 py-2 text-sm font-black text-white">
              View profile
              <ArrowRight size={16} />
            </span>
          </button>
        </div>
      </section>

      <section className="rounded-[1.35rem] border border-slate-200 bg-white/90 p-5 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-black uppercase text-[#0b57d0] dark:text-sky-300">Workspaces</p>
            <h1 className="mt-1 text-3xl font-black tracking-normal text-slate-950 dark:text-white">Team spaces</h1>
            <p className="mt-1 max-w-2xl text-sm font-semibold text-slate-500 dark:text-slate-400">
              Manage project rooms, members, invitations, files, chat, and shared work.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={fetchGroups}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw size={17} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#07036f] px-4 py-2.5 text-sm font-black text-white shadow-sm shadow-[#07036f]/15 transition hover:bg-[#05004f]"
            >
              <PlusCircle size={17} />
              Create
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard icon={FolderKanban} label="Total Workspaces" value={groups.length} helper="Active project rooms" />
        <StatCard icon={Crown} label="Owned by You" value={createdCount} helper="Created under your account" tone="amber" />
        <StatCard icon={Users} label="Members Reached" value={totalMembers} helper={`${joinedCount} joined as member`} tone="emerald" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)]">
        <div className="rounded-[1.1rem] border border-slate-200 bg-white/90 p-4 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">Workspace command center</p>
              <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">Recent team activity</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm font-black text-[#0b57d0] ring-1 ring-blue-100 transition hover:bg-blue-100 dark:bg-blue-950/30 dark:text-sky-200 dark:ring-blue-900/50"
            >
              <PlusCircle size={16} />
              New space
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {recentGroups.length ? recentGroups.map(group => {
              const accent = getGroupAccent(group.name);
              return (
                <button
                  key={getEntityId(group)}
                  type="button"
                  onClick={() => navigate(`/group/${getEntityId(group)}`)}
                  className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md dark:border-slate-800 dark:bg-slate-950/55 dark:hover:bg-slate-900"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: accent }} />
                    <span className="truncate text-sm font-black text-slate-950 dark:text-white">{group.name}</span>
                  </span>
                  <p className="mt-2 line-clamp-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{group.description || 'No description yet'}</p>
                  <p className="mt-3 text-[11px] font-black uppercase text-slate-400">{group.members?.length || 0} members - {formatDate(group.updatedAt || group.createdAt)}</p>
                </button>
              );
            }) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950/55 dark:text-slate-400 md:col-span-3">
                Create your first workspace to unlock team activity.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[1.1rem] border border-slate-200 bg-gradient-to-br from-blue-50 via-white to-slate-50 p-4 shadow-sm shadow-blue-200/45 dark:border-blue-900/50 dark:from-blue-950/30 dark:via-slate-950 dark:to-slate-900 dark:shadow-black/20">
          <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">Next best action</p>
          <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">
            {invites.length ? 'Review workspace invites' : 'Keep your teams moving'}
          </h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
            {invites.length
              ? `${invites.length} invitation${invites.length === 1 ? '' : 's'} waiting for your response.`
              : 'Open a workspace, share the access code, or create a new project room for your next task.'}
          </p>
          <button
            type="button"
            onClick={invites.length ? () => window.scrollTo({ top: 0, behavior: 'smooth' }) : () => setShowCreate(true)}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-[#07036f] px-4 py-2.5 text-sm font-black text-white shadow-sm shadow-[#07036f]/15 transition hover:bg-[#05004f]"
          >
            {invites.length ? <Bell size={16} /> : <PlusCircle size={16} />}
            {invites.length ? 'Check invites' : 'Create workspace'}
          </button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]">
        <div className="mobile-filter-dock workspace-toolbar rounded-[1.1rem] border border-slate-200 bg-white/90 p-4 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_170px_160px]">
            <label className="relative">
              <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search by name, code, or description"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-[#0b57d0] focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950/50"
              />
            </label>
            <label className="relative">
              <ListFilter size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                value={filter}
                onChange={event => setFilter(event.target.value)}
                className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-[#0b57d0] focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950/50"
              >
                <option value="all">All workspaces</option>
                <option value="owned">Owned by me</option>
                <option value="joined">Joined</option>
              </select>
            </label>
            <label className="relative">
              <SortAsc size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                value={sort}
                onChange={event => setSort(event.target.value)}
                className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-[#0b57d0] focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950/50"
              >
                <option value="recent">Newest</option>
                <option value="name">Name</option>
                <option value="members">Members</option>
              </select>
            </label>
          </div>
        </div>

        <div className="rounded-[1.1rem] border border-slate-200 bg-white/90 p-4 shadow-sm shadow-slate-200/45 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
          <label className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">
            <KeyRound size={14} className="text-[#0b57d0] dark:text-sky-300" />
            Join with access code
          </label>
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
            <input
              value={joinCode}
              onChange={event => setJoinCode(event.target.value.toUpperCase())}
              onKeyDown={event => {
                if (event.key === 'Enter') joinGroup();
              }}
              placeholder="Example: A1B2C3"
              className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-black uppercase tracking-wide text-slate-900 outline-none transition placeholder:normal-case placeholder:font-medium placeholder:tracking-normal placeholder:text-slate-400 focus:border-[#0b57d0] focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950/50"
            />
            <button
              type="button"
              onClick={joinGroup}
              disabled={joining}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-[#07036f] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              {joining ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}
              Join
            </button>
          </div>
        </div>
      </section>

      <AnimatePresence>
        {invites.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-[1.1rem] border border-blue-100 bg-blue-50/70 p-4 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/20"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Bell size={18} className="text-[#0b57d0] dark:text-sky-300" />
              <h2 className="font-black text-slate-950 dark:text-white">Workspace invitations</h2>
              <span className="rounded-full bg-[#0b57d0] px-2 py-0.5 text-xs font-black text-white">{invites.length}</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {invites.map(invite => {
                const inviteId = getEntityId(invite);
                return (
                  <div key={inviteId} className="rounded-2xl border border-blue-100 bg-white p-3 dark:border-blue-900/40 dark:bg-slate-900">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-black text-slate-950 dark:text-white">{invite.groupId?.name || 'Workspace invitation'}</p>
                        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                          Invited by {invite.invitedBy?.name || 'a workspace admin'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => respondToInvite(inviteId, 'decline')}
                          disabled={respondingInviteIds[inviteId]}
                          className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <X size={15} />
                          Decline
                        </button>
                        <button
                          type="button"
                          onClick={() => respondToInvite(inviteId, 'accept')}
                          disabled={respondingInviteIds[inviteId]}
                          className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#0b57d0] px-3 py-2 text-sm font-black text-white transition hover:bg-[#07036f] disabled:opacity-50"
                        >
                          <MailCheck size={15} />
                          Accept
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-black text-slate-950 dark:text-white">Workspace directory</h2>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              {filteredGroups.length} visible of {groups.length}
            </p>
          </div>
        </div>

        {filteredGroups.length === 0 ? (
          <EmptyWorkspacePanel onCreate={() => setShowCreate(true)} />
        ) : (
          <div className="workspace-directory-grid grid gap-4 lg:grid-cols-2">
            <AnimatePresence initial={false}>
              {filteredGroups.map((group, index) => {
                const groupId = getEntityId(group);
                const memberCount = group.members?.length || 0;
                const accent = getGroupAccent(group.name);
                const isCreator = getEntityId(group.creator) === currentUserId;
                const isCopied = copiedCode === group.joinCode;
                const groupPhoto = resolveMediaUrl(group.photo);

                return (
                  <motion.article
                    key={groupId}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ delay: index * 0.02 }}
                    onClick={() => navigate(`/group/${groupId}`)}
                    className="workspace-card cursor-pointer overflow-hidden rounded-[1.1rem] border border-slate-200 bg-white/92 shadow-sm shadow-slate-200/45 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20 dark:hover:border-blue-900/60"
                  >
                    <div className="grid h-full sm:grid-cols-[10rem_minmax(0,1fr)]">
                      <div className="workspace-card-media relative h-36 overflow-hidden bg-slate-950 sm:h-full sm:min-h-[12.5rem]">
                        {groupPhoto ? (
                          <img src={groupPhoto} alt={group.name} className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: accent }}>
                            <ImageIcon size={30} className="text-white/90" />
                          </div>
                        )}
                        <div className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-black text-white backdrop-blur">
                          {memberCount} {memberCount === 1 ? 'member' : 'members'}
                        </div>
                      </div>

                      <div className="workspace-card-body flex min-w-0 flex-col p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="workspace-title truncate text-lg font-black text-slate-950 dark:text-white">{group.name}</h3>
                              {isCreator && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                                  <Crown size={12} />
                                  Owner
                                </span>
                              )}
                            </div>
                            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                              {group.description || 'No description yet.'}
                            </p>
                          </div>

                          {!isCreator && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                leaveGroup(groupId, group.name);
                              }}
                              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
                              title="Leave workspace"
                            >
                              <LogOut size={18} />
                            </button>
                          )}
                        </div>

                        <div className="mt-4 grid gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400 sm:grid-cols-2">
                          <span className="inline-flex min-w-0 items-center gap-2">
                            <Calendar size={14} className="shrink-0" />
                            <span className="truncate">{formatDate(group.createdAt)}</span>
                          </span>
                          <span className="truncate">Owner: {group.creator?.name || (isCreator ? 'You' : 'Member')}</span>
                        </div>

                        <div className="mt-auto grid gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                          <div className="flex min-w-0 items-center gap-3">
                            <MemberStack members={group.members || []} />
                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Team members</span>
                          </div>

                          <div className="workspace-card-actions grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                            <button
                              type="button"
                              onClick={event => copyJoinCode(group.joinCode, event)}
                              className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              {isCopied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                              <span className="truncate">{group.joinCode || 'No code'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`/group/${groupId}`);
                              }}
                              className="workspace-open-button inline-flex h-10 min-w-[6.25rem] items-center justify-center gap-2 rounded-xl bg-[#0b57d0] px-4 text-sm font-black text-white shadow-sm shadow-blue-600/20 transition hover:bg-[#07036f]"
                            >
                              Open
                              <ArrowRight size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </section>

      <CreateGroupModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={createGroup}
      />
    </div>
  );
}
