#!/usr/bin/env node

// Local owner-only recovery: run on a trusted machine with the database credentials.
const crypto = require('crypto');
const path = require('path');
const { getConfiguredMongoDatabaseName, withConfiguredMongoDatabaseName } = require('../utils/mongo');

const RESET_TOKEN_TTL_MS = 20 * 60 * 1000;
const USAGE = `Usage:
  npm run account:recover -- --email person@example.com --dry-run
  npm run account:recover -- --email person@example.com
  npm run account:recover -- --email person@example.com --frontend-url https://your-app.vercel.app

The reset link expires after 20 minutes. The password and account role stay unchanged
until the account owner chooses a new password in the app. Keep the link private.
`;

class RecoveryError extends Error {}

const parseArgs = (args) => {
  const options = { email: '', frontendUrl: 'http://localhost:3000', dryRun: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--email' || argument === '--frontend-url') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new RecoveryError('A required argument value is missing. Use --help for usage.');
      options[argument === '--email' ? 'email' : 'frontendUrl'] = value.trim();
    } else {
      throw new RecoveryError('An unsupported argument was supplied. Use --help for usage.');
    }
  }
  if (options.help) return options;
  options.email = options.email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email)) {
    throw new RecoveryError('Provide the existing account email explicitly with --email.');
  }
  let frontendUrl;
  try { frontendUrl = new URL(options.frontendUrl); } catch {
    throw new RecoveryError('Provide a valid frontend origin with --frontend-url.');
  }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(frontendUrl.hostname);
  if ((frontendUrl.protocol !== 'https:' && !(isLocal && frontendUrl.protocol === 'http:'))
    || frontendUrl.username || frontendUrl.password || frontendUrl.search || frontendUrl.hash
    || frontendUrl.pathname !== '/') {
    throw new RecoveryError('The frontend URL must be an HTTPS origin, or an HTTP localhost origin, without a path or credentials.');
  }
  options.frontendOrigin = frontendUrl.origin;
  return options;
};

const recoverAccount = async ({ User, email, frontendOrigin, dryRun, now = Date.now, randomBytes = crypto.randomBytes }) => {
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const users = await User.find({ email: new RegExp(`^${escapedEmail}$`, 'i') })
    .select('email isDeveloper').limit(2).lean();
  if (users.length === 0) throw new RecoveryError('No matching account exists in the configured database. No changes were made.');
  if (users.length > 1) throw new RecoveryError('Multiple accounts match this email. Resolve the duplicate records before recovery. No changes were made.');
  const user = users[0];
  const result = { email: user.email, isDeveloper: Boolean(user.isDeveloper), dryRun: Boolean(dryRun) };
  if (dryRun) return result;

  const token = randomBytes(32).toString('hex');
  const requestedAt = new Date(now());
  const expiresAt = new Date(requestedAt.getTime() + RESET_TOKEN_TTL_MS);
  const resetUrl = new URL('/login', frontendOrigin);
  resetUrl.searchParams.set('resetToken', token);
  resetUrl.searchParams.set('resetEmail', user.email);
  const updated = await User.updateOne({ _id: user._id }, { $set: {
    passwordResetToken: crypto.createHash('sha256').update(token).digest('hex'),
    passwordResetExpires: expiresAt,
    passwordResetRequestedBy: null,
    passwordResetRequestedAt: requestedAt
  } }, { timestamps: false, upsert: false });
  if (updated.matchedCount !== 1) throw new RecoveryError('The account no longer exists. No recovery link was issued.');
  return { ...result, expiresAt: expiresAt.toISOString(), resetUrl: resetUrl.toString() };
};

const main = async () => {
  let mongoose;
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      return;
    }
    require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
    const uri = String(process.env.MONGODB_URI || '').trim();
    if (!uri || !getConfiguredMongoDatabaseName(uri)) {
      throw new RecoveryError('Set MONGODB_URI and an explicit database name in the URI or MONGODB_DB_NAME before recovery.');
    }
    mongoose = require('mongoose');
    await mongoose.connect(uri, withConfiguredMongoDatabaseName(uri, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 10000
    }));
    const User = require('../models/User');
    const result = await recoverAccount({ User, ...options });
    console.log(`Account: ${result.email}`);
    console.log(`Developer/admin: ${result.isDeveloper ? 'yes' : 'no'}`);
    if (result.dryRun) {
      console.log('Dry run: account found. No account fields were changed and no reset token was generated.');
    } else {
      console.log(`Reset link expires: ${result.expiresAt}`);
      console.log(`Open this private link to choose your new password:\n${result.resetUrl}`);
      console.log('The password and role are unchanged. Issuing another link invalidates this one.');
    }
  } catch (error) {
    // Database/driver messages can contain credentials or connection details.
    console.error(error instanceof RecoveryError ? error.message : 'Account recovery failed. Check the local database configuration and connection; no reset link was issued.');
    process.exitCode = 1;
  } finally {
    if (mongoose) await mongoose.disconnect().catch(() => {});
  }
};

if (require.main === module) main();
module.exports = { parseArgs, recoverAccount, RecoveryError };
