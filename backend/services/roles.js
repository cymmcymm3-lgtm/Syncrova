const crypto = require('crypto');

const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();

const parseEmailList = (value = '') => new Set(
  String(value || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean)
);

const developerEmailAllowlist = () => parseEmailList([
  process.env.DEVELOPER_EMAILS,
  process.env.ADMIN_EMAILS
].filter(Boolean).join(','));

const isDeveloperEmail = (email) => developerEmailAllowlist().has(normalizeEmail(email));

const safeEqual = (a = '', b = '') => {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const isValidAdminRegistrationCode = (value) => {
  const expected = process.env.ADMIN_REGISTRATION_CODE || '';
  return Boolean(expected && safeEqual(value, expected));
};

const canAutoGrantDeveloper = (user, options = {}) => {
  if (!isDeveloperEmail(user?.email)) return false;
  if (options.trustedEmailOwner) return true;
  if (user?.authProvider && user.authProvider !== 'local') return true;
  return false;
};

const syncDeveloperAccess = async (user, options = {}) => {
  if (!user || user.isDeveloper) return user;
  if (!canAutoGrantDeveloper(user, options)) return user;

  user.isDeveloper = true;
  await user.save();
  return user;
};

module.exports = {
  canAutoGrantDeveloper,
  isDeveloperEmail,
  isValidAdminRegistrationCode,
  normalizeEmail,
  syncDeveloperAccess
};
