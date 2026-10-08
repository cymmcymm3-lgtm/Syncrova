const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const { normalizeCampus, normalizeCourse } = require('../utils/academics');
const {
  isDeveloperEmail,
  isValidAdminRegistrationCode,
  syncDeveloperAccess
} = require('../services/roles');
const { serializeMediaUser } = require('../utils/mediaUrls');
const { invalidateAuthUserState } = require('../utils/authSessionCache');
const router = express.Router();

const isBcryptHash = (value = '') => /^\$2[aby]\$\d{2}\$/.test(value);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getResetTokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const RESET_TOKEN_TTL_MS = 1000 * 60 * 20;

const getBackendOrigin = (req) => (
  process.env.BACKEND_PUBLIC_URL
  || process.env.RENDER_EXTERNAL_URL
  || `${req.protocol}://${req.get('host')}`
).replace(/\/$/, '');

const getFrontendOrigin = (fallback) => (
  process.env.FRONTEND_URL
  || process.env.CLIENT_URL
  || fallback
  || 'http://localhost:3000'
).replace(/\/$/, '');

const getOAuthRedirectUri = (req, provider) => `${getBackendOrigin(req)}/api/auth/oauth/${provider}/callback`;

const DEFAULT_FRONTEND_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5002',
  'http://127.0.0.1:5002'
];

const getAllowedFrontendOrigins = () => [
  ...DEFAULT_FRONTEND_ORIGINS,
  process.env.FRONTEND_URL,
  process.env.CLIENT_URL,
  ...(process.env.CLIENT_ORIGINS || '').split(',')
]
  .map(origin => origin?.trim())
  .filter(Boolean)
  .map(origin => origin.replace(/\/$/, ''));

const allowPreviewOrigins = () => process.env.ALLOW_PREVIEW_ORIGINS === 'true' || process.env.NODE_ENV !== 'production';

const getSafeFrontendOrigin = (req) => {
  const fallback = getFrontendOrigin();
  const candidate = req.query.returnTo || req.headers.origin || fallback;

  try {
    const origin = new URL(candidate).origin;
    const allowed = getAllowedFrontendOrigins();
    if (
      allowed.includes(origin)
      || (allowPreviewOrigins() && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin))
      || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ) {
      return origin;
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const providerConfig = {
  google: {
    enabled: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    scope: 'openid email profile'
  },
  facebook: {
    enabled: () => Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/me?fields=id,name,email,picture.width(300).height(300)',
    clientId: () => process.env.FACEBOOK_APP_ID,
    clientSecret: () => process.env.FACEBOOK_APP_SECRET,
    scope: 'email,public_profile'
  }
};

const toClientUser = (user) => {
  const object = serializeMediaUser(user);
  return {
    _id: object._id,
    id: object._id,
    name: object.name,
    email: object.email,
    course: normalizeCourse(object.course),
    campus: normalizeCampus(object.campus),
    bio: object.bio,
    avatar: object.avatar,
    coverPhoto: object.coverPhoto,
    lastSeen: object.lastSeen,
    isDeveloper: object.isDeveloper,
    studentVerificationStatus: object.studentVerificationStatus || 'not_submitted',
    studentVerifiedAt: object.studentVerifiedAt || null,
    studentVerificationReviewedAt: object.studentVerificationReviewedAt || null,
    createdAt: object.createdAt
  };
};

const issueToken = (user) => jwt.sign({ userId: user._id }, process.env.JWT_SECRET);

const redirectOAuthResult = (origin, token, user) => {
  const encodedUser = Buffer.from(JSON.stringify(toClientUser(user))).toString('base64url');
  return `${origin}/login?oauthToken=${encodeURIComponent(token)}&oauthUser=${encodeURIComponent(encodedUser)}`;
};

const buildResetUrl = (req, user, resetToken) => (
  `${getSafeFrontendOrigin(req)}/login?resetToken=${resetToken}&resetEmail=${encodeURIComponent(user.email)}`
);

const createPasswordReset = async (user, requestedBy = null) => {
  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = getResetTokenHash(resetToken);
  user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  user.passwordResetRequestedBy = requestedBy;
  user.passwordResetRequestedAt = new Date();
  await user.save();
  return resetToken;
};

const requireDeveloper = async (req, res, next) => {
  try {
    const user = await User.findById(req.user).select('isDeveloper');
    if (!user?.isDeveloper) return res.status(403).json({ msg: 'Developer access is required' });
    next();
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, course, campus, adminCode } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ msg: 'Name, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ msg: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const reservedDeveloperEmail = isDeveloperEmail(normalizedEmail);
    if (reservedDeveloperEmail && !isValidAdminRegistrationCode(adminCode)) {
      return res.status(403).json({ msg: 'This email is reserved for an admin account' });
    }

    const normalizedCourse = normalizeCourse(course);
    const normalizedCampus = normalizeCampus(campus);
    if (course && !normalizedCourse) return res.status(400).json({ msg: 'Please choose a valid NEMSU course' });
    if (campus && !normalizedCampus) return res.status(400).json({ msg: 'Please choose a valid NEMSU campus' });

    let user = await User.findOne({ email: new RegExp(`^${escapeRegex(normalizedEmail)}$`, 'i') });
    if (user) return res.status(400).json({ msg: 'User already exists' });

    user = new User({
      name: name.trim(),
      email: normalizedEmail,
      password: await bcrypt.hash(password, 10),
      course: normalizedCourse,
      campus: normalizedCampus,
      isDeveloper: reservedDeveloperEmail
    });
    await user.save();

    const token = issueToken(user);
    res.json({ token, user: toClientUser(user) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email?.trim() || !password) {
      return res.status(400).json({ msg: 'Email and password are required' });
    }
    const normalizedEmail = email?.trim().toLowerCase();
    const user = await User.findOne({ email: new RegExp(`^${escapeRegex(normalizedEmail || '')}$`, 'i') });
    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

    const passwordMatches = isBcryptHash(user.password)
      ? await bcrypt.compare(password, user.password)
      : user.password === password;

    if (!passwordMatches) return res.status(400).json({ msg: 'Invalid credentials' });

    if (!isBcryptHash(user.password)) {
      user.password = await bcrypt.hash(password, 10);
      user.passwordChangedAt = new Date();
      await user.save();
      invalidateAuthUserState(user._id);
    }

    await syncDeveloperAccess(user);

    const token = issueToken(user);
    res.json({ token, user: toClientUser(user) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/oauth/status', (req, res) => {
  res.json({
    google: providerConfig.google.enabled(),
    facebook: providerConfig.facebook.enabled()
  });
});

router.get('/oauth/:provider', (req, res) => {
  try {
    const provider = req.params.provider;
    const config = providerConfig[provider];
    if (!config) return res.status(404).json({ msg: 'OAuth provider not supported' });
    if (!config.enabled()) {
      return res.status(501).json({ msg: `${provider} login is not configured yet` });
    }

    const returnTo = getSafeFrontendOrigin(req);
    const state = jwt.sign({ provider, returnTo, purpose: 'oauth-login' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const params = new URLSearchParams({
      client_id: config.clientId(),
      redirect_uri: getOAuthRedirectUri(req, provider),
      response_type: 'code',
      scope: config.scope,
      state
    });

    res.redirect(`${config.authUrl}?${params.toString()}`);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/oauth/:provider/callback', async (req, res) => {
  try {
    const provider = req.params.provider;
    const config = providerConfig[provider];
    if (!config || !config.enabled()) return res.status(501).send('OAuth provider is not configured');
    if (!req.query.code || !req.query.state) return res.status(400).send('Missing OAuth code');

    const state = jwt.verify(req.query.state, process.env.JWT_SECRET);
    if (state.provider !== provider || state.purpose !== 'oauth-login') return res.status(400).send('Invalid OAuth state');

    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: config.clientId(),
        client_secret: config.clientSecret(),
        redirect_uri: getOAuthRedirectUri(req, provider),
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(400).send(tokenData.error_description || tokenData.error || 'OAuth token exchange failed');
    }

    const profileResponse = await fetch(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) return res.status(400).send('OAuth profile request failed');

    const email = profile.email?.trim().toLowerCase();
    if (!email) return res.status(400).send('Your social account has no verified email');

    let user = await User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') });
    if (!user) {
      user = new User({
        name: profile.name || email.split('@')[0],
        email,
        password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
        avatar: provider === 'facebook' ? profile.picture?.data?.url || '' : profile.picture || '',
        authProvider: provider,
        isDeveloper: isDeveloperEmail(email)
      });
      await user.save();
    } else if (!user.authProvider || user.authProvider === 'local') {
      user.authProvider = provider;
      if (!user.avatar) user.avatar = provider === 'facebook' ? profile.picture?.data?.url || '' : profile.picture || '';
      await user.save();
    }

    await syncDeveloperAccess(user, { trustedEmailOwner: true });

    const token = issueToken(user);
    res.redirect(redirectOAuthResult(getFrontendOrigin(state.returnTo), token, user));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const normalizedEmail = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!normalizedEmail) return res.status(400).json({ msg: 'Email is required' });

    const allowTokenPreview = process.env.NODE_ENV !== 'production' || process.env.PASSWORD_RESET_TOKEN_PREVIEW === 'true';
    // There is no email transport yet. Do not invalidate an owner-issued link
    // by replacing it with a token this requester has no way to receive.
    if (!allowTokenPreview) {
      return res.json({
        msg: 'Password reset email is not available yet. Please contact your administrator for a private recovery link.',
        emailConfigured: false
      });
    }

    const user = await User.findOne({ email: new RegExp(`^${escapeRegex(normalizedEmail)}$`, 'i') });
    const genericMsg = 'If that email exists, a password reset link has been prepared.';

    if (!user) return res.json({ msg: genericMsg });

    const resetToken = await createPasswordReset(user);
    const resetUrl = buildResetUrl(req, user, resetToken);
    res.json({
      msg: genericMsg,
      resetUrl,
      resetToken,
      emailConfigured: false
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (typeof token !== 'string' || !token || typeof password !== 'string' || !password) {
      return res.status(400).json({ msg: 'Reset token and new password are required' });
    }
    if (password.length < 6) return res.status(400).json({ msg: 'Password must be at least 6 characters' });

    const tokenHash = getResetTokenHash(token);
    const passwordHash = await bcrypt.hash(password, 10);
    const changedAt = new Date();
    // Consume the token in the same write as the password update. A concurrent
    // reset or newly issued link must make this request fail instead of overwrite it.
    const user = await User.findOneAndUpdate({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: changedAt }
    }, { $set: {
      password: passwordHash,
      passwordResetToken: '',
      passwordResetExpires: null,
      passwordResetRequestedBy: null,
      passwordResetRequestedAt: null,
      passwordChangedAt: changedAt
    } }, { new: true, runValidators: true });

    if (!user) return res.status(400).json({ msg: 'Reset link is invalid or expired' });

    invalidateAuthUserState(user._id);

    const authToken = issueToken(user);
    res.json({ token: authToken, user: toClientUser(user), msg: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/admin/password-reset', auth, requireDeveloper, async (req, res) => {
  try {
    const normalizedEmail = req.body.email?.trim().toLowerCase();
    const userId = String(req.body.userId || '').trim();
    if (!normalizedEmail && !userId) {
      return res.status(400).json({ msg: 'Email or user ID is required' });
    }

    const query = normalizedEmail
      ? { email: new RegExp(`^${escapeRegex(normalizedEmail)}$`, 'i') }
      : mongoose.Types.ObjectId.isValid(userId) ? { _id: userId } : null;

    if (!query) return res.status(400).json({ msg: 'Invalid user ID' });

    const user = await User.findOne(query);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const resetToken = await createPasswordReset(user, req.user);
    const resetUrl = buildResetUrl(req, user, resetToken);

    res.json({
      msg: 'Password reset link generated',
      resetUrl,
      expiresAt: user.passwordResetExpires,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        isDeveloper: user.isDeveloper
      }
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
