const GAME_RANKS = [
  { key: 'recruit', name: 'Unranked', shortName: 'Unranked', minXp: 0 },
  { key: 'iron', name: 'Iron', shortName: 'Iron', minXp: 3500 },
  { key: 'bronze', name: 'Bronze', shortName: 'Bronze', minXp: 8500 },
  { key: 'silver', name: 'Silver', shortName: 'Silver', minXp: 16000 },
  { key: 'gold', name: 'Gold', shortName: 'Gold', minXp: 30000 },
  { key: 'platinum', name: 'Platinum', shortName: 'Platinum', minXp: 52000 },
  { key: 'diamond', name: 'Diamond', shortName: 'Diamond', minXp: 76000 },
  { key: 'epic', name: 'Master', shortName: 'Master', minXp: 110000 },
  { key: 'legend', name: 'Grandmaster', shortName: 'Grandmaster', minXp: 145000 },
  { key: 'apex', name: 'Challenger', shortName: 'Challenger', minXp: 180000 }
];

const getId = (value) => String(value?._id || value?.id || value || '');

const SEASON_LENGTH_MONTHS = 1;
const APEX_STAR_STEP = 25000;
const SEASON_SCORE_MULTIPLIER = 0.72;
const SEASON_RESET_FLOOR_MULTIPLIER = 0.72;
const APEX_STAR_RANKS = [];

const GAME_REWARDS = {
  recruit: { title: 'Unranked Crest', reward: 'Starter Games crest', accent: 'slate' },
  iron: { title: 'Iron Crest', reward: 'Iron profile plate', accent: 'stone' },
  bronze: { title: 'Bronze Crest', reward: 'Bronze profile frame', accent: 'orange' },
  silver: { title: 'Silver Crest', reward: 'Silver rank glow', accent: 'zinc' },
  gold: { title: 'Gold Banner', reward: 'Gold banner unlock', accent: 'yellow' },
  platinum: { title: 'Platinum Crest', reward: 'Premium crest unlock', accent: 'cyan' },
  diamond: { title: 'Diamond Edge', reward: 'Diamond border unlock', accent: 'sky' },
  epic: { title: 'Master Aura', reward: 'Animated rank aura', accent: 'fuchsia' },
  legend: { title: 'Grandmaster Aura', reward: 'Grandmaster glow aura', accent: 'violet' },
  apex: { title: 'Challenger Star Path', reward: 'Infinite Challenger stars', accent: 'emerald' }
};

const DEMOTION_MAP = {
  recruit: 'recruit',
  iron: 'recruit',
  bronze: 'iron',
  silver: 'bronze',
  gold: 'silver',
  platinum: 'gold',
  diamond: 'platinum',
  epic: 'diamond',
  legend: 'epic',
  apex: 'legend',
  mythic: 'legend',
  dragon: 'apex',
  inferno: 'apex',
  celestial: 'apex',
  'mythical-vanguard': 'apex',
  'mythical-legend': 'apex',
  'mythic-warden': 'apex',
  'mythic-guardian': 'apex',
  'mythic-ascendant': 'apex',
  'mythic-immortal': 'apex',
  'eternal-legend': 'apex',
  'radiant-overlord': 'apex',
  'celestial-monarch': 'apex',
  'sovereign-origin': 'apex'
};

const getApexStarRank = (stars = 0) => APEX_STAR_RANKS.find(rank => stars >= rank.minStars) || null;

const getApexStarStats = (xp = 0, starXp = xp) => {
  const apexRank = GAME_RANKS[GAME_RANKS.length - 1];
  if (xp < apexRank.minXp) {
    return {
      apexStars: 0,
      apexStarProgress: 0,
      apexStarXpToNext: apexRank.minXp - xp,
      glowLevel: 0
    };
  }

  const overflow = Math.max(0, starXp - apexRank.minXp);
  const apexStars = Math.floor(overflow / APEX_STAR_STEP) + 1;
  const remainder = overflow % APEX_STAR_STEP;

  return {
    apexStars,
    apexStarProgress: Math.round((remainder / APEX_STAR_STEP) * 100),
    apexStarXpToNext: APEX_STAR_STEP - remainder,
    glowLevel: Math.min(100, Math.floor(Math.log1p(apexStars) * 18)),
    maxApexStars: null,
    profileBorderTier: Math.min(10, Math.floor(apexStars / 10)),
    nextProfileBorderAt: (Math.floor(apexStars / 10) + 1) * 10
  };
};

const getGameRank = (xp = 0, starXp = xp) => {
  let current = GAME_RANKS[0];
  let next = null;

  for (let index = 0; index < GAME_RANKS.length; index += 1) {
    const rank = GAME_RANKS[index];
    if (xp >= rank.minXp) {
      current = rank;
      next = GAME_RANKS[index + 1] || null;
    }
  }

  const progress = next
    ? Math.min(100, Math.round(((xp - current.minXp) / (next.minXp - current.minXp)) * 100))
    : 100;

  const apexStarStats = getApexStarStats(xp, starXp);
  const starRank = current.key === 'apex' ? getApexStarRank(apexStarStats.apexStars) : null;
  const currentWithProgress = current.key === 'apex'
    ? { ...current, ...(starRank || {}), ...apexStarStats }
    : current;

  return {
    current: currentWithProgress,
    next,
    progress,
    xpToNext: next ? Math.max(0, next.minXp - xp) : 0,
    ...apexStarStats
  };
};

const getSeasonForDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getUTCFullYear();
  const seasonNumber = Math.floor(date.getUTCMonth() / SEASON_LENGTH_MONTHS) + 1;
  const startMonth = (seasonNumber - 1) * SEASON_LENGTH_MONTHS;
  const startDate = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, startMonth + SEASON_LENGTH_MONTHS, 1, 0, 0, 0, 0));

  return {
    id: `${year}-S${seasonNumber}`,
    label: `Season ${seasonNumber} ${year}`,
    seasonNumber,
    year,
    startsAt: startDate.toISOString(),
    endsAt: endDate.toISOString()
  };
};

const getPreviousSeason = (season = getSeasonForDate()) => {
  const start = new Date(season.startsAt);
  start.setUTCDate(start.getUTCDate() - 1);
  return getSeasonForDate(start);
};

const isInSeason = (session, season) => {
  const completedAt = new Date(session.completedAt || session.createdAt || session.startedAt || 0);
  return completedAt >= new Date(season.startsAt) && completedAt < new Date(season.endsAt);
};

const getRankByKey = (key) => GAME_RANKS.find(rank => rank.key === key) || GAME_RANKS[0];
const getRankPower = (rank) => {
  const index = GAME_RANKS.findIndex(item => item.key === rank?.key);
  const basePower = index >= 0 ? index : 0;
  const apexStars = rank?.key === 'apex' ? Math.max(0, Number(rank?.apexStars) || 0) : 0;
  return basePower + (apexStars / 10000);
};
const getHigherRank = (first, second) => (
  getRankPower(first) >= getRankPower(second) ? first : second
);
const getDemotedRank = (rank) => getRankByKey(DEMOTION_MAP[rank?.key] || 'recruit');
const getRewardForRank = (rank) => GAME_REWARDS[rank?.key] || GAME_REWARDS.recruit;

const summarizeCompletedSessions = (completed = []) => {
  const totalScore = completed.reduce((sum, session) => sum + (session.score || 0), 0);
  const highScore = completed.reduce((best, session) => Math.max(best, session.score || 0), 0);
  const totalCorrect = completed.reduce((sum, session) => sum + (session.correctCount || 0), 0);
  const totalQuestions = completed.reduce((sum, session) => sum + (session.totalCount || 0), 0);
  const maxStreak = completed.reduce((best, session) => Math.max(best, session.maxStreak || 0), 0);
  const bestAccuracy = completed.reduce((best, session) => {
    const sessionAccuracy = typeof session.accuracy === 'number' && session.accuracy > 0
      ? session.accuracy
      : session.totalCount ? Math.round(((session.correctCount || 0) / session.totalCount) * 100) : 0;
    return Math.max(best, sessionAccuracy);
  }, 0);
  const bestWpm = completed.reduce((best, session) => Math.max(best, session.wpm || 0), 0);
  const fastestMs = completed
    .filter(session => session.elapsedMs > 0)
    .reduce((best, session) => Math.min(best, session.elapsedMs), Number.POSITIVE_INFINITY);
  const rank = getGameRank(highScore, totalScore);

  return {
    xp: highScore,
    lifetimeScore: totalScore,
    highScore,
    totalPlays: completed.length,
    averageScore: completed.length ? Math.round(totalScore / completed.length) : 0,
    accuracy: totalQuestions ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
    bestAccuracy,
    bestWpm,
    fastestMs: Number.isFinite(fastestMs) ? fastestMs : 0,
    maxStreak,
    rank: rank.current,
    nextRank: rank.next,
    progress: rank.progress,
    xpToNext: rank.xpToNext,
    apexStars: rank.apexStars,
    apexStarProgress: rank.apexStarProgress,
    apexStarXpToNext: rank.apexStarXpToNext,
    glowLevel: rank.glowLevel,
    maxApexStars: rank.maxApexStars,
    profileBorderTier: rank.profileBorderTier,
    nextProfileBorderAt: rank.nextProfileBorderAt
  };
};

const buildGameStats = (sessions = [], options = {}) => {
  const completed = sessions.filter(session => session.completedAt);
  const season = getSeasonForDate(options.now || new Date());
  const previousSeason = getPreviousSeason(season);
  const seasonCompleted = completed.filter(session => isInSeason(session, season));
  const previousSeasonCompleted = completed.filter(session => isInSeason(session, previousSeason));

  const seasonStats = summarizeCompletedSessions(seasonCompleted);
  const previousStats = summarizeCompletedSessions(previousSeasonCompleted);
  const lifetimeStats = summarizeCompletedSessions(completed);
  const resetRank = previousStats.totalPlays ? getDemotedRank(previousStats.rank) : GAME_RANKS[0];
  const seasonRankScore = Math.max(
    Math.floor(seasonStats.lifetimeScore * SEASON_SCORE_MULTIPLIER),
    Math.floor(resetRank.minXp * SEASON_RESET_FLOOR_MULTIPLIER)
  );
  const seasonTotalScore = seasonStats.lifetimeScore;
  const rank = getGameRank(seasonRankScore, seasonRankScore);
  const highestRank = getHigherRank(lifetimeStats.rank, rank.current);

  return {
    ...seasonStats,
    xp: seasonRankScore,
    seasonScore: seasonRankScore,
    rank: rank.current,
    nextRank: rank.next,
    progress: rank.progress,
    xpToNext: rank.xpToNext,
    seasonTotalScore,
    apexStars: rank.apexStars,
    apexStarProgress: rank.apexStarProgress,
    apexStarXpToNext: rank.apexStarXpToNext,
    glowLevel: rank.glowLevel,
    maxApexStars: rank.maxApexStars,
    profileBorderTier: rank.profileBorderTier,
    nextProfileBorderAt: rank.nextProfileBorderAt,
    highestRank,
    highestScore: Math.max(lifetimeStats.highScore, seasonRankScore),
    lifetimeScore: lifetimeStats.lifetimeScore,
    lifetimePlays: lifetimeStats.totalPlays,
    previousSeasonRank: previousStats.rank,
    previousSeasonHighScore: previousStats.highScore,
    resetRank,
    season,
    previousSeason,
    rewards: {
      current: getRewardForRank(rank.current),
      previous: getRewardForRank(previousStats.rank)
    }
  };
};

const buildGameLeaderboard = (sessions = []) => {
  const grouped = new Map();

  sessions
    .filter(session => session.completedAt && session.userId)
    .forEach(session => {
      const userId = getId(session.userId);
      if (!grouped.has(userId)) {
        grouped.set(userId, {
          user: session.userId,
          sessions: []
        });
      }
      grouped.get(userId).sessions.push(session);
    });

  return Array.from(grouped.values())
    .map(entry => {
      const stats = buildGameStats(entry.sessions);
      const plainUser = typeof entry.user?.toObject === 'function' ? entry.user.toObject() : entry.user;
      return {
        user: {
          _id: plainUser?._id,
          name: plainUser?.name,
          email: plainUser?.email,
          course: plainUser?.course,
          avatar: plainUser?.avatar,
          // The dashboard frame is only a visual cue; the server remains the
          // source of truth for developer access. Preserve this public flag
          // after reducing populated user data for the leaderboard.
          isDeveloper: Boolean(plainUser?.isDeveloper)
        },
        stats
      };
    })
    .filter(entry => entry.stats.totalPlays > 0)
    .sort((a, b) => {
      if (b.stats.seasonScore !== a.stats.seasonScore) return b.stats.seasonScore - a.stats.seasonScore;
      if (b.stats.highScore !== a.stats.highScore) return b.stats.highScore - a.stats.highScore;
      if (b.stats.bestAccuracy !== a.stats.bestAccuracy) return b.stats.bestAccuracy - a.stats.bestAccuracy;
      if (b.stats.bestWpm !== a.stats.bestWpm) return b.stats.bestWpm - a.stats.bestWpm;
      if (a.stats.fastestMs !== b.stats.fastestMs) return (a.stats.fastestMs || Number.MAX_SAFE_INTEGER) - (b.stats.fastestMs || Number.MAX_SAFE_INTEGER);
      return String(a.user.name || '').localeCompare(String(b.user.name || ''));
    })
    .map((entry, index) => ({
      ...entry,
      position: index + 1
    }));
};

module.exports = {
  GAME_RANKS,
  GAME_REWARDS,
  buildGameLeaderboard,
  buildGameStats,
  getSeasonForDate
};
