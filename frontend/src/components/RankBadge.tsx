import React from 'react';
import { MotionConfig, motion } from 'framer-motion';
import { Crown, Sparkles, Star } from 'lucide-react';

const rankPalettes = {
  rookie: {
    ring: 'ring-slate-300/70 dark:ring-slate-600/70',
    text: 'text-slate-700 dark:text-slate-200',
    soft: 'bg-slate-50 dark:bg-slate-900/40',
    gradient: 'from-slate-500 via-slate-700 to-slate-950',
    glow: 'shadow-slate-500/25'
  },
  bronze: {
    ring: 'ring-amber-700/30 dark:ring-amber-500/40',
    text: 'text-amber-800 dark:text-amber-200',
    soft: 'bg-amber-50 dark:bg-amber-950/30',
    gradient: 'from-amber-400 via-orange-600 to-stone-900',
    glow: 'shadow-amber-500/30'
  },
  silver: {
    ring: 'ring-zinc-300/80 dark:ring-zinc-500/50',
    text: 'text-zinc-700 dark:text-zinc-100',
    soft: 'bg-zinc-50 dark:bg-zinc-900/50',
    gradient: 'from-zinc-100 via-zinc-400 to-zinc-900',
    glow: 'shadow-zinc-400/30'
  },
  gold: {
    ring: 'ring-yellow-300/80 dark:ring-yellow-500/50',
    text: 'text-yellow-800 dark:text-yellow-100',
    soft: 'bg-yellow-50 dark:bg-yellow-950/30',
    gradient: 'from-yellow-200 via-amber-500 to-orange-900',
    glow: 'shadow-yellow-500/35'
  },
  platinum: {
    ring: 'ring-cyan-300/80 dark:ring-cyan-500/50',
    text: 'text-cyan-800 dark:text-cyan-100',
    soft: 'bg-cyan-50 dark:bg-cyan-950/30',
    gradient: 'from-cyan-100 via-sky-400 to-indigo-900',
    glow: 'shadow-cyan-500/35'
  },
  epic: {
    ring: 'ring-violet-300/80 dark:ring-violet-500/50',
    text: 'text-violet-800 dark:text-violet-100',
    soft: 'bg-violet-50 dark:bg-violet-950/30',
    gradient: 'from-violet-300 via-fuchsia-500 to-indigo-950',
    glow: 'shadow-violet-500/35'
  },
  mythic: {
    ring: 'ring-rose-300/80 dark:ring-rose-500/50',
    text: 'text-rose-800 dark:text-rose-100',
    soft: 'bg-rose-50 dark:bg-rose-950/30',
    gradient: 'from-rose-300 via-pink-600 to-purple-950',
    glow: 'shadow-rose-500/35'
  },
  legend: {
    ring: 'ring-orange-300/80 dark:ring-orange-500/50',
    text: 'text-orange-800 dark:text-orange-100',
    soft: 'bg-orange-50 dark:bg-orange-950/30',
    gradient: 'from-amber-200 via-orange-500 to-rose-950',
    glow: 'shadow-orange-500/40'
  },
  dragon: {
    ring: 'ring-orange-300/80 dark:ring-orange-500/60',
    text: 'text-orange-800 dark:text-orange-100',
    soft: 'bg-orange-50 dark:bg-orange-950/30',
    gradient: 'from-orange-200 via-red-600 to-black',
    glow: 'shadow-orange-500/55'
  },
  inferno: {
    ring: 'ring-red-300/90 dark:ring-red-500/70',
    text: 'text-red-800 dark:text-red-100',
    soft: 'bg-red-50 dark:bg-red-950/30',
    gradient: 'from-yellow-100 via-orange-500 to-red-950',
    glow: 'shadow-orange-500/60'
  },
  celestial: {
    ring: 'ring-cyan-200/90 dark:ring-cyan-400/70',
    text: 'text-cyan-800 dark:text-cyan-100',
    soft: 'bg-cyan-50 dark:bg-cyan-950/30',
    gradient: 'from-cyan-100 via-fuchsia-500 to-indigo-950',
    glow: 'shadow-cyan-500/60'
  }
};

const sizeClasses = {
  sm: {
    wrap: 'h-11 w-11',
    icon: 16,
    star: 'h-3 w-3',
    letter: 'text-[11px]'
  },
  md: {
    wrap: 'h-16 w-16',
    icon: 22,
    star: 'h-4 w-4',
    letter: 'text-sm'
  },
  lg: {
    wrap: 'h-24 w-24',
    icon: 34,
    star: 'h-5 w-5',
    letter: 'text-lg'
  }
};

const fallbackRank = {
  key: 'rookie',
  name: 'Rookie Operator',
  shortName: 'Rookie'
};

const rankPower = {
  rookie: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 4,
  epic: 5,
  mythic: 6,
  legend: 7,
  dragon: 8,
  inferno: 9,
  celestial: 10
};

const rankShapes = {
  rookie: 'polygon(50% 5%, 86% 25%, 86% 75%, 50% 95%, 14% 75%, 14% 25%)',
  bronze: 'polygon(50% 0%, 88% 18%, 94% 52%, 76% 88%, 50% 100%, 24% 88%, 6% 52%, 12% 18%)',
  silver: 'polygon(50% 0%, 80% 12%, 100% 42%, 88% 78%, 50% 100%, 12% 78%, 0% 42%, 20% 12%)',
  gold: 'polygon(50% 0%, 62% 28%, 94% 18%, 76% 48%, 100% 70%, 66% 72%, 50% 100%, 34% 72%, 0% 70%, 24% 48%, 6% 18%, 38% 28%)',
  platinum: 'polygon(50% 0%, 88% 28%, 72% 100%, 28% 100%, 12% 28%)',
  epic: 'polygon(50% 0%, 70% 14%, 94% 10%, 88% 38%, 100% 60%, 72% 70%, 50% 100%, 28% 70%, 0% 60%, 12% 38%, 6% 10%, 30% 14%)',
  mythic: 'polygon(50% 0%, 64% 17%, 88% 6%, 86% 34%, 100% 56%, 76% 74%, 66% 100%, 50% 88%, 34% 100%, 24% 74%, 0% 56%, 14% 34%, 12% 6%, 36% 17%)',
  legend: 'polygon(50% 0%, 60% 18%, 84% 8%, 92% 30%, 100% 50%, 88% 70%, 72% 92%, 50% 100%, 28% 92%, 12% 70%, 0% 50%, 8% 30%, 16% 8%, 40% 18%)',
  dragon: 'polygon(50% 0%, 63% 14%, 88% 5%, 82% 31%, 100% 45%, 86% 62%, 94% 88%, 68% 82%, 50% 100%, 32% 82%, 6% 88%, 14% 62%, 0% 45%, 18% 31%, 12% 5%, 37% 14%)',
  inferno: 'polygon(50% 0%, 58% 18%, 78% 8%, 74% 32%, 98% 42%, 82% 58%, 92% 82%, 66% 78%, 50% 100%, 34% 78%, 8% 82%, 18% 58%, 2% 42%, 26% 32%, 22% 8%, 42% 18%)',
  celestial: 'polygon(50% 0%, 60% 16%, 82% 8%, 92% 28%, 100% 50%, 92% 72%, 82% 92%, 60% 84%, 50% 100%, 40% 84%, 18% 92%, 8% 72%, 0% 50%, 8% 28%, 18% 8%, 40% 16%)'
};

export const getRankPalette = (rank) => rankPalettes[rank?.key] || rankPalettes.rookie;
const getRankPower = (rank) => rankPower[rank?.key] ?? 0;

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

const workRankIcons = {
  rookie: 'unranked',
  bronze: 'iron',
  silver: 'bronze',
  gold: 'silver',
  platinum: 'gold',
  epic: 'platinum',
  mythic: 'diamond',
  legend: 'master',
  dragon: 'grandmaster',
  inferno: 'challenger',
  celestial: 'challenger'
};

const getWorkRankIcon = (rank) => {
  const iconKey = workRankIcons[rank?.key] || 'unranked';
  const icon = lolRankIcons[iconKey] || lolRankIcons.unranked;
  return {
    ...icon,
    src: `/lol-ranks/${icon.file}`
  };
};

export function RankEmblem({ rank = fallbackRank, size = 'md', animated = false }) {
  const palette = getRankPalette(rank);
  const classes = sizeClasses[size] || sizeClasses.md;
  const rankIcon = getWorkRankIcon(rank);
  const MotionTag = animated ? motion.div : 'div';
  const power = getRankPower(rank);
  const isEliteRank = power >= 7;
  const isCycloneRank = power >= 9;
  const isLowestRank = power <= 0;
  const shouldAnimate = animated && power >= 3;
  const shapeClipPath = rankShapes[rank?.key] || rankShapes.rookie;
  const visualScale = Math.min(size === 'sm' ? 1.28 : size === 'lg' ? 1.55 : 1.38, 0.86 + (power * (size === 'sm' ? 0.035 : 0.052)));
  const iconInset = power >= 9
    ? size === 'sm' ? 'inset-[-16%]' : size === 'lg' ? 'inset-[-30%]' : 'inset-[-24%]'
    : power >= 7
      ? size === 'sm' ? 'inset-[-12%]' : size === 'lg' ? 'inset-[-24%]' : 'inset-[-18%]'
      : power >= 4
        ? size === 'sm' ? 'inset-[-8%]' : size === 'lg' ? 'inset-[-18%]' : 'inset-[-12%]'
        : size === 'sm' ? 'inset-[-3%]' : size === 'lg' ? 'inset-[-10%]' : 'inset-[-6%]';
  const chevronCount = power >= 9 ? 5 : power >= 7 ? 4 : power >= 4 ? 3 : power >= 2 ? 2 : 1;
  const iconFilter = power >= 9
    ? 'drop-shadow(0 10px 18px rgba(0,0,0,0.45)) drop-shadow(0 0 18px rgba(250,204,21,0.86))'
    : power >= 7
      ? 'drop-shadow(0 10px 18px rgba(0,0,0,0.45)) drop-shadow(0 0 14px rgba(250,204,21,0.6))'
      : 'drop-shadow(0 10px 18px rgba(0,0,0,0.45))';
  const sparkCount = power >= 9 ? 16 : power >= 7 ? 11 : power >= 5 ? 7 : power >= 3 ? 4 : 0;

  return (
    <MotionConfig reducedMotion="never">
      <MotionTag
        {...(animated ? {
          animate: shouldAnimate
            ? { y: [0, -4, 0], rotate: [0, -1, 1, 0], scale: [visualScale, visualScale + 0.025, visualScale] }
            : { scale: visualScale },
          transition: shouldAnimate ? { duration: 3.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }
        } : { style: { transform: `scale(${visualScale})` } })}
        className={`rank-motion-zone relative isolate ${classes.wrap} shrink-0 overflow-visible`}
        title={`${rank?.name || fallbackRank.name} - ${rankIcon.label} emblem`}
      >
        {!isLowestRank && <div className={`absolute inset-[-16%] rounded-full bg-gradient-to-br ${palette.gradient} ${isCycloneRank ? 'opacity-50 blur-xl' : 'opacity-20 blur-md'}`} />}
        {power >= 4 && (
          <div className="absolute inset-[-12%] rounded-full bg-[conic-gradient(from_20deg,rgba(255,255,255,0.16),transparent_72deg,rgba(250,204,21,0.28)_140deg,transparent_212deg,rgba(34,211,238,0.22)_286deg,rgba(255,255,255,0.16))] opacity-70 blur-[1px]" />
        )}
        {isCycloneRank && (
          <motion.div
            animate={shouldAnimate ? { rotate: 360 } : undefined}
            transition={shouldAnimate ? { duration: 9, repeat: Infinity, ease: 'linear' } : undefined}
            className="absolute inset-[-22%] rounded-full bg-[conic-gradient(from_90deg,transparent,rgba(250,204,21,0.8),transparent,rgba(249,115,22,0.72),transparent)] opacity-80"
          />
        )}
        {power >= 5 && !isCycloneRank && (
          <div className={`absolute inset-[-14%] rounded-full bg-gradient-to-br ${palette.gradient} opacity-20 blur-lg`} />
        )}
        {isEliteRank && (
          <>
            {['left', 'right'].map(side => (
              <motion.span
                key={side}
                animate={shouldAnimate ? { opacity: [0.55, 0.95, 0.55], scaleX: [0.92, 1.07, 0.92] } : undefined}
                transition={shouldAnimate ? { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } : undefined}
                className="absolute top-[20%] z-10 h-[58%] w-[54%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(250,204,21,0.7),rgba(249,115,22,0.25)_54%,transparent_72%)] blur-[1px]"
                style={{
                  [side]: '-30%',
                  clipPath: side === 'left'
                    ? 'polygon(100% 10%, 10% 32%, 0 70%, 100% 90%)'
                    : 'polygon(0 10%, 90% 32%, 100% 70%, 0 90%)'
                }}
              />
            ))}
          </>
        )}
        {power >= 6 && (
          <>
            {['left', 'right'].map(side => (
              <span
                key={`plate-${side}`}
                className={`absolute top-[27%] z-20 h-[46%] w-[38%] bg-gradient-to-br ${palette.gradient} opacity-90 shadow-[0_10px_24px_rgba(0,0,0,0.3)] ring-1 ring-white/20`}
                style={{
                  [side]: power >= 9 ? '-24%' : '-17%',
                  clipPath: side === 'left'
                    ? 'polygon(100% 0%, 30% 20%, 0 50%, 30% 80%, 100% 100%, 68% 50%)'
                    : 'polygon(0 0%, 70% 20%, 100% 50%, 70% 80%, 0 100%, 32% 50%)'
                }}
              />
            ))}
          </>
        )}
        {isCycloneRank && (
          <Crown
            size={size === 'lg' ? 28 : size === 'sm' ? 14 : 20}
            className="absolute -top-[12%] left-1/2 z-30 -translate-x-1/2 text-yellow-100 drop-shadow-[0_0_10px_rgba(250,204,21,0.82)]"
            fill="currentColor"
          />
        )}
        {sparkCount > 0 && Array.from({ length: sparkCount }).map((_, index) => (
          <motion.span
            key={`spark-${index}`}
            animate={shouldAnimate ? { opacity: [0.16, 1, 0.16], scale: [0.7, 1.24, 0.7], y: [0, -4, 0] } : undefined}
            transition={shouldAnimate ? { duration: 1.5 + (index * 0.05), repeat: Infinity, ease: 'easeInOut', delay: index * 0.08 } : undefined}
            className={`absolute z-30 rounded-full bg-white shadow-[0_0_10px_rgba(250,204,21,0.75)] ${power >= 7 ? 'bg-yellow-100' : ''}`}
            style={{
              width: Math.max(2, (size === 'lg' ? 6 : size === 'sm' ? 3 : 4)),
              height: Math.max(2, (size === 'lg' ? 6 : size === 'sm' ? 3 : 4)),
              left: `${(power >= 8 ? -6 : 3) + ((index * 23) % (power >= 8 ? 112 : 94))}%`,
              top: `${(power >= 8 ? -4 : 3) + ((index * 31) % (power >= 8 ? 110 : 94))}%`
            }}
          />
        ))}
        <div
          className={`relative z-20 flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br ${palette.gradient} text-white ${isLowestRank ? 'shadow-md shadow-black/10 dark:shadow-black/40' : isCycloneRank ? `shadow-xl ${palette.glow}` : 'shadow-lg shadow-black/10 dark:shadow-black/40'} ring-2 ${palette.ring}`}
          style={{ clipPath: shapeClipPath }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_32%_16%,rgba(255,255,255,0.82),transparent_25%),linear-gradient(145deg,rgba(255,255,255,0.24),transparent_42%,rgba(0,0,0,0.46)_100%)]" />
          <div className="absolute inset-[3%] opacity-75 mix-blend-screen" style={{ clipPath: shapeClipPath, background: 'conic-gradient(from 225deg, rgba(255,255,255,0.46), rgba(255,255,255,0.04) 28%, rgba(0,0,0,0.12) 46%, rgba(255,255,255,0.3) 68%, rgba(255,255,255,0.08))' }} />
          <div className="absolute inset-[7%] border border-white/35" style={{ clipPath: shapeClipPath }} />
          <div className="absolute inset-[15%] border border-black/25" style={{ clipPath: shapeClipPath }} />
          <div className="absolute left-[16%] top-[10%] h-[16%] w-[68%] rounded-full bg-white/40 blur-[1px]" />
          <div className="absolute left-[14%] top-[23%] h-[34%] w-[22%] bg-white/18" style={{ clipPath: 'polygon(0 0, 100% 18%, 72% 100%, 12% 84%)' }} />
          <div className="absolute right-[14%] top-[23%] h-[34%] w-[22%] bg-black/18" style={{ clipPath: 'polygon(0 18%, 100% 0, 88% 84%, 28% 100%)' }} />
          {power >= 3 && (
            <div className="absolute top-[13%] z-20 flex items-center justify-center gap-0.5">
              {(power >= 7 ? [0, 1, 2] : [0]).map(item => (
                <Star
                  key={item}
                  size={size === 'lg' ? 13 : size === 'sm' ? 7 : 10}
                  className={item === 1 ? 'text-yellow-100' : 'text-white/85'}
                  fill="currentColor"
                />
              ))}
            </div>
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
        </div>
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
        {!isLowestRank && (
          <span className={`absolute -right-1 top-1 flex ${classes.star} items-center justify-center rounded-full bg-white text-yellow-500 shadow-md ring-1 ring-yellow-100 dark:bg-gray-950 dark:ring-yellow-700/40`}>
            <Star size={size === 'lg' ? 12 : 9} fill="currentColor" />
          </span>
        )}
      </MotionTag>
    </MotionConfig>
  );
}

export default function RankBadge({ stats, compact = false, showProgress = true }) {
  const rank = stats?.rank || fallbackRank;
  const nextRank = stats?.nextRank;
  const palette = getRankPalette(rank);
  const power = getRankPower(rank);
  const showAura = power >= 4;
  const showEliteFrame = power >= 7;

  if (compact) {
    return (
      <div className={`rank-motion-zone inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${palette.soft} ${palette.text} ${palette.ring}`}>
        <Crown size={13} />
        {rank.shortName || rank.name}
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="never">
      <motion.div
        whileHover={power >= 3 ? { y: -3, scale: 1.005 } : undefined}
        className={`rank-motion-zone group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm ring-1 ring-black/5 dark:border-gray-800 dark:bg-gray-950 dark:ring-white/10 ${
          showEliteFrame ? 'shadow-xl shadow-black/10 dark:shadow-black/40' : ''
        }`}
      >
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${palette.gradient} opacity-80`} />
      {showAura && <div className={`pointer-events-none absolute -right-14 -top-16 h-36 w-36 rounded-full bg-gradient-to-br ${palette.gradient} opacity-10 blur-2xl dark:opacity-20`} />}
      {showEliteFrame && <div className={`pointer-events-none absolute inset-0 rounded-2xl ring-1 ${palette.ring}`} />}
      <div className="relative flex items-center gap-4">
        <RankEmblem rank={rank} size="md" animated />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-gray-500 dark:text-gray-400">
            <Sparkles size={14} className={power >= 5 ? 'text-yellow-500' : 'text-[#1877f2]'} />
            Profile Rank
          </p>
          <h3 className="mt-1 truncate text-xl font-black text-gray-950 dark:text-white">{rank.name}</h3>
          <p className="mt-1 text-sm font-semibold text-gray-500 dark:text-gray-400">
            {stats?.xp || 0} XP · {stats?.completedTasks || 0} completed tasks
          </p>
        </div>
      </div>

      {showProgress && (
        <div className="relative mt-4">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-500 dark:text-gray-400">
            <span>{nextRank ? `${stats?.xpToNext || 0} XP to ${nextRank.shortName}` : 'Max rank reached'}</span>
            <span>{stats?.progress ?? 0}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200/70 dark:bg-gray-800 dark:ring-gray-700/70">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${stats?.progress ?? 0}%` }}
              transition={{ duration: 0.75, ease: 'easeOut' }}
              className={`h-full rounded-full bg-gradient-to-r ${palette.gradient}`}
            />
          </div>
        </div>
      )}
      </motion.div>
    </MotionConfig>
  );
}
