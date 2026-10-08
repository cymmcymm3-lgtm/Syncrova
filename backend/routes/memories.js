const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Group = require('../models/Group');
const Memory = require('../models/Memory');
const { cloudStorageProvider, deleteObject, isCloudStorageEnabled, uploadBuffer } = require('../services/storage');
const { createNotifications } = require('../services/notifications');
const { createGroupActivity } = require('../services/activity');
const router = express.Router();

const memoryUploadDir = path.join(__dirname, '..', 'uploads', 'memories');
fs.mkdirSync(memoryUploadDir, { recursive: true });

const MAX_MEMORY_UPLOAD_SIZE = 25 * 1024 * 1024;

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const findMemberGroup = async (groupId, userId) => {
  if (!isValidObjectId(groupId)) return null;
  return Group.findOne({ _id: groupId, members: userId });
};

const getMemoryType = (file) => {
  if (file?.mimetype?.startsWith('image/')) return 'image';
  if (file?.mimetype?.startsWith('video/')) return 'video';
  return null;
};

const localStorage = multer.diskStorage({
  destination: memoryUploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});

const upload = multer({
  storage: isCloudStorageEnabled ? multer.memoryStorage() : localStorage,
  limits: { fileSize: MAX_MEMORY_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    if (!getMemoryType(file)) {
      const err = new Error('Memories can only be images or videos');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

const uploadMemory = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ msg: 'Memory upload is too large. Maximum size is 25MB.' });
    }

    return res.status(err.status || 400).json({ msg: err.message || 'Upload failed' });
  });
};

router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const group = await findMemberGroup(req.params.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });

    const memories = await Memory.find({ groupId: req.params.groupId })
      .populate('userId', 'name avatar isDeveloper')
      .sort({ createdAt: -1 });
    res.json(memories);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/group/:groupId', auth, uploadMemory, async (req, res) => {
  let uploadedFile = null;

  try {
    const group = await findMemberGroup(req.params.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });
    if (!req.file) return res.status(400).json({ msg: 'No media uploaded' });

    const fileType = getMemoryType(req.file);
    uploadedFile = isCloudStorageEnabled
      ? await uploadBuffer({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          folder: `groups/${req.params.groupId}/memories`
        })
      : {
          filename: req.file.filename,
          path: '',
          url: `/uploads/memories/${req.file.filename}`
        };

    const memory = new Memory({
      groupId: req.params.groupId,
      userId: req.user,
      caption: req.body.caption?.trim() || '',
      fileUrl: uploadedFile.url,
      fileType,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      storagePath: uploadedFile.path,
      storageProvider: uploadedFile.provider || (isCloudStorageEnabled ? cloudStorageProvider : 'local')
    });
    await memory.save();
    await memory.populate('userId', 'name avatar isDeveloper');
    await createGroupActivity({
      groupId: req.params.groupId,
      actorId: req.user,
      type: 'memory',
      title: `shared a ${fileType} memory`,
      detail: memory.caption || req.file.originalname,
      targetId: memory._id,
      targetModel: 'Memory'
    });
    await createNotifications({
      io: req.app.get('io'),
      userIds: group.members,
      actorId: req.user,
      type: 'memory',
      title: `${group.name}: new memory`,
      body: memory.caption || req.file.originalname,
      href: `/group/${req.params.groupId}`,
      meta: { groupId: req.params.groupId, memoryId: memory._id }
    });
    res.status(201).json(memory);
  } catch (err) {
    if (isCloudStorageEnabled && uploadedFile?.path) {
      await deleteObject(uploadedFile.path, { provider: uploadedFile.provider }).catch(() => {});
    }
    res.status(err.status || 500).json({ msg: err.message });
  }
});

router.delete('/:memoryId', auth, async (req, res) => {
  try {
    const memory = await Memory.findById(req.params.memoryId);
    if (!memory) return res.status(404).json({ msg: 'Memory not found' });

    const group = await findMemberGroup(memory.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });

    const isOwner = memory.userId.toString() === req.user;
    const isCreator = group.creator.toString() === req.user;
    const isCoCreator = group.coCreators?.some(userId => userId.toString() === req.user);
    if (!isOwner && !isCreator && !isCoCreator) {
      return res.status(403).json({ msg: 'Not authorized to delete this memory' });
    }

    if (['supabase', 'r2'].includes(memory.storageProvider) && memory.storagePath) {
      await deleteObject(memory.storagePath, { provider: memory.storageProvider }).catch(() => {});
    } else if (memory.fileUrl?.startsWith('/uploads/memories/')) {
      await fs.promises.unlink(path.join(memoryUploadDir, path.basename(memory.fileUrl))).catch(err => {
        if (err.code !== 'ENOENT') throw err;
      });
    }

    await memory.deleteOne();
    res.json({ msg: 'Memory deleted', memoryId: req.params.memoryId });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
