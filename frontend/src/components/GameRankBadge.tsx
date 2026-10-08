import React, { useEffect, useMemo, useState } from 'react';
import { MotionConfig, motion } from 'framer-motion';
import { Crown, Star, Trophy } from 'lucide-react';

const fallbackRank = {
  key: 'recruit',
  name: 'Unranked',
  shortName: 'Unranked',
  apexStars: 0
};

type GameRank = {
  key?: string;
  name?: string;
  shortName?: string;
  apexStars?: number;
};

const palettes = {
  recruit: {
    gradient: 'from-slate-500 via-gray-700 to-gray-950',
    ring: 'ring-slate-300/70 dark:ring-slate-500/50',
    soft: 'bg-slate-50 text-slate-700 dark:bg-slate-950/40 dark:text-slate-200',
    glow: 'rgba(100,116,139,0.28)',
    spark: 'bg-slate-200'
  },
  iron: {
    gradient: 'from-stone-300 via-stone-600 to-zinc-950',
    ring: 'ring-stone-300/70 dark:ring-stone-500/50',
    soft: 'bg-stone-50 text-stone-800 dark:bg-stone-950/40 dark:text-stone-100',
    glow: 'rgba(120,113,108,0.32)',
    spark: 'bg-stone-200'
  },
  bronze: {
    gradient: 'from-orange-300 via-amber-700 to-stone-950',
    ring: 'ring-orange-300/70 dark:ring-orange-500/50',
    soft: 'bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200',
    glow: 'rgba(249,115,22,0.36)',
    spark: 'bg-orange-200'
  },
  silver: {
    gradient: 'from-zinc-100 via-zinc-400 to-zinc-950',
    ring: 'ring-zinc-300/80 dark:ring-zinc-400/50',
    soft: 'bg-zinc-50 text-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-100',
    glow: 'rgba(161,161,170,0.4)',
    spark: 'bg-zinc-100'
  },
  gold: {
    gradient: 'from-yellow-200 via-amber-500 to-orange-950',
    ring: 'ring-yellow-300/80 dark:ring-yellow-500/50',
    soft: 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-100',
    glow: 'rgba(245,158,11,0.48)',
    spark: 'bg-yellow-200'
  },
  platinum: {
    gradient: 'from-cyan-200 via-sky-500 to-blue-950',
    ring: 'ring-cyan-300/80 dark:ring-cyan-500/50',
    soft: 'bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100',
    glow: 'rgba(34,211,238,0.54)',
    spark: 'bg-cyan-200'
  },
  diamond: {
    gradient: 'from-sky-100 via-blue-400 to-indigo-950',
    ring: 'ring-sky-300/80 dark:ring-sky-500/50',
    soft: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-100',
    glow: 'rgba(96,165,250,0.6)',
    spark: 'bg-sky-200'
  },
  epic: {
    gradient: 'from-fuchsia-300 via-violet-600 to-indigo-950',
    ring: 'ring-fuchsia-300/80 dark:ring-fuchsia-500/50',
    soft: 'bg-fuchsia-50 text-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-100',
    glow: 'rgba(217,70,239,0.66)',
    spark: 'bg-fuchsia-200'
  },
  legend: {
    gradient: 'from-violet-200 via-purple-600 to-indigo-950',
    ring: 'ring-violet-300/80 dark:ring-violet-500/50',
    soft: 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-100',
    glow: 'rgba(139,92,246,0.7)',
    spark: 'bg-violet-200'
  },
  mythic: {
    gradient: 'from-rose-300 via-pink-600 to-purple-950',
    ring: 'ring-rose-300/80 dark:ring-rose-500/50',
    soft: 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
    glow: 'rgba(244,63,94,0.76)',
    spark: 'bg-rose-200'
  },
  dragon: {
    gradient: 'from-orange-200 via-red-500 to-zinc-950',
    ring: 'ring-orange-300/80 dark:ring-orange-500/60',
    soft: 'bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-100',
    glow: 'rgba(249,115,22,0.82)',
    spark: 'bg-orange-200'
  },
  inferno: {
    gradient: 'from-yellow-200 via-orange-500 to-red-950',
    ring: 'ring-orange-300/90 dark:ring-orange-500/70',
    soft: 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-100',
    glow: 'rgba(251,146,60,0.88)',
    spark: 'bg-yellow-200'
  },
  celestial: {
    gradient: 'from-amber-100 via-fuchsia-500 to-cyan-950',
    ring: 'ring-amber-200/90 dark:ring-amber-400/70',
    soft: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
    glow: 'rgba(251,191,36,0.9)',
    spark: 'bg-amber-100'
  },
  apex: {
    gradient: 'from-yellow-100 via-orange-400 to-fuchsia-950',
    ring: 'ring-yellow-200/90 dark:ring-yellow-400/80',
    soft: 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-100',
    glow: 'rgba(250,204,21,0.95)',
    spark: 'bg-yellow-100'
  },
  'mythical-vanguard': {
    gradient: 'from-orange-200 via-red-500 to-amber-950',
    ring: 'ring-orange-200/90 dark:ring-orange-400/80',
    soft: 'bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-100',
    glow: 'rgba(249,115,22,0.96)',
    spark: 'bg-orange-100'
  },
  'mythical-legend': {
    gradient: 'from-cyan-200 via-violet-500 to-indigo-950',
    ring: 'ring-violet-200/90 dark:ring-violet-400/80',
    soft: 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-100',
    glow: 'rgba(139,92,246,0.98)',
    spark: 'bg-cyan-100'
  },
  'mythic-warden': {
    gradient: 'from-pink-200 via-rose-500 to-slate-950',
    ring: 'ring-pink-200/90 dark:ring-pink-400/80',
    soft: 'bg-pink-50 text-pink-800 dark:bg-pink-950/40 dark:text-pink-100',
    glow: 'rgba(236,72,153,0.98)',
    spark: 'bg-pink-100'
  },
  'mythic-guardian': {
    gradient: 'from-sky-100 via-cyan-500 to-blue-950',
    ring: 'ring-sky-200/90 dark:ring-sky-400/80',
    soft: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-100',
    glow: 'rgba(14,165,233,0.98)',
    spark: 'bg-sky-100'
  },
  'mythic-ascendant': {
    gradient: 'from-fuchsia-200 via-purple-600 to-slate-950',
    ring: 'ring-fuchsia-200/90 dark:ring-fuchsia-400/80',
    soft: 'bg-fuchsia-50 text-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-100',
    glow: 'rgba(217,70,239,0.98)',
    spark: 'bg-fuchsia-100'
  },
  'mythic-immortal': {
    gradient: 'from-amber-100 via-red-500 to-black',
    ring: 'ring-red-200/90 dark:ring-red-400/80',
    soft: 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-100',
    glow: 'rgba(239,68,68,1)',
    spark: 'bg-amber-100'
  },
  'eternal-legend': {
    gradient: 'from-violet-100 via-indigo-500 to-black',
    ring: 'ring-violet-200/90 dark:ring-violet-400/80',
    soft: 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-100',
    glow: 'rgba(99,102,241,1)',
    spark: 'bg-violet-100'
  },
  'radiant-overlord': {
    gradient: 'from-yellow-100 via-orange-400 to-fuchsia-950',
    ring: 'ring-yellow-200/90 dark:ring-yellow-400/80',
    soft: 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-100',
    glow: 'rgba(250,204,21,1)',
    spark: 'bg-yellow-100'
  },
  'celestial-monarch': {
    gradient: 'from-cyan-100 via-fuchsia-500 to-indigo-950',
    ring: 'ring-cyan-200/90 dark:ring-cyan-400/80',
    soft: 'bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100',
    glow: 'rgba(34,211,238,1)',
    spark: 'bg-cyan-100'
  },
  'sovereign-origin': {
    gradient: 'from-white via-yellow-300 to-fuchsia-950',
    ring: 'ring-yellow-100 dark:ring-yellow-300/90',
    soft: 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-100',
    glow: 'rgba(255,255,255,1)',
    spark: 'bg-white'
  }
};

const sizeMap = {
  sm: { shell: 'h-12 w-12', icon: 20, crown: 9, star: 8 },
  md: { shell: 'h-16 w-16', icon: 30, crown: 13, star: 10 },
  lg: { shell: 'h-24 w-24', icon: 45, crown: 18, star: 13 }
};

const rankPower = {
  recruit: 0,
  iron: 1,
  bronze: 2,
  silver: 3,
  gold: 4,
  platinum: 5,
  diamond: 6,
  epic: 7,
  legend: 8,
  mythic: 9,
  dragon: 10,
  inferno: 11,
  celestial: 12,
  apex: 13,
  'mythical-vanguard': 14,
  'mythical-legend': 15,
  'mythic-warden': 16,
  'mythic-guardian': 17,
  'mythic-ascendant': 18,
  'mythic-immortal': 19,
  'eternal-legend': 20,
  'radiant-overlord': 21,
  'celestial-monarch': 22,
  'sovereign-origin': 24
};

const gameRankShapes = {
  recruit: 'polygon(50% 6%, 86% 26%, 86% 74%, 50% 94%, 14% 74%, 14% 26%)',
  iron: 'polygon(50% 0%, 90% 24%, 90% 76%, 50% 100%, 10% 76%, 10% 24%)',
  bronze: 'polygon(50% 0%, 88% 18%, 94% 52%, 76% 88%, 50% 100%, 24% 88%, 6% 52%, 12% 18%)',
  silver: 'polygon(50% 0%, 80% 12%, 100% 42%, 88% 78%, 50% 100%, 12% 78%, 0% 42%, 20% 12%)',
  gold: 'polygon(50% 0%, 62% 28%, 94% 18%, 76% 48%, 100% 70%, 66% 72%, 50% 100%, 34% 72%, 0% 70%, 24% 48%, 6% 18%, 38% 28%)',
  platinum: 'polygon(50% 0%, 88% 28%, 72% 100%, 28% 100%, 12% 28%)',
  diamond: 'polygon(50% 0%, 92% 42%, 50% 100%, 8% 42%)',
  epic: 'polygon(50% 0%, 70% 14%, 94% 10%, 88% 38%, 100% 60%, 72% 70%, 50% 100%, 28% 70%, 0% 60%, 12% 38%, 6% 10%, 30% 14%)',
  legend: 'polygon(50% 0%, 60% 18%, 84% 8%, 92% 30%, 100% 50%, 88% 70%, 72% 92%, 50% 100%, 28% 92%, 12% 70%, 0% 50%, 8% 30%, 16% 8%, 40% 18%)',
  mythic: 'polygon(50% 0%, 64% 17%, 88% 6%, 86% 34%, 100% 56%, 76% 74%, 66% 100%, 50% 88%, 34% 100%, 24% 74%, 0% 56%, 14% 34%, 12% 6%, 36% 17%)',
  dragon: 'polygon(50% 0%, 63% 14%, 88% 5%, 82% 31%, 100% 45%, 86% 62%, 94% 88%, 68% 82%, 50% 100%, 32% 82%, 6% 88%, 14% 62%, 0% 45%, 18% 31%, 12% 5%, 37% 14%)',
  inferno: 'polygon(50% 0%, 58% 18%, 78% 8%, 74% 32%, 98% 42%, 82% 58%, 92% 82%, 66% 78%, 50% 100%, 34% 78%, 8% 82%, 18% 58%, 2% 42%, 26% 32%, 22% 8%, 42% 18%)',
  celestial: 'polygon(50% 0%, 60% 16%, 82% 8%, 92% 28%, 100% 50%, 92% 72%, 82% 92%, 60% 84%, 50% 100%, 40% 84%, 18% 92%, 8% 72%, 0% 50%, 8% 28%, 18% 8%, 40% 16%)',
  apex: 'polygon(50% 0%, 61% 22%, 88% 8%, 78% 38%, 100% 58%, 70% 66%, 58% 100%, 50% 76%, 42% 100%, 30% 66%, 0% 58%, 22% 38%, 12% 8%, 39% 22%)',
  'mythical-vanguard': 'polygon(50% 0%, 62% 15%, 86% 4%, 84% 28%, 100% 44%, 86% 64%, 92% 90%, 66% 82%, 50% 100%, 34% 82%, 8% 90%, 14% 64%, 0% 44%, 16% 28%, 14% 4%, 38% 15%)',
  'mythical-legend': 'polygon(50% 0%, 60% 14%, 82% 5%, 92% 24%, 100% 45%, 92% 66%, 82% 94%, 58% 84%, 50% 100%, 42% 84%, 18% 94%, 8% 66%, 0% 45%, 8% 24%, 18% 5%, 40% 14%)',
  'mythic-warden': 'polygon(50% 0%, 66% 15%, 92% 8%, 84% 36%, 100% 54%, 78% 72%, 72% 100%, 50% 86%, 28% 100%, 22% 72%, 0% 54%, 16% 36%, 8% 8%, 34% 15%)',
  'mythic-guardian': 'polygon(50% 0%, 70% 12%, 98% 18%, 84% 42%, 96% 70%, 66% 74%, 50% 100%, 34% 74%, 4% 70%, 16% 42%, 2% 18%, 30% 12%)',
  'mythic-ascendant': 'polygon(50% 0%, 58% 16%, 76% 6%, 82% 26%, 100% 38%, 88% 60%, 96% 84%, 70% 82%, 50% 100%, 30% 82%, 4% 84%, 12% 60%, 0% 38%, 18% 26%, 24% 6%, 42% 16%)',
  'mythic-immortal': 'polygon(50% 0%, 61% 13%, 84% 2%, 82% 27%, 100% 40%, 86% 58%, 96% 86%, 68% 80%, 50% 100%, 32% 80%, 4% 86%, 14% 58%, 0% 40%, 18% 27%, 16% 2%, 39% 13%)',
  'eternal-legend': 'polygon(50% 0%, 59% 12%, 80% 4%, 94% 24%, 100% 50%, 94% 76%, 80% 96%, 59% 88%, 50% 100%, 41% 88%, 20% 96%, 6% 76%, 0% 50%, 6% 24%, 20% 4%, 41% 12%)',
  'radiant-overlord': 'polygon(50% 0%, 62% 20%, 92% 4%, 78% 36%, 100% 52%, 78% 68%, 92% 96%, 62% 82%, 50% 100%, 38% 82%, 8% 96%, 22% 68%, 0% 52%, 22% 36%, 8% 4%, 38% 20%)',
  'celestial-monarch': 'polygon(50% 0%, 58% 12%, 78% 4%, 92% 20%, 100% 50%, 92% 80%, 78% 96%, 58% 88%, 50% 100%, 42% 88%, 22% 96%, 8% 80%, 0% 50%, 8% 20%, 22% 4%, 42% 12%)',
  'sovereign-origin': 'polygon(50% 0%, 60% 18%, 86% 0%, 82% 30%, 100% 50%, 82% 70%, 86% 100%, 60% 82%, 50% 100%, 40% 82%, 14% 100%, 18% 70%, 0% 50%, 18% 30%, 14% 0%, 40% 18%)'
};

const STAR_POWER_REFERENCE = 100;
const starRankKeys = new Set(['apex']);
const cycloneRankKeys = new Set(['apex']);
const wingRankKeys = new Set(['legend', 'apex']);

export const getGamePalette = (rank) => palettes[rank?.key] || palettes.recruit;
export const getGameRankPower = (rank) => {
  const basePower = rankPower[rank?.key] ?? 0;
  const apexStars = starRankKeys.has(rank?.key) ? Math.max(0, Number(rank?.apexStars) || 0) : 0;
  const starPower = Math.min(0.99, Math.log1p(apexStars) / Math.log1p(STAR_POWER_REFERENCE));
  return basePower + starPower;
};
export const resolveHighestGameRank = (currentRank, highestRank) => (
  highestRank && getGameRankPower(highestRank) > getGameRankPower(currentRank) ? highestRank : currentRank
);

const lolRankIcons = {
  unranked: { file: 'unranked.png', label: 'Unranked' },
  iron: { file: 'iron.png', label: 'Iron' },
  bronze: { file: 'bronze.png', label: 'Bronze' },
  silver: { file: 'silver.png', label: 'Silver' },
  gold: { file: 'gold.png', label: 'Gold' },
  platinum: { file: 'platinum.png', label: 'Platinum' },
  diamond: { file: 'diamond.png', label: 'Diamond' },
  master: { file: 'master.png', label: 'Master' },
  grandmaster: { file: 'grandmaster.png', label: 'Grandmaster' },
  challenger: { file: 'challenger.png', label: 'Challenger' }
};

const gameRankIcons = {
  recruit: 'unranked',
  iron: 'iron',
  bronze: 'bronze',
  silver: 'silver',
  gold: 'gold',
  platinum: 'platinum',
  diamond: 'diamond',
  epic: 'master',
  legend: 'grandmaster',
  apex: 'challenger',
  mythic: 'grandmaster',
  dragon: 'challenger',
  inferno: 'challenger',
  celestial: 'challenger'
};

const getGameRankIcon = (rank) => {
  const iconKey = gameRankIcons[rank?.key] || 'unranked';
  const icon = lolRankIcons[iconKey] || lolRankIcons.unranked;
  return {
    ...icon,
    src: `/lol-ranks/${icon.file}`
  };
};

const formatStars = (value = 0) => {
  const count = Math.max(0, Number(value) || 0);
  return new Intl.NumberFormat('en-US', {
    notation: count >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1
  }).format(count);
};

export const getProfileFrameClass = (stats) => {
  const tier = Math.min(10, Math.max(0, Number(stats?.profileBorderTier ?? stats?.rank?.profileBorderTier ?? Math.floor((stats?.apexStars || stats?.rank?.apexStars || 0) / 10))));
  const frames = [
    'ring-gray-200 dark:ring-gray-700',
    'ring-cyan-300 shadow-cyan-500/20',
    'ring-blue-400 shadow-blue-500/25',
    'ring-pink-400 shadow-pink-500/30',
    'ring-violet-400 shadow-violet-500/35',
    'ring-fuchsia-400 shadow-fuchsia-500/40',
    'ring-orange-400 shadow-orange-500/45',
    'ring-red-400 shadow-red-500/50',
    'ring-yellow-300 shadow-yellow-500/55',
    'ring-cyan-200 shadow-cyan-300/60',
    'ring-white shadow-white/70'
  ];
  return `${frames[tier] || frames[0]} ring-4 shadow-xl`;
};

export function GameRankEmblem({ rank = fallbackRank, size = 'md', animated = false, stars }: { rank?: GameRank; size?: string; animated?: boolean; stars?: number }) {
  const palette = getGamePalette(rank);
  const sizes = sizeMap[size] || sizeMap.md;
  const MotionTag = animated ? motion.div : 'div';
  const apexStars = Number(stars ?? rank?.apexStars ?? 0);
  const starRatio = Math.min(1, Math.max(0, Math.log1p(apexStars) / Math.log1p(STAR_POWER_REFERENCE)));
  const starGrowthRatio = Math.min(1.45, Math.max(0, Math.log1p(apexStars) / Math.log1p(STAR_POWER_REFERENCE)));
  const apexBoost = starRankKeys.has(rank?.key) ? 25 * starRatio : 0;
  const power = (rankPower[rank?.key] || 0) + (apexBoost * 0.34);
  const hasGlow = power >= 5;
  const isCycloneRank = cycloneRankKeys.has(rank?.key);
  const hasWingAura = wingRankKeys.has(rank?.key);
  const showAmbientEffects = false;
  const showBackplate = false;
  const isLegendStar = rank?.key === 'apex' && apexStars >= 25;
  const isMythic = power >= 9;
  const isChampion = power >= 13;
  const isRoyal = power >= 18 || starRatio >= 0.8;
  const lowScale = size === 'sm' ? 0.9 : size === 'lg' ? 0.86 : 0.82;
  const midScale = size === 'sm' ? 0.98 : size === 'lg' ? 1 : 0.94;
  const maxScale = size === 'sm' ? 1.14 : size === 'lg' ? 2.3 : 2.02;
  const rankGrowth = starRankKeys.has(rank?.key) ? starGrowthRatio * (size === 'sm' ? 0.08 : size === 'lg' ? 0.54 : 0.42) : 0;
  const baseScale = power <= 2
    ? lowScale
    : power <= 4
      ? midScale
      : power <= 6
        ? 1
        : 1 + ((power - 6) * (size === 'sm' ? 0.026 : 0.04));
  const scale = Math.min(maxScale, baseScale + rankGrowth);
  const glowOpacity = !hasGlow ? 0 : isCycloneRank ? Math.min(0.98, 0.5 + ((power - 10) * 0.06) + (starRatio * 0.22)) : Math.min(0.62, 0.1 + (power * 0.02) + (starRatio * 0.28));
  const starSparkCount = starRankKeys.has(rank?.key) ? 10 + Math.floor(starRatio * 38) : 0;
  const rankSparkCount = power >= 18 ? 18 : power >= 13 ? 12 : power >= 9 ? 8 : power >= 7 ? 5 : 0;
  const sparkLimit = size === 'sm' ? 8 : size === 'lg' ? 40 : 32;
  const sparkCount = Math.min(sparkLimit, Math.max(starSparkCount, isLegendStar ? 14 + Math.floor(apexStars / 8) : isCycloneRank ? 10 : rankSparkCount));
  const visibleStars = apexStars > 0 ? Math.min(size === 'sm' ? 6 : 10, Math.max(1, Math.ceil(apexStars / 10))) : 0;
  const shapeClipPath = gameRankShapes[rank?.key] || gameRankShapes.recruit;
  const shouldAnimate = animated && (hasGlow || apexStars > 0);
  const rankIcon = getGameRankIcon(rank);
  const iconInset = power >= 18 || starRatio >= 0.8
    ? size === 'sm' ? 'inset-[-12%]' : size === 'lg' ? 'inset-[-36%]' : 'inset-[-30%]'
    : power >= 13 || starRatio >= 0.45
      ? size === 'sm' ? 'inset-[-10%]' : size === 'lg' ? 'inset-[-30%]' : 'inset-[-24%]'
      : power >= 7
        ? size === 'sm' ? 'inset-[-8%]' : size === 'lg' ? 'inset-[-22%]' : 'inset-[-16%]'
        : size === 'sm' ? 'inset-[-5%]' : size === 'lg' ? 'inset-[-14%]' : 'inset-[-8%]';
  const chevronCount = power >= 22 ? 6 : power >= 18 ? 5 : power >= 13 ? 4 : power >= 7 ? 3 : power >= 3 ? 2 : 1;
  const iconFilter = power >= 18 || starRatio >= 0.8
    ? 'drop-shadow(0 10px 18px rgba(0,0,0,0.45)) drop-shadow(0 0 18px rgba(250,204,21,0.88))'
    : power >= 13 || starRatio >= 0.45
      ? 'drop-shadow(0 10px 18px rgba(0,0,0,0.45)) drop-shadow(0 0 14px rgba(250,204,21,0.62))'
      : 'drop-shadow(0 10px 18px rgba(0,0,0,0.45))';

  return (
    <MotionConfig reducedMotion="never">
      <MotionTag
        {...(animated ? {
          animate: shouldAnimate
            ? { y: [0, -3, 0], scale: [scale, scale + 0.025, scale] }
            : { scale },
          transition: shouldAnimate
            ? { duration: 3, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.2 }
        } : { style: { transform: `scale(${scale})` } })}
        className={`rank-motion-zone relative isolate ${sizes.shell} shrink-0 overflow-visible`}
        style={{ willChange: shouldAnimate ? 'transform' : 'auto' }}
        title={`${rank?.name || fallbackRank.name} - ${rankIcon.label} emblem`}
      >
        {showAmbientEffects && hasGlow && (
          <div
            className="absolute inset-[-34%] rounded-full blur-[1px]"
            style={{
              background: `radial-gradient(circle, ${palette.glow}, transparent 68%)`,
              opacity: glowOpacity
            }}
          />
        )}

        {showAmbientEffects && power >= 4 && (
          <div className="absolute inset-[-12%] rounded-full bg-[conic-gradient(from_20deg,rgba(255,255,255,0.18),transparent_72deg,rgba(250,204,21,0.3)_140deg,transparent_212deg,rgba(34,211,238,0.26)_286deg,rgba(255,255,255,0.18))] opacity-75 blur-[1px]" />
        )}

        {showAmbientEffects && isCycloneRank && (
          <motion.div
            animate={shouldAnimate ? { rotate: 360, scale: [1, 1.08, 1] } : undefined}
            transition={shouldAnimate ? {
              rotate: { duration: Math.max(5.8, 9.5 - (power * 0.25)), repeat: Infinity, ease: 'linear' },
              scale: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }
            } : undefined}
            className="absolute inset-[-28%] rounded-full bg-[conic-gradient(from_90deg,transparent_0deg,rgba(34,211,238,0.72)_48deg,transparent_100deg,rgba(236,72,153,0.74)_164deg,transparent_220deg,rgba(250,204,21,0.78)_288deg,transparent_360deg)] opacity-80"
          />
        )}

        {showAmbientEffects && hasWingAura && (
          <>
            {['left', 'right'].map(side => (
              <motion.span
                key={side}
                animate={shouldAnimate ? { opacity: [0.62, 1, 0.62], scaleX: [0.92, 1.08, 0.92] } : undefined}
                transition={shouldAnimate ? { duration: isLegendStar ? 2.4 : 2.8, repeat: Infinity, ease: 'easeInOut' } : undefined}
                className={`absolute top-[18%] z-10 h-[64%] w-[58%] rounded-full blur-[1px] ${
                  isLegendStar
                    ? 'bg-[radial-gradient(ellipse_at_center,rgba(168,85,247,0.8),rgba(34,211,238,0.25)_54%,transparent_72%)]'
                    : 'bg-[radial-gradient(ellipse_at_center,rgba(251,146,60,0.8),rgba(239,68,68,0.25)_54%,transparent_72%)]'
                }`}
                style={{
                  [side]: '-34%',
                  clipPath: side === 'left'
                    ? 'polygon(100% 10%, 10% 30%, 0 70%, 100% 92%)'
                    : 'polygon(0 10%, 90% 30%, 100% 70%, 0 92%)'
                }}
              />
            ))}
          </>
        )}

        {showAmbientEffects && power >= 9 && (
          <>
            {['left', 'right'].map(side => (
              <span
                key={`plate-${side}`}
                className={`absolute top-[26%] z-20 h-[48%] w-[42%] bg-gradient-to-br ${palette.gradient} opacity-95 shadow-[0_10px_26px_rgba(0,0,0,0.34)] ring-1 ring-white/20`}
                style={{
                  [side]: power >= 18 ? '-28%' : '-20%',
                  clipPath: side === 'left'
                    ? 'polygon(100% 0%, 28% 20%, 0 50%, 28% 80%, 100% 100%, 68% 50%)'
                    : 'polygon(0 0%, 72% 20%, 100% 50%, 72% 80%, 0 100%, 32% 50%)'
                }}
              >
                <span
                  className="absolute inset-[18%] bg-white/20"
                  style={{
                    clipPath: side === 'left'
                      ? 'polygon(100% 4%, 34% 24%, 12% 50%, 34% 76%, 100% 96%, 72% 50%)'
                      : 'polygon(0 4%, 66% 24%, 88% 50%, 66% 76%, 0 96%, 28% 50%)'
                  }}
                />
              </span>
            ))}
          </>
        )}

        {sparkCount > 0 && Array.from({ length: sparkCount }).map((_, index) => (
          <motion.span
            key={`spark-${index}`}
            animate={shouldAnimate ? { opacity: [0.18, 1, 0.18], scale: [0.7, 1.28, 0.7], y: [0, -5, 0] } : undefined}
            transition={shouldAnimate ? { duration: 1.4 + (index * 0.05), repeat: Infinity, ease: 'easeInOut', delay: index * 0.08 } : undefined}
            className={`absolute z-30 rounded-full ${palette.spark} shadow-[0_0_10px_rgba(250,204,21,0.78)]`}
            style={{
            width: Math.max(2, sizes.star * 0.34),
            height: Math.max(2, sizes.star * 0.34),
            left: `${(starRatio > 0.45 ? -8 : 3) + ((index * 23) % (starRatio > 0.45 ? 116 : 94))}%`,
            top: `${(starRatio > 0.45 ? -6 : 3) + ((index * 31) % (starRatio > 0.45 ? 112 : 94))}%`
          }}
        />
      ))}

        {isRoyal && (
          <Crown
            size={sizes.crown + (size === 'lg' ? 10 : size === 'sm' ? 2 : 6)}
            className={`absolute ${size === 'sm' ? '-top-[8%]' : '-top-[14%]'} left-1/2 z-30 -translate-x-1/2 text-yellow-100 drop-shadow-[0_0_10px_rgba(250,204,21,0.86)]`}
            fill="currentColor"
          />
        )}

        {showBackplate && <div
          className={`relative z-20 flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br ${palette.gradient} text-white ${hasGlow ? 'shadow-2xl' : 'shadow-md shadow-black/10 dark:shadow-black/40'} ring-2 ${palette.ring}`}
          style={{
            clipPath: shapeClipPath,
            ...(hasGlow ? { boxShadow: isCycloneRank ? `0 0 ${18 + (power * 2)}px ${palette.glow}` : `0 0 12px ${palette.glow}` } : {})
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_32%_16%,rgba(255,255,255,0.82),transparent_25%),linear-gradient(145deg,rgba(255,255,255,0.24),transparent_42%,rgba(0,0,0,0.46)_100%)]" />
          <div className="absolute inset-[3%] opacity-75 mix-blend-screen" style={{ clipPath: shapeClipPath, background: 'conic-gradient(from 225deg, rgba(255,255,255,0.46), rgba(255,255,255,0.04) 28%, rgba(0,0,0,0.12) 46%, rgba(255,255,255,0.3) 68%, rgba(255,255,255,0.08))' }} />
          <div className="absolute inset-[7%] border border-white/35" style={{ clipPath: shapeClipPath }} />
          <div className="absolute inset-[15%] border border-black/25" style={{ clipPath: shapeClipPath }} />
          <div className="absolute left-[16%] top-[10%] h-[16%] w-[68%] rounded-full bg-white/40 blur-[1px]" />
          <div className="absolute left-[14%] top-[23%] h-[34%] w-[22%] bg-white/18" style={{ clipPath: 'polygon(0 0, 100% 18%, 72% 100%, 12% 84%)' }} />
          <div className="absolute right-[14%] top-[23%] h-[34%] w-[22%] bg-black/18" style={{ clipPath: 'polygon(0 18%, 100% 0, 88% 84%, 28% 100%)' }} />
          <div className="absolute bottom-[19%] left-[24%] h-[14%] w-[52%] bg-white/12" style={{ clipPath: 'polygon(50% 100%, 100% 0, 0 0)' }} />
          {isMythic && <div className="absolute inset-[20%] rounded-full bg-white/10 blur-lg" />}

          <div className="absolute top-[13%] z-20 flex items-center justify-center gap-0.5">
            {(power >= 5 ? [0, 1, 2] : [0]).map(item => (
              <Star
                key={item}
                size={sizes.star + (power >= 7 ? 1 : 0)}
                className={item === 1 ? 'text-yellow-100' : 'text-white/85'}
                fill="currentColor"
              />
            ))}
          </div>

          {isChampion && (
            <div className="absolute inset-x-[22%] bottom-[25%] z-10 h-[7%] rounded-full bg-white/25 shadow-[0_0_12px_rgba(255,255,255,0.28)]" />
          )}

          <div className="absolute bottom-[13%] z-20 flex items-center justify-center gap-0.5">
            {Array.from({ length: chevronCount }).map((_, index) => (
              <span
                key={index}
                className="block h-1.5 w-2.5 bg-white/70 shadow-[0_0_6px_rgba(255,255,255,0.45)]"
                style={{ clipPath: 'polygon(50% 0%, 100% 100%, 0 100%)' }}
              />
            ))}
          </div>
        </div>}

        <div className={`pointer-events-none absolute ${iconInset} z-[25] grid place-items-center`}>
          <img
            src={rankIcon.src}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-contain opacity-95"
            style={{ filter: iconFilter }}
            draggable="false"
          />
        </div>

        {apexStars > 0 && (
          <span className={`absolute z-30 inline-flex items-center justify-center gap-0.5 rounded-full border border-yellow-200 bg-gray-950 font-black text-yellow-100 shadow-lg shadow-yellow-500/30 ${
            size === 'sm' ? '-bottom-1 -right-1.5 min-w-6 px-1 py-0.5 text-[8px]' : '-bottom-2 -right-3 min-w-8 px-2 py-1 text-[10px]'
          }`}>
            <Star size={size === 'sm' ? 8 : 10} fill="currentColor" />
            {formatStars(apexStars)}
          </span>
        )}

        {visibleStars > 0 && Array.from({ length: visibleStars }).map((_, index) => (
          <motion.span
            key={`apex-${index}`}
            animate={shouldAnimate ? { opacity: [0.45, 1, 0.45], scale: [0.9, 1.25, 0.9] } : undefined}
            transition={shouldAnimate ? { duration: 1.6 + (index * 0.15), repeat: Infinity, ease: 'easeInOut' } : undefined}
            className="absolute rounded-full bg-yellow-200 shadow-[0_0_12px_rgba(250,204,21,0.95)]"
            style={{
            width: sizes.star * 0.45,
            height: sizes.star * 0.45,
            left: `${10 + ((index * 13) % 82)}%`,
            bottom: `${6 + ((index % 3) * 7)}%`
          }}
        />
      ))}
      </MotionTag>
    </MotionConfig>
  );
}

export default function GameRankBadge({ stats, compact = false, showProgress = true }) {
  const rank = stats?.rank || fallbackRank;
  const highestRank = resolveHighestGameRank(rank, stats?.highestRank);
  const nextRank = stats?.nextRank;
  const palette = getGamePalette(rank);
  const apexStars = Number(stats?.apexStars ?? rank?.apexStars ?? 0);
  const isApex = starRankKeys.has(rank?.key);
  const cardStarRatio = Math.min(1, Math.max(0, Math.log1p(apexStars) / Math.log1p(STAR_POWER_REFERENCE)));
  const cardPower = (rankPower[rank?.key] || 0) + (isApex ? cardStarRatio * 8 : 0);
  const showCardAura = cardPower >= 7;
  const progressValue = nextRank ? (stats?.progress ?? 0) : isApex ? Math.min(100, stats?.apexStarProgress ?? rank?.apexStarProgress ?? 0) : 100;
  const progressLabel = nextRank
    ? `${stats?.xpToNext || 0} pts to ${nextRank.shortName}`
    : isApex
      ? `${stats?.apexStarXpToNext || rank?.apexStarXpToNext || 0} pts to Star ${apexStars + 1}`
      : 'Max game rank reached';
  const milestone = useMemo(() => Math.floor(apexStars / 25) * 25, [apexStars]);
  const [rankUpMilestone, setRankUpMilestone] = useState(null);

  useEffect(() => {
    if (compact || milestone < 25) return undefined;
    const seasonId = stats?.season?.id || 'current';
    const storageKey = `syncrova-codm-rank-milestone-${seasonId}`;
    const legacyStorageKey = `studenthub-rank-milestone-${seasonId}`;
    const previous = Number(localStorage.getItem(storageKey) || localStorage.getItem(legacyStorageKey) || 0);
    if (milestone <= previous) return undefined;

    localStorage.setItem(storageKey, String(milestone));
    setRankUpMilestone(milestone);
    const timer = window.setTimeout(() => setRankUpMilestone(null), 4200);
    return () => window.clearTimeout(timer);
  }, [compact, milestone, stats?.season?.id]);

  if (compact) {
    return (
      <span className={`rank-motion-zone inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black ring-1 ${palette.soft} ${palette.ring}`}>
        <Trophy size={13} />
        {rank.shortName || rank.name}
        {isApex && apexStars > 0 && (
            <span className="inline-flex min-w-8 items-center justify-center gap-0.5 rounded-full bg-yellow-400/20 px-1.5 py-0.5 text-[10px] text-yellow-700 dark:text-yellow-200">
            <Star size={10} fill="currentColor" />
            {formatStars(apexStars)}
          </span>
        )}
      </span>
    );
  }

  return (
    <div
      className={`rank-motion-zone relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm ring-1 ring-black/5 dark:border-gray-800 dark:bg-gray-950 dark:ring-white/10 ${
        showCardAura ? 'shadow-xl shadow-black/10 dark:shadow-black/40' : ''
      }`}
      style={showCardAura ? { boxShadow: `0 24px 80px -44px ${palette.glow}` } : undefined}
    >
      {rankUpMilestone && (
        <div className="fixed inset-0 z-[95] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[2rem] border border-white/15 bg-gray-950 p-6 text-center text-white shadow-2xl shadow-pink-500/25">
            <div className="mx-auto grid h-28 w-28 place-items-center">
              <GameRankEmblem rank={rank} size="lg" animated stars={apexStars} />
            </div>
            <p className="mt-5 text-xs font-black uppercase text-pink-200">Rank milestone reached</p>
            <h2 className="mt-2 text-3xl font-black tracking-normal">You reached {rankUpMilestone} stars</h2>
            <p className="mt-2 text-sm font-semibold text-white/65">Keep it up. Your profile border and rank aura just got stronger.</p>
            <button
              type="button"
              onClick={() => setRankUpMilestone(null)}
              className="mt-5 rounded-2xl bg-white px-5 py-3 text-sm font-black text-gray-950 transition hover:bg-pink-50"
            >
              Continue
            </button>
          </div>
        </div>
      )}
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${palette.gradient}`} />
      {showCardAura && (
        <div
          className="pointer-events-none absolute -left-14 -top-16 h-40 w-40 rounded-full"
          style={{ background: `radial-gradient(circle, ${palette.glow}, transparent 72%)`, opacity: 0.34 }}
        />
      )}
      {cardPower >= 12 && (
        <div
          className="pointer-events-none absolute -bottom-20 right-0 h-44 w-44 rounded-full"
          style={{ background: `radial-gradient(circle, ${palette.glow}, transparent 72%)`, opacity: 0.2 }}
        />
      )}
      <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-visible sm:h-16 sm:w-16">
          <GameRankEmblem rank={rank} size="sm" animated stars={apexStars} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-gray-500 dark:text-gray-400">
            <Star size={14} className="text-yellow-500" fill="currentColor" />
            Division Rank
          </p>
          <h3 className="mt-1 truncate text-xl font-black text-gray-950 dark:text-white">
            {rank.name}{isApex && apexStars > 0 ? ` - Star ${formatStars(apexStars)}` : ''}
          </h3>
          <p className="mt-1 text-sm font-semibold text-gray-500 dark:text-gray-400">
            {stats?.season?.label || 'Current Season'} - {stats?.highScore || 0} best score
          </p>
        </div>
      </div>

      <div className={`relative z-10 mt-4 grid gap-2 ${isApex ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div className="rounded-xl border border-gray-200 bg-gray-50/85 p-3 dark:border-gray-800 dark:bg-gray-900/70">
          <p className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Highest Rank</p>
          <p className="mt-1 truncate text-sm font-black text-gray-950 dark:text-white">{highestRank?.name || rank.name}</p>
        </div>
        {isApex && (
          <div className="rounded-xl border border-yellow-200 bg-gradient-to-br from-yellow-50 to-white p-3 ring-1 ring-yellow-100 dark:border-yellow-900/50 dark:from-yellow-950/30 dark:to-gray-950 dark:ring-yellow-900/50">
            <p className="text-xs font-black uppercase text-yellow-700 dark:text-yellow-200">Apex Stars</p>
            <p className="mt-1 truncate text-sm font-black text-gray-950 dark:text-white">{formatStars(apexStars || 1)} glowing star{(apexStars || 1) > 1 ? 's' : ''}</p>
          </div>
        )}
        <div className="rounded-xl border border-gray-200 bg-gray-50/85 p-3 dark:border-gray-800 dark:bg-gray-900/70">
          <p className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Season Reward</p>
          <p className="mt-1 truncate text-sm font-black text-gray-950 dark:text-white">{stats?.rewards?.current?.title || 'Starter Badge'}</p>
        </div>
      </div>

      {showProgress && (
        <div className="relative z-10 mt-4">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-500 dark:text-gray-400">
            <span>{progressLabel}</span>
            <span>{progressValue}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200/70 dark:bg-gray-800 dark:ring-gray-700/70">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressValue}%` }}
              transition={{ duration: 0.75, ease: 'easeOut' }}
              className={`h-full rounded-full bg-gradient-to-r ${palette.gradient}`}
            />
          </div>
          <p className="mt-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
            Season reset: current ranking score is softened each 1-month season.
          </p>
        </div>
      )}
    </div>
  );
}
