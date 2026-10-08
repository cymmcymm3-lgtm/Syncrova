import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Cloud, Feather, Trophy, Zap } from 'lucide-react';
import api from '../services/api';
import GameOverModal from './GameOverModal';

const WIDTH = 360;
const HEIGHT = 520;
const BIRD_X = 92;
const BIRD_SIZE = 34;
const PIPE_WIDTH = 58;
const START_GAP = 154;
const MIN_GAP = 118;

const makePipe = (x = WIDTH + 60, score = 0) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  x,
  gapY: 118 + Math.random() * 220,
  gap: Math.max(MIN_GAP, START_GAP - Math.floor(score / 4) * 5),
  passed: false
});

export function FlappyBirdLogo({ compact = false }) {
  return (
    <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-sky-950 text-white shadow-xl shadow-sky-500/20 ring-1 ring-sky-300/20`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_26%_20%,rgba(250,204,21,0.55),transparent_30%),radial-gradient(circle_at_78%_72%,rgba(34,211,238,0.42),transparent_36%)]" />
      <Feather size={compact ? 25 : 31} className="relative z-10 rotate-12 text-yellow-100 drop-shadow" />
    </div>
  );
}

export default function FlappyBirdGame({ stats, onScoreSaved, onExit }) {
  const frameRef = useRef(null);
  const lastFrameRef = useRef(null);
  const birdYRef = useRef(HEIGHT / 2);
  const velocityRef = useRef(0);
  const pipesRef = useRef([makePipe(WIDTH + 80), makePipe(WIDTH + 270)]);
  const scoreRef = useRef(0);
  const pipesPassedRef = useRef(0);
  const startedAtRef = useRef(Date.now());
  const runningRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [birdY, setBirdY] = useState(HEIGHT / 2);
  const [pipes, setPipes] = useState(pipesRef.current);
  const [score, setScore] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveScore = useCallback(async (finalScore, elapsedMs) => {
    if (finalScore <= 0) return;
    setSaving(true);
    try {
      await api.post('/games/flappy-bird/submit', {
        score: finalScore,
        pipesPassed: pipesPassedRef.current,
        elapsedMs
      });
      setSaved(true);
      toast.success('Flappy run saved');
      onScoreSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Could not save Flappy score');
    } finally {
      setSaving(false);
    }
  }, [onScoreSaved]);

  const finishGame = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setGameOver(true);
    saveScore(scoreRef.current, Date.now() - startedAtRef.current);
  }, [saveScore]);

  const resetGame = useCallback(() => {
    birdYRef.current = HEIGHT / 2;
    velocityRef.current = 0;
    pipesRef.current = [makePipe(WIDTH + 80), makePipe(WIDTH + 270)];
    scoreRef.current = 0;
    pipesPassedRef.current = 0;
    startedAtRef.current = Date.now();
    lastFrameRef.current = null;
    runningRef.current = true;
    setBirdY(birdYRef.current);
    setPipes(pipesRef.current);
    setScore(0);
    setSaved(false);
    setGameOver(false);
    setRunning(true);
  }, []);

  const flap = useCallback(() => {
    if (gameOver) return;
    if (!runningRef.current) resetGame();
    velocityRef.current = -0.46;
  }, [gameOver, resetGame]);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.code === 'Space' || event.code === 'ArrowUp') {
        event.preventDefault();
        flap();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [flap]);

  useEffect(() => {
    const tick = (time) => {
      const last = lastFrameRef.current ?? time;
      const delta = Math.min(32, time - last);
      lastFrameRef.current = time;

      if (runningRef.current) {
        const speed = 0.13 + Math.min(0.08, scoreRef.current / 90000);
        velocityRef.current += 0.00135 * delta;
        birdYRef.current += velocityRef.current * delta;

        let nextScore = scoreRef.current;
        let nextPipes = pipesRef.current
          .map(pipe => ({ ...pipe, x: pipe.x - speed * delta }))
          .filter(pipe => pipe.x > -PIPE_WIDTH - 12);

        if (!nextPipes.length || nextPipes[nextPipes.length - 1].x < WIDTH - 180) {
          nextPipes = [...nextPipes, makePipe(WIDTH + 20, nextScore)];
        }

        nextPipes = nextPipes.map(pipe => {
          if (!pipe.passed && pipe.x + PIPE_WIDTH < BIRD_X) {
            nextScore += 500;
            pipesPassedRef.current += 1;
            return { ...pipe, passed: true };
          }
          return pipe;
        });

        const birdRect = {
          left: BIRD_X - BIRD_SIZE / 2,
          right: BIRD_X + BIRD_SIZE / 2,
          top: birdYRef.current - BIRD_SIZE / 2,
          bottom: birdYRef.current + BIRD_SIZE / 2
        };

        const hitPipe = nextPipes.some(pipe => {
          const pipeLeft = pipe.x;
          const pipeRight = pipe.x + PIPE_WIDTH;
          const gapTop = pipe.gapY;
          const gapBottom = pipe.gapY + pipe.gap;
          const overlapsX = birdRect.right > pipeLeft && birdRect.left < pipeRight;
          const outsideGap = birdRect.top < gapTop || birdRect.bottom > gapBottom;
          return overlapsX && outsideGap;
        });

        const outOfBounds = birdRect.top < 0 || birdRect.bottom > HEIGHT;
        pipesRef.current = nextPipes;
        scoreRef.current = nextScore + Math.floor(delta * 0.8);

        setBirdY(birdYRef.current);
        setPipes(nextPipes);
        setScore(scoreRef.current);

        if (hitPipe || outOfBounds) finishGame();
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [finishGame]);

  return (
    <section className="overflow-hidden rounded-3xl border border-sky-900/60 bg-sky-950 text-white shadow-2xl shadow-sky-500/10">
      <div className="relative overflow-hidden border-b border-white/10 p-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_18%,rgba(56,189,248,0.26),transparent_30%),radial-gradient(circle_at_86%_12%,rgba(250,204,21,0.22),transparent_32%)]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <FlappyBirdLogo />
            <div>
              <p className="text-xs font-black uppercase text-sky-200">Arcade Challenge</p>
              <h2 className="text-2xl font-black tracking-normal">Flappy Scholar</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-white/65">Tap to fly through study gates. The longer you survive, the higher your season score.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs font-black">
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3">
              <p className="uppercase text-white/40">Score</p>
              <p className="mt-1 text-xl text-white">{score}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3">
              <p className="uppercase text-white/40">Best</p>
              <p className="mt-1 text-xl text-white">{stats?.flappyStats?.highScore || 0}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <button
          type="button"
          onClick={flap}
          className="relative mx-auto aspect-[9/13] w-full max-w-[420px] touch-manipulation overflow-hidden rounded-[2rem] border border-white/10 bg-sky-400 text-left shadow-2xl shadow-sky-500/20"
          aria-label="Tap to flap"
        >
          <div className="absolute inset-0 bg-[linear-gradient(#38bdf8,#7dd3fc_48%,#86efac_48%,#22c55e)]" />
          <Cloud className="absolute left-8 top-12 text-white/80" size={44} />
          <Cloud className="absolute right-10 top-28 text-white/70" size={36} />
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-b from-lime-400 to-green-600" />

          {pipes.map(pipe => (
            <div key={pipe.id}>
              <div
                className="absolute rounded-b-2xl border-x border-b border-green-950/30 bg-gradient-to-r from-green-600 via-lime-400 to-green-700 shadow-xl"
                style={{ left: `${(pipe.x / WIDTH) * 100}%`, width: `${(PIPE_WIDTH / WIDTH) * 100}%`, top: 0, height: `${(pipe.gapY / HEIGHT) * 100}%` }}
              />
              <div
                className="absolute rounded-t-2xl border-x border-t border-green-950/30 bg-gradient-to-r from-green-600 via-lime-400 to-green-700 shadow-xl"
                style={{
                  left: `${(pipe.x / WIDTH) * 100}%`,
                  width: `${(PIPE_WIDTH / WIDTH) * 100}%`,
                  top: `${((pipe.gapY + pipe.gap) / HEIGHT) * 100}%`,
                  bottom: 0
                }}
              />
            </div>
          ))}

          <div
            className="absolute z-20 grid place-items-center rounded-full border-2 border-orange-700/30 bg-gradient-to-br from-yellow-200 via-yellow-400 to-orange-500 shadow-2xl shadow-yellow-300/50"
            style={{
              width: `${(BIRD_SIZE / WIDTH) * 100}%`,
              height: `${(BIRD_SIZE / HEIGHT) * 100}%`,
              left: `${((BIRD_X - BIRD_SIZE / 2) / WIDTH) * 100}%`,
              top: `${((birdY - BIRD_SIZE / 2) / HEIGHT) * 100}%`,
              transform: `rotate(${Math.max(-22, Math.min(28, velocityRef.current * 90))}deg)`
            }}
          >
            <span className="absolute right-1.5 top-2 h-2 w-2 rounded-full bg-gray-950" />
            <span className="absolute -right-2 top-1/2 h-3 w-4 -translate-y-1/2 rounded-r-full bg-orange-500" />
            <span className="absolute -left-2 top-1/2 h-5 w-6 -translate-y-1/2 rounded-full bg-yellow-300/80" />
          </div>

          {!running && !gameOver && (
            <div className="absolute inset-0 z-30 grid place-items-center bg-sky-950/20 p-6 text-center backdrop-blur-[1px]">
              <div className="rounded-3xl border border-white/20 bg-white/90 p-5 text-sky-950 shadow-2xl">
                <p className="text-2xl font-black">Tap to fly</p>
                <p className="mt-2 text-sm font-bold text-sky-900/70">Avoid the study gates and chase the highest rank.</p>
              </div>
            </div>
          )}
        </button>

        <aside className="grid gap-4 md:grid-cols-2 xl:block xl:space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
            <p className="flex items-center gap-2 text-sm font-black text-white">
              <Trophy size={17} className="text-yellow-200" />
              Flappy Best
            </p>
            <p className="mt-2 text-3xl font-black">{stats?.flappyStats?.highScore || 0}</p>
            <p className="mt-2 text-xs leading-5 text-white/45">Passing gates gives the biggest score boost. Surviving adds bonus points.</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <p className="flex items-center gap-2 text-sm font-black text-white">
              <Zap size={17} className="text-sky-200" />
              Controls
            </p>
            <p className="mt-2 text-xs leading-5 text-white/45">Tap the game area on mobile. Use Space or Arrow Up on keyboard.</p>
          </div>
        </aside>
      </div>

      <GameOverModal
        open={gameOver}
        title="Flight ended"
        score={score}
        detail="Try again to climb the Games leaderboard."
        saving={saving}
        saved={saved}
        onRetry={resetGame}
        onExit={onExit}
      />
    </section>
  );
}
