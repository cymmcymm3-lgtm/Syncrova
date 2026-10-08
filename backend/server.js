const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const auth = require('./middleware/auth');
const User = require('./models/User');
const { getAuthUserState } = require('./utils/authSessionCache');
const {
  getConfiguredMongoDatabaseName,
  withConfiguredMongoDatabaseName
} = require('./utils/mongo');

const envFiles = [
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(process.cwd(), '.env')
];

Array.from(new Set(envFiles)).forEach(envFile => {
  dotenv.config({ path: envFile, quiet: true });
});

const isProduction = process.env.NODE_ENV === 'production';
const allowPreviewOrigins = process.env.ALLOW_PREVIEW_ORIGINS === 'true' || !isProduction;

const validateRuntimeEnv = () => {
  const missing = ['JWT_SECRET'].filter(key => !process.env[key]);
  if (!missing.length) return;

  const message = `Missing required environment variable(s): ${missing.join(', ')}`;
  if (isProduction) {
    throw new Error(message);
  }

  console.warn(`${message}. Auth endpoints will fail until configured.`);
};

validateRuntimeEnv();

const { serveR2Object } = require('./services/storage');
const appUpdateRouter = require('./routes/appUpdate');

const app = express();
app.set('trust proxy', 1);

const DEFAULT_CLIENT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5002',
  'http://127.0.0.1:5002'
];

const configuredClientOrigins = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([
  ...DEFAULT_CLIENT_ORIGINS,
  ...configuredClientOrigins
]));

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TUNNEL_HOST_SUFFIXES = [
  '.trycloudflare.com',
  '.ngrok-free.app',
  '.ngrok.io',
  '.loca.lt',
  '.localtunnel.me',
  '.localhost.run',
  '.serveo.net',
  '.tunnelmole.net',
  '.devtunnels.ms'
];

const wildcardOriginPatterns = allowedOrigins
  .filter(origin => origin.includes('*') && origin !== '*')
  .map(origin => new RegExp(`^${origin.split('*').map(escapeRegex).join('.*')}$`));

const isTunnelOrigin = (origin) => {
  try {
    const { hostname } = new URL(origin);
    return TUNNEL_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix));
  } catch {
    return false;
  }
};

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  if (allowPreviewOrigins && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
  if (allowPreviewOrigins && isTunnelOrigin(origin)) return true;
  return wildcardOriginPatterns.some(pattern => pattern.test(origin));
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
};

// CORS Configuration
app.use(cors(corsOptions));

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '1mb' }));

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 80,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { msg: 'Too many auth attempts. Please try again later.' }
});

const passwordResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { msg: 'Too many password reset attempts. Please try again later.' }
});

const sensitiveAccountRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { msg: 'Too many sensitive account attempts. Please try again later.' }
});

const developerAccessRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { msg: 'Too many developer access attempts. Please try again later.' }
});

app.use('/api/auth/login', authRateLimiter);
app.use('/api/auth/register', authRateLimiter);
app.use('/api/auth/forgot-password', passwordResetRateLimiter);
app.use('/api/auth/reset-password', passwordResetRateLimiter);
app.use('/api/auth/admin/password-reset', sensitiveAccountRateLimiter);
app.use('/api/users/password', sensitiveAccountRateLimiter);
app.use('/api/games/developers/access', developerAccessRateLimiter);

const setApkNoCacheHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
};

const redirectOutdatedReleaseApk = (req, res, next) => {
  const requestPath = String(req.originalUrl || req.url || req.path || '').split('?')[0];
  const requestedFile = path.basename(requestPath);
  if (!/^syncrova-.+\.apk$/i.test(requestedFile)) return next();

  const releaseDownload = appUpdateRouter.getReleaseDownload?.();
  const releaseVersion = releaseDownload?.releaseInfo?.versionName;
  const currentFile = appUpdateRouter.getReleaseApkFileName?.(releaseVersion);
  if (!currentFile) return next();

  const requested = requestedFile.toLowerCase();
  const current = currentFile.toLowerCase();
  const messengerLatestFile = 'syncrova-messenger-latest.apk';

  if (requested.startsWith('syncrova-messenger-')) {
    if (requested === messengerLatestFile) return next();

    setApkNoCacheHeaders(res);
    return res.redirect(302, `/releases/${messengerLatestFile}`);
  }

  if (requested === current || requested === 'syncrova-latest.apk') return next();

  setApkNoCacheHeaders(res);
  return res.redirect(302, releaseDownload.apkUrl || `/releases/${currentFile}`);
};

app.head(/^\/uploads\/r2\/(.+)$/, serveR2Object);
app.get(/^\/uploads\/r2\/(.+)$/, serveR2Object);
app.use(/^\/(?:uploads\/)?releases\/syncrova-[^/]+\.apk$/i, redirectOutdatedReleaseApk);
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  etag: true,
  immutable: true,
  maxAge: '30d',
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.setHeader('Accept-Ranges', 'bytes');
  }
}));
app.use('/releases', express.static(path.join(__dirname, 'public', 'releases'), {
  etag: true,
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.apk')) {
      setApkNoCacheHeaders(res);
    }
  }
}));

app.get('/api/ping', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    databaseReadyState: mongoose.connection.readyState
  });
});

// Deployment health checks must wait for the database. A process that merely
// listens on its HTTP port is not ready to serve authenticated application data.
app.get('/api/ready', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({
    ok: databaseReady,
    database: databaseReady ? 'connected' : 'connecting'
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/files', require('./routes/files'));
app.use('/api/users', require('./routes/users'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/calls', require('./routes/calls'));
app.use('/api/marketplace', require('./routes/marketplace'));
app.use('/api/group-chat', require('./routes/groupChat'));
app.use('/api/memories', require('./routes/memories'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/games', require('./routes/games'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/stories', require('./routes/stories'));
app.use('/api/reels', require('./routes/reels'));
app.use('/api/app', appUpdateRouter);
app.use('/api/assistant', require('./routes/assistant'));
app.use('/api/search', require('./routes/search'));
app.use('/api/saved', require('./routes/saved'));
app.use('/api/health', require('./routes/health'));

const notifications = require('./routes/notifications');
app.use('/api/notifications', notifications.router);

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/syncrova';
const mongoMaxPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE || 20);
const mongoMinPoolSize = Number(process.env.MONGO_MIN_POOL_SIZE || 2);
const mongoAutoIndex = process.env.NODE_ENV !== 'production';
const mongoRetryMs = Number(process.env.MONGO_RETRY_MS || 5000);
const mongoRetryEnabled = process.env.MONGO_RETRY !== 'false';

const validateMongoTarget = () => {
  if (!isProduction) return;

  const databaseName = getConfiguredMongoDatabaseName(MONGODB_URI);
  if (!databaseName) {
    throw new Error('Set MONGODB_DB_NAME or include a database name in MONGODB_URI, for example: mongodb+srv://.../IntegrativeProgramming');
  }
};

const getMongoTargetLabel = (uri = '') => {
  if (/mongodb\.net/i.test(uri)) return 'MongoDB Atlas';
  if (/localhost|127\.0\.0\.1/i.test(uri)) return 'local MongoDB';
  return 'MongoDB';
};

validateMongoTarget();

const connectMongo = (attempt = 1) => mongoose.connect(MONGODB_URI, withConfiguredMongoDatabaseName(MONGODB_URI, {
  maxPoolSize: Number.isFinite(mongoMaxPoolSize) ? mongoMaxPoolSize : 20,
  minPoolSize: Number.isFinite(mongoMinPoolSize) ? mongoMinPoolSize : 2,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  autoIndex: mongoAutoIndex
}))
  .then(() => console.log(`${getMongoTargetLabel(MONGODB_URI)} connected to ${mongoose.connection.name}`))
  .catch(err => {
    console.error(`${getMongoTargetLabel(MONGODB_URI)} connection error: ${err.message || err}`);
    if (!mongoRetryEnabled) return;

    const retryDelay = Number.isFinite(mongoRetryMs) && mongoRetryMs > 0 ? mongoRetryMs : 5000;
    console.error(`Retrying database connection in ${Math.round(retryDelay / 1000)}s (attempt ${attempt + 1})`);
    const retryTimer = setTimeout(() => connectMongo(attempt + 1), retryDelay);
    retryTimer.unref?.();
  });

connectMongo();

// Create HTTP server
const server = http.createServer(app);

// Socket.io
const io = socketIo(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  perMessageDeflate: false
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

app.set('io', io);

// Store online users. One user can have multiple tabs/devices open.
const onlineUsers = new Map();
const activeCallSessions = new Map();
const CALL_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const TERMINAL_CALL_EVENTS = new Set(['call:end', 'call:reject', 'call:busy']);

const normalizeId = (value) => String(value?._id || value?.id || value || '');
const normalizeCallId = (value) => String(value || '').trim();

const userExists = async (userId, tokenIssuedAt = 0) => {
  const id = normalizeId(userId);
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const userState = await getAuthUserState(id).catch(() => null);
  if (!userState) return false;
  const { passwordChangedAtMs } = userState;
  const issuedAtMs = Number(tokenIssuedAt || 0) * 1000;
  return !passwordChangedAtMs || (issuedAtMs && issuedAtMs + 1000 >= passwordChangedAtMs);
};

const getPresencePayloadUserId = (payload) => normalizeId(payload?.userId || payload?._id || payload?.id || payload);

const getPresencePayloadToken = (payload) => (
  payload && typeof payload === 'object'
    ? String(payload.token || payload.authToken || '').trim()
    : ''
);

const canUsePresenceUser = async (socket, requestedUserId, payload) => {
  const normalizedUserId = normalizeId(requestedUserId);
  if (!normalizedUserId) return false;

  const socketUserId = normalizeId(socket.data?.userId);
  if (socketUserId && socketUserId !== normalizedUserId) return false;
  if (socketUserId && socketUserId === normalizedUserId && await userExists(normalizedUserId, socket.data?.tokenIssuedAt)) {
    return true;
  }

  const token = getPresencePayloadToken(payload);
  if (!token || !process.env.JWT_SECRET) return false;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const decodedUserId = normalizeId(decoded?.userId);
    if (!decodedUserId || decodedUserId !== normalizedUserId) return false;
    if (!(await userExists(decodedUserId, decoded.iat))) return false;
    socket.data.tokenIssuedAt = Number(decoded.iat || 0);
    return true;
  } catch {
    return false;
  }
};

const getOnlineUserIds = () => Array.from(onlineUsers.keys());

const getPreferredUserSocketId = (userId) => {
  const sockets = onlineUsers.get(normalizeId(userId));
  if (!sockets || sockets.size === 0) return '';
  let preferredSocketId = '';
  sockets.forEach(socketId => {
    preferredSocketId = socketId;
  });
  return preferredSocketId;
};

const pruneStaleCallSessions = () => {
  const now = Date.now();
  activeCallSessions.forEach((session, callId) => {
    if (now - session.updatedAt > CALL_SESSION_TTL_MS) {
      activeCallSessions.delete(callId);
    }
  });
};

const socketExists = (socketId) => Boolean(socketId && io.sockets.sockets.has(socketId));

const broadcastOnlineUsers = () => {
  io.emit('online-users', getOnlineUserIds());
};

const broadcastUserStatusChange = (userId, status, lastSeen = null) => {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return;

  io.emit('user-status-change', {
    userId: normalizedUserId,
    status,
    online: status === 'online',
    lastSeen
  });
};

const addUserSocket = (userId, socketId) => {
  const id = normalizeId(userId);
  if (!id) return false;

  const wasOffline = !onlineUsers.has(id);
  const sockets = onlineUsers.get(id) || new Set();
  sockets.delete(socketId);
  sockets.add(socketId);
  onlineUsers.set(id, sockets);
  return wasOffline;
};

const registerOnlineUser = (socket, userId, tokenIssuedAt = socket.data?.tokenIssuedAt || 0) => {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return false;

  const wasOffline = addUserSocket(normalizedUserId, socket.id);
  socket.data.userId = normalizedUserId;
  socket.data.tokenIssuedAt = Number(tokenIssuedAt || 0);
  socket.join(`user_${normalizedUserId}`);
  broadcastOnlineUsers();

  if (wasOffline) {
    socket.broadcast.emit('user-online', normalizedUserId);
    broadcastUserStatusChange(normalizedUserId, 'online', null);
  }

  return true;
};

const registerExistingOnlineUser = async (socket, userId, tokenIssuedAt = 0) => {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId || !(await userExists(normalizedUserId, tokenIssuedAt))) return false;
  return registerOnlineUser(socket, normalizedUserId, tokenIssuedAt);
};

const removeUserSocket = (socket) => {
  const userId = normalizeId(socket.data?.userId);
  if (!userId || !onlineUsers.has(userId)) return null;

  const sockets = onlineUsers.get(userId);
  sockets.delete(socket.id);

  if (sockets.size === 0) {
    onlineUsers.delete(userId);
    return userId;
  }

  onlineUsers.set(userId, sockets);
  return null;
};

const markSocketUserOffline = async (socket) => {
  const disconnectedUserId = removeUserSocket(socket);

  if (!disconnectedUserId) return null;

  const lastSeen = new Date();
  await User.findByIdAndUpdate(disconnectedUserId, { lastSeen }).catch(err => {
    console.log('Last seen update failed:', err.message);
  });

  console.log(`User ${disconnectedUserId} went offline`);
  socket.broadcast.emit('user-offline', { userId: disconnectedUserId, lastSeen });
  broadcastUserStatusChange(disconnectedUserId, 'offline', lastSeen);
  broadcastOnlineUsers();

  return { userId: disconnectedUserId, lastSeen };
};

const BOW_DUEL_BOWS = [
  { name: 'Street Shiv', bonus: 0 },
  { name: 'Hunter Dagger', bonus: 5 },
  { name: 'Mercury Knife', bonus: 10 },
  { name: 'Viper Fang', bonus: 15 },
  { name: 'Starfall Kris', bonus: 20 }
];
const BOW_DUEL_MAX_ROUNDS = 0;
const BOW_DUEL_MAX_HP = 540;
const BOW_DUEL_UNLOCK_DAMAGE = 130;
const BOW_DUEL_GRAVITY = 0.22;
const BOW_DUEL_THROW_ORIGIN_HEIGHT = 118;
const BOW_DUEL_OBSTACLES = [
  { id: 'valley-spire', label: 'Stone Spire', x: 792, y: 426, width: 92, height: 128 },
  { id: 'ridge-pillar', label: 'Ridge Pillar', x: 1030, y: 462, width: 70, height: 96 }
];
const bowDuelQueue = [];
const bowDuelMatches = new Map();
const bowDuelSocketMatch = new Map();
const bowDuelRoundTimers = new Map();

const clampBowNumber = (value, min, max, fallback = min) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

const roundBowNumber = (value) => Math.round(value * 10) / 10;

const getBowDuelWind = () => roundBowNumber((Math.random() * 2 - 1) * 1.25);

const pruneBowDuelQueue = () => {
  for (let index = bowDuelQueue.length - 1; index >= 0; index -= 1) {
    if (!socketExists(bowDuelQueue[index]?.socketId)) {
      bowDuelQueue.splice(index, 1);
    }
  }
};

const removeBowDuelQueueEntry = ({ socketId, userId } = {}) => {
  let removed = false;
  for (let index = bowDuelQueue.length - 1; index >= 0; index -= 1) {
    const entry = bowDuelQueue[index];
    if ((socketId && entry.socketId === socketId) || (userId && entry.userId === userId)) {
      bowDuelQueue.splice(index, 1);
      removed = true;
    }
  }
  return removed;
};

const getBowDuelProfile = async (userId, fallback = {}) => {
  const user = await User.findById(userId).select('name email avatar').lean().catch(() => null);
  const fallbackName = String(fallback?.name || '').trim();
  const fallbackAvatar = String(fallback?.avatar || '').trim();
  return {
    userId,
    name: String(user?.name || fallbackName || user?.email || 'Fighter').slice(0, 64),
    avatar: String(user?.avatar || fallbackAvatar || '').slice(0, 400)
  };
};

const getBowDuelPlayerPoint = (side) => ({
  x: side === 'left' ? 150 : 1450,
  y: side === 'left' ? 320 : 535
});

const getBowDuelTargetZones = (side) => {
  const point = getBowDuelPlayerPoint(side);
  const facingOffset = side === 'left' ? 8 : -8;
  return {
    head: { x: point.x + facingOffset, y: point.y - 176, radius: 26 },
    body: { x: point.x, y: point.y - 102, radius: 58 },
    leg: { x: point.x, y: point.y - 26, radius: 38 }
  };
};

const getBowDuelObstacleHit = (x, y) => BOW_DUEL_OBSTACLES.find(obstacle => (
  x >= obstacle.x
  && x <= obstacle.x + obstacle.width
  && y >= obstacle.y
  && y <= obstacle.y + obstacle.height
));

const getBowDuelBowLevelForDamage = (totalDamage = 0) => Math.min(
  BOW_DUEL_BOWS.length - 1,
  Math.floor(Math.max(0, totalDamage) / BOW_DUEL_UNLOCK_DAMAGE)
);

const simulateBowDuelShot = ({ player, opponent, angle, power, wind }) => {
  const safeAngle = clampBowNumber(angle, -12, 82, 42);
  const safePower = clampBowNumber(power, 12, 100, 64);
  const direction = player.side === 'left' ? 1 : -1;
  const origin = getBowDuelPlayerPoint(player.side);
  const targetZones = getBowDuelTargetZones(opponent.side);
  const radians = safeAngle * (Math.PI / 180);
  const speed = 10.5 + safePower * 0.64;
  let x = origin.x;
  let y = origin.y - BOW_DUEL_THROW_ORIGIN_HEIGHT;
  let velocityX = Math.cos(radians) * speed * direction;
  let velocityY = -Math.sin(radians) * speed;
  const closest = {
    head: { distance: Number.POSITIVE_INFINITY, point: { x, y }, index: 0, velocityX, velocityY },
    body: { distance: Number.POSITIVE_INFINITY, point: { x, y }, index: 0, velocityX, velocityY },
    leg: { distance: Number.POSITIVE_INFINITY, point: { x, y }, index: 0, velocityX, velocityY }
  };
  let impact = { x, y };
  let blockedBy = null;
  const trajectory = [];

  for (let tick = 0; tick < 320; tick += 1) {
    const stepVelocityX = velocityX;
    const stepVelocityY = velocityY;
    x += velocityX;
    y += velocityY;
    velocityX += wind * 0.032;
    velocityY += BOW_DUEL_GRAVITY;
    trajectory.push({ x: Math.round(x), y: Math.round(y) });

    const obstacleHit = getBowDuelObstacleHit(x, y);
    if (obstacleHit) {
      blockedBy = { id: obstacleHit.id, label: obstacleHit.label };
      impact = { x, y };
      break;
    }

    Object.entries(targetZones).forEach(([zone, target]) => {
      const distance = Math.hypot(x - target.x, y - target.y);
      if (distance < closest[zone].distance) {
        closest[zone] = {
          distance,
          point: { x, y },
          index: trajectory.length - 1,
          velocityX: stepVelocityX,
          velocityY: stepVelocityY
        };
      }
    });

    if (
      closest.head.index === trajectory.length - 1 && closest.head.distance <= targetZones.head.radius
      || closest.body.index === trajectory.length - 1 && closest.body.distance <= targetZones.body.radius
      || closest.leg.index === trajectory.length - 1 && closest.leg.distance <= targetZones.leg.radius
    ) {
      impact = { x, y };
      break;
    }

    if (y > 720 || x < -160 || x > 1760) break;
  }

  const orderedZones = ['head', 'body', 'leg'];
  const bestZone = orderedZones.reduce((best, zone) => (
    closest[zone].distance < closest[best].distance ? zone : best
  ), 'body');
  const headshot = !blockedBy && closest.head.distance <= targetZones.head.radius;
  const bodyHit = !blockedBy && closest.body.distance <= targetZones.body.radius;
  const legHit = !blockedBy && closest.leg.distance <= targetZones.leg.radius;
  const hit = headshot || bodyHit || legHit;
  const graze = !blockedBy && !hit && closest[bestZone].distance <= 72;
  const closestDistance = blockedBy ? 999 : closest[bestZone].distance;
  const hitZone = blockedBy ? 'cover' : headshot ? 'head' : bodyHit ? 'body' : legHit ? 'leg' : graze ? 'graze' : 'miss';

  let impactVelocityX = velocityX;
  let impactVelocityY = velocityY;
  if (hit || graze) {
    const closestHit = closest[hitZone === 'graze' ? bestZone : hitZone] || closest[bestZone];
    impact = closestHit.point;
    impactVelocityX = closestHit.velocityX;
    impactVelocityY = closestHit.velocityY;
    if (hit) {
      trajectory.splice(closestHit.index + 1);
      const last = trajectory[trajectory.length - 1];
      if (!last || Math.hypot(last.x - impact.x, last.y - impact.y) > 2) {
        trajectory.push({ x: Math.round(impact.x), y: Math.round(impact.y) });
      } else {
        trajectory[trajectory.length - 1] = { x: Math.round(impact.x), y: Math.round(impact.y) };
      }
    }
  }

  const bowBonus = BOW_DUEL_BOWS[Math.min(BOW_DUEL_BOWS.length - 1, player.bowLevel || 0)]?.bonus || 0;
  let baseDamage = 0;
  if (headshot) {
    baseDamage = 88 + Math.round((targetZones.head.radius - closest.head.distance) * 1.22) + Math.round(safePower * 0.2);
  } else if (bodyHit) {
    baseDamage = 38 + Math.round((targetZones.body.radius - closest.body.distance) * 0.5) + Math.round(safePower * 0.09);
  } else if (legHit) {
    baseDamage = 30 + Math.round((targetZones.leg.radius - closest.leg.distance) * 0.42) + Math.round(safePower * 0.07);
  }

  const bonusDamage = headshot ? Math.round(bowBonus * 1.45) : legHit ? Math.round(bowBonus * 0.85) : bowBonus;
  const maxDamage = headshot ? 155 : legHit ? 78 : bodyHit ? 96 : 0;
  const damage = hit ? Math.round(clampBowNumber(baseDamage + bonusDamage, 16, maxDamage, 0)) : 0;
  const accuracy = Math.round(clampBowNumber((1 - Math.min(closestDistance, 260) / 260) * 100, 0, 100, 0));
  const impactVelocity = roundBowNumber(Math.hypot(impactVelocityX, impactVelocityY));
  const impactAngle = roundBowNumber(Math.atan2(impactVelocityY, impactVelocityX));
  const knockback = hit
    ? Math.round(clampBowNumber((damage / 8) + (impactVelocity / 5) + (headshot ? 12 : legHit ? 10 : 0), 8, 44, 16))
    : 0;
  const fallType = headshot
    ? 'head-drop'
    : legHit
      ? 'leg-trip'
      : damage >= 92 || impactVelocity >= 62
        ? 'heavy-impact'
        : hit
          ? 'stagger'
          : '';

  return {
    angle: Math.round(safeAngle),
    power: Math.round(safePower),
    wind,
    hit,
    headshot,
    hitZone,
    damage,
    accuracy,
    closestDistance: roundBowNumber(closestDistance),
    impactVelocity,
    impactAngle,
    knockback,
    fallType,
    blockedBy,
    impact: { x: Math.round(impact.x), y: Math.round(impact.y) },
    trajectory
  };
};

const getPublicBowDuelState = (match) => ({
  matchId: match.id,
  status: match.status,
  phase: match.phase,
  round: match.round,
  maxRounds: BOW_DUEL_MAX_ROUNDS,
  maxHp: match.maxHp || BOW_DUEL_MAX_HP,
  turnCount: match.turnCount || 0,
  wind: match.wind,
  obstacles: BOW_DUEL_OBSTACLES,
  turnUserId: match.status === 'active' && match.phase === 'aim'
    ? match.players[match.turnIndex]?.userId
    : '',
  players: match.players.map(player => ({
    userId: player.userId,
    name: player.name,
    avatar: player.avatar,
    side: player.side,
    wins: player.wins,
    hp: Math.max(0, Math.round(player.hp ?? BOW_DUEL_MAX_HP)),
    maxHp: player.maxHp || BOW_DUEL_MAX_HP,
    streak: player.streak || 0,
    emote: player.emote && player.emote.expiresAt > Date.now() ? {
      label: player.emote.label,
      createdAt: player.emote.createdAt
    } : null,
    totalDamage: player.totalDamage,
    shots: player.shots,
    hits: player.hits,
    bowLevel: player.bowLevel,
    bowName: BOW_DUEL_BOWS[Math.min(BOW_DUEL_BOWS.length - 1, player.bowLevel)]?.name || BOW_DUEL_BOWS[0].name,
    bowBonus: BOW_DUEL_BOWS[Math.min(BOW_DUEL_BOWS.length - 1, player.bowLevel)]?.bonus || 0,
    connected: socketExists(player.socketId)
  })),
  roundShots: match.roundShots,
  roundResult: match.roundResult,
  lastShot: match.lastShot,
  winnerId: match.winnerId,
  endedReason: match.endedReason,
  endedByUserId: match.endedByUserId || '',
  endedByName: match.endedByName || '',
  serverTime: new Date().toISOString()
});

const emitBowDuelState = (match) => {
  io.to(match.room).emit('bow-duel:state', getPublicBowDuelState(match));
};

const clearBowDuelTimer = (matchId) => {
  const timer = bowDuelRoundTimers.get(matchId);
  if (timer) clearTimeout(timer);
  bowDuelRoundTimers.delete(matchId);
};

const finishBowDuelMatch = (match, winnerId, endedReason = 'completed') => {
  clearBowDuelTimer(match.id);
  match.status = 'finished';
  match.phase = 'finished';
  match.winnerId = winnerId;
  match.endedReason = endedReason;
  match.updatedAt = Date.now();
  emitBowDuelState(match);
  match.players.forEach(player => bowDuelSocketMatch.delete(player.socketId));
  setTimeout(() => {
    const current = bowDuelMatches.get(match.id);
    if (current?.status === 'finished') bowDuelMatches.delete(match.id);
  }, 5 * 60 * 1000);
};

const scheduleBowDuelNextRound = (match) => {
  clearBowDuelTimer(match.id);
  const timer = setTimeout(() => {
    bowDuelRoundTimers.delete(match.id);
    if (match.status !== 'active' || match.phase !== 'round-result') return;

    match.round += 1;
    match.phase = 'aim';
    match.roundShots = {};
    match.roundResult = null;
    match.lastShot = null;
    match.wind = getBowDuelWind();
    match.firstTurnIndex = match.firstTurnIndex === 0 ? 1 : 0;
    match.turnIndex = match.firstTurnIndex;
    match.updatedAt = Date.now();
    emitBowDuelState(match);
  }, 2300);
  bowDuelRoundTimers.set(match.id, timer);
};

const resolveBowDuelRound = (match) => {
  const [leftPlayer, rightPlayer] = match.players;
  const leftShot = match.roundShots[leftPlayer.userId];
  const rightShot = match.roundShots[rightPlayer.userId];
  if (!leftShot || !rightShot) return;

  const winner = leftShot.damage === rightShot.damage
    ? (leftShot.accuracy >= rightShot.accuracy ? leftPlayer : rightPlayer)
    : (leftShot.damage > rightShot.damage ? leftPlayer : rightPlayer);
  winner.wins += 1;
  winner.bowLevel = Math.min(BOW_DUEL_BOWS.length - 1, winner.bowLevel + 1);

  match.roundResult = {
    round: match.round,
    winnerId: winner.userId,
    winnerName: winner.name,
    reason: leftShot.damage === rightShot.damage ? 'Accuracy tiebreaker' : 'Higher damage',
    leftDamage: leftShot.damage,
    rightDamage: rightShot.damage,
    bowUnlocked: {
      userId: winner.userId,
      bowLevel: winner.bowLevel,
      bowName: BOW_DUEL_BOWS[winner.bowLevel]?.name || BOW_DUEL_BOWS[0].name,
      bowBonus: BOW_DUEL_BOWS[winner.bowLevel]?.bonus || 0
    }
  };

  const matchWinner = match.players.find(player => player.wins >= 3);
  if (matchWinner || match.round >= BOW_DUEL_MAX_ROUNDS) {
    const finalWinner = matchWinner || match.players.reduce((best, player) => (
      player.wins > best.wins ? player : best
    ), match.players[0]);
    finishBowDuelMatch(match, finalWinner.userId, 'completed');
    return;
  }

  match.phase = 'round-result';
  match.updatedAt = Date.now();
  emitBowDuelState(match);
  scheduleBowDuelNextRound(match);
};

const createBowDuelMatch = (playerA, playerB) => {
  const socketA = io.sockets.sockets.get(playerA.socketId);
  const socketB = io.sockets.sockets.get(playerB.socketId);
  if (!socketA || !socketB) return null;

  const matchId = `bow-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const room = `bow_duel_${matchId}`;
  const match = {
    id: matchId,
    room,
    status: 'active',
    phase: 'aim',
    round: 1,
    maxHp: BOW_DUEL_MAX_HP,
    turnCount: 0,
    wind: getBowDuelWind(),
    firstTurnIndex: 0,
    turnIndex: 0,
    roundShots: {},
    roundResult: null,
    lastShot: null,
    winnerId: '',
    endedReason: '',
    endedByUserId: '',
    endedByName: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    players: [
      { ...playerA.profile, socketId: playerA.socketId, side: 'left', wins: 0, bowLevel: 0, hp: BOW_DUEL_MAX_HP, maxHp: BOW_DUEL_MAX_HP, streak: 0, totalDamage: 0, shots: 0, hits: 0, emote: null },
      { ...playerB.profile, socketId: playerB.socketId, side: 'right', wins: 0, bowLevel: 0, hp: BOW_DUEL_MAX_HP, maxHp: BOW_DUEL_MAX_HP, streak: 0, totalDamage: 0, shots: 0, hits: 0, emote: null }
    ]
  };

  bowDuelMatches.set(matchId, match);
  bowDuelSocketMatch.set(playerA.socketId, matchId);
  bowDuelSocketMatch.set(playerB.socketId, matchId);
  socketA.join(room);
  socketB.join(room);
  io.to(room).emit('bow-duel:match-start', getPublicBowDuelState(match));
  emitBowDuelState(match);
  return match;
};

const leaveBowDuelMatch = (socket, reason = 'left') => {
  removeBowDuelQueueEntry({ socketId: socket.id });
  const matchId = bowDuelSocketMatch.get(socket.id);
  if (!matchId) return;

  const match = bowDuelMatches.get(matchId);
  bowDuelSocketMatch.delete(socket.id);
  if (!match) return;

  const leavingPlayer = match.players.find(player => player.socketId === socket.id);
  const opponent = match.players.find(player => player.socketId !== socket.id);
  socket.leave(match.room);

  if (match.status === 'active' && opponent) {
    match.endedByUserId = leavingPlayer?.userId || '';
    match.endedByName = leavingPlayer?.name || '';
    finishBowDuelMatch(match, opponent.userId, reason);
  } else {
    emitBowDuelState(match);
  }
};

app.get('/api/presence/online', auth, (req, res) => {
  const users = getOnlineUserIds();
  res.json({ users, userIds: users });
});

app.get('/api/presence/online/:userId', auth, async (req, res) => {
  try {
    const userId = normalizeId(req.params.userId);
    const user = await User.findById(userId).select('lastSeen');
    res.json({
      online: onlineUsers.has(userId),
      lastSeen: user?.lastSeen || null
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

io.on('connection', async (socket) => {
  console.log('New client connected:', socket.id);

  const token = socket.handshake.auth?.token;
  if (token && process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const registered = await registerExistingOnlineUser(socket, decoded.userId, decoded.iat);
      if (registered) {
        console.log(`User ${decoded.userId} is online via socket auth`);
      } else {
        console.log('Socket auth failed: user no longer exists or session expired');
      }
    } catch (err) {
      console.log('Socket auth failed:', err.message);
    }
  }

  // User online
  socket.on('user-online', async (payload, callback) => {
    const normalizedUserId = getPresencePayloadUserId(payload);

    if (await canUsePresenceUser(socket, normalizedUserId, payload)) {
      registerOnlineUser(socket, normalizedUserId);
      console.log(`User ${normalizedUserId} is online`);

      if (typeof callback === 'function') callback(getOnlineUserIds());
    } else if (typeof callback === 'function') {
      callback(getOnlineUserIds());
    }
  });

  socket.on('user-offline', async (payload, callback) => {
    const normalizedUserId = getPresencePayloadUserId(payload);
    const socketUserId = normalizeId(socket.data?.userId);

    if (await canUsePresenceUser(socket, normalizedUserId, payload)) {
      if (!socketUserId) socket.data.userId = normalizedUserId;
      const result = await markSocketUserOffline(socket);
      if (typeof callback === 'function') {
        callback({
          ok: true,
          lastSeen: result?.lastSeen || new Date(),
          onlineUsers: getOnlineUserIds()
        });
      }
      return;
    }

    if (typeof callback === 'function') {
      callback({ ok: false, onlineUsers: getOnlineUserIds() });
    }
  });

  // Check online status
  socket.on('check-online', async (userId, callback) => {
    const normalizedUserId = normalizeId(userId);
    const isOnline = onlineUsers.has(normalizedUserId);

    if (callback) {
      const user = await User.findById(normalizedUserId).select('lastSeen').catch(() => null);
      callback({ online: isOnline, lastSeen: user?.lastSeen || null });
    }
  });

  socket.on('get-online-users', (callback) => {
    if (callback) callback(getOnlineUserIds());
  });

  const forwardTyping = (eventName, { to, from, chatId } = {}) => {
    const toId = normalizeId(to || chatId);
    const fromId = normalizeId(from || socket.data?.userId);
    const socketUserId = normalizeId(socket.data?.userId);

    if (toId && fromId && socketUserId && fromId === socketUserId) {
      io.to(`user_${toId}`).emit(eventName, {
        chatId: fromId,
        from: fromId,
        userId: fromId
      });
    }
  };

  // Typing event
  socket.on('typing', payload => {
    forwardTyping('user-typing', payload);
  });

  // Stop typing
  socket.on('stop-typing', payload => {
    forwardTyping('user-stop-typing', payload);
  });

  socket.on('typing-start', payload => {
    forwardTyping('user-typing', payload);
  });

  socket.on('typing-stop', payload => {
    forwardTyping('user-stop-typing', payload);
  });

  const forwardDirectCallEvent = (eventName, rawPayload = {}) => {
    pruneStaleCallSessions();

    const fromId = normalizeId(socket.data?.userId);
    const toId = normalizeId(rawPayload.to);
    const requestedCallId = normalizeCallId(rawPayload.callId);

    if (!fromId || !toId || fromId === toId) return;

    const payload = {
      ...rawPayload,
      from: fromId,
      to: toId,
      sentAt: new Date().toISOString()
    };

    const emitUnavailable = (reason = 'offline') => {
      socket.emit('call:unavailable', {
        ...payload,
        callId: requestedCallId || payload.callId,
        reason
      });
    };

    if (eventName === 'call:start') {
      const targetSocketId = getPreferredUserSocketId(toId);
      if (!targetSocketId) {
        emitUnavailable('offline');
        return;
      }

      const callId = requestedCallId || normalizeCallId(`call-${Date.now()}-${socket.id}`);
      const sessionPayload = { ...payload, callId };

      activeCallSessions.set(callId, {
        callId,
        callerUserId: fromId,
        calleeUserId: toId,
        callerSocketId: socket.id,
        calleeSocketId: targetSocketId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      io.to(targetSocketId).emit(eventName, sessionPayload);
      return;
    }

    const session = requestedCallId ? activeCallSessions.get(requestedCallId) : null;
    if (session) {
      const sentByCallerSocket = socket.id === session.callerSocketId;
      const sentByCalleeSocket = socket.id === session.calleeSocketId;
      if (!sentByCallerSocket && !sentByCalleeSocket) return;

      const expectedToId = sentByCallerSocket ? session.calleeUserId : session.callerUserId;
      if (toId !== expectedToId) return;

      const targetSocketId = sentByCallerSocket ? session.calleeSocketId : session.callerSocketId;
      if (!socketExists(targetSocketId)) {
        activeCallSessions.delete(session.callId);
        if (eventName !== 'call:end') emitUnavailable('offline');
        return;
      }

      session.updatedAt = Date.now();
      io.to(targetSocketId).emit(eventName, payload);

      if (TERMINAL_CALL_EVENTS.has(eventName)) {
        activeCallSessions.delete(session.callId);
      }
      return;
    }

    if (!onlineUsers.has(toId) && eventName !== 'call:end') {
      emitUnavailable('offline');
      return;
    }

    io.to(`user_${toId}`).emit(eventName, payload);
  };

  [
    'call:start',
    'call:offer',
    'call:answer',
    'call:ice-candidate',
    'call:reject',
    'call:end',
    'call:busy'
  ].forEach(eventName => {
    socket.on(eventName, payload => forwardDirectCallEvent(eventName, payload));
  });

  socket.on('bow-duel:find-match', async (payload = {}, callback) => {
    try {
      const socketUserId = normalizeId(socket.data?.userId);
      const userId = normalizeId(payload.userId || socketUserId);
      if (!socketUserId || userId !== socketUserId || !(await userExists(userId, socket.data?.tokenIssuedAt))) {
        socket.emit('bow-duel:error', { msg: 'Please sign in before finding a Knife Duel match.' });
        if (typeof callback === 'function') callback({ ok: false, msg: 'Missing user' });
        return;
      }

      registerOnlineUser(socket, userId);
      removeBowDuelQueueEntry({ socketId: socket.id, userId });
      pruneBowDuelQueue();

      const profile = await getBowDuelProfile(userId, payload.profile || {});
      const waitingIndex = bowDuelQueue.findIndex(entry => (
        entry.userId !== userId && socketExists(entry.socketId)
      ));
      const entry = {
        socketId: socket.id,
        userId,
        profile,
        queuedAt: Date.now()
      };

      if (waitingIndex >= 0) {
        const opponent = bowDuelQueue.splice(waitingIndex, 1)[0];
        const match = createBowDuelMatch(opponent, entry);
        if (typeof callback === 'function') callback({ ok: Boolean(match), matchId: match?.id || '' });
        return;
      }

      bowDuelQueue.push(entry);
      socket.emit('bow-duel:queue', {
        waiting: true,
        queueSize: bowDuelQueue.length,
        onlineCount: getOnlineUserIds().length
      });
      if (typeof callback === 'function') callback({ ok: true, waiting: true });
    } catch (err) {
      socket.emit('bow-duel:error', { msg: err.message || 'Could not find a Knife Duel match.' });
      if (typeof callback === 'function') callback({ ok: false, msg: err.message });
    }
  });

  socket.on('bow-duel:cancel-search', (callback) => {
    const removed = removeBowDuelQueueEntry({ socketId: socket.id });
    socket.emit('bow-duel:queue', {
      waiting: false,
      queueSize: bowDuelQueue.length,
      onlineCount: getOnlineUserIds().length
    });
    if (typeof callback === 'function') callback({ ok: true, removed });
  });

  socket.on('bow-duel:throw', (payload = {}, callback) => {
    const matchId = bowDuelSocketMatch.get(socket.id);
    const match = matchId ? bowDuelMatches.get(matchId) : null;
    if (!match || match.status !== 'active') {
      socket.emit('bow-duel:error', { msg: 'No active Knife Duel match found.' });
      if (typeof callback === 'function') callback({ ok: false, msg: 'No active match' });
      return;
    }

    if (match.phase !== 'aim') {
      socket.emit('bow-duel:error', { msg: 'Wait for the next turn.' });
      if (typeof callback === 'function') callback({ ok: false, msg: 'Turn is resolving' });
      return;
    }

    const playerIndex = match.players.findIndex(player => player.socketId === socket.id);
    if (playerIndex < 0 || match.turnIndex !== playerIndex) {
      socket.emit('bow-duel:error', { msg: 'It is not your turn yet.' });
      if (typeof callback === 'function') callback({ ok: false, msg: 'Not your turn' });
      return;
    }

    const player = match.players[playerIndex];
    const opponent = match.players[playerIndex === 0 ? 1 : 0];
    const shotResult = simulateBowDuelShot({
      player,
      opponent,
      angle: payload.angle,
      power: payload.power,
      wind: match.wind
    });
    const bow = BOW_DUEL_BOWS[Math.min(BOW_DUEL_BOWS.length - 1, player.bowLevel)] || BOW_DUEL_BOWS[0];
    const hpBefore = Math.max(0, opponent.hp ?? BOW_DUEL_MAX_HP);
    const appliedDamage = Math.min(hpBefore, Math.max(0, shotResult.damage || 0));
    const hpAfter = Math.max(0, hpBefore - appliedDamage);
    const shot = {
      ...shotResult,
      userId: player.userId,
      name: player.name,
      side: player.side,
      round: match.round,
      turn: (match.turnCount || 0) + 1,
      bowLevel: player.bowLevel,
      bowName: bow.name,
      bowBonus: bow.bonus,
      targetUserId: opponent.userId,
      targetName: opponent.name,
      targetHpBefore: Math.round(hpBefore),
      targetHpAfter: Math.round(hpAfter),
      appliedDamage: Math.round(appliedDamage),
      knockout: hpAfter <= 0,
      firedAt: new Date().toISOString()
    };

    opponent.hp = hpAfter;
    opponent.streak = 0;
    player.totalDamage += appliedDamage;
    player.shots += 1;
    if (shot.hit) {
      player.hits += 1;
      player.streak = (player.streak || 0) + 1;
    } else {
      player.streak = 0;
    }
    const previousBowLevel = player.bowLevel || 0;
    player.bowLevel = Math.max(player.bowLevel || 0, getBowDuelBowLevelForDamage(player.totalDamage));
    if (player.bowLevel > previousBowLevel) {
      shot.bowUnlocked = {
        userId: player.userId,
        bowLevel: player.bowLevel,
        bowName: BOW_DUEL_BOWS[player.bowLevel]?.name || BOW_DUEL_BOWS[0].name,
        bowBonus: BOW_DUEL_BOWS[player.bowLevel]?.bonus || 0
      };
    }

    match.turnCount = (match.turnCount || 0) + 1;
    match.round = Math.max(1, Math.ceil(match.turnCount / 2));
    match.roundShots[player.userId] = shot;
    match.lastShot = shot;
    match.updatedAt = Date.now();

    if (hpAfter <= 0) {
      player.wins = 1;
      match.roundResult = {
        round: match.round,
        turn: match.turnCount,
        winnerId: player.userId,
        winnerName: player.name,
        reason: shot.headshot ? 'Headshot knockout' : 'HP knockout',
        leftHp: match.players[0].hp,
        rightHp: match.players[1].hp,
        bowUnlocked: shot.bowUnlocked || null
      };
      finishBowDuelMatch(match, player.userId, 'knockout');
    } else {
      match.turnIndex = playerIndex === 0 ? 1 : 0;
      match.wind = getBowDuelWind();
      emitBowDuelState(match);
    }

    if (typeof callback === 'function') callback({ ok: true, shot });
  });

  socket.on('bow-duel:emote', (payload = {}, callback) => {
    const matchId = bowDuelSocketMatch.get(socket.id);
    const match = matchId ? bowDuelMatches.get(matchId) : null;
    if (!match || match.status !== 'active') {
      if (typeof callback === 'function') callback({ ok: false, msg: 'No active match' });
      return;
    }

    const player = match.players.find(item => item.socketId === socket.id);
    if (!player) {
      if (typeof callback === 'function') callback({ ok: false, msg: 'Missing player' });
      return;
    }

    const label = String(payload.label || '').trim().slice(0, 14);
    const allowedLabels = new Set(['Nice', 'Close', 'Focus', 'Again', 'GG']);
    if (!allowedLabels.has(label)) {
      if (typeof callback === 'function') callback({ ok: false, msg: 'Invalid emote' });
      return;
    }

    player.emote = {
      label,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 5000
    };
    match.updatedAt = Date.now();
    emitBowDuelState(match);
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('bow-duel:leave', (callback) => {
    leaveBowDuelMatch(socket, 'forfeit');
    if (typeof callback === 'function') callback({ ok: true });
  });

  // Direct messages
  socket.on('sendMessage', (message) => {
    const toId = normalizeId(message?.to);
    const fromId = normalizeId(message?.from);

    if (!message || !toId || !fromId) return;

    io.to(`user_${toId}`).emit('receiveMessage', message);
    socket.to(`user_${fromId}`).emit('receiveMessage', message);
  });

  // Join group
  socket.on('join-group', (groupId) => {
    socket.join(`group_${groupId}`);
  });

  // Leave group
  socket.on('leave-group', (groupId) => {
    socket.leave(`group_${groupId}`);
  });

  // Send group message
  socket.on('send-group-message', async (data) => {
    const { groupId, message } = data;

    io.to(`group_${groupId}`).emit('receive-group-message', message);
  });

  // Delete message
  socket.on('delete-group-message', ({ messageId, groupId }) => {
    io.to(`group_${groupId}`).emit('message-deleted', messageId);
  });

  socket.on('delete-message-for-me', ({ messageId, groupId }) => {
    socket.to(`group_${groupId}`).emit('message-deleted-for-me', messageId);
  });

  socket.on('delete-message-for-everyone', ({ messageId, groupId }) => {
    io.to(`group_${groupId}`).emit('message-deleted-for-everyone', messageId);
  });

  // Disconnect
  socket.on('disconnect', async () => {
    activeCallSessions.forEach((session, callId) => {
      const sentByCallerSocket = socket.id === session.callerSocketId;
      const sentByCalleeSocket = socket.id === session.calleeSocketId;
      if (!sentByCallerSocket && !sentByCalleeSocket) return;

      const targetSocketId = sentByCallerSocket ? session.calleeSocketId : session.callerSocketId;
      if (socketExists(targetSocketId)) {
        io.to(targetSocketId).emit('call:end', {
          callId,
          from: sentByCallerSocket ? session.callerUserId : session.calleeUserId,
          to: sentByCallerSocket ? session.calleeUserId : session.callerUserId,
          reason: 'disconnected',
          sentAt: new Date().toISOString()
        });
      }

      activeCallSessions.delete(callId);
    });

    leaveBowDuelMatch(socket, 'connection_lost');

    await markSocketUserOffline(socket);

    console.log('Client disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
