// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { BellRing, CheckCircle2, Copy, MousePointer2, Play, RotateCcw, ShieldCheck, Trophy, Users, Volume2, VolumeX, X, Zap } from 'lucide-react';
import api from '../services/api';
import { playUiSound } from '../utils/sound';

const GAME_TYPE = 'reaction-tap';
const PRACTICE_TARGET_POINTS = 5;

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

const randomPracticeTarget = () => ({
  x: 16 + Math.floor(Math.random() * 69),
  y: 20 + Math.floor(Math.random() * 58),
  size: 74 + Math.floor(Math.random() * 28),
  tone: ['#0b57d0', '#0891b2', '#16a34a', '#f59e0b'][Math.floor(Math.random() * 4)]
});

const setupCanvas = (canvas) => {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const isTouchViewport = window.matchMedia?.('(max-width: 767px), (pointer: coarse)')?.matches;
  const dpr = Math.min(isTouchViewport ? 1.35 : 2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
};

const drawReactionArena = (canvas, target, { waiting = true, pulse = 0 } = {}) => {
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { ctx, width, height } = setup;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, waiting ? '#172554' : '#052e2b');
  gradient.addColorStop(0.5, '#020617');
  gradient.addColorStop(1, waiting ? '#451a03' : '#064e3b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  for (let x = 24; x < width; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 24; y < height; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(width * 0.16, height * 0.18, Math.min(width, height) * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width * 0.84, height * 0.78, Math.min(width, height) * 0.22, 0, Math.PI * 2);
  ctx.fill();

  if (!target) {
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = '900 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('WAIT FOR THE BUBBLE', width / 2, height / 2);
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(226,232,240,0.72)';
    ctx.fillText('early taps count as false starts', width / 2, (height / 2) + 28);
    return;
  }

  const centerX = (Number(target.x || 50) / 100) * width;
  const centerY = (Number(target.y || 50) / 100) * height;
  const radius = Math.max(30, Number(target.size || 80) / 2);
  const glow = radius + 16 + (Math.sin(pulse / 160) * 5);
  const bubbleGradient = ctx.createRadialGradient(centerX - radius * 0.3, centerY - radius * 0.35, radius * 0.12, centerX, centerY, radius);
  bubbleGradient.addColorStop(0, '#ffffff');
  bubbleGradient.addColorStop(0.22, '#e0f2fe');
  bubbleGradient.addColorStop(1, target.tone || '#0b57d0');

  ctx.fillStyle = `${target.tone || '#0b57d0'}55`;
  ctx.beginPath();
  ctx.arc(centerX, centerY, glow, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = bubbleGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.86)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = 'rgba(2,6,23,0.82)';
  ctx.font = '900 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TAP', centerX, centerY + 6);
};

const pointerHitsTarget = (event, canvas, target) => {
  if (!canvas || !target) return false;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const centerX = (Number(target.x || 50) / 100) * rect.width;
  const centerY = (Number(target.y || 50) / 100) * rect.height;
  const radius = Math.max(30, Number(target.size || 80) / 2);
  return Math.hypot(x - centerX, y - centerY) <= radius;
};

export default function ReactionTapGame({ stats, onScoreSaved, onExit }) {
  const canvasRef = useRef(null);
  const practiceCanvasRef = useRef(null);
  const practiceTimerRef = useRef(null);
  const countdownNoticeRef = useRef('');
  const playNoticeRef = useRef('');
  const finishedNoticeRef = useRef('');
  const [panel, setPanel] = useState('quick');
  const [joinCode, setJoinCode] = useState('');
  const [soundOn, setSoundOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [room, setRoom] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [history, setHistory] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [practice, setPractice] = useState({
    active: false,
    gameOver: false,
    waiting: false,
    target: null,
    signalAt: 0,
    startedAt: 0,
    points: 0,
    rounds: 0,
    falseStarts: 0,
    reactions: [],
    result: null
  });

  const feedback = useCallback((name, pattern = 18) => {
    vibrate(pattern);
    if (soundOn) playUiSound(name, 0.28);
  }, [soundOn]);

  const fetchMeta = useCallback(async () => {
    try {
      const [historyRes, leaderboardRes] = await Promise.all([
        api.get('/games/history/me?limit=8'),
        api.get('/games/leaderboards?gameType=reaction-tap&metric=reaction&period=weekly')
      ]);
      setHistory((historyRes.data?.matches || []).filter(item => item.gameType === 'Reaction Tap'));
      setLeaderboard(leaderboardRes.data?.leaders || []);
    } catch {
      // Side panels are non-blocking.
    }
  }, []);

  useEffect(() => {
    fetchMeta();
  }, [fetchMeta]);

  useEffect(() => {
    const activeAnimation = room?.status === 'playing' || room?.status === 'countdown' || practice.active;
    const timer = window.setInterval(() => setNow(Date.now()), activeAnimation ? 160 : 1000);
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
        if (!cancelled) setError(err.response?.data?.msg || 'Connection lost');
      }
    };
    const timer = window.setInterval(poll, room.status === 'playing' ? 350 : 1300);
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

  useEffect(() => () => window.clearTimeout(practiceTimerRef.current), []);

  const joinQuickMatch = () => roomRequest(() => api.post('/games/multiplayer/rooms/quick', { gameType: GAME_TYPE }));
  const createPrivateRoom = () => roomRequest(() => api.post('/games/multiplayer/rooms/private', { gameType: GAME_TYPE }));
  const joinPrivateRoom = () => {
    if (!joinCode.trim()) {
      toast.error('Enter a room code first');
      return Promise.resolve(null);
    }
    return roomRequest(() => api.post('/games/multiplayer/rooms/join', { code: joinCode }));
  };
  const leaveRoom = () => roomRequest(() => api.post(`/games/multiplayer/rooms/${room.id}/leave`)).then(() => setRoom(null));
  const toggleReady = () => roomRequest(() => api.post(`/games/multiplayer/rooms/${room.id}/ready`, { ready: !room?.me?.ready }));
  const startNow = () => roomRequest(() => api.post(`/games/multiplayer/rooms/${room.id}/start`));
  const requestRematch = () => roomRequest(() => api.post(`/games/multiplayer/rooms/${room.id}/rematch`));

  const tapServerSignal = async () => {
    if (!room?.id || busy) return;
    feedback(room.reaction?.target ? 'success' : 'ding', room.reaction?.target ? 20 : [35, 20, 35]);
    try {
      const res = await api.post(`/games/multiplayer/rooms/${room.id}/reaction-tap`);
      applyRoom(res.data?.room);
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Tap failed');
    }
  };

  const finishPractice = useCallback((nextState) => {
    window.clearTimeout(practiceTimerRef.current);
    const reactions = nextState.reactions || [];
    const bestReactionMs = reactions.length ? Math.min(...reactions) : 0;
    const averageReactionMs = reactions.length
      ? Math.round(reactions.reduce((sum, value) => sum + value, 0) / reactions.length)
      : 0;
    setPractice({
      ...nextState,
      active: false,
      gameOver: true,
      waiting: false,
      target: null,
      result: {
        score: Math.max(0, (nextState.points || 0) * 650 + Math.max(0, 700 - (averageReactionMs || 700))),
        bestReactionMs,
        averageReactionMs,
        points: nextState.points || 0,
        falseStarts: nextState.falseStarts || 0
      }
    });
    feedback('success', 20);
  }, [feedback]);

  const schedulePracticeSignal = useCallback((baseState) => {
    window.clearTimeout(practiceTimerRef.current);
    const delay = 1000 + Math.floor(Math.random() * 2200);
    const signalAt = Date.now() + delay;
    setPractice(prev => ({ ...prev, ...baseState, waiting: true, target: null, signalAt }));
    practiceTimerRef.current = window.setTimeout(() => {
      setPractice(prev => ({ ...prev, waiting: false, target: randomPracticeTarget() }));
      feedback('ding', 18);
    }, delay);
  }, [feedback]);

  const startPractice = () => {
    setRoom(null);
    setPanel('practice');
    const baseState = {
      active: true,
      gameOver: false,
      waiting: true,
      target: null,
      signalAt: 0,
      startedAt: Date.now(),
      points: 0,
      rounds: 0,
      falseStarts: 0,
      reactions: [],
      result: null
    };
    setPractice(baseState);
    schedulePracticeSignal(baseState);
  };

  const tapPractice = (event) => {
    if (!practice.active || practice.gameOver) return;
    if (practice.waiting || now < practice.signalAt) {
      const next = { ...practice, falseStarts: practice.falseStarts + 1 };
      setPractice(next);
      feedback('ding', [35, 20, 35]);
      return;
    }
    if (event && practice.target && !pointerHitsTarget(event, practiceCanvasRef.current, practice.target)) {
      feedback('ding', 8);
      return;
    }
    const reactionMs = Math.max(1, now - practice.signalAt);
    const next = {
      ...practice,
      target: null,
      points: practice.points + 1,
      rounds: practice.rounds + 1,
      reactions: [...practice.reactions, reactionMs]
    };
    feedback('success', 18);
    if (next.points >= PRACTICE_TARGET_POINTS) {
      finishPractice(next);
    } else {
      schedulePracticeSignal(next);
    }
  };

  const countdownMs = room?.status === 'countdown' ? Math.max(0, (room.startsAt || now) - now) : 0;
  const countdownText = countdownMs <= 400 && room?.status === 'countdown' ? 'GO!' : Math.max(1, Math.ceil(countdownMs / 1000));
  const signalReady = Boolean(room?.reaction?.target);
  const signalWaitMs = room?.reaction?.signalAt ? Math.max(0, room.reaction.signalAt - now) : 0;
  const handleArenaTap = useCallback((event) => {
    if (!room?.id || room.status !== 'playing') return;
    if (!signalReady) {
      tapServerSignal();
      return;
    }
    if (!pointerHitsTarget(event, canvasRef.current, room.reaction?.target)) {
      feedback('ding', 8);
      return;
    }
    tapServerSignal();
  }, [feedback, room?.id, room?.reaction?.target, room?.status, signalReady, tapServerSignal]);
  const sortedResults = useMemo(() => {
    const players = room?.players || [];
    return [...players].sort((a, b) => (a.result?.rank || 99) - (b.result?.rank || 99));
  }, [room?.players]);
  const myResult = room?.me?.result;
  const rewardSummary = myResult?.rewardSummary;

  useEffect(() => {
    drawReactionArena(canvasRef.current, room?.reaction?.target || null, {
      waiting: !signalReady,
      pulse: now
    });
  }, [now, room?.reaction?.target, signalReady]);

  useEffect(() => {
    drawReactionArena(practiceCanvasRef.current, practice.target, {
      waiting: practice.waiting,
      pulse: now
    });
  }, [now, practice.target, practice.waiting]);

  useEffect(() => {
    if (room?.status !== 'countdown') {
      countdownNoticeRef.current = '';
      return;
    }
    const key = String(countdownText);
    if (countdownNoticeRef.current === key) return;
    countdownNoticeRef.current = key;
    feedback(key === 'GO!' ? 'success' : 'ding', key === 'GO!' ? [20, 40, 20] : 12);
  }, [countdownText, feedback, room?.status]);

  useEffect(() => {
    if (room?.status !== 'playing' || !room.startedAt) {
      playNoticeRef.current = '';
      return;
    }
    const key = `${room.id}:${room.startedAt}`;
    if (playNoticeRef.current === key) return;
    playNoticeRef.current = key;
    feedback('success', [20, 40, 20]);
  }, [feedback, room?.id, room?.startedAt, room?.status]);

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="grid gap-4 border-b border-slate-100 p-4 dark:border-slate-800 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#0b57d0] text-white shadow-lg shadow-blue-500/20">
            <MousePointer2 size={26} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">Server-timed multiplayer</p>
            <h2 className="text-2xl font-black tracking-normal text-slate-950 dark:text-white">Reaction Tap</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Ready lobby, random server signal delay, false-start penalties, and solo unranked practice.</p>
          </div>
        </div>
        <button type="button" onClick={() => setSoundOn(prev => !prev)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-900">
          {soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />} Sound
        </button>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
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
                    <div><p className="text-sm font-black text-slate-950 dark:text-white">Find real players</p><p className="text-sm font-semibold text-slate-500 dark:text-slate-400">2-4 players. No fake rivals or bots.</p></div>
                    <button type="button" onClick={joinQuickMatch} disabled={busy} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0b57d0] px-5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-60"><Users size={18} /> Quick Match</button>
                  </div>
                )}
                {panel === 'private' && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div><p className="text-sm font-black text-slate-950 dark:text-white">Create a class room</p><p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Share the code with classmates before readying up.</p></div>
                    <button type="button" onClick={createPrivateRoom} disabled={busy} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-950"><Copy size={18} /> Create Room</button>
                  </div>
                )}
                {panel === 'join' && (
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} placeholder="Room code" className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-base font-black uppercase tracking-[0.2em] text-slate-950 outline-none focus:border-[#0b57d0] dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                    <button type="button" onClick={joinPrivateRoom} disabled={busy} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0b57d0] px-5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-60"><Users size={18} /> Join</button>
                  </div>
                )}
                {panel === 'practice' && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div><p className="text-sm font-black text-slate-950 dark:text-white">Practice Mode</p><p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Solo training only. No leaderboard, rewards, or rank changes.</p></div>
                    <button type="button" onClick={startPractice} disabled={busy} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60"><Play size={18} fill="currentColor" /> Start Practice</button>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm font-bold text-rose-600 dark:text-rose-300">{error}</div> : null}

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
                  <button type="button" onClick={toggleReady} disabled={busy || room.status === 'countdown'} className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black transition disabled:opacity-60 ${room.me?.ready ? 'bg-emerald-600 text-white' : 'bg-[#0b57d0] text-white hover:bg-blue-700'}`}><CheckCircle2 size={17} /> {room.me?.ready ? 'Ready' : 'Ready Up'}</button>
                  {room.me?.isHost ? <button type="button" onClick={startNow} disabled={busy || room.players.length < 2 || room.status === 'countdown'} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950"><Play size={17} fill="currentColor" /> Start Now</button> : null}
                  <button type="button" onClick={leaveRoom} disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-white dark:hover:bg-slate-950"><X size={17} /> Cancel</button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {room.players.map(player => (
                  <div key={player.userId} className="animate-[game-pop-in_.22s_ease-out] rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0"><p className="truncate text-sm font-black text-slate-950 dark:text-white">{player.name}</p><p className="text-xs font-bold text-slate-500">{player.status === 'online' ? 'Online' : statusLabel(player)}</p></div>
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
            <div className="grid gap-4">
              <div className={`relative min-h-[24rem] overflow-hidden rounded-2xl border text-center transition ${signalReady ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/20 bg-amber-500/10'}`}>
                <canvas
                  ref={canvasRef}
                  onPointerDown={handleArenaTap}
                  className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                  aria-label="Shared reaction bubble arena"
                  role="button"
                />
                <div className="pointer-events-none absolute left-4 right-4 top-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-black uppercase text-slate-950 shadow-sm backdrop-blur dark:bg-slate-950/80 dark:text-white">
                    Shared bubble
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase shadow-sm backdrop-blur ${signalReady ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-slate-950'}`}>
                    {signalReady ? 'Tap now' : `Signal in ${Math.ceil(signalWaitMs / 1000)}s`}
                  </span>
                </div>
                <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-2xl bg-white/82 p-3 backdrop-blur dark:bg-slate-950/78">
                  <p className="text-sm font-black text-slate-950 dark:text-white">{signalReady ? 'One bubble for everyone. First valid tap scores.' : 'Wait for the server bubble before tapping.'}</p>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">When a classmate taps it first, it disappears for all players.</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {room.players.map(player => (
                  <div key={player.userId} className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between text-sm font-black">
                      <span className="text-slate-800 dark:text-white">{player.name}{player.isHost ? ' · Host' : ''}</span>
                      <span className={player.falseStarts ? 'text-rose-500' : 'text-[#0b57d0]'}>{player.points || 0}/{room.targetPoints}</span>
                    </div>
                    <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#0b57d0] to-emerald-400 transition-all duration-300" style={{ width: `${Math.min(100, ((player.points || 0) / Math.max(1, room.targetPoints)) * 100)}%` }} />
                    </div>
                    {player.falseStarts ? <p className="mt-1 text-xs font-black text-rose-500">False starts: {player.falseStarts}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {room?.status === 'finished' ? (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><p className="text-xs font-black uppercase text-[#0b57d0] dark:text-sky-300">Match results</p><h3 className="text-2xl font-black text-slate-950 dark:text-white">Winner reveal</h3><p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">False starts and disconnects are excluded from rewards.</p></div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={requestRematch} disabled={busy || room.rematchVotes?.includes(room.me?.userId)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0b57d0] px-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-60"><RotateCcw size={17} /> {room.rematchVotes?.includes(room.me?.userId) ? 'Rematch requested' : 'Rematch'}</button>
                  <button type="button" onClick={onExit} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-950">Close</button>
                </div>
              </div>
              <div className="grid gap-3">
                {sortedResults.map(player => (
                  <div key={player.userId} className="animate-[game-pop-in_.24s_ease-out] rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0"><p className="truncate text-sm font-black text-slate-950 dark:text-white">#{player.result?.rank || '-'} {player.name}</p><p className="text-xs font-bold text-slate-500">Best {player.result?.bestReactionMs || 0}ms · Avg {player.result?.averageReactionMs || 0}ms · {player.result?.flags?.join(', ') || 'clean'}</p></div>
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
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-black uppercase text-emerald-600 dark:text-emerald-300">Practice Mode · Not ranked</p><h3 className="text-xl font-black text-slate-950 dark:text-white">{practice.gameOver ? 'Practice complete' : `${practice.points}/${PRACTICE_TARGET_POINTS} taps`}</h3></div>
                <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-emerald-600 ring-1 ring-emerald-500/20 dark:bg-slate-950">{practice.falseStarts} false starts</span>
              </div>
              {practice.gameOver ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <div><p className="text-xs font-black uppercase text-slate-500">Score</p><p className="text-2xl font-black text-slate-950 dark:text-white">{practice.result?.score || 0}</p></div>
                  <div><p className="text-xs font-black uppercase text-slate-500">Best</p><p className="text-2xl font-black text-slate-950 dark:text-white">{practice.result?.bestReactionMs || 0}ms</p></div>
                  <div><p className="text-xs font-black uppercase text-slate-500">Average</p><p className="text-2xl font-black text-slate-950 dark:text-white">{practice.result?.averageReactionMs || 0}ms</p></div>
                  <button type="button" onClick={startPractice} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white"><RotateCcw size={17} /> Retry</button>
                </div>
              ) : (
                <div className={`relative mt-4 min-h-[20rem] overflow-hidden rounded-2xl text-center ${practice.waiting ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
                  <canvas
                    ref={practiceCanvasRef}
                    onPointerDown={tapPractice}
                    className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                    aria-label="Practice reaction bubble arena"
                    role="button"
                  />
                  <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-2xl bg-white/82 p-3 backdrop-blur dark:bg-slate-950/78">
                    <p className="text-sm font-black text-slate-950 dark:text-white">{practice.waiting ? 'Wait for the bubble.' : 'Tap the bubble before it moves.'}</p>
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Practice is solo only and does not affect rewards or leaderboards.</p>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <ShieldCheck className="text-[#0b57d0]" size={18} />
            <p className="mt-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">Fairness</p>
            <p className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">Server signal delay, server reaction timing, false-start flags, and real users only.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <Trophy className="text-[#0b57d0]" size={18} />
            <p className="mt-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">Best score</p>
            <p className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{stats?.highScore || 0}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <Zap className="text-[#0b57d0]" size={18} />
            <p className="mt-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">Weekly fastest</p>
            <div className="mt-3 space-y-2">
              {leaderboard.slice(0, 5).map(row => (
                <div key={row.rank} className="flex items-center justify-between gap-3 text-sm font-black">
                  <span className="truncate text-slate-700 dark:text-slate-200">#{row.rank} {row.user?.name || 'Player'}</span>
                  <span className="text-[#0b57d0]">{row.value}ms</span>
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
                  <p className="text-xs font-bold text-slate-500">Best {match.bestReactionMs || 0}ms · +{match.xpEarned || 0} XP</p>
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
