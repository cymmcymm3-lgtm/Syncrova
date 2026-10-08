import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Plane, Shield, Trophy, Zap } from 'lucide-react';
import api from '../services/api';
import GameOverModal from './GameOverModal';

const WIDTH = 390;
const HEIGHT = 560;
const PLAYER_Y = HEIGHT - 72;
const PLAYER_SIZE = 52;
const ENEMY_SIZE = 40;
const PLAYER_BOUND = 36;
const ENEMY_BOUND = 32;
const BULLET_W = 7;
const BULLET_H = 24;
const ENEMY_BULLET_W = 7;
const ENEMY_BULLET_H = 20;
const FRAME_INTERVAL = 1000 / 60;

const enemyTypes = [
  { key: 'scout', label: 'Recon Jet', size: 36, hp: 1, speed: 0.084, drift: 0.034, points: 22, tone: 'from-rose-400 to-orange-500' },
  { key: 'fighter', label: 'Strike Fighter', size: 42, hp: 2, speed: 0.068, drift: 0.026, points: 44, tone: 'from-violet-400 to-fuchsia-600' },
  { key: 'twin', label: 'Heavy Attack Jet', size: 50, hp: 3, speed: 0.058, drift: 0.022, points: 70, tone: 'from-amber-300 to-red-600' }
];

const powerUpTypes = [
  { key: 'double', label: 'Twin Cannon', tone: 'from-cyan-300 to-blue-500' },
  { key: 'machine', label: 'Rapid Cannon', tone: 'from-emerald-300 to-lime-500' },
  { key: 'spread', label: 'Missile Spread', tone: 'from-pink-300 to-violet-500' }
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const jetPalettes = {
  player: {
    hullTop: '#f8fafc',
    hullMid: '#93c5fd',
    hullBottom: '#1d4ed8',
    wing: '#64748b',
    wingDark: '#1e3a8a',
    canopy: '#67e8f9',
    trim: '#22d3ee',
    glow: '#38bdf8',
    flame: '#f97316'
  },
  scout: {
    hullTop: '#fee2e2',
    hullMid: '#fb7185',
    hullBottom: '#7f1d1d',
    wing: '#991b1b',
    wingDark: '#450a0a',
    canopy: '#fef2f2',
    trim: '#fca5a5',
    glow: '#fb7185',
    flame: '#fb923c'
  },
  fighter: {
    hullTop: '#e5e7eb',
    hullMid: '#a855f7',
    hullBottom: '#4c1d95',
    wing: '#334155',
    wingDark: '#1e1b4b',
    canopy: '#ddd6fe',
    trim: '#c084fc',
    glow: '#c084fc',
    flame: '#f43f5e'
  },
  twin: {
    hullTop: '#fef3c7',
    hullMid: '#f97316',
    hullBottom: '#7c2d12',
    wing: '#57534e',
    wingDark: '#292524',
    canopy: '#ffedd5',
    trim: '#fdba74',
    glow: '#fb923c',
    flame: '#ef4444'
  }
};

const getJetPalette = type => jetPalettes[type] || jetPalettes.scout;

const makeEnemy = (level = 1) => {
  const type = level >= 6 && Math.random() > 0.68
    ? enemyTypes[2]
    : level >= 3 && Math.random() > 0.58
      ? enemyTypes[1]
      : enemyTypes[0];

  return {
    id: uid(),
    type: type.key,
    label: type.label,
    x: ENEMY_BOUND + Math.random() * (WIDTH - ENEMY_BOUND * 2),
    y: -45,
    size: type.size,
    maxHp: type.hp,
    hp: type.hp,
    points: type.points,
    tone: type.tone,
    speed: type.speed + Math.random() * 0.018 + level * 0.003,
    drift: (Math.random() - 0.5) * type.drift,
    shootCooldown: 720 + Math.random() * 1200
  };
};

const makePowerUp = (x, y) => {
  const type = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
  return { id: uid(), x, y, ...type };
};

const makeBurstParticles = (x, y, color, count = 12, force = 0.14) => (
  Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = force * (0.4 + Math.random());
    const life = 260 + Math.random() * 360;
    return {
      id: uid(),
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 1.6 + Math.random() * 3.2,
      life,
      maxLife: life,
      color
    };
  })
);

const addBurst = (particlesRef, x, y, color, count = 12, force = 0.14) => {
  particlesRef.current = [
    ...particlesRef.current,
    ...makeBurstParticles(x, y, color, count, force)
  ].slice(-140);
};

const drawCloudBand = (context, x, y, width, height, alpha = 0.08) => {
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = '#dbeafe';
  [
    [x, y, width, height, -0.12],
    [x + width * 0.38, y + height * 0.12, width * 0.55, height * 0.76, 0.08],
    [x - width * 0.42, y - height * 0.05, width * 0.44, height * 0.62, 0.18]
  ].forEach(([cloudX, cloudY, cloudW, cloudH, rotation]) => {
    context.beginPath();
    context.ellipse(cloudX, cloudY, cloudW, cloudH, rotation, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
};

const drawTracerRound = (context, bullet, friendly = true) => {
  const width = friendly ? BULLET_W : ENEMY_BULLET_W;
  const height = friendly ? BULLET_H : ENEMY_BULLET_H;
  const speed = friendly ? 0.42 : (bullet.speed || 0.24);
  const drift = bullet.vx || 0;
  const rotation = friendly ? Math.atan2(drift, speed) : Math.PI - Math.atan2(drift, speed);
  const glow = friendly ? '#67e8f9' : '#fb7185';
  const casing = friendly ? '#f8fafc' : '#fecdd3';
  const core = friendly ? '#fbbf24' : '#f43f5e';

  context.save();
  context.translate(bullet.x, bullet.y);
  context.rotate(rotation);
  context.shadowColor = glow;
  context.shadowBlur = 14;
  context.fillStyle = friendly ? 'rgba(103, 232, 249, 0.28)' : 'rgba(248, 113, 113, 0.30)';
  context.beginPath();
  context.ellipse(0, height * 0.62, width * 0.78, height * 0.36, 0, 0, Math.PI * 2);
  context.fill();

  const shell = context.createLinearGradient(-width / 2, 0, width / 2, 0);
  shell.addColorStop(0, '#475569');
  shell.addColorStop(0.38, casing);
  shell.addColorStop(0.66, core);
  shell.addColorStop(1, '#111827');
  context.fillStyle = shell;
  context.beginPath();
  context.moveTo(0, -height * 0.58);
  context.lineTo(width * 0.42, -height * 0.18);
  context.lineTo(width * 0.32, height * 0.42);
  context.lineTo(-width * 0.32, height * 0.42);
  context.lineTo(-width * 0.42, -height * 0.18);
  context.closePath();
  context.fill();

  context.shadowBlur = 0;
  context.globalAlpha = 0.7;
  context.strokeStyle = friendly ? '#cffafe' : '#ffe4e6';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, -height * 0.34);
  context.lineTo(0, height * 0.28);
  context.stroke();
  context.restore();
};

const drawPowerCrate = (context, powerUp, time) => {
  const color = powerUp.key === 'machine' ? '#86efac' : powerUp.key === 'spread' ? '#f0abfc' : '#67e8f9';
  const label = powerUp.key === 'machine' ? 'MG' : powerUp.key === 'spread' ? 'MSL' : '2X';

  context.save();
  context.translate(powerUp.x, powerUp.y);
  context.rotate(Math.sin((time + powerUp.x) * 0.006) * 0.08);
  context.shadowColor = color;
  context.shadowBlur = 16;
  const crate = context.createLinearGradient(-15, -13, 15, 13);
  crate.addColorStop(0, '#0f172a');
  crate.addColorStop(0.5, color);
  crate.addColorStop(1, '#111827');
  context.fillStyle = crate;
  context.fillRect(-15, -12, 30, 24);
  context.strokeStyle = 'rgba(255, 255, 255, 0.78)';
  context.lineWidth = 1.4;
  context.strokeRect(-15, -12, 30, 24);
  context.beginPath();
  context.moveTo(-15, 0);
  context.lineTo(15, 0);
  context.moveTo(0, -12);
  context.lineTo(0, 12);
  context.stroke();
  context.fillStyle = '#020617';
  context.font = 'bold 8px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 0, 0.5);
  context.restore();
};

const drawParticle = (context, particle) => {
  const fade = clamp(particle.life / particle.maxLife, 0, 1);
  context.save();
  context.globalAlpha = fade;
  context.shadowColor = particle.color;
  context.shadowBlur = 14 * fade;
  context.fillStyle = particle.color;
  context.beginPath();
  context.arc(particle.x, particle.y, particle.size * fade, 0, Math.PI * 2);
  context.fill();
  context.restore();
};

const drawFighterJet = (context, x, y, size, palette, rotation = 0, variant = 'fighter', time = 0) => {
  const s = size;
  const heavy = variant === 'twin';
  const flameScale = 0.86 + Math.sin(time * 0.024 + x * 0.1) * 0.14;

  context.save();
  context.translate(x, y);
  context.rotate(rotation);

  context.save();
  context.globalAlpha = variant === 'player' ? 0.28 : 0.18;
  context.strokeStyle = palette.trim;
  context.lineWidth = 1.7;
  [-0.12, 0.12].forEach(offset => {
    context.beginPath();
    context.moveTo(s * offset, s * 0.48);
    context.lineTo(s * offset * 1.4, s * 0.9);
    context.stroke();
  });
  context.restore();

  const flame = context.createLinearGradient(0, s * 0.38, 0, s * 0.72);
  flame.addColorStop(0, '#fff7ed');
  flame.addColorStop(0.45, palette.flame);
  flame.addColorStop(1, 'rgba(239, 68, 68, 0)');
  context.shadowColor = palette.flame;
  context.shadowBlur = 14;
  context.fillStyle = flame;
  context.beginPath();
  context.moveTo(-s * 0.08, s * 0.38);
  context.quadraticCurveTo(0, s * 0.72 * flameScale, s * 0.08, s * 0.38);
  context.closePath();
  context.fill();

  context.shadowColor = palette.glow;
  context.shadowBlur = variant === 'player' ? 16 : 12;
  const wingGradient = context.createLinearGradient(-s * 0.64, 0, s * 0.64, 0);
  wingGradient.addColorStop(0, palette.wingDark);
  wingGradient.addColorStop(0.5, palette.wing);
  wingGradient.addColorStop(1, palette.wingDark);
  context.fillStyle = wingGradient;
  context.beginPath();
  context.moveTo(-s * 0.08, -s * 0.17);
  context.lineTo(-s * (heavy ? 0.74 : 0.62), s * 0.05);
  context.lineTo(-s * (heavy ? 0.5 : 0.4), s * 0.27);
  context.lineTo(-s * 0.1, s * 0.15);
  context.closePath();
  context.fill();
  context.beginPath();
  context.moveTo(s * 0.08, -s * 0.17);
  context.lineTo(s * (heavy ? 0.74 : 0.62), s * 0.05);
  context.lineTo(s * (heavy ? 0.5 : 0.4), s * 0.27);
  context.lineTo(s * 0.1, s * 0.15);
  context.closePath();
  context.fill();

  context.fillStyle = palette.wingDark;
  context.beginPath();
  context.moveTo(-s * 0.1, s * 0.25);
  context.lineTo(-s * 0.36, s * 0.54);
  context.lineTo(-s * 0.14, s * 0.49);
  context.lineTo(-s * 0.05, s * 0.34);
  context.closePath();
  context.fill();
  context.beginPath();
  context.moveTo(s * 0.1, s * 0.25);
  context.lineTo(s * 0.36, s * 0.54);
  context.lineTo(s * 0.14, s * 0.49);
  context.lineTo(s * 0.05, s * 0.34);
  context.closePath();
  context.fill();

  const hull = context.createLinearGradient(0, -s * 0.68, 0, s * 0.58);
  hull.addColorStop(0, palette.hullTop);
  hull.addColorStop(0.42, palette.hullMid);
  hull.addColorStop(1, palette.hullBottom);
  context.fillStyle = hull;
  context.beginPath();
  context.moveTo(0, -s * 0.66);
  context.bezierCurveTo(s * 0.18, -s * 0.45, s * 0.2, -s * 0.12, s * 0.16, s * 0.12);
  context.lineTo(s * 0.12, s * 0.43);
  context.quadraticCurveTo(0, s * 0.57, -s * 0.12, s * 0.43);
  context.lineTo(-s * 0.16, s * 0.12);
  context.bezierCurveTo(-s * 0.2, -s * 0.12, -s * 0.18, -s * 0.45, 0, -s * 0.66);
  context.closePath();
  context.fill();

  context.shadowBlur = 0;
  const canopy = context.createLinearGradient(0, -s * 0.42, 0, -s * 0.06);
  canopy.addColorStop(0, '#ecfeff');
  canopy.addColorStop(0.42, palette.canopy);
  canopy.addColorStop(1, '#0f172a');
  context.fillStyle = canopy;
  context.beginPath();
  context.ellipse(0, -s * 0.25, s * 0.075, s * 0.18, 0, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = 'rgba(255, 255, 255, 0.58)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, -s * 0.5);
  context.lineTo(0, s * 0.33);
  context.moveTo(-s * 0.43, s * 0.08);
  context.lineTo(-s * 0.13, s * 0.12);
  context.moveTo(s * 0.43, s * 0.08);
  context.lineTo(s * 0.13, s * 0.12);
  context.stroke();

  context.fillStyle = '#111827';
  [-0.08, 0.08].forEach(offset => {
    context.fillRect(s * offset - s * 0.028, s * 0.42, s * 0.056, s * 0.12);
  });

  const weaponMounts = heavy ? [-0.48, -0.34, 0.34, 0.48] : [-0.38, 0.38];
  weaponMounts.forEach(offset => {
    context.fillStyle = '#e5e7eb';
    context.fillRect(s * offset - s * 0.026, s * 0.04, s * 0.052, s * 0.25);
    context.fillStyle = palette.trim;
    context.beginPath();
    context.moveTo(s * offset, -s * 0.02);
    context.lineTo(s * offset + s * 0.04, s * 0.05);
    context.lineTo(s * offset - s * 0.04, s * 0.05);
    context.closePath();
    context.fill();
  });

  context.restore();
};

export function JetFighterLogo({ compact = false }) {
  return (
    <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-slate-950 text-white shadow-xl shadow-cyan-500/20 ring-1 ring-cyan-300/20`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_20%,rgba(56,189,248,0.5),transparent_34%),radial-gradient(circle_at_76%_76%,rgba(244,63,94,0.38),transparent_35%)]" />
      <Plane size={compact ? 25 : 31} className="relative z-10 -rotate-45 text-cyan-100 drop-shadow" />
    </div>
  );
}

export default function JetFighterGame({ stats, onScoreSaved, onExit }) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const lastFrameRef = useRef(null);
  const lastStatsSyncRef = useRef(0);
  const playerXRef = useRef(WIDTH / 2);
  const bulletsRef = useRef([]);
  const enemyBulletsRef = useRef([]);
  const enemiesRef = useRef([]);
  const particlesRef = useRef([]);
  const scoreRef = useRef(0);
  const killsRef = useRef(0);
  const livesRef = useRef(3);
  const levelRef = useRef(1);
  const spawnClockRef = useRef(0);
  const fireClockRef = useRef(0);
  const survivalScoreRef = useRef(0);
  const powerUpsRef = useRef([]);
  const weaponRef = useRef('single');
  const weaponUntilRef = useRef(0);
  const startedAtRef = useRef(Date.now());
  const runningRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [playerX, setPlayerX] = useState(WIDTH / 2);
  const [bullets, setBullets] = useState([]);
  const [enemyBullets, setEnemyBullets] = useState([]);
  const [enemies, setEnemies] = useState([]);
  const [score, setScore] = useState(0);
  const [kills, setKills] = useState(0);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [powerUps, setPowerUps] = useState([]);
  const [weapon, setWeapon] = useState('single');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hitFlash, setHitFlash] = useState(0);

  const syncState = () => {
    setWeapon(weaponRef.current);
    setScore(scoreRef.current);
    setKills(killsRef.current);
    setLives(livesRef.current);
    setLevel(levelRef.current);
  };

  const drawArena = useCallback((time = 0) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!context) return;

    const isTouchViewport = window.matchMedia?.('(max-width: 767px), (pointer: coarse)')?.matches;
    const pixelRatio = Math.min(isTouchViewport ? 1.6 : 2, window.devicePixelRatio || 1);
    if (canvas.width !== WIDTH * pixelRatio || canvas.height !== HEIGHT * pixelRatio) {
      canvas.width = WIDTH * pixelRatio;
      canvas.height = HEIGHT * pixelRatio;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);

    const bg = context.createLinearGradient(0, 0, 0, HEIGHT);
    bg.addColorStop(0, '#030712');
    bg.addColorStop(0.42, '#071527');
    bg.addColorStop(1, '#0f172a');
    context.fillStyle = bg;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    for (let index = 0; index < 7; index += 1) {
      const x = ((index * 96 + time * 0.012) % (WIDTH + 150)) - 75;
      const y = ((index * 78 + time * 0.018) % (HEIGHT + 90)) - 45;
      drawCloudBand(context, x, y, 54 + (index % 3) * 16, 11 + (index % 2) * 5, 0.05 + (index % 3) * 0.018);
    }

    context.save();
    context.globalAlpha = 0.15;
    context.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    context.lineWidth = 1;
    const gridOffset = (time * 0.028) % 42;
    for (let y = -42 + gridOffset; y < HEIGHT; y += 42) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(WIDTH, y);
      context.stroke();
    }
    for (let x = 0; x < WIDTH; x += 42) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, HEIGHT);
      context.stroke();
    }
    context.restore();

    context.save();
    context.globalAlpha = 0.32;
    context.fillStyle = '#bae6fd';
    for (let index = 0; index < 42; index += 1) {
      const x = (index * 83) % WIDTH;
      const y = ((index * 149) + time * 0.1) % HEIGHT;
      const size = index % 5 === 0 ? 1.8 : 1.1;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    bulletsRef.current.forEach(bullet => {
      drawTracerRound(context, bullet, true);
    });

    enemyBulletsRef.current.forEach(bullet => {
      drawTracerRound(context, bullet, false);
    });

    particlesRef.current.forEach(particle => {
      drawParticle(context, particle);
    });

    powerUpsRef.current.forEach(powerUp => {
      drawPowerCrate(context, powerUp, time);
    });

    enemiesRef.current.forEach(enemy => {
      drawFighterJet(context, enemy.x, enemy.y, enemy.size || ENEMY_SIZE, getJetPalette(enemy.type), Math.PI, enemy.type, time);
    });

    drawFighterJet(context, playerXRef.current, PLAYER_Y, PLAYER_SIZE, jetPalettes.player, 0, 'player', time);
  }, []);

  const saveScore = useCallback(async () => {
    const finalScore = scoreRef.current;
    if (finalScore <= 0) return;
    setSaving(true);
    try {
      await api.post('/games/jet-fighter/submit', {
        score: finalScore,
        kills: killsRef.current,
        level: levelRef.current,
        lives: livesRef.current,
        elapsedMs: Date.now() - startedAtRef.current
      });
      setSaved(true);
      toast.success('Jet Fighter score saved');
      onScoreSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Could not save Jet Fighter score');
    } finally {
      setSaving(false);
    }
  }, [onScoreSaved]);

  const endGame = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setGameOver(true);
    saveScore();
  }, [saveScore]);

  const resetGame = useCallback(() => {
    playerXRef.current = WIDTH / 2;
    bulletsRef.current = [];
    enemyBulletsRef.current = [];
    enemiesRef.current = [makeEnemy(1), makeEnemy(1)];
    particlesRef.current = [];
    scoreRef.current = 0;
    killsRef.current = 0;
    livesRef.current = 3;
    levelRef.current = 1;
    spawnClockRef.current = 0;
    fireClockRef.current = 0;
    survivalScoreRef.current = 0;
    powerUpsRef.current = [];
    weaponRef.current = 'single';
    weaponUntilRef.current = 0;
    startedAtRef.current = Date.now();
    lastFrameRef.current = null;
    runningRef.current = true;
    setGameOver(false);
    setSaved(false);
    setRunning(true);
    syncState();
    requestAnimationFrame(time => drawArena(time));
  }, [drawArena]);

  const movePlayerToClientX = (clientX, target) => {
    const rect = target.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * WIDTH;
    playerXRef.current = clamp(x, PLAYER_BOUND, WIDTH - PLAYER_BOUND);
    if (!runningRef.current) setPlayerX(playerXRef.current);
    if (!runningRef.current) drawArena(performance.now());
    if (!runningRef.current && !gameOver) resetGame();
  };

  useEffect(() => {
    const handleKey = (event) => {
      if (!runningRef.current && (event.code === 'Space' || event.code === 'ArrowLeft' || event.code === 'ArrowRight')) {
        resetGame();
      }
      if (event.code === 'ArrowLeft') playerXRef.current = clamp(playerXRef.current - 24, PLAYER_BOUND, WIDTH - PLAYER_BOUND);
      if (event.code === 'ArrowRight') playerXRef.current = clamp(playerXRef.current + 24, PLAYER_BOUND, WIDTH - PLAYER_BOUND);
      setPlayerX(playerXRef.current);
      drawArena(performance.now());
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [drawArena, gameOver, resetGame]);

  useEffect(() => {
    const tick = (time) => {
      if (lastFrameRef.current === null) {
        lastFrameRef.current = time;
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      const last = lastFrameRef.current;
      if (time - last < FRAME_INTERVAL) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      const delta = Math.min(42, time - last);
      lastFrameRef.current = time;

      if (runningRef.current) {
        fireClockRef.current += delta;
        spawnClockRef.current += delta;
        particlesRef.current = particlesRef.current
          .map(particle => ({
            ...particle,
            x: particle.x + particle.vx * delta,
            y: particle.y + particle.vy * delta,
            vy: particle.vy + delta * 0.00005,
            life: particle.life - delta
          }))
          .filter(particle => particle.life > 0);

        if (weaponUntilRef.current && time > weaponUntilRef.current) {
          weaponRef.current = 'single';
          weaponUntilRef.current = 0;
        }

        const fireDelay = weaponRef.current === 'machine' ? 115 : 220;
        if (fireClockRef.current > fireDelay) {
          const patterns = weaponRef.current === 'spread'
            ? [{ x: -13, vx: -0.09 }, { x: 0, vx: 0 }, { x: 13, vx: 0.09 }]
            : weaponRef.current === 'double'
              ? [{ x: -10, vx: 0 }, { x: 10, vx: 0 }]
              : [{ x: 0, vx: 0 }];
          bulletsRef.current = [
            ...bulletsRef.current,
            ...patterns.map(pattern => ({ id: uid(), x: playerXRef.current + pattern.x, y: PLAYER_Y - 18, vx: pattern.vx }))
          ].slice(-64);
          addBurst(particlesRef, playerXRef.current, PLAYER_Y - 28, '#67e8f9', weaponRef.current === 'machine' ? 2 : 4, 0.045);
          fireClockRef.current = 0;
        }

        const spawnDelay = Math.max(420, 950 - levelRef.current * 55);
        if (spawnClockRef.current > spawnDelay) {
          enemiesRef.current = [...enemiesRef.current, makeEnemy(levelRef.current)].slice(-16);
          spawnClockRef.current = 0;
        }

        bulletsRef.current = bulletsRef.current
          .map(bullet => ({ ...bullet, x: bullet.x + (bullet.vx || 0) * delta, y: bullet.y - delta * 0.42 }))
          .filter(bullet => bullet.y > -24);

        const nextEnemyShots = [];
        enemiesRef.current = enemiesRef.current
          .map(enemy => {
            const nextEnemy = {
              ...enemy,
              x: clamp(enemy.x + enemy.drift * delta, ENEMY_BOUND, WIDTH - ENEMY_BOUND),
              y: enemy.y + enemy.speed * delta,
              shootCooldown: (enemy.shootCooldown ?? 900) - delta
            };
            const canShoot = nextEnemy.y > 26 && nextEnemy.y < HEIGHT * 0.72 && nextEnemy.shootCooldown <= 0;
            if (canShoot) {
              const patterns = nextEnemy.type === 'twin'
                ? [{ x: -8, vx: -0.025 }, { x: 8, vx: 0.025 }]
                : nextEnemy.type === 'fighter'
                  ? [{ x: 0, vx: 0 }, { x: 10, vx: 0.018 }]
                  : [{ x: 0, vx: 0 }];
              nextEnemyShots.push(...patterns.map(pattern => ({
                id: uid(),
                x: nextEnemy.x + pattern.x,
                y: nextEnemy.y + (nextEnemy.size || ENEMY_SIZE) * 0.35,
                vx: pattern.vx,
                speed: 0.22 + levelRef.current * 0.012
              })));
              addBurst(particlesRef, nextEnemy.x, nextEnemy.y + (nextEnemy.size || ENEMY_SIZE) * 0.38, getJetPalette(nextEnemy.type).glow, 3, 0.05);
              nextEnemy.shootCooldown = Math.max(420, 1180 - levelRef.current * 55) + Math.random() * 720;
            }
            return nextEnemy;
          })
          .filter(enemy => {
            if (enemy.y < HEIGHT + 48) return true;
            livesRef.current -= 1;
            addBurst(particlesRef, enemy.x, HEIGHT - 26, getJetPalette(enemy.type).glow, 12, 0.1);
            setHitFlash(value => value + 1);
            return false;
          });

        if (nextEnemyShots.length) {
          enemyBulletsRef.current = [...enemyBulletsRef.current, ...nextEnemyShots].slice(-36);
        }

        enemyBulletsRef.current = enemyBulletsRef.current
          .map(bullet => ({
            ...bullet,
            x: bullet.x + (bullet.vx || 0) * delta,
            y: bullet.y + delta * (bullet.speed || 0.24)
          }))
          .filter(bullet => bullet.y < HEIGHT + 28 && bullet.x > -18 && bullet.x < WIDTH + 18);

        const remainingBullets = [];
        const enemiesNext = enemiesRef.current.map(enemy => ({ ...enemy }));

        bulletsRef.current.forEach(bullet => {
          const hitIndex = enemiesNext.findIndex(enemy => (
            Math.abs(enemy.x - bullet.x) < ((enemy.size || ENEMY_SIZE) / 2)
            && Math.abs(enemy.y - bullet.y) < ((enemy.size || ENEMY_SIZE) / 2)
          ));

          if (hitIndex === -1) {
            remainingBullets.push(bullet);
            return;
          }

          const hitEnemy = enemiesNext[hitIndex];
          addBurst(particlesRef, bullet.x, bullet.y, '#fde68a', 6, 0.08);
          hitEnemy.hp -= 1;
          scoreRef.current += 4 + levelRef.current;
          if (hitEnemy.hp <= 0) {
            killsRef.current += 1;
            scoreRef.current += (hitEnemy.points || 24) + levelRef.current * 2;
            addBurst(particlesRef, hitEnemy.x, hitEnemy.y, getJetPalette(hitEnemy.type).glow, 24, 0.18);
            if (Math.random() < 0.18) {
              powerUpsRef.current = [...powerUpsRef.current, makePowerUp(hitEnemy.x, hitEnemy.y)].slice(-5);
            }
          }
        });

        bulletsRef.current = remainingBullets;
        enemiesRef.current = enemiesNext.filter(enemy => enemy.hp > 0);
        levelRef.current = Math.min(12, Math.floor(killsRef.current / 6) + 1);
        survivalScoreRef.current += delta * (0.007 + levelRef.current * 0.001);
        if (survivalScoreRef.current >= 1) {
          const gained = Math.floor(survivalScoreRef.current);
          scoreRef.current += gained;
          survivalScoreRef.current -= gained;
        }

        powerUpsRef.current = powerUpsRef.current
          .map(powerUp => ({ ...powerUp, y: powerUp.y + delta * 0.09 }))
          .filter(powerUp => powerUp.y < HEIGHT + 32);

        powerUpsRef.current = powerUpsRef.current.filter(powerUp => {
          const collected = Math.abs(powerUp.x - playerXRef.current) < 34 && Math.abs(powerUp.y - PLAYER_Y) < 36;
          if (!collected) return true;
          weaponRef.current = powerUp.key;
          weaponUntilRef.current = time + 8000;
          scoreRef.current += 15;
          addBurst(particlesRef, powerUp.x, powerUp.y, powerUp.key === 'machine' ? '#86efac' : powerUp.key === 'spread' ? '#f0abfc' : '#67e8f9', 14, 0.1);
          return false;
        });

        const playerBulletHits = [];
        enemyBulletsRef.current = enemyBulletsRef.current.filter(bullet => {
          const hit = Math.abs(bullet.x - playerXRef.current) < 24 && Math.abs(bullet.y - PLAYER_Y) < 28;
          if (hit) playerBulletHits.push(bullet);
          return !hit;
        });
        if (playerBulletHits.length) {
          livesRef.current -= 1;
          playerBulletHits.forEach(bullet => addBurst(particlesRef, bullet.x, bullet.y, '#fb7185', 12, 0.12));
          addBurst(particlesRef, playerXRef.current, PLAYER_Y, '#38bdf8', 10, 0.08);
          setHitFlash(value => value + 1);
        }

        const crashedEnemies = enemiesRef.current.filter(enemy => (
          Math.abs(enemy.x - playerXRef.current) < 34
          && Math.abs(enemy.y - PLAYER_Y) < 34
        ));

        if (crashedEnemies.length) {
          livesRef.current -= 1;
          crashedEnemies.forEach(enemy => addBurst(particlesRef, enemy.x, enemy.y, getJetPalette(enemy.type).glow, 18, 0.16));
          addBurst(particlesRef, playerXRef.current, PLAYER_Y, '#38bdf8', 18, 0.14);
          enemiesRef.current = enemiesRef.current.filter(enemy => (
            Math.abs(enemy.x - playerXRef.current) >= 34
            || Math.abs(enemy.y - PLAYER_Y) >= 34
          ));
          setHitFlash(value => value + 1);
        }

        if (time - lastStatsSyncRef.current > 80) {
          lastStatsSyncRef.current = time;
          syncState();
        }
        if (livesRef.current <= 0) endGame();
      }

      drawArena(time);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [endGame]);

  return (
    <section className="overflow-hidden rounded-3xl border border-cyan-900/60 bg-slate-950 text-white shadow-2xl shadow-cyan-500/10">
      <div className="relative overflow-hidden border-b border-white/10 p-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_16%,rgba(34,211,238,0.24),transparent_30%),radial-gradient(circle_at_86%_12%,rgba(244,63,94,0.2),transparent_32%)]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <JetFighterLogo />
            <div>
              <p className="text-xs font-black uppercase text-cyan-200">Air Combat</p>
              <h2 className="text-2xl font-black tracking-normal">Jet Fighter</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-white/65">Drag the fighter, dodge tracer fire, clear rival jets, and survive the longest launch run.</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs font-black">
            {[
              ['Score', score],
              ['Kills', kills],
              ['Lives', lives],
              ['Level', level]
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2">
                <p className="uppercase text-white/40">{label}</p>
                <p className="mt-1 text-lg text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <button
          type="button"
          onPointerDown={event => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            movePlayerToClientX(event.clientX, event.currentTarget);
          }}
          onPointerMove={event => movePlayerToClientX(event.clientX, event.currentTarget)}
          className="jet-arena-stage relative mx-auto aspect-[39/56] w-full max-w-[370px] touch-none overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900 text-left shadow-2xl shadow-cyan-500/20"
          aria-label="Jet Fighter arena"
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
          {hitFlash > 0 && <div key={hitFlash} className="absolute inset-0 animate-pulse bg-rose-500/15" />}

          {!running && !gameOver && (
            <div className="absolute inset-0 z-30 grid place-items-center bg-slate-950/38 p-6 text-center backdrop-blur-[1px]">
              <div className="rounded-3xl border border-white/15 bg-white/90 p-5 text-slate-950 shadow-2xl">
                <p className="text-2xl font-black">Tap to launch</p>
                <p className="mt-2 text-sm font-bold text-slate-700">Drag left or right. The jet fires automatically.</p>
              </div>
            </div>
          )}
        </button>

        <aside className="grid gap-4 md:grid-cols-2 xl:block xl:space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
            <p className="flex items-center gap-2 text-sm font-black text-white">
              <Trophy size={17} className="text-yellow-200" />
              Jet Best
            </p>
            <p className="mt-2 text-3xl font-black">{stats?.jetFighterStats?.highScore || 0}</p>
            <p className="mt-2 text-xs leading-5 text-white/45">Score rewards survival time, rival jet takedowns, and higher levels.</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <p className="flex items-center gap-2 text-sm font-black text-white">
              <Shield size={17} className="text-cyan-200" />
              Controls
            </p>
            <p className="mt-2 text-xs leading-5 text-white/45">Drag on mobile. Arrow keys work on laptop. Avoid tracer rounds, collisions, and missed rival jets.</p>
            <p className="mt-3 rounded-2xl bg-white/5 px-3 py-2 text-xs font-black text-cyan-100">Weapon: {weapon === 'single' ? '20mm Cannon' : weapon === 'double' ? 'Twin Cannon' : weapon === 'machine' ? 'Rapid Cannon' : 'Missile Spread'}</p>
          </div>
        </aside>
      </div>

      <GameOverModal
        open={gameOver}
        title="Mission ended"
        score={score}
        detail={`${kills} rival jets cleared at level ${level}.`}
        saving={saving}
        saved={saved}
        onRetry={resetGame}
        onExit={() => setGameOver(false)}
      />
    </section>
  );
}
