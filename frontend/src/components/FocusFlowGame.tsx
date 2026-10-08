// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Activity, CheckCircle2, Gauge, Play, RotateCcw, Save, Sparkles, Target, Trophy, Zap } from 'lucide-react';
import api from '../services/api';
import GameOverModal from './GameOverModal';

const MAX_MISSES = 5;
const TARGET_WIDTH = 18;
const FRAME_INTERVAL = 1000 / 60;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const calculateHit = (position, targetCenter, width = TARGET_WIDTH) => {
  const distance = Math.abs(position - targetCenter);
  const maxDistance = width / 2;
  const hit = distance <= maxDistance + 1.5;
  const accuracy = hit
    ? clamp(Math.round((1 - (Math.min(distance, maxDistance) / maxDistance)) * 88) + 12, 12, 100)
    : 0;
  const perfect = accuracy >= 88;
  return { hit, perfect, accuracy, distance };
};

export function FocusFlowLogo({ compact = false }) {
  return (
    <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-gray-950 text-white shadow-xl shadow-emerald-500/20 ring-1 ring-emerald-300/20`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(52,211,153,0.5),transparent_34%),radial-gradient(circle_at_75%_80%,rgba(34,211,238,0.35),transparent_35%)]" />
      <Activity size={compact ? 25 : 31} className="relative z-10 text-emerald-100 drop-shadow" />
    </div>
  );
}

export default function FocusFlowGame({ stats, onScoreSaved, onExit }) {
  const [running, setRunning] = useState(false);
  const [locks, setLocks] = useState(0);
  const [misses, setMisses] = useState(0);
  const [position, setPosition] = useState(0);
  const [targetCenter, setTargetCenter] = useState(50);
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [perfects, setPerfects] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const animationRef = useRef(null);
  const markerRef = useRef(null);
  const lastFrameRef = useRef(null);
  const positionRef = useRef(0);
  const targetCenterRef = useRef(50);
  const directionRef = useRef(1);
  const paceRef = useRef(0);

  const attemptsLeft = Math.max(0, MAX_MISSES - misses);
  const speedLevel = Math.max(1, Math.floor((hits + misses) / 5) + 1);

  const syncMarkerPosition = (nextPosition) => {
    if (markerRef.current) markerRef.current.style.left = `${nextPosition}%`;
  };

  const nextTarget = () => {
    const next = 18 + Math.round(Math.random() * 64);
    targetCenterRef.current = next;
    setTargetCenter(next);
  };

  const resetGame = () => {
    setRunning(true);
    setLocks(0);
    setMisses(0);
    setPosition(0);
    positionRef.current = 0;
    syncMarkerPosition(0);
    directionRef.current = 1;
    setScore(0);
    setHits(0);
    setPerfects(0);
    setStreak(0);
    setBestStreak(0);
    setFeedback(null);
    setResult(null);
    setStartedAt(Date.now());
    nextTarget();
    lastFrameRef.current = null;
  };

  const saveScore = async (payload) => {
    if (!payload.score) return;
    setSaving(true);
    try {
      await api.post('/games/focus-flow/submit', payload);
      toast.success('Focus Flow score saved');
      onScoreSaved?.();
    } catch (err) {
      if (err.response?.status === 404) {
        toast.error('Backend is not updated yet. Redeploy Render backend first.');
      } else {
        toast.error(err.response?.data?.msg || 'Could not save Focus Flow score');
      }
    } finally {
      setSaving(false);
    }
  };

  const finishGame = (nextState = {}) => {
    setRunning(false);
    const finalLocks = nextState.locks ?? locks;
    const finalMisses = nextState.misses ?? misses;
    const finalScore = nextState.score ?? score;
    const finalHits = nextState.hits ?? hits;
    const finalPerfects = nextState.perfects ?? perfects;
    const finalBestStreak = nextState.bestStreak ?? bestStreak;
    const totalAttempts = Math.max(1, finalLocks);
    const accuracy = Math.round((finalHits / totalAttempts) * 100);
    const payload = {
      score: finalScore,
      hits: finalHits,
      total: totalAttempts,
      perfects: finalPerfects,
      bestStreak: finalBestStreak,
      accuracy,
      misses: finalMisses,
      elapsedMs: Date.now() - startedAt
    };
    setResult(payload);
    saveScore(payload);
  };

  useEffect(() => {
    paceRef.current = hits + misses;
  }, [hits, misses]);

  useEffect(() => {
    if (!running) return undefined;

    const tick = (time) => {
      if (lastFrameRef.current === null) {
        lastFrameRef.current = time;
        animationRef.current = requestAnimationFrame(tick);
        return;
      }
      const last = lastFrameRef.current;
      if (time - last < FRAME_INTERVAL) {
        animationRef.current = requestAnimationFrame(tick);
        return;
      }
      const delta = Math.min(42, time - last);
      lastFrameRef.current = time;

      const speed = 0.045 + (Math.min(36, paceRef.current) * 0.0036);
      let next = positionRef.current + (directionRef.current * delta * speed);
      if (next >= 100) {
        next = 100;
        directionRef.current = -1;
      } else if (next <= 0) {
        next = 0;
        directionRef.current = 1;
      }
      positionRef.current = next;
      syncMarkerPosition(next);

      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [running]);

  const lockFocus = () => {
    if (!running) return;

    const livePosition = positionRef.current;
    const liveTarget = targetCenterRef.current || targetCenter;
    const hitResult = calculateHit(livePosition, liveTarget);
    const nextLocks = locks + 1;
    const nextMisses = misses + (hitResult.hit ? 0 : 1);
    const nextStreak = hitResult.hit ? streak + 1 : 0;
    const nextBestStreak = Math.max(bestStreak, nextStreak);
    const gained = hitResult.hit
      ? 180 + (hitResult.accuracy * 8) + (nextStreak * 55) + (hitResult.perfect ? 450 : 0)
      : 0;
    const nextScore = score + gained;
    const nextHits = hits + (hitResult.hit ? 1 : 0);
    const nextPerfects = perfects + (hitResult.perfect ? 1 : 0);

    setLocks(nextLocks);
    setMisses(nextMisses);
    setScore(nextScore);
    setHits(nextHits);
    setPerfects(nextPerfects);
    setStreak(nextStreak);
    setBestStreak(nextBestStreak);
    setFeedback({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label: hitResult.perfect ? 'Perfect Focus' : hitResult.hit ? 'Good Lock' : 'Missed',
      detail: hitResult.hit ? `+${gained} points` : 'No points',
      tone: hitResult.perfect ? 'text-yellow-200' : hitResult.hit ? 'text-emerald-200' : 'text-rose-200'
    });
    window.setTimeout(() => setFeedback(null), 850);

    if (nextMisses >= MAX_MISSES) {
      finishGame({
        locks: nextLocks,
        misses: nextMisses,
        score: nextScore,
        hits: nextHits,
        perfects: nextPerfects,
        bestStreak: nextBestStreak
      });
      return;
    }

    nextTarget();
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-gray-800 bg-gray-950 text-white shadow-2xl shadow-emerald-500/10">
      <div className="relative overflow-hidden border-b border-white/10 p-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(52,211,153,0.24),transparent_30%),radial-gradient(circle_at_90%_12%,rgba(34,211,238,0.2),transparent_32%)]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <FocusFlowLogo />
            <div>
              <p className="text-xs font-black uppercase text-emerald-200">Timing Challenge</p>
              <h2 className="text-2xl font-black tracking-normal">Focus Flow</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-white/65">Lock the moving signal inside the focus window. It gets faster over time, and five misses ends the run.</p>
            </div>
          </div>
          <button type="button" onClick={resetGame} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-white/15">
            {running ? <RotateCcw size={16} /> : <Play size={16} fill="currentColor" />}
            {running ? 'Restart' : 'Start Flow'}
          </button>
        </div>
      </div>

      <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ['Score', score],
              ['Attempts', `${attemptsLeft}/${MAX_MISSES}`],
              ['Hits', hits],
              ['Speed', `Lv ${speedLevel}`]
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-center shadow-lg shadow-black/10">
                <p className="text-[11px] font-black uppercase text-white/45">{label}</p>
                <motion.p key={value} initial={{ scale: 0.84, opacity: 0.45 }} animate={{ scale: 1, opacity: 1 }} className="mt-1 text-xl font-black text-white">
                  {value}
                </motion.p>
              </div>
            ))}
          </div>

          <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950 p-6 shadow-2xl shadow-emerald-500/10">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:44px_44px]" />
            <div className="relative z-10 space-y-8">
              <div>
                <div className="mb-3 flex items-center justify-between text-xs font-black uppercase text-white/45">
                  <span>Focus Track</span>
                  <span>{attemptsLeft} attempts left</span>
                </div>
                <div className="relative h-24 rounded-3xl border border-white/10 bg-white/[0.06] p-4">
                  <div className="absolute left-4 right-4 top-1/2 h-3 -translate-y-1/2 rounded-full bg-white/10">
                    <div
                      className="absolute top-1/2 h-12 -translate-y-1/2 rounded-2xl border border-emerald-200/40 bg-emerald-300/20 shadow-[0_0_28px_rgba(52,211,153,0.35)]"
                      style={{ left: `${targetCenter - TARGET_WIDTH / 2}%`, width: `${TARGET_WIDTH}%` }}
                    />
                    <div
                      ref={markerRef}
                      className="focus-flow-marker absolute top-1/2 grid h-12 w-12 place-items-center rounded-2xl bg-white text-gray-950 shadow-2xl shadow-cyan-400/30"
                      style={{ left: `${position}%`, transform: 'translate3d(-50%, -50%, 0)' }}
                    >
                      <Target size={21} />
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={!running}
                onClick={lockFocus}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-4 text-base font-black text-gray-950 shadow-2xl shadow-emerald-500/10 transition hover:-translate-y-0.5 hover:bg-emerald-100 disabled:opacity-50"
              >
                <Zap size={20} />
                Lock Focus
              </button>
            </div>

            <AnimatePresence>
              {feedback && (
                <motion.div
                  key={feedback.id}
                  initial={{ opacity: 0, scale: 0.78, y: 18 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.88, y: -18 }}
                  className="pointer-events-none absolute left-1/2 top-1/2 z-20 w-[min(78%,340px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/10 bg-gray-950/95 p-5 text-center shadow-2xl shadow-emerald-400/20"
                >
                  <p className={`text-3xl font-black ${feedback.tone}`}>{feedback.label}</p>
                  <p className="mt-1 text-sm font-bold text-white/70">{feedback.detail}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {result && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-3 rounded-3xl border border-white/10 bg-gray-950 p-4 text-white sm:grid-cols-4">
              <div><p className="text-xs font-black uppercase text-white/45">Score</p><p className="text-2xl font-black">{result.score}</p></div>
              <div><p className="text-xs font-black uppercase text-white/45">Accuracy</p><p className="text-2xl font-black">{result.accuracy}%</p></div>
              <div><p className="text-xs font-black uppercase text-white/45">Perfects</p><p className="text-2xl font-black">{result.perfects}</p></div>
              <div><p className="text-xs font-black uppercase text-white/45">Saved</p><p className="text-2xl font-black">{saving ? '...' : <Save size={24} />}</p></div>
            </motion.div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
            <p className="flex items-center gap-2 text-sm font-black text-white">
              <Gauge size={17} className="text-emerald-200" />
              Focus Metrics
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl bg-white/[0.05] p-3">
                <p className="text-xs font-black uppercase text-white/40">Current streak</p>
                <p className="text-2xl font-black">x{streak}</p>
              </div>
              <div className="rounded-2xl bg-white/[0.05] p-3">
                <p className="text-xs font-black uppercase text-white/40">Misses left</p>
                <p className="text-2xl font-black">{attemptsLeft}</p>
              </div>
              <div className="rounded-2xl bg-white/[0.05] p-3">
                <p className="text-xs font-black uppercase text-white/40">Perfect hits</p>
                <p className="text-2xl font-black">{perfects}</p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-300/20 bg-emerald-300/10 p-4">
            <p className="flex items-center gap-2 text-xs font-black uppercase text-emerald-100">
              <Trophy size={15} />
              Focus Best
            </p>
            <p className="mt-2 text-3xl font-black">{stats?.focusFlowStats?.highScore || 0}</p>
            <p className="mt-2 text-xs leading-5 text-white/45">Score rewards hit accuracy, streaks, and perfect timing.</p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <p className="flex items-center gap-2 text-sm font-black text-white">
              <CheckCircle2 size={17} className="text-cyan-200" />
              Tip
            </p>
            <p className="mt-2 text-xs leading-5 text-white/45">Wait for the marker to enter the glowing focus zone. The later rounds move faster.</p>
          </div>
        </aside>
      </div>

      <GameOverModal
        open={Boolean(result)}
        title="Flow ended"
        score={result?.score || 0}
        detail={result ? `${result.hits}/${result.total} locks landed before attempts ran out.` : ''}
        saving={saving}
        saved={Boolean(result && !saving)}
        onRetry={resetGame}
        onExit={() => setResult(null)}
      />
    </section>
  );
}
