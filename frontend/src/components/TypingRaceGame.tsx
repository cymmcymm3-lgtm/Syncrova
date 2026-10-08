// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { BellRing, CheckCircle2, Copy, Keyboard, Play, RotateCcw, ShieldCheck, Trophy, Users, Volume2, VolumeX, X } from 'lucide-react';
import api from '../services/api';
import { playUiSound } from '../utils/sound';

const GAME_TYPE = 'typing-race';
const MODES = [
  { key: 'english', label: 'English words' }
];

const normalizeSentence = (value = '') => String(value).replace(/\s+/g, ' ').trim();
const normalizeTypingWord = (value = '') => normalizeSentence(value).toLowerCase();
const buildTypingWords = (items = []) => items
  .flatMap(item => String(item || '').split(/\s+/))
  .map(item => item.trim())
  .filter(Boolean);
const wordMatches = (expected = '', typed = '') => (
  normalizeTypingWord(expected) === normalizeTypingWord(typed)
);
const splitCommittedWords = (value = '') => String(value)
  .trim()
  .split(/\s+/)
  .filter(Boolean);
const formatClock = (value) => {
  const seconds = Math.max(0, Math.ceil(value || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const statusLabel = (player) => {
  if (player.status === 'disconnected') return 'Disconnected';
  if (player.status === 'reconnecting') return 'Reconnecting';
  return player.ready ? 'Ready' : 'Not Ready';
};
const statusClass = (player) => {
  if (player.status === 'disconnected') return 'bg-rose-500/10 text-rose-500 ring-rose-500/20';
  if (player.status === 'reconnecting') return 'bg-amber-500/10 text-amber-500 ring-amber-500/20';
  if (player.ready) return 'bg-emerald-500/10 text-emerald-500 ring-emerald-500/20';
  return 'bg-slate-500/10 text-slate-500 ring-slate-500/20';
};
const vibrate = (pattern = 18) => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
};

const scorePractice = (sentences, typedSentences, elapsedMs) => {
  const cleanTyped = typedSentences.map(sentence => normalizeSentence(sentence).toLowerCase());
  const expected = sentences.map(sentence => normalizeSentence(sentence).toLowerCase());
  const correctCount = cleanTyped.reduce((sum, sentence, index) => sum + (sentence === expected[index] ? 1 : 0), 0);
  const totalCount = Math.max(expected.length, 1);
  const accuracy = Math.round((correctCount / totalCount) * 100);
  const words = typedSentences.reduce((sum, sentence, index) => (
    cleanTyped[index] === expected[index] ? sum + sentence.split(/\s+/).filter(Boolean).length : sum
  ), 0);
  const wpm = Math.round(words / Math.max(elapsedMs / 60000, 0.02));
  return {
    score: Math.max(0, Math.round(correctCount * 420 + wpm * 12 + accuracy * 12)),
    accuracy,
    wpm,
    correctCount,
    totalCount,
    elapsedMs
  };
};

const TypingWordToken = React.memo(function TypingWordToken({ word, index, state, typed, setActiveWord }) {
  const isActive = state === 'active';
  const isDone = state === 'done';
  const isCorrect = isDone && wordMatches(word, typed);
  const isWrong = isDone && !isCorrect;
  const length = Math.max(word.length, typed.length || 0);

  return (
    <span
      ref={isActive ? setActiveWord : null}
      className={`typing-race-token relative rounded-lg px-1 transition ${isActive ? 'bg-blue-500/10 ring-2 ring-blue-500/25' : ''} ${isCorrect ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : ''} ${isWrong ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300' : ''}`}
    >
      {Array.from({ length }).map((_, charIndex) => {
        const expectedChar = word[charIndex] || '';
        const typedChar = typed[charIndex] || '';
        const isExtra = charIndex >= word.length;
        const isTyped = charIndex < typed.length;
        const charClass = !isTyped
          ? 'text-slate-400 dark:text-slate-500'
          : isExtra
            ? 'text-rose-500 underline decoration-rose-500'
            : expectedChar.toLowerCase() === typedChar.toLowerCase()
              ? 'text-slate-950 dark:text-white'
              : 'text-rose-500 underline decoration-rose-500';
        return (
          <span key={`${index}-${charIndex}`} className={charClass}>
            {isExtra ? typedChar : expectedChar}
          </span>
        );
      })}
      {isActive ? <span className="ml-0.5 inline-block h-6 w-0.5 translate-y-1 rounded-full bg-[#0b57d0] motion-safe:animate-pulse" /> : null}
    </span>
  );
});

const TypingWordBoard = React.memo(function TypingWordBoard({ words, currentIndex, currentInput, typedWords, onFocus }) {
  const scrollRef = useRef(null);
  const activeWordRef = useRef(null);
  const setActiveWord = useCallback((node) => {
    activeWordRef.current = node;
  }, []);

  useEffect(() => {
    const scrollNode = scrollRef.current;
    const activeNode = activeWordRef.current;
    if (!scrollNode || !activeNode) return undefined;

    const frame = window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      const active = activeWordRef.current;
      if (!container || !active) return;
      const containerRect = container.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const margin = 18;
      const needsScroll = activeRect.top < containerRect.top + margin
        || activeRect.bottom > containerRect.bottom - margin;
      if (!needsScroll) return;

      const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth';
      const targetTop = container.scrollTop
        + activeRect.top
        - containerRect.top
        - (container.clientHeight * 0.38);
      container.scrollTo({ top: Math.max(0, targetTop), behavior });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [currentIndex, currentInput.length, words.length]);

  return (
    <button
      type="button"
      onClick={onFocus}
      className="typing-race-board w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-inner shadow-slate-200/60 outline-none transition focus:border-[#0b57d0] focus:ring-4 focus:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-950 dark:shadow-black/20"
    >
      <div ref={scrollRef} className="typing-race-board-scroll flex max-h-56 flex-wrap content-start gap-x-3 gap-y-2 overflow-y-auto pr-1 text-xl font-black leading-9 text-slate-400 sm:text-2xl">
        {words.map((word, index) => {
          const state = index === currentIndex ? 'active' : index < currentIndex ? 'done' : 'pending';
          const typed = state === 'active' ? currentInput : state === 'done' ? (typedWords[index] || '') : '';
          return (
            <TypingWordToken
              key={`${word}-${index}`}
              word={word}
              index={index}
              state={state}
              typed={typed}
              setActiveWord={setActiveWord}
            />
          );
        })}
      </div>
    </button>
  );
});

export default function TypingRaceGame({ stats, onScoreSaved, onExit, isFullscreen = false }) {
  const inputRef = useRef(null);
  const submittedRef = useRef(false);
  const finishedNoticeRef = useRef('');
  const [mode, setMode] = useState('english');
  const [duration, setDuration] = useState(45);
  const [panel, setPanel] = useState('quick');
  const [joinCode, setJoinCode] = useState('');
  const [soundOn, setSoundOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [room, setRoom] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [typing, setTyping] = useState({
    input: '',
    sentenceIndex: 0,
    typedSentences: [],
    roomKey: '',
    submitted: false
  });
  const [practice, setPractice] = useState({
    active: false,
    gameOver: false,
    sentences: [],
    input: '',
    sentenceIndex: 0,
    typedSentences: [],
    startedAt: 0,
    durationSeconds: 45,
    result: null
  });
  const [history, setHistory] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);

  const feedback = useCallback((name, pattern = 18) => {
    vibrate(pattern);
    if (soundOn) playUiSound(name, 0.28);
  }, [soundOn]);

  const fetchMeta = useCallback(async () => {
    try {
      const [historyRes, leaderboardRes] = await Promise.all([
        api.get('/games/history/me?limit=8'),
        api.get('/games/leaderboards?gameType=typing-race&metric=wpm&period=weekly')
      ]);
      setHistory((historyRes.data?.matches || []).filter(item => item.gameType === 'Typing Race'));
      setLeaderboard(leaderboardRes.data?.leaders || []);
    } catch {
      // The game remains playable if the side panels fail.
    }
  }, []);

  useEffect(() => {
    fetchMeta();
  }, [fetchMeta]);

  useEffect(() => {
    const activeClock = room?.status === 'playing' || room?.status === 'countdown' || practice.active;
    const timer = window.setInterval(() => setNow(Date.now()), activeClock ? 250 : 1000);
    return () => window.clearInterval(timer);
  }, [practice.active, room?.status]);

  const applyRoom = useCallback((nextRoom) => {
    if (!nextRoom) return;
    setRoom(nextRoom);
    setError('');
    if (nextRoom.status !== 'finished') finishedNoticeRef.current = '';
    if (nextRoom.status === 'finished' && finishedNoticeRef.current !== nextRoom.id) {
      finishedNoticeRef.current = nextRoom.id;
      fetchMeta();
      onScoreSaved?.();
    }
  }, [fetchMeta, onScoreSaved]);

  const roomRequest = useCallback(async (request) => {
    setBusy(true);
    setError('');
    try {
      const res = await request();
      applyRoom(res.data?.room);
      return res.data?.room;
    } catch (err) {
      const message = err.response?.data?.msg || 'Failed to join match';
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [applyRoom]);

  useEffect(() => {
    if (!room?.id) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.get(`/games/multiplayer/rooms/${room.id}`);
        if (!cancelled) applyRoom(res.data?.room);
      } catch (err) {
        if (!cancelled) {
          const message = err.response?.data?.msg || 'Connection lost';
          setError(message);
        }
      }
    };
    const timer = window.setInterval(poll, room.status === 'playing' ? 650 : 1300);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyRoom, room?.id, room?.status]);

  useEffect(() => {
    if (!room?.rematchRoomId || !room?.me?.userId || !room.rematchVotes?.includes(room.me.userId)) return;
    api.get(`/games/multiplayer/rooms/${room.rematchRoomId}`)
      .then(res => applyRoom(res.data?.room))
      .catch(() => {});
  }, [applyRoom, room?.me?.userId, room?.rematchRoomId, room?.rematchVotes]);

  const joinQuickMatch = () => roomRequest(() => api.post('/games/multiplayer/rooms/quick', {
    gameType: GAME_TYPE,
    mode,
    durationSeconds: duration
  }));

  const createPrivateRoom = () => roomRequest(() => api.post('/games/multiplayer/rooms/private', {
    gameType: GAME_TYPE,
    mode,
    durationSeconds: duration
  }));

  const joinPrivateRoom = () => {
    if (!joinCode.trim()) {
      toast.error('Enter a room code first');
      return Promise.resolve(null);
    }
    return roomRequest(() => api.post('/games/multiplayer/rooms/join', { code: joinCode }));
  };

  const leaveRoom = () => roomRequest(() => api.post(`/games/multiplayer/rooms/${room.id}/leave`))
    .then(() => {
      setRoom(null);
      setTyping({ input: '', sentenceIndex: 0, typedSentences: [], roomKey: '', submitted: false });
    });

  const toggleReady = () => roomRequest(() => api.post(`/games/multiplayer/rooms/${room.id}/ready`, {
    ready: !room?.me?.ready
  }));

  const startNow = () => roomRequest(() => api.post(`/games/multiplayer/rooms/${room.id}/start`));

  const requestRematch = () => roomRequest(() => api.post(`/games/multiplayer/rooms/${room.id}/rematch`, {
    mode,
    durationSeconds: duration
  }));

  useEffect(() => {
    if (room?.status !== 'playing' || !room.startedAt) return;
    const roomKey = `${room.id}:${room.startedAt}`;
    if (typing.roomKey === roomKey) return;
    submittedRef.current = false;
    setTyping({ input: '', sentenceIndex: 0, typedSentences: [], roomKey, submitted: false });
    feedback('ding', [20, 40, 20]);
    window.setTimeout(() => inputRef.current?.focus(), 120);
  }, [feedback, room?.id, room?.startedAt, room?.status, typing.roomKey]);

  const sentences = useMemo(() => buildTypingWords(room?.sentences || []), [room?.sentences]);
  const currentWord = sentences[typing.sentenceIndex] || '';
  const currentProgress = currentWord
    ? Math.min(1, typing.input.length / Math.max(1, currentWord.length))
    : 0;
  const playerProgress = sentences.length
    ? Math.min(1, (typing.typedSentences.length + currentProgress) / sentences.length)
    : 0;
  const countdownMs = room?.status === 'countdown' ? Math.max(0, (room.startsAt || now) - now) : 0;
  const countdownText = countdownMs <= 400 && room?.status === 'countdown' ? 'GO!' : Math.max(1, Math.ceil(countdownMs / 1000));
  const remaining = room?.status === 'playing'
    ? Math.max(0, (room.durationSeconds || duration) - ((now - (room.startedAt || now)) / 1000))
    : room?.durationSeconds || duration;

  const submitTyping = useCallback(async (typedSentences) => {
    if (!room?.id || submittedRef.current) return;
    submittedRef.current = true;
    setTyping(prev => ({ ...prev, submitted: true }));
    try {
      const res = await api.post(`/games/multiplayer/rooms/${room.id}/typing-submit`, { typedSentences });
      applyRoom(res.data?.room);
      feedback('success', 22);
    } catch (err) {
      submittedRef.current = false;
      setTyping(prev => ({ ...prev, submitted: false }));
      toast.error(err.response?.data?.msg || 'Could not submit Typing Race');
    }
  }, [applyRoom, feedback, room?.id]);

  useEffect(() => {
    if (room?.status !== 'playing' || typing.submitted || remaining > 0) return;
    const finalTyped = typing.input.trim()
      ? [...typing.typedSentences, typing.input]
      : typing.typedSentences;
    submitTyping(finalTyped);
  }, [remaining, room?.status, submitTyping, typing.input, typing.submitted, typing.typedSentences]);

  useEffect(() => {
    if (room?.status !== 'playing' || !room?.id) return undefined;
    const timer = window.setTimeout(() => {
      api.post(`/games/multiplayer/rooms/${room.id}/typing-progress`, { progress: playerProgress }).catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [playerProgress, room?.id, room?.status]);

  const handleTypingInput = (event) => {
    const value = event.target.value.replace(/\n/g, ' ');
    if (!currentWord || typing.submitted) return;

    if (/\s/.test(value)) {
      const committedWords = splitCommittedWords(value);
      if (!committedWords.length) {
        setTyping(prev => ({ ...prev, input: '' }));
        return;
      }
      const availableSlots = Math.max(0, sentences.length - typing.sentenceIndex);
      const nextWords = committedWords.slice(0, availableSlots);
      const nextTyped = [...typing.typedSentences, ...nextWords];
      const nextIndex = typing.sentenceIndex + nextWords.length;
      setTyping(prev => ({
        ...prev,
        input: '',
        typedSentences: nextTyped,
        sentenceIndex: nextIndex
      }));
      feedback(wordMatches(currentWord, nextWords[0]) ? 'click' : 'ding', wordMatches(currentWord, nextWords[0]) ? 8 : [16, 20, 16]);
      if (nextIndex >= sentences.length) {
        window.setTimeout(() => submitTyping(nextTyped), 80);
      }
      return;
    }
    setTyping(prev => ({ ...prev, input: value }));
  };

  const blockPaste = (event) => {
    event.preventDefault();
    toast.error('Paste is disabled for ranked Typing Race');
  };

  const startPractice = async () => {
    setBusy(true);
    try {
      const res = await api.post('/games/typing-sprint/practice', { mode, durationSeconds: duration });
      setRoom(null);
      setPanel('practice');
      setPractice({
        active: true,
        gameOver: false,
        sentences: res.data?.sentences || [],
        input: '',
        sentenceIndex: 0,
        typedSentences: [],
        startedAt: Date.now(),
        durationSeconds: res.data?.durationSeconds || duration,
        result: null
      });
      feedback('ding', [15, 30, 15]);
      window.setTimeout(() => inputRef.current?.focus(), 120);
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Could not start practice');
    } finally {
      setBusy(false);
    }
  };

  const finishPractice = useCallback((typedSentences) => {
    setPractice(prev => {
      if (!prev.active || prev.gameOver) return prev;
      const result = scorePractice(prev.sentences, typedSentences, Date.now() - prev.startedAt);
      return { ...prev, active: false, gameOver: true, result, typedSentences };
    });
    feedback('success', 18);
  }, [feedback]);

  const practiceRemaining = practice.active
    ? Math.max(0, practice.durationSeconds - ((now - practice.startedAt) / 1000))
    : practice.durationSeconds;
  const practiceWords = useMemo(() => buildTypingWords(practice.sentences), [practice.sentences]);
  const practiceWord = practiceWords[practice.sentenceIndex] || '';
  const handlePracticeInput = (event) => {
    const value = event.target.value.replace(/\n/g, ' ');
    if (!practiceWord || practice.gameOver) return;

    if (/\s/.test(value)) {
      const committedWords = splitCommittedWords(value);
      if (!committedWords.length) {
        setPractice(prev => ({ ...prev, input: '' }));
        return;
      }
      const availableSlots = Math.max(0, practiceWords.length - practice.sentenceIndex);
      const nextWords = committedWords.slice(0, availableSlots);
      const nextTyped = [...practice.typedSentences, ...nextWords];
      const nextIndex = practice.sentenceIndex + nextWords.length;
      setPractice(prev => ({ ...prev, input: '', typedSentences: nextTyped, sentenceIndex: nextIndex }));
      feedback(wordMatches(practiceWord, nextWords[0]) ? 'click' : 'ding', wordMatches(practiceWord, nextWords[0]) ? 8 : [16, 20, 16]);
      if (nextIndex >= practiceWords.length) window.setTimeout(() => finishPractice(nextTyped), 80);
      return;
    }
    setPractice(prev => ({ ...prev, input: value }));
  };

  useEffect(() => {
    if (!practice.active || practice.gameOver || practiceRemaining > 0) return;
    const finalTyped = practice.input.trim()
      ? [...practice.typedSentences, practice.input]
      : practice.typedSentences;
    finishPractice(finalTyped);
  }, [finishPractice, practice.active, practice.gameOver, practice.input, practice.typedSentences, practiceRemaining]);

  const sortedResults = useMemo(() => {
    const players = room?.players || [];
    return [...players].sort((a, b) => {
      const aRank = a.result?.rank || 99;
      const bRank = b.result?.rank || 99;
      return aRank - bRank;
    });
  }, [room?.players]);

  const myResult = room?.me?.result;
  const rewardSummary = myResult?.rewardSummary;
  const isActiveTypingRace = room?.status === 'playing' || (practice.active && !practice.gameOver);

  return (
    <section className={`typing-race-game ${isActiveTypingRace ? 'typing-race-game--active' : ''} ${isFullscreen ? 'typing-race-game--fullscreen' : ''} overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950`}>
      <div className="typing-race-header grid gap-4 border-b border-slate-100 p-4 dark:border-slate-800 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-sky-500/20">
            <Keyboard size={25} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">Real-user multiplayer</p>
            <h2 className="text-2xl font-black tracking-normal text-slate-950 dark:text-white">Typing Race</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Ready lobby, shared countdown, server-scored races, and solo unranked practice.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <select value={mode} onChange={event => setMode(event.target.value)} disabled={Boolean(room)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
            {MODES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <select value={duration} onChange={event => setDuration(Number(event.target.value))} disabled={Boolean(room)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
            <option value={30}>30 sec</option>
            <option value={45}>45 sec</option>
            <option value={60}>60 sec</option>
          </select>
          <button type="button" onClick={() => setSoundOn(prev => !prev)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-900">
            {soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />} Sound
          </button>
        </div>
      </div>

      <div className="typing-race-body grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="typing-race-main min-w-0 space-y-4">
          {!room && !practice.active && !practice.gameOver ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="grid gap-2 sm:grid-cols-4">
                {[
                  ['quick', 'Quick Match'],
                  ['private', 'Private Room'],
                  ['join', 'Join Code'],
                  ['practice', 'Practice']
                ].map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setPanel(key)} className={`h-11 rounded-xl text-sm font-black transition ${panel === key ? 'bg-[#0b57d0] text-white shadow-lg shadow-blue-500/20' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-950 dark:text-slate-200 dark:ring-slate-800'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800">
                {panel === 'quick' && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black text-slate-950 dark:text-white">Find real players</p>
                      <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">2-4 players. No fake rivals or bots.</p>
                    </div>
                    <button type="button" onClick={joinQuickMatch} disabled={busy} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0b57d0] px-5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-60">
                      <Users size={18} /> Quick Match
                    </button>
                  </div>
                )}
                {panel === 'private' && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black text-slate-950 dark:text-white">Create a class room</p>
                      <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Share the code with classmates before readying up.</p>
                    </div>
                    <button type="button" onClick={createPrivateRoom} disabled={busy} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-950">
                      <Copy size={18} /> Create Room
                    </button>
                  </div>
                )}
                {panel === 'join' && (
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} placeholder="Room code" className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-base font-black uppercase tracking-[0.2em] text-slate-950 outline-none focus:border-[#0b57d0] dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                    <button type="button" onClick={joinPrivateRoom} disabled={busy} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0b57d0] px-5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-60">
                      <Users size={18} /> Join
                    </button>
                  </div>
                )}
                {panel === 'practice' && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black text-slate-950 dark:text-white">Practice Mode</p>
                      <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Solo training only. No leaderboard, rewards, or rank changes.</p>
                    </div>
                    <button type="button" onClick={startPractice} disabled={busy} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60">
                      <Play size={18} fill="currentColor" /> Start Practice
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm font-bold text-rose-600 dark:text-rose-300">
              {error}
            </div>
          ) : null}

          {room && ['lobby', 'searching'].includes(room.status) ? (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">Room {room.privateRoom ? room.code : 'Quick Match'}</p>
                  <h3 className="text-xl font-black text-slate-950 dark:text-white">
                    {room.status === 'countdown' ? `Starting in ${countdownText}` : `Searching for players... ${formatClock((now - room.createdAt) / 1000)}`}
                  </h3>
                  <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{room.matchmakingMessage}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={toggleReady} disabled={busy || room.status === 'countdown'} className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black transition disabled:opacity-60 ${room.me?.ready ? 'bg-emerald-600 text-white' : 'bg-[#0b57d0] text-white hover:bg-blue-700'}`}>
                    <CheckCircle2 size={17} /> {room.me?.ready ? 'Ready' : 'Ready Up'}
                  </button>
                  {room.me?.isHost ? (
                    <button type="button" onClick={startNow} disabled={busy || room.players.length < 2 || room.status === 'countdown'} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950">
                      <Play size={17} fill="currentColor" /> Start Now
                    </button>
                  ) : null}
                  <button type="button" onClick={leaveRoom} disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-white dark:hover:bg-slate-950">
                    <X size={17} /> Cancel
                  </button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {room.players.map(player => (
                  <div key={player.userId} className="animate-[game-pop-in_.22s_ease-out] rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-950 dark:text-white">{player.name}</p>
                        <p className="text-xs font-bold text-slate-500">{player.status === 'online' ? 'Online' : statusLabel(player)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {player.isHost ? <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[10px] font-black uppercase text-[#0b57d0] ring-1 ring-blue-500/20">Host</span> : null}
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ring-1 ${statusClass(player)}`}>{statusLabel(player)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {room?.status === 'countdown' ? (
            <div className="grid min-h-[16rem] place-items-center rounded-2xl border border-blue-500/20 bg-blue-500/10 p-6 text-center">
              <div className="motion-safe:animate-pulse">
                <BellRing className="mx-auto text-[#0b57d0]" size={42} />
                <p className="mt-3 text-6xl font-black text-slate-950 dark:text-white">{countdownText}</p>
                <p className="mt-2 text-sm font-black uppercase text-slate-500 dark:text-slate-400">All players start together</p>
              </div>
            </div>
          ) : null}

          {room?.status === 'playing' ? (
            <div className="typing-race-race-stack space-y-4">
              <div className="typing-race-play-panel rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">Word {Math.min(typing.sentenceIndex + 1, sentences.length || 1)} / {sentences.length || 0}</p>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-[#0b57d0] ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800">{formatClock(remaining)}</span>
                </div>
                <div className="mt-3">
                  <TypingWordBoard
                    words={sentences}
                    currentIndex={typing.sentenceIndex}
                    currentInput={typing.input}
                    typedWords={typing.typedSentences}
                    onFocus={() => inputRef.current?.focus()}
                  />
                </div>
                <input
                  ref={inputRef}
                  value={typing.input}
                  onChange={handleTypingInput}
                  onPaste={blockPaste}
                  disabled={typing.submitted}
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  placeholder={typing.submitted ? 'Submitted. Waiting for results...' : 'Type the word, then press Space'}
                  className="typing-race-input mt-3 h-14 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-black text-slate-900 outline-none transition focus:border-[#0b57d0] focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:disabled:bg-slate-900"
                />
                <p className="typing-race-input-hint mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">Wrong letters turn red; Space moves to the next word without blocking your race.</p>
              </div>
              <div className="grid gap-3">
                {room.players.map(player => {
                  const progress = player.userId === room.me?.userId ? playerProgress : player.progress || 0;
                  return (
                    <div key={player.userId} className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between text-sm font-black">
                        <span className="text-slate-800 dark:text-white">{player.name}{player.isHost ? ' · Host' : ''}</span>
                        <span className={player.status === 'disconnected' ? 'text-rose-500' : 'text-[#0b57d0]'}>{Math.round(progress * 100)}%</span>
                      </div>
                      <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#0b57d0] to-emerald-400 transition-all duration-300" style={{ width: `${Math.min(100, progress * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {room?.status === 'finished' ? (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">Match results</p>
                  <h3 className="text-2xl font-black text-slate-950 dark:text-white">Winner reveal</h3>
                  <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Rewards are skipped for disconnected or flagged players.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={requestRematch} disabled={busy || room.rematchVotes?.includes(room.me?.userId)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0b57d0] px-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-60">
                    <RotateCcw size={17} /> {room.rematchVotes?.includes(room.me?.userId) ? 'Rematch requested' : 'Rematch'}
                  </button>
                  <button type="button" onClick={onExit} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-950">
                    Close
                  </button>
                </div>
              </div>
              <div className="grid gap-3">
                {sortedResults.map(player => (
                  <div key={player.userId} className="animate-[game-pop-in_.24s_ease-out] rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-950 dark:text-white">#{player.result?.rank || '-'} {player.name}</p>
                        <p className="text-xs font-bold text-slate-500">{player.result?.wpm || 0} WPM · {player.result?.accuracy || 0}% accuracy · {player.result?.flags?.join(', ') || 'clean'}</p>
                      </div>
                      <p className="text-xl font-black text-[#0b57d0]">{player.result?.score || 0}</p>
                    </div>
                  </div>
                ))}
              </div>
              {myResult ? (
                <div className="grid gap-3 rounded-2xl bg-slate-950 p-4 text-white sm:grid-cols-3">
                  <div><p className="text-xs font-black uppercase text-white/45">XP earned</p><p className="text-2xl font-black">{rewardSummary?.xp || 0}</p></div>
                  <div><p className="text-xs font-black uppercase text-white/45">Credits earned</p><p className="text-2xl font-black">{rewardSummary?.credits || 0}</p></div>
                  <div><p className="text-xs font-black uppercase text-white/45">Bonuses</p><p className="text-sm font-bold">Rank +{rewardSummary?.rankBonusXp || 0} XP · Streak +{rewardSummary?.streakBonusXp || 0} XP</p></div>
                  {myResult.achievements?.length ? <p className="sm:col-span-3 text-sm font-black text-emerald-300">Badges: {myResult.achievements.join(', ')}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {(practice.active || practice.gameOver) ? (
            <div className={`typing-race-practice-panel ${practice.active && !practice.gameOver ? 'typing-race-practice-panel--active' : ''} rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-emerald-600 dark:text-emerald-300">Practice Mode · Not ranked</p>
                  <h3 className="text-xl font-black text-slate-950 dark:text-white">{practice.gameOver ? 'Practice complete' : `Word ${Math.min(practice.sentenceIndex + 1, practiceWords.length || 1)} / ${practiceWords.length || 0}`}</h3>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-emerald-600 ring-1 ring-emerald-500/20 dark:bg-slate-950">{formatClock(practiceRemaining)}</span>
              </div>
              {practice.gameOver ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <div><p className="text-xs font-black uppercase text-slate-500">Score</p><p className="text-2xl font-black text-slate-950 dark:text-white">{practice.result?.score || 0}</p></div>
                  <div><p className="text-xs font-black uppercase text-slate-500">WPM</p><p className="text-2xl font-black text-slate-950 dark:text-white">{practice.result?.wpm || 0}</p></div>
                  <div><p className="text-xs font-black uppercase text-slate-500">Accuracy</p><p className="text-2xl font-black text-slate-950 dark:text-white">{practice.result?.accuracy || 0}%</p></div>
                  <button type="button" onClick={startPractice} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white"><RotateCcw size={17} /> Retry</button>
                </div>
              ) : (
                <>
                  <div className="mt-3">
                    <TypingWordBoard
                      words={practiceWords}
                      currentIndex={practice.sentenceIndex}
                      currentInput={practice.input}
                      typedWords={practice.typedSentences}
                      onFocus={() => inputRef.current?.focus()}
                    />
                  </div>
                  <input ref={inputRef} value={practice.input} onChange={handlePracticeInput} onPaste={blockPaste} autoComplete="off" autoCorrect="off" spellCheck="false" className="typing-race-input mt-3 h-14 w-full rounded-xl border border-emerald-500/20 bg-white px-4 text-base font-black text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:bg-slate-950 dark:text-white" placeholder="Type the word, then press Space" />
                </>
              )}
            </div>
          ) : null}
        </div>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <ShieldCheck className="text-[#0b57d0]" size={18} />
            <p className="mt-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">Fairness</p>
            <p className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">Paste blocked, server scoring, impossible WPM flags, and real users only.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <Trophy className="text-[#0b57d0]" size={18} />
            <p className="mt-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">Best score</p>
            <p className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{stats?.highScore || 0}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">Weekly WPM leaders</p>
            <div className="mt-3 space-y-2">
              {leaderboard.slice(0, 5).map(row => (
                <div key={row.rank} className="flex items-center justify-between gap-3 text-sm font-black">
                  <span className="truncate text-slate-700 dark:text-slate-200">#{row.rank} {row.user?.name || 'Player'}</span>
                  <span className="text-[#0b57d0]">{row.value}</span>
                </div>
              ))}
              {!leaderboard.length ? <p className="text-sm font-semibold text-slate-500">No multiplayer leaders yet.</p> : null}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">Recent Matches</p>
            <div className="mt-3 space-y-2">
              {history.slice(0, 5).map(match => (
                <div key={match.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
                  <p className="text-sm font-black text-slate-800 dark:text-white">#{match.rank || '-'} · {match.score} pts</p>
                  <p className="text-xs font-bold text-slate-500">{match.wpm || 0} WPM · {match.accuracy || 0}% · +{match.xpEarned || 0} XP</p>
                </div>
              ))}
              {!history.length ? <p className="text-sm font-semibold text-slate-500">No recent multiplayer matches.</p> : null}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
