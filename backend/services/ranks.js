const getId = (value) => String(value?._id || value?.id || value || '');

const RANK_TIERS = [
  { key: 'rookie', name: 'Rookie Operator', shortName: 'Rookie', minXp: 0 },
  { key: 'bronze', name: 'Bronze Contributor', shortName: 'Bronze', minXp: 150 },
  { key: 'silver', name: 'Silver Specialist', shortName: 'Silver', minXp: 360 },
  { key: 'gold', name: 'Gold Executor', shortName: 'Gold', minXp: 720 },
  { key: 'platinum', name: 'Platinum Lead', shortName: 'Platinum', minXp: 1250 },
  { key: 'epic', name: 'Epic Coordinator', shortName: 'Epic', minXp: 1900 },
  { key: 'mythic', name: 'Mythic Strategist', shortName: 'Mythic', minXp: 2850 },
  { key: 'legend', name: 'Legend Commander', shortName: 'Legend', minXp: 4200 },
  { key: 'dragon', name: 'Ascendant Project Lead', shortName: 'Ascendant', minXp: 5800 },
  { key: 'inferno', name: 'Immortal Architect', shortName: 'Immortal', minXp: 7800 },
  { key: 'celestial', name: 'Celestial Director', shortName: 'Celestial', minXp: 10200 }
];

const priorityXp = {
  low: 15,
  medium: 30,
  high: 55
};

const isCompletedEarly = (task) => {
  if (!task.completedAt || !task.dueDate) return false;
  return new Date(task.completedAt).getTime() <= new Date(task.dueDate).getTime();
};

const calculateTaskXp = (task) => {
  if (task.status !== 'done' || !task.assignedTo) return 0;

  let xp = 100;
  xp += priorityXp[task.priority] || priorityXp.medium;
  if (task.approvalStatus === 'approved') xp += 45;
  if (isCompletedEarly(task)) xp += 30;
  return xp;
};

const getTier = (xp) => {
  let current = RANK_TIERS[0];
  let next = null;

  for (let index = 0; index < RANK_TIERS.length; index += 1) {
    const tier = RANK_TIERS[index];
    if (xp >= tier.minXp) {
      current = tier;
      next = RANK_TIERS[index + 1] || null;
    }
  }

  const progress = next
    ? Math.min(100, Math.round(((xp - current.minXp) / (next.minXp - current.minXp)) * 100))
    : 100;

  return {
    current,
    next,
    progress,
    xpToNext: next ? Math.max(0, next.minXp - xp) : 0
  };
};

const buildRankStats = (tasks = [], userId) => {
  const targetId = getId(userId);
  const assignedTasks = tasks.filter(task => getId(task.assignedTo) === targetId);
  const completedTasks = assignedTasks.filter(task => task.status === 'done');
  const xp = completedTasks.reduce((sum, task) => sum + calculateTaskXp(task), 0);
  const tier = getTier(xp);

  return {
    xp,
    completedTasks: completedTasks.length,
    assignedTasks: assignedTasks.length,
    completionRate: assignedTasks.length ? Math.round((completedTasks.length / assignedTasks.length) * 100) : 0,
    highPriorityCompleted: completedTasks.filter(task => task.priority === 'high').length,
    approvedCompleted: completedTasks.filter(task => task.approvalStatus === 'approved').length,
    earlyCompleted: completedTasks.filter(isCompletedEarly).length,
    rank: tier.current,
    nextRank: tier.next,
    progress: tier.progress,
    xpToNext: tier.xpToNext
  };
};

const buildLeaderboard = (tasks = [], users = []) => {
  return users
    .map(user => {
      const stats = buildRankStats(tasks, user._id);
      const plainUser = typeof user.toObject === 'function' ? user.toObject() : user;
      return {
        user: {
          _id: plainUser._id,
          name: plainUser.name,
          email: plainUser.email,
          course: plainUser.course,
          avatar: plainUser.avatar
        },
        stats
      };
    })
    .sort((a, b) => {
      if (b.stats.xp !== a.stats.xp) return b.stats.xp - a.stats.xp;
      if (b.stats.completedTasks !== a.stats.completedTasks) return b.stats.completedTasks - a.stats.completedTasks;
      return String(a.user.name || '').localeCompare(String(b.user.name || ''));
    })
    .map((entry, index) => ({
      ...entry,
      position: index + 1
    }));
};

module.exports = {
  RANK_TIERS,
  buildLeaderboard,
  buildRankStats,
  calculateTaskXp
};
