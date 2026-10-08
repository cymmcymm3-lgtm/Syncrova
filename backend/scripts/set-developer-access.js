#!/usr/bin/env node

const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const User = require('../models/User');
const { normalizeEmail } = require('../services/roles');
const { withConfiguredMongoDatabaseName } = require('../utils/mongo');

const args = process.argv.slice(2);
const emailIndex = args.indexOf('--email');
const email = normalizeEmail(emailIndex !== -1 ? args[emailIndex + 1] : '');
const revoke = args.includes('--revoke');

const printUsage = () => {
  console.log(`Usage:
  npm run admin:set -- --email person@example.com
  npm run admin:set -- --email person@example.com --revoke
`);
};

const main = async () => {
  const wantsHelp = args.includes('--help') || args.includes('-h');
  if (wantsHelp || !email) {
    printUsage();
    process.exitCode = wantsHelp ? 0 : 1;
    return;
  }

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/syncrova', withConfiguredMongoDatabaseName(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/syncrova', {
    serverSelectionTimeoutMS: 10000
  }));

  const user = await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (!user) {
    console.error(`No user found for ${email}. Register the account first, then rerun this command.`);
    process.exitCode = 1;
    return;
  }

  user.isDeveloper = !revoke;
  await user.save();

  console.log(`${user.email} is now ${user.isDeveloper ? 'a developer/admin' : 'a regular member'}.`);
};

main()
  .catch(err => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
