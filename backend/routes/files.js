
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const File = require('../models/File');
const Group = require('../models/Group');
const { cloudStorageProvider, deleteObject, isCloudStorageEnabled, uploadBuffer } = require('../services/storage');
const { createNotifications } = require('../services/notifications');
const { createGroupActivity } = require('../services/activity');
const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.exe', '.msi', '.ps1', '.scr', '.sh']);

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const findMemberGroup = async (groupId, userId) => {
  if (!isValidObjectId(groupId)) return null;
  return Group.findOne({ _id: groupId, members: userId });
};

const ensureGroupMember = async (req, res, next) => {
  try {
    const group = await findMemberGroup(req.params.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });
    req.group = group;
    next();
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

const localStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});

const upload = multer({
  storage: isCloudStorageEnabled ? multer.memoryStorage() : localStorage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      const err = new Error('This file type is not allowed');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

const uploadSingleFile = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ msg: 'File is too large. Maximum size is 25MB.' });
    }

    return res.status(err.status || 400).json({ msg: err.message || 'Upload failed' });
  });
};

router.post('/upload/:groupId', auth, ensureGroupMember, uploadSingleFile, async (req, res) => {
  let uploadedFile = null;

  try {
    if (!req.file) return res.status(400).json({ msg: 'No file uploaded' });

    uploadedFile = isCloudStorageEnabled
      ? await uploadBuffer({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          folder: `groups/${req.params.groupId}`
        })
      : {
          filename: req.file.filename,
          path: '',
          url: `/uploads/${req.file.filename}`
        };

    const file = new File({
      groupId: req.params.groupId,
      filename: uploadedFile.filename,
      originalName: req.file.originalname,
      url: uploadedFile.url,
      storagePath: uploadedFile.path,
      storageProvider: uploadedFile.provider || (isCloudStorageEnabled ? cloudStorageProvider : 'local'),
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user
    });
    await file.save();
    await file.populate('uploadedBy', 'name avatar isDeveloper');
    await createGroupActivity({
      groupId: req.params.groupId,
      actorId: req.user,
      type: 'file',
      title: 'uploaded a file',
      detail: req.file.originalname,
      targetId: file._id,
      targetModel: 'File'
    });
    await createNotifications({
      io: req.app.get('io'),
      userIds: req.group.members,
      actorId: req.user,
      type: 'file',
      title: `${req.group.name}: new file`,
      body: req.file.originalname,
      href: `/group/${req.params.groupId}`,
      meta: { groupId: req.params.groupId, fileId: file._id }
    });
    res.status(201).json(file);
  } catch (err) {
    if (isCloudStorageEnabled && uploadedFile?.path) {
      await deleteObject(uploadedFile.path, { provider: uploadedFile.provider }).catch(() => {});
    }
    res.status(500).json({ msg: err.message });
  }
});

router.get('/group/:groupId', auth, ensureGroupMember, async (req, res) => {
  try {
    const files = await File.find({ groupId: req.params.groupId })
      .populate('uploadedBy', 'name avatar isDeveloper')
      .sort({ uploadDate: -1 });
    res.json(files);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.delete('/:fileId', auth, async (req, res) => {
  try {
    const file = await File.findById(req.params.fileId);
    if (!file) return res.status(404).json({ msg: 'File not found' });

    const group = await findMemberGroup(file.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });

    const isUploader = file.uploadedBy.toString() === req.user;
    const isGroupCreator = group.creator.toString() === req.user;
    const isCoCreator = group.coCreators?.some(c => c.toString() === req.user);
    if (!isUploader && !isGroupCreator && !isCoCreator) {
      return res.status(403).json({ msg: 'Not authorized to delete this file' });
    }

    if (['supabase', 'r2'].includes(file.storageProvider) || file.storagePath) {
      await deleteObject(file.storagePath, { provider: file.storageProvider });
    } else {
      await fs.promises.unlink(path.join(uploadDir, file.filename)).catch(err => {
        if (err.code !== 'ENOENT') throw err;
      });
    }

    await file.deleteOne();
    res.json({ msg: 'File deleted', fileId: req.params.fileId });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
