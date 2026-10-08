// @ts-nocheck
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  Crown,
  Gamepad2,
  KeyRound,
  Keyboard,
  Lightbulb,
  MessageCircle,
  MousePointer2,
  Plane,
  Play,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  Zap
} from 'lucide-react';
import api from '../services/api';
import { resolveMediaUrl } from '../utils/media';
import GameRankBadge, { GameRankEmblem } from './GameRankBadge';
import LoadingSpinner from './LoadingSpinner';
import { PageSkeleton } from './SkeletonLoader';

const BlockStackGame = lazy(() => import('./BlockStackGame'));
const FocusFlowGame = lazy(() => import('./FocusFlowGame'));
const JetFighterGame = lazy(() => import('./JetFighterGame'));
const UserProfileModal = lazy(() => import('./UserProfileModal'));

const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');

const severityStyles = {
  low: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/60',
  medium: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/60',
  high: 'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-950/30 dark:text-rose-200 dark:ring-rose-900/60',
  critical: 'bg-indigo-50 text-indigo-700 ring-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-200 dark:ring-indigo-900/60'
};

const statusStyles = {
  new: 'bg-pink-50 text-pink-700 ring-pink-100 dark:bg-pink-950/30 dark:text-pink-200 dark:ring-pink-900/60',
  reviewing: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/60',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/60',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-950/30 dark:text-rose-200 dark:ring-rose-900/60',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/60',
  closed: 'bg-gray-100 text-gray-700 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700'
};

const categories = [
  ['bug', 'Bug'],
  ['feature', 'Feature'],
  ['ui', 'UI/UX'],
  ['performance', 'Performance'],
  ['account', 'Account'],
  ['workspace', 'App area'],
  ['messages', 'Messages'],
  ['other', 'Other']
];

const initialReportForm = {
  type: 'problem',
  category: 'bug',
  severity: 'medium',
  title: '',
  details: '',
  expected: '',
  workspaceName: ''
};

const GAME_HUB_REQUEST_TIMEOUT_MS = 4500;

const fallbackResponse = (data) => ({ data });

const safeArenaRequest = async (request, fallbackData) => {
  try {
    return await request();
  } catch {
    return fallbackResponse(fallbackData);
  }
};

const getArenaView = (value, fallback = 'home') => (
  ['home', 'games', 'report', 'developer'].includes(value) ? value : fallback
);

const triggerGameHubFeedback = (duration = 10) => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  const isTouchViewport = window.matchMedia?.('(max-width: 767px), (pointer: coarse)')?.matches;
  if (isTouchViewport) navigator.vibrate(duration);
};

const formatDateTime = (value) => {
  if (!value) return 'Just now';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

const formatElapsed = (elapsedMs = 0) => `${(elapsedMs / 1000).toFixed(1)}s`;

const ArenaMark = ({ compact = false }) => (
  <div
    className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-2xl'} grid shrink-0 place-items-center border border-blue-100 bg-blue-50 text-[#0b57d0] shadow-sm dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200`}
  >
    <Gamepad2 size={compact ? 22 : 28} strokeWidth={2.15} />
  </div>
);

const TypingGameLogo = ({ compact = false }) => (
  <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-gray-950 text-white shadow-xl shadow-yellow-500/20 ring-1 ring-yellow-300/20`}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(250,204,21,0.5),transparent_34%),radial-gradient(circle_at_78%_75%,rgba(34,211,238,0.36),transparent_35%)]" />
    <Keyboard size={compact ? 24 : 30} className="relative z-10 text-yellow-100 drop-shadow" />
  </div>
);

const JetFighterLogo = ({ compact = false }) => (
  <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-sky-950 text-white shadow-xl shadow-cyan-500/20 ring-1 ring-cyan-300/20`}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_20%,rgba(34,211,238,0.48),transparent_34%),radial-gradient(circle_at_80%_74%,rgba(244,63,94,0.38),transparent_35%)]" />
    <Plane size={compact ? 24 : 30} className="relative z-10 -rotate-45 text-cyan-100 drop-shadow" />
  </div>
);

const ReactionTapLogo = ({ compact = false }) => (
  <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-slate-950 text-white shadow-xl shadow-blue-500/20 ring-1 ring-blue-300/20`}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_20%,rgba(59,130,246,0.55),transparent_34%),radial-gradient(circle_at_80%_74%,rgba(34,197,94,0.42),transparent_35%)]" />
    <MousePointer2 size={compact ? 24 : 30} className="relative z-10 text-blue-100 drop-shadow" />
  </div>
);

const BlockGameLogo = ({ compact = false }) => (
  <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-gray-950 text-white shadow-xl shadow-cyan-500/20 ring-1 ring-cyan-300/20`}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(34,211,238,0.45),transparent_34%),radial-gradient(circle_at_80%_70%,rgba(236,72,153,0.38),transparent_35%)]" />
    <div className="relative grid grid-cols-3 gap-1">
      {Array.from({ length: 9 }).map((_, index) => (
        <span key={index} className={`h-2.5 w-2.5 rounded-[4px] ${[0, 1, 3, 4, 5, 8].includes(index) ? 'bg-gradient-to-br from-cyan-300 to-pink-500' : 'bg-white/15'}`} />
      ))}
    </div>
  </div>
);

const BugHuntLogo = ({ compact = false }) => (
  <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-gray-950 text-white shadow-xl shadow-rose-500/20 ring-1 ring-rose-300/20`}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_22%,rgba(251,113,133,0.46),transparent_34%),radial-gradient(circle_at_78%_78%,rgba(34,211,238,0.3),transparent_35%)]" />
    <Bug size={compact ? 25 : 31} className="relative z-10 text-rose-100 drop-shadow" />
  </div>
);

const FocusFlowLogo = ({ compact = false }) => (
  <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-gray-950 text-white shadow-xl shadow-emerald-500/20 ring-1 ring-emerald-300/20`}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(52,211,153,0.42),transparent_34%),radial-gradient(circle_at_75%_80%,rgba(34,211,238,0.3),transparent_35%)]" />
    <Target size={compact ? 25 : 31} className="relative z-10 text-emerald-100 drop-shadow" />
  </div>
);

const BowDuelLogo = ({ compact = false }) => (
  <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-gray-950 text-white shadow-xl shadow-amber-500/20 ring-1 ring-amber-300/20`}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(16,185,129,0.46),transparent_34%),radial-gradient(circle_at_75%_80%,rgba(251,191,36,0.45),transparent_35%)]" />
    <Target size={compact ? 25 : 31} className="relative z-10 text-amber-100 drop-shadow" />
  </div>
);

const CodeQuizLogo = ({ compact = false }) => (
  <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-gray-950 text-white shadow-xl shadow-violet-500/20 ring-1 ring-violet-300/20`}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(139,92,246,0.5),transparent_34%),radial-gradient(circle_at_75%_80%,rgba(34,211,238,0.3),transparent_35%)]" />
    <Code2 size={compact ? 24 : 30} className="relative z-10 text-violet-100 drop-shadow" />
  </div>
);

const getTypingSentences = (session) => {
  if (Array.isArray(session?.sentences) && session.sentences.length) return session.sentences;
  return String(session?.prompt || '').split(/\n+/).map(item => item.trim()).filter(Boolean);
};

const normalizeTypingSentence = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

export default function OpsArena({ initialView = 'home', consoleOnly = false }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryView = searchParams.get('view');
  const resolvedInitialView = getArenaView(queryView, getArenaView(initialView));
  const [summary, setSummary] = useState(null);
  const [developerInfo, setDeveloperInfo] = useState({ isDeveloper: false, user: null });
  const [issues, setIssues] = useState([]);
  const [selectedIssueId, setSelectedIssueId] = useState(null);
  const [issueStatusFilter, setIssueStatusFilter] = useState('all');
  const [issueSearch, setIssueSearch] = useState('');
  const [reportForm, setReportForm] = useState(initialReportForm);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [deletingIssueId, setDeletingIssueId] = useState('');
  const [typingSession, setTypingSession] = useState(null);
  const [typingText, setTypingText] = useState('');
  const [typingEntries, setTypingEntries] = useState([]);
  const [typingResult, setTypingResult] = useState(null);
  const [typingSeconds, setTypingSeconds] = useState(0);
  const [typingBusy, setTypingBusy] = useState(false);
  const [activeGame, setActiveGame] = useState('');
  const [arenaView, setArenaView] = useState(resolvedInitialView);
  const [profileUser, setProfileUser] = useState(null);
  const [passwordResetEmail, setPasswordResetEmail] = useState('');
  const [passwordResetResult, setPasswordResetResult] = useState(null);
  const [generatingPasswordReset, setGeneratingPasswordReset] = useState(false);

  const isDeveloper = Boolean(developerInfo?.isDeveloper);
  const isConsoleOnly = Boolean(consoleOnly);

  useEffect(() => {
    const nextView = getArenaView(queryView, getArenaView(initialView));
    setArenaView(nextView);
    if (nextView === 'games') setActiveGame('');
  }, [initialView, queryView]);

  const selectedIssue = useMemo(
    () => issues.find(issue => getEntityId(issue) === selectedIssueId) || issues[0] || null,
    [issues, selectedIssueId]
  );

  const needsManagementData = isConsoleOnly || arenaView === 'report' || arenaView === 'developer';

  const loadArena = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const requestConfig = { timeout: GAME_HUB_REQUEST_TIMEOUT_MS };
      const summaryRes = await safeArenaRequest(() => api.get('/games/summary/me', requestConfig), null);
      setSummary(summaryRes.data);

      if (needsManagementData) {
        const [developerRes, issuesRes] = await Promise.all([
          safeArenaRequest(() => api.get('/games/developers/me', requestConfig), { isDeveloper: false }),
          safeArenaRequest(() => api.get('/games/fix-arena/issues', requestConfig), { issues: [] })
        ]);
        setDeveloperInfo(developerRes.data || { isDeveloper: false });
        setIssues(issuesRes.data?.issues || []);
        setSelectedIssueId(prev => prev || issuesRes.data?.issues?.[0]?._id || null);
      }
    } catch (err) {
      toast.error('Failed to load games');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [needsManagementData]);

  useEffect(() => {
    loadArena();
  }, [loadArena]);

  useEffect(() => {
    const refresh = () => loadArena({ silent: true });
    window.addEventListener('syncrova:mobile-refresh', refresh);
    return () => window.removeEventListener('syncrova:mobile-refresh', refresh);
  }, [loadArena]);

  const refreshIssues = async (selectId) => {
    const res = await api.get('/games/fix-arena/issues');
    const nextIssues = res.data?.issues || [];
    setIssues(nextIssues);
    setSelectedIssueId(selectId || nextIssues[0]?._id || null);
  };

  useEffect(() => {
    if (loading || !needsManagementData) return undefined;
    const timer = window.setInterval(() => {
      refreshIssues(selectedIssueId).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loading, needsManagementData, selectedIssueId]);

  const submitReport = async (event) => {
    event.preventDefault();
    if (isDeveloper) {
      toast.error('Developer accounts cannot submit member reports');
      return;
    }

    if (!reportForm.title.trim() || !reportForm.details.trim()) {
      toast.error('Title and details are required');
      return;
    }

    setSubmittingReport(true);
    try {
      const res = await api.post('/games/fix-arena/issues', reportForm);
      setReportForm(initialReportForm);
      await refreshIssues(res.data?.issueId);
      toast.success('Submitted privately to developers');
    } catch (err) {
      if (err.response?.status === 404) {
        toast.error('Backend is not updated yet. Redeploy Render backend first.');
      } else {
        toast.error(err.response?.data?.msg || 'Submit failed');
      }
    } finally {
      setSubmittingReport(false);
    }
  };

  const updateStatus = async (issueId, status) => {
    try {
      const res = await api.put(`/games/fix-arena/issues/${issueId}/status`, { status });
      setIssues(prev => prev.map(issue => getEntityId(issue) === issueId ? res.data : issue));
      loadArena({ silent: true });
      toast.success('Status updated');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Status update failed');
    }
  };

  const deleteIssue = async (issueId) => {
    const targetIssue = issues.find(issue => getEntityId(issue) === getEntityId(issueId));
    if (!targetIssue) return;

    const confirmed = window.confirm(`Delete "${targetIssue.title}" permanently? This will remove the request and its thread.`);
    if (!confirmed) return;

    setDeletingIssueId(issueId);
    try {
      await api.delete(`/games/fix-arena/issues/${issueId}`);
      const nextIssues = issues.filter(issue => getEntityId(issue) !== getEntityId(issueId));
      setIssues(nextIssues);
      setSelectedIssueId(prev => getEntityId(prev) === getEntityId(issueId) ? nextIssues[0]?._id || null : prev);
      toast.success('Report deleted');
      loadArena({ silent: true });
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Delete failed');
    } finally {
      setDeletingIssueId('');
    }
  };

  const sendIssueMessage = async (event) => {
    event.preventDefault();
    if (!selectedIssue || !messageText.trim()) return;

    setSendingMessage(true);
    try {
      const res = await api.post(`/games/fix-arena/issues/${selectedIssue._id}/messages`, { text: messageText });
      setIssues(prev => prev.map(issue => getEntityId(issue) === getEntityId(selectedIssue) ? res.data : issue));
      setMessageText('');
      if (isDeveloper) loadArena({ silent: true });
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Message failed');
    } finally {
      setSendingMessage(false);
    }
  };

  const copyPasswordResetLink = async (link = passwordResetResult?.resetUrl) => {
    if (!link) return;
    try {
      await navigator.clipboard?.writeText(link);
      toast.success('Reset link copied');
    } catch {
      toast.error('Copy failed. Select and copy the link manually.');
    }
  };

  const generatePasswordResetLink = async (event) => {
    event.preventDefault();
    const email = passwordResetEmail.trim();
    if (!email) {
      toast.error('Enter the account email');
      return;
    }

    setGeneratingPasswordReset(true);
    setPasswordResetResult(null);
    try {
      const res = await api.post('/auth/admin/password-reset', { email });
      setPasswordResetResult(res.data || null);
      if (res.data?.resetUrl) copyPasswordResetLink(res.data.resetUrl);
      toast.success('Password reset link generated');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Reset link failed');
    } finally {
      setGeneratingPasswordReset(false);
    }
  };

  const startTypingSprint = async () => {
    setTypingBusy(true);
    setTypingResult(null);
    setTypingText('');
    setTypingEntries([]);
    setTypingSeconds(0);
    try {
      const res = await api.post('/games/typing-sprint/start');
      setTypingSession(res.data);
    } catch (err) {
      if (err.response?.status === 404) {
        toast.error('Backend is not updated yet. Redeploy Render backend first.');
      } else {
        toast.error(err.response?.data?.msg || 'Could not start Typing Sprint');
      }
    } finally {
      setTypingBusy(false);
    }
  };

  const submitTypingSprint = useCallback(async (event, overrideEntries = null) => {
    event?.preventDefault?.();
    if (!typingSession || typingBusy) return;

    const sentences = getTypingSentences(typingSession);
    let finalEntries = overrideEntries || typingEntries;
    const currentTyped = typingText.trim();

    if (!overrideEntries && currentTyped && sentences[finalEntries.length]) {
      const expected = sentences[finalEntries.length];
      finalEntries = [
        ...finalEntries,
        {
          expected,
          typed: currentTyped,
          correct: normalizeTypingSentence(currentTyped) === normalizeTypingSentence(expected)
        }
      ];
    }

    if (!finalEntries.length) return;

    setTypingBusy(true);
    try {
      const typedSentences = finalEntries.map(entry => entry.typed);
      const res = await api.post(`/games/typing-sprint/${typingSession.sessionId}/submit`, {
        mode: 'sentence-stream',
        text: typedSentences.join('\n'),
        typedSentences
      });
      setTypingResult(res.data.result);
      setSummary(prev => ({ ...(prev || {}), typingStats: res.data.stats }));
      setTypingSession(null);
      setTypingSeconds(0);
      setTypingEntries([]);
      setTypingText('');
      const summaryRes = await api.get('/games/summary/me');
      setSummary(summaryRes.data);
      toast.success('Typing Sprint saved');
    } catch (err) {
      if (err.response?.status === 404) {
        toast.error('Backend is not updated yet. Redeploy Render backend first.');
      } else {
        toast.error(err.response?.data?.msg || 'Typing Sprint failed');
      }
    } finally {
      setTypingBusy(false);
    }
  }, [typingBusy, typingEntries, typingSession, typingText]);

  const advanceTypingSentence = useCallback((rawSentence, expectedIndex = null) => {
    if (!typingSession || typingBusy) return;
    const typed = String(rawSentence || '').trim();
    if (!typed) return;

    const sentences = getTypingSentences(typingSession);
    setTypingEntries(prev => {
      if (expectedIndex !== null && prev.length !== expectedIndex) return prev;
      const expected = sentences[prev.length];
      if (!expected) return prev;
      const next = [
        ...prev,
        {
          expected,
          typed,
          correct: normalizeTypingSentence(typed) === normalizeTypingSentence(expected)
        }
      ];
      if (next.length >= sentences.length) {
        window.setTimeout(() => submitTypingSprint(null, next), 0);
      }
      return next;
    });
    setTypingText('');
  }, [submitTypingSprint, typingBusy, typingSession]);

  const handleTypingTextChange = (event) => {
    const value = event.target.value;
    if (!typingSession || typingBusy) return;
    if (value.length < typingText.length) return;
    const sentences = getTypingSentences(typingSession);
    const expected = sentences[typingEntries.length] || '';
    const normalizedValue = normalizeTypingSentence(value);
    const normalizedExpected = normalizeTypingSentence(expected);

    setTypingText(value);

    if (normalizedValue && normalizedValue === normalizedExpected) {
      window.setTimeout(() => advanceTypingSentence(value, typingEntries.length), 120);
      return;
    }
  };

  const handleTypingKeyDown = (event) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      advanceTypingSentence(typingText, typingEntries.length);
    }
  };

  const handleTypingBeforeInput = (event) => {
    if (event.inputType?.startsWith('delete')) {
      event.preventDefault();
    }
  };

  const renderTypingPrompt = () => {
    if (!typingProgress.prompt) return 'Done';

    const promptChars = typingProgress.prompt.split('');
    const typedChars = typingProgress.typed.split('');
    const extraChars = typedChars.slice(promptChars.length);

    return (
      <>
        {promptChars.map((char, index) => {
          const typedChar = typedChars[index];
          const hasTyped = typeof typedChar === 'string';
          const isWrong = hasTyped && typedChar.toLowerCase() !== char.toLowerCase();
          const isCurrent = index === typedChars.length;

          return (
            <span
              key={`${char}-${index}`}
              className={`typing-prompt-char ${
                isWrong
                  ? 'is-wrong'
                  : hasTyped
                    ? 'is-correct'
                    : isCurrent
                      ? 'is-current'
                      : ''
              }`}
            >
              {char === ' ' ? '\u00A0' : char}
            </span>
          );
        })}
        {extraChars.map((char, index) => (
          <span key={`extra-${char}-${index}`} className="typing-prompt-char is-wrong">
            {char === ' ' ? '\u00A0' : char}
          </span>
        ))}
      </>
    );
  };

  useEffect(() => {
    if (!typingSession || typingResult) return undefined;
    const timer = setInterval(() => {
      const startedAt = new Date(typingSession.startedAt).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      setTypingSeconds(elapsed);
      if (elapsed >= (typingSession.durationSeconds || 60)) {
        submitTypingSprint(null);
      }
    }, 250);

    return () => clearInterval(timer);
  }, [submitTypingSprint, typingResult, typingSession]);

  const typingProgress = useMemo(() => {
    const sentences = getTypingSentences(typingSession);
    const prompt = sentences[typingEntries.length] || '';
    const typed = typingText || '';
    let mistakes = 0;

    for (let index = 0; index < typed.length; index += 1) {
      if ((typed[index] || '').toLowerCase() !== (prompt[index] || '').toLowerCase()) mistakes += 1;
    }

    const accuracy = typed.length
      ? Math.max(0, Math.round(((typed.length - mistakes) / typed.length) * 100))
      : 100;

    return {
      prompt,
      sentences,
      typed,
      mistakes,
      accuracy,
      correctCount: typingEntries.filter(entry => entry.correct).length,
      attemptedCount: typingEntries.length,
      remainingCount: Math.max(0, sentences.length - typingEntries.length),
      complete: Boolean(prompt) && normalizeTypingSentence(typed) === normalizeTypingSentence(prompt)
    };
  }, [typingEntries, typingSession, typingText]);
  const typingRemainingSeconds = typingSession
    ? Math.max(0, (typingSession.durationSeconds || 60) - typingSeconds)
    : 0;
  const typingInputWrong = Boolean(
    typingProgress.typed
    && typingProgress.prompt
    && !normalizeTypingSentence(typingProgress.prompt).startsWith(normalizeTypingSentence(typingProgress.typed))
  );

  const issueStats = useMemo(() => {
    const open = issues.filter(issue => !['approved', 'rejected', 'resolved', 'closed'].includes(issue.status)).length;
    const critical = issues.filter(issue => issue.severity === 'critical' || issue.severity === 'high').length;
    const resolved = issues.filter(issue => ['approved', 'resolved'].includes(issue.status)).length;
    return { open, critical, resolved };
  }, [issues]);
  const filteredIssues = useMemo(() => {
    const term = issueSearch.trim().toLowerCase();
    return issues.filter(issue => {
      const isOpen = !['approved', 'rejected', 'resolved', 'closed'].includes(issue.status);
      const statusMatch = issueStatusFilter === 'all'
        || (issueStatusFilter === 'open' ? isOpen : issue.status === issueStatusFilter);
      const searchable = [
        issue.title,
        issue.details,
        issue.expected,
        issue.type,
        issue.category,
        issue.severity,
        issue.status,
        issue.workspaceName,
        issue.userId?.name,
        issue.userId?.email
      ].filter(Boolean).join(' ').toLowerCase();
      return statusMatch && (!term || searchable.includes(term));
    });
  }, [issueSearch, issueStatusFilter, issues]);
  const issueStatusFilters = [
    ['all', 'All'],
    ['open', 'Open'],
    ['new', 'New'],
    ['reviewing', 'Reviewing'],
    ['approved', 'Approved'],
    ['resolved', 'Resolved'],
    ['rejected', 'Rejected'],
    ['closed', 'Closed']
  ];
  const developerQuickStatuses = ['reviewing', 'approved', 'resolved', 'rejected', 'closed'];

  const gameCards = [
    {
      key: 'blocks',
      title: 'Swipe Ninja',
      label: 'Arcade Swipe',
      description: 'Slice flying targets, avoid bombs, and build fast combo chains.',
      status: 'Live',
      best: summary?.blockStats?.highScore || 0,
      Logo: BlockGameLogo,
      accent: 'from-cyan-400 to-pink-500'
    },
    {
      key: 'jet-fighter',
      title: 'Jet Fighter',
      label: 'Air Combat',
      description: 'Drag the fighter, clear rival jets, and survive the launch run.',
      status: 'Live',
      best: summary?.jetFighterStats?.highScore || 0,
      Logo: JetFighterLogo,
      accent: 'from-cyan-300 to-rose-500'
    },
    {
      key: 'typing-race',
      title: 'Typing Race',
      label: 'Speed Typing',
      description: 'Race through Filipino, programming syntax, and English grammar rounds.',
      status: 'Live',
      best: summary?.typingStats?.highScore || 0,
      Logo: TypingGameLogo,
      accent: 'from-sky-500 to-emerald-400'
    },
    {
      key: 'reaction-tap',
      title: 'Reaction Tap',
      label: 'Tap Battle',
      description: 'Tap random targets before rivals. First to 20 points wins.',
      status: 'Live',
      best: summary?.reactionTapStats?.highScore || 0,
      Logo: ReactionTapLogo,
      accent: 'from-blue-500 to-emerald-400'
    },
    {
      key: 'focus-flow',
      title: 'Focus Flow',
      label: 'Timing Challenge',
      description: 'Lock the signal inside the focus zone.',
      status: 'Live',
      best: summary?.focusFlowStats?.highScore || 0,
      Logo: FocusFlowLogo,
      accent: 'from-emerald-400 to-cyan-400'
    },
    {
      key: 'bow-duel',
      title: 'Knife Duel',
      label: 'Online Knife Duel',
      description: 'HP-based multiplayer throwing with cinematic knife shots, leg trips, and blade upgrades.',
      status: 'Live',
      best: summary?.bowDuelStats?.highScore || 0,
      Logo: BowDuelLogo,
      accent: 'from-emerald-500 to-amber-400'
    },
  ];
  const liveGameCards = gameCards.filter(game => !game.disabled);

  const season = summary?.stats?.season;
  const seasonStart = season?.startsAt ? new Date(season.startsAt).getTime() : 0;
  const seasonEnd = season?.endsAt ? new Date(season.endsAt).getTime() : 0;
  const nowMs = Date.now();
  const seasonProgress = seasonStart && seasonEnd && seasonEnd > seasonStart
    ? Math.min(100, Math.max(0, Math.round(((nowMs - seasonStart) / (seasonEnd - seasonStart)) * 100)))
    : 0;
  const seasonDaysLeft = seasonEnd ? Math.max(0, Math.ceil((seasonEnd - nowMs) / 86400000)) : 0;
  const arenaMissions = [
    {
      label: 'Warm-up runs',
      value: `${Math.min(summary?.stats?.totalPlays || 0, 5)}/5`,
      complete: (summary?.stats?.totalPlays || 0) >= 5
    },
    {
      label: 'Score target',
      value: `${summary?.stats?.highScore || 0}/1000`,
      complete: (summary?.stats?.highScore || 0) >= 1000
    },
    {
      label: 'Accuracy mark',
      value: `${summary?.stats?.bestAccuracy || 0}%/80%`,
      complete: (summary?.stats?.bestAccuracy || 0) >= 80
    }
  ];

  const openArenaView = useCallback((view) => {
    triggerGameHubFeedback(8);
    if (view === 'games') setActiveGame('');
    setArenaView(view);
    if (!isConsoleOnly) {
      if (view === 'home' || view === 'games') setSearchParams({}, { replace: true });
      else setSearchParams({ view }, { replace: true });
    }
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, [isConsoleOnly, setSearchParams]);

  const openGame = useCallback((gameKey) => {
    triggerGameHubFeedback(14);
    navigate(`/arena/${gameKey}`);
  }, [navigate]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleNativeBack = (event) => {
      if (activeGame) {
        event.preventDefault();
        setActiveGame('');
        openArenaView('games');
        return;
      }

      if (!isConsoleOnly && arenaView !== 'home') {
        event.preventDefault();
        openArenaView('home');
      }
    };

    window.addEventListener('syncrova:native-back', handleNativeBack);
    return () => window.removeEventListener('syncrova:native-back', handleNativeBack);
  }, [activeGame, arenaView, isConsoleOnly, openArenaView]);

  const activeGameInfo = gameCards.find(game => game.key === activeGame) || null;
  const viewMeta = {
    home: {
      eyebrow: 'Play at your pace',
      title: 'Games',
      description: 'Choose a game, build your season score, and compare results when you are ready.'
    },
    games: {
      eyebrow: 'Games',
      title: activeGameInfo?.title || 'Games',
      description: 'Choose one game first. Nothing starts until you press the game start button.'
    },
    report: {
      eyebrow: 'Private member report',
      title: 'Report an Issue',
      description: 'Send a bug, problem, or suggestion privately to the developer team and track the response thread.'
    },
    developer: {
      eyebrow: 'Developer-only console',
      title: 'Developer Console',
      description: 'Review member submissions, reply privately, and approve, reject, or resolve reports in one focused console.'
    }
  }[arenaView] || {};

  if (loading) {
    return <PageSkeleton variant="cards" rows={6} />;
  }

  return (
    <div className="mobile-page mobile-tab-dock-page mx-auto max-w-7xl space-y-4 px-0 py-1 sm:space-y-6 sm:px-6 sm:py-4 lg:px-8">
      <section className={`${arenaView === 'home' ? 'overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900' : `fix-arena-hero overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 ${arenaView === 'report' || arenaView === 'developer' ? 'fix-report-hero' : ''}`}`}>
        <div className={`grid gap-4 p-5 md:p-6 ${arenaView === 'home' ? '' : arenaView === 'report' || arenaView === 'developer' ? '2xl:grid-cols-[minmax(0,1fr)_340px] 2xl:items-center' : 'xl:grid-cols-[minmax(0,1fr)_340px] xl:items-center'}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <ArenaMark />
            <div className="min-w-0">
              {arenaView !== 'home' && !isConsoleOnly && (
                <button
                  type="button"
                  onClick={() => openArenaView('home')}
                  className="mb-3 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-black uppercase text-gray-700 transition hover:bg-blue-50 hover:text-[#1877f2] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-blue-950/30"
                >
                  <ArrowLeft size={15} />
                  Back to Games
                </button>
              )}
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase text-[#1877f2] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-900/60">
                <Code2 size={14} />
                {viewMeta.eyebrow}
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-normal text-gray-950 dark:text-white md:text-4xl">{viewMeta.title}</h1>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-gray-500 dark:text-gray-400">
                {viewMeta.description}
              </p>
            </div>
          </div>

          {arenaView !== 'home' && (
            <div className="hidden rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/60 xl:block">
              <GameRankBadge stats={summary?.stats} showProgress />
            </div>
          )}
        </div>
      </section>

      {arenaView === 'home' && (
        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-[#0b57d0] dark:text-blue-200">Pick a game</p>
                  <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">Play now</h2>
                  <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">Each game opens in its own focused play view.</p>
                </div>
                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-[#0b57d0] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-900/50">
                  <Gamepad2 size={15} />
                  {liveGameCards.length} available
                </span>
              </div>

              <div className="grid gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-3">
                {liveGameCards.map(game => {
                  const Logo = game.Logo;
                  return (
                    <button
                      key={game.key}
                      type="button"
                      onClick={() => openGame(game.key)}
                      className="group flex min-h-[11.5rem] min-w-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg hover:shadow-blue-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-blue-700"
                      data-game={game.key}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <Logo compact />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">{game.label}</span>
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">Live</span>
                          </div>
                          <h3 className="mt-1 truncate text-lg font-black text-slate-950 dark:text-white">{game.title}</h3>
                          <p className="mt-1 line-clamp-2 text-sm font-medium leading-5 text-slate-500 dark:text-slate-400">{game.description}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Best <strong className="ml-1 text-slate-950 dark:text-white">{game.best || 0}</strong></span>
                        <span className="inline-flex items-center gap-1 font-black text-[#0b57d0] transition group-hover:gap-2 dark:text-blue-200">Play <ArrowRight size={16} /></span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-amber-600 dark:text-amber-300">This season</p>
                  <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Leaderboard</h2>
                </div>
                <Crown className="text-amber-500" size={21} />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {(summary?.leaderboard || []).slice(0, 8).map(entry => {
                  const avatar = resolveMediaUrl(entry.user?.avatar);
                  return (
                    <button key={entry.user?._id || entry.position} type="button" onClick={() => setProfileUser(entry.user)} className="flex min-w-0 items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5 text-left transition hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-950/70 dark:hover:bg-blue-950/25">
                      <span className="w-6 shrink-0 text-center text-xs font-black text-slate-400">#{entry.position}</span>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-sm font-black text-[#0b57d0] dark:bg-blue-950/50 dark:text-blue-200">
                        {avatar ? <img src={avatar} alt={entry.user?.name || 'User'} className="h-full w-full object-cover" /> : entry.user?.name?.charAt(0)?.toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="hidden">
                        <span className="block truncate text-sm font-black text-slate-950 dark:text-white">{entry.user?.name || 'User'}</span>
                        <span className="block truncate text-xs font-medium text-slate-500 dark:text-slate-400">{entry.stats?.rank?.shortName || entry.stats?.rank?.name || 'Unranked'} · {entry.stats?.totalPlays || 0} runs</span>
                        </span>
                        <span className="block truncate text-sm font-black text-slate-950 dark:text-white">{entry.user?.name || 'User'}</span>
                        <span className="block truncate text-xs font-medium text-slate-500 dark:text-slate-400">{entry.stats?.rank?.shortName || entry.stats?.rank?.name || 'Unranked'} / {entry.stats?.totalPlays || 0} runs</span>
                      </span>
                      <span className="shrink-0 text-sm font-black text-slate-950 dark:text-white">{entry.stats?.highScore || 0}</span>
                    </button>
                  );
                })}
                {(summary?.leaderboard || []).length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-400 md:col-span-2">
                    Be the first to set a score.
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="min-w-0 space-y-4 xl:sticky xl:top-20 xl:self-start">
            <GameRankBadge stats={summary?.stats} showProgress />

            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-[#0b57d0] dark:text-blue-200">Season progress</p>
                  <h3 className="mt-1 font-black text-slate-950 dark:text-white">{season?.label || 'Current season'}</h3>
                </div>
                <span className="hidden">
                <span className="rounded-xl bg-blue-50 px-2.5 py-1.5 text-xs font-black text-[#0b57d0] dark:bg-blue-950/30 dark:text-blue-200">{seasonDaysLeft || '—'} days</span>
                </span>
                <span className="rounded-xl bg-blue-50 px-2.5 py-1.5 text-xs font-black text-[#0b57d0] dark:bg-blue-950/30 dark:text-blue-200">{seasonDaysLeft || '-'} days</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-[#1877f2] transition-all" style={{ width: `${Math.max(2, seasonProgress)}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950/70">
                  <p className="text-[11px] font-bold uppercase text-slate-400">Score</p>
                  <p className="mt-1 text-lg font-black text-slate-950 dark:text-white">{summary?.stats?.seasonScore || 0}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950/70">
                  <p className="text-[11px] font-bold uppercase text-slate-400">Best</p>
                  <p className="mt-1 text-lg font-black text-slate-950 dark:text-white">{summary?.stats?.highScore || 0}</p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex items-center gap-2">
                <Target size={18} className="text-[#0b57d0]" />
                <h3 className="font-black text-slate-950 dark:text-white">Your goals</h3>
              </div>
              <div className="space-y-2">
                {arenaMissions.map(mission => (
                  <div key={mission.label} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2.5 dark:bg-slate-950/70">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{mission.label}</span>
                      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">{mission.value}</span>
                    </span>
                    <CheckCircle2 size={18} className={mission.complete ? 'shrink-0 text-emerald-500' : 'shrink-0 text-slate-300 dark:text-slate-600'} />
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
      )}

      {arenaView === 'games' && (
      <section className="mobile-game-shell overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <div className="border-b border-gray-100 p-5 dark:border-gray-800">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase text-pink-500">Games</p>
              <h2 className="mt-1 text-2xl font-black tracking-normal text-gray-950 dark:text-white">Choose a game to play</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Scores from every live game contribute to your season rank.</p>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-2xl bg-gray-100 px-3 py-2 text-xs font-black uppercase text-gray-600 dark:bg-gray-950 dark:text-gray-300">
              <Gamepad2 size={16} />
              More games will be added soon
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-[#07036f] via-[#0b57d0] to-[#2387a8] p-5 text-white shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-xs font-black uppercase ring-1 ring-white/15">
                    <Crown size={14} />
                    {season?.label || 'Current season'}
                  </p>
                  <h2 className="mt-3 text-2xl font-black tracking-normal">Games Season</h2>
                  <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-white/75">
                    Every ranked run counts toward your season score, rewards, profile frame, and leaderboard.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center sm:min-w-56">
                  <div className="rounded-2xl bg-white/12 p-3 ring-1 ring-white/10">
                    <p className="text-2xl font-black">{summary?.stats?.seasonScore || 0}</p>
                    <p className="text-[11px] font-black uppercase text-white/60">Season score</p>
                  </div>
                  <div className="rounded-2xl bg-white/12 p-3 ring-1 ring-white/10">
                    <p className="text-2xl font-black">{seasonDaysLeft || '-'}</p>
                    <p className="text-[11px] font-black uppercase text-white/60">Days left</p>
                  </div>
                </div>
              </div>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-white transition-all" style={{ width: `${seasonProgress || 2}%` }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-white/70">
                <span>Highest: {summary?.stats?.highestRank?.shortName || summary?.stats?.highestRank?.name || 'Recruit'}</span>
                <span>Previous: {summary?.stats?.previousSeasonRank?.shortName || 'Recruit'}</span>
                <span>Reward: {summary?.stats?.rewards?.current?.title || 'Rank reward'}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-blue-200">Season missions</p>
                  <h3 className="font-black text-gray-950 dark:text-white">Weekly push</h3>
                </div>
                <Target className="text-[#0b57d0]" size={22} />
              </div>
              <div className="space-y-2">
                {arenaMissions.map(mission => (
                  <div key={mission.label} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-gray-900">
                    <span className="min-w-0">
                      <span className="block text-sm font-black text-gray-950 dark:text-white">{mission.label}</span>
                      <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400">{mission.value}</span>
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${mission.complete ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200' : 'bg-blue-50 text-[#0b57d0] dark:bg-blue-950/30 dark:text-blue-200'}`}>
                      {mission.complete ? 'Done' : 'Active'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="mobile-game-tabs grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {gameCards.map(game => {
              const Logo = game.Logo;
              const isActive = activeGame === game.key;
              return (
                <button
                  key={game.key}
                  type="button"
                  disabled={game.disabled}
                  onClick={() => !game.disabled && openGame(game.key)}
                  className={`group relative min-w-0 overflow-hidden rounded-2xl border p-3 text-left transition ${
                    isActive
                      ? 'border-pink-200 bg-pink-50 shadow-lg shadow-pink-500/10 ring-1 ring-pink-200/70 dark:border-pink-900/70 dark:bg-pink-950/20 dark:ring-pink-500/20'
                      : 'border-gray-100 bg-gray-50 hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-cyan-50 dark:border-gray-800 dark:bg-gray-950/50 dark:hover:border-cyan-900/70 dark:hover:bg-cyan-950/20'
                  } disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${game.accent} ${isActive ? 'opacity-100' : 'opacity-0'} transition group-hover:opacity-100`} />
                  <div className="flex items-center gap-3">
                    <Logo compact />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full bg-gradient-to-r ${game.accent} px-2 py-0.5 text-[10px] font-black uppercase text-white`}>
                          {game.status}
                        </span>
                        <span className="truncate text-[11px] font-black uppercase text-gray-400">{game.label}</span>
                      </div>
                      <h3 className="mt-1 truncate text-base font-black text-gray-950 dark:text-white">{game.title}</h3>
                      <p className="mt-1 line-clamp-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{game.description}</p>
                    </div>
                  </div>
                  {game.best !== null && (
                    <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs font-black text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                      <span>Best score</span>
                      <span className="text-gray-950 dark:text-white">{game.best}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {activeGame && (
          <div className="mobile-game-active grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
            <Suspense fallback={<LoadingSpinner label="Loading game" />}>
            {!activeGame && (
              <section className="grid min-h-[28rem] place-items-center overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900">
                <div className="max-w-md">
                  <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-blue-50 text-[#1877f2] ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-900/60">
                    <Gamepad2 size={28} />
                  </span>
                  <h2 className="mt-4 text-2xl font-black text-gray-950 dark:text-white">Select a game</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-gray-500 dark:text-gray-400">
                    Tap a live game card above to open its own play page.
                  </p>
                </div>
              </section>
            )}

            {activeGame === 'blocks' && (
              <BlockStackGame stats={summary} onScoreSaved={() => loadArena({ silent: true })} onExit={() => openArenaView('home')} />
            )}

            {activeGame === 'jet-fighter' && (
              <JetFighterGame stats={summary} onScoreSaved={() => loadArena({ silent: true })} onExit={() => openArenaView('home')} />
            )}

            {activeGame === 'typing' && (
              <section className="mobile-typing-game overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
                <div className="border-b border-gray-100 p-5 dark:border-gray-800">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-4">
                      <TypingGameLogo />
                      <div>
                        <p className="text-xs font-black uppercase text-yellow-500">Speed Challenge</p>
                        <h2 className="text-2xl font-black tracking-normal text-gray-950 dark:text-white">Typing Sprint</h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Type the live sentence. Wrong letters turn red and the next sentence appears automatically.</p>
                      </div>
                    </div>
                    <button onClick={startTypingSprint} disabled={typingBusy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-gray-800 disabled:opacity-60 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200">
                      <Play size={17} fill="currentColor" />
                      {typingSession ? 'Restart' : 'Start'}
                    </button>
                  </div>
                </div>

                <div className="p-5">
                  <div className="rounded-3xl bg-gray-50 p-5 dark:bg-gray-950/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Live Sentence Stream</p>
                      {typingSession && (
                        <span className="inline-flex items-center gap-2 rounded-xl bg-cyan-50 px-3 py-2 text-sm font-black text-cyan-700 ring-1 ring-cyan-100 dark:bg-cyan-950/30 dark:text-cyan-200 dark:ring-cyan-900/60">
                          <Clock size={16} />
                          {typingRemainingSeconds}s left
                        </span>
                      )}
                    </div>
                    {typingSession ? (
                      <>
                        <div className="mt-3 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
                          <div className="flex flex-wrap gap-2">
                            {typingEntries.slice(-10).map((entry, index) => (
                              <span key={`${entry.expected}-${index}`} className={`rounded-xl px-3 py-1.5 text-sm font-black ring-1 ${
                                entry.correct
                                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/60'
                                  : 'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-950/30 dark:text-rose-200 dark:ring-rose-900/60'
                              }`}>
                                {entry.typed}
                              </span>
                            ))}
                          </div>
                          <div className="mt-5 text-center">
                            <p className="text-xs font-black uppercase text-gray-400">Current sentence</p>
                            <motion.div
                              key={typingProgress.prompt}
                              initial={{ opacity: 0, y: 10, scale: 0.96 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              className="mobile-typing-prompt mx-auto mt-2 w-full max-w-none rounded-3xl bg-white px-4 py-4 text-left text-xl font-black leading-9 tracking-normal text-gray-950 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900 dark:text-white dark:ring-gray-800 md:text-3xl md:leading-10"
                            >
                              {renderTypingPrompt()}
                            </motion.div>
                            <div className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                              <motion.div
                                animate={{ width: `${Math.min(100, (typingEntries.length / Math.max(1, typingProgress.sentences.length)) * 100)}%` }}
                                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-pink-500 to-emerald-400"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <div className="rounded-2xl bg-white p-3 text-sm dark:bg-gray-900">
                            <p className="text-xs font-black uppercase text-gray-400">Accuracy</p>
                            <p className={`mt-1 text-xl font-black ${typingInputWrong ? 'text-rose-500' : 'text-emerald-500'}`}>{typingProgress.attemptedCount ? Math.round((typingProgress.correctCount / typingProgress.attemptedCount) * 100) : 100}%</p>
                          </div>
                          <div className="rounded-2xl bg-white p-3 text-sm dark:bg-gray-900">
                            <p className="text-xs font-black uppercase text-gray-400">Correct</p>
                            <p className="mt-1 text-xl font-black text-gray-950 dark:text-white">{typingProgress.correctCount}/{typingProgress.attemptedCount}</p>
                          </div>
                          <div className="rounded-2xl bg-white p-3 text-sm dark:bg-gray-900">
                            <p className="text-xs font-black uppercase text-gray-400">Sentences left</p>
                            <p className="mt-1 text-xl font-black text-gray-950 dark:text-white">{typingProgress.remainingCount}</p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="mt-3 text-lg font-black leading-8 text-gray-950 dark:text-white">
                        Start a sprint to receive a professional project prompt.
                      </p>
                    )}
                  </div>

                  <form onSubmit={submitTypingSprint} className="mt-4 space-y-3">
                    <input value={typingText} onChange={handleTypingTextChange} onKeyDown={handleTypingKeyDown} onBeforeInput={handleTypingBeforeInput} disabled={!typingSession || typingBusy} type="text" autoCapitalize="none" autoCorrect="off" spellCheck="false" inputMode="text" placeholder="Type here..." className={`mobile-typing-input w-full rounded-2xl border bg-white px-4 py-4 text-lg font-black leading-8 text-gray-900 outline-none disabled:bg-gray-50 dark:bg-gray-950 dark:text-white dark:disabled:bg-gray-900 ${
                      typingInputWrong
                        ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-rose-900/70 dark:focus:ring-rose-950'
                        : 'border-gray-200 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 dark:border-gray-700 dark:focus:ring-cyan-950'
                    }`} />
                    <p className={`text-xs font-bold ${typingInputWrong ? 'text-rose-500' : 'text-gray-500 dark:text-gray-400'}`}>
                      Backspace is locked during a sprint. Keep going until the timer ends.
                    </p>
                    <button disabled={!typingSession || typingBusy || (!typingEntries.length && !typingText.trim())} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-black text-white transition hover:bg-cyan-700 disabled:opacity-50">
                      <Zap size={17} />
                      Finish Early
                    </button>
                  </form>

                  {typingResult && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-4">
                      <div className="rounded-2xl bg-yellow-50 p-4 dark:bg-yellow-950/20">
                        <p className="text-xs font-black uppercase text-yellow-700 dark:text-yellow-200">Score</p>
                        <p className="mt-1 text-2xl font-black text-gray-950 dark:text-white">{typingResult.score}</p>
                      </div>
                      <div className="rounded-2xl bg-cyan-50 p-4 dark:bg-cyan-950/20">
                        <p className="text-xs font-black uppercase text-cyan-700 dark:text-cyan-200">WPM</p>
                        <p className="mt-1 text-2xl font-black text-gray-950 dark:text-white">{typingResult.wpm}</p>
                      </div>
                      <div className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/20">
                        <p className="text-xs font-black uppercase text-emerald-700 dark:text-emerald-200">Accuracy</p>
                        <p className="mt-1 text-2xl font-black text-gray-950 dark:text-white">{typingResult.accuracy}%</p>
                      </div>
                      <div className="rounded-2xl bg-gray-50 p-4 dark:bg-gray-950/50">
                        <p className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Time</p>
                        <p className="mt-1 text-2xl font-black text-gray-950 dark:text-white">{formatElapsed(typingResult.elapsedMs)}</p>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeGame === 'focus-flow' && (
              <FocusFlowGame stats={summary} onScoreSaved={() => loadArena({ silent: true })} onExit={() => openArenaView('home')} />
            )}
            </Suspense>
            </div>

            <aside className="grid min-w-0 gap-4 md:grid-cols-2 2xl:block 2xl:space-y-4">
              <GameRankBadge stats={summary?.stats} />
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/50">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-gradient-to-br from-cyan-400 to-pink-500 p-3 text-white shadow-lg shadow-cyan-500/10">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-black text-gray-950 dark:text-white">Games Progress</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Play live games to raise your rank.</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-black">
                  <div className="rounded-xl bg-white p-3 dark:bg-gray-900">
                    <p className="text-gray-500 dark:text-gray-400">Runs</p>
                    <p className="mt-1 text-lg text-gray-950 dark:text-white">{summary?.stats?.totalPlays || 0}</p>
                  </div>
                  <div className="rounded-xl bg-white p-3 dark:bg-gray-900">
                    <p className="text-gray-500 dark:text-gray-400">Best</p>
                    <p className="mt-1 text-lg text-gray-950 dark:text-white">{summary?.stats?.highScore || 0}</p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
          )}
        </div>

        <div className="border-t border-gray-100 p-4 dark:border-gray-800">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-black text-gray-950 dark:text-white">Games Leaderboard</h2>
            <Crown className="text-yellow-500" size={22} />
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {(summary?.leaderboard || []).slice(0, 8).map(entry => {
              const avatar = resolveMediaUrl(entry.user?.avatar);
              return (
                <button key={entry.user?._id || entry.position} type="button" onClick={() => setProfileUser(entry.user)} className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3 text-left transition hover:border-cyan-200 hover:bg-cyan-50 dark:border-gray-800 dark:bg-gray-950/50 dark:hover:border-cyan-900/60 dark:hover:bg-cyan-950/20">
                  <span className="w-7 text-center text-sm font-black text-gray-500 dark:text-gray-400">#{entry.position}</span>
                  <span className="grid h-14 w-14 shrink-0 place-items-center overflow-visible">
                    <GameRankEmblem rank={entry.stats?.rank} size="sm" animated stars={entry.stats?.apexStars} />
                  </span>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-cyan-500 to-pink-500 text-sm font-bold text-white">
                    {avatar ? <img src={avatar} alt={entry.user?.name || 'User'} className="h-full w-full object-cover" /> : entry.user?.name?.charAt(0)?.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-gray-950 dark:text-white">{entry.user?.name || 'User'}</span>
                    <span className="block truncate text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {entry.stats?.totalPlays || 0} runs - {entry.stats?.bestAccuracy || 0}% best
                    </span>
                  </span>
                  <span className="text-sm font-black text-gray-950 dark:text-white">{entry.stats?.highScore || 0}</span>
                </button>
              );
            })}
            {(summary?.leaderboard || []).length === 0 && (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-950/50 dark:text-gray-400 md:col-span-2 xl:col-span-4">
                No game scores yet.
              </div>
            )}
          </div>
        </div>
      </section>
      )}

      {(arenaView === 'report' || arenaView === 'developer') && (
        <section className="fix-report-shell space-y-5">
          {arenaView === 'developer' && !isDeveloper && (
            <section className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
              <div className="border-b border-gray-100 p-5 dark:border-gray-800 sm:p-6">
                <div className="flex items-center gap-4">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gray-950 text-white dark:bg-white dark:text-gray-950">
                    <ShieldCheck size={25} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-black text-gray-950 dark:text-white">Developer Access</h2>
                    <p className="mt-1 text-sm font-semibold text-gray-500 dark:text-gray-400">This console is restricted to developer accounts.</p>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 p-5 dark:bg-gray-950/30 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6">
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300">
                  Developer access is assigned by the backend allowlist or server admin command. Sign in with an assigned admin account, then refresh access.
                </div>
                <button
                  type="button"
                  onClick={() => loadArena({ silent: true })}
                  className="h-12 rounded-2xl bg-[#1877f2] px-6 text-sm font-black text-white transition hover:bg-[#0f63d5]"
                >
                  Refresh Access
                </button>
              </div>
            </section>
          )}

          {arenaView === 'developer' && isDeveloper && (
            <section className="overflow-hidden rounded-3xl border border-gray-800 bg-gray-950 text-white shadow-sm">
              <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-center">
                <div className="flex items-start gap-4">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/10 text-cyan-200 ring-1 ring-white/10">
                    <ShieldCheck size={26} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-wide text-cyan-200">Developer console</p>
                    <h2 className="mt-1 text-2xl font-black">Report Console</h2>
                    <p className="mt-1 max-w-2xl text-sm font-semibold text-white/65">Review member reports, update status, reply privately, and remove requests that are already handled.</p>
                  </div>
                </div>
                <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                  <p className="text-xs font-black uppercase text-white/55">Signed in as developer</p>
                  <p className="mt-1 truncate text-base font-black">{developerInfo?.user?.name || 'Developer'}</p>
                  <p className="mt-1 text-xs font-semibold text-emerald-200">Console access active</p>
                </div>
              </div>
              <div className="grid border-t border-white/10 sm:grid-cols-3">
                <div className="p-4 sm:p-5">
                  <p className="text-3xl font-black">{issues.length}</p>
                  <p className="text-xs font-bold uppercase text-white/55">Total reports</p>
                </div>
                <div className="border-t border-white/10 p-4 sm:border-l sm:border-t-0 sm:p-5">
                  <p className="text-3xl font-black">{issueStats.open}</p>
                  <p className="text-xs font-bold uppercase text-white/55">Open queue</p>
                </div>
                <div className="border-t border-white/10 p-4 sm:border-l sm:border-t-0 sm:p-5">
                  <p className="text-3xl font-black">{issueStats.critical}</p>
                  <p className="text-xs font-bold uppercase text-white/55">High priority</p>
                </div>
              </div>
            </section>
          )}

          {arenaView === 'developer' && isDeveloper && (
            <section className="grid gap-5 overflow-hidden rounded-3xl border border-blue-100 bg-white p-5 shadow-sm dark:border-blue-900/40 dark:bg-gray-900 sm:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
              <div className="min-w-0">
                <div className="flex items-start gap-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-[#1877f2] ring-1 ring-blue-100 dark:bg-blue-950/35 dark:text-sky-200 dark:ring-blue-500/20">
                    <KeyRound size={22} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase text-[#1877f2] dark:text-sky-200">Account recovery</p>
                    <h3 className="mt-1 text-lg font-black text-gray-950 dark:text-white">Generate password reset link</h3>
                    <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-gray-500 dark:text-gray-400">
                      Admins and developers cannot view old passwords. Send this one-time reset link to the verified owner of the account.
                    </p>
                  </div>
                </div>
                {passwordResetResult?.resetUrl && (
                  <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/25">
                    <p className="text-xs font-black uppercase text-blue-700 dark:text-sky-200">
                      Ready for {passwordResetResult.user?.name || passwordResetResult.user?.email || 'user'}
                    </p>
                    <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row">
                      <input
                        readOnly
                        value={passwordResetResult.resetUrl}
                        className="h-10 min-w-0 flex-1 rounded-xl border border-blue-100 bg-white px-3 text-xs font-semibold text-gray-700 outline-none dark:border-blue-900/50 dark:bg-gray-950 dark:text-gray-200"
                      />
                      <button
                        type="button"
                        onClick={() => copyPasswordResetLink()}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#1877f2] px-4 text-xs font-black text-white transition hover:bg-[#0f63d5]"
                      >
                        <Copy size={14} />
                        Copy
                      </button>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-blue-700/80 dark:text-sky-200/80">
                      Expires {passwordResetResult.expiresAt ? formatDateTime(passwordResetResult.expiresAt) : 'soon'}.
                    </p>
                  </div>
                )}
              </div>
              <form onSubmit={generatePasswordResetLink} className="grid content-start gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/60">
                <label className="grid gap-1.5">
                  <span className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">User email</span>
                  <input
                    type="email"
                    value={passwordResetEmail}
                    onChange={event => setPasswordResetEmail(event.target.value)}
                    placeholder="student@nemsu.edu.ph"
                    className="h-11 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 outline-none focus:border-[#1877f2] focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                  />
                </label>
                <button
                  type="submit"
                  disabled={generatingPasswordReset}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-gray-950 px-5 text-sm font-black text-white transition hover:bg-[#1877f2] disabled:opacity-60 dark:bg-white dark:text-gray-950 dark:hover:bg-blue-100"
                >
                  <KeyRound size={16} />
                  {generatingPasswordReset ? 'Generating...' : 'Generate Reset Link'}
                </button>
              </form>
            </section>
          )}

          {arenaView === 'report' && (
            <section className="fix-report-submit-grid grid gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
                <div className="border-b border-gray-100 p-5 dark:border-gray-800 sm:p-6">
                  <div className="flex items-center gap-4">
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-pink-500 to-cyan-500 text-white shadow-lg shadow-pink-500/20">
                      <Bug size={25} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-xl font-black text-gray-950 dark:text-white">Submit a Problem</h2>
                      <p className="mt-1 text-sm font-semibold text-gray-500 dark:text-gray-400">Create a private report thread for the developer team.</p>
                    </div>
                  </div>
                </div>

                {isDeveloper ? (
                  <div className="m-5 rounded-2xl border border-cyan-100 bg-cyan-50 p-4 text-sm font-bold text-cyan-800 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-200 sm:m-6">
                    Developer accounts review reports only. Regular members can submit problems and suggestions.
                  </div>
                ) : (
                  <form onSubmit={submitReport} className="grid gap-4 p-5 sm:p-6">
                    <div className="grid gap-4 md:grid-cols-3">
                      <label className="grid gap-1.5">
                        <span className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Type</span>
                        <select value={reportForm.type} onChange={event => setReportForm(prev => ({ ...prev, type: event.target.value }))} className="h-11 rounded-2xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:border-[#1877f2] focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                          <option value="problem">Problem</option>
                          <option value="suggestion">Suggestion</option>
                        </select>
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Area</span>
                        <select value={reportForm.category} onChange={event => setReportForm(prev => ({ ...prev, category: event.target.value }))} className="h-11 rounded-2xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:border-[#1877f2] focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                          {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Priority</span>
                        <select value={reportForm.severity} onChange={event => setReportForm(prev => ({ ...prev, severity: event.target.value }))} className="h-11 rounded-2xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:border-[#1877f2] focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </label>
                    </div>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Related page</span>
                      <input value={reportForm.workspaceName} onChange={event => setReportForm(prev => ({ ...prev, workspaceName: event.target.value }))} placeholder="Messages, Dashboard, Games..." className="h-11 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 outline-none focus:border-[#1877f2] focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Summary</span>
                      <input value={reportForm.title} onChange={event => setReportForm(prev => ({ ...prev, title: event.target.value }))} placeholder="Short title" className="h-11 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 outline-none focus:border-[#1877f2] focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Details</span>
                      <textarea value={reportForm.details} onChange={event => setReportForm(prev => ({ ...prev, details: event.target.value }))} rows="5" placeholder="What happened? Include the page, action, and exact behavior." className="resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-900 outline-none focus:border-[#1877f2] focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Expected result</span>
                      <textarea value={reportForm.expected} onChange={event => setReportForm(prev => ({ ...prev, expected: event.target.value }))} rows="3" placeholder="What should happen instead?" className="resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-900 outline-none focus:border-[#1877f2] focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                    </label>
                    <button disabled={submittingReport} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#1877f2] px-5 text-sm font-black text-white transition hover:bg-[#0f63d5] disabled:opacity-60">
                      <Send size={17} />
                      {submittingReport ? 'Submitting...' : 'Submit Report'}
                    </button>
                  </form>
                )}
              </div>

              <aside className="fix-report-status-grid grid gap-4 md:grid-cols-2 2xl:block 2xl:space-y-4">
                <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                  <p className="text-sm font-black text-gray-950 dark:text-white">Report status</p>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-2xl bg-gray-50 p-3 text-center dark:bg-gray-950/50">
                      <p className="text-xl font-black text-gray-950 dark:text-white">{issues.length}</p>
                      <p className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Sent</p>
                    </div>
                    <div className="rounded-2xl bg-amber-50 p-3 text-center dark:bg-amber-950/20">
                      <p className="text-xl font-black text-amber-700 dark:text-amber-200">{issueStats.open}</p>
                      <p className="text-[11px] font-bold uppercase text-amber-700/70 dark:text-amber-200/70">Open</p>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 p-3 text-center dark:bg-emerald-950/20">
                      <p className="text-xl font-black text-emerald-700 dark:text-emerald-200">{issueStats.resolved}</p>
                      <p className="text-[11px] font-bold uppercase text-emerald-700/70 dark:text-emerald-200/70">Done</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                  <p className="text-sm font-black text-gray-950 dark:text-white">Quality checklist</p>
                  <div className="mt-4 space-y-3 text-sm font-semibold text-gray-600 dark:text-gray-300">
                    {['Clear title', 'Exact page or feature', 'What happened', 'Expected result'].map(item => (
                      <div key={item} className="flex items-center gap-3">
                        <CheckCircle2 size={17} className="text-emerald-500" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </section>
          )}

          {(arenaView === 'report' || (arenaView === 'developer' && isDeveloper)) && (
            <section className="fix-report-workspace-grid grid min-w-0 gap-5 2xl:grid-cols-[360px_minmax(0,1fr)]">
              <aside className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
                <div className="border-b border-gray-100 p-5 dark:border-gray-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-black text-gray-950 dark:text-white">{isDeveloper ? 'Developer Inbox' : 'My Reports'}</h2>
                      <p className="mt-1 text-sm font-semibold text-gray-500 dark:text-gray-400">{filteredIssues.length} of {issues.length} shown</p>
                    </div>
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-[#1877f2] dark:bg-blue-950/30 dark:text-blue-200">
                      <MessageCircle size={18} />
                    </span>
                  </div>
                  <label className="relative mt-4 block">
                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={issueSearch}
                      onChange={event => setIssueSearch(event.target.value)}
                      placeholder="Search reports"
                      className="h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-sm font-semibold text-gray-900 outline-none transition focus:border-[#1877f2] focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                    />
                  </label>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {issueStatusFilters.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setIssueStatusFilter(value)}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${
                          issueStatusFilter === value
                            ? 'bg-[#1877f2] text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-[#1877f2] dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-blue-950/30'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="fix-report-inbox-list max-h-[28rem] overflow-y-auto p-3 2xl:max-h-[72svh]">
                  {filteredIssues.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm font-semibold text-gray-500 dark:border-gray-700 dark:bg-gray-950/50 dark:text-gray-400">
                      {issues.length ? 'No reports match this view.' : isDeveloper ? 'No member reports yet.' : 'No submitted reports yet.'}
                    </div>
                  ) : filteredIssues.map(issue => {
                    const isActive = getEntityId(issue) === getEntityId(selectedIssue);
                    return (
                      <button
                        key={issue._id}
                        type="button"
                        onClick={() => setSelectedIssueId(issue._id)}
                        className={`mb-2 w-full rounded-2xl border p-4 text-left transition ${
                          isActive
                            ? 'border-[#1877f2] bg-blue-50 shadow-sm dark:border-blue-800 dark:bg-blue-950/30'
                            : 'border-gray-100 bg-gray-50 hover:border-blue-200 hover:bg-blue-50 dark:border-gray-800 dark:bg-gray-950/50 dark:hover:border-blue-900/60 dark:hover:bg-blue-950/20'
                        }`}
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-black uppercase ring-1 ${severityStyles[issue.severity] || severityStyles.medium}`}>
                            {issue.severity}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-black uppercase ring-1 ${statusStyles[issue.status] || statusStyles.new}`}>
                            {issue.status}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-sm font-black text-gray-950 dark:text-white">{issue.title}</p>
                        <p className="mt-2 line-clamp-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                          {issue.type} - {issue.category} - {isDeveloper ? issue.userId?.name || 'Member' : `${(issue.messages || []).length} thread updates`}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <div className="fix-report-detail-panel min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
                {selectedIssue ? (
                  <>
                    <div className="border-b border-gray-100 p-5 dark:border-gray-800 sm:p-6">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-black uppercase ring-1 ${severityStyles[selectedIssue.severity] || severityStyles.medium}`}>{selectedIssue.severity}</span>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-black uppercase ring-1 ${statusStyles[selectedIssue.status] || statusStyles.new}`}>{selectedIssue.status}</span>
                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black uppercase text-gray-600 dark:bg-gray-800 dark:text-gray-300">{selectedIssue.category}</span>
                          </div>
                          <h2 className="text-xl font-black text-gray-950 dark:text-white">{selectedIssue.title}</h2>
                          <p className="mt-1 text-sm font-semibold text-gray-500 dark:text-gray-400">
                            Submitted by {selectedIssue.userId?.name || 'Member'} - {formatDateTime(selectedIssue.createdAt)}
                          </p>
                        </div>
                        {isDeveloper && (
                          <div className="flex flex-wrap gap-2 xl:justify-end">
                            {developerQuickStatuses.map(status => (
                              <button
                                key={status}
                                type="button"
                                onClick={() => updateStatus(selectedIssue._id, status)}
                                disabled={selectedIssue.status === status}
                                className={`rounded-full px-3 py-2 text-xs font-black capitalize transition ${
                                  selectedIssue.status === status
                                    ? 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                                    : 'bg-gray-950 text-white hover:bg-[#1877f2] dark:bg-white dark:text-gray-950 dark:hover:bg-blue-100'
                                }`}
                              >
                                {status}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => deleteIssue(selectedIssue._id)}
                              disabled={deletingIssueId === selectedIssue._id}
                              className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-3 py-2 text-xs font-black text-white transition hover:bg-rose-700 disabled:opacity-60"
                            >
                              <Trash2 size={14} />
                              {deletingIssueId === selectedIssue._id ? 'Deleting' : 'Delete'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="fix-report-detail-grid grid min-w-0 gap-4 p-5 sm:p-6 2xl:grid-cols-[minmax(0,1fr)_300px]">
                      <div className="min-w-0 space-y-4">
                        <div className="rounded-2xl bg-gray-50 p-4 dark:bg-gray-950/50">
                          <p className="text-sm font-black text-gray-950 dark:text-white">Report details</p>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-600 dark:text-gray-300">{selectedIssue.details}</p>
                        </div>
                        {selectedIssue.expected && (
                          <div className="rounded-2xl bg-blue-50 p-4 dark:bg-blue-950/20">
                            <p className="text-sm font-black text-blue-900 dark:text-blue-100">Expected result</p>
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-blue-800 dark:text-blue-200">{selectedIssue.expected}</p>
                          </div>
                        )}

                        <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800">
                          <div className="flex items-center justify-between gap-3 border-b border-gray-100 p-4 dark:border-gray-800">
                            <h3 className="flex items-center gap-2 font-black text-gray-950 dark:text-white">
                              <MessageCircle size={18} />
                              Thread
                            </h3>
                            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-black text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              {(selectedIssue.messages || []).length} updates
                            </span>
                          </div>
                          <div className="fix-report-thread-list max-h-[30rem] space-y-3 overflow-y-auto bg-gray-50/60 p-4 dark:bg-gray-950/30">
                            {(selectedIssue.messages || []).map(message => {
                              const avatar = resolveMediaUrl(message.senderId?.avatar);
                              const isDevMessage = message.role === 'developer';
                              return (
                                <div key={message._id || message.createdAt} className={`flex gap-3 ${isDevMessage ? 'justify-end' : ''}`}>
                                  {!isDevMessage && (
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-pink-500 to-indigo-500 text-sm font-bold text-white">
                                      {avatar ? <img src={avatar} alt={message.senderId?.name || 'User'} className="h-full w-full object-cover" /> : message.senderId?.name?.charAt(0)?.toUpperCase()}
                                    </div>
                                  )}
                                  <div className={`max-w-[82%] rounded-2xl px-4 py-3 shadow-sm ${isDevMessage ? 'bg-[#1877f2] text-white' : 'bg-white text-gray-800 dark:bg-gray-800 dark:text-gray-100'}`}>
                                    <p className="text-xs font-black uppercase opacity-70">{isDevMessage ? 'Developer' : message.senderId?.name || 'Member'}</p>
                                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
                                    <p className="mt-2 text-[11px] opacity-60">{formatDateTime(message.createdAt)}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <form onSubmit={sendIssueMessage} className="flex gap-2 border-t border-gray-100 p-3 dark:border-gray-800">
                            <input value={messageText} onChange={event => setMessageText(event.target.value)} placeholder={isDeveloper ? 'Reply as developer...' : 'Message the developers...'} className="h-11 min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 outline-none focus:border-[#1877f2] focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
                            <button disabled={sendingMessage || !messageText.trim()} className="grid h-11 w-11 place-items-center rounded-2xl bg-[#1877f2] text-white transition hover:bg-[#0f63d5] disabled:opacity-50" aria-label="Send message">
                              <Send size={18} />
                            </button>
                          </form>
                        </div>
                      </div>

                      <aside className="fix-report-side-grid grid gap-4 xl:grid-cols-3 2xl:block 2xl:space-y-4">
                        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/50">
                          <p className="text-sm font-black text-gray-950 dark:text-white">Decision</p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-3 py-1.5 text-xs font-black uppercase ring-1 ${statusStyles[selectedIssue.status] || statusStyles.new}`}>
                              {selectedIssue.status}
                            </span>
                            <span className={`rounded-full px-3 py-1.5 text-xs font-black uppercase ring-1 ${severityStyles[selectedIssue.severity] || severityStyles.medium}`}>
                              {selectedIssue.severity}
                            </span>
                          </div>
                          <p className="mt-3 text-xs font-semibold leading-5 text-gray-500 dark:text-gray-400">
                            Replies and status updates stay in this private thread.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/50">
                          <p className="text-sm font-black text-gray-950 dark:text-white">Reporter</p>
                          <button type="button" onClick={() => setProfileUser(selectedIssue.userId)} className="mt-3 flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left transition hover:bg-blue-50 dark:bg-gray-900 dark:hover:bg-blue-950/20">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-pink-500 to-indigo-500 text-sm font-bold text-white">
                              {resolveMediaUrl(selectedIssue.userId?.avatar) ? <img src={resolveMediaUrl(selectedIssue.userId?.avatar)} alt={selectedIssue.userId?.name || 'User'} className="h-full w-full object-cover" /> : selectedIssue.userId?.name?.charAt(0)?.toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-gray-950 dark:text-white">{selectedIssue.userId?.name || 'Member'}</p>
                              <p className="truncate text-xs text-gray-500 dark:text-gray-400">{selectedIssue.userId?.email || 'No email'}</p>
                            </div>
                          </button>
                        </div>
                        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-950/50">
                          <p className="font-black text-gray-950 dark:text-white">Metadata</p>
                          <div className="mt-3 space-y-2 text-gray-600 dark:text-gray-300">
                            <p className="break-words">Type: <span className="font-bold capitalize">{selectedIssue.type}</span></p>
                            <p className="break-words">Page: <span className="font-bold">{selectedIssue.workspaceName || 'Not specified'}</span></p>
                            <p className="break-words">Updated: <span className="font-bold">{formatDateTime(selectedIssue.updatedAt)}</span></p>
                          </div>
                        </div>
                      </aside>
                    </div>
                  </>
                ) : (
                  <div className="grid min-h-[460px] place-items-center p-8 text-center">
                    <div>
                      <Lightbulb className="mx-auto text-[#1877f2]" size={38} />
                      <h2 className="mt-3 text-xl font-black text-gray-950 dark:text-white">{isDeveloper ? 'No selected report' : 'No report selected'}</h2>
                      <p className="mt-1 text-sm font-semibold text-gray-500 dark:text-gray-400">
                        {isDeveloper ? 'Select a report to review the details and take action.' : 'Submit a problem or open an existing report to view its thread.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </section>
      )}

      {profileUser && (
        <Suspense fallback={(
          <div className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/10 p-4 backdrop-blur-[1px]" role="status" aria-label="Opening profile">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-xs font-black text-slate-700 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900/95 dark:text-slate-100 dark:ring-slate-700">
              <Loader2 size={15} className="animate-spin text-[#1877f2]" />
              Opening profile…
            </span>
          </div>
        )}>
          <UserProfileModal isOpen user={profileUser} onClose={() => setProfileUser(null)} />
        </Suspense>
      )}
    </div>
  );
}
