#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

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
const { withConfiguredMongoDatabaseName } = require('../utils/mongo');
const {
  getObjectUrl,
  getStorageConfigStatus,
  objectExists,
  uploadObjectBuffer
} = require('../services/storage');

const CONFIRMATION = 'REPAIR_LOCAL_MEDIA_TO_R2';
const args = process.argv.slice(2);
const confirmIndex = args.indexOf('--confirm');
const isConfirmed = confirmIndex !== -1 && args[confirmIndex + 1] === CONFIRMATION;
const dryRun = args.includes('--dry-run') || !isConfirmed;
const forceUpload = args.includes('--force');
const uploadsRoot = path.resolve(__dirname, '..', 'uploads');
const localUploadRegex = /^(?:\/uploads\/(?!r2\/)|https?:\/\/[^/]+\/uploads\/(?!r2\/))/i;

const sources = [
  { name: 'User avatar', Model: User, urlField: 'avatar', pathField: 'avatarStoragePath', providerField: 'avatarStorageProvider' },
  { name: 'User cover', Model: User, urlField: 'coverPhoto', pathField: 'coverPhotoStoragePath', providerField: 'coverPhotoStorageProvider' },
  { name: 'Group photo', Model: Group, urlField: 'photo', pathField: 'photoStoragePath', providerField: 'photoStorageProvider' },
  { name: 'Post media', Model: Post, urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { name: 'Post attachments', Model: Post, arrayField: 'attachments', urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { name: 'Message media', Model: Message, urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { name: 'Message attachments', Model: Message, arrayField: 'attachments', urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { name: 'Story media', Model: Story, urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { name: 'Gallery media', Model: GalleryItem, urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { name: 'Group memory', Model: Memory, urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { name: 'Group file', Model: File, urlField: 'url', pathField: 'storagePath', providerField: 'storageProvider' },
  { name: 'Marketplace photos', Model: MarketplaceListing, arrayField: 'photos', urlField: 'url', pathField: 'storagePath', providerField: 'storageProvider' },
  { name: 'Student verification', Model: StudentVerification, urlField: 'documentUrl', pathField: 'documentStoragePath', providerField: 'documentStorageProvider' }
];

const printUsage = () => {
  console.log(`Usage:
  npm run storage:repair:local-r2 -- --dry-run
  npm run storage:repair:local-r2 -- --confirm ${CONFIRMATION}

Options:
  --force  Re-upload objects even if the same key already exists in R2.

Default mode is dry-run. Confirmed mode copies local backend/uploads files into
R2 using the same object path, then updates MongoDB media URLs/providers to R2.
Local files are left on disk as a fallback.
`);
};

const cleanLocalPath = (value = '') => {
  const cleaned = String(value || '').trim().replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('\0')) return '';
  if (cleaned.split('/').some(part => part === '..')) return '';
  return cleaned;
};

const localPathFromUrl = (url = '') => {
  const raw = String(url || '').trim();
  if (!raw || raw.startsWith('/uploads/r2/')) return '';

  try {
    const parsed = new URL(raw, 'http://syncrova.local');
    const marker = '/uploads/';
    if (!parsed.pathname.startsWith(marker) || parsed.pathname.startsWith('/uploads/r2/')) return '';
    return cleanLocalPath(decodeURIComponent(parsed.pathname.slice(marker.length)));
  } catch {
    return '';
  }
};

const getLocalPath = ({ url = '', storagePath = '', storageProvider = '' } = {}) => {
  const provider = String(storageProvider || '').trim();
  const pathCandidate = provider === 'local' ? cleanLocalPath(storagePath) : '';
  return pathCandidate || localPathFromUrl(url);
};

const getMimeType = (objectPath = '') => {
  const ext = path.extname(objectPath).toLowerCase();
  const map = {
    '.aac': 'audio/aac',
    '.gif': 'image/gif',
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

const getLocalFilePath = (localPath) => {
  const target = path.join(uploadsRoot, localPath);
  if (!target.startsWith(`${uploadsRoot}${path.sep}`)) return '';
  return target;
};

const createContext = () => ({
  references: new Map(),
  bulks: new Map(),
  counters: {
    records: 0,
    mongoOps: 0
  }
});

const addReference = (context, localPath, sourceName, docId, mimeType = '') => {
  const cleanPath = cleanLocalPath(localPath);
  if (!cleanPath) return null;
  if (!context.references.has(cleanPath)) {
    context.references.set(cleanPath, {
      localPath: cleanPath,
      mimeType: mimeType || getMimeType(cleanPath),
      references: []
    });
  }
  const reference = context.references.get(cleanPath);
  reference.references.push({ source: sourceName, id: String(docId) });
  return reference;
};

const addBulk = (context, name, Model, operation) => {
  if (!context.bulks.has(name)) context.bulks.set(name, { Model, operations: [] });
  context.bulks.get(name).operations.push(operation);
  context.counters.mongoOps += 1;
};

const buildQuery = (source) => {
  const query = {
    $or: [
      { [source.providerField]: 'local' },
      { [source.urlField]: localUploadRegex }
    ]
  };
  return source.arrayField ? { [source.arrayField]: { $elemMatch: query } } : query;
};

const getFieldList = (source) => {
  const fields = [source.urlField, source.pathField, source.providerField, 'mimeType', 'fileType', 'fileName', 'originalName'];
  if (!source.arrayField) return fields.join(' ');
  return `${source.arrayField}.${fields.join(` ${source.arrayField}.`)}`;
};

const collectSimple = async (context, source) => {
  const docs = await source.Model.find(buildQuery(source)).select(getFieldList(source)).lean();

  for (const doc of docs) {
    const localPath = getLocalPath({
      url: doc[source.urlField],
      storagePath: doc[source.pathField],
      storageProvider: doc[source.providerField]
    });
    if (!localPath) continue;
    addReference(context, localPath, source.name, doc._id, doc.mimeType);
    addBulk(context, source.name, source.Model, {
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            [source.urlField]: getObjectUrl('r2', localPath),
            [source.pathField]: localPath,
            [source.providerField]: 'r2'
          }
        }
      }
    });
    context.counters.records += 1;
  }
};

const collectArray = async (context, source) => {
  const docs = await source.Model.find(buildQuery(source)).select(getFieldList(source)).lean();

  for (const doc of docs) {
    let changed = false;
    const items = (doc[source.arrayField] || []).map(item => {
      const localPath = getLocalPath({
        url: item[source.urlField],
        storagePath: item[source.pathField],
        storageProvider: item[source.providerField]
      });
      if (!localPath) return item;
      changed = true;
      addReference(context, localPath, source.name, doc._id, item.mimeType);
      return {
        ...item,
        [source.urlField]: getObjectUrl('r2', localPath),
        [source.pathField]: localPath,
        [source.providerField]: 'r2'
      };
    });

    if (!changed) continue;
    addBulk(context, source.name, source.Model, {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { [source.arrayField]: items } }
      }
    });
    context.counters.records += 1;
  }
};

const collectReferences = async () => {
  const context = createContext();
  for (const source of sources) {
    if (source.arrayField) {
      await collectArray(context, source);
    } else {
      await collectSimple(context, source);
    }
  }
  return context;
};

const checkLocalFiles = (context) => {
  const result = { present: 0, missing: 0, invalid: 0, missingFiles: [] };
  for (const reference of context.references.values()) {
    const localFilePath = getLocalFilePath(reference.localPath);
    if (!localFilePath) {
      result.invalid += 1;
      result.missingFiles.push(reference.localPath);
      continue;
    }
    if (fs.existsSync(localFilePath)) {
      result.present += 1;
    } else {
      result.missing += 1;
      result.missingFiles.push(reference.localPath);
    }
  }
  return result;
};

const copyObjects = async (context) => {
  const result = { copied: 0, skippedExisting: 0, failed: 0 };

  for (const reference of context.references.values()) {
    const localFilePath = getLocalFilePath(reference.localPath);
    if (!localFilePath || !fs.existsSync(localFilePath)) {
      result.failed += 1;
      console.error(`Missing local file: ${reference.localPath}`);
      continue;
    }

    try {
      if (!forceUpload && await objectExists(reference.localPath, { provider: 'r2' })) {
        result.skippedExisting += 1;
        continue;
      }

      const buffer = await fs.promises.readFile(localFilePath);
      await uploadObjectBuffer({
        buffer,
        objectPath: reference.localPath,
        mimeType: reference.mimeType || getMimeType(reference.localPath),
        provider: 'r2'
      });
      result.copied += 1;
      console.log(`Copied ${result.copied + result.skippedExisting}/${context.references.size}: ${reference.localPath}`);
    } catch (err) {
      result.failed += 1;
      console.error(`Copy failed: ${reference.localPath} - ${err.message || err}`);
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

const requireConfig = () => {
  const status = getStorageConfigStatus();
  const missing = [
    !process.env.MONGODB_URI && 'MONGODB_URI',
    ...status.missing
  ].filter(Boolean);
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`);
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
  const localFiles = checkLocalFiles(context);
  console.log(`Local media objects referenced: ${context.references.size}`);
  console.log(`Mongo records to update: ${context.counters.records}`);
  console.log(`Mongo write operations: ${context.counters.mongoOps}`);
  console.log(`Local files: present=${localFiles.present}, missing=${localFiles.missing}, invalid=${localFiles.invalid}`);
  if (localFiles.missingFiles.length) {
    console.log('Missing local file samples:');
    localFiles.missingFiles.slice(0, 12).forEach(item => console.log(`  ${item}`));
  }

  if (dryRun) {
    console.log('\nDry-run only. No files were copied and MongoDB was not updated.');
    console.log(`Run with --confirm ${CONFIRMATION} to copy local media into R2 and update references.`);
    return;
  }

  if (!context.references.size) {
    console.log('No local media references found. Nothing to repair.');
    return;
  }

  if (localFiles.missing > 0 || localFiles.invalid > 0) {
    console.error('MongoDB references were not updated because some local source files are missing or invalid.');
    process.exitCode = 1;
    return;
  }

  const copyResult = await copyObjects(context);
  console.log(`R2 copy result: copied=${copyResult.copied}, existing=${copyResult.skippedExisting}, failed=${copyResult.failed}`);
  if (copyResult.failed > 0) {
    console.error('MongoDB references were not updated because not all local objects were copied.');
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
