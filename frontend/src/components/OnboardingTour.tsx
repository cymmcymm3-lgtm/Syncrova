import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Compass, Gamepad2, Loader2, MessageCircle, Sparkles, UserRound, UserPlus, UsersRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import api from '../services/api';
import { resolveMediaUrl } from '../utils/media';
import './onboarding-tour.css';

const ONBOARDING_VERSION = 'v1';
const NEW_ACCOUNT_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

const getEntityId = (entity: any) => String(entity?._id || entity?.id || entity || '');

const getStorageKey = (user: any) => `syncrova:onboarding:${ONBOARDING_VERSION}:${getEntityId(user)}`;
const getProgressKey = (storageKey: string) => `${storageKey}:progress`;
const getDismissKey = (storageKey: string) => `${storageKey}:dismissed`;

const isNewAccount = (user: any) => {
  const createdAt = new Date(user?.createdAt || 0).getTime();
  const age = Date.now() - createdAt;
  return Number.isFinite(createdAt) && createdAt > 0 && age >= 0 && age <= NEW_ACCOUNT_WINDOW_MS;
};

function PersonAvatar({ person }: { person: any }) {
  const source = resolveMediaUrl(person?.avatar || '');
  const initial = String(person?.name || 'M').trim().charAt(0).toUpperCase() || 'M';
  return source ? (
    <img className="sync-onboarding__suggestion-avatar" src={source} alt="" />
  ) : (
    <span className="sync-onboarding__suggestion-avatar sync-onboarding__suggestion-avatar--fallback" aria-hidden="true">{initial}</span>
  );
}

export default function OnboardingTour({ user }: { user: any }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [requestingId, setRequestingId] = useState('');
  const [requestedIds, setRequestedIds] = useState(() => new Set<string>());
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const storageKey = useMemo(() => getStorageKey(user), [user]);
  const progressKey = useMemo(() => getProgressKey(storageKey), [storageKey]);
  const dismissKey = useMemo(() => getDismissKey(storageKey), [storageKey]);
  const firstName = String(user?.name || 'there').trim().split(/\s+/)[0] || 'there';

  useEffect(() => {
    setStep(0);
    setSuggestions([]);
    setSuggestionsLoaded(false);
    setRequestedIds(new Set());
  }, [storageKey]);

  const dismiss = useCallback(() => {
    try { sessionStorage.setItem(dismissKey, 'true'); } catch {}
    setOpen(false);
  }, [dismissKey]);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(storageKey, 'complete');
      sessionStorage.removeItem(dismissKey);
      sessionStorage.removeItem(progressKey);
    } catch {}
    setOpen(false);
  }, [dismissKey, progressKey, storageKey]);

  const moveTo = useCallback((nextStep: number) => {
    const safeStep = Math.min(3, Math.max(0, nextStep));
    setStep(safeStep);
    try { sessionStorage.setItem(progressKey, String(safeStep)); } catch {}
  }, [progressKey]);

  useEffect(() => {
    if (!isNewAccount(user) || !getEntityId(user)) {
      setOpen(false);
      return;
    }
    try {
      if (localStorage.getItem(storageKey) === 'complete') return;
      if (sessionStorage.getItem(dismissKey) === 'true') return;
      const storedStep = Number(sessionStorage.getItem(progressKey));
      if (Number.isInteger(storedStep) && storedStep >= 0 && storedStep <= 3) setStep(storedStep);
    } catch {
      // If browser storage is unavailable, the short tour can still be shown.
    }
    const frame = window.requestAnimationFrame(() => setOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, [dismissKey, progressKey, storageKey, user]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dismiss, open]);

  // Keep the tour anchored to the visible mobile viewport. Without this, a
  // focused control or a touch scroll can move the dashboard behind the dialog
  // and make the first welcome screen appear to start part-way down the page.
  useEffect(() => {
    if (!open) return undefined;
    const body = document.body;
    const root = document.documentElement;
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      rootOverscroll: root.style.overscrollBehavior
    };

    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    root.style.overscrollBehavior = 'none';

    return () => {
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.bodyOverscroll;
      root.style.overscrollBehavior = previous.rootOverscroll;
    };
  }, [open]);

  useEffect(() => {
    if (!open || step !== 2 || suggestionsLoaded || loadingSuggestions) return;
    let cancelled = false;
    setLoadingSuggestions(true);
    api.get('/friends/suggestions?limit=3')
      .then(response => {
        if (cancelled) return;
        const people = Array.isArray(response.data?.people) ? response.data.people : [];
        const next = people
          .filter((person: any) => {
            const id = getEntityId(person);
            const relation = person?.friendship?.status || 'none';
            return id && id !== getEntityId(user) && relation === 'none';
          })
          .slice(0, 3);
        setSuggestions(next);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSuggestions(false);
          setSuggestionsLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, [loadingSuggestions, open, step, suggestionsLoaded, user]);

  const requestFriend = async (person: any) => {
    const personId = getEntityId(person);
    if (!personId || requestingId || requestedIds.has(personId)) return;
    setRequestingId(personId);
    try {
      const response = await api.post(`/friends/request/${personId}`);
      const relation = response.data?.friendship?.status || '';
      if (relation === 'outgoing') {
        setRequestedIds(current => new Set([...current, personId]));
      } else {
        setSuggestions(current => current.filter(item => getEntityId(item) !== personId));
      }
      window.dispatchEvent(new CustomEvent('friendsUpdated'));
      toast.success(response.data?.msg || (relation === 'outgoing' ? 'Friend request sent' : 'Friendship already updated'));
    } catch (error: any) {
      toast.error(error?.response?.data?.msg || 'Could not send the request');
    } finally {
      setRequestingId('');
    }
  };

  const openProfile = () => {
    navigate('/profile');
    moveTo(2);
  };

  const openDestination = (path: string) => {
    navigate(path);
    finish();
  };

  if (!open) return null;

  const steps = [
    {
      icon: Sparkles,
      eyebrow: 'Welcome to Syncrova',
      title: `Good to have you, ${firstName}.`,
      description: 'A calm space for campus updates, people, messages, and quick breaks between classes.'
    },
    {
      icon: UserRound,
      eyebrow: 'Step 2 of 4',
      title: 'Make your profile recognizable.',
      description: 'Add your photo, course, campus, and a short bio so classmates know it is really you.'
    },
    {
      icon: UsersRound,
      eyebrow: 'Step 3 of 4',
      title: 'Start with a few classmates.',
      description: 'These suggestions are optional. Send requests only to people you recognize.'
    },
    {
      icon: Compass,
      eyebrow: 'Step 4 of 4',
      title: 'You are ready to explore.',
      description: 'Use Dashboard for updates, Messages for conversations, and Games when you want a break.'
    }
  ];
  const active = steps[step];
  const Icon = active.icon;

  return createPortal(
    <div className="sync-onboarding" role="dialog" aria-modal="true" aria-labelledby="sync-onboarding-title">
      <div className="sync-onboarding__backdrop" aria-hidden="true" />
      <section className="sync-onboarding__card" data-step={step + 1} onMouseDown={event => event.stopPropagation()}>
        <header className="sync-onboarding__header">
          <span className="sync-onboarding__icon"><Icon size={21} /></span>
          <div className="min-w-0 flex-1">
            <p>{active.eyebrow}</p>
            <div className="sync-onboarding__progress" aria-label={`Onboarding step ${step + 1} of 4`}>
              {steps.map((_, index) => <span key={index} className={index <= step ? 'is-active' : ''} />)}
            </div>
          </div>
          <button ref={closeButtonRef} type="button" className="sync-onboarding__close" onClick={dismiss} aria-label="Skip welcome tour for this session" title="Skip for now"><X size={18} /></button>
        </header>

        <main className={`sync-onboarding__content${step === 0 ? ' sync-onboarding__content--welcome' : ''}`} key={step}>
          <h2 id="sync-onboarding-title">{active.title}</h2>
          <p>{active.description}</p>

          {step === 0 && (
            <div className="sync-onboarding__welcome-grid">
              <span><MessageCircle size={18} /> Private conversations</span>
              <span><UsersRound size={18} /> Campus connections</span>
              <span><Gamepad2 size={18} /> Quick games</span>
            </div>
          )}

          {step === 1 && (
            <button type="button" className="sync-onboarding__profile-card" onClick={openProfile}>
              <UserRound size={20} />
              <span><strong>Set up your profile</strong><small>Photo, course, campus, and bio</small></span>
              <ArrowRight size={17} />
            </button>
          )}

          {step === 2 && (
            <div className="sync-onboarding__suggestions" aria-live="polite">
              {loadingSuggestions ? <div className="sync-onboarding__suggestion-loading"><Loader2 size={17} className="animate-spin" /> Finding classmates…</div> : null}
              {!loadingSuggestions && suggestions.map(person => {
                const personId = getEntityId(person);
                const requested = requestedIds.has(personId);
                return (
                  <div className="sync-onboarding__suggestion" key={personId}>
                    <PersonAvatar person={person} />
                    <span className="min-w-0 flex-1"><strong>{person.name || 'Member'}</strong><small>{[person.course, person.campus].filter(Boolean).join(' · ') || 'Syncrova member'}</small></span>
                    <button type="button" onClick={() => requestFriend(person)} disabled={requestingId === personId || requested}>
                      {requestingId === personId ? <Loader2 size={15} className="animate-spin" /> : requested ? <Check size={15} /> : <UserPlus size={15} />}
                      {requested ? 'Sent' : 'Add'}
                    </button>
                  </div>
                );
              })}
              {!loadingSuggestions && !suggestions.length && <p className="sync-onboarding__empty">No suggestions right now. You can always find people in Friends.</p>}
            </div>
          )}

          {step === 3 && (
            <div className="sync-onboarding__destinations">
              <button type="button" onClick={() => openDestination('/friends')}><UsersRound size={18} /> Find friends</button>
              <button type="button" onClick={() => openDestination('/messages')}><MessageCircle size={18} /> Open messages</button>
              <button type="button" onClick={() => openDestination('/arena')}><Gamepad2 size={18} /> Browse games</button>
            </div>
          )}
        </main>

        <footer className="sync-onboarding__footer">
          <button type="button" className="sync-onboarding__quiet" onClick={dismiss}>Skip for now</button>
          <span className="flex items-center gap-2">
            {step > 0 && <button type="button" className="sync-onboarding__back" onClick={() => moveTo(step - 1)} aria-label="Previous step"><ArrowLeft size={17} /></button>}
            <button type="button" className="sync-onboarding__next" onClick={() => step === 3 ? finish() : moveTo(step + 1)}>
              {step === 3 ? 'Finish' : 'Continue'} {step < 3 && <ArrowRight size={17} />}
            </button>
          </span>
        </footer>
      </section>
    </div>,
    document.body
  );
}
