#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { deleteObject, isCloudStorageEnabled } = require('../services/storage');
const { withConfiguredMongoDatabaseName } = require('../utils/mongo');

const File = require('../models/File');
const Friendship = require('../models/Friendship');
const GalleryItem = require('../models/GalleryItem');
const GameSession = require('../models/GameSession');
const Group = require('../models/Group');
const GroupActivity = require('../models/GroupActivity');
const GroupChat = require('../models/GroupChat');
const GroupInvite = require('../models/GroupInvite');
const GroupNote = require('../models/GroupNote');
const IssueReport = require('../models/IssueReport');
const MarketplaceListing = require('../models/MarketplaceListing');
const Memory = require('../models/Memory');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const Post = require('../models/Post');
const PushDevice = require('../models/PushDevice');
const Reel = require('../models/Reel');
const Story = require('../models/Story');
const StudentVerification = require('../models/StudentVerification');
const Subscription = require('../models/Subscription');
const Task = require('../models/Task');
const User = require('../models/User');
const UserNote = require('../models/UserNote');

const CONFIRMATION = 'RESET_SYNCROVA_DATA';
const args = process.argv.slice(2);
const confirmIndex = args.indexOf('--confirm');
const isConfirmed = confirmIndex !== -1 && args[confirmIndex + 1] === CONFIRMATION;
const dryRun = args.includes('--dry-run') || !isConfirmed;
const deleteStorage = args.includes('--delete-storage');

const uploadRoot = path.resolve(__dirname, '..', 'uploads');
const supabaseBucket = process.env.SUPABASE_BUCKET?.trim();

const resetModels = [
  ['File', File],
  ['Friendship', Friendship],
  ['GalleryItem', GalleryItem],
  ['GameSession', GameSession],
  ['Group', Group],
  ['GroupActivity', GroupActivity],
  ['GroupChat', GroupChat],
  ['GroupInvite', GroupInvite],
  ['GroupNote', GroupNote],
  ['IssueReport', IssueReport],
  ['MarketplaceListing', MarketplaceListing],
  ['Memory', Memory],
  ['Message', Message],
  ['Notification', Notification],
  ['Post', Post],
  ['PushDevice', PushDevice],
  ['Story', Story],
  ['StudentVerification', StudentVerification],
  ['Subscription', Subscription],
  ['Task', Task],
  ['UserNote', UserNote],
  ['User', User]
];

const countModels = [...resetModels, ['Reel', Reel]];

const printUsage = () => {
  console.log(`Usage:
  npm run data:reset -- --dry-run
  npm run data:reset -- --confirm ${CONFIRMATION}
  npm run data:reset -- --confirm ${CONFIRMATION} --delete-storage

Default mode is dry-run. The reset deletes MongoDB users, timeline/home posts,
groups, messages, tasks, notifications, marketplace listings, verification docs,
gallery items, memories, files, stories, and other user-linked records.
Reels are kept, but user-linked reel reactions/saves/import ownership are cleared.
Storage cleanup supports local uploads, Supabase objects, and R2 objects.
`);
};

const getModelCounts = async () => {
  const rows = await Promise.all(
    countModels.map(async ([name, Model]) => [name, await Model.countDocuments({})])
  );
  return Object.fromEntries(rows);
};

const logCounts = (title, counts) => {
  console.log(title);
  Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([name, count]) => console.log(`  ${name}: ${count}`));
};

const cleanPath = (value = '') => String(value || '').trim().replace(/^\/+/, '');

const safeLocalPath = (relativePath = '') => {
  const cleaned = cleanPath(relativePath).replace(/^uploads\//, '');
  if (!cleaned) return '';
  const resolved = path.resolve(uploadRoot, cleaned);
  return resolved === uploadRoot || !resolved.startsWith(`${uploadRoot}${path.sep}`)
    ? ''
    : resolved;
};

const getUploadRelativePath = (url = '') => {
  const raw = String(url || '').trim();
  if (!raw) return '';

  let pathname = raw;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = raw.split('?')[0];
  }

  if (!pathname.startsWith('/uploads/')) return '';

  try {
    return decodeURIComponent(pathname.slice('/uploads/'.length));
  } catch {
    return pathname.slice('/uploads/'.length);
  }
};

const getSupabaseObjectPath = (url = '') => {
  if (!supabaseBucket) return '';
  const raw = String(url || '').trim();
  if (!raw) return '';

  try {
    const pathname = new URL(raw).pathname;
    const marker = `/storage/v1/object/public/${supabaseBucket}/`;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex === -1) return '';
    return decodeURIComponent(pathname.slice(markerIndex + marker.length));
  } catch {
    return '';
  }
};

const addRemoteReference = (remoteObjects, provider, storagePath) => {
  if (!provider || !storagePath) return;
  remoteObjects.add(`${provider}:${storagePath}`);
};

const addMediaReference = ({ remoteObjects, localFiles }, item = {}) => {
  const storagePath = cleanPath(item.storagePath || item.photoStoragePath || item.documentStoragePath);
  const storageProvider = String(item.storageProvider || item.photoStorageProvider || item.documentStorageProvider || '').trim();
  const url = item.fileUrl || item.url || item.photo || item.documentUrl || '';
  const filename = item.filename || '';

  if (['supabase', 'r2'].includes(storageProvider) && storagePath) {
    addRemoteReference(remoteObjects, storageProvider, storagePath);
  } else {
    const derivedObjectPath = getSupabaseObjectPath(url);
    if (derivedObjectPath) addRemoteReference(remoteObjects, 'supabase', derivedObjectPath);
  }

  if (storageProvider === 'local') {
    const localFromStoragePath = safeLocalPath(storagePath);
    if (localFromStoragePath) localFiles.add(localFromStoragePath);
  }

  const uploadRelativePath = getUploadRelativePath(url);
  const localFromUrl = safeLocalPath(uploadRelativePath || filename);
  if (localFromUrl) localFiles.add(localFromUrl);
};

const collectMediaReferences = async () => {
  const media = {
    remoteObjects: new Set(),
    localFiles: new Set()
  };

  const [
    users,
    posts,
    stories,
    galleryItems,
    files,
    memories,
    marketplaceListings,
    messages,
    groups,
    verifications
  ] = await Promise.all([
    User.find({ $or: [{ avatar: { $ne: '' } }, { coverPhoto: { $ne: '' } }] }).select('avatar coverPhoto').lean(),
    Post.find({}).select('fileUrl storagePath storageProvider attachments').lean(),
    Story.find({}).select('fileUrl storagePath storageProvider').lean(),
    GalleryItem.find({}).select('fileUrl storagePath storageProvider').lean(),
    File.find({}).select('url filename storagePath storageProvider').lean(),
    Memory.find({}).select('fileUrl storagePath storageProvider').lean(),
    MarketplaceListing.find({}).select('photos').lean(),
    Message.find({}).select('fileUrl storagePath storageProvider attachments').lean(),
    Group.find({}).select('photo photoStoragePath photoStorageProvider').lean(),
    StudentVerification.find({}).select('documentUrl documentStoragePath documentStorageProvider').lean()
  ]);

  users.forEach(user => {
    addMediaReference(media, { url: user.avatar });
    addMediaReference(media, { url: user.coverPhoto });
  });

  posts.forEach(post => {
    addMediaReference(media, post);
    (post.attachments || []).forEach(attachment => addMediaReference(media, attachment));
  });

  stories.forEach(story => addMediaReference(media, story));
  galleryItems.forEach(item => addMediaReference(media, item));
  files.forEach(file => addMediaReference(media, file));
  memories.forEach(memory => addMediaReference(media, memory));

  marketplaceListings.forEach(listing => {
    (listing.photos || []).forEach(photo => addMediaReference(media, {
      url: photo.url,
      storagePath: photo.storagePath,
      storageProvider: photo.storageProvider,
      filename: photo.filename
    }));
  });

  messages.forEach(message => {
    addMediaReference(media, message);
    (message.attachments || []).forEach(attachment => addMediaReference(media, attachment));
  });

  groups.forEach(group => addMediaReference(media, {
    url: group.photo,
    storagePath: group.photoStoragePath,
    storageProvider: group.photoStorageProvider
  }));

  verifications.forEach(verification => addMediaReference(media, {
    url: verification.documentUrl,
    storagePath: verification.documentStoragePath,
    storageProvider: verification.documentStorageProvider
  }));

  return media;
};

const deleteStorageObjects = async ({ remoteObjects, localFiles }) => {
  const remotePaths = [...remoteObjects];
  const localPaths = [...localFiles];
  let remoteDeleted = 0;
  let localDeleted = 0;

  if (remotePaths.length && !isCloudStorageEnabled) {
    console.warn('Skipping remote object deletion because cloud storage is not configured.');
  } else {
    for (const reference of remotePaths) {
      const [provider, ...pathParts] = reference.split(':');
      const objectPath = pathParts.join(':');
      try {
        await deleteObject(objectPath, { provider });
        remoteDeleted += 1;
      } catch (err) {
        console.warn(`Could not delete ${provider} object "${objectPath}": ${err.message}`);
      }
    }
  }

  for (const filePath of localPaths) {
    try {
      await fs.promises.unlink(filePath);
      localDeleted += 1;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`Could not delete local file "${filePath}": ${err.message}`);
      }
    }
  }

  return { remoteDeleted, localDeleted };
};

const resetMongoData = async () => {
  const results = [];
  for (const [name, Model] of resetModels) {
    const result = await Model.deleteMany({});
    results.push([name, result.deletedCount || 0]);
  }

  const reelResult = await Reel.updateMany({}, {
    $set: {
      importedBy: null,
      reactions: [],
      savedBy: []
    }
  });
  results.push(['Reel user links cleared', reelResult.modifiedCount || 0]);

  return Object.fromEntries(results);
};

const main = async () => {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/syncrova', withConfiguredMongoDatabaseName(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/syncrova', {
    serverSelectionTimeoutMS: 10000
  }));

  const beforeCounts = await getModelCounts();
  const media = await collectMediaReferences();

  logCounts('Current MongoDB record counts:', beforeCounts);
  console.log(`Media references found: remote=${media.remoteObjects.size}, local=${media.localFiles.size}`);

  if (dryRun) {
    console.log('\nDry-run only. No records or files were deleted.');
    console.log(`Run with --confirm ${CONFIRMATION} to reset MongoDB user data.`);
    console.log(`Add --delete-storage only if you also want to delete cloud/local media objects.`);
    return;
  }

  if (deleteStorage) {
    const storageResult = await deleteStorageObjects(media);
    console.log(`Storage cleanup: remote deleted=${storageResult.remoteDeleted}, local deleted=${storageResult.localDeleted}`);
  } else {
    console.log('Storage cleanup skipped. Add --delete-storage if cloud/local media objects should also be removed.');
  }

  const resetResult = await resetMongoData();
  logCounts('MongoDB reset result:', resetResult);

  const afterCounts = await getModelCounts();
  logCounts('MongoDB record counts after reset:', afterCounts);
};

main()
  .catch(err => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
