module.exports = {
  minPlayers: 2,
  maxPlayers: 4,
  matchmakingTimeoutMs: 30000,
  reconnectWindowMs: 12000,
  disconnectGraceMs: 25000,
  countdownMs: 3000,
  lobbyHeartbeatMs: 2500,
  typing: {
    defaultDurationSeconds: 45,
    minDurationSeconds: 30,
    maxDurationSeconds: 60,
    sentenceCount: 44,
    impossibleWpm: 240,
    minimumFinishMs: 5000
  },
  reaction: {
    targetPoints: 5,
    minSignalDelayMs: 1400,
    maxSignalDelayMs: 3600,
    roundSettleMs: 900,
    impossibleReactionMs: 90
  },
  rewards: {
    winnerXp: 120,
    winnerCredits: 40,
    participantXp: 35,
    participantCredits: 10,
    secondPlaceXp: 20,
    secondPlaceCredits: 6,
    streakXp: 15,
    streakCredits: 5
  }
};
