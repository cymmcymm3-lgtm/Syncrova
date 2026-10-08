const User = require('../models/User');

const DEFAULT_TTL_MS = 15_000;
const MAX_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 10_000;
const cache = new Map();

const getCacheTtlMs = () => {
  const configured = Number(process.env.AUTH_SESSION_CACHE_TTL_MS);
  if (!Number.isFinite(configured)) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(0, configured));
};

const pruneExpiredEntries = (now = Date.now()) => {
  for (const [userId, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(userId);
  }
};

const getAuthUserState = async (userId) => {
  const id = String(userId || '');
  if (!id) return null;

  const ttlMs = getCacheTtlMs();
  const now = Date.now();
  const cached = cache.get(id);
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) cache.delete(id);

  const user = await User.findById(id).select('passwordChangedAt').lean();
  const value = user
    ? {
      passwordChangedAtMs: user.passwordChangedAt
        ? new Date(user.passwordChangedAt).getTime()
        : 0
    }
    : null;

  if (ttlMs > 0) {
    if (cache.size >= MAX_CACHE_ENTRIES) pruneExpiredEntries(now);
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(id, { value, expiresAt: now + ttlMs });
  }

  return value;
};

const invalidateAuthUserState = (userId) => {
  cache.delete(String(userId || ''));
};

module.exports = {
  getAuthUserState,
  invalidateAuthUserState
};
