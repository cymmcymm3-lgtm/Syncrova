const mongoose = require('mongoose');
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
const {
  deleteObject,
  getStorageConfigStatus,
  isCloudStorageEnabled,
  objectExists,
  readObjectBuffer,
  uploadBuffer
} = require('./storage');

const presentString = { $exists: true, $nin: ['', null] };
const supabaseUrlRegex = /\/storage\/v1\/object\//i;
const localhostUploadRegex = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/uploads\//i;
const absoluteUploadRegex = /^https?:\/\/[^/]+\/uploads\//i;
const localUploadRegex = /^(?:\/uploads\/(?!r2\/)|https?:\/\/[^/]+\/uploads\/(?!r2\/))/i;

const mediaSources = [
  { label: 'User avatar', Model: User, urlField: 'avatar', pathField: 'avatarStoragePath', providerField: 'avatarStorageProvider' },
  { label: 'User cover', Model: User, urlField: 'coverPhoto', pathField: 'coverPhotoStoragePath', providerField: 'coverPhotoStorageProvider' },
  { label: 'Group photo', Model: Group, urlField: 'photo', pathField: 'photoStoragePath', providerField: 'photoStorageProvider' },
  { label: 'Post media', Model: Post, urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { label: 'Post attachments', Model: Post, arrayField: 'attachments', urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { label: 'Message media', Model: Message, urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { label: 'Message attachments', Model: Message, arrayField: 'attachments', urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { label: 'Story media', Model: Story, urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { label: 'Gallery media', Model: GalleryItem, urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { label: 'Group memory', Model: Memory, urlField: 'fileUrl', pathField: 'storagePath', providerField: 'storageProvider' },
  { label: 'Group file', Model: File, urlField: 'url', pathField: 'storagePath', providerField: 'storageProvider' },
  { label: 'Marketplace photos', Model: MarketplaceListing, arrayField: 'photos', urlField: 'url', pathField: 'storagePath', providerField: 'storageProvider' },
  { label: 'Student verification', Model: StudentVerification, urlField: 'documentUrl', pathField: 'documentStoragePath', providerField: 'documentStorageProvider' }
];

const buildQuery = (source, conditions = {}) => (
  source.arrayField
    ? { [source.arrayField]: { $elemMatch: conditions } }
    : conditions
);

const countSource = (source, conditions) => source.Model.countDocuments(buildQuery(source, conditions));

const addCounts = (target, counts = {}) => {
  Object.entries(counts).forEach(([key, value]) => {
    target[key] = (target[key] || 0) + Number(value || 0);
  });
};

const getSourceDiagnostics = async (source) => {
  const urlPresent = { [source.urlField]: presentString };
  const providerBlank = {
    $or: [
      { [source.providerField]: '' },
      { [source.providerField]: null },
      { [source.providerField]: { $exists: false } }
    ]
  };
  const pathBlank = {
    $or: [
      { [source.pathField]: '' },
      { [source.pathField]: null },
      { [source.pathField]: { $exists: false } }
    ]
  };

  const [
    withUrl,
    r2,
    local,
    supabase,
    blankProvider,
    missingPath,
    legacySupabase,
    legacyLocalhost,
    absoluteUploads,
    localReferences
  ] = await Promise.all([
    countSource(source, urlPresent),
    countSource(source, { [source.providerField]: 'r2' }),
    countSource(source, { [source.providerField]: 'local' }),
    countSource(source, { [source.providerField]: 'supabase' }),
    countSource(source, { ...urlPresent, ...providerBlank }),
    countSource(source, { ...urlPresent, ...pathBlank }),
    countSource(source, { [source.urlField]: supabaseUrlRegex }),
    countSource(source, { [source.urlField]: localhostUploadRegex }),
    countSource(source, { [source.urlField]: absoluteUploadRegex }),
    countSource(source, {
      $or: [
        { [source.providerField]: 'local' },
        { [source.urlField]: localUploadRegex }
      ]
    })
  ]);

  return {
    label: source.label,
    withUrl,
    providers: { r2, local, supabase, blank: blankProvider },
    legacy: { supabase: legacySupabase, localhost: legacyLocalhost, absoluteUploads },
    missing: { path: missingPath },
    localReferences
  };
};

const getFieldList = (source) => {
  const fields = [source.urlField, source.pathField, source.providerField, 'mimeType', 'fileType', 'fileName', 'originalName'];
  if (!source.arrayField) return fields.join(' ');
  return `${source.arrayField}.${fields.join(` ${source.arrayField}.`)}`;
};

const getNestedValue = (item, field) => item?.[field];

const collectR2Samples = async (limit = 10) => {
  const samples = [];

  for (const source of mediaSources) {
    if (samples.length >= limit) break;

    const docs = await source.Model.find(buildQuery(source, {
      [source.providerField]: 'r2',
      [source.pathField]: presentString
    }))
      .select(getFieldList(source))
      .limit(limit)
      .lean();

    for (const doc of docs) {
      const items = source.arrayField ? (doc[source.arrayField] || []) : [doc];
      for (const item of items) {
        const provider = getNestedValue(item, source.providerField);
        const storagePath = getNestedValue(item, source.pathField);
        if (provider !== 'r2' || !storagePath) continue;
        samples.push({
          label: source.label,
          id: String(doc._id),
          storagePath,
          url: getNestedValue(item, source.urlField) || '',
          mimeType: getNestedValue(item, 'mimeType') || ''
        });
        if (samples.length >= limit) break;
      }
      if (samples.length >= limit) break;
    }
  }

  return samples;
};

const checkBrokenR2Samples = async (limit = 10) => {
  const samples = await collectR2Samples(limit);
  const checked = [];
  const broken = [];

  for (const sample of samples) {
    const exists = await objectExists(sample.storagePath, { provider: 'r2' });
    const result = { ...sample, exists };
    checked.push(result);
    if (!exists) broken.push(result);
  }

  return { checked, broken };
};

const getMediaDiagnostics = async ({ includeBrokenCheck = false, brokenLimit = 10 } = {}) => {
  if (mongoose.connection.readyState !== 1) {
    return {
      status: 'database-unavailable',
      checkedAt: new Date().toISOString(),
      message: 'MongoDB is not connected, so media records could not be scanned.'
    };
  }

  const sources = await Promise.all(mediaSources.map(getSourceDiagnostics));
  const totals = {
    withUrl: 0,
    providers: { r2: 0, local: 0, supabase: 0, blank: 0 },
    legacy: { supabase: 0, localhost: 0, absoluteUploads: 0 },
    missing: { path: 0 },
    localReferences: 0
  };

  for (const source of sources) {
    totals.withUrl += source.withUrl;
    addCounts(totals.providers, source.providers);
    addCounts(totals.legacy, source.legacy);
    addCounts(totals.missing, source.missing);
    totals.localReferences += source.localReferences;
  }

  const diagnostics = {
    status: 'ok',
    checkedAt: new Date().toISOString(),
    totals,
    sources,
    recommendations: []
  };

  if (totals.providers.supabase > 0 || totals.legacy.supabase > 0) {
    diagnostics.recommendations.push('Run npm run storage:migrate:r2 -- --dry-run, then confirm after reviewing the report.');
  }
  if (totals.localReferences > 0) {
    diagnostics.recommendations.push('Run npm run storage:repair:local-r2 -- --dry-run to inventory local media that should be copied to R2.');
  }
  if (totals.legacy.localhost > 0) {
    diagnostics.recommendations.push('Repair localhost media URLs before shipping the mobile APK; native apps cannot read localhost from the backend machine.');
  }
  if (totals.missing.path > 0 || totals.providers.blank > 0) {
    diagnostics.recommendations.push('Backfill storageProvider and storagePath for media records with URLs but missing metadata.');
  }

  if (includeBrokenCheck) {
    try {
      diagnostics.r2Samples = await checkBrokenR2Samples(brokenLimit);
    } catch (err) {
      diagnostics.r2Samples = {
        checked: [],
        broken: [],
        error: err.message || 'R2 sample check failed'
      };
    }
  }

  return diagnostics;
};

const runStorageProbe = async () => {
  const status = getStorageConfigStatus();
  if (status.missing.length) {
    return {
      ok: false,
      status: 'missing-config',
      missing: status.missing,
      message: `Missing required env: ${status.missing.join(', ')}`
    };
  }
  if (!isCloudStorageEnabled) {
    return {
      ok: false,
      status: 'cloud-disabled',
      message: 'Cloud storage is not enabled.'
    };
  }

  let uploaded = null;
  try {
    uploaded = await uploadBuffer({
      buffer: Buffer.from(`Syncrova media probe ${new Date().toISOString()}`),
      originalName: 'media-probe.txt',
      mimeType: 'text/plain',
      folder: 'healthchecks'
    });
    const object = await readObjectBuffer(uploaded.path, { provider: uploaded.provider });
    return {
      ok: object.length > 0,
      status: object.length > 0 ? 'ok' : 'empty-read',
      provider: uploaded.provider,
      path: uploaded.path,
      bytes: object.length,
      url: uploaded.url
    };
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      message: err.message || 'Storage probe failed'
    };
  } finally {
    if (uploaded?.path) {
      await deleteObject(uploaded.path, { provider: uploaded.provider }).catch(() => {});
    }
  }
};

module.exports = {
  getMediaDiagnostics,
  runStorageProbe
};
