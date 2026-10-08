// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Crown, Crosshair, Loader2, Radio, RotateCcw, Shield, Sparkles, Swords, Trophy, Volume2, VolumeX, Wind, Zap } from 'lucide-react';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { useAuth } from '../context/AuthContext';
import { resolveMediaUrl } from '../utils/media';

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 620;
const PROJECTILE_GRAVITY = 0.22;
const SHOT_ANIMATION_MS = 1600;
const HEADSHOT_ANIMATION_MS = 2200;
const CAMERA_RETURN_MS = 900;
const KNIFE_RELEASE_PROGRESS = 0.16;
const MAX_HP = 540;
const DEFAULT_OBSTACLES = [
  { id: 'valley-spire', label: 'Stone Spire', x: 792, y: 426, width: 92, height: 128 },
  { id: 'ridge-pillar', label: 'Ridge Pillar', x: 1030, y: 462, width: 70, height: 96 }
];
const EMOTE_LABELS = ['Nice', 'Close', 'Focus', 'Again', 'GG'];
const FINISH_CINEMATIC_MS = 3400;
const WIND_BURST_ZONES = [
  { x: 522, y: 250, radius: 92, speed: 0.62, drift: 22 },
  { x: 852, y: 322, radius: 120, speed: 0.48, drift: 28 },
  { x: 1190, y: 392, radius: 82, speed: 0.72, drift: 18 }
];
const FALLING_ROCKS = [
  { x: 388, delay: 0.04, span: 220, size: 10 },
  { x: 710, delay: 0.38, span: 260, size: 8 },
  { x: 1036, delay: 0.68, span: 210, size: 12 },
  { x: 1322, delay: 0.2, span: 245, size: 9 }
];

const BOW_TIERS = [
  { name: 'Street Shiv', bonus: 0, color: '#e2e8f0', effect: 'Clean throw', icon: '/game-assets/knife-duel/daggers/cutouts/dagger-1-cutout.png' },
  { name: 'Hunter Dagger', bonus: 5, color: '#67e8f9', effect: 'Aqua trail', icon: '/game-assets/knife-duel/daggers/cutouts/dagger-2-cutout.png' },
  { name: 'Mercury Knife', bonus: 10, color: '#60a5fa', effect: 'Fast spin', icon: '/game-assets/knife-duel/daggers/cutouts/dagger-4-cutout.png' },
  { name: 'Viper Fang', bonus: 15, color: '#f97316', effect: 'Venom spark', icon: '/game-assets/knife-duel/daggers/cutouts/dagger-7-cutout.png' },
  { name: 'Starfall Kris', bonus: 20, color: '#fde68a', effect: 'Golden burst', icon: '/game-assets/knife-duel/daggers/cutouts/dagger-10-cutout.png' }
];
const KNIFE_DUEL_FIGHTER_ASSETS = {
  left: {
    idle: '/game-assets/knife-duel/city-men/City_men_1/Idle.png',
    attack: '/game-assets/knife-duel/city-men/City_men_1/Attack.png',
    hurt: '/game-assets/knife-duel/city-men/City_men_1/Hurt.png',
    dead: '/game-assets/knife-duel/city-men/City_men_1/Dead.png'
  },
  right: {
    idle: '/game-assets/knife-duel/city-men/City_men_2/Idle.png',
    attack: '/game-assets/knife-duel/city-men/City_men_2/Attack.png',
    hurt: '/game-assets/knife-duel/city-men/City_men_2/Hurt.png',
    dead: '/game-assets/knife-duel/city-men/City_men_2/Dead.png'
  }
};
const KNIFE_DUEL_EXPLOSION_ASSETS = Array.from({ length: 10 }, (_, index) => `/game-assets/knife-duel/explosion/Explosion_${index + 1}.png`);
const KNIFE_DUEL_BACKGROUND_ASSET = '/game-assets/knife-duel/backgrounds/desert/set1-background.png';
const SPRITE_FRAME_SIZE = 128;
const THROW_ORIGIN_HEIGHT = 118;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, amount) => from + (to - from) * amount;
const getEntityId = (entity) => String(entity?._id || entity?.id || entity || '');
const formatScore = (value = 0) => Number(value || 0).toLocaleString();
const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);
const getShotKey = (shot = {}) => `${shot.userId || 'shot'}:${shot.round || 0}:${shot.firedAt || ''}:${shot.angle || 0}:${shot.power || 0}`;
const getShotDuration = (shot) => (shot?.headshot ? HEADSHOT_ANIMATION_MS : SHOT_ANIMATION_MS);
const getShotProgress = (startTime, time, shot) => {
  if (!startTime) return 1;
  return clamp((time - startTime) / getShotDuration(shot), 0, 1);
};
const getTimingPower = (time) => Math.round(42 + (Math.sin(time / 210) * 0.5 + 0.5) * 58);
const getFinishProgress = (time, finishStartedAt) => (
  finishStartedAt ? clamp((time - finishStartedAt) / FINISH_CINEMATIC_MS, 0, 1) : 1
);

const createBowAudioController = () => {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  const context = new AudioContextClass();
  const master = context.createGain();
  const effects = context.createGain();
  const music = context.createGain();
  let muted = false;
  let musicTimer = null;

  master.gain.value = 0.72;
  effects.gain.value = 0.9;
  music.gain.value = 0.12;
  effects.connect(master);
  music.connect(master);
  master.connect(context.destination);

  const resume = () => (
    context.state === 'suspended'
      ? context.resume().catch(() => {})
      : Promise.resolve()
  );

  const setMuted = (nextMuted) => {
    muted = Boolean(nextMuted);
    master.gain.setTargetAtTime(muted ? 0.0001 : 0.72, context.currentTime, 0.035);
  };

  const playTone = (frequency, duration, type = 'sine', gain = 0.12, when = 0, destination = effects) => {
    if (muted) return;
    const start = context.currentTime + when;
    const osc = context.createOscillator();
    const amp = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.018);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp);
    amp.connect(destination);
    osc.start(start);
    osc.stop(start + duration + 0.04);
  };

  const playSweep = (from, to, duration, type = 'triangle', gain = 0.12, when = 0) => {
    if (muted) return;
    const start = context.currentTime + when;
    const osc = context.createOscillator();
    const amp = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp);
    amp.connect(effects);
    osc.start(start);
    osc.stop(start + duration + 0.04);
  };

  const playNoise = (duration, gain = 0.14, when = 0, filterFrequency = 1400) => {
    if (muted) return;
    const sampleRate = context.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = context.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const amp = context.createGain();
    const start = context.currentTime + when;
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFrequency, start);
    filter.Q.value = 0.8;
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(effects);
    source.start(start);
    source.stop(start + duration + 0.02);
  };

  const playMusicPhrase = () => {
    if (muted) return;
    [196, 247, 294, 330, 247, 392, 330, 294].forEach((note, index) => {
      playTone(note, 0.34, 'sine', 0.022, index * 0.32, music);
      if (index % 4 === 0) playTone(note / 2, 1.1, 'triangle', 0.016, index * 0.32, music);
    });
  };

  return {
    resume,
    setMuted,
    startMusic() {
      if (musicTimer) return;
      playMusicPhrase();
      musicTimer = window.setInterval(playMusicPhrase, 2900);
    },
    stopMusic() {
      if (musicTimer) window.clearInterval(musicTimer);
      musicTimer = null;
    },
    playShoot() {
      resume();
      playNoise(0.06, 0.08, 0, 2800);
      playSweep(720, 210, 0.2, 'sawtooth', 0.1, 0.02);
      playTone(122, 0.12, 'triangle', 0.07, 0.03);
    },
    playImpact(headshot = false, zone = '') {
      resume();
      const leg = zone === 'leg';
      playNoise(headshot ? 0.24 : leg ? 0.2 : 0.16, headshot ? 0.24 : leg ? 0.18 : 0.15, 0, headshot ? 1050 : leg ? 580 : 720);
      playTone(headshot ? 86 : leg ? 112 : 132, headshot ? 0.34 : leg ? 0.26 : 0.2, 'triangle', headshot ? 0.18 : 0.12, 0.02);
      if (headshot) playTone(520, 0.18, 'sine', 0.09, 0.04);
      if (leg) playNoise(0.22, 0.09, 0.07, 430);
    },
    playPain(headshot = false) {
      resume();
      playSweep(headshot ? 230 : 190, headshot ? 92 : 118, headshot ? 0.42 : 0.28, 'triangle', headshot ? 0.12 : 0.08, 0.04);
    },
    playMiss() {
      resume();
      playNoise(0.12, 0.07, 0, 3100);
      playSweep(420, 260, 0.16, 'sine', 0.045, 0.02);
    },
    dispose() {
      if (musicTimer) window.clearInterval(musicTimer);
      musicTimer = null;
      context.close?.().catch(() => {});
    }
  };
};

const getArcherPoint = (side = 'left') => ({
  x: side === 'left' ? 150 : 1450,
  y: side === 'left' ? 320 : 535
});

const getFullCamera = (width, height) => ({
  x: WORLD_WIDTH / 2,
  y: WORLD_HEIGHT / 2,
  zoom: Math.min((width / WORLD_WIDTH) * 1.08, (height / WORLD_HEIGHT) * 1.02),
  shakeX: 0,
  shakeY: 0,
  mode: 'wide'
});

const vibrate = (pattern) => {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(pattern);
};

const normalizeCamera = (camera, width, height) => {
  const zoom = Math.max(0.05, camera.zoom || getFullCamera(width, height).zoom);
  const halfWidth = width / (2 * zoom);
  const halfHeight = height / (2 * zoom);
  const x = halfWidth >= WORLD_WIDTH / 2
    ? WORLD_WIDTH / 2
    : clamp(camera.x, halfWidth, WORLD_WIDTH - halfWidth);
  const y = halfHeight >= WORLD_HEIGHT / 2
    ? WORLD_HEIGHT / 2
    : clamp(camera.y, halfHeight, WORLD_HEIGHT - halfHeight);

  return {
    ...camera,
    x,
    y,
    zoom,
    shakeX: camera.shakeX || 0,
    shakeY: camera.shakeY || 0
  };
};

const applyCameraTransform = (ctx, width, height, camera) => {
  const normalized = normalizeCamera(camera, width, height);
  ctx.translate(width / 2 + normalized.shakeX, height / 2 + normalized.shakeY);
  ctx.scale(normalized.zoom, normalized.zoom);
  ctx.translate(-normalized.x, -normalized.y);
  return normalized;
};

const screenToWorld = (event, canvas, camera) => {
  const rect = canvas.getBoundingClientRect();
  const currentCamera = camera || getFullCamera(rect.width, rect.height);
  return {
    x: currentCamera.x + ((event.clientX - rect.left) - rect.width / 2 - (currentCamera.shakeX || 0)) / currentCamera.zoom,
    y: currentCamera.y + ((event.clientY - rect.top) - rect.height / 2 - (currentCamera.shakeY || 0)) / currentCamera.zoom
  };
};

const getShotPoint = (shot, progress) => {
  const points = shot?.trajectory || [];
  if (!points.length) return shot?.impact || { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
  const lastPointIndex = points.length - 1;
  const floatIndex = lastPointIndex * clamp(progress, 0, 1);
  const index = Math.min(lastPointIndex, Math.max(0, Math.floor(floatIndex)));
  const mix = floatIndex - Math.floor(floatIndex);
  const base = points[index] || points[lastPointIndex];
  const next = points[Math.min(lastPointIndex, index + 1)] || base;
  return {
    x: base.x + (next.x - base.x) * mix,
    y: base.y + (next.y - base.y) * mix
  };
};

const loadCanvasImage = (src) => new Promise((resolve) => {
  if (typeof window === 'undefined' || !src) {
    resolve(null);
    return;
  }
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = src;
});

const loadKnifeDuelAssets = async () => {
  const [leftIdle, leftAttack, leftHurt, leftDead, rightIdle, rightAttack, rightHurt, rightDead, background, ...rest] = await Promise.all([
    loadCanvasImage(KNIFE_DUEL_FIGHTER_ASSETS.left.idle),
    loadCanvasImage(KNIFE_DUEL_FIGHTER_ASSETS.left.attack),
    loadCanvasImage(KNIFE_DUEL_FIGHTER_ASSETS.left.hurt),
    loadCanvasImage(KNIFE_DUEL_FIGHTER_ASSETS.left.dead),
    loadCanvasImage(KNIFE_DUEL_FIGHTER_ASSETS.right.idle),
    loadCanvasImage(KNIFE_DUEL_FIGHTER_ASSETS.right.attack),
    loadCanvasImage(KNIFE_DUEL_FIGHTER_ASSETS.right.hurt),
    loadCanvasImage(KNIFE_DUEL_FIGHTER_ASSETS.right.dead),
    loadCanvasImage(KNIFE_DUEL_BACKGROUND_ASSET),
    ...BOW_TIERS.map(tier => loadCanvasImage(tier.icon)),
    ...KNIFE_DUEL_EXPLOSION_ASSETS.map(loadCanvasImage)
  ]);
  return {
    fighters: {
      left: { idle: leftIdle, attack: leftAttack, hurt: leftHurt, dead: leftDead },
      right: { idle: rightIdle, attack: rightAttack, hurt: rightHurt, dead: rightDead }
    },
    background,
    knives: rest.slice(0, BOW_TIERS.length),
    explosions: rest.slice(BOW_TIERS.length).filter(Boolean)
  };
};

const getSpriteFrameCount = (image) => Math.max(1, Math.floor((image?.width || SPRITE_FRAME_SIZE) / SPRITE_FRAME_SIZE));

const drawSpriteFrame = (ctx, image, frameIndex, x, y, width, height) => {
  if (!image) return false;
  const frameCount = getSpriteFrameCount(image);
  const frame = Math.abs(Math.floor(frameIndex)) % frameCount;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, frame * SPRITE_FRAME_SIZE, 0, SPRITE_FRAME_SIZE, SPRITE_FRAME_SIZE, x, y, width, height);
  ctx.imageSmoothingEnabled = true;
  return true;
};

const drawRoundedRect = (ctx, x, y, width, height, radius) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
};

const drawMountainRange = (ctx, points, baseY, topColor, bottomColor, alpha = 1) => {
  const fill = ctx.createLinearGradient(0, 92, 0, baseY);
  fill.addColorStop(0, topColor);
  fill.addColorStop(1, bottomColor);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  points.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(WORLD_WIDTH, baseY);
  ctx.closePath();
  ctx.fill();

  points.forEach(([x, y], index) => {
    if (y > 178 || index % 2) return;
    ctx.fillStyle = 'rgba(255,255,255,0.46)';
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x - 34, y + 54);
    ctx.lineTo(x + 28, y + 54);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
};

const drawSandstoneLedge = (ctx, x, y, width, height, side = 'left') => {
  const dir = side === 'left' ? 1 : -1;
  ctx.save();
  ctx.fillStyle = 'rgba(68,45,27,0.28)';
  ctx.beginPath();
  ctx.ellipse(x + width * 0.5, y + height + 13, width * 0.48, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  const ledge = ctx.createLinearGradient(x, y, x + width, y + height);
  ledge.addColorStop(0, '#f6d39b');
  ledge.addColorStop(0.42, '#b77946');
  ledge.addColorStop(1, '#6f432b');
  ctx.fillStyle = ledge;
  ctx.beginPath();
  ctx.moveTo(x, y + 22);
  ctx.quadraticCurveTo(x + width * 0.18, y - 12, x + width * 0.44, y + 4);
  ctx.lineTo(x + width, y + 28);
  ctx.lineTo(x + width * 0.88, y + height);
  ctx.lineTo(x + width * 0.18, y + height + 18);
  ctx.lineTo(x - width * 0.08, y + height * 0.62);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,244,214,0.55)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x + 12, y + 18);
  ctx.quadraticCurveTo(x + width * 0.26, y + 2, x + width * 0.62, y + 16);
  ctx.lineTo(x + width - 22, y + 27);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(67,41,25,0.32)';
  ctx.lineWidth = 4;
  for (let crack = 0; crack < 5; crack += 1) {
    const crackX = x + width * (0.18 + crack * 0.15);
    ctx.beginPath();
    ctx.moveTo(crackX, y + 34 + (crack % 2) * 10);
    ctx.lineTo(crackX + dir * (20 + crack * 4), y + height * 0.55);
    ctx.stroke();
  }
  ctx.restore();
};

const drawBackground = (ctx, time, assets = null) => {
  const background = assets?.background;
  if (background) {
    ctx.save();
    const srcHeight = Math.min(background.height, Math.round(background.width / (WORLD_WIDTH / WORLD_HEIGHT)));
    const srcY = clamp(170 + Math.sin(time / 9000) * 8, 0, background.height - srcHeight);
    ctx.drawImage(background, 0, srcY, background.width, srcHeight, -24, -28, WORLD_WIDTH + 48, WORLD_HEIGHT + 64);

    const heat = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
    heat.addColorStop(0, 'rgba(255,237,213,0.08)');
    heat.addColorStop(0.55, 'rgba(251,191,36,0.04)');
    heat.addColorStop(1, 'rgba(67,42,28,0.3)');
    ctx.fillStyle = heat;
    ctx.fillRect(-40, -40, WORLD_WIDTH + 80, WORLD_HEIGHT + 100);

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    for (let index = 0; index < 8; index += 1) {
      const x = ((time * 0.01 + index * 290) % (WORLD_WIDTH + 260)) - 160;
      const y = 40 + (index % 4) * 32;
      ctx.beginPath();
      ctx.ellipse(x, y, 62, 13, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 46, y + 6, 38, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawSandstoneLedge(ctx, -42, 325, 350, 92, 'left');
    drawSandstoneLedge(ctx, 1300, 536, 360, 88, 'right');

    ctx.fillStyle = 'rgba(15,23,42,0.18)';
    ctx.fillRect(-60, WORLD_HEIGHT - 20, WORLD_WIDTH + 120, 70);
    ctx.restore();
    return;
  }

  const sky = ctx.createLinearGradient(0, -240, 0, WORLD_HEIGHT + 240);
  sky.addColorStop(0, '#60a5fa');
  sky.addColorStop(0.42, '#dbeafe');
  sky.addColorStop(1, '#dcfce7');
  ctx.fillStyle = sky;
  ctx.fillRect(-260, -260, WORLD_WIDTH + 520, WORLD_HEIGHT + 560);

  const sunGlow = ctx.createRadialGradient(1260, 76, 10, 1260, 76, 150);
  sunGlow.addColorStop(0, 'rgba(254,240,138,0.95)');
  sunGlow.addColorStop(0.48, 'rgba(251,191,36,0.24)');
  sunGlow.addColorStop(1, 'rgba(251,191,36,0)');
  ctx.fillStyle = sunGlow;
  ctx.fillRect(1060, -110, 430, 340);

  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  for (let index = 0; index < 7; index += 1) {
    const x = ((time * 0.012 + index * 310) % (WORLD_WIDTH + 260)) - 160;
    const y = 46 + (index % 4) * 30;
    ctx.beginPath();
    ctx.ellipse(x, y, 62, 15, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 52, y + 7, 44, 12, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 46, y + 9, 38, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawMountainRange(ctx, [
    [0, 272], [110, 170], [240, 250], [392, 120], [560, 270],
    [730, 148], [910, 260], [1095, 116], [1260, 248], [1430, 144], [1600, 230]
  ], 348, '#b7d1db', '#dce9cf', 0.82);

  drawMountainRange(ctx, [
    [0, 318], [122, 216], [260, 310], [426, 190], [590, 326],
    [760, 220], [930, 328], [1110, 188], [1280, 310], [1450, 214], [1600, 292]
  ], 392, '#6f9f7f', '#2f5f4d', 0.96);

  drawMountainRange(ctx, [
    [0, 372], [84, 292], [206, 364], [350, 282], [510, 382],
    [690, 304], [862, 390], [1030, 286], [1198, 370], [1388, 282], [1600, 368]
  ], 436, '#2d644f', '#153b34', 0.96);

  for (let index = 0; index < 74; index += 1) {
    const x = (index * 43) % (WORLD_WIDTH + 70);
    const height = 34 + ((index * 17) % 50);
    const y = 338 + ((index * 11) % 26);
    ctx.fillStyle = index % 3 ? '#1f4d3c' : '#143b31';
    ctx.beginPath();
    ctx.moveTo(x, y - height);
    ctx.lineTo(x - 19, y + 18);
    ctx.lineTo(x + 19, y + 18);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - 3, y + 6, 6, 34);
  }

  const valley = ctx.createLinearGradient(0, 356, 0, WORLD_HEIGHT + 180);
  valley.addColorStop(0, '#477857');
  valley.addColorStop(0.48, '#1f4b3c');
  valley.addColorStop(1, '#0f2f2b');
  ctx.fillStyle = valley;
  ctx.beginPath();
  ctx.moveTo(-120, 356);
  ctx.lineTo(210, 350);
  ctx.quadraticCurveTo(430, 470, 772, 538);
  ctx.quadraticCurveTo(1060, 500, 1288, 510);
  ctx.lineTo(WORLD_WIDTH + 120, 534);
  ctx.lineTo(WORLD_WIDTH + 120, WORLD_HEIGHT + 220);
  ctx.lineTo(-120, WORLD_HEIGHT + 220);
  ctx.closePath();
  ctx.fill();

  const highCliff = ctx.createLinearGradient(0, 292, 410, WORLD_HEIGHT + 120);
  highCliff.addColorStop(0, '#a3b85a');
  highCliff.addColorStop(0.3, '#526c39');
  highCliff.addColorStop(1, '#162f2a');
  ctx.fillStyle = highCliff;
  ctx.beginPath();
  ctx.moveTo(-120, 318);
  ctx.lineTo(126, 326);
  ctx.lineTo(286, 362);
  ctx.lineTo(458, WORLD_HEIGHT + 200);
  ctx.lineTo(-120, WORLD_HEIGHT + 200);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  for (let index = 0; index < 8; index += 1) {
    ctx.fillRect(24 + index * 34, 366 + index * 17, 110 - index * 6, 4);
  }

  const lowCliff = ctx.createLinearGradient(1230, 486, WORLD_WIDTH, WORLD_HEIGHT + 180);
  lowCliff.addColorStop(0, '#8aa45a');
  lowCliff.addColorStop(0.4, '#3c5a3e');
  lowCliff.addColorStop(1, '#132b27');
  ctx.fillStyle = lowCliff;
  ctx.beginPath();
  ctx.moveTo(WORLD_WIDTH + 120, 532);
  ctx.lineTo(1260, 508);
  ctx.lineTo(1120, WORLD_HEIGHT + 200);
  ctx.lineTo(WORLD_WIDTH + 120, WORLD_HEIGHT + 200);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  for (let index = 0; index < 6; index += 1) {
    ctx.fillRect(1294 + index * 27, 544 + index * 10, 112 - index * 8, 4);
  }

  const river = ctx.createLinearGradient(705, 420, 890, WORLD_HEIGHT + 180);
  river.addColorStop(0, 'rgba(125,211,252,0.24)');
  river.addColorStop(1, 'rgba(14,116,144,0.56)');
  ctx.fillStyle = river;
  ctx.beginPath();
  ctx.moveTo(742, 424);
  ctx.quadraticCurveTo(826, 498, 704, WORLD_HEIGHT + 180);
  ctx.lineTo(1002, WORLD_HEIGHT + 180);
  ctx.quadraticCurveTo(866, 498, 872, 424);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#1e293b';
  ctx.globalAlpha = 0.18;
  for (let index = 0; index < 24; index += 1) {
    ctx.fillRect(index * 78 - 24, 446 + (index % 5) * 17, 44, 4);
  }
  ctx.globalAlpha = 1;

  const bridge = ctx.createLinearGradient(0, 362, 0, 488);
  bridge.addColorStop(0, '#9a6530');
  bridge.addColorStop(1, '#4f2f19');
  ctx.strokeStyle = bridge;
  ctx.lineWidth = 17;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(260, 362);
  ctx.quadraticCurveTo(800, 440, 1330, 514);
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(120,53,15,0.72)';
  ctx.beginPath();
  ctx.moveTo(258, 340);
  ctx.quadraticCurveTo(800, 396, 1338, 490);
  ctx.moveTo(256, 384);
  ctx.quadraticCurveTo(800, 486, 1338, 538);
  ctx.stroke();

  ctx.fillStyle = '#34220f';
  for (let index = 0; index < 15; index += 1) {
    const t = index / 14;
    const x = 286 + t * 1010;
    const y = (1 - t) * (1 - t) * 362 + 2 * (1 - t) * t * 440 + t * t * 514;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.12);
    ctx.fillRect(-4, -30, 8, 62);
    ctx.restore();
  }
};

const drawWindGusts = (ctx, wind = 0, time) => {
  const direction = wind >= 0 ? 1 : -1;
  const strength = Math.min(1, Math.abs(wind) / 1.25);
  ctx.save();
  ctx.strokeStyle = `rgba(248,250,252,${0.18 + strength * 0.24})`;
  ctx.lineWidth = 2 + strength * 2;
  ctx.lineCap = 'round';
  for (let index = 0; index < 18; index += 1) {
    const drift = (time * (0.06 + strength * 0.05) * direction + index * 137) % (WORLD_WIDTH + 260);
    const x = direction > 0 ? drift - 130 : WORLD_WIDTH + 130 - drift;
    const y = 90 + ((index * 41) % 360);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + direction * (36 + strength * 42), y - 10, x + direction * (92 + strength * 58), y + 2);
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(250,204,21,${0.18 + strength * 0.16})`;
  for (let index = 0; index < 12; index += 1) {
    const drift = (time * 0.08 * direction + index * 211) % (WORLD_WIDTH + 180);
    const x = direction > 0 ? drift - 90 : WORLD_WIDTH + 90 - drift;
    const y = 330 + ((index * 29) % 180);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(direction * 0.8 + Math.sin(time / 300 + index) * 0.5);
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
};

const drawObstacles = (ctx, obstacles = DEFAULT_OBSTACLES) => {
  ctx.save();
  obstacles.forEach((obstacle) => {
    const x = obstacle.x;
    const y = obstacle.y;
    const width = obstacle.width;
    const height = obstacle.height;
    const rock = ctx.createLinearGradient(x, y, x + width, y + height);
    rock.addColorStop(0, '#94a3b8');
    rock.addColorStop(0.42, '#475569');
    rock.addColorStop(1, '#1e293b');
    ctx.fillStyle = rock;
    ctx.beginPath();
    ctx.moveTo(x + width * 0.5, y - 28);
    ctx.lineTo(x + width + 18, y + height * 0.28);
    ctx.lineTo(x + width * 0.82, y + height + 10);
    ctx.lineTo(x + width * 0.18, y + height + 8);
    ctx.lineTo(x - 16, y + height * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = 'rgba(15,23,42,0.18)';
    ctx.beginPath();
    ctx.ellipse(x + width * 0.5, y + height + 14, width * 0.75, 16, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
};

const drawEnvironmentalHazards = (ctx, time, wind = 0) => {
  const direction = wind >= 0 ? 1 : -1;
  const windStrength = clamp(Math.abs(wind) / 1.25, 0.18, 1);

  ctx.save();
  WIND_BURST_ZONES.forEach((zone, index) => {
    const phase = (time * 0.00042 * zone.speed + index * 0.27) % 1;
    const wobble = Math.sin(time / 520 + index * 1.4) * zone.drift;
    const x = zone.x + wobble * direction;
    const y = zone.y + Math.cos(time / 680 + index) * 10;
    const radius = zone.radius * (0.68 + phase * 0.44);
    ctx.globalAlpha = (1 - phase) * (0.22 + windStrength * 0.22);
    ctx.strokeStyle = wind >= 0 ? '#bae6fd' : '#d8b4fe';
    ctx.lineWidth = 4 + windStrength * 2;
    ctx.setLineDash([20, 18]);
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 1.18, radius * 0.5, direction * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.18 + windStrength * 0.12;
    ctx.strokeStyle = wind >= 0 ? '#f8fafc' : '#f5d0fe';
    ctx.lineWidth = 2;
    for (let arc = 0; arc < 3; arc += 1) {
      const arcRadius = radius * (0.42 + arc * 0.18);
      ctx.beginPath();
      ctx.arc(x, y, arcRadius, phase * Math.PI * 2 + arc, phase * Math.PI * 2 + arc + Math.PI * 0.78);
      ctx.stroke();
    }
  });

  ctx.globalAlpha = 1;
  FALLING_ROCKS.forEach((rock, index) => {
    const phase = (time * 0.00018 + rock.delay) % 1;
    const x = rock.x + Math.sin(time / 340 + index) * 16;
    const y = 82 + phase * rock.span;
    if (y > 452) return;
    ctx.globalAlpha = phase < 0.08 ? phase / 0.08 : 1 - clamp((phase - 0.78) / 0.22, 0, 1);
    ctx.strokeStyle = 'rgba(71,85,105,0.34)';
    ctx.lineWidth = Math.max(2, rock.size * 0.35);
    ctx.beginPath();
    ctx.moveTo(x - direction * 22, y - 38);
    ctx.lineTo(x, y);
    ctx.stroke();
    const gradient = ctx.createLinearGradient(x - rock.size, y - rock.size, x + rock.size, y + rock.size);
    gradient.addColorStop(0, '#cbd5e1');
    gradient.addColorStop(0.45, '#64748b');
    gradient.addColorStop(1, '#1e293b');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x, y - rock.size);
    ctx.lineTo(x + rock.size * 0.9, y - rock.size * 0.2);
    ctx.lineTo(x + rock.size * 0.55, y + rock.size * 0.9);
    ctx.lineTo(x - rock.size * 0.78, y + rock.size * 0.64);
    ctx.lineTo(x - rock.size * 0.92, y - rock.size * 0.34);
    ctx.closePath();
    ctx.fill();
  });

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#e0f2fe';
  for (let index = 0; index < 9; index += 1) {
    const x = ((time * 0.018 * direction + index * 244) % (WORLD_WIDTH + 240)) - 120;
    const y = 438 + Math.sin(time / 700 + index) * 18;
    ctx.beginPath();
    ctx.ellipse(direction > 0 ? x : WORLD_WIDTH - x, y, 118, 20, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const drawPlayerEmote = (ctx, player) => {
  if (!player?.emote?.label) return;
  const point = getArcherPoint(player.side);
  const bubbleX = point.x + (player.side === 'left' ? 46 : -168);
  const bubbleY = point.y - 226;
  ctx.save();
  ctx.fillStyle = 'rgba(15,23,42,0.82)';
  drawRoundedRect(ctx, bubbleX, bubbleY, 122, 42, 18);
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 18px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(player.emote.label, bubbleX + 61, bubbleY + 27, 96);
  ctx.textAlign = 'start';
  ctx.restore();
};

const getPlayerHitReaction = (player, shots, shotAnimations, time) => {
  const incoming = shots
    .map(shot => ({ shot, start: shotAnimations?.get(getShotKey(shot)) }))
    .filter(({ shot, start }) => {
      if (!start || !shot?.hit) return false;
      if (shot.targetUserId) return shot.targetUserId === player.userId;
      return shot.userId !== player.userId && shot.side !== player.side;
    })
    .filter(({ shot, start }) => time - start < getShotDuration(shot) + 1300)
    .sort((a, b) => b.start - a.start)[0];

  if (!incoming) return null;
  const duration = getShotDuration(incoming.shot);
  const elapsed = time - incoming.start;
  const impactStart = duration * 0.84;
  if (elapsed < impactStart) return null;

  const impactElapsed = elapsed - impactStart;
  const zone = incoming.shot.hitZone || (incoming.shot.headshot ? 'head' : 'body');
  const impactForce = clamp((incoming.shot.damage || 0) / 150 + (incoming.shot.impactVelocity || 0) / 95, 0.35, 1.45);
  const fallIn = easeOutCubic(clamp(impactElapsed / (zone === 'leg' ? 220 : 280), 0, 1));
  const recover = easeOutCubic(clamp((impactElapsed - (zone === 'leg' ? 980 : 760)) / 660, 0, 1));
  const heavyFall = zone === 'head' || zone === 'leg' || (incoming.shot.damage || 0) >= 92 || incoming.shot.fallType === 'heavy-impact';
  const fall = heavyFall ? Math.max(0, fallIn - recover) : 0;
  const flinch = Math.max(0, 1 - impactElapsed / (heavyFall ? 500 : 280)) * (heavyFall ? 1 : 0.48);
  const knockback = Math.max(0, fallIn - easeOutCubic(clamp((impactElapsed - 520) / 760, 0, 1)))
    * clamp((incoming.shot.knockback || 24) / 30, 0.25, 2.5);

  return {
    headshot: Boolean(incoming.shot.headshot),
    zone,
    fall,
    flinch,
    knockback,
    impactForce,
    fallType: incoming.shot.fallType || (zone === 'leg' ? 'leg-trip' : zone === 'head' ? 'head-drop' : 'stagger')
  };
};

const drawLegacyArcher = (ctx, player, isCurrentTurn, time, shotProgress = 1, hitReaction = null, chargeState = null, outcome = '', outcomeProgress = 1) => {
  const point = getArcherPoint(player.side);
  const direction = player.side === 'left' ? 1 : -1;
  const tier = BOW_TIERS[Math.min(BOW_TIERS.length - 1, player.bowLevel || 0)];
  const chargeRatio = chargeState?.active ? clamp((chargeState.power || 0) / 100, 0.12, 1) : 0;
  const chargePulse = chargeState?.active ? 0.82 + Math.sin(time / 48) * 0.18 : 0;
  const victoryPose = outcome === 'winner' ? easeOutCubic(clamp(outcomeProgress / 0.34, 0, 1)) : 0;
  const defeatPose = outcome === 'defeat' ? easeOutCubic(clamp(outcomeProgress / 0.46, 0, 1)) : 0;
  const glow = isCurrentTurn
    ? 0.66 + Math.sin(time / 150) * 0.18 + chargeRatio * 0.3 + chargePulse * 0.08
    : outcome === 'winner'
      ? 0.72 + Math.sin(time / 210) * 0.16
      : 0.2;
  const releasePulse = shotProgress < 0.42 ? 1 - (shotProgress / 0.42) : 0;
  const idleBob = Math.sin(time / 260 + (player.side === 'left' ? 0 : 1.1)) * 2.4;
  const fall = hitReaction?.fall || 0;
  const flinch = hitReaction?.flinch || 0;
  const drawPull = releasePulse > 0
    ? 2 + releasePulse * 8
    : chargeState?.active
      ? 22 + chargeRatio * 30 + Math.sin(time / 58) * 2
      : isCurrentTurn
      ? 24 + Math.sin(time / 120) * 3
      : 9 + Math.sin(time / 360) * 2;
  const recoil = releasePulse * 0.12;

  ctx.save();
  ctx.translate(
    point.x - direction * flinch * 28,
    point.y + idleBob + fall * 38 + defeatPose * 28 - victoryPose * 10
  );
  ctx.rotate(direction * (fall * 1.22 + defeatPose * 0.28));
  ctx.scale(direction, 1);

  const aura = ctx.createRadialGradient(0, -72, 8, 0, -72, 104);
  aura.addColorStop(0, `${outcome === 'winner' ? '#fde68a' : tier.color}99`);
  aura.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = glow;
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, -76, 110, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(15,23,42,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 38, 58, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  if (chargeState?.active) {
    ctx.save();
    ctx.globalAlpha = 0.24 + chargeRatio * 0.32;
    ctx.strokeStyle = tier.color;
    ctx.lineWidth = 2 + chargeRatio * 2;
    for (let ring = 0; ring < 3; ring += 1) {
      const radius = 58 + ring * 22 + Math.sin(time / 90 + ring) * 4;
      ctx.beginPath();
      ctx.arc(0, -78, radius, -0.7 + ring * 0.26, 1.22 + chargeRatio * 1.4 + ring * 0.2);
      ctx.stroke();
    }
    ctx.fillStyle = '#fef3c7';
    for (let spark = 0; spark < 7; spark += 1) {
      const angle = time / 180 + spark * 1.7;
      const distance = 72 + spark * 5;
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * distance, -78 + Math.sin(angle) * 44, 2 + chargeRatio * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-13, -20);
  ctx.lineTo(-32, 36);
  ctx.moveTo(16, -20);
  ctx.lineTo(34, 36);
  ctx.stroke();

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-32, 36);
  ctx.lineTo(-44, 52);
  ctx.moveTo(34, 36);
  ctx.lineTo(50, 48);
  ctx.stroke();

  ctx.fillStyle = player.side === 'left' ? '#2563eb' : '#b91c1c';
  ctx.beginPath();
  ctx.moveTo(-24, -105);
  ctx.quadraticCurveTo(-62, -55, -35, 12);
  ctx.lineTo(28, 6);
  ctx.quadraticCurveTo(38, -56, -24, -105);
  ctx.fill();

  const armor = ctx.createLinearGradient(-25, -92, 30, -8);
  armor.addColorStop(0, '#f8fafc');
  armor.addColorStop(0.52, '#64748b');
  armor.addColorStop(1, '#0f172a');
  ctx.fillStyle = armor;
  ctx.beginPath();
  ctx.moveTo(-26, -91);
  ctx.lineTo(24, -91);
  ctx.lineTo(36, -28);
  ctx.lineTo(0, -2);
  ctx.lineTo(-38, -28);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#f2b482';
  ctx.beginPath();
  ctx.arc(3, -126, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3f1f12';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#2b160d';
  ctx.beginPath();
  ctx.arc(-5, -140, 24, Math.PI * 0.96, Math.PI * 2.12);
  ctx.lineTo(28, -127);
  ctx.quadraticCurveTo(6, -154, -21, -130);
  ctx.fill();

  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.arc(11, -128, 3.2, 0, Math.PI * 2);
  ctx.arc(25, -127, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#422006';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(6, -136);
  ctx.lineTo(16, -138);
  ctx.moveTo(21, -137);
  ctx.lineTo(30, -134);
  ctx.stroke();

  ctx.strokeStyle = '#f2b482';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  const shoulderY = -74;
  const bowX = 78 - releasePulse * 8 + chargeRatio * 6;
  const bowY = -84 - releasePulse * 6 - victoryPose * 38 - chargeRatio * 5;
  const notchX = 42 - drawPull;
  const notchY = bowY + Math.sin(time / 150) * 1.8;
  ctx.beginPath();
  ctx.moveTo(12, shoulderY);
  ctx.lineTo(notchX, notchY);
  ctx.moveTo(18, shoulderY - 4);
  ctx.lineTo(bowX - 10, bowY + 22);
  ctx.stroke();

  ctx.save();
  ctx.translate(bowX, bowY);
  ctx.rotate(recoil);
  ctx.strokeStyle = tier.color;
  ctx.shadowColor = tier.color;
  ctx.shadowBlur = 12 + (player.bowLevel || 0) * 3;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(0, 0, 58 + (player.bowLevel || 0) * 2, -1.24, 1.24);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, -55);
  ctx.lineTo(notchX - bowX, notchY - bowY);
  ctx.lineTo(20, 55);
  ctx.stroke();

  if (chargeState?.active) {
    const stringGlow = ctx.createRadialGradient(notchX - bowX, notchY - bowY, 2, notchX - bowX, notchY - bowY, 48 + chargeRatio * 52);
    stringGlow.addColorStop(0, `${tier.color}cc`);
    stringGlow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 0.48 + chargeRatio * 0.32;
    ctx.fillStyle = stringGlow;
    ctx.beginPath();
    ctx.arc(notchX - bowX, notchY - bowY, 48 + chargeRatio * 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  if (isCurrentTurn && releasePulse < 0.25) {
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(notchX, notchY);
    ctx.lineTo(bowX + 72, bowY);
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(bowX + 82, bowY);
    ctx.lineTo(bowX + 64, bowY - 8);
    ctx.lineTo(bowX + 68, bowY);
    ctx.lineTo(bowX + 64, bowY + 8);
    ctx.closePath();
    ctx.fill();
  }

  if (releasePulse > 0) {
    ctx.fillStyle = `rgba(250,204,21,${0.75 * releasePulse})`;
    ctx.beginPath();
    ctx.arc(bowX + 70, bowY, 10 + releasePulse * 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${releasePulse})`;
    ctx.lineWidth = 3;
    for (let index = 0; index < 5; index += 1) {
      const angle = -0.7 + index * 0.35;
      ctx.beginPath();
      ctx.moveTo(bowX + 65, bowY);
      ctx.lineTo(bowX + 96 + Math.cos(angle) * 22, bowY + Math.sin(angle) * 24);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-17, -110);
  ctx.lineTo(-36, -128);
  ctx.moveTo(-13, -108);
  ctx.lineTo(-30, -93);
  ctx.stroke();

  if (outcome === 'winner') {
    ctx.save();
    ctx.globalAlpha = 0.74 + Math.sin(time / 170) * 0.12;
    ctx.fillStyle = '#fde68a';
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-28, -184);
    ctx.lineTo(-13, -166);
    ctx.lineTo(0, -190);
    ctx.lineTo(15, -166);
    ctx.lineTo(31, -184);
    ctx.lineTo(25, -154);
    ctx.lineTo(-25, -154);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(253,230,138,0.72)';
    ctx.lineWidth = 3;
    for (let ray = 0; ray < 8; ray += 1) {
      const angle = ray * Math.PI * 0.25 + time / 620;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 52, -114 + Math.sin(angle) * 52);
      ctx.lineTo(Math.cos(angle) * 78, -114 + Math.sin(angle) * 78);
      ctx.stroke();
    }
    ctx.restore();
  } else if (outcome === 'defeat') {
    ctx.save();
    ctx.globalAlpha = 0.34 + Math.sin(time / 190) * 0.08;
    ctx.fillStyle = 'rgba(15,23,42,0.48)';
    ctx.beginPath();
    ctx.ellipse(8, 58, 72, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,0.46)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-36, -150);
    ctx.quadraticCurveTo(0, -168, 36, -150);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
};

const drawKnifeShape = (ctx, length = 74, width = 14, color = '#f8fafc') => {
  const metal = ctx.createLinearGradient(-length * 0.45, -width, length * 0.45, width);
  metal.addColorStop(0, '#94a3b8');
  metal.addColorStop(0.42, color);
  metal.addColorStop(1, '#475569');
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.moveTo(length * 0.48, 0);
  ctx.lineTo(-length * 0.2, -width * 0.72);
  ctx.lineTo(-length * 0.46, 0);
  ctx.lineTo(-length * 0.2, width * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,23,42,0.68)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#7c2d12';
  drawRoundedRect(ctx, -length * 0.58, -width * 0.48, length * 0.28, width * 0.96, width * 0.34);
  ctx.fill();
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(-length * 0.42, -width * 0.64, 5, width * 1.28);
};

const getFighterImage = (assets, player, animation) => {
  const sideAssets = assets?.fighters?.[player.side] || assets?.fighters?.left || {};
  return sideAssets[animation] || sideAssets.idle || null;
};

const drawArcher = (ctx, player, isCurrentTurn, time, shotProgress = 1, hitReaction = null, chargeState = null, outcome = '', outcomeProgress = 1, assets = null) => {
  const point = getArcherPoint(player.side);
  const direction = player.side === 'left' ? 1 : -1;
  const tier = BOW_TIERS[Math.min(BOW_TIERS.length - 1, player.bowLevel || 0)];
  const chargeRatio = chargeState?.active ? clamp((chargeState.power || 0) / 100, 0.12, 1) : 0;
  const attackPulse = shotProgress < 0.55 ? 1 - shotProgress / 0.55 : 0;
  const releaseFlash = shotProgress < 0.24 ? 1 - shotProgress / 0.24 : 0;
  const victoryPose = outcome === 'winner' ? easeOutCubic(clamp(outcomeProgress / 0.34, 0, 1)) : 0;
  const defeatPose = outcome === 'defeat' ? easeOutCubic(clamp(outcomeProgress / 0.46, 0, 1)) : 0;
  const idleBob = Math.sin(time / 260 + (player.side === 'left' ? 0 : 1.1)) * 2.4;
  const fall = hitReaction?.fall || 0;
  const flinch = hitReaction?.flinch || 0;
  const knockback = hitReaction?.knockback || 0;
  const legTrip = hitReaction?.fallType === 'leg-trip';
  const hitZone = hitReaction?.zone || '';
  const glow = isCurrentTurn
    ? 0.58 + Math.sin(time / 150) * 0.16 + chargeRatio * 0.28
    : outcome === 'winner'
      ? 0.7 + Math.sin(time / 210) * 0.16
      : 0.16;
  const animation = outcome === 'defeat' || fall > 0.74
    ? 'dead'
    : hitReaction
      ? 'hurt'
      : attackPulse > 0.04 || chargeState?.active
        ? 'attack'
        : 'idle';
  const image = getFighterImage(assets, player, animation);
  const frameCount = getSpriteFrameCount(image);
  const frameSpeed = animation === 'attack' ? 68 : animation === 'hurt' ? 96 : 130;
  const frame = animation === 'attack'
    ? Math.min(frameCount - 1, Math.floor((1 - attackPulse) * frameCount))
    : Math.floor(time / frameSpeed);

  ctx.save();
  ctx.translate(
    point.x - direction * flinch * 24 - direction * knockback * 18,
    point.y + idleBob + fall * (legTrip ? 52 : 38) + defeatPose * 28 - victoryPose * 12
  );
  ctx.rotate(direction * (fall * (legTrip ? 1.48 : 1.18) + defeatPose * 0.26));
  ctx.scale(direction, 1);

  const aura = ctx.createRadialGradient(0, -76, 8, 0, -76, 112);
  aura.addColorStop(0, `${outcome === 'winner' ? '#fde68a' : tier.color}9a`);
  aura.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = glow;
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, -76, 112, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(15,23,42,0.34)';
  ctx.beginPath();
  ctx.ellipse(0, 36, 62 + fall * 16, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  if (chargeState?.active) {
    ctx.save();
    ctx.globalAlpha = 0.25 + chargeRatio * 0.36;
    ctx.strokeStyle = tier.color;
    ctx.lineWidth = 3;
    for (let ring = 0; ring < 3; ring += 1) {
      const radius = 42 + ring * 20 + Math.sin(time / 90 + ring) * 4;
      ctx.beginPath();
      ctx.arc(28, -90, radius, -0.75, 1.55 + chargeRatio * 1.1);
      ctx.stroke();
    }
    ctx.fillStyle = '#fef3c7';
    for (let spark = 0; spark < 6; spark += 1) {
      const angle = time / 170 + spark * 1.64;
      ctx.beginPath();
      ctx.arc(26 + Math.cos(angle) * (48 + spark * 5), -90 + Math.sin(angle) * 36, 2 + chargeRatio * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (image) {
    ctx.save();
    ctx.translate(attackPulse * -8 + releaseFlash * -5, 0);
    drawSpriteFrame(ctx, image, frame, -146, -268, 292, 292);
    ctx.restore();
  } else {
    const armor = ctx.createLinearGradient(-30, -118, 42, 18);
    armor.addColorStop(0, player.side === 'left' ? '#38bdf8' : '#fb7185');
    armor.addColorStop(0.48, '#1f2937');
    armor.addColorStop(1, '#020617');
    ctx.fillStyle = armor;
    drawRoundedRect(ctx, -30, -106, 62, 92, 20);
    ctx.fill();
    ctx.fillStyle = '#f2b482';
    ctx.beginPath();
    ctx.arc(5, -132, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(13, -132, 3, 0, Math.PI * 2);
    ctx.arc(27, -131, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f2b482';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(20, -82);
    ctx.lineTo(72 - attackPulse * 18, -108 - attackPulse * 18);
    ctx.moveTo(-10, -26);
    ctx.lineTo(-32, 32);
    ctx.moveTo(18, -24);
    ctx.lineTo(36, 32);
    ctx.stroke();
  }

  const handX = 82 - attackPulse * 18 + chargeRatio * 8;
  const handY = -116 - attackPulse * 22 - chargeRatio * 6;
  ctx.save();
  ctx.translate(handX, handY);
  ctx.rotate(-0.16 - attackPulse * 0.9 + Math.sin(time / 120) * 0.03);
  ctx.shadowColor = tier.color;
  ctx.shadowBlur = 10 + chargeRatio * 18;
  drawKnifeShape(ctx, 62, 12, tier.color);
  ctx.restore();

  for (let slot = 0; slot < 3; slot += 1) {
    ctx.save();
    ctx.translate(-44 + slot * 24, -18 + slot * 2);
    ctx.rotate(-0.58);
    ctx.globalAlpha = 0.8;
    drawKnifeShape(ctx, 34, 7, '#cbd5e1');
    ctx.restore();
  }

  if (releaseFlash > 0) {
    ctx.save();
    ctx.globalAlpha = releaseFlash;
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(72, -102, 12 + releaseFlash * 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff7ed';
    ctx.lineWidth = 3;
    for (let ray = 0; ray < 6; ray += 1) {
      const angle = -0.95 + ray * 0.28;
      ctx.beginPath();
      ctx.moveTo(62, -102);
      ctx.lineTo(92 + Math.cos(angle) * 28, -102 + Math.sin(angle) * 24);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (outcome === 'winner') {
    ctx.save();
    ctx.globalAlpha = 0.72 + Math.sin(time / 170) * 0.12;
    ctx.fillStyle = '#fde68a';
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-28, -188);
    ctx.lineTo(-13, -170);
    ctx.lineTo(0, -194);
    ctx.lineTo(15, -170);
    ctx.lineTo(31, -188);
    ctx.lineTo(25, -158);
    ctx.lineTo(-25, -158);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (hitReaction && hitZone) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, flinch * 0.72);
    ctx.fillStyle = 'rgba(220,38,38,0.55)';
    const bloodY = hitZone === 'head' ? -130 : hitZone === 'leg' ? -12 : -72;
    ctx.beginPath();
    ctx.arc(20, bloodY, hitZone === 'head' ? 24 : 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
};

const drawLegacyTrajectory = (ctx, shot, time, animationStart) => {
  if (!shot?.trajectory?.length) return;
  const rawProgress = getShotProgress(animationStart, time, shot);
  const releaseProgress = clamp((rawProgress - KNIFE_RELEASE_PROGRESS) / (1 - KNIFE_RELEASE_PROGRESS), 0, 1);
  const progress = easeOutCubic(releaseProgress);
  const points = shot.trajectory;
  const launchPoint = points[0];
  const tier = BOW_TIERS[Math.min(BOW_TIERS.length - 1, shot.bowLevel || 0)];
  const effectColor = shot.headshot ? '#ef4444' : tier.color;

  if (rawProgress < KNIFE_RELEASE_PROGRESS) {
    const warmup = rawProgress / KNIFE_RELEASE_PROGRESS;
    ctx.save();
    ctx.globalAlpha = 0.18 + warmup * 0.42;
    ctx.fillStyle = effectColor;
    ctx.beginPath();
    ctx.arc(launchPoint.x, launchPoint.y, 8 + warmup * 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const lastPointIndex = points.length - 1;
  const floatIndex = lastPointIndex * progress;
  const currentIndex = Math.min(lastPointIndex, Math.max(1, Math.floor(floatIndex)));
  const currentMix = floatIndex - Math.floor(floatIndex);
  const prevPoint = points[Math.max(0, currentIndex - 1)];
  const basePoint = points[currentIndex] || points[lastPointIndex];
  const nextPoint = points[Math.min(lastPointIndex, currentIndex + 1)] || basePoint;
  const currentPoint = {
    x: basePoint.x + (nextPoint.x - basePoint.x) * currentMix,
    y: basePoint.y + (nextPoint.y - basePoint.y) * currentMix
  };

  ctx.save();
  ctx.strokeStyle = shot.headshot ? 'rgba(248,113,113,0.28)' : shot.hit ? `${tier.color}66` : 'rgba(186,230,253,0.18)';
  ctx.lineWidth = shot.headshot ? 18 : 14;
  ctx.shadowColor = effectColor;
  ctx.shadowBlur = 10 + (shot.bowLevel || 0) * 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.slice(Math.max(0, currentIndex - 10), currentIndex + 1).forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(currentPoint.x, currentPoint.y);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = shot.headshot ? 'rgba(248,113,113,0.95)' : shot.hit ? `${tier.color}ee` : 'rgba(248,250,252,0.74)';
  ctx.lineWidth = shot.headshot ? 5 : shot.hit ? 4 : 3;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  points.slice(0, currentIndex + 1).forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (currentIndex < lastPointIndex) ctx.lineTo(currentPoint.x, currentPoint.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const arrowAngle = Math.atan2(currentPoint.y - prevPoint.y, currentPoint.x - prevPoint.x);
  ctx.save();
  ctx.translate(currentPoint.x, currentPoint.y);
  ctx.rotate(arrowAngle);
  ctx.shadowColor = effectColor;
  ctx.shadowBlur = 14 + (shot.bowLevel || 0) * 5;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.lineTo(18, 0);
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.moveTo(25, 0);
  ctx.lineTo(11, -7);
  ctx.lineTo(15, 0);
  ctx.lineTo(11, 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shot.bowLevel >= 3 ? '#fed7aa' : '#f97316';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-21, 0);
  ctx.lineTo(-32, -7);
  ctx.moveTo(-21, 0);
  ctx.lineTo(-32, 7);
  ctx.stroke();
  ctx.restore();

  if (rawProgress < 1) {
    ctx.restore();
    return;
  }

  const impact = shot.impact || shot.trajectory[shot.trajectory.length - 1];
  ctx.strokeStyle = shot.headshot ? '#ef4444' : shot.hit ? tier.color : shot.hitZone === 'cover' ? '#94a3b8' : '#cbd5e1';
  ctx.fillStyle = shot.headshot ? 'rgba(220,38,38,0.24)' : shot.hit ? `${tier.color}38` : shot.hitZone === 'cover' ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.18)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(impact.x, impact.y, shot.headshot ? 48 : shot.hit ? 32 : 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (shot.hit) {
    const pulse = 0.72 + Math.sin(time / 90) * 0.16;
    const burstSize = shot.headshot ? 58 : 38;
    const blood = ctx.createRadialGradient(impact.x, impact.y, 4, impact.x, impact.y, burstSize);
    blood.addColorStop(0, `rgba(127,29,29,${0.78 * pulse})`);
    blood.addColorStop(0.45, `rgba(220,38,38,${0.42 * pulse})`);
    blood.addColorStop(1, 'rgba(220,38,38,0)');
    ctx.fillStyle = blood;
    ctx.beginPath();
    ctx.arc(impact.x, impact.y, burstSize, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = shot.headshot ? 'rgba(127,29,29,0.88)' : 'rgba(185,28,28,0.72)';
    for (let index = 0; index < (shot.headshot ? 18 : 10); index += 1) {
      const angle = (index * 2.37) + (impact.x + impact.y) * 0.01;
      const distance = 14 + ((index * 11) % (shot.headshot ? 52 : 32));
      const size = 3 + (index % 4);
      ctx.beginPath();
      ctx.arc(
        impact.x + Math.cos(angle) * distance,
        impact.y + Math.sin(angle) * distance * 0.72,
        size,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    if (shot.headshot) {
      ctx.fillStyle = 'rgba(127,29,29,0.86)';
      drawRoundedRect(ctx, impact.x - 70, impact.y - 76, 140, 38, 15);
      ctx.fill();
      ctx.fillStyle = '#fee2e2';
      ctx.font = '900 18px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('HEADSHOT', impact.x, impact.y - 51);
      ctx.textAlign = 'start';
    }
  }

  if (shot.hitZone === 'cover') {
    ctx.fillStyle = 'rgba(15,23,42,0.8)';
    drawRoundedRect(ctx, impact.x - 54, impact.y - 72, 108, 34, 14);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '900 16px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BLOCKED', impact.x, impact.y - 50);
    ctx.textAlign = 'start';
  }

  if (shot.damage > 0) {
    ctx.fillStyle = 'rgba(2,6,23,0.78)';
    drawRoundedRect(ctx, impact.x - 42, impact.y - 124, 84, 34, 14);
    ctx.fill();
    ctx.fillStyle = shot.headshot ? '#fecaca' : '#fef3c7';
    ctx.font = '900 18px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`-${shot.damage}`, impact.x, impact.y - 101);
    ctx.textAlign = 'start';
  }
  ctx.restore();
};

const drawEmbeddedKnife = (ctx, shot, assets, tier, impact, angle) => {
  if (!shot.hit) return;
  ctx.save();
  ctx.translate(impact.x, impact.y);
  ctx.rotate(angle);
  ctx.shadowColor = shot.headshot ? '#ef4444' : tier.color;
  ctx.shadowBlur = shot.headshot ? 18 : 11;
  drawKnifeShape(ctx, 48, 10, tier.color);
  ctx.restore();
};

const drawExplosionFrames = (ctx, shot, assets, time, animationStart, impact) => {
  const frames = assets?.explosions || [];
  if (!frames.length || !shot.hit) return;
  const elapsed = Math.max(0, time - (animationStart || time) - getShotDuration(shot) * 0.84);
  if (elapsed > 520) return;
  const frame = frames[Math.min(frames.length - 1, Math.floor((elapsed / 520) * frames.length))];
  if (!frame) return;
  const size = shot.headshot ? 152 : shot.hitZone === 'leg' ? 104 : 118;
  ctx.save();
  ctx.globalAlpha = 0.74 * (1 - elapsed / 620);
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(frame, impact.x - size / 2, impact.y - size / 2, size, size);
  ctx.restore();
};

const drawDustBurst = (ctx, shot, time, animationStart, impact) => {
  if (!shot.hit && shot.hitZone !== 'cover') return;
  const elapsed = Math.max(0, time - (animationStart || time) - getShotDuration(shot) * 0.84);
  if (elapsed > 760) return;
  const progress = clamp(elapsed / 760, 0, 1);
  const fall = easeOutCubic(progress);
  const heavy = shot.headshot || shot.hitZone === 'leg' || (shot.knockback || 0) > 26;
  const direction = shot.side === 'left' ? 1 : -1;
  ctx.save();
  ctx.globalAlpha = (1 - progress) * (heavy ? 0.72 : 0.44);
  for (let index = 0; index < (heavy ? 18 : 10); index += 1) {
    const seed = index * 2.399 + (shot.damage || 0) * 0.03;
    const distance = (18 + index * 5.7) * fall;
    const lift = Math.sin(seed) * 18 * (1 - progress);
    const x = impact.x - direction * distance * (0.5 + (index % 5) * 0.16);
    const y = impact.y + 34 + Math.cos(seed) * 10 - lift + progress * 22;
    const radius = (heavy ? 9 : 6) * (1 - progress * 0.45) + (index % 3);
    ctx.fillStyle = index % 2 ? 'rgba(245,158,11,0.52)' : 'rgba(217,119,6,0.46)';
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 1.7, radius, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const drawTrajectory = (ctx, shot, time, animationStart, assets = null) => {
  if (!shot?.trajectory?.length) return;
  const rawProgress = getShotProgress(animationStart, time, shot);
  const releaseProgress = clamp((rawProgress - KNIFE_RELEASE_PROGRESS) / (1 - KNIFE_RELEASE_PROGRESS), 0, 1);
  const progress = easeOutCubic(releaseProgress);
  const points = shot.trajectory;
  const launchPoint = points[0];
  const tier = BOW_TIERS[Math.min(BOW_TIERS.length - 1, shot.bowLevel || 0)];
  const effectColor = shot.headshot ? '#ef4444' : tier.color;

  if (rawProgress < KNIFE_RELEASE_PROGRESS) {
    const warmup = rawProgress / KNIFE_RELEASE_PROGRESS;
    ctx.save();
    ctx.globalAlpha = 0.18 + warmup * 0.42;
    ctx.fillStyle = effectColor;
    ctx.beginPath();
    ctx.arc(launchPoint.x, launchPoint.y, 8 + warmup * 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const lastPointIndex = points.length - 1;
  const floatIndex = lastPointIndex * progress;
  const currentIndex = Math.min(lastPointIndex, Math.max(1, Math.floor(floatIndex)));
  const currentMix = floatIndex - Math.floor(floatIndex);
  const prevPoint = points[Math.max(0, currentIndex - 1)];
  const basePoint = points[currentIndex] || points[lastPointIndex];
  const nextPoint = points[Math.min(lastPointIndex, currentIndex + 1)] || basePoint;
  const currentPoint = {
    x: basePoint.x + (nextPoint.x - basePoint.x) * currentMix,
    y: basePoint.y + (nextPoint.y - basePoint.y) * currentMix
  };
  const knifeAngle = Math.atan2(currentPoint.y - prevPoint.y, currentPoint.x - prevPoint.x);

  ctx.save();
  ctx.strokeStyle = shot.headshot ? 'rgba(248,113,113,0.28)' : shot.hit ? `${tier.color}66` : 'rgba(186,230,253,0.18)';
  ctx.lineWidth = shot.headshot ? 18 : 14;
  ctx.shadowColor = effectColor;
  ctx.shadowBlur = 10 + (shot.bowLevel || 0) * 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.slice(Math.max(0, currentIndex - 11), currentIndex + 1).forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(currentPoint.x, currentPoint.y);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = shot.headshot ? 'rgba(248,113,113,0.95)' : shot.hit ? `${tier.color}ee` : 'rgba(248,250,252,0.74)';
  ctx.lineWidth = shot.headshot ? 5 : shot.hit ? 4 : 3;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  points.slice(0, currentIndex + 1).forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (currentIndex < lastPointIndex) ctx.lineTo(currentPoint.x, currentPoint.y);
  ctx.stroke();
  ctx.setLineDash([]);

  if (rawProgress < 1) {
    ctx.save();
    ctx.translate(currentPoint.x, currentPoint.y);
    ctx.rotate(knifeAngle + time / 58);
    ctx.shadowColor = effectColor;
    ctx.shadowBlur = 14 + (shot.bowLevel || 0) * 5;
    drawKnifeShape(ctx, 54, 10, tier.color);
    ctx.restore();
    ctx.restore();
    return;
  }

  const impact = shot.impact || shot.trajectory[shot.trajectory.length - 1];
  const impactAngle = Number.isFinite(shot.impactAngle) ? shot.impactAngle : knifeAngle;
  ctx.strokeStyle = shot.headshot ? '#ef4444' : shot.hit ? tier.color : shot.hitZone === 'cover' ? '#94a3b8' : '#cbd5e1';
  ctx.fillStyle = shot.headshot ? 'rgba(220,38,38,0.24)' : shot.hit ? `${tier.color}38` : shot.hitZone === 'cover' ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.18)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(impact.x, impact.y, shot.headshot ? 48 : shot.hit ? 32 : 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  drawEmbeddedKnife(ctx, shot, assets, tier, impact, impactAngle);
  drawExplosionFrames(ctx, shot, assets, time, animationStart, impact);
  drawDustBurst(ctx, shot, time, animationStart, impact);

  if (shot.hit) {
    const pulse = 0.72 + Math.sin(time / 90) * 0.16;
    const burstSize = shot.headshot ? 62 : shot.hitZone === 'leg' ? 34 : 42;
    const blood = ctx.createRadialGradient(impact.x, impact.y, 4, impact.x, impact.y, burstSize);
    blood.addColorStop(0, `rgba(127,29,29,${0.8 * pulse})`);
    blood.addColorStop(0.45, `rgba(220,38,38,${0.42 * pulse})`);
    blood.addColorStop(1, 'rgba(220,38,38,0)');
    ctx.fillStyle = blood;
    ctx.beginPath();
    ctx.arc(impact.x, impact.y, burstSize, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = shot.headshot ? 'rgba(127,29,29,0.88)' : 'rgba(185,28,28,0.72)';
    for (let index = 0; index < (shot.headshot ? 18 : 10); index += 1) {
      const angle = (index * 2.37) + (impact.x + impact.y) * 0.01;
      const distance = 14 + ((index * 11) % (shot.headshot ? 52 : 32));
      const size = 3 + (index % 4);
      ctx.beginPath();
      ctx.arc(
        impact.x + Math.cos(angle) * distance,
        impact.y + Math.sin(angle) * distance * 0.72,
        size,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    const zoneLabel = shot.headshot ? 'HEAD HIT' : shot.hitZone === 'leg' ? 'LEG HIT' : 'BODY HIT';
    ctx.fillStyle = shot.headshot ? 'rgba(127,29,29,0.86)' : 'rgba(15,23,42,0.78)';
    drawRoundedRect(ctx, impact.x - 66, impact.y - 76, 132, 36, 15);
    ctx.fill();
    ctx.fillStyle = shot.headshot ? '#fee2e2' : '#fef3c7';
    ctx.font = '900 17px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(zoneLabel, impact.x, impact.y - 52);
    ctx.textAlign = 'start';
  }

  if (shot.hitZone === 'cover') {
    ctx.fillStyle = 'rgba(15,23,42,0.8)';
    drawRoundedRect(ctx, impact.x - 54, impact.y - 72, 108, 34, 14);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '900 16px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BLOCKED', impact.x, impact.y - 50);
    ctx.textAlign = 'start';
  }

  if (shot.damage > 0) {
    ctx.fillStyle = 'rgba(2,6,23,0.78)';
    drawRoundedRect(ctx, impact.x - 42, impact.y - 124, 84, 34, 14);
    ctx.fill();
    ctx.fillStyle = shot.headshot ? '#fecaca' : '#fef3c7';
    ctx.font = '900 18px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`-${shot.damage}`, impact.x, impact.y - 101);
    ctx.textAlign = 'start';
  }
  ctx.restore();
};

const drawAimPreview = (ctx, player, aim, wind, timingPower, obstacles = DEFAULT_OBSTACLES) => {
  if (!player || !aim?.active) return;
  const origin = getArcherPoint(player.side);
  const direction = player.side === 'left' ? 1 : -1;
  const radians = aim.angle * (Math.PI / 180);
  const power = timingPower || aim.power;
  const speed = 10 + power * 0.62;
  let x = origin.x;
  let y = origin.y - THROW_ORIGIN_HEIGHT;
  let velocityX = Math.cos(radians) * speed * direction;
  let velocityY = -Math.sin(radians) * speed;
  const chargeRatio = clamp((aim.power || power) / 100, 0.12, 1);

  ctx.save();
  const chargeGlow = ctx.createRadialGradient(origin.x, origin.y - THROW_ORIGIN_HEIGHT, 8, origin.x, origin.y - THROW_ORIGIN_HEIGHT, 128 + chargeRatio * 74);
  chargeGlow.addColorStop(0, `rgba(250,204,21,${0.3 + chargeRatio * 0.24})`);
  chargeGlow.addColorStop(0.46, `rgba(56,189,248,${0.16 + chargeRatio * 0.14})`);
  chargeGlow.addColorStop(1, 'rgba(56,189,248,0)');
  ctx.fillStyle = chargeGlow;
  ctx.beginPath();
  ctx.arc(origin.x, origin.y - THROW_ORIGIN_HEIGHT, 128 + chargeRatio * 74, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = chargeRatio > 0.68 ? 'rgba(253,224,71,0.92)' : 'rgba(255,255,255,0.74)';
  ctx.lineWidth = 3 + chargeRatio * 2;
  ctx.shadowColor = chargeRatio > 0.68 ? '#facc15' : '#bae6fd';
  ctx.shadowBlur = 8 + chargeRatio * 18;
  ctx.setLineDash([8, 12]);
  ctx.beginPath();
  for (let tick = 0; tick < 12; tick += 1) {
    x += velocityX;
    y += velocityY;
    velocityX += wind * 0.032;
    velocityY += PROJECTILE_GRAVITY;
    if (tick === 0) ctx.moveTo(x, y);
    if (tick % 3 === 0) ctx.lineTo(x, y);
    if (obstacles.some(obstacle => x >= obstacle.x && x <= obstacle.x + obstacle.width && y >= obstacle.y && y <= obstacle.y + obstacle.height)) break;
    if (y > 720 || x < -160 || x > 1760) break;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(255,255,255,0.56)';
  ctx.lineWidth = 2;
  for (let ring = 0; ring < 3; ring += 1) {
    ctx.beginPath();
    ctx.arc(origin.x, origin.y - THROW_ORIGIN_HEIGHT, 32 + ring * 24 + chargeRatio * 12, -0.8, Math.PI * 1.12);
    ctx.stroke();
  }

  ctx.fillStyle = '#facc15';
  ctx.font = '800 22px Inter, system-ui, sans-serif';
  ctx.fillText(`${power}%`, origin.x + direction * 52, origin.y - 108);
  ctx.restore();
};

const getRenderablePlayers = (state, userId, previewUser) => (
  state?.players?.length ? state.players : [
    {
      userId: userId || 'preview-you',
      name: previewUser?.name || 'You',
      avatar: previewUser?.avatar || '',
      side: 'left',
      wins: 0,
      hp: MAX_HP,
      maxHp: MAX_HP,
      streak: 0,
      totalDamage: 0,
      bowLevel: 0,
      shots: 0,
      hits: 0,
      connected: true
    },
    {
      userId: 'preview-rival',
      name: 'Rival Fighter',
      avatar: '',
      side: 'right',
      wins: 0,
      hp: MAX_HP,
      maxHp: MAX_HP,
      streak: 0,
      totalDamage: 0,
      bowLevel: 0,
      shots: 0,
      hits: 0,
      connected: true
    }
  ]
);

const getRenderableShots = (state) => {
  const shots = Object.values(state?.roundShots || {});
  if (state?.lastShot && !shots.some(shot => getShotKey(shot) === getShotKey(state.lastShot))) {
    shots.push(state.lastShot);
  }
  return shots;
};

const getPlayersForShotFrame = (players, activeShot, time) => {
  const shot = activeShot?.shot;
  if (!shot?.targetUserId) return players;
  if (!Number.isFinite(Number(shot.targetHpBefore)) || !Number.isFinite(Number(shot.targetHpAfter))) return players;
  const progress = getShotProgress(activeShot.start, time, shot);
  if (progress >= 1) return players;
  const impactProgress = clamp((progress - 0.84) / 0.16, 0, 1);
  return players.map(player => {
    if (player.userId !== shot.targetUserId) return player;
    return {
      ...player,
      hp: Math.round(lerp(Number(shot.targetHpBefore), Number(shot.targetHpAfter), impactProgress))
    };
  });
};

const getCameraForFrame = ({ width, height, shots, shotAnimations, time }) => {
  const fullCamera = getFullCamera(width, height);
  const activeShot = shots
    .map(shot => ({ shot, start: shotAnimations?.get(getShotKey(shot)) }))
    .filter(item => item.start && time - item.start < getShotDuration(item.shot) + CAMERA_RETURN_MS)
    .sort((a, b) => b.start - a.start)[0];

  if (!activeShot) return fullCamera;

  const elapsed = time - activeShot.start;
  const shotDuration = getShotDuration(activeShot.shot);
  const rawProgress = clamp(elapsed / shotDuration, 0, 1);
  const shotProgress = easeOutCubic(clamp((rawProgress - KNIFE_RELEASE_PROGRESS) / (1 - KNIFE_RELEASE_PROGRESS), 0, 1));
  const releaseEase = easeOutCubic(clamp(rawProgress / 0.15, 0, 1));
  const returnEase = easeOutCubic(clamp((elapsed - shotDuration) / CAMERA_RETURN_MS, 0, 1));
  const shooter = getArcherPoint(activeShot.shot.side);
  const direction = activeShot.shot.side === 'left' ? 1 : -1;
  const arrow = getShotPoint(activeShot.shot, shotProgress);
  const impact = activeShot.shot.impact || arrow;
  const followZoom = clamp(Math.min(width / 960, height / 540), fullCamera.zoom * 1.04, 1.04);
  let camera = {
    x: fullCamera.x,
    y: fullCamera.y,
    zoom: fullCamera.zoom,
    shakeX: 0,
    shakeY: 0,
    mode: 'wide'
  };

  if (rawProgress < 0.15) {
    camera = {
      x: lerp(fullCamera.x, shooter.x + direction * 220, releaseEase * 0.45),
      y: lerp(fullCamera.y, shooter.y - 118, releaseEase * 0.45),
      zoom: lerp(fullCamera.zoom, followZoom, releaseEase * 0.5),
      shakeX: Math.sin(time / 24) * 2 * releaseEase,
      shakeY: Math.cos(time / 31) * 1.4 * releaseEase,
      mode: 'release'
    };
  } else if (rawProgress < 0.85) {
    const midpointX = lerp(shooter.x, impact.x, 0.5);
    const midpointY = Math.min(shooter.y, impact.y) - 92;
    camera = {
      x: lerp(arrow.x + direction * 84, midpointX, 0.65),
      y: lerp(arrow.y - 28, midpointY, 0.6),
      zoom: followZoom,
      shakeX: 0,
      shakeY: 0,
      mode: 'arrow'
    };
  } else if (rawProgress < 1) {
    const landEase = easeOutCubic((rawProgress - 0.85) / 0.15);
    camera = {
      x: lerp(lerp(fullCamera.x, impact.x, activeShot.shot.headshot ? 0.38 : 0.28), impact.x, landEase * 0.22),
      y: lerp(lerp(fullCamera.y, impact.y - 46, activeShot.shot.headshot ? 0.34 : 0.24), impact.y - 56, landEase * 0.22),
      zoom: lerp(followZoom, followZoom * (activeShot.shot.headshot ? 1.03 : 1), landEase),
      shakeX: 0,
      shakeY: 0,
      mode: 'impact'
    };
  } else {
    const shake = Math.max(0, 1 - (elapsed - shotDuration) / 280);
    camera = {
      x: lerp(lerp(fullCamera.x, impact.x, activeShot.shot.headshot ? 0.38 : 0.28), fullCamera.x, returnEase),
      y: lerp(lerp(fullCamera.y, impact.y - 56, activeShot.shot.headshot ? 0.34 : 0.24), fullCamera.y, returnEase),
      zoom: lerp(followZoom * (activeShot.shot.headshot ? 1.03 : 1), fullCamera.zoom, returnEase),
      shakeX: Math.sin(time / 18) * 12 * shake,
      shakeY: Math.cos(time / 23) * 9 * shake,
      mode: returnEase >= 1 ? 'wide' : 'recover'
    };
  }

  return normalizeCamera(camera, width, height);
};

const getFinishCamera = ({ width, height, state, players, userId, time, finishStartedAt }) => {
  if (state?.status !== 'finished') return null;
  const fullCamera = getFullCamera(width, height);
  const progress = getFinishProgress(time, finishStartedAt);
  const winner = players.find(player => player.userId === state.winnerId);
  const focusPlayer = winner || players.find(player => player.userId === userId) || players[0];
  if (!focusPlayer) return fullCamera;
  const point = getArcherPoint(focusPlayer.side);
  const direction = focusPlayer.side === 'left' ? 1 : -1;
  const intro = easeOutCubic(clamp(progress / 0.28, 0, 1));
  const zoom = clamp(Math.min(width / 520, height / 330), fullCamera.zoom * 1.9, 1.16);
  return normalizeCamera({
    x: lerp(fullCamera.x, point.x + direction * 74, intro),
    y: lerp(fullCamera.y, point.y - 98, intro),
    zoom: lerp(fullCamera.zoom, zoom, intro),
    shakeX: Math.sin(time / 70) * 2.5 * (1 - progress),
    shakeY: Math.cos(time / 86) * 2 * (1 - progress),
    mode: 'finish'
  }, width, height);
};

const drawScreenHpBar = (ctx, x, y, barWidth, player, align = 'left') => {
  const maxHp = player?.maxHp || MAX_HP;
  const hp = clamp(player?.hp ?? maxHp, 0, maxHp);
  const ratio = maxHp ? hp / maxHp : 1;
  ctx.fillStyle = 'rgba(15,23,42,0.78)';
  drawRoundedRect(ctx, x, y, barWidth, 54, 18);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  drawRoundedRect(ctx, x + 12, y + 30, barWidth - 24, 10, 5);
  ctx.fill();
  const fill = ctx.createLinearGradient(x + 12, y, x + barWidth - 12, y);
  fill.addColorStop(0, ratio > 0.35 ? '#22c55e' : '#ef4444');
  fill.addColorStop(1, ratio > 0.35 ? '#facc15' : '#fb7185');
  ctx.fillStyle = fill;
  drawRoundedRect(ctx, x + 12, y + 30, (barWidth - 24) * ratio, 10, 5);
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 13px Inter, system-ui, sans-serif';
  ctx.textAlign = align;
  ctx.fillText(player?.name || 'Fighter', align === 'right' ? x + barWidth - 12 : x + 12, y + 20, barWidth - 24);
  ctx.fillStyle = '#fecaca';
  ctx.font = '900 12px Inter, system-ui, sans-serif';
  ctx.fillText(`${Math.round(hp)}/${maxHp} HP`, align === 'right' ? x + barWidth - 12 : x + 12, y + 48, barWidth - 24);
  ctx.textAlign = 'start';
};

const drawPowerMeter = (ctx, width, height, aim, timingPower, myTurn) => {
  if (!myTurn) return;
  const meterWidth = Math.min(260, width - 36);
  const x = (width - meterWidth) / 2;
  const y = height - 54;
  const charging = Boolean(aim?.active);
  const chargeRatio = charging ? clamp((aim.power || 0) / 100, 0, 1) : 0;
  ctx.save();
  if (charging) {
    const pulse = 0.12 + Math.sin(performance.now() / 70) * 0.04;
    ctx.fillStyle = `rgba(250,204,21,${pulse})`;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.fillStyle = charging ? 'rgba(15,23,42,0.88)' : 'rgba(15,23,42,0.78)';
  drawRoundedRect(ctx, x, y, meterWidth, 38, 16);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  drawRoundedRect(ctx, x + 14, y + 18, meterWidth - 28, 8, 4);
  ctx.fill();
  const zoneX = x + 14 + (meterWidth - 28) * 0.74;
  ctx.fillStyle = 'rgba(34,197,94,0.7)';
  drawRoundedRect(ctx, zoneX, y + 18, (meterWidth - 28) * 0.18, 8, 4);
  ctx.fill();
  const knobX = x + 14 + (meterWidth - 28) * ((timingPower - 42) / 58);
  ctx.fillStyle = aim?.active ? '#facc15' : '#e2e8f0';
  ctx.beginPath();
  ctx.arc(knobX, y + 22, 9, 0, Math.PI * 2);
  ctx.fill();

  if (charging) {
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(knobX, y + 22, 14 + chargeRatio * 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(250,204,21,0.72)';
    drawRoundedRect(ctx, x + 14, y + 29, (meterWidth - 28) * chargeRatio, 4, 2);
    ctx.fill();
  }

  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(charging ? `THROW ${Math.round(chargeRatio * 100)}% / TIMING ${timingPower}%` : `POWER TIMING ${timingPower}%`, x + meterWidth / 2, y + 13, meterWidth - 20);
  ctx.textAlign = 'start';
  ctx.restore();
};

const drawVictoryCinematic = (ctx, width, height, state, players, userId, time, finishStartedAt) => {
  if (state?.status !== 'finished') return;
  const progress = getFinishProgress(time, finishStartedAt);
  const intro = easeOutCubic(clamp(progress / 0.3, 0, 1));
  const winner = players.find(player => player.userId === state.winnerId);
  const won = state.winnerId === userId;
  const title = won ? 'VICTORY' : 'MATCH ENDED';
  const accent = won ? '#fde68a' : '#cbd5e1';

  ctx.save();
  const vignette = ctx.createLinearGradient(0, 0, 0, height);
  vignette.addColorStop(0, 'rgba(2,6,23,0.28)');
  vignette.addColorStop(0.44, 'rgba(2,6,23,0.04)');
  vignette.addColorStop(1, 'rgba(2,6,23,0.72)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  if (won) {
    for (let index = 0; index < 34; index += 1) {
      const fall = (time * 0.06 + index * 37) % (height + 120);
      const x = (index * 83 + Math.sin(time / 500 + index) * 42) % Math.max(1, width);
      const y = fall - 80;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time / 420 + index);
      ctx.fillStyle = ['#fde68a', '#67e8f9', '#fda4af', '#bbf7d0'][index % 4];
      ctx.globalAlpha = 0.28 + intro * 0.48;
      ctx.fillRect(-4, -8, 8, 16);
      ctx.restore();
    }
  }

  const cardWidth = Math.min(430, width - 30);
  const cardHeight = 136;
  const x = (width - cardWidth) / 2;
  const y = height - cardHeight - 24;
  ctx.globalAlpha = intro;
  ctx.fillStyle = won ? 'rgba(15,23,42,0.86)' : 'rgba(15,23,42,0.82)';
  drawRoundedRect(ctx, x, y, cardWidth, cardHeight, 24);
  ctx.fill();
  ctx.strokeStyle = won ? 'rgba(253,230,138,0.55)' : 'rgba(203,213,225,0.34)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.font = '900 34px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, y + 48, cardWidth - 28);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 18px Inter, system-ui, sans-serif';
  ctx.fillText(winner ? `${winner.name} wins` : 'Match complete', width / 2, y + 78, cardWidth - 28);
  ctx.fillStyle = 'rgba(248,250,252,0.68)';
  ctx.font = '800 13px Inter, system-ui, sans-serif';
  ctx.fillText(getBowDuelFinishMessage(state, won, userId) || 'HP duel complete', width / 2, y + 105, cardWidth - 34);
  ctx.textAlign = 'start';
  ctx.globalAlpha = 1;
  ctx.restore();
};

const drawScreenHud = (ctx, width, height, state, players, activeShot, timingPower, aim, myTurn, userId, finishStartedAt) => {
  ctx.save();
  ctx.fillStyle = 'rgba(15,23,42,0.76)';
  drawRoundedRect(ctx, 14, 14, Math.min(244, width - 28), 68, 19);
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 21px Inter, system-ui, sans-serif';
  ctx.fillText(state?.matchId ? `Turn ${state.turnCount || 0}` : 'Knife Duel', 34, 43, Math.min(196, width - 60));
  ctx.font = '800 15px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#bae6fd';
  ctx.fillText(`Wind ${state?.wind > 0 ? '+' : ''}${state?.wind || 0}`, 34, 67, Math.min(196, width - 60));

  if (players.length) {
    const leftPlayer = players.find(player => player.side === 'left') || players[0];
    const rightPlayer = players.find(player => player.side === 'right') || players[1];
    const hpWidth = Math.min(210, Math.max(132, (width - 44) / 2));
    drawScreenHpBar(ctx, 14, 92, hpWidth, leftPlayer, 'left');
    if (rightPlayer) drawScreenHpBar(ctx, width - hpWidth - 14, 92, hpWidth, rightPlayer, 'right');
  }

  const finishMessage = getBowDuelFinishMessage(state, state?.winnerId === userId, userId);
  if (finishMessage) {
    const bannerWidth = Math.min(430, width - 28);
    const x = (width - bannerWidth) / 2;
    ctx.fillStyle = state?.winnerId === userId ? 'rgba(5,150,105,0.88)' : 'rgba(127,29,29,0.82)';
    drawRoundedRect(ctx, x, 154, bannerWidth, 44, 18);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 16px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(finishMessage, width / 2, 182, bannerWidth - 26);
    ctx.textAlign = 'start';
  } else if (state?.status === 'active' && state?.turnUserId) {
    const turnPlayer = players.find(player => player.userId === state.turnUserId);
    const bannerWidth = Math.min(360, width - 28);
    const x = (width - bannerWidth) / 2;
    const isMine = myTurn;
    ctx.fillStyle = isMine ? 'rgba(8,145,178,0.86)' : 'rgba(15,23,42,0.82)';
    drawRoundedRect(ctx, x, 154, bannerWidth, 44, 18);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 17px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      isMine ? `Your turn now, ${turnPlayer?.name || 'Fighter'}` : `${turnPlayer?.name || 'Opponent'} turn`,
      width / 2,
      182,
      bannerWidth - 26
    );
    ctx.textAlign = 'start';
  }

  const activeShotProgress = activeShot?.shot ? getShotProgress(activeShot.start, performance.now(), activeShot.shot) : 0;
  if (activeShot?.shot && activeShotProgress > 0.78) {
    const shot = activeShot.shot;
    const title = shot.headshot
      ? 'CRITICAL HEAD HIT'
      : shot.hitZone === 'leg'
        ? 'LEG HIT - TRIPPED'
        : shot.hitZone === 'body'
          ? 'BODY HIT'
          : shot.hitZone === 'cover'
            ? 'BLOCKED BY COVER'
            : shot.hitZone === 'graze'
              ? 'GRAZE'
              : 'MISS';
    const accent = shot.headshot ? '#fecaca' : shot.hit ? '#fef3c7' : shot.hitZone === 'cover' ? '#e2e8f0' : '#bae6fd';
    const bannerWidth = Math.min(280, width - 32);
    const y = Math.max(88, Math.min(height - 106, 142));
    ctx.fillStyle = shot.headshot
      ? 'rgba(127,29,29,0.86)'
      : shot.hit
        ? 'rgba(120,53,15,0.84)'
        : 'rgba(15,23,42,0.82)';
    drawRoundedRect(ctx, width / 2 - bannerWidth / 2, y, bannerWidth, 48, 18);
    ctx.fill();
    ctx.strokeStyle = shot.headshot ? 'rgba(248,113,113,0.72)' : shot.hit ? 'rgba(253,230,138,0.5)' : 'rgba(186,230,253,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = '900 15px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, width / 2, y + 20, bannerWidth - 24);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 13px Inter, system-ui, sans-serif';
    ctx.fillText(shot.damage > 0 ? `-${shot.damage} HP | ${shot.accuracy || 0}% aim` : `${shot.accuracy || 0}% aim`, width / 2, y + 37, bannerWidth - 24);
    ctx.textAlign = 'start';
  }

  if (state?.phase === 'round-result' && state.roundResult) {
    const bannerWidth = Math.min(430, width - 28);
    const x = (width - bannerWidth) / 2;
    ctx.fillStyle = 'rgba(15,23,42,0.82)';
    drawRoundedRect(ctx, x, 14, bannerWidth, 78, 22);
    ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.font = '900 21px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${state.roundResult.winnerName} wins the round`, width / 2, 45, bannerWidth - 32);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 14px Inter, system-ui, sans-serif';
    ctx.fillText(`Unlocked ${state.roundResult.bowUnlocked?.bowName || 'new knife'} (+${state.roundResult.bowUnlocked?.bowBonus || 0} dmg)`, width / 2, 70, bannerWidth - 32);
    ctx.textAlign = 'start';
  }

  drawVictoryCinematic(ctx, width, height, state, players, userId, performance.now(), finishStartedAt);

  drawPowerMeter(ctx, width, height, aim, timingPower, myTurn);
  ctx.restore();
};

const drawCanvas = ({ canvas, state, userId, previewUser, shotAnimations, aim, time, cameraRef, finishStartedAt, assets }) => {
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, rect.width);
  const height = Math.max(230, rect.height);

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const basePlayers = getRenderablePlayers(state, userId, previewUser);
  const turnUserId = state?.turnUserId || '';
  const shots = getRenderableShots(state);
  const obstacles = state?.obstacles?.length ? state.obstacles : DEFAULT_OBSTACLES;
  const timingPower = getTimingPower(time);
  const activeShot = shots
    .map(shot => ({ shot, start: shotAnimations?.get(getShotKey(shot)) }))
    .filter(item => item.start && time - item.start < getShotDuration(item.shot) + CAMERA_RETURN_MS)
    .sort((a, b) => b.start - a.start)[0];
  const players = getPlayersForShotFrame(basePlayers, activeShot, time);
  let camera = getCameraForFrame({ width, height, shots, shotAnimations, time });
  if (!activeShot && state?.status === 'finished') {
    camera = getFinishCamera({ width, height, state, players, userId, time, finishStartedAt }) || camera;
  }
  if (!activeShot && aim?.active && turnUserId === userId && state?.status === 'active') {
    const aimingPlayer = players.find(player => player.userId === userId);
    const point = aimingPlayer ? getArcherPoint(aimingPlayer.side) : null;
    const direction = aimingPlayer?.side === 'right' ? -1 : 1;
    const chargeRatio = clamp((aim.power || 0) / 100, 0, 1);
    const opponent = players.find(player => player.userId !== userId);
    const opponentPoint = opponent ? getArcherPoint(opponent.side) : null;
    const focusX = point && opponentPoint ? lerp(point.x, opponentPoint.x, 0.5) : point?.x + direction * 360;
    const focusY = point && opponentPoint ? Math.min(point.y, opponentPoint.y) - 96 : point?.y - 112;
    const focusZoom = clamp(Math.min(width / 1040, height / 560), camera.zoom * 1.02, 1.02);
    camera = normalizeCamera({
      ...camera,
      x: point ? lerp(camera.x, focusX, 0.48 + chargeRatio * 0.08) : camera.x,
      y: point ? lerp(camera.y, focusY, 0.48 + chargeRatio * 0.08) : camera.y,
      zoom: lerp(camera.zoom, focusZoom, 0.42 + chargeRatio * 0.08),
      shakeX: (camera.shakeX || 0) + Math.sin(time / 24) * chargeRatio * 3.5,
      shakeY: (camera.shakeY || 0) + Math.cos(time / 31) * chargeRatio * 2.4,
      mode: 'charge'
    }, width, height);
  }
  if (cameraRef) cameraRef.current = camera;

  ctx.save();
  applyCameraTransform(ctx, width, height, camera);
  drawBackground(ctx, time, assets);
  drawWindGusts(ctx, state?.wind || 0, time);
  drawEnvironmentalHazards(ctx, time, state?.wind || 0);
  drawObstacles(ctx, obstacles);
  players.forEach(player => {
    const activeShot = shots
      .filter(shot => shot.userId === player.userId)
      .map(shot => ({ shot, start: shotAnimations?.get(getShotKey(shot)) }))
      .filter(item => item.start && getShotProgress(item.start, time, item.shot) < 0.55)
      .sort((a, b) => b.start - a.start)[0];
    const hitReaction = getPlayerHitReaction(player, shots, shotAnimations, time);
    const outcome = state?.status === 'finished'
      ? (player.userId === state.winnerId ? 'winner' : 'defeat')
      : '';
    const chargeState = aim?.active && player.userId === userId && turnUserId === userId && state?.status === 'active'
      ? { active: true, power: aim.power, timingPower }
      : null;
    drawArcher(
      ctx,
      player,
      turnUserId === player.userId,
      time,
      activeShot ? getShotProgress(activeShot.start, time, activeShot.shot) : 1,
      hitReaction,
      chargeState,
      outcome,
      getFinishProgress(time, finishStartedAt),
      assets
    );
    drawPlayerEmote(ctx, player);
  });
  shots.forEach(shot => drawTrajectory(ctx, shot, time, shotAnimations?.get(getShotKey(shot)), assets));

  const myPlayer = players.find(player => player.userId === userId);
  drawAimPreview(ctx, myPlayer, aim, state?.wind || 0, timingPower, obstacles);

  ctx.restore();
  drawScreenHud(ctx, width, height, state, players, activeShot, timingPower, aim, turnUserId === userId && state?.status === 'active', userId, finishStartedAt);
};

const Avatar = ({ player }) => {
  const avatar = resolveMediaUrl(player?.avatar);
  const name = player?.name || 'Fighter';
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl bg-slate-950 text-sm font-black text-white ring-1 ring-white/10">
      {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}
    </div>
  );
};

const PlayerPanel = ({ label, player, active, winner }) => {
  const tier = BOW_TIERS[Math.min(BOW_TIERS.length - 1, player?.bowLevel || 0)];
  const maxHp = player?.maxHp || MAX_HP;
  const hp = clamp(player?.hp ?? maxHp, 0, maxHp);
  const hpRatio = maxHp ? hp / maxHp : 1;
  return (
    <div className={`rounded-3xl border p-4 transition ${
      active
        ? 'border-cyan-300 bg-cyan-50 shadow-lg shadow-cyan-500/10 dark:border-cyan-500/60 dark:bg-cyan-950/30'
        : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950'
    }`}>
      <div className="flex items-center gap-3">
        <Avatar player={player} />
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase text-gray-500 dark:text-gray-400">{label}</p>
          <p className="truncate text-sm font-black text-gray-950 dark:text-white">{player?.name || 'Waiting'}</p>
        </div>
        {winner ? <Crown className="ml-auto text-yellow-500" size={20} /> : null}
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] font-black uppercase text-gray-500 dark:text-gray-400">
          <span>HP</span>
          <span>{Math.round(hp)}/{maxHp}</span>
        </div>
        <div className="mt-1 h-3 overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-yellow-300 to-rose-400 transition-all"
            style={{ width: `${hpRatio * 100}%` }}
          />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] font-black uppercase text-gray-500 dark:text-gray-400">
        <div className="rounded-2xl bg-gray-50 p-2 ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800">
          <p>Hits</p>
          <p className="text-lg text-gray-950 dark:text-white">{player?.hits || 0}</p>
        </div>
        <div className="rounded-2xl bg-gray-50 p-2 ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800">
          <p>Dmg</p>
          <p className="text-lg text-gray-950 dark:text-white">{player?.totalDamage || 0}</p>
        </div>
        <div className="rounded-2xl bg-gray-50 p-2 ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800">
          <p>Streak</p>
          <p className="text-lg text-gray-950 dark:text-white">x{player?.streak || 0}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-gray-950 px-3 py-2 text-xs font-black text-white shadow-inner dark:bg-black">
        <img src={tier.icon} alt="" className="h-8 w-8 shrink-0 object-contain drop-shadow-[0_0_10px_rgba(255,255,255,0.35)]" />
        <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: tier.color, boxShadow: `0 0 14px ${tier.color}` }} />
        <span className="min-w-0 truncate">{tier.name} - {tier.effect} - +{tier.bonus}</span>
      </div>
    </div>
  );
};

const getBowDuelFinishMessage = (state, winnerIsCurrentUser, userId) => {
  if (state?.status !== 'finished') return '';
  const endedByCurrentUser = state.endedByUserId && state.endedByUserId === userId;
  if (state.endedReason === 'forfeit' || state.endedReason === 'left') {
    return endedByCurrentUser ? 'Match forfeited.' : 'Opponent forfeited. Victory awarded.';
  }
  if (state.endedReason === 'connection_lost') {
    return winnerIsCurrentUser ? 'Opponent connection lost. Victory awarded.' : 'Connection lost. Match ended.';
  }
  if (state.endedReason === 'knockout') {
    return winnerIsCurrentUser ? 'Victory by knockout.' : 'Defeat by knockout.';
  }
  return winnerIsCurrentUser ? 'Victory secured.' : 'Match complete.';
};

export default function BowDuelGame({ stats, onScoreSaved, onExit, isFullscreen = false }) {
  const { user } = useAuth();
  const userId = getEntityId(user);
  const canvasRef = useRef(null);
  const cameraRef = useRef(null);
  const socketRef = useRef(null);
  const stateRef = useRef(null);
  const aimRef = useRef({ active: false, angle: 42, power: 60 });
  const rafRef = useRef(null);
  const savedMatchIdsRef = useRef(new Set());
  const startedAtRef = useRef(Date.now());
  const shotAnimationsRef = useRef(new Map());
  const finishAnimationsRef = useRef(new Map());
  const audioRef = useRef(null);
  const playedShotAudioRef = useRef(new Set());
  const audioTimersRef = useRef(new Set());
  const finishedToastRef = useRef(new Set());
  const ensureBowAudioRef = useRef(null);
  const playShotAudioRef = useRef(null);
  const knifeAssetsRef = useRef(null);

  const [socketConnected, setSocketConnected] = useState(false);
  const [queueStatus, setQueueStatus] = useState({ waiting: false, queueSize: 0, onlineCount: 0 });
  const [matchState, setMatchState] = useState(null);
  const [aimDraft, setAimDraft] = useState({ active: false, angle: 42, power: 60 });
  const [saving, setSaving] = useState(false);
  const [soundOn, setSoundOn] = useState(true);

  const ensureBowAudio = useCallback(() => {
    if (!soundOn) return null;
    if (!audioRef.current) audioRef.current = createBowAudioController();
    audioRef.current?.setMuted(false);
    audioRef.current?.resume?.();
    return audioRef.current;
  }, [soundOn]);

  const playShotAudio = useCallback((payload) => {
    const shot = payload?.lastShot;
    if (!shot) return;
    const key = getShotKey(shot);
    if (playedShotAudioRef.current.has(key)) return;
    playedShotAudioRef.current.add(key);
    vibrate(shot.power > 70 ? 14 : 8);
    const audio = ensureBowAudio();
    audio?.playShoot();
    const impactTimer = window.setTimeout(() => {
      audioTimersRef.current.delete(impactTimer);
      const damaged = shot.hit || shot.damage > 0;
      if (damaged) {
        vibrate(shot.headshot ? [35, 25, 55] : shot.hitZone === 'leg' ? [24, 18, 34] : 28);
      } else {
        vibrate(10);
      }
      const liveAudio = audioRef.current;
      if (!liveAudio || !soundOn) return;
      if (damaged) {
        liveAudio.playImpact(Boolean(shot.headshot), shot.hitZone);
        liveAudio.playPain(Boolean(shot.headshot));
      } else {
        liveAudio.playMiss();
      }
    }, Math.max(280, getShotDuration(shot) * 0.84));
    audioTimersRef.current.add(impactTimer);
  }, [ensureBowAudio, soundOn]);

  const toggleSound = useCallback(() => {
    setSoundOn(prev => {
      const next = !prev;
      if (next) {
        const audio = audioRef.current || createBowAudioController();
        audioRef.current = audio;
        audio?.setMuted(false);
        audio?.resume?.();
        if (stateRef.current?.status === 'active' || queueStatus.waiting) audio?.startMusic();
      } else {
        audioRef.current?.setMuted(true);
        audioRef.current?.stopMusic();
      }
      return next;
    });
  }, [queueStatus.waiting]);

  useEffect(() => {
    ensureBowAudioRef.current = ensureBowAudio;
    playShotAudioRef.current = playShotAudio;
  }, [ensureBowAudio, playShotAudio]);

  useEffect(() => {
    let cancelled = false;
    loadKnifeDuelAssets().then((assets) => {
      if (!cancelled) knifeAssetsRef.current = assets;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rememberShotAnimations = useCallback((payload) => {
    const now = performance.now();
    const shots = Object.values(payload?.roundShots || {});
    if (payload?.lastShot && !shots.some(shot => getShotKey(shot) === getShotKey(payload.lastShot))) {
      shots.push(payload.lastShot);
    }

    shots.forEach(shot => {
      const key = getShotKey(shot);
      if (!shotAnimationsRef.current.has(key)) {
        shotAnimationsRef.current.set(key, now);
      }
    });

    shotAnimationsRef.current.forEach((startedAt, key) => {
      if (now - startedAt > 7000 || shotAnimationsRef.current.size > 18) {
        shotAnimationsRef.current.delete(key);
      }
    });
  }, []);

  useEffect(() => {
    stateRef.current = matchState;
  }, [matchState]);

  useEffect(() => {
    aimRef.current = aimDraft;
  }, [aimDraft]);

  useEffect(() => () => {
    audioTimersRef.current.forEach(timer => window.clearTimeout(timer));
    audioTimersRef.current.clear();
    audioRef.current?.dispose?.();
    audioRef.current = null;
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    audio.setMuted(!soundOn);
    if (!soundOn) {
      audio.stopMusic();
      return undefined;
    }

    if (queueStatus.waiting || matchState?.status === 'active') {
      audio.startMusic();
      return undefined;
    }

    const stopTimer = window.setTimeout(() => audio.stopMusic(), matchState?.status === 'finished' ? 1500 : 0);
    return () => window.clearTimeout(stopTimer);
  }, [matchState?.status, queueStatus.waiting, soundOn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const render = (time) => {
      const currentState = stateRef.current;
      drawCanvas({
        canvas,
        state: currentState,
        userId,
        previewUser: user,
        shotAnimations: shotAnimationsRef.current,
        aim: aimRef.current,
        time,
        cameraRef,
        finishStartedAt: currentState?.matchId ? finishAnimationsRef.current.get(currentState.matchId) : null,
        assets: knifeAssetsRef.current
      });
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [user, userId]);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const handleConnect = () => setSocketConnected(true);
    const handleDisconnect = () => setSocketConnected(false);
    const handleQueue = (payload = {}) => setQueueStatus({
      waiting: Boolean(payload.waiting),
      queueSize: payload.queueSize || 0,
      onlineCount: payload.onlineCount || 0
    });
    const handleState = (payload) => {
      rememberShotAnimations(payload);
      playShotAudioRef.current?.(payload);
      if (payload?.status === 'finished' && payload?.matchId && !finishAnimationsRef.current.has(payload.matchId)) {
        finishAnimationsRef.current.set(payload.matchId, performance.now());
      }
      setMatchState(payload);
      if (payload?.status === 'active') {
        setQueueStatus(prev => ({ ...prev, waiting: false }));
      }
    };
    const handleStart = (payload) => {
      startedAtRef.current = Date.now();
      shotAnimationsRef.current.clear();
      finishAnimationsRef.current.clear();
      rememberShotAnimations(payload);
      setMatchState(payload);
      setQueueStatus(prev => ({ ...prev, waiting: false }));
      ensureBowAudioRef.current?.()?.startMusic();
      toast.success('Knife Duel match found');
    };
    const handleError = (payload = {}) => {
      toast.error(payload.msg || 'Knife Duel error');
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('bow-duel:queue', handleQueue);
    socket.on('bow-duel:match-start', handleStart);
    socket.on('bow-duel:state', handleState);
    socket.on('bow-duel:error', handleError);

    if (socket.connected) handleConnect();
    else socket.connect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('bow-duel:queue', handleQueue);
      socket.off('bow-duel:match-start', handleStart);
      socket.off('bow-duel:state', handleState);
      socket.off('bow-duel:error', handleError);
      if (stateRef.current?.status === 'active') socket.emit('bow-duel:leave');
    };
  }, [rememberShotAnimations]);

  const players = matchState?.players || [];
  const me = useMemo(() => players.find(player => player.userId === userId), [players, userId]);
  const rival = useMemo(() => players.find(player => player.userId !== userId), [players, userId]);
  const myTurn = Boolean(matchState?.status === 'active' && matchState?.phase === 'aim' && matchState?.turnUserId === userId);
  const winnerIsMe = matchState?.status === 'finished' && matchState?.winnerId === userId;
  const finishMessage = useMemo(() => getBowDuelFinishMessage(matchState, winnerIsMe, userId), [matchState, userId, winnerIsMe]);
  const statusLabel = queueStatus.waiting
    ? 'Finding'
    : myTurn
      ? 'Your Turn'
      : matchState?.status === 'finished'
        ? (winnerIsMe ? 'Victory' : 'Finished')
        : matchState?.matchId
          ? 'Waiting'
          : 'Ready';

  useEffect(() => {
    if (matchState?.status !== 'finished' || !finishMessage || !matchState.matchId) return;
    const toastKey = `${matchState.matchId}:${matchState.endedReason || 'finished'}`;
    if (finishedToastRef.current.has(toastKey)) return;
    finishedToastRef.current.add(toastKey);
    if (winnerIsMe) toast.success(finishMessage);
    else toast(finishMessage);
  }, [finishMessage, matchState?.endedReason, matchState?.matchId, matchState?.status, winnerIsMe]);

  const startSearch = useCallback(() => {
    if (!userId) {
      toast.error('Please sign in first');
      return;
    }

    const socket = socketRef.current || getSocket();
    ensureBowAudio()?.startMusic();
    startedAtRef.current = Date.now();
    finishAnimationsRef.current.clear();
    setMatchState(null);
    setQueueStatus(prev => ({ ...prev, waiting: true }));
    socket.emit('bow-duel:find-match', {
      userId,
      profile: {
        name: user?.name || 'Fighter',
        avatar: user?.avatar || ''
      }
    });
  }, [ensureBowAudio, user, userId]);

  const cancelSearch = useCallback(() => {
    const socket = socketRef.current || getSocket();
    socket.emit('bow-duel:cancel-search');
    audioRef.current?.stopMusic();
    setQueueStatus(prev => ({ ...prev, waiting: false }));
  }, []);

  const leaveMatch = useCallback(() => {
    const socket = socketRef.current || getSocket();
    socket.emit('bow-duel:leave');
    audioRef.current?.stopMusic();
    toast('Match forfeited.');
    setMatchState(null);
    setAimDraft({ active: false, angle: 42, power: 60 });
  }, []);

  const getPointerAim = useCallback((event) => {
    const canvas = canvasRef.current;
    const currentState = stateRef.current;
    const currentPlayer = currentState?.players?.find(player => player.userId === userId);
    if (!canvas || !currentPlayer) return null;

    const point = screenToWorld(event, canvas, cameraRef.current);
    const origin = getArcherPoint(currentPlayer.side);
    const forwardDx = currentPlayer.side === 'left' ? point.x - origin.x : origin.x - point.x;
    const dy = (origin.y - THROW_ORIGIN_HEIGHT) - point.y;
    const distance = Math.hypot(forwardDx, dy);
    const angle = clamp(Math.round(Math.atan2(dy, Math.max(36, forwardDx)) * (180 / Math.PI)), -12, 82);
    const power = clamp(Math.round(distance / 8.25), 12, 100);
    return { active: true, angle, power };
  }, [userId]);

  const fireShot = useCallback((aim) => {
    if (!myTurn || !aim) return;
    const socket = socketRef.current || getSocket();
    const timedPower = aim.timingPower || getTimingPower(performance.now());
    socket.emit('bow-duel:throw', {
      angle: aim.angle,
      power: timedPower,
      powerTiming: timedPower
    }, (response = {}) => {
      if (!response.ok) toast.error(response.msg || 'Shot rejected');
    });
  }, [myTurn]);

  const sendEmote = useCallback((label) => {
    if (!matchState?.matchId) return;
    const socket = socketRef.current || getSocket();
    socket.emit('bow-duel:emote', { label }, (response = {}) => {
      if (!response.ok) toast.error(response.msg || 'Could not send reaction');
    });
  }, [matchState?.matchId]);

  const handlePointerDown = (event) => {
    if (!myTurn) return;
    ensureBowAudio();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const nextAim = getPointerAim(event);
    if (nextAim) setAimDraft(nextAim);
  };

  const handlePointerMove = (event) => {
    if (!aimDraft.active || !myTurn) return;
    event.preventDefault();
    const nextAim = getPointerAim(event);
    if (nextAim) setAimDraft(nextAim);
  };

  const handlePointerUp = (event) => {
    if (!aimDraft.active) return;
    event.preventDefault();
    const timingPower = getTimingPower(performance.now());
    const shotAim = { ...aimDraft, power: timingPower, timingPower };
    setAimDraft({ ...shotAim, active: false });
    fireShot(shotAim);
  };

  useEffect(() => {
    if (matchState?.status !== 'finished' || !me || !matchState.matchId) return;
    if (savedMatchIdsRef.current.has(matchState.matchId)) return;
    savedMatchIdsRef.current.add(matchState.matchId);

    const submit = async () => {
      const wonMatch = matchState.winnerId === userId;
      const rounds = clamp(matchState.turnCount || matchState.round || 1, 1, 80);
      const wins = clamp(me.wins || 0, 0, 3);
      const totalDamage = Math.max(0, me.totalDamage || 0);
      const bowLevel = clamp(me.bowLevel || 0, 0, BOW_TIERS.length - 1);
      const hits = Math.max(0, me.hits || 0);
      const shots = Math.max(0, me.shots || 0);
      const hpRemaining = Math.max(0, Math.round(me.hp || 0));
      const score = wins * 1400 + totalDamage * 24 + bowLevel * 430 + hits * 130 + hpRemaining * 3 + (wonMatch ? 1200 : 0);
      if (score <= 0) return;

      setSaving(true);
      try {
        await api.post('/games/bow-duel/submit', {
          score,
          wins,
          rounds,
          totalDamage,
          bowLevel,
          hits,
          shots,
          hpRemaining,
          wonMatch,
          elapsedMs: Date.now() - startedAtRef.current
        });
        toast.success(wonMatch ? 'Knife Duel win saved' : 'Knife Duel score saved');
        onScoreSaved?.();
      } catch (err) {
        savedMatchIdsRef.current.delete(matchState.matchId);
        toast.error(err.response?.data?.msg || 'Could not save Knife Duel score');
      } finally {
        setSaving(false);
      }
    };

    submit();
  }, [matchState, me, onScoreSaved, userId]);

  return (
    <section className={`bow-duel-game overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 ${isFullscreen ? 'bow-duel-fullscreen' : ''}`}>
      <div className="bg-gradient-to-r from-emerald-500 via-sky-500 to-amber-400 px-4 py-4 text-white sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-13 w-13 h-[3.25rem] w-[3.25rem] shrink-0 place-items-center rounded-2xl bg-black/25 ring-1 ring-white/25">
              <Swords size={26} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase text-white/75">Ranked Knife Duel</p>
              <h2 className="truncate text-2xl font-black tracking-normal">Knife Duel</h2>
              <p className="line-clamp-1 text-sm font-semibold text-white/80">Long-range throws, hit physics, stronger blade effects.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-black">
            <button
              type="button"
              onClick={toggleSound}
              className="inline-flex min-h-9 items-center gap-2 rounded-full bg-black/20 px-3 py-2 text-white ring-1 ring-white/20 transition hover:bg-black/30"
              aria-label={soundOn ? 'Mute Knife Duel audio' : 'Enable Knife Duel audio'}
            >
              {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />} {soundOn ? 'Sound' : 'Muted'}
            </button>
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-2 ring-1 ring-white/20 ${socketConnected ? 'bg-black/20' : 'bg-rose-500/30'}`}>
              <Radio size={14} /> {socketConnected ? 'Online' : 'Connecting'}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-black/20 px-3 py-2 ring-1 ring-white/20">
              <Trophy size={14} /> Best {formatScore(stats?.bowDuelStats?.highScore || 0)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:p-5 2xl:grid-cols-[minmax(0,1fr)_21rem]">
        <main className="min-w-0 space-y-4">
          <div className="bow-duel-canvas-shell rounded-3xl border border-gray-200 bg-gray-950 p-2 shadow-2xl shadow-sky-500/10 dark:border-gray-700">
            <canvas
              ref={canvasRef}
              className="bow-duel-canvas aspect-[16/10] w-full touch-none rounded-[1.35rem] bg-sky-100"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => setAimDraft(prev => ({ ...prev, active: false }))}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
              <p className="flex items-center gap-2 text-xs font-black uppercase text-gray-500 dark:text-gray-400"><Wind size={15} /> Wind</p>
              <p className="mt-2 text-2xl font-black text-gray-950 dark:text-white">{matchState?.wind > 0 ? '+' : ''}{matchState?.wind || 0}</p>
            </div>
            <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
              <p className="flex items-center gap-2 text-xs font-black uppercase text-gray-500 dark:text-gray-400"><Crosshair size={15} /> Aim</p>
              <p className="mt-2 text-2xl font-black text-gray-950 dark:text-white">{aimDraft.angle} deg / {aimDraft.power}%</p>
            </div>
            <div className="rounded-3xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
              <p className="flex items-center gap-2 text-xs font-black uppercase text-gray-500 dark:text-gray-400"><Sparkles size={15} /> Status</p>
              <p className="mt-2 truncate text-2xl font-black text-gray-950 dark:text-white">
                {statusLabel}
              </p>
              {finishMessage ? <p className="mt-1 line-clamp-2 text-xs font-bold text-gray-500 dark:text-gray-400">{finishMessage}</p> : null}
            </div>
          </div>
        </main>

        <aside className="grid gap-4 lg:grid-cols-2 2xl:block 2xl:space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950 lg:col-span-2 2xl:col-span-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Match</p>
                <h3 className="text-xl font-black text-gray-950 dark:text-white">
                  {matchState?.status === 'finished' ? 'Match Finished' : matchState?.matchId ? `Turn ${matchState.turnCount || 0}` : 'Find opponent'}
                </h3>
              </div>
              {saving ? <Loader2 className="animate-spin text-sky-500" size={22} /> : <Shield className="text-emerald-500" size={24} />}
            </div>
            {finishMessage ? (
              <div className={`mt-4 rounded-2xl px-3 py-2 text-sm font-black ${
                winnerIsMe
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-100 dark:ring-emerald-500/20'
                  : 'bg-rose-50 text-rose-700 ring-1 ring-rose-100 dark:bg-rose-950/30 dark:text-rose-100 dark:ring-rose-500/20'
              }`}>
                {finishMessage}
              </div>
            ) : null}

            <div className="mt-4 grid gap-2">
              {[
                { label: 'You', player: me },
                { label: 'Rival', player: rival }
              ].map(({ label, player }) => {
                const maxHp = player?.maxHp || MAX_HP;
                const hp = clamp(player?.hp ?? maxHp, 0, maxHp);
                return (
                  <div key={label}>
                    <div className="mb-1 flex justify-between text-[11px] font-black uppercase text-gray-500 dark:text-gray-400">
                      <span>{label}</span>
                      <span>{Math.round(hp)}/{maxHp}</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-yellow-300 to-rose-400" style={{ width: `${maxHp ? (hp / maxHp) * 100 : 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 grid gap-2">
              {!matchState?.matchId && !queueStatus.waiting ? (
                <button
                  type="button"
                  onClick={startSearch}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-gray-950 px-4 py-3 text-sm font-black text-white transition hover:bg-sky-700 dark:bg-white dark:text-gray-950"
                >
                  <Zap size={18} /> Find Match
                </button>
              ) : null}
              {queueStatus.waiting ? (
                <button
                  type="button"
                  onClick={cancelSearch}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-gray-950 ring-1 ring-gray-200 transition hover:bg-gray-50 dark:bg-gray-900 dark:text-white dark:ring-gray-700"
                >
                  <Loader2 size={18} className="animate-spin" /> Cancel Search
                </button>
              ) : null}
              {matchState?.matchId ? (
                <button
                  type="button"
                  onClick={matchState.status === 'finished' ? startSearch : leaveMatch}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-gray-950 ring-1 ring-gray-200 transition hover:bg-gray-50 dark:bg-gray-900 dark:text-white dark:ring-gray-700"
                >
                  {matchState.status === 'finished' ? <RotateCcw size={18} /> : <ArrowLeft size={18} />}
                  {matchState.status === 'finished' ? 'New Match' : 'Leave Match'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onExit}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-gray-50 px-4 py-3 text-sm font-black text-gray-700 ring-1 ring-gray-200 transition hover:bg-blue-50 hover:text-blue-700 dark:bg-gray-900 dark:text-gray-200 dark:ring-gray-800"
              >
                <ArrowLeft size={18} /> Back to Hub
              </button>
            </div>

            {queueStatus.waiting ? (
              <p className="mt-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                Searching online players. Queue: {queueStatus.queueSize || 1}. Online: {queueStatus.onlineCount || 1}.
              </p>
            ) : null}
          </div>

          <PlayerPanel label="You" player={me || { name: user?.name || 'You', avatar: user?.avatar }} active={myTurn} winner={winnerIsMe} />
          <PlayerPanel label="Opponent" player={rival} active={matchState?.turnUserId === rival?.userId} winner={matchState?.winnerId === rival?.userId} />

          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950">
            <p className="text-sm font-black text-gray-950 dark:text-white">Quick Reactions</p>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {EMOTE_LABELS.map(label => (
                <button
                  key={label}
                  type="button"
                  onClick={() => sendEmote(label)}
                  disabled={!matchState?.matchId || matchState.status !== 'active'}
                  className="min-h-10 rounded-2xl bg-gray-50 px-2 text-xs font-black text-gray-700 ring-1 ring-gray-200 transition hover:bg-cyan-50 hover:text-cyan-700 disabled:opacity-45 dark:bg-gray-900 dark:text-gray-200 dark:ring-gray-800"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950">
            <p className="text-sm font-black text-gray-950 dark:text-white">Knife Unlocks</p>
            <div className="mt-3 space-y-2">
              {BOW_TIERS.map((tier, index) => {
                const unlocked = (me?.bowLevel || 0) >= index;
                return (
                  <div key={tier.name} className={`flex items-center justify-between rounded-2xl px-3 py-2 text-xs font-black ring-1 ${
                    unlocked
                      ? 'bg-gray-950 text-white ring-gray-900 dark:bg-white dark:text-gray-950 dark:ring-white'
                      : 'bg-gray-50 text-gray-500 ring-gray-100 dark:bg-gray-900 dark:text-gray-400 dark:ring-gray-800'
                  }`}>
                      <span className="flex min-w-0 items-center gap-2">
                        <img src={tier.icon} alt="" className="h-8 w-8 shrink-0 object-contain" />
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tier.color, boxShadow: unlocked ? `0 0 14px ${tier.color}` : 'none' }} />
                        <span className="truncate">{tier.name}</span>
                      </span>
                    <span>+{tier.bonus}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
