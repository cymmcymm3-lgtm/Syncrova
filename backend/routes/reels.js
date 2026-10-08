const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const GalleryItem = require('../models/GalleryItem');
const { cloudStorageProvider, deleteObject, isCloudStorageEnabled, uploadBuffer } = require('../services/storage');
const { hydrateGalleryMedia } = require('../utils/mediaUrls');

const router = express.Router();

const galleryUploadDir = path.join(__dirname, '..', 'uploads', 'gallery');
fs.mkdirSync(galleryUploadDir, { recursive: true });

const getId = (value) => String(value?._id || value?.id || value || '');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.avi', '.mkv', '.3gp', '.3gpp']);
const MIME_FALLBACKS = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.3gp': 'video/3gpp',
  '.3gpp': 'video/3gpp'
};
const GALLERY_USER_FIELDS = 'name avatar avatarStoragePath avatarStorageProvider isDeveloper';

const getFileExtension = (file) => path.extname(file?.originalname || '').toLowerCase();

const getGalleryType = (file) => {
  const mimeType = String(file?.mimetype || '').toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';

  const extension = getFileExtension(file);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
};

const getGalleryMimeType = (file) => {
  const mimeType = String(file?.mimetype || '').toLowerCase();
  if (mimeType && mimeType !== 'application/octet-stream') return file.mimetype;
  return MIME_FALLBACKS[getFileExtension(file)] || file?.mimetype || 'application/octet-stream';
};

const localStorage = multer.diskStorage({
  destination: galleryUploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});

const upload = multer({
  storage: localStorage,
  // Gallery intentionally has no app-level fileSize cap; storage/platform limits still apply.
  fileFilter: (req, file, cb) => {
    if (!getGalleryType(file)) {
      const err = new Error('Gallery supports photos and videos only');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

const uploadGallery = (req, res, next) => {
  upload.single('media')(req, res, (err) => {
    if (!err) return next();

    return res.status(err.status || 400).json({ msg: err.message || 'Upload failed' });
  });
};

const populateGallery = (query) => query
  .populate('uploadedBy', GALLERY_USER_FIELDS)
  .populate('comments.userId', GALLERY_USER_FIELDS)
  .populate('reactions.userId', GALLERY_USER_FIELDS)
  .populate('viewers.userId', GALLERY_USER_FIELDS);

const populateGalleryDocument = async (item) => {
  await item.populate('uploadedBy', GALLERY_USER_FIELDS);
  await item.populate('comments.userId', GALLERY_USER_FIELDS);
  await item.populate('reactions.userId', GALLERY_USER_FIELDS);
  await item.populate('viewers.userId', GALLERY_USER_FIELDS);
  return item;
};

const toPayload = (item, currentUserId) => {
  const plain = hydrateGalleryMedia(item);
  const itemId = getId(plain);
  const viewerId = getId(currentUserId);
  const reactions = plain.reactions || [];
  const savedBy = plain.savedBy || [];
  const viewers = plain.viewers || [];

  return {
    id: itemId,
    _id: itemId,
    source: 'gallery',
    sourceUrl: plain.fileUrl,
    videoId: itemId,
    embedUrl: plain.fileUrl,
    title: plain.title || 'Gallery item',
    caption: plain.caption || '',
    providerName: 'Gallery',
    mediaType: plain.fileType,
    fileType: plain.fileType,
    fileName: plain.fileName || '',
    mimeType: plain.mimeType || '',
    fileSize: plain.fileSize || 0,
    uploaderName: plain.uploadedBy?.name || '',
    uploadedBy: plain.uploadedBy || null,
    ownerId: getId(plain.uploadedBy),
    reactionCount: reactions.length,
    savedCount: savedBy.length,
    viewCount: viewers.length,
    reacted: reactions.some(reaction => getId(reaction.userId) === viewerId),
    saved: savedBy.some(userId => getId(userId) === viewerId),
    canDelete: getId(plain.uploadedBy) === viewerId,
    comments: plain.comments || [],
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt
  };
};

const findVisibleGalleryItem = async (itemId) => {
  if (!mongoose.Types.ObjectId.isValid(itemId)) return null;
  return GalleryItem.findById(itemId);
};

const resolveLocalGalleryFilePath = (item) => {
  const storageCandidate = String(item?.storagePath || '').trim();
  const fileUrlCandidate = String(item?.fileUrl || '').trim().split('?')[0];
  const baseName = path.basename(storageCandidate || fileUrlCandidate);
  if (!baseName || baseName === '.' || baseName === path.sep) return '';
  const resolved = path.resolve(galleryUploadDir, baseName);
  const galleryRoot = path.resolve(galleryUploadDir);
  if (resolved !== galleryRoot && !resolved.startsWith(`${galleryRoot}${path.sep}`)) {
    return '';
  }
  return resolved;
};

const deleteLocalGalleryFile = async (item) => {
  const target = resolveLocalGalleryFilePath(item);
  if (!target) return;
  try {
    await fs.promises.unlink(target);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
};

router.get('/', auth, async (req, res) => {
  try {
    const items = await populateGallery(GalleryItem.find({}).sort({ createdAt: -1 })).lean();
    const gallery = items.map(item => toPayload(item, req.user));
    res.json({ gallery, memories: gallery, reels: gallery });
  } catch (err) {
    console.error('Gallery feed failed', err);
    res.status(500).json({ msg: 'Failed to load gallery' });
  }
});

router.post('/', auth, uploadGallery, async (req, res) => {
  let uploadedFile = null;
  let stagedFilePath = '';

  try {
    const title = String(req.body?.title || '').trim().slice(0, 120);
    const caption = String(req.body?.caption || '').trim().slice(0, 500);
    if (!title) return res.status(400).json({ msg: 'Gallery title is required' });
    if (!req.file) return res.status(400).json({ msg: 'Please choose a photo or video' });

    const fileType = getGalleryType(req.file);
    const mimeType = getGalleryMimeType(req.file);
    stagedFilePath = req.file.path || '';
    uploadedFile = isCloudStorageEnabled
      ? await uploadBuffer({
          buffer: await fs.promises.readFile(stagedFilePath),
          originalName: req.file.originalname,
          mimeType,
          folder: 'gallery'
        })
      : {
          filename: req.file.filename,
          path: '',
          url: `/uploads/gallery/${req.file.filename}`
        };

    const item = new GalleryItem({
      title,
      caption,
      fileUrl: uploadedFile.url,
      fileType,
      fileName: req.file.originalname,
      mimeType,
      fileSize: req.file.size,
      storagePath: uploadedFile.path,
      storageProvider: uploadedFile.provider || (isCloudStorageEnabled ? cloudStorageProvider : 'local'),
      uploadedBy: req.user
    });

    await item.save();
    await populateGalleryDocument(item);
    res.status(201).json({ reel: toPayload(item, req.user), galleryItem: toPayload(item, req.user) });
  } catch (err) {
    if (isCloudStorageEnabled && uploadedFile?.path) {
      await deleteObject(uploadedFile.path, { provider: uploadedFile.provider }).catch(() => {});
    }
    res.status(err.status || 500).json({ msg: err.message || 'Gallery upload failed' });
  } finally {
    if (isCloudStorageEnabled && stagedFilePath) {
      await fs.promises.unlink(stagedFilePath).catch(() => {});
    }
  }
});

router.delete('/:itemId', auth, async (req, res) => {
  try {
    const item = await findVisibleGalleryItem(req.params.itemId);
    if (!item) return res.status(404).json({ msg: 'Gallery item not found' });

    if (getId(item.uploadedBy) !== getId(req.user)) {
      return res.status(403).json({ msg: 'Only the uploader can delete this item' });
    }

    if (['supabase', 'r2'].includes(item.storageProvider) && item.storagePath) {
      await deleteObject(item.storagePath, { provider: item.storageProvider }).catch(() => {});
    } else {
      await deleteLocalGalleryFile(item);
    }

    await item.deleteOne();
    res.json({ ok: true, id: getId(item) });
  } catch (err) {
    console.error('Gallery delete failed', err);
    res.status(500).json({ msg: 'Failed to delete gallery item' });
  }
});

router.post('/import', auth, (req, res) => {
  res.status(410).json({ msg: 'External imports were removed. Upload photos or videos to Gallery instead.' });
});

router.post('/:itemId/react', auth, async (req, res) => {
  try {
    const item = await findVisibleGalleryItem(req.params.itemId);
    if (!item) return res.status(404).json({ msg: 'Gallery item not found' });

    item.reactions = item.reactions || [];
    const existingIndex = item.reactions.findIndex(reaction => getId(reaction.userId) === getId(req.user));
    if (existingIndex >= 0) item.reactions.splice(existingIndex, 1);
    else item.reactions.push({ userId: req.user, emoji: req.body?.type || 'like' });

    await item.save();
    await populateGalleryDocument(item);
    res.json({ reel: toPayload(item, req.user) });
  } catch (err) {
    console.error('Gallery reaction failed', err);
    res.status(500).json({ msg: 'Failed to update reaction' });
  }
});

router.post('/:itemId/save', auth, async (req, res) => {
  try {
    const item = await findVisibleGalleryItem(req.params.itemId);
    if (!item) return res.status(404).json({ msg: 'Gallery item not found' });

    item.savedBy = item.savedBy || [];
    const existingIndex = item.savedBy.findIndex(userId => getId(userId) === getId(req.user));
    if (existingIndex >= 0) item.savedBy.splice(existingIndex, 1);
    else item.savedBy.push(req.user);

    await item.save();
    await populateGalleryDocument(item);
    res.json({ reel: toPayload(item, req.user) });
  } catch (err) {
    console.error('Gallery save failed', err);
    res.status(500).json({ msg: 'Failed to update saved item' });
  }
});

router.post('/:itemId/view', auth, async (req, res) => {
  try {
    const item = await findVisibleGalleryItem(req.params.itemId);
    if (!item) return res.json({ ok: true });

    item.viewers = item.viewers || [];
    const viewerIndex = item.viewers.findIndex(viewer => getId(viewer.userId) === getId(req.user));
    if (viewerIndex >= 0) item.viewers[viewerIndex].viewedAt = new Date();
    else item.viewers.push({ userId: req.user, viewedAt: new Date() });
    await item.save();
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

router.post('/:itemId/comment', auth, async (req, res) => {
  try {
    const item = await findVisibleGalleryItem(req.params.itemId);
    if (!item) return res.status(404).json({ msg: 'Gallery item not found' });

    const text = String(req.body?.text || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ msg: 'Comment is required' });

    item.comments.push({ userId: req.user, text });
    await item.save();
    await populateGalleryDocument(item);
    res.status(201).json({ reel: toPayload(item, req.user) });
  } catch (err) {
    console.error('Gallery comment failed', err);
    res.status(500).json({ msg: 'Failed to post comment' });
  }
});

module.exports = router;
