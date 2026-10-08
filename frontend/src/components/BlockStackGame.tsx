// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Bomb, RotateCcw, Save, Sword, Timer, Trophy, XCircle, Zap } from 'lucide-react';
import api from '../services/api';
import GameOverModal from './GameOverModal';

const GAME_DURATION_MS = 60_000;
const MAX_STRIKES = 3;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const FRUIT_POOL = [
  {
    key: 'apple',
    name: 'Apple',
    skin: '#ef4444',
    skinDark: '#b91c1c',
    flesh: '#fee2e2',
    juice: '#fb7185',
    juiceAlt: '#fecaca',
    leaf: '#22c55e',
    seed: '#7f1d1d',
    score: 14,
    squashY: 0.96
  },
  {
    key: 'orange',
    name: 'Orange',
    skin: '#f97316',
    skinDark: '#c2410c',
    flesh: '#fed7aa',
    juice: '#fb923c',
    juiceAlt: '#fde68a',
    leaf: '#65a30d',
    seed: '#7c2d12',
    score: 13,
    squashY: 1
  },
  {
    key: 'watermelon',
    name: 'Watermelon',
    skin: '#16a34a',
    skinDark: '#166534',
    flesh: '#f43f5e',
    juice: '#f43f5e',
    juiceAlt: '#22c55e',
    leaf: '#22c55e',
    seed: '#111827',
    score: 16,
    squashY: 0.82
  },
  {
    key: 'strawberry',
    name: 'Strawberry',
    skin: '#e11d48',
    skinDark: '#9f1239',
    flesh: '#fecdd3',
    juice: '#e11d48',
    juiceAlt: '#fda4af',
    leaf: '#16a34a',
    seed: '#fde68a',
    score: 15,
    squashY: 1.08
  },
  {
    key: 'kiwi',
    name: 'Kiwi',
    skin: '#92400e',
    skinDark: '#451a03',
    flesh: '#84cc16',
    juice: '#a3e635',
    juiceAlt: '#ecfccb',
    leaf: '#65a30d',
    seed: '#111827',
    score: 15,
    squashY: 1
  },
  {
    key: 'mango',
    name: 'Mango',
    skin: '#facc15',
    skinDark: '#ea580c',
    flesh: '#fde68a',
    juice: '#f59e0b',
    juiceAlt: '#fef3c7',
    leaf: '#16a34a',
    seed: '#92400e',
    score: 14,
    squashY: 1.12
  },
  {
    key: 'banana',
    name: 'Banana',
    skin: '#facc15',
    skinDark: '#ca8a04',
    flesh: '#fef3c7',
    juice: '#facc15',
    juiceAlt: '#fef9c3',
    leaf: '#65a30d',
    seed: '#854d0e',
    score: 12,
    squashY: 0.78
  }
];

const pickFruit = () => FRUIT_POOL[Math.floor(Math.random() * FRUIT_POOL.length)];

const colorWithAlpha = (color, alpha = 1) => {
  const normalized = String(color || '').trim();
  const hex = normalized.match(/^#?([0-9a-f]{6})$/i)?.[1];
  if (!hex) return normalized || `rgba(255,255,255,${alpha})`;
  const value = Number.parseInt(hex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
};

const buildEntity = (bounds, now, difficulty) => {
  const isBomb = Math.random() < clamp(0.14 + difficulty * 0.02, 0.14, 0.26);
  const radius = isBomb ? 20 + Math.random() * 5 : 22 + Math.random() * 8;
  const xPadding = radius + 18;
  const x = xPadding + Math.random() * Math.max(1, bounds.width - xPadding * 2);
  const y = bounds.height + radius + 14;
  const upwardBase = bounds.height * (0.7 + Math.random() * 0.22);
  const vx = (Math.random() - 0.5) * (110 + difficulty * 18);
  const vy = -upwardBase;
  const fruit = pickFruit();
  return {
    id: `${now}-${Math.random().toString(36).slice(2)}`,
    type: isBomb ? 'bomb' : 'fruit',
    x,
    y,
    vx,
    vy,
    gravity: 470 + Math.random() * 120,
    radius,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 2.8,
    topColor: isBomb ? '#94a3b8' : fruit.juice,
    bottomColor: isBomb ? '#334155' : fruit.juiceAlt,
    fruit,
    label: fruit.name,
    sliced: false
  };
};

const distancePointToSegment = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (!dx && !dy) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
  const nx = x1 + t * dx;
  const ny = y1 + t * dy;
  return Math.hypot(px - nx, py - ny);
};

const drawLeaf = (ctx, x, y, size, color = '#22c55e', rotation = -0.7) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, size, size * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colorWithAlpha('#ffffff', 0.35);
  ctx.lineWidth = Math.max(1, size * 0.12);
  ctx.beginPath();
  ctx.moveTo(-size * 0.55, 0);
  ctx.lineTo(size * 0.55, 0);
  ctx.stroke();
  ctx.restore();
};

const drawFruitSeeds = (ctx, fruit, radius, count = 8, seedRadius = 1.6) => {
  ctx.fillStyle = fruit.seed;
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count;
    const distance = radius * (0.25 + (i % 2) * 0.18);
    ctx.save();
    ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, seedRadius, seedRadius * 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
};

const drawFruitSprite = (ctx, item, options = {}) => {
  const fruit = item.fruit || FRUIT_POOL[0];
  const radius = item.radius;
  const half = options.half || 0;

  ctx.save();
  if (typeof options.alpha === 'number') ctx.globalAlpha *= clamp(options.alpha, 0, 1);
  if (half) {
    ctx.beginPath();
    if (half < 0) ctx.rect(-radius * 1.55, -radius * 1.65, radius * 1.55, radius * 3.3);
    else ctx.rect(0, -radius * 1.65, radius * 1.55, radius * 3.3);
    ctx.clip();
  }

  ctx.scale(1, fruit.squashY || 1);

  const glow = ctx.createRadialGradient(-radius * 0.35, -radius * 0.45, radius * 0.05, 0, 0, radius * 1.15);
  glow.addColorStop(0, colorWithAlpha('#ffffff', 0.88));
  glow.addColorStop(0.3, fruit.skin);
  glow.addColorStop(1, fruit.skinDark);

  if (fruit.key === 'banana') {
    ctx.lineCap = 'round';
    ctx.strokeStyle = fruit.skinDark;
    ctx.lineWidth = radius * 0.7;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.82, -radius * 0.16);
    ctx.bezierCurveTo(-radius * 0.28, radius * 0.7, radius * 0.68, radius * 0.52, radius * 0.92, -radius * 0.24);
    ctx.stroke();
    ctx.strokeStyle = fruit.skin;
    ctx.lineWidth = radius * 0.56;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.78, -radius * 0.18);
    ctx.bezierCurveTo(-radius * 0.22, radius * 0.55, radius * 0.58, radius * 0.42, radius * 0.84, -radius * 0.24);
    ctx.stroke();
    ctx.strokeStyle = fruit.flesh;
    ctx.lineWidth = radius * 0.18;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.58, -radius * 0.03);
    ctx.bezierCurveTo(-radius * 0.13, radius * 0.36, radius * 0.42, radius * 0.28, radius * 0.6, -radius * 0.16);
    ctx.stroke();
  } else if (fruit.key === 'strawberry') {
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(0, radius * 0.95);
    ctx.bezierCurveTo(-radius * 1.05, radius * 0.25, -radius * 0.82, -radius * 0.74, -radius * 0.18, -radius * 0.76);
    ctx.bezierCurveTo(radius * 0.52, -radius * 0.82, radius * 1.02, radius * 0.02, 0, radius * 0.95);
    ctx.fill();
    drawLeaf(ctx, -radius * 0.32, -radius * 0.78, radius * 0.25, fruit.leaf, -0.25);
    drawLeaf(ctx, 0, -radius * 0.84, radius * 0.28, fruit.leaf, -1.45);
    drawLeaf(ctx, radius * 0.32, -radius * 0.78, radius * 0.25, fruit.leaf, -2.7);
    ctx.fillStyle = fruit.seed;
    for (let row = 0; row < 4; row += 1) {
      const y = -radius * 0.35 + row * radius * 0.28;
      const rowCount = row % 2 ? 3 : 4;
      for (let col = 0; col < rowCount; col += 1) {
        const x = (col - (rowCount - 1) / 2) * radius * 0.32;
        ctx.beginPath();
        ctx.ellipse(x, y, radius * 0.035, radius * 0.065, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (fruit.key === 'watermelon') {
    ctx.fillStyle = fruit.skinDark;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fruit.skin;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.86, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fruit.flesh;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.68, 0, Math.PI * 2);
    ctx.fill();
    drawFruitSeeds(ctx, fruit, radius * 0.62, 8, radius * 0.045);
  } else if (fruit.key === 'kiwi') {
    ctx.fillStyle = fruit.skin;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fruit.flesh;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fruit.juiceAlt;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.28, 0, Math.PI * 2);
    ctx.fill();
    drawFruitSeeds(ctx, fruit, radius * 0.58, 14, radius * 0.032);
  } else if (fruit.key === 'mango') {
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.82, radius * 1.05, -0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colorWithAlpha(fruit.skinDark, 0.35);
    ctx.beginPath();
    ctx.ellipse(radius * 0.2, radius * 0.22, radius * 0.55, radius * 0.82, -0.55, 0, Math.PI * 2);
    ctx.fill();
    drawLeaf(ctx, radius * 0.28, -radius * 0.96, radius * 0.22, fruit.leaf, -0.35);
  } else {
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    if (fruit.key === 'apple') {
      ctx.fillStyle = colorWithAlpha(fruit.skinDark, 0.55);
      ctx.beginPath();
      ctx.ellipse(0, -radius * 0.76, radius * 0.24, radius * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#854d0e';
      ctx.lineWidth = Math.max(2, radius * 0.08);
      ctx.beginPath();
      ctx.moveTo(radius * 0.03, -radius * 0.78);
      ctx.quadraticCurveTo(radius * 0.1, -radius * 1.12, radius * 0.26, -radius * 1.18);
      ctx.stroke();
      drawLeaf(ctx, radius * 0.42, -radius * 1.02, radius * 0.22, fruit.leaf, -0.25);
    } else {
      drawLeaf(ctx, radius * 0.24, -radius * 0.95, radius * 0.18, fruit.leaf, -0.35);
      ctx.fillStyle = colorWithAlpha('#ffffff', 0.18);
      for (let i = 0; i < 10; i += 1) {
        const angle = (Math.PI * 2 * i) / 10;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * radius * 0.48, Math.sin(angle) * radius * 0.48, radius * 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.fillStyle = colorWithAlpha('#ffffff', 0.3);
  ctx.beginPath();
  ctx.ellipse(-radius * 0.33, -radius * 0.38, radius * 0.18, radius * 0.1, -0.7, 0, Math.PI * 2);
  ctx.fill();

  if (half) {
    ctx.strokeStyle = colorWithAlpha(fruit.flesh, 0.9);
    ctx.lineWidth = Math.max(2, radius * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, -radius * 1.05);
    ctx.lineTo(0, radius * 1.05);
    ctx.stroke();
  }

  ctx.restore();
};

const drawBombSprite = (ctx, item) => {
  const radius = item.radius;
  const fill = ctx.createRadialGradient(-radius * 0.35, -radius * 0.4, radius * 0.05, 0, 0, radius);
  fill.addColorStop(0, '#e2e8f0');
  fill.addColorStop(0.42, '#64748b');
  fill.addColorStop(1, '#0f172a');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = colorWithAlpha('#ffffff', 0.32);
  ctx.stroke();
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = Math.max(2, radius * 0.1);
  ctx.beginPath();
  ctx.moveTo(radius * 0.22, -radius * 0.75);
  ctx.quadraticCurveTo(radius * 0.54, -radius * 1.05, radius * 0.82, -radius * 0.78);
  ctx.stroke();
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.arc(radius * 0.88, -radius * 0.75, radius * 0.14, 0, Math.PI * 2);
  ctx.fill();
};

export function BlockGameLogo({ compact = false }) {
  return (
    <div className={`${compact ? 'h-12 w-12 rounded-2xl' : 'h-16 w-16 rounded-3xl'} relative grid shrink-0 place-items-center overflow-hidden bg-slate-950 text-white shadow-xl shadow-cyan-500/20 ring-1 ring-cyan-300/20`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_15%,rgba(34,211,238,0.45),transparent_35%),radial-gradient(circle_at_82%_80%,rgba(236,72,153,0.4),transparent_38%)]" />
      <Sword size={compact ? 22 : 28} className="relative text-white drop-shadow-[0_0_12px_rgba(34,211,238,0.6)]" />
    </div>
  );
}

export default function BlockStackGame({ stats, onScoreSaved, onExit }) {
  const canvasRef = useRef(null);
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [runActive, setRunActive] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedScore, setSavedScore] = useState(null);

  const engineRef = useRef({
    rafId: 0,
    running: false,
    lastTs: 0,
    startedAt: 0,
    endedAt: 0,
    spawnClock: 0,
    nextSpawnInMs: 520,
    entities: [],
    particles: [],
    fragments: [],
    splashes: [],
    floaters: [],
    swipeTrail: [],
    score: 0,
    hits: 0,
    strikes: 0,
    combo: 0,
    maxCombo: 0,
    lastSliceAt: 0,
    pointerActive: false,
    pointerId: null,
    shake: 0,
    gameOver: false,
    overReason: ''
  });

  const highScore = stats?.blockStats?.highScore || 0;

  const resetHud = useCallback(() => {
    setScore(0);
    setHits(0);
    setStrikes(0);
    setCombo(0);
    setMaxCombo(0);
    setTimeLeft(Math.ceil(GAME_DURATION_MS / 1000));
    setRunActive(false);
    setGameOver(false);
    setSaving(false);
    setSavedScore(null);
  }, []);

  const pushParticles = useCallback((x, y, colorA, colorB, amount = 20) => {
    const engine = engineRef.current;
    for (let i = 0; i < amount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 110 + Math.random() * 260;
      engine.particles.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 420 + Math.random() * 260,
        maxLife: 680,
        size: 2.2 + Math.random() * 4.6,
        stretch: 1 + Math.random() * 1.8,
        color: Math.random() > 0.5 ? colorA : colorB
      });
    }
  }, []);

  const pushFruitFragments = useCallback((item) => {
    const engine = engineRef.current;
    [-1, 1].forEach((side) => {
      engine.fragments.push({
        id: `${Date.now()}-${side}-${Math.random().toString(36).slice(2)}`,
        fruit: item.fruit,
        x: item.x + side * item.radius * 0.08,
        y: item.y,
        vx: item.vx * 0.22 + side * (120 + Math.random() * 120),
        vy: item.vy * 0.15 - (90 + Math.random() * 120),
        gravity: 520,
        radius: item.radius,
        rotation: item.rotation,
        spin: item.spin + side * (3.6 + Math.random() * 2.8),
        half: side,
        life: 720,
        maxLife: 720
      });
    });
    engine.splashes.push({
      id: `${Date.now()}-splash-${Math.random().toString(36).slice(2)}`,
      x: item.x,
      y: item.y,
      radius: item.radius * 0.35,
      maxRadius: item.radius * 2.2,
      life: 360,
      maxLife: 360,
      color: item.fruit?.juice || item.topColor
    });
  }, []);

  const pushFloatingText = useCallback((text, x, y, color = '#ffffff') => {
    engineRef.current.floaters.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      x,
      y,
      vy: -46 - Math.random() * 24,
      life: 740,
      maxLife: 740,
      color
    });
  }, []);

  const endGame = useCallback((reason = 'Run complete') => {
    const engine = engineRef.current;
    if (engine.gameOver) return;
    engine.running = false;
    engine.gameOver = true;
    engine.overReason = reason;
    engine.endedAt = Date.now();
    if (engine.rafId) cancelAnimationFrame(engine.rafId);
    engine.rafId = 0;
    setRunActive(false);
    setGameOver(true);
  }, []);

  const saveScore = useCallback(async (payload) => {
    if (!payload.score || payload.score <= 0) return;
    setSaving(true);
    try {
      const res = await api.post('/games/block-stack/submit', payload);
      setSavedScore(res.data?.result?.score || payload.score);
      toast.success('Swipe Ninja score saved');
      onScoreSaved?.();
    } catch (err) {
      if (err.response?.status === 404) {
        toast.error('Backend is not updated yet. Redeploy Render backend first.');
      } else {
        toast.error(err.response?.data?.msg || 'Could not save swipe score');
      }
    } finally {
      setSaving(false);
    }
  }, [onScoreSaved]);

  useEffect(() => {
    if (!gameOver) return;
    const engine = engineRef.current;
    if (engine.score <= 0 || saving || savedScore) return;
    const totalActions = engine.hits + engine.strikes;
    const accuracy = totalActions ? Math.round((engine.hits / totalActions) * 100) : 0;
    saveScore({
      score: engine.score,
      moves: Math.max(1, engine.hits),
      linesCleared: engine.hits,
      maxCombo: engine.maxCombo,
      boardFill: accuracy,
      durationMs: Math.max(1000, engine.endedAt - engine.startedAt)
    });
  }, [gameOver, saveScore, savedScore, saving]);

  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const width = clamp(rect.width, 290, 640);
    const height = clamp(Math.round(width * (width < 430 ? 1.18 : 1.26)), 340, 620);
    const isTouchViewport = window.matchMedia?.('(max-width: 767px), (pointer: coarse)')?.matches;
    const dpr = clamp(window.devicePixelRatio || 1, 1, isTouchViewport ? 1.6 : 2.4);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    engineRef.current.bounds = { width, height };
  }, []);

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const engine = engineRef.current;
    const bounds = engine.bounds;
    if (!ctx || !bounds) return;

    ctx.clearRect(0, 0, bounds.width, bounds.height);

    const bg = ctx.createLinearGradient(0, 0, bounds.width, bounds.height);
    bg.addColorStop(0, '#020617');
    bg.addColorStop(0.55, '#0f172a');
    bg.addColorStop(1, '#111827');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, bounds.width, bounds.height);

    ctx.fillStyle = 'rgba(34,211,238,0.1)';
    ctx.beginPath();
    ctx.arc(bounds.width * 0.18, bounds.height * 0.22, bounds.width * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(236,72,153,0.08)';
    ctx.beginPath();
    ctx.arc(bounds.width * 0.82, bounds.height * 0.3, bounds.width * 0.25, 0, Math.PI * 2);
    ctx.fill();

    if (engine.shake > 0) {
      const shake = engine.shake;
      ctx.save();
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    for (const item of engine.entities) {
      if (item.sliced) continue;
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate(item.rotation);
      if (item.type === 'bomb') drawBombSprite(ctx, item);
      else drawFruitSprite(ctx, item);
      ctx.restore();
    }

    for (const fragment of engine.fragments) {
      const alpha = clamp(fragment.life / fragment.maxLife, 0, 1);
      ctx.save();
      ctx.translate(fragment.x, fragment.y);
      ctx.rotate(fragment.rotation);
      drawFruitSprite(ctx, fragment, { half: fragment.half, alpha });
      ctx.restore();
    }

    for (const splash of engine.splashes) {
      const progress = 1 - clamp(splash.life / splash.maxLife, 0, 1);
      ctx.strokeStyle = colorWithAlpha(splash.color, 0.45 * (1 - progress));
      ctx.lineWidth = 3 + progress * 5;
      ctx.beginPath();
      ctx.arc(splash.x, splash.y, splash.radius + splash.maxRadius * progress, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const particle of engine.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = colorWithAlpha(particle.color, alpha);
      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate(Math.atan2(particle.vy, particle.vx));
      ctx.beginPath();
      ctx.ellipse(0, 0, particle.size, particle.size * particle.stretch, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const floater of engine.floaters) {
      const alpha = clamp(floater.life / floater.maxLife, 0, 1);
      ctx.fillStyle = colorWithAlpha(floater.color, alpha);
      ctx.font = '900 16px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(floater.text, floater.x, floater.y);
    }

    if (engine.swipeTrail.length > 1) {
      ctx.lineCap = 'round';
      for (let i = 1; i < engine.swipeTrail.length; i += 1) {
        const prev = engine.swipeTrail[i - 1];
        const point = engine.swipeTrail[i];
        const alpha = i / engine.swipeTrail.length;
        ctx.strokeStyle = `rgba(56,189,248,${(0.2 + alpha * 0.75).toFixed(3)})`;
        ctx.lineWidth = 2 + alpha * 8;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
    }

    if (engine.shake > 0) {
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(15,23,42,0.75)';
    ctx.fillRect(12, 12, 145, 58);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 13px Inter, system-ui, sans-serif';
    ctx.fillText(`Time ${Math.max(0, Math.ceil((GAME_DURATION_MS - (Date.now() - engine.startedAt)) / 1000))}s`, 24, 35);
    ctx.fillText(`Combo x${engine.combo}`, 24, 54);
  }, []);

  const startGame = useCallback(() => {
    const engine = engineRef.current;
    if (engine.rafId) cancelAnimationFrame(engine.rafId);

    engine.running = true;
    engine.lastTs = 0;
    engine.startedAt = Date.now();
    engine.endedAt = 0;
    engine.spawnClock = 0;
    engine.nextSpawnInMs = 520;
    engine.entities = [];
    engine.particles = [];
    engine.fragments = [];
    engine.splashes = [];
    engine.floaters = [];
    engine.swipeTrail = [];
    engine.score = 0;
    engine.hits = 0;
    engine.strikes = 0;
    engine.combo = 0;
    engine.maxCombo = 0;
    engine.lastSliceAt = 0;
    engine.pointerActive = false;
    engine.pointerId = null;
    engine.shake = 0;
    engine.gameOver = false;
    engine.overReason = '';

    resetHud();
    setRunActive(true);
    drawScene();

    const tick = (ts) => {
      const game = engineRef.current;
      if (!game.running) return;
      if (!game.lastTs) game.lastTs = ts;
      const delta = Math.min(34, ts - game.lastTs);
      game.lastTs = ts;

      const elapsed = Date.now() - game.startedAt;
      const remaining = Math.max(0, GAME_DURATION_MS - elapsed);
      const sec = Math.ceil(remaining / 1000);
      setTimeLeft(prev => (prev === sec ? prev : sec));

      if (remaining <= 0) {
        endGame('Time is up');
        drawScene();
        return;
      }

      const difficulty = Math.min(8, Math.floor(elapsed / 7_500));
      game.spawnClock += delta;
      if (game.spawnClock >= game.nextSpawnInMs) {
        game.entities.push(buildEntity(game.bounds, Date.now(), difficulty));
        game.spawnClock = 0;
        const nextMin = Math.max(130, 490 - difficulty * 24 - game.hits * 0.35);
        const nextMax = Math.max(nextMin + 40, 730 - difficulty * 18);
        game.nextSpawnInMs = nextMin + Math.random() * (nextMax - nextMin);
      }

      const dt = delta / 1000;
      game.entities = game.entities.filter((item) => {
        if (item.sliced) return false;

        item.vy += item.gravity * dt;
        item.x += item.vx * dt;
        item.y += item.vy * dt;
        item.rotation += item.spin * dt;

        const goneBottom = item.y - item.radius > game.bounds.height + 20;
        if (goneBottom && item.type === 'fruit') {
          game.strikes += 1;
          game.combo = 0;
          setStrikes(game.strikes);
          setCombo(0);
          if (game.strikes >= MAX_STRIKES) {
            endGame('Too many missed targets');
          }
        }
        return !goneBottom;
      });

      game.fragments = game.fragments.filter((fragment) => {
        fragment.life -= delta;
        fragment.vy += fragment.gravity * dt;
        fragment.x += fragment.vx * dt;
        fragment.y += fragment.vy * dt;
        fragment.rotation += fragment.spin * dt;
        return fragment.life > 0;
      });

      game.splashes = game.splashes.filter((splash) => {
        splash.life -= delta;
        return splash.life > 0;
      });

      game.particles = game.particles.filter((particle) => {
        particle.life -= delta;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 420 * dt;
        return particle.life > 0;
      });

      game.floaters = game.floaters.filter((floater) => {
        floater.life -= delta;
        floater.y += floater.vy * dt;
        return floater.life > 0;
      });

      game.swipeTrail = game.swipeTrail.filter(point => Date.now() - point.t <= 150);
      game.shake = Math.max(0, game.shake - delta * 0.045);
      drawScene();

      if (game.running) {
        game.rafId = requestAnimationFrame(tick);
      }
    };

    engine.rafId = requestAnimationFrame(tick);
  }, [drawScene, endGame, resetHud]);

  const sliceTargets = useCallback(() => {
    const game = engineRef.current;
    if (!game.pointerActive || game.swipeTrail.length < 2 || !game.running) return;
    const curr = game.swipeTrail[game.swipeTrail.length - 1];
    const prev = game.swipeTrail[game.swipeTrail.length - 2];
    const dt = Math.max(1, curr.t - prev.t);
    const speed = Math.hypot(curr.x - prev.x, curr.y - prev.y) / dt;
    if (speed < 0.34) return;

    for (const item of game.entities) {
      if (item.sliced) continue;
      const distance = distancePointToSegment(item.x, item.y, prev.x, prev.y, curr.x, curr.y);
      if (distance > item.radius + 9) continue;

      item.sliced = true;
      if (item.type === 'bomb') {
        game.shake = 12;
        pushParticles(item.x, item.y, '#94a3b8', '#ef4444', 34);
        pushFloatingText('Bomb!', item.x, item.y - item.radius, '#fecaca');
        endGame('Bomb sliced');
        break;
      }

      const now = Date.now();
      game.combo = now - game.lastSliceAt <= 750 ? game.combo + 1 : 1;
      game.maxCombo = Math.max(game.maxCombo, game.combo);
      game.lastSliceAt = now;
      const gained = (item.fruit?.score || 12) + Math.min(110, game.combo * 4);
      game.score += gained;
      game.hits += 1;
      game.shake = Math.max(game.shake, 2.8);
      pushFruitFragments(item);
      pushParticles(item.x, item.y, item.fruit?.juice || item.topColor, item.fruit?.juiceAlt || item.bottomColor, 24 + Math.min(16, game.combo * 2));
      pushFloatingText(`+${gained}`, item.x, item.y - item.radius * 0.7, item.fruit?.juiceAlt || '#ffffff');
      if (game.combo >= 3) pushFloatingText(`x${game.combo}`, item.x + item.radius * 0.65, item.y, '#ffffff');

      setScore(game.score);
      setHits(game.hits);
      setCombo(game.combo);
      setMaxCombo(game.maxCombo);
    }
  }, [endGame, pushFloatingText, pushFruitFragments, pushParticles]);

  const toCanvasPoint = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
      t: Date.now()
    };
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (!runActive) return;
    const game = engineRef.current;
    game.pointerActive = true;
    game.pointerId = event.pointerId;
    const point = toCanvasPoint(event);
    if (!point) return;
    game.swipeTrail = [point];
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, [runActive, toCanvasPoint]);

  const handlePointerMove = useCallback((event) => {
    const game = engineRef.current;
    if (!game.pointerActive) return;
    if (game.pointerId !== null && event.pointerId !== game.pointerId) return;
    const point = toCanvasPoint(event);
    if (!point) return;
    game.swipeTrail.push(point);
    if (game.swipeTrail.length > 14) game.swipeTrail.splice(0, game.swipeTrail.length - 14);
    sliceTargets();
    event.preventDefault();
  }, [sliceTargets, toCanvasPoint]);

  const handlePointerUp = useCallback((event) => {
    const game = engineRef.current;
    if (game.pointerId !== null && event.pointerId !== undefined && event.pointerId !== game.pointerId) return;
    game.pointerActive = false;
    game.pointerId = null;
    game.swipeTrail = [];
    event.preventDefault();
  }, []);

  useEffect(() => {
    syncCanvasSize();
    drawScene();
    const onResize = () => {
      syncCanvasSize();
      drawScene();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [drawScene, syncCanvasSize]);

  useEffect(() => () => {
    const engine = engineRef.current;
    engine.running = false;
    if (engine.rafId) cancelAnimationFrame(engine.rafId);
  }, []);

  const safeRatio = useMemo(() => {
    const total = hits + strikes;
    return total ? Math.round((hits / total) * 100) : 100;
  }, [hits, strikes]);

  const retry = useCallback(() => {
    startGame();
  }, [startGame]);

  const manualSave = useCallback(() => {
    const engine = engineRef.current;
    if (saving || savedScore || engine.score <= 0) return;
    saveScore({
      score: engine.score,
      moves: Math.max(1, engine.hits),
      linesCleared: engine.hits,
      maxCombo: engine.maxCombo,
      boardFill: safeRatio,
      durationMs: Math.max(1000, (engine.endedAt || Date.now()) - engine.startedAt)
    });
  }, [safeRatio, saveScore, savedScore, saving]);

  return (
    <section className="swipe-ninja-game overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="swipe-ninja-header relative overflow-hidden border-b border-gray-200 px-5 py-5 dark:border-gray-800">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_15%,rgba(34,211,238,0.14),transparent_30%),radial-gradient(circle_at_90%_20%,rgba(236,72,153,0.14),transparent_35%)]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <BlockGameLogo />
            <div>
              <p className="text-xs font-black uppercase text-cyan-600 dark:text-cyan-200">Arcade Swipe Game</p>
              <h2 className="text-2xl font-black text-gray-950 dark:text-white">Swipe Ninja</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-gray-600 dark:text-gray-300">
                Slice real fruit sprites, dodge bombs, and chain juicy combos for higher score.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onExit && (
              <button type="button" onClick={onExit} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-black text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700">
                Back
              </button>
            )}
            <button type="button" onClick={retry} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100">
              <RotateCcw size={16} />
              {runActive ? 'New Run' : 'Start Run'}
            </button>
          </div>
        </div>
      </div>

      <div className="swipe-ninja-shell grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_270px]">
        <div className="space-y-4">
          <div className="swipe-ninja-stats grid gap-3 sm:grid-cols-5">
            <StatCard label="Score" value={score} icon={Trophy} />
            <StatCard label="Sliced" value={hits} icon={Sword} />
            <StatCard label="Combo" value={`x${combo}`} icon={Zap} />
            <StatCard label="Misses" value={`${strikes}/${MAX_STRIKES}`} icon={XCircle} />
            <StatCard label="Time" value={`${timeLeft}s`} icon={Timer} />
          </div>

          <div className="swipe-ninja-canvas-frame rounded-[1.8rem] border border-white/10 bg-gray-950 p-3 shadow-2xl shadow-cyan-500/15">
            <div className="swipe-ninja-canvas-wrap relative mx-auto w-full max-w-[640px]">
              <canvas
                ref={canvasRef}
                className="swipe-ninja-canvas touch-none select-none rounded-[1.3rem] ring-1 ring-white/10"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerUp}
                aria-label="Swipe Ninja game canvas"
              />
              {!runActive && !gameOver && (
                <div className="absolute inset-0 grid place-items-center rounded-[1.3rem] bg-black/30 p-4">
                  <button
                    type="button"
                    onClick={retry}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-gray-950"
                  >
                    <RotateCcw size={16} />
                    Start Run
                  </button>
                </div>
              )}
            </div>
          </div>

          {gameOver && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-100">
              Run ended. Score {score}. {score <= 0 ? 'Slice at least one target to save score.' : savedScore ? 'Saved to rankings.' : saving ? 'Saving score...' : 'Save pending.'}
            </div>
          )}
        </div>

        <aside className="swipe-ninja-side space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
            <p className="text-sm font-black text-gray-800 dark:text-gray-100">Run status</p>
            <div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-300">
              <p className="flex items-center justify-between"><span>Active run</span><span className="font-black">{runActive ? 'Live' : 'Stopped'}</span></p>
              <p className="flex items-center justify-between"><span>Highest combo</span><span className="font-black">x{maxCombo}</span></p>
              <p className="flex items-center justify-between"><span>Precision</span><span className="font-black">{safeRatio}%</span></p>
            </div>
          </div>

          <div className="rounded-3xl border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-900/60 dark:bg-cyan-950/25">
            <p className="flex items-center gap-2 text-xs font-black uppercase text-cyan-700 dark:text-cyan-200">
              <Trophy size={15} />
              Swipe Ninja Best
            </p>
            <p className="mt-1 text-3xl font-black text-gray-950 dark:text-white">{highScore}</p>
          </div>

          <div className="rounded-3xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900/60 dark:bg-violet-950/25">
            <p className="flex items-center gap-2 text-xs font-black uppercase text-violet-700 dark:text-violet-200">
              <Bomb size={15} />
              Saved run
            </p>
            <p className="mt-1 text-3xl font-black text-gray-950 dark:text-white">{savedScore || '-'}</p>
          </div>

          <button
            type="button"
            disabled={saving || savedScore || score <= 0}
            onClick={manualSave}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-3 text-sm font-black text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
          >
            {saving ? <Zap size={17} className="animate-pulse" /> : <Save size={17} />}
            {saving ? 'Saving...' : savedScore ? 'Saved' : score <= 0 ? 'No score yet' : 'Save score'}
          </button>
        </aside>
      </div>

      <GameOverModal
        open={gameOver}
        title="Swipe Ninja run ended"
        score={score}
        detail={score <= 0 ? 'Slice targets to record a ranked score.' : 'Great run. You can restart instantly for a better combo.'}
        saving={saving}
        saved={Boolean(savedScore)}
        onRetry={retry}
        onExit={() => setGameOver(false)}
      />
    </section>
  );
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="swipe-ninja-stat rounded-2xl border border-gray-200 bg-gray-50 p-3 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800/60">
      <p className="inline-flex items-center gap-1 text-[11px] font-black uppercase text-gray-500 dark:text-gray-400">
        {Icon ? <Icon size={13} /> : null}
        {label}
      </p>
      <p className="mt-1 text-xl font-black text-gray-950 dark:text-white">{value}</p>
    </div>
  );
}
