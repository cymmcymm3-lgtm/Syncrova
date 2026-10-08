const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Story = require('../models/Story');
const Message = require('../models/Message');
const { cloudStorageProvider, deleteObject, isCloudStorageEnabled, uploadBuffer } = require('../services/storage');
const { createImageVariants } = require('../services/mediaVariants');
const { createNotification, removeNotifications } = require('../services/notifications');
const { hydrateStoryMedia } = require('../utils/mediaUrls');
const router = express.Router();

const storyUploadDir = path.join(__dirname, '..', 'uploads', 'stories');
fs.mkdirSync(storyUploadDir, { recursive: true });

const MAX_STORY_UPLOAD_SIZE = 30 * 1024 * 1024;
const STORY_DURATION_MS = 24 * 60 * 60 * 1000;
const STORY_USER_FIELDS = 'name avatar avatarStoragePath avatarStorageProvider course campus isDeveloper';
const STORY_RELATED_USER_FIELDS = 'name avatar avatarStoragePath avatarStorageProvider isDeveloper';

const getStoryType = (file) => {
  if (file?.mimetype?.startsWith('image/')) return 'image';
  if (file?.mimetype?.startsWith('video/')) return 'video';
  return null;
};

const localStorage = multer.diskStorage({
  destination: storyUploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});

const upload = multer({
  storage: isCloudStorageEnabled ? multer.memoryStorage() : localStorage,
  limits: { fileSize: MAX_STORY_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    if (!getStoryType(file)) {
      const err = new Error('My Day supports images and videos only');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

const uploadStory = (req, res, next) => {
  upload.single('media')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ msg: 'My Day upload is too large. Maximum size is 30MB.' });
    }

    return res.status(err.status || 400).json({ msg: err.message || 'Upload failed' });
  });
};

const activeStoryQuery = () => ({ expiresAt: { $gt: new Date() } });
const populateStory = (query) => query
  .populate('userId', STORY_USER_FIELDS)
  .populate('reactions.userId', STORY_RELATED_USER_FIELDS)
  .populate('viewers.userId', STORY_RELATED_USER_FIELDS)
  .populate('comments.userId', STORY_RELATED_USER_FIELDS)
  .populate('comments.messageId');

const populateStoryDocument = async (story) => {
  await story.populate('userId', STORY_USER_FIELDS);
  await story.populate('reactions.userId', STORY_RELATED_USER_FIELDS);
  await story.populate('viewers.userId', STORY_RELATED_USER_FIELDS);
  await story.populate('comments.userId', STORY_RELATED_USER_FIELDS);
  await story.populate('comments.messageId');
  return hydrateStoryMedia(story);
};

const populateMessage = (id) => Message.findById(id)
  .populate('from', 'name email avatar isDeveloper lastSeen')
  .populate('to', 'name email avatar isDeveloper lastSeen')
  .populate('reactions.userId', 'name avatar isDeveloper')
  .populate({
    path: 'replyTo',
    populate: { path: 'from', select: 'name email avatar isDeveloper lastSeen' }
  });

const getId = (value) => String(value?._id || value?.id || value || '');

const getStoryTime = (story) => {
  const value = new Date(story?.createdAt || story?.updatedAt || 0).getTime();
  return Number.isNaN(value) ? 0 : value;
};

const toPlainStory = (story) => (typeof story?.toObject === 'function' ? story.toObject() : story);

const getMediaVariantEntries = (variants = {}) => (
  variants && typeof variants === 'object'
    ? Object.values(variants).filter(Boolean)
    : []
);

const groupStoriesByOwner = (stories = []) => {
  const groups = new Map();

  stories
    .map(toPlainStory)
    .sort((a, b) => getStoryTime(b) - getStoryTime(a))
    .forEach(story => {
      const owner = story.userId || {};
      const ownerId = getId(owner) || getId(story.user);
      if (!ownerId) return;
      if (!groups.has(ownerId)) groups.set(ownerId, { ownerId, owner, stories: [] });
      groups.get(ownerId).stories.push(story);
    });

  return Array.from(groups.values()).map(group => ({
    ...group,
    preview: group.stories[0],
    count: group.stories.length
  }));
};

router.get('/active', auth, async (req, res) => {
  try {
    const stories = await populateStory(Story.find(activeStoryQuery()))
      .sort({ createdAt: -1 })
      .limit(150)
      .lean();
    res.json(stories.map(hydrateStoryMedia));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/active/grouped', auth, async (req, res) => {
  try {
    const stories = await populateStory(Story.find(activeStoryQuery()))
      .sort({ createdAt: -1 })
      .limit(150)
      .lean();
    const plainStories = stories.map(hydrateStoryMedia);
    res.json({ stories: plainStories, groups: groupStoriesByOwner(plainStories) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/user/:userId', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ msg: 'Invalid user' });
    }

    const stories = await populateStory(Story.find({ ...activeStoryQuery(), userId: req.params.userId }))
      .sort({ createdAt: -1 })
      .lean();
    res.json(stories.map(hydrateStoryMedia));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/user/:userId/grouped', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ msg: 'Invalid user' });
    }

    const stories = await populateStory(Story.find({ ...activeStoryQuery(), userId: req.params.userId }))
      .sort({ createdAt: -1 })
      .lean();
    const plainStories = stories.map(hydrateStoryMedia);
    res.json({ stories: plainStories, groups: groupStoriesByOwner(plainStories) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/', auth, uploadStory, async (req, res) => {
  let uploadedFile = null;

  try {
    if (!req.file) return res.status(400).json({ msg: 'No media uploaded' });

    const fileType = getStoryType(req.file);
    uploadedFile = isCloudStorageEnabled
      ? await uploadBuffer({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          folder: `users/${req.user}/stories`
        })
      : {
          filename: req.file.filename,
          path: `stories/${req.file.filename}`,
          url: `/uploads/stories/${req.file.filename}`
        };
    const mediaVariants = await createImageVariants({
      file: req.file,
      uploadedFile,
      folder: `users/${req.user}/stories`
    }).catch(() => ({}));

    const story = new Story({
      userId: req.user,
      caption: req.body.caption?.trim() || '',
      privacy: ['friends', 'public', 'private'].includes(String(req.body.privacy || '').toLowerCase())
        ? String(req.body.privacy).toLowerCase()
        : 'friends',
      fileUrl: uploadedFile.url,
      fileType,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      storagePath: uploadedFile.path,
      storageProvider: uploadedFile.provider || (isCloudStorageEnabled ? cloudStorageProvider : 'local'),
      mediaVariants,
      expiresAt: new Date(Date.now() + STORY_DURATION_MS)
    });

    await story.save();
    const hydratedStory = await populateStoryDocument(story);
    req.app.get('io')?.emit('story-updated', hydratedStory);
    res.status(201).json(hydratedStory);
  } catch (err) {
    if (isCloudStorageEnabled && uploadedFile?.path) {
      await deleteObject(uploadedFile.path, { provider: uploadedFile.provider }).catch(() => {});
    }
    res.status(err.status || 500).json({ msg: err.message });
  }
});

router.post('/:storyId/react', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.storyId)) {
      return res.status(404).json({ msg: 'Story not found' });
    }

    const emoji = String(req.body.emoji || '').trim().slice(0, 8);
    if (!emoji) return res.status(400).json({ msg: 'Emoji is required' });

    const story = await Story.findOne({ _id: req.params.storyId, ...activeStoryQuery() });
    if (!story) return res.status(404).json({ msg: 'Story not found' });

    const existingIndex = (story.reactions || []).findIndex(reaction => String(reaction.userId) === String(req.user));
    let reactionApplied = true;
    if (existingIndex >= 0 && story.reactions[existingIndex].emoji === emoji) {
      story.reactions.splice(existingIndex, 1);
      reactionApplied = false;
    } else if (existingIndex >= 0) {
      story.reactions[existingIndex].emoji = emoji;
      story.reactions[existingIndex].createdAt = new Date();
    } else {
      story.reactions.push({ userId: req.user, emoji });
    }

    await story.save();
    const hydratedStory = await populateStoryDocument(story);

    const ownerId = story.userId?._id || story.userId;
    const notificationMeta = { storyId: story._id };
    const dedupeKey = `reaction:story:${story._id}:actor:${req.user}`;
    if (String(ownerId) !== String(req.user) && reactionApplied) {
      await createNotification({
        io: req.app.get('io'),
        userId: ownerId,
        actorId: req.user,
        type: 'reaction',
        title: 'Someone reacted to your My Day',
        body: `${emoji} ${story.caption || 'My Day'}`,
        href: '/dashboard',
        meta: { ...notificationMeta, emoji },
        dedupeKey
      });
    } else if (String(ownerId) !== String(req.user)) {
      // A removed reaction should not leave a stale alert in the owner's inbox.
      await removeNotifications({
        io: req.app.get('io'),
        userId: ownerId,
        actorId: req.user,
        type: 'reaction',
        meta: notificationMeta,
        dedupeKey
      });
    }

    req.app.get('io')?.emit('story-updated', hydratedStory);
    res.json(hydratedStory);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:storyId/view', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.storyId)) {
      return res.status(404).json({ msg: 'Story not found' });
    }

    const story = await Story.findOne({ _id: req.params.storyId, ...activeStoryQuery() });
    if (!story) return res.status(404).json({ msg: 'Story not found' });

    const viewerIndex = (story.viewers || []).findIndex(viewer => String(viewer.userId) === String(req.user));
    if (viewerIndex >= 0) {
      story.viewers[viewerIndex].viewedAt = new Date();
    } else {
      story.viewers.push({ userId: req.user, viewedAt: new Date() });
    }

    await story.save();
    const hydratedStory = await populateStoryDocument(story);
    const ownerId = getId(story.userId);
    if (ownerId) {
      req.app.get('io')?.to(`user_${ownerId}`).emit('story-updated', hydratedStory);
    }
    res.json(hydratedStory);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:storyId/comment', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.storyId)) {
      return res.status(404).json({ msg: 'Story not found' });
    }

    const text = String(req.body.text || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ msg: 'Comment is required' });

    const story = await Story.findOne({ _id: req.params.storyId, ...activeStoryQuery() });
    if (!story) return res.status(404).json({ msg: 'Story not found' });
    await story.populate('userId', STORY_RELATED_USER_FIELDS);

    const ownerId = story.userId?._id || story.userId;
    if (String(ownerId) === String(req.user)) {
      return res.status(400).json({ msg: 'You cannot reply to your own My Day' });
    }
    const ownerName = story.userId?.name || 'their';

    const message = new Message({
      from: req.user,
      to: ownerId,
      text: `Replied to ${ownerName}'s My Day: ${text}`,
      fileUrl: story.fileUrl,
      fileType: story.fileType,
      fileName: story.fileName || 'My Day',
      mimeType: story.mimeType || '',
      fileSize: story.fileSize || 0,
      storagePath: story.storagePath || '',
      storageProvider: story.storageProvider || ''
    });
    await message.save();
    const populatedMessage = await populateMessage(message._id);

    story.comments.push({ userId: req.user, text, messageId: message._id });
    await story.save();
    const hydratedStory = await populateStoryDocument(story);

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${ownerId}`).emit('receiveMessage', populatedMessage);
      io.to(`user_${req.user}`).emit('receiveMessage', populatedMessage);
      io.emit('story-updated', hydratedStory);
    }

    await createNotification({
      io,
      userId: ownerId,
      actorId: req.user,
      type: 'message',
      title: 'New My Day reply',
      body: text,
      href: `/messages?user=${req.user}`,
      meta: { storyId: story._id, messageId: message._id }
    });

    res.status(201).json({ story: hydratedStory, message: populatedMessage });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.delete('/:storyId', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ msg: 'Story not found' });
    if (String(story.userId) !== String(req.user)) {
      return res.status(403).json({ msg: 'You can only delete your own My Day' });
    }

    await story.deleteOne();
    if (['supabase', 'r2'].includes(story.storageProvider) && story.storagePath) {
      await deleteObject(story.storagePath, { provider: story.storageProvider }).catch(() => {});
    } else if (story.fileUrl?.startsWith('/uploads/stories/')) {
      const localPath = path.join(__dirname, '..', story.fileUrl);
      fs.unlink(localPath, () => {});
    }
    getMediaVariantEntries(story.mediaVariants).forEach(variant => {
      if (['supabase', 'r2'].includes(variant.storageProvider) && variant.storagePath) {
        deleteObject(variant.storagePath, { provider: variant.storageProvider }).catch(() => {});
      } else if (variant.fileUrl?.startsWith('/uploads/')) {
        fs.unlink(path.join(__dirname, '..', variant.fileUrl), () => {});
      }
    });

    req.app.get('io')?.emit('story-deleted', { storyId: story._id, userId: story.userId });
    res.json({ msg: 'Story deleted' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
