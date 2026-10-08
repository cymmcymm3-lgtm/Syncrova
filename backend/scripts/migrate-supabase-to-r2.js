#!/usr/bin/env node

const path = require('path');
const mongoose = require('mongoose');
const { createClient } = require('@supabase/supabase-js');
const {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { getObjectUrl } = require('../services/storage');
const { withConfiguredMongoDatabaseName } = require('../utils/mongo');

const File = require('../models/File');
const GalleryItem = require('../models/GalleryItem');
const Group = require('../models/Group');
const MarketplaceListing = require('../models/MarketplaceListing');
const Memory = require('../models/Memory');
const Message = require('../models/Message');
const Post = require('../models/Post');
const Story = require('../models/Story');
const StudentVerification = require('../models/StudentVerification');
const User = require('../models/User');

const CONFIRMATION = 'MIGRATE_SUPABASE_TO_R2';
const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const args = process.argv.slice(2);
const confirmIndex = args.indexOf('--confirm');
const isConfirmed = confirmIndex !== -1 && args[confirmIndex + 1] === CONFIRMATION;
const dryRun = args.includes('--dry-run') || !isConfirmed;
const forceUpload = args.includes('--force');
const skipMissing = args.includes('--skip-missing');

const cleanEnv = (value = '') => String(value || '').trim();
const supabaseUrl = cleanEnv(process.env.SUPABASE_URL);
const supabaseServiceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabaseBucket = cleanEnv(
  process.env.SUPABASE_BUCKET
  || process.env.SUPABASE_STORAGE_BUCKET
  || process.env.SUPABASE_BUCKET_NAME
);

const r2AccountId = cleanEnv(process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID);
const r2Endpoint = cleanEnv(
  process.env.R2_ENDPOINT
  || process.env.CLOUDFLARE_R2_ENDPOINT
  || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '')
).replace(/\/+$/, '');
const r2AccessKeyId = cleanEnv(process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID);
const r2SecretAccessKey = cleanEnv(process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY);
const r2Bucket = cleanEnv(process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || process.env.CLOUDFLARE_R2_BUCKET_NAME);

const printUsage = () => {
  console.log(`Usage:
  npm run storage:migrate:r2 -- --dry-run
  npm run storage:migrate:r2 -- --confirm ${CONFIRMATION}

Options:
  --force         Re-upload objects even if the key already exists in R2.
  --skip-missing  Continue when a referenced Supabase object is missing.

Default mode is dry-run. Confirmed mode copies Supabase objects into R2 using
the same object path, then updates MongoDB media URLs/providers to R2.
`);
};

const requireConfig = () => {
  const missing = [
    !process.env.MONGODB_URI && 'MONGODB_URI',
    !supabaseUrl && 'SUPABASE_URL',
    !supabaseServiceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !supabaseBucket && 'SUPABASE_BUCKET',
    !r2Endpoint && 'R2_ENDPOINT or R2_ACCOUNT_ID',
    !r2AccessKeyId && 'R2_ACCESS_KEY_ID',
    !r2SecretAccessKey && 'R2_SECRET_ACCESS_KEY',
    !r2Bucket && 'R2_BUCKET_NAME'
  ].filter(Boolean);

  if (!missing.length) return;
  throw new Error(`Missing required env: ${missing.join(', ')}`);
};

const supabase = () => createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const r2Client = () => new S3Client({
  region: 'auto',
  endpoint: r2Endpoint,
  credentials: {
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey
  }
});

const cleanPath = (value = '') => String(value || '').trim().replace(/^\/+/, '');

const getSupabaseObjectPath = (url = '') => {
  if (!supabaseBucket) return '';
  const raw = String(url || '').trim();
  if (!raw) return '';

  try {
    const pathname = new URL(raw).pathname;
    const markers = [
      `/storage/v1/object/public/${supabaseBucket}/`,
      `/storage/v1/object/sign/${supabaseBucket}/`,
      `/storage/v1/object/${supabaseBucket}/`
    ];
    const marker = markers.find(value => pathname.includes(value));
    if (!marker) return '';
    return decodeURIComponent(pathname.slice(pathname.indexOf(marker) + marker.length));
  } catch {
    return '';
  }
};

const getExtensionMimeType = (objectPath = '') => {
  const ext = path.extname(objectPath).toLowerCase();
  const map = {
    '.aac': 'audio/aac',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.m4a': 'audio/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.txt': 'text/plain',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp'
  };
  return map[ext] || 'application/octet-stream';
};

const createMigrationContext = () => ({
  references: new Map(),
  bulks: new Map(),
  counters: {
    files: 0,
    records: 0,
    mongoOps: 0
  }
});

const addReference = (context, objectPath, mimeType = '') => {
  const storedPath = cleanPath(objectPath);
  if (!storedPath || storedPath.includes('\0') || storedPath.split('/').some(part => part === '..')) return null;

  if (!context.references.has(storedPath)) {
    context.references.set(storedPath, {
      objectPath: storedPath,
      mimeType: mimeType || getExtensionMimeType(storedPath)
    });
  } else if (mimeType && context.references.get(storedPath).mimeType === 'application/octet-stream') {
    context.references.get(storedPath).mimeType = mimeType;
  }

  return context.references.get(storedPath);
};

const getMigration = (context, { storageProvider = '', storagePath = '', url = '', mimeType = '' }) => {
  const provider = String(storageProvider || '').trim();
  const derivedPath = getSupabaseObjectPath(url);
  if (provider !== 'supabase' && !derivedPath) return null;

  const objectPath = cleanPath(storagePath || derivedPath);
  const reference = addReference(context, objectPath, mimeType);
  if (!reference) return null;

  return {
    objectPath: reference.objectPath,
    url: getObjectUrl('r2', reference.objectPath),
    provider: 'r2'
  };
};

const addBulk = (context, name, Model, operation) => {
  if (!context.bulks.has(name)) context.bulks.set(name, { Model, operations: [] });
  context.bulks.get(name).operations.push(operation);
  context.counters.mongoOps += 1;
};

const collectSimpleModel = async (context, { name, Model, urlField = 'fileUrl', providerField = 'storageProvider', pathField = 'storagePath' }) => {
  const docs = await Model.find({
    $or: [
      { [providerField]: 'supabase' },
      { [urlField]: /\/storage\/v1\/object\// }
    ]
  }).lean();

  for (const doc of docs) {
    const migration = getMigration(context, {
      storageProvider: doc[providerField],
      storagePath: doc[pathField],
      url: doc[urlField],
      mimeType: doc.mimeType
    });
    if (!migration) continue;

    addBulk(context, name, Model, {
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            [urlField]: migration.url,
            [pathField]: migration.objectPath,
            [providerField]: 'r2'
          }
        }
      }
    });
    context.counters.records += 1;
  }
};

const collectUsers = async (context) => {
  const users = await User.find({
    $or: [
      { avatar: /\/storage\/v1\/object\// },
      { coverPhoto: /\/storage\/v1\/object\// }
    ]
  }).select('avatar coverPhoto').lean();

  for (const user of users) {
    const $set = {};
    const avatarMigration = getMigration(context, { url: user.avatar });
    const coverMigration = getMigration(context, { url: user.coverPhoto });

    if (avatarMigration) $set.avatar = avatarMigration.url;
    if (coverMigration) $set.coverPhoto = coverMigration.url;
    if (!Object.keys($set).length) continue;

    addBulk(context, 'User', User, {
      updateOne: {
        filter: { _id: user._id },
        update: { $set }
      }
    });
    context.counters.records += 1;
  }
};

const collectGroups = async (context) => {
  const groups = await Group.find({
    $or: [
      { photoStorageProvider: 'supabase' },
      { photo: /\/storage\/v1\/object\// }
    ]
  }).select('photo photoStoragePath photoStorageProvider').lean();

  for (const group of groups) {
    const migration = getMigration(context, {
      storageProvider: group.photoStorageProvider,
      storagePath: group.photoStoragePath,
      url: group.photo
    });
    if (!migration) continue;

    addBulk(context, 'Group', Group, {
      updateOne: {
        filter: { _id: group._id },
        update: {
          $set: {
            photo: migration.url,
            photoStoragePath: migration.objectPath,
            photoStorageProvider: 'r2'
          }
        }
      }
    });
    context.counters.records += 1;
  }
};

const collectStudentVerifications = async (context) => {
  const verifications = await StudentVerification.find({
    $or: [
      { documentStorageProvider: 'supabase' },
      { documentUrl: /\/storage\/v1\/object\// }
    ]
  }).select('documentUrl documentStoragePath documentStorageProvider mimeType').lean();

  for (const verification of verifications) {
    const migration = getMigration(context, {
      storageProvider: verification.documentStorageProvider,
      storagePath: verification.documentStoragePath,
      url: verification.documentUrl,
      mimeType: verification.mimeType
    });
    if (!migration) continue;

    addBulk(context, 'StudentVerification', StudentVerification, {
      updateOne: {
        filter: { _id: verification._id },
        update: {
          $set: {
            documentUrl: migration.url,
            documentStoragePath: migration.objectPath,
            documentStorageProvider: 'r2'
          }
        }
      }
    });
    context.counters.records += 1;
  }
};

const collectPosts = async (context) => {
  const posts = await Post.find({
    $or: [
      { storageProvider: 'supabase' },
      { fileUrl: /\/storage\/v1\/object\// },
      { 'attachments.storageProvider': 'supabase' },
      { 'attachments.fileUrl': /\/storage\/v1\/object\// }
    ]
  }).lean();

  for (const post of posts) {
    const $set = {};
    const primaryMigration = getMigration(context, {
      storageProvider: post.storageProvider,
      storagePath: post.storagePath,
      url: post.fileUrl,
      mimeType: post.mimeType
    });

    if (primaryMigration) {
      $set.fileUrl = primaryMigration.url;
      $set.storagePath = primaryMigration.objectPath;
      $set.storageProvider = 'r2';
    }

    const attachments = (post.attachments || []).map(attachment => {
      const migration = getMigration(context, {
        storageProvider: attachment.storageProvider,
        storagePath: attachment.storagePath,
        url: attachment.fileUrl,
        mimeType: attachment.mimeType
      });
      if (!migration) return attachment;
      return {
        ...attachment,
        fileUrl: migration.url,
        storagePath: migration.objectPath,
        storageProvider: 'r2'
      };
    });

    if (JSON.stringify(attachments) !== JSON.stringify(post.attachments || [])) {
      $set.attachments = attachments;
    }

    if (!Object.keys($set).length) continue;
    addBulk(context, 'Post', Post, {
      updateOne: {
        filter: { _id: post._id },
        update: { $set }
      }
    });
    context.counters.records += 1;
  }
};

const collectMessages = async (context) => {
  const messages = await Message.find({
    $or: [
      { storageProvider: 'supabase' },
      { fileUrl: /\/storage\/v1\/object\// },
      { 'attachments.storageProvider': 'supabase' },
      { 'attachments.fileUrl': /\/storage\/v1\/object\// }
    ]
  }).lean();

  for (const message of messages) {
    const $set = {};
    const primaryMigration = getMigration(context, {
      storageProvider: message.storageProvider,
      storagePath: message.storagePath,
      url: message.fileUrl,
      mimeType: message.mimeType
    });

    if (primaryMigration) {
      $set.fileUrl = primaryMigration.url;
      $set.storagePath = primaryMigration.objectPath;
      $set.storageProvider = 'r2';
    }

    const attachments = (message.attachments || []).map(attachment => {
      const migration = getMigration(context, {
        storageProvider: attachment.storageProvider,
        storagePath: attachment.storagePath,
        url: attachment.fileUrl,
        mimeType: attachment.mimeType
      });
      if (!migration) return attachment;
      return {
        ...attachment,
        fileUrl: migration.url,
        storagePath: migration.objectPath,
        storageProvider: 'r2'
      };
    });

    if (JSON.stringify(attachments) !== JSON.stringify(message.attachments || [])) {
      $set.attachments = attachments;
    }

    if (!Object.keys($set).length) continue;
    addBulk(context, 'Message', Message, {
      updateOne: {
        filter: { _id: message._id },
        update: { $set }
      }
    });
    context.counters.records += 1;
  }
};

const collectMarketplaceListings = async (context) => {
  const listings = await MarketplaceListing.find({
    $or: [
      { 'photos.storageProvider': 'supabase' },
      { 'photos.url': /\/storage\/v1\/object\// }
    ]
  }).lean();

  for (const listing of listings) {
    const photos = (listing.photos || []).map(photo => {
      const migration = getMigration(context, {
        storageProvider: photo.storageProvider,
        storagePath: photo.storagePath,
        url: photo.url,
        mimeType: photo.mimeType
      });
      if (!migration) return photo;
      return {
        ...photo,
        url: migration.url,
        storagePath: migration.objectPath,
        storageProvider: 'r2'
      };
    });

    if (JSON.stringify(photos) === JSON.stringify(listing.photos || [])) continue;
    addBulk(context, 'MarketplaceListing', MarketplaceListing, {
      updateOne: {
        filter: { _id: listing._id },
        update: { $set: { photos } }
      }
    });
    context.counters.records += 1;
  }
};

const collectReferences = async () => {
  const context = createMigrationContext();

  await Promise.all([
    collectSimpleModel(context, { name: 'File', Model: File, urlField: 'url' }),
    collectSimpleModel(context, { name: 'GalleryItem', Model: GalleryItem }),
    collectSimpleModel(context, { name: 'Memory', Model: Memory }),
    collectSimpleModel(context, { name: 'Story', Model: Story }),
    collectUsers(context),
    collectGroups(context),
    collectStudentVerifications(context),
    collectPosts(context),
    collectMessages(context),
    collectMarketplaceListings(context)
  ]);

  context.counters.files = context.references.size;
  return context;
};

const objectExistsInR2 = async (r2, objectPath) => {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: objectPath }));
    return true;
  } catch (err) {
    const statusCode = err?.$metadata?.httpStatusCode;
    if (statusCode === 404 || err.name === 'NotFound' || err.name === 'NoSuchKey') return false;
    throw err;
  }
};

const copyObjects = async (context) => {
  const source = supabase();
  const target = r2Client();
  const result = {
    copied: 0,
    skippedExisting: 0,
    skippedMissing: 0,
    failed: 0
  };

  for (const reference of context.references.values()) {
    try {
      if (!forceUpload && await objectExistsInR2(target, reference.objectPath)) {
        result.skippedExisting += 1;
        continue;
      }

      const { data, error } = await source.storage.from(supabaseBucket).download(reference.objectPath);
      if (error) throw new Error(error.message || 'Supabase download failed');

      const buffer = Buffer.from(await data.arrayBuffer());
      await target.send(new PutObjectCommand({
        Bucket: r2Bucket,
        Key: reference.objectPath,
        Body: buffer,
        ContentType: reference.mimeType || getExtensionMimeType(reference.objectPath),
        CacheControl: MEDIA_CACHE_CONTROL
      }));
      result.copied += 1;
      console.log(`Copied ${result.copied + result.skippedExisting}/${context.references.size}: ${reference.objectPath}`);
    } catch (err) {
      if (skipMissing && /not found|does not exist|404/i.test(err.message || '')) {
        result.skippedMissing += 1;
        console.warn(`Missing source skipped: ${reference.objectPath}`);
        continue;
      }
      result.failed += 1;
      console.error(`Copy failed: ${reference.objectPath} - ${err.message || err}`);
    }
  }

  return result;
};

const applyMongoUpdates = async (context) => {
  const result = {};
  for (const [name, batch] of context.bulks.entries()) {
    if (!batch.operations.length) continue;
    const writeResult = await batch.Model.bulkWrite(batch.operations, { ordered: false });
    result[name] = writeResult.modifiedCount || writeResult.upsertedCount || 0;
  }
  return result;
};

const main = async () => {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  requireConfig();

  await mongoose.connect(process.env.MONGODB_URI, withConfiguredMongoDatabaseName(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  }));

  const context = await collectReferences();
  console.log(`Supabase objects referenced: ${context.counters.files}`);
  console.log(`Mongo records to update: ${context.counters.records}`);
  console.log(`Mongo write operations: ${context.counters.mongoOps}`);

  if (dryRun) {
    console.log('\nDry-run only. No files were copied and MongoDB was not updated.');
    console.log(`Run with --confirm ${CONFIRMATION} to copy objects to R2 and update references.`);
    return;
  }

  if (!context.counters.files) {
    console.log('No Supabase storage references found. Nothing to migrate.');
    return;
  }

  const copyResult = await copyObjects(context);
  console.log(`R2 copy result: copied=${copyResult.copied}, existing=${copyResult.skippedExisting}, missing=${copyResult.skippedMissing}, failed=${copyResult.failed}`);

  if (copyResult.failed > 0 || copyResult.skippedMissing > 0) {
    console.error('MongoDB references were not updated because not all source objects were copied.');
    process.exitCode = 1;
    return;
  }

  const mongoResult = await applyMongoUpdates(context);
  console.log('MongoDB update result:');
  Object.entries(mongoResult)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([name, count]) => console.log(`  ${name}: ${count}`));
};

main()
  .catch(err => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
