import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Check,
  ChevronRight,
  Clock3,
  Loader2,
  MessageCircle,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { resolveMediaUrl } from '../utils/media';
import { CAMPUS_OPTIONS } from '../utils/academics';
import { ListSkeleton } from './SkeletonLoader';
import './friends-clean.css';

const UserProfileModal = lazy(() => import('./UserProfileModal'));

type FriendStatus = 'none' | 'friends' | 'incoming' | 'outgoing';

function DeferredProfileFallback() {
  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/10 p-4 backdrop-blur-[1px]" role="status" aria-label="Opening profile">
      <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-xs font-black text-slate-700 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900/95 dark:text-slate-100 dark:ring-slate-700">
        <Loader2 size={15} className="animate-spin text-[#1877f2]" />
        Opening profile…
      </span>
    </div>
  );
}

type Friendship = {
  status?: FriendStatus;
  requestId?: string;
};

type Person = {
  _id?: string;
  id?: string;
  name?: string;
  email?: string;
  avatar?: string;
  course?: string;
  campus?: string;
  friendship?: Friendship;
};

type FriendRecord = {
  _id?: string;
  id?: string;
  user?: Person;
  since?: string | number | Date;
  friendship?: Friendship;
};

type RequestRecord = {
  _id?: string;
  id?: string;
  requester?: Person;
  recipient?: Person;
  createdAt?: string | number | Date;
  friendship?: Friendship;
};

type FriendCounts = {
  friends?: number;
  incoming?: number;
  outgoing?: number;
  people?: number;
};

type FriendSummary = {
  friends: FriendRecord[];
  incoming: RequestRecord[];
  outgoing: RequestRecord[];
  people: Person[];
  counts: Required<FriendCounts>;
};

type FriendSummaryPayload = Partial<Omit<FriendSummary, 'counts'>> & {
  counts?: FriendCounts;
};

type TabKey = 'friends' | 'discover' | 'requests';

const emptySummary: FriendSummary = {
  friends: [],
  incoming: [],
  outgoing: [],
  people: [],
  counts: { friends: 0, incoming: 0, outgoing: 0, people: 0 }
};

const getEntityId = (entity?: { _id?: string; id?: string } | string | null): string => {
  if (!entity) return '';
  return typeof entity === 'string' ? entity : String(entity._id || entity.id || '');
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  const candidate = error as { response?: { data?: { msg?: unknown } } };
  return typeof candidate?.response?.data?.msg === 'string' ? candidate.response.data.msg : fallback;
};

const uniqueBy = <T,>(items: T[] = [], getKey: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeSummary = (data: FriendSummaryPayload = {}): FriendSummary => {
  const friends = uniqueBy(data.friends || [], item => getEntityId(item.user) || getEntityId(item));
  const occupiedIds = new Set(friends.map(item => getEntityId(item.user)).filter(Boolean));
  const incoming = uniqueBy(data.incoming || [], item => getEntityId(item.requester) || getEntityId(item))
    .filter(item => {
      const id = getEntityId(item.requester);
      if (!id || occupiedIds.has(id)) return false;
      occupiedIds.add(id);
      return true;
    });
  const outgoing = uniqueBy(data.outgoing || [], item => getEntityId(item.recipient) || getEntityId(item))
    .filter(item => {
      const id = getEntityId(item.recipient);
      if (!id || occupiedIds.has(id)) return false;
      occupiedIds.add(id);
      return true;
    });
  const relationshipByUser = new Map<string, Friendship>();

  friends.forEach(item => relationshipByUser.set(getEntityId(item.user), item.friendship || { status: 'friends', requestId: getEntityId(item) }));
  incoming.forEach(item => relationshipByUser.set(getEntityId(item.requester), item.friendship || { status: 'incoming', requestId: getEntityId(item) }));
  outgoing.forEach(item => relationshipByUser.set(getEntityId(item.recipient), item.friendship || { status: 'outgoing', requestId: getEntityId(item) }));

  const people = uniqueBy<Person>(data.people || [], person => getEntityId(person)).map(person => ({
    ...person,
    friendship: relationshipByUser.get(getEntityId(person)) || person.friendship || { status: 'none' }
  }));

  return {
    friends,
    incoming,
    outgoing,
    people,
    counts: {
      friends: friends.length,
      incoming: incoming.length,
      outgoing: outgoing.length,
      people: people.length
    }
  };
};

const matchesSearch = (person: Person | undefined, query: string): boolean => {
  const value = query.trim().toLowerCase();
  if (!value) return true;
  return [person?.name, person?.email, person?.course, person?.campus]
    .filter((field): field is string => Boolean(field))
    .some(field => field.toLowerCase().includes(value));
};

const matchesCampus = (person: Person | undefined, campus: string): boolean => !campus || person?.campus === campus;

const formatSince = (value?: string | number | Date): string => {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function PersonAvatar({ person, size = 'regular' }: { person?: Person; size?: 'regular' | 'large' }) {
  const source = resolveMediaUrl(person?.avatar || '');
  const name = person?.name || 'User';

  return (
    <span className={`friends-clean__avatar friends-clean__avatar--${size}`} aria-hidden="true">
      {source ? <img src={source} alt="" loading="lazy" /> : name.charAt(0).toUpperCase()}
    </span>
  );
}

function EmptyState({
  icon: Icon,
  title,
  message
}: {
  icon: typeof Users;
  title: string;
  message: string;
}) {
  return (
    <div className="friends-clean__empty">
      <span className="friends-clean__empty-icon"><Icon size={22} /></span>
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}

function PersonCard({
  person,
  detail,
  children,
  onOpenProfile
}: {
  person?: Person;
  detail?: string;
  children: React.ReactNode;
  onOpenProfile: (person: Person) => void;
}) {
  if (!person) return null;
  const academicDetail = [person.course, person.campus].filter(Boolean).join(' · ');

  return (
    <article className="friends-clean__person-card">
      <button
        type="button"
        className="friends-clean__person-main"
        onClick={() => onOpenProfile(person)}
        aria-label={`View ${person.name || 'user'}'s profile`}
      >
        <PersonAvatar person={person} size="large" />
        <span className="friends-clean__person-copy">
          <span className="friends-clean__person-name">{person.name || 'Syncrova user'}</span>
          <span className="friends-clean__person-detail">{detail || academicDetail || person.email || 'Syncrova member'}</span>
        </span>
        <ChevronRight size={18} className="friends-clean__person-arrow" aria-hidden="true" />
      </button>
      <div className="friends-clean__person-actions">{children}</div>
    </article>
  );
}

export default function Friends() {
  const [summary, setSummary] = useState<FriendSummary>(emptySummary);
  const [activeTab, setActiveTab] = useState<TabKey>('friends');
  const [query, setQuery] = useState('');
  const [campusFilter, setCampusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState('');
  const [profileUser, setProfileUser] = useState<Person | null>(null);
  const navigate = useNavigate();

  const loadFriends = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const response = await api.get<FriendSummaryPayload>('/friends/summary');
      setSummary(normalizeSummary(response.data));
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load friends'));
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => void loadFriends(false);
    socket.on('friend-request-updated', refresh);
    window.addEventListener('syncrova:mobile-refresh', refresh);
    return () => {
      socket.off('friend-request-updated', refresh);
      window.removeEventListener('syncrova:mobile-refresh', refresh);
    };
  }, [loadFriends]);

  const friends = useMemo(
    () => summary.friends
      .filter(item => matchesSearch(item.user, query))
      .filter(item => matchesCampus(item.user, campusFilter)),
    [summary.friends, query, campusFilter]
  );
  const people = useMemo(
    () => summary.people
      .filter(person => matchesSearch(person, query))
      .filter(person => matchesCampus(person, campusFilter)),
    [summary.people, query, campusFilter]
  );
  const incoming = useMemo(
    () => summary.incoming
      .filter(item => matchesSearch(item.requester, query))
      .filter(item => matchesCampus(item.requester, campusFilter)),
    [summary.incoming, query, campusFilter]
  );
  const outgoing = useMemo(
    () => summary.outgoing
      .filter(item => matchesSearch(item.recipient, query))
      .filter(item => matchesCampus(item.recipient, campusFilter)),
    [summary.outgoing, query, campusFilter]
  );

  const refreshAfterAction = async () => {
    await loadFriends(false);
    window.dispatchEvent(new CustomEvent('friendsUpdated'));
  };

  const sendRequest = async (person: Person) => {
    const personId = getEntityId(person);
    if (!personId) return;
    setActionKey(`send-${personId}`);
    try {
      const response = await api.post<{ msg?: string }>(`/friends/request/${personId}`);
      toast.success(response.data?.msg || 'Friend request sent');
      await refreshAfterAction();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not send the request'));
    } finally {
      setActionKey('');
    }
  };

  const acceptRequest = async (requestId: string) => {
    setActionKey(`accept-${requestId}`);
    try {
      await api.put(`/friends/requests/${requestId}/accept`);
      toast.success('Friend request accepted');
      await refreshAfterAction();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not accept the request'));
    } finally {
      setActionKey('');
    }
  };

  const declineRequest = async (requestId: string) => {
    setActionKey(`decline-${requestId}`);
    try {
      await api.put(`/friends/requests/${requestId}/decline`);
      toast.success('Friend request declined');
      await refreshAfterAction();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not decline the request'));
    } finally {
      setActionKey('');
    }
  };

  const cancelRequest = async (requestId: string) => {
    setActionKey(`cancel-${requestId}`);
    try {
      await api.delete(`/friends/requests/${requestId}`);
      toast.success('Friend request cancelled');
      await refreshAfterAction();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not cancel the request'));
    } finally {
      setActionKey('');
    }
  };

  const removeFriend = async (friendshipId: string) => {
    setActionKey(`remove-${friendshipId}`);
    try {
      await api.delete(`/friends/${friendshipId}`);
      toast.success('Friend removed');
      await refreshAfterAction();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not remove this friend'));
    } finally {
      setActionKey('');
    }
  };

  const openMessages = (person: Person) => {
    const id = getEntityId(person);
    navigate(id ? `/messages?user=${id}` : '/messages');
  };

  const tabItems: Array<{ key: TabKey; label: string; count: number; icon: typeof Users }> = [
    { key: 'friends', label: 'Friends', count: summary.counts.friends, icon: Users },
    { key: 'discover', label: 'Discover', count: summary.counts.people, icon: UserPlus },
    { key: 'requests', label: 'Requests', count: summary.counts.incoming + summary.counts.outgoing, icon: UserCheck }
  ];

  return (
    <div className="mobile-page friends-clean">
      <header className="friends-clean__header">
        <div>
          <p className="friends-clean__eyebrow">Your network</p>
          <h1>Friends</h1>
          <p className="friends-clean__intro">Find classmates, manage requests, and start a conversation.</p>
        </div>
        <div className="friends-clean__count" aria-label={`${summary.counts.friends} friends`}>
          <Users size={19} />
          <strong>{summary.counts.friends}</strong>
          <span>friends</span>
        </div>
      </header>

      <section className="friends-clean__toolbar" aria-label="Friend filters">
        <div className="friends-clean__tabs" role="tablist" aria-label="Friends sections">
          {tabItems.map(({ key, label, count, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeTab === key}
              className={activeTab === key ? 'is-active' : ''}
              onClick={() => setActiveTab(key)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {count > 0 && <em>{count}</em>}
            </button>
          ))}
        </div>

        <div className="friends-clean__filters">
          <label className="friends-clean__search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search people</span>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search people"
            />
          </label>
          <label className="friends-clean__campus">
            <span className="sr-only">Filter by campus</span>
            <select value={campusFilter} onChange={event => setCampusFilter(event.target.value)}>
              <option value="">All campuses</option>
              {CAMPUS_OPTIONS.map(campus => <option key={campus} value={campus}>{campus}</option>)}
            </select>
          </label>
        </div>
      </section>

      {loading ? <ListSkeleton count={6} /> : (
        <main className="friends-clean__content">
          {activeTab === 'friends' && (
            <section aria-labelledby="friends-list-title">
              <div className="friends-clean__section-heading">
                <div>
                  <h2 id="friends-list-title">Your friends</h2>
                  <p>{friends.length === 1 ? '1 friend' : `${friends.length} friends`} {query || campusFilter ? 'match your filters' : 'in your network'}</p>
                </div>
                {summary.counts.incoming > 0 && (
                  <button type="button" className="friends-clean__text-action" onClick={() => setActiveTab('requests')}>
                    {summary.counts.incoming} waiting <ChevronRight size={16} />
                  </button>
                )}
              </div>
              {friends.length === 0 ? (
                <EmptyState icon={UserRound} title="No friends found" message="Try another search, or discover people in Syncrova." />
              ) : (
                <div className="friends-clean__grid">
                  {friends.map(item => {
                    const id = getEntityId(item);
                    return (
                      <PersonCard
                        key={id}
                        person={item.user}
                        detail={`Friends since ${formatSince(item.since)}`}
                        onOpenProfile={setProfileUser}
                      >
                        <button type="button" className="friends-clean__primary-action" onClick={() => item.user && openMessages(item.user)}>
                          <MessageCircle size={16} /> Message
                        </button>
                        <button
                          type="button"
                          className="friends-clean__icon-action is-danger"
                          onClick={() => removeFriend(id)}
                          disabled={!id || actionKey === `remove-${id}`}
                          aria-label={`Remove ${item.user?.name || 'friend'}`}
                          title="Remove friend"
                        >
                          {actionKey === `remove-${id}` ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}
                        </button>
                      </PersonCard>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {activeTab === 'discover' && (
            <section aria-labelledby="discover-title">
              <div className="friends-clean__section-heading">
                <div>
                  <h2 id="discover-title">Discover people</h2>
                  <p>Connect with classmates already on Syncrova.</p>
                </div>
              </div>
              {people.length === 0 ? (
                <EmptyState icon={Users} title="No new people found" message="New classmates will appear here when they join Syncrova." />
              ) : (
                <div className="friends-clean__grid">
                  {people.map(person => {
                    const relationship = person.friendship || { status: 'none' as FriendStatus };
                    const requestId = relationship.requestId || '';
                    const personId = getEntityId(person);
                    const isSending = actionKey === `send-${personId}`;
                    const isCancelling = actionKey === `cancel-${requestId}`;
                    return (
                      <PersonCard key={personId} person={person} onOpenProfile={setProfileUser}>
                        {relationship.status === 'friends' ? (
                          <button type="button" className="friends-clean__primary-action" onClick={() => openMessages(person)}>
                            <MessageCircle size={16} /> Message
                          </button>
                        ) : relationship.status === 'outgoing' ? (
                          <button
                            type="button"
                            className="friends-clean__secondary-action"
                            onClick={() => cancelRequest(requestId)}
                            disabled={!requestId || isCancelling}
                          >
                            {isCancelling ? <Loader2 size={16} className="animate-spin" /> : <Clock3 size={16} />}
                            Requested
                          </button>
                        ) : relationship.status === 'incoming' ? (
                          <button type="button" className="friends-clean__secondary-action" onClick={() => setActiveTab('requests')}>
                            <UserCheck size={16} /> Review request
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="friends-clean__primary-action"
                            onClick={() => sendRequest(person)}
                            disabled={!personId || isSending}
                          >
                            {isSending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                            Add friend
                          </button>
                        )}
                      </PersonCard>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {activeTab === 'requests' && (
            <section className="friends-clean__request-layout" aria-label="Friend requests">
              <div>
                <div className="friends-clean__section-heading">
                  <div>
                    <h2>Requests</h2>
                    <p>Choose who joins your friend list.</p>
                  </div>
                </div>
                {incoming.length === 0 ? (
                  <EmptyState icon={UserCheck} title="No requests waiting" message="Incoming friend requests will appear here." />
                ) : (
                  <div className="friends-clean__stack">
                    {incoming.map(item => {
                      const requestId = getEntityId(item);
                      const accepting = actionKey === `accept-${requestId}`;
                      const declining = actionKey === `decline-${requestId}`;
                      return (
                        <PersonCard
                          key={requestId}
                          person={item.requester}
                          detail={`Requested ${formatSince(item.createdAt)}`}
                          onOpenProfile={setProfileUser}
                        >
                          <button type="button" className="friends-clean__primary-action" onClick={() => acceptRequest(requestId)} disabled={!requestId || accepting}>
                            {accepting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Accept
                          </button>
                          <button type="button" className="friends-clean__icon-action" onClick={() => declineRequest(requestId)} disabled={!requestId || declining} aria-label="Decline friend request" title="Decline request">
                            {declining ? <Loader2 size={17} className="animate-spin" /> : <X size={17} />}
                          </button>
                        </PersonCard>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <div className="friends-clean__section-heading">
                  <div>
                    <h2>Sent</h2>
                    <p>Requests waiting for a reply.</p>
                  </div>
                </div>
                {outgoing.length === 0 ? (
                  <EmptyState icon={Clock3} title="Nothing pending" message="Requests you send will stay here until someone replies." />
                ) : (
                  <div className="friends-clean__stack">
                    {outgoing.map(item => {
                      const requestId = getEntityId(item);
                      const cancelling = actionKey === `cancel-${requestId}`;
                      return (
                        <PersonCard
                          key={requestId}
                          person={item.recipient}
                          detail={`Sent ${formatSince(item.createdAt)}`}
                          onOpenProfile={setProfileUser}
                        >
                          <button type="button" className="friends-clean__secondary-action" onClick={() => cancelRequest(requestId)} disabled={!requestId || cancelling}>
                            {cancelling ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />} Cancel
                          </button>
                        </PersonCard>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      )}

      {profileUser && (
        <Suspense fallback={<DeferredProfileFallback />}>
          <UserProfileModal
            isOpen
            user={profileUser}
            userId={getEntityId(profileUser)}
            onClose={() => setProfileUser(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
