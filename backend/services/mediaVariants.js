const fs = require('fs');
const path = require('path');
const { isCloudStorageEnabled, uploadObjectBuffer } = require('./storage');

const uploadsRoot = path.resolve(__dirname, '..', 'uploads');
const IMAGE_VARIANTS = [
  { key: 'thumb', width: 320, quality: 72 },
  { key: 'feed', width: 1280, quality: 82 },
  { key: 'large', width: 2048, quality: 88 }
];

let sharp = null;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

const isSupportedImage = (file = {}) => {
  const mimeType = String(file.mimetype || '').toLowerCase();
  return mimeType.startsWith('image/')
    && mimeType !== 'image/gif'
    && mimeType !== 'image/svg+xml';
};

const stripExtension = (value = '') => {
  const ext = path.extname(value);
  return ext ? value.slice(0, -ext.length) : value;
};

const safePathPart = (value = '') => String(value || '')
  .replace(/\\/g, '/')
  .split('/')
  .map(part => part.trim().replace(/[^a-zA-Z0-9._-]/g, '-'))
  .filter(Boolean)
  .join('/');

const getInputBuffer = async (file = {}) => {
  if (Buffer.isBuffer(file.buffer)) return file.buffer;
  if (file.path) return fs.promises.readFile(file.path);
  return null;
};

const getVariantPath = ({ uploadedFile = {}, folder = '', variantKey = '' }) => {
  const sourcePath = safePathPart(uploadedFile.path || '');
  const sourceName = sourcePath ? path.basename(sourcePath) : path.basename(uploadedFile.filename || 'media');
  const sourceFolder = sourcePath ? path.dirname(sourcePath) : safePathPart(folder);
  const cleanFolder = sourceFolder && sourceFolder !== '.' ? sourceFolder : safePathPart(folder);
  const baseName = stripExtension(sourceName || `${Date.now()}-media`);
  return safePathPart(`${cleanFolder}/variants/${baseName}-${variantKey}.webp`);
};

const writeLocalVariant = async ({ objectPath, buffer }) => {
  const localPath = safePathPart(objectPath);
  const targetPath = path.join(uploadsRoot, localPath);
  if (!targetPath.startsWith(`${uploadsRoot}${path.sep}`)) {
    throw new Error('Invalid local variant path');
  }

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, buffer);
  return {
    fileUrl: `/uploads/${localPath}`,
    storagePath: localPath,
    storageProvider: 'local',
    mimeType: 'image/webp',
    fileSize: buffer.length
  };
};

const storeVariant = async ({ objectPath, buffer }) => {
  if (isCloudStorageEnabled) {
    const uploaded = await uploadObjectBuffer({
      buffer,
      objectPath,
      mimeType: 'image/webp'
    });
    return {
      fileUrl: uploaded.url,
      storagePath: uploaded.path,
      storageProvider: uploaded.provider,
      mimeType: 'image/webp',
      fileSize: uploaded.size || buffer.length
    };
  }

  return writeLocalVariant({ objectPath, buffer });
};

const createImageVariants = async ({ file, uploadedFile, folder }) => {
  if (!sharp || !isSupportedImage(file)) return {};

  const inputBuffer = await getInputBuffer(file);
  if (!inputBuffer?.length) return {};

  const variants = {};
  const image = sharp(inputBuffer, { failOn: 'none', limitInputPixels: 36000000 }).rotate();
  const metadata = await image.metadata().catch(() => ({}));
  const sourceWidth = Number(metadata.width || 0);

  for (const variant of IMAGE_VARIANTS) {
    if (sourceWidth && sourceWidth <= variant.width && variant.key !== 'thumb') continue;

    const buffer = await image
      .clone()
      .resize({
        width: variant.width,
        withoutEnlargement: true,
        fit: 'inside'
      })
      .webp({
        quality: variant.quality,
        effort: 4,
        smartSubsample: true
      })
      .toBuffer();

    variants[variant.key] = await storeVariant({
      objectPath: getVariantPath({ uploadedFile, folder, variantKey: variant.key }),
      buffer
    });
  }

  return variants;
};

module.exports = {
  createImageVariants,
  isMediaVariantPipelineAvailable: () => Boolean(sharp)
};
