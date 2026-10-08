const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');

const uploadsRoot = path.resolve(__dirname, '..', 'uploads');
const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const cleanEnv = (value = '') => String(value || '').trim();

const supabaseBucket = cleanEnv(
  process.env.SUPABASE_BUCKET
  || process.env.SUPABASE_STORAGE_BUCKET
  || process.env.SUPABASE_BUCKET_NAME
);

const r2AccountId = cleanEnv(process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID);
const r2AccessKeyId = cleanEnv(
  process.env.R2_ACCESS_KEY_ID
  || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID
  || process.env.AWS_ACCESS_KEY_ID
  || process.env.S3_ACCESS_KEY_ID
);
const r2SecretAccessKey = cleanEnv(
  process.env.R2_SECRET_ACCESS_KEY
  || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
  || process.env.AWS_SECRET_ACCESS_KEY
  || process.env.S3_SECRET_ACCESS_KEY
);
const r2Bucket = cleanEnv(
  process.env.R2_BUCKET_NAME
  || process.env.R2_BUCKET
  || process.env.CLOUDFLARE_R2_BUCKET_NAME
  || process.env.AWS_BUCKET_NAME
  || process.env.AWS_S3_BUCKET
  || process.env.S3_BUCKET_NAME
  || process.env.S3_BUCKET
);
const r2Endpoint = cleanEnv(
  process.env.R2_ENDPOINT
  || process.env.CLOUDFLARE_R2_ENDPOINT
  || process.env.AWS_ENDPOINT_URL
  || process.env.S3_ENDPOINT_URL
  || process.env.S3_ENDPOINT
  || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '')
).replace(/\/+$/, '');
const r2PublicBaseUrl = cleanEnv(
  process.env.R2_PUBLIC_URL
  || process.env.R2_PUBLIC_BASE_URL
  || process.env.CLOUDFLARE_R2_PUBLIC_URL
).replace(/\/+$/, '');

const requestedStorageProvider = cleanEnv(
  process.env.STORAGE_PROVIDER
  || process.env.STORAGE_DRIVER
  || process.env.UPLOAD_STORAGE_PROVIDER
).toLowerCase();

const normalizeProvider = (value = '') => {
  const provider = cleanEnv(value).toLowerCase();
  if (['local', 'disk', 'filesystem', 'file'].includes(provider)) return 'local';
  if (['r2', 'cloudflare', 'cloudflare-r2', 'cloudflare_r2', 's3-r2'].includes(provider)) return 'r2';
  if (['supabase', 'supabase-storage', 'supabase_storage'].includes(provider)) return 'supabase';
  return provider;
};

const requestedProvider = normalizeProvider(requestedStorageProvider);
const forceLocalStorage = requestedProvider === 'local';
const isHostedRuntime = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const localFallbackSetting = cleanEnv(process.env.STORAGE_LOCAL_FALLBACK).toLowerCase();
const allowLocalFallback = localFallbackSetting
  ? !['false', '0', 'no', 'off'].includes(localFallbackSetting)
  : false;
const isR2Configured = Boolean(r2Endpoint && r2AccessKeyId && r2SecretAccessKey && r2Bucket);

const getActiveCloudProvider = () => {
  if (forceLocalStorage) return 'local';
  if (requestedProvider === 'r2') return 'r2';
  if (requestedProvider === 'supabase') return 'r2';
  if (isR2Configured) return 'r2';
  if (isHostedRuntime) return 'r2';
  return 'local';
};

const cloudStorageProvider = getActiveCloudProvider();
const isCloudStorageEnabled = cloudStorageProvider !== 'local';

const r2 = isR2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: r2Endpoint,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey
      }
    })
  : null;

const normalizeFolder = (folder = '') => folder
  .split('/')
  .map(part => part.trim().replace(/[^a-zA-Z0-9_-]/g, '-'))
  .filter(Boolean)
  .join('/');

const safeExtension = (filename = '') => {
  const ext = path.extname(filename).toLowerCase().replace(/[^.\w]/g, '');
  return ext || '';
};

const createObjectPath = (folder, originalName) => {
  const cleanFolder = normalizeFolder(folder);
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExtension(originalName)}`;
  return {
    filename,
    objectPath: cleanFolder ? `${cleanFolder}/${filename}` : filename
  };
};

const isRecoverableCloudStorageError = (error = {}) => {
  const message = [
    error.message,
    error.error,
    error.name,
    error.code,
    error.statusCode,
    error.status,
    error.details,
    error.hint,
    typeof error === 'string' ? error : ''
  ].filter(Boolean).join(' ').toLowerCase();
  return [
    'exceed_cached_egress_quota',
    'exceeded_cached_egress_quota',
    'cached egress',
    'egress quota',
    'quota',
    'limit exceeded',
    'resource exhausted',
    'rate limit',
    'too many requests'
  ].some(pattern => message.includes(pattern));
};

const localPathFromObjectPath = (objectPath = '') => (
  objectPath
    .split('/')
    .map(part => part.trim().replace(/[^a-zA-Z0-9._-]/g, '-'))
    .filter(Boolean)
    .join('/')
);

const cleanObjectPath = (objectPath = '') => {
  const cleaned = cleanEnv(objectPath).replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('\0')) return '';
  if (cleaned.split('/').some(part => part === '..')) return '';
  return cleaned;
};

const encodeObjectPath = (objectPath = '') => cleanObjectPath(objectPath)
  .split('/')
  .map(part => encodeURIComponent(part))
  .join('/');

const getSupabaseObjectPathFromUrl = (url = '') => {
  const raw = cleanEnv(url);
  if (!raw) return '';

  try {
    const pathname = new URL(raw).pathname;
    const markers = supabaseBucket
      ? [
          `/storage/v1/object/public/${supabaseBucket}/`,
          `/storage/v1/object/sign/${supabaseBucket}/`,
          `/storage/v1/object/${supabaseBucket}/`
        ]
      : [
          '/storage/v1/object/public/',
          '/storage/v1/object/sign/',
          '/storage/v1/object/'
        ];
    const marker = markers.find(value => pathname.includes(value));
    if (!marker) return '';
    let objectPath = pathname.slice(pathname.indexOf(marker) + marker.length);
    if (!supabaseBucket) objectPath = objectPath.split('/').slice(1).join('/');
    return cleanObjectPath(decodeURIComponent(objectPath));
  } catch {
    return '';
  }
};

const streamToBuffer = async (body) => {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const logStorageEvent = (event, details = {}) => {
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined && value !== '')
  );
  console.info(`[storage] ${event}`, safeDetails);
};

const uploadBufferLocally = async ({ buffer, originalName, folder }) => {
  const { filename, objectPath } = createObjectPath(folder, originalName);
  const localPath = localPathFromObjectPath(objectPath);
  const targetPath = path.join(uploadsRoot, localPath);

  if (!targetPath.startsWith(`${uploadsRoot}${path.sep}`)) {
    throw new Error('Invalid local upload path');
  }

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, buffer);
  logStorageEvent('local-upload-ok', {
    provider: 'local',
    path: localPath.replace(/\\/g, '/'),
    bytes: buffer.length
  });

  return {
    filename,
    path: localPath.replace(/\\/g, '/'),
    provider: 'local',
    url: `/uploads/${localPath.replace(/\\/g, '/')}`
  };
};

const getObjectUrl = (provider, objectPath) => {
  const storageProvider = normalizeProvider(provider);
  const storedPath = cleanObjectPath(objectPath);
  if (!storedPath) return '';

  if (storageProvider === 'r2' || storageProvider === 'supabase') {
    const encodedPath = encodeObjectPath(storedPath);
    return `/uploads/r2/${encodedPath}`;
  }

  if (storageProvider === 'local') {
    return `/uploads/${storedPath}`;
  }

  return '';
};

const ensureCloudProvider = (provider) => {
  const storageProvider = normalizeProvider(provider || cloudStorageProvider);
  if (storageProvider === 'r2' || storageProvider === 'supabase') {
    if (!isR2Configured || !r2) throw new Error('Cloudflare R2 storage is not configured');
    return 'r2';
  }
  throw new Error('Cloud storage is not configured');
};

const uploadObjectBuffer = async ({ buffer, objectPath, mimeType, provider = cloudStorageProvider }) => {
  const storageProvider = ensureCloudProvider(provider);
  const storedPath = cleanObjectPath(objectPath);
  if (!storedPath) throw new Error('Invalid cloud object path');

  if (storageProvider === 'r2') {
    await r2.send(new PutObjectCommand({
      Bucket: r2Bucket,
      Key: storedPath,
      Body: buffer,
      ContentType: mimeType || 'application/octet-stream',
      CacheControl: MEDIA_CACHE_CONTROL
    }));
    const head = await r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: storedPath }));

    logStorageEvent('r2-upload-ok', {
      provider: 'r2',
      path: storedPath,
      bytes: head.ContentLength ?? buffer.length,
      contentType: head.ContentType || mimeType || 'application/octet-stream'
    });

    return {
      path: storedPath,
      provider: 'r2',
      url: getObjectUrl('r2', storedPath),
      etag: head.ETag || '',
      size: head.ContentLength ?? buffer.length
    };
  }

  throw new Error('Cloudflare R2 storage is not configured');
};

const uploadBuffer = async ({ buffer, originalName, mimeType, folder }) => {
  if (!isCloudStorageEnabled) {
    throw new Error('Cloud storage is not configured');
  }

  const { filename, objectPath } = createObjectPath(folder, originalName);
  try {
    const uploaded = await uploadObjectBuffer({
      buffer,
      objectPath,
      mimeType,
      provider: cloudStorageProvider
    });

    return {
      filename,
      ...uploaded
    };
  } catch (error) {
    if (allowLocalFallback && isRecoverableCloudStorageError(error)) {
      const fallback = await uploadBufferLocally({ buffer, originalName, folder });
      fallback.fallbackReason = error.message || 'Cloud upload failed';
      return fallback;
    }

    throw error;
  }
};

const deleteLocalObject = async (objectPath) => {
  const localPath = localPathFromObjectPath(objectPath);
  const targetPath = path.join(uploadsRoot, localPath);
  if (!targetPath.startsWith(`${uploadsRoot}${path.sep}`) || !fs.existsSync(targetPath)) {
    return false;
  }

  await fs.promises.unlink(targetPath).catch(() => {});
  return true;
};

const deleteObject = async (objectPath, options = {}) => {
  const storedPath = cleanObjectPath(objectPath);
  if (!storedPath) return;

  const requestedDeleteProvider = normalizeProvider(options.provider || '');
  if (requestedDeleteProvider === 'local') {
    await deleteLocalObject(storedPath);
    logStorageEvent('local-delete-ok', { provider: 'local', path: storedPath });
    return;
  }

  if (!requestedDeleteProvider) {
    const deletedLocal = await deleteLocalObject(storedPath);
    if (deletedLocal) return;
  }

  const storageProvider = ensureCloudProvider(requestedDeleteProvider || cloudStorageProvider);
  if (storageProvider === 'r2') {
    await r2.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: storedPath }));
    logStorageEvent('r2-delete-ok', { provider: 'r2', path: storedPath });
    return;
  }

  throw new Error('Cloudflare R2 storage is not configured');
};

const objectExists = async (objectPath, options = {}) => {
  const storedPath = cleanObjectPath(objectPath);
  if (!storedPath) return false;

  const storageProvider = normalizeProvider(options.provider || cloudStorageProvider);
  if (storageProvider === 'local') {
    const localPath = localPathFromObjectPath(storedPath);
    const targetPath = path.join(uploadsRoot, localPath);
    return targetPath.startsWith(`${uploadsRoot}${path.sep}`) && fs.existsSync(targetPath);
  }

  const cloudProvider = ensureCloudProvider(storageProvider);
  if (cloudProvider === 'r2') {
    try {
      await r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: storedPath }));
      return true;
    } catch (err) {
      const statusCode = err?.$metadata?.httpStatusCode;
      if (statusCode === 404 || err.name === 'NoSuchKey' || err.name === 'NotFound') return false;
      throw err;
    }
  }

  return false;
};

const readObjectBuffer = async (objectPath, options = {}) => {
  const storedPath = cleanObjectPath(objectPath);
  if (!storedPath) throw new Error('Invalid object path');

  const storageProvider = normalizeProvider(options.provider || cloudStorageProvider);
  if (storageProvider === 'local') {
    const localPath = localPathFromObjectPath(storedPath);
    const targetPath = path.join(uploadsRoot, localPath);
    if (!targetPath.startsWith(`${uploadsRoot}${path.sep}`)) throw new Error('Invalid local object path');
    return fs.promises.readFile(targetPath);
  }

  const cloudProvider = ensureCloudProvider(storageProvider);
  if (cloudProvider === 'r2') {
    const result = await r2.send(new GetObjectCommand({ Bucket: r2Bucket, Key: storedPath }));
    return streamToBuffer(result.Body);
  }

  throw new Error('Cloudflare R2 storage is not configured');
};

const setObjectResponseHeaders = (res, result = {}) => {
  if (result.ContentType) res.setHeader('Content-Type', result.ContentType);
  if (result.ContentLength !== undefined) res.setHeader('Content-Length', String(result.ContentLength));
  if (result.ContentRange) res.setHeader('Content-Range', result.ContentRange);
  if (result.ETag) res.setHeader('ETag', result.ETag);
  if (result.LastModified) res.setHeader('Last-Modified', new Date(result.LastModified).toUTCString());
  res.setHeader('Accept-Ranges', result.AcceptRanges || 'bytes');
  res.setHeader('Cache-Control', MEDIA_CACHE_CONTROL);
};

const getRouteObjectPath = (req) => {
  const rawValue = Array.isArray(req.params)
    ? req.params[0]
    : req.params?.[0] || req.params?.objectPath || '';
  try {
    return cleanObjectPath(String(rawValue || '').split('/').map(part => decodeURIComponent(part)).join('/'));
  } catch {
    return '';
  }
};

const serveR2Object = async (req, res, next) => {
  if (!isR2Configured || !r2) return next();

  const storedPath = getRouteObjectPath(req);
  if (!storedPath) return res.status(400).json({ msg: 'Invalid storage object path' });

  try {
    if (req.method === 'HEAD') {
      const head = await r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: storedPath }));
      setObjectResponseHeaders(res, head);
      return res.end();
    }

    const range = cleanEnv(req.headers.range);
    const result = await r2.send(new GetObjectCommand({
      Bucket: r2Bucket,
      Key: storedPath,
      ...(range.startsWith('bytes=') ? { Range: range } : {})
    }));

    if (result.ContentRange) res.status(206);
    setObjectResponseHeaders(res, result);
    if (!result.Body) return res.end();
    result.Body.on('error', (error) => {
      if (!res.headersSent) return next(error);
      res.destroy(error);
    });
    res.on('close', () => {
      if (!res.writableEnded && typeof result.Body.destroy === 'function') {
        result.Body.destroy();
      }
    });
    return result.Body.pipe(res);
  } catch (err) {
    const statusCode = err?.$metadata?.httpStatusCode;
    if (statusCode === 404 || err.name === 'NoSuchKey' || err.name === 'NotFound') {
      return res.status(404).json({ msg: 'File not found' });
    }
    if (statusCode === 416 || err.name === 'InvalidRange') {
      return res.status(416).json({ msg: 'Requested range is not satisfiable' });
    }
    return next(err);
  }
};

const getMissingConfig = () => {
  if (cloudStorageProvider === 'r2') {
    return [
      !r2Endpoint && 'R2_ENDPOINT or R2_ACCOUNT_ID',
      !r2AccessKeyId && 'R2_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID',
      !r2SecretAccessKey && 'R2_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY',
      !r2Bucket && 'R2_BUCKET_NAME or S3_BUCKET_NAME'
    ].filter(Boolean);
  }

  if (!isCloudStorageEnabled) {
    return [
      !r2Endpoint && 'R2_ENDPOINT or R2_ACCOUNT_ID',
      !r2AccessKeyId && 'R2_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID',
      !r2SecretAccessKey && 'R2_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY',
      !r2Bucket && 'R2_BUCKET_NAME or S3_BUCKET_NAME'
    ].filter(Boolean);
  }

  return [];
};

const getStorageConfigStatus = () => {
  const missing = getMissingConfig();

  return {
    provider: cloudStorageProvider,
    requestedProvider: requestedStorageProvider || 'auto',
    forceLocalStorage,
    hostedRuntime: isHostedRuntime,
    enabled: isCloudStorageEnabled,
    configured: missing.length === 0,
    localFallbackEnabled: allowLocalFallback,
    bucket: cloudStorageProvider === 'r2' ? r2Bucket : '',
    r2Bucket,
    r2EndpointConfigured: Boolean(r2Endpoint),
    r2AccessKeyConfigured: Boolean(r2AccessKeyId),
    r2SecretAccessKeyConfigured: Boolean(r2SecretAccessKey),
    r2PublicUrlConfigured: Boolean(r2PublicBaseUrl),
    legacySupabaseBucketConfigured: Boolean(supabaseBucket),
    status: missing.length
      ? `${cloudStorageProvider} cloud missing config`
      : isCloudStorageEnabled
        ? `${cloudStorageProvider} cloud enabled`
        : 'local uploads',
    missing
  };
};

module.exports = {
  cloudStorageProvider,
  deleteObject,
  getObjectUrl,
  getSupabaseObjectPathFromUrl,
  getStorageConfigStatus,
  isCloudStorageEnabled,
  objectExists,
  readObjectBuffer,
  serveR2Object,
  uploadBuffer,
  uploadObjectBuffer
};
