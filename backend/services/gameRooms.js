const crypto = require('crypto');
const config = require('./gameMultiplayerConfig');

const rooms = new Map();
const roomCodes = new Map();
const VALID_GAME_TYPES = new Set(['typing-race', 'reaction-tap']);
const RESULT_SORTERS = {
  'typing-race': (a, b) => (b.result?.score || 0) - (a.result?.score || 0),
  'reaction-tap': (a, b) => {
    const pointDiff = (b.result?.playerPoints || 0) - (a.result?.playerPoints || 0);
    if (pointDiff) return pointDiff;
    return (a.result?.averageReactionMs || 99999) - (b.result?.averageReactionMs || 99999);
  }
};

const nowMs = () => Date.now();

const makeId = () => crypto.randomUUID();

const makeRoomCode = () => {
  let code = '';
  do {
    code = crypto.randomBytes(3).toString('hex').toUpperCase();
  } while (roomCodes.has(code));
  return code;
};

const safeUser = (user = {}) => {
  const id = String(user._id || user.id || user.userId || '');
  return {
    userId: id,
    name: String(user.name || user.email || 'Player').slice(0, 60),
    email: String(user.email || ''),
    avatar: String(user.avatar || '')
  };
};

const activePlayers = (room) => room.players
  .filter(player => player.status !== 'disconnected' && !player.leftAt);

const playerIsEligible = (player) => (
  player
  && player.status !== 'disconnected'
  && !player.leftAt
  && !player.disqualified
);

const getPlayer = (room, userId) => room.players.find(player => player.userId === String(userId));

const refreshConnectionStatuses = (room) => {
  const now = nowMs();
  room.players.forEach(player => {
    if (player.leftAt || room.status === 'finished') return;
    const age = now - player.lastSeenAt;
    if (age > config.disconnectGraceMs) {
      player.status = 'disconnected';
      player.ready = false;
      player.disconnectedAt = player.disconnectedAt || now;
      if (room.status === 'playing' && !player.result) {
        player.disqualified = true;
        player.flags = [...new Set([...(player.flags || []), 'disconnected'])];
      }
    } else if (age > config.reconnectWindowMs) {
      player.status = 'reconnecting';
    } else {
      player.status = 'online';
      player.disconnectedAt = null;
    }
  });

  if (!getPlayer(room, room.hostId) || !playerIsEligible(getPlayer(room, room.hostId))) {
    const nextHost = activePlayers(room)[0];
    room.hostId = nextHost?.userId || '';
  }
};

const randomSignalDelay = () => (
  config.reaction.minSignalDelayMs
  + crypto.randomInt(config.reaction.maxSignalDelayMs - config.reaction.minSignalDelayMs + 1)
);

const randomTarget = () => ({
  x: 14 + crypto.randomInt(73),
  y: 18 + crypto.randomInt(65),
  size: 70 + crypto.randomInt(27),
  tone: ['#0b57d0', '#0891b2', '#16a34a', '#f59e0b'][crypto.randomInt(4)]
});

const scheduleReactionRound = (room, baseTime = nowMs()) => {
  room.reaction = {
    roundNumber: (room.reaction?.roundNumber || 0) + 1,
    phase: 'waiting',
    signalAt: baseTime + randomSignalDelay(),
    nextRoundAt: null,
    winnerId: '',
    target: randomTarget(),
    tappedUserIds: [],
    falseStartedUserIds: []
  };
};

const sortPlacements = (room) => {
  const sorter = RESULT_SORTERS[room.gameType] || RESULT_SORTERS['typing-race'];
  const ranked = room.players
    .filter(player => player.result && !player.result.disqualified)
    .sort(sorter);

  ranked.forEach((player, index) => {
    player.result.rank = index + 1;
    player.result.totalPlayers = ranked.length;
  });

  room.players.forEach(player => {
    if (!player.result) return;
    if (player.result.disqualified) {
      player.result.rank = null;
      player.result.totalPlayers = ranked.length;
    }
  });
};

const finishRoom = (room) => {
  if (room.status === 'finished') return room;

  room.status = 'finished';
  room.finishedAt = nowMs();

  room.players.forEach(player => {
    if (player.result) return;

    if (room.gameType === 'reaction-tap') {
      const reactions = player.reactionTimes || [];
      const bestReactionMs = reactions.length ? Math.min(...reactions) : 0;
      const averageReactionMs = reactions.length
        ? Math.round(reactions.reduce((sum, value) => sum + value, 0) / reactions.length)
        : 0;
      const disqualified = !playerIsEligible(player) || (player.falseStarts || 0) > 0;
      player.result = {
        userId: player.userId,
        gameType: room.gameType,
        score: Math.max(0, (player.points || 0) * 650 + Math.max(0, 700 - (averageReactionMs || 700))),
        playerPoints: player.points || 0,
        targetPoints: config.reaction.targetPoints,
        bestReactionMs,
        averageReactionMs,
        falseStarts: player.falseStarts || 0,
        accuracy: Math.round(((player.points || 0) / Math.max(1, room.reactionRounds || 1)) * 100),
        elapsedMs: Math.max(1000, (room.finishedAt || nowMs()) - (room.startedAt || room.finishedAt || nowMs())),
        disqualified,
        flags: [...new Set([...(player.flags || []), ...((player.falseStarts || 0) ? ['false-start'] : [])])]
      };
    } else {
      player.result = {
        userId: player.userId,
        gameType: room.gameType,
        score: 0,
        accuracy: 0,
        wpm: 0,
        correctCount: 0,
        totalCount: room.sentences?.length || 1,
        maxStreak: 0,
        elapsedMs: Math.max(1000, (room.finishedAt || nowMs()) - (room.startedAt || room.finishedAt || nowMs())),
        disqualified: !playerIsEligible(player),
        flags: player.flags || []
      };
    }
  });

  sortPlacements(room);
  return room;
};

const maybeAdvanceRoom = (room) => {
  if (!room) return null;
  refreshConnectionStatuses(room);
  const now = nowMs();

  if (['lobby', 'searching'].includes(room.status)) {
    const waitingMs = now - room.createdAt;
    room.matchmakingMessage = waitingMs >= config.matchmakingTimeoutMs
      ? 'Still searching for players. You can wait or cancel matchmaking.'
      : activePlayers(room).length < config.minPlayers
        ? 'Waiting for more players...'
        : 'Players found. Ready up to start.';
  }

  if (room.status === 'countdown' && now >= room.startsAt) {
    room.status = 'playing';
    room.startedAt = room.startsAt;
    room.players.forEach(player => {
      player.ready = true;
      player.progress = 0;
    });
    if (room.gameType === 'reaction-tap') {
      room.reactionRounds = 0;
      scheduleReactionRound(room, room.startedAt);
    }
  }

  if (room.status === 'playing' && room.gameType === 'typing-race') {
    const maxEndAt = (room.startedAt || now) + ((room.durationSeconds || config.typing.defaultDurationSeconds) * 1000) + 1500;
    const active = activePlayers(room);
    const allDone = active.length >= config.minPlayers && active.every(player => player.result || player.disqualified);
    if (now >= maxEndAt || allDone) finishRoom(room);
  }

  if (room.status === 'playing' && room.gameType === 'reaction-tap') {
    if (room.reaction?.phase === 'settled' && room.reaction.nextRoundAt && now >= room.reaction.nextRoundAt) {
      scheduleReactionRound(room, now);
    }
    const active = activePlayers(room);
    if (active.length < config.minPlayers || active.every(player => player.result || player.disqualified)) {
      finishRoom(room);
    }
  }

  room.updatedAt = now;
  return room;
};

const createPlayer = (user, host = false) => ({
  ...safeUser(user),
  host,
  ready: false,
  status: 'online',
  joinedAt: nowMs(),
  lastSeenAt: nowMs(),
  disconnectedAt: null,
  leftAt: null,
  progress: 0,
  result: null,
  points: 0,
  falseStarts: 0,
  reactionTimes: [],
  disqualified: false,
  flags: []
});

const createRoom = ({ gameType, user, privateRoom = false, content = {}, players = [] }) => {
  if (!VALID_GAME_TYPES.has(gameType)) {
    const error = new Error('Unsupported multiplayer game');
    error.status = 400;
    throw error;
  }

  const id = makeId();
  const code = makeRoomCode();
  const initialPlayers = players.length ? players : [user];
  const roomPlayers = initialPlayers.slice(0, config.maxPlayers).map((playerUser, index) => createPlayer(playerUser, index === 0));
  const room = {
    id,
    code,
    gameType,
    privateRoom,
    status: 'lobby',
    createdAt: nowMs(),
    updatedAt: nowMs(),
    startsAt: null,
    startedAt: null,
    finishedAt: null,
    hostId: roomPlayers[0]?.userId || '',
    players: roomPlayers,
    rematchVotes: [],
    rematchRoomId: '',
    persistedAt: null,
    matchmakingMessage: 'Waiting for more players...',
    typingMode: content.typingMode || 'english',
    durationSeconds: content.durationSeconds || config.typing.defaultDurationSeconds,
    sentences: Array.isArray(content.sentences) ? content.sentences : [],
    prompt: content.prompt || ''
  };

  rooms.set(id, room);
  roomCodes.set(code, id);
  return maybeAdvanceRoom(room);
};

const joinRoom = (room, user) => {
  maybeAdvanceRoom(room);
  if (!room) {
    const error = new Error('Match no longer exists');
    error.status = 404;
    throw error;
  }
  if (['countdown', 'playing', 'finished'].includes(room.status)) {
    const error = new Error('This match has already started. Please join another match.');
    error.status = 409;
    throw error;
  }

  const safe = safeUser(user);
  const existing = getPlayer(room, safe.userId);
  if (existing) {
    existing.lastSeenAt = nowMs();
    existing.status = 'online';
    existing.leftAt = null;
    return maybeAdvanceRoom(room);
  }

  if (activePlayers(room).length >= config.maxPlayers) {
    const error = new Error('This match is full. Please join another match.');
    error.status = 409;
    throw error;
  }

  room.players.push(createPlayer(safe, !room.hostId));
  if (!room.hostId) room.hostId = safe.userId;
  return maybeAdvanceRoom(room);
};

const quickMatch = ({ gameType, user, content }) => {
  const existing = [...rooms.values()].find(room => {
    maybeAdvanceRoom(room);
    return room.gameType === gameType
      && !room.privateRoom
      && ['lobby', 'searching'].includes(room.status)
      && activePlayers(room).length < config.maxPlayers;
  });

  if (existing) return joinRoom(existing, user);
  return createRoom({ gameType, user, privateRoom: false, content });
};

const joinByCode = ({ code, user }) => {
  const normalized = String(code || '').trim().toUpperCase();
  const roomId = roomCodes.get(normalized);
  if (!roomId) {
    const error = new Error('Match no longer exists');
    error.status = 404;
    throw error;
  }
  return joinRoom(rooms.get(roomId), user);
};

const getRoom = (roomId) => maybeAdvanceRoom(rooms.get(String(roomId)));

const touchRoom = (roomId, userId) => {
  const room = getRoom(roomId);
  const player = room && getPlayer(room, userId);
  if (player) {
    player.lastSeenAt = nowMs();
    if (player.status !== 'disconnected') player.status = 'online';
  }
  return maybeAdvanceRoom(room);
};

const canStartRoom = (room, forceStart = false) => {
  const active = activePlayers(room);
  if (active.length < config.minPlayers) return false;
  if (forceStart) return active.length === config.minPlayers || active.every(player => player.ready);
  return active.every(player => player.ready);
};

const startCountdown = (room) => {
  if (!['lobby', 'searching'].includes(room.status)) return room;
  if (!canStartRoom(room)) {
    const error = new Error('Not enough ready players');
    error.status = 400;
    throw error;
  }
  room.status = 'countdown';
  room.startsAt = nowMs() + config.countdownMs;
  room.matchmakingMessage = 'Match starting...';
  return maybeAdvanceRoom(room);
};

const setReady = ({ roomId, userId, ready }) => {
  const room = getRoom(roomId);
  if (!room) {
    const error = new Error('Match no longer exists');
    error.status = 404;
    throw error;
  }
  if (!['lobby', 'searching'].includes(room.status)) return room;
  const player = getPlayer(room, userId);
  if (!player) {
    const error = new Error('Failed to join match');
    error.status = 404;
    throw error;
  }
  player.ready = Boolean(ready);
  player.lastSeenAt = nowMs();
  if (canStartRoom(room)) return startCountdown(room);
  return maybeAdvanceRoom(room);
};

const hostStart = ({ roomId, userId }) => {
  const room = getRoom(roomId);
  if (!room) {
    const error = new Error('Match no longer exists');
    error.status = 404;
    throw error;
  }
  if (room.hostId !== String(userId)) {
    const error = new Error('Only the host can start now');
    error.status = 403;
    throw error;
  }
  const active = activePlayers(room);
  if (active.length > config.minPlayers && !active.every(player => player.ready)) {
    const error = new Error('All joined players must be ready before the host can start.');
    error.status = 400;
    throw error;
  }
  if (!canStartRoom(room, true)) {
    const error = new Error('Not enough players');
    error.status = 400;
    throw error;
  }
  activePlayers(room).forEach(player => { player.ready = true; });
  return startCountdown(room);
};

const leaveRoom = ({ roomId, userId }) => {
  const room = getRoom(roomId);
  if (!room) return null;
  const player = getPlayer(room, userId);
  if (!player) return room;
  if (room.status === 'playing') {
    player.status = 'disconnected';
    player.leftAt = nowMs();
    player.disqualified = true;
    player.flags = [...new Set([...(player.flags || []), 'disconnected'])];
  } else {
    player.leftAt = nowMs();
    player.status = 'disconnected';
    player.ready = false;
  }
  refreshConnectionStatuses(room);
  if (activePlayers(room).length === 0) {
    rooms.delete(room.id);
    roomCodes.delete(room.code);
  }
  return maybeAdvanceRoom(room);
};

const updateTypingProgress = ({ roomId, userId, progress }) => {
  const room = getRoom(roomId);
  const player = room && getPlayer(room, userId);
  if (!player || room.status !== 'playing' || room.gameType !== 'typing-race') return room;
  player.progress = Math.min(1, Math.max(0, Number(progress) || 0));
  player.lastSeenAt = nowMs();
  return maybeAdvanceRoom(room);
};

const submitTypingResult = ({ roomId, userId, result }) => {
  const room = getRoom(roomId);
  if (!room) {
    const error = new Error('Match no longer exists');
    error.status = 404;
    throw error;
  }
  if (room.gameType !== 'typing-race' || room.status !== 'playing') {
    const error = new Error('Game already ended');
    error.status = 400;
    throw error;
  }
  const player = getPlayer(room, userId);
  if (!player) {
    const error = new Error('Failed to join match');
    error.status = 404;
    throw error;
  }
  if (player.result) return maybeAdvanceRoom(room);

  const flags = [...new Set([...(result.flags || []), ...(player.flags || [])])];
  const disqualified = Boolean(result.disqualified || player.disqualified || flags.includes('impossible-wpm') || flags.includes('instant-finish'));
  player.progress = 1;
  player.result = {
    userId: player.userId,
    gameType: room.gameType,
    ...result,
    disqualified,
    flags
  };
  player.disqualified = disqualified;
  return maybeAdvanceRoom(room);
};

const tapReaction = ({ roomId, userId }) => {
  const room = getRoom(roomId);
  if (!room) {
    const error = new Error('Match no longer exists');
    error.status = 404;
    throw error;
  }
  if (room.gameType !== 'reaction-tap' || room.status !== 'playing') {
    const error = new Error('Game already ended');
    error.status = 400;
    throw error;
  }

  const player = getPlayer(room, userId);
  if (!player || !playerIsEligible(player)) {
    const error = new Error('Connection lost');
    error.status = 409;
    throw error;
  }

  const round = room.reaction;
  const now = nowMs();
  if (!round) return maybeAdvanceRoom(room);

  player.lastSeenAt = now;

  if (now < round.signalAt) {
    if (!round.falseStartedUserIds.includes(player.userId)) {
      round.falseStartedUserIds.push(player.userId);
      player.falseStarts += 1;
      player.points = Math.max(0, player.points - 1);
      player.flags = [...new Set([...(player.flags || []), 'false-start'])];
    }
    return maybeAdvanceRoom(room);
  }

  if (round.phase === 'settled' || round.winnerId || round.tappedUserIds.includes(player.userId)) {
    return maybeAdvanceRoom(room);
  }

  const reactionMs = Math.max(1, now - round.signalAt);
  round.tappedUserIds.push(player.userId);
  round.winnerId = player.userId;
  round.phase = 'settled';
  round.nextRoundAt = now + config.reaction.roundSettleMs;
  player.points += 1;
  player.reactionTimes.push(reactionMs);
  room.reactionRounds = (room.reactionRounds || 0) + 1;

  if (player.points >= config.reaction.targetPoints) {
    finishRoom(room);
  }

  return maybeAdvanceRoom(room);
};

const voteRematch = ({ roomId, user, content }) => {
  const room = getRoom(roomId);
  if (!room) {
    const error = new Error('Match no longer exists');
    error.status = 404;
    throw error;
  }
  if (room.status !== 'finished') {
    const error = new Error('Rematch is available after results');
    error.status = 400;
    throw error;
  }

  const safe = safeUser(user);
  if (!room.players.some(player => player.userId === safe.userId)) {
    const error = new Error('Failed to join match');
    error.status = 404;
    throw error;
  }

  if (!room.rematchVotes.includes(safe.userId)) room.rematchVotes.push(safe.userId);
  if (!room.rematchRoomId && room.rematchVotes.length >= config.minPlayers) {
    const acceptedUsers = room.rematchVotes
      .map(userId => room.players.find(player => player.userId === userId))
      .filter(Boolean)
      .map(player => ({
        _id: player.userId,
        name: player.name,
        email: player.email,
        avatar: player.avatar
      }));
    const newRoom = createRoom({
      gameType: room.gameType,
      user: acceptedUsers[0],
      privateRoom: true,
      content,
      players: acceptedUsers
    });
    room.rematchRoomId = newRoom.id;
  }

  return maybeAdvanceRoom(room);
};

const serializeRoom = (room, viewerId = '') => {
  const current = maybeAdvanceRoom(room);
  if (!current) return null;
  const now = nowMs();
  const viewer = getPlayer(current, viewerId);
  const players = current.players
    .filter(player => !player.leftAt || current.status !== 'finished')
    .map(player => ({
      userId: player.userId,
      name: player.name,
      avatar: player.avatar,
      isHost: player.userId === current.hostId,
      ready: Boolean(player.ready),
      status: player.status,
      joinedAt: player.joinedAt,
      progress: player.progress || 0,
      points: player.points || 0,
      falseStarts: player.falseStarts || 0,
      result: player.result || null
    }));

  const reaction = current.reaction ? {
    roundNumber: current.reaction.roundNumber,
    phase: current.reaction.phase,
    signalAt: current.reaction.signalAt,
    serverNow: now,
    target: now >= current.reaction.signalAt && current.reaction.phase !== 'settled'
      ? current.reaction.target
      : null,
    winnerId: current.reaction.winnerId || '',
    nextRoundAt: current.reaction.nextRoundAt || null
  } : null;

  return {
    id: current.id,
    code: current.code,
    gameType: current.gameType,
    privateRoom: current.privateRoom,
    status: current.status,
    hostId: current.hostId,
    me: viewer ? {
      userId: viewer.userId,
      isHost: viewer.userId === current.hostId,
      ready: Boolean(viewer.ready),
      status: viewer.status,
      result: viewer.result || null
    } : null,
    players,
    minPlayers: config.minPlayers,
    maxPlayers: config.maxPlayers,
    createdAt: current.createdAt,
    serverNow: now,
    startsAt: current.startsAt,
    startedAt: current.startedAt,
    finishedAt: current.finishedAt,
    matchmakingTimeoutMs: config.matchmakingTimeoutMs,
    matchmakingMessage: current.matchmakingMessage,
    prompt: current.prompt,
    sentences: current.sentences,
    typingMode: current.typingMode,
    durationSeconds: current.durationSeconds,
    reaction,
    targetPoints: config.reaction.targetPoints,
    rematchVotes: current.rematchVotes,
    rematchRoomId: current.rematchRoomId,
    persistedAt: current.persistedAt
  };
};

module.exports = {
  VALID_GAME_TYPES,
  config,
  createRoom,
  quickMatch,
  joinByCode,
  getRoom,
  touchRoom,
  setReady,
  hostStart,
  leaveRoom,
  updateTypingProgress,
  submitTypingResult,
  tapReaction,
  voteRematch,
  serializeRoom
};
