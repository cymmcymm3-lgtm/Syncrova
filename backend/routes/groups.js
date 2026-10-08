const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Group = require('../models/Group');
const Post = require('../models/Post');
const Task = require('../models/Task');
const File = require('../models/File');
const Memory = require('../models/Memory');
const GroupNote = require('../models/GroupNote');
const GroupInvite = require('../models/GroupInvite');
const GroupChat = require('../models/GroupChat');
const User = require('../models/User');
const { cloudStorageProvider, deleteObject, isCloudStorageEnabled, uploadBuffer } = require('../services/storage');
const { createNotification, createNotifications } = require('../services/notifications');
const { createGroupActivity } = require('../services/activity');
const { DEFAULT_CHAT_BACKGROUND_ID, normalizeChatBackgroundId } = require('../utils/chatBackgrounds');
const router = express.Router();

const groupPhotoUploadDir = path.join(__dirname, '..', 'uploads', 'groups');
const uploadDir = path.join(__dirname, '..', 'uploads');
const memoryUploadDir = path.join(__dirname, '..', 'uploads', 'memories');
fs.mkdirSync(groupPhotoUploadDir, { recursive: true });

const MAX_GROUP_PHOTO_SIZE = 8 * 1024 * 1024;
const JOIN_CODE_LENGTH = 6;
const MAX_JOIN_CODE_ATTEMPTS = 8;

const isSameId = (left, right) => String(left?._id || left || '') === String(right?._id || right || '');
const getEntityId = (value) => String(value?._id || value || '');
const isGroupMember = (group, userId) => group?.members?.some(member => isSameId(member, userId));
const canManageGroup = (group, userId) => (
  isSameId(group?.creator, userId) || group?.coCreators?.some(member => isSameId(member, userId))
);
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const populateGroup = (query) => query
  .populate('creator', 'name email avatar isDeveloper')
  .populate('members', 'name email avatar isDeveloper');

const createJoinCode = () => Math.random().toString(36).slice(2, 2 + JOIN_CODE_LENGTH).toUpperCase();

const createUniqueJoinCode = async () => {
  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const joinCode = createJoinCode();
    const existing = await Group.exists({ joinCode });
    if (!existing) return joinCode;
  }

  const err = new Error('Could not generate a unique join code. Please try again.');
  err.status = 500;
  throw err;
};

const removeLocalFile = async (targetPath) => {
  if (!targetPath) return;
  await fs.promises.unlink(targetPath).catch(err => {
    if (err.code !== 'ENOENT') throw err;
  });
};

const removeStoredAsset = async ({ storageProvider, storagePath, filename, fileUrl, localDir }) => {
  if ((['supabase', 'r2'].includes(storageProvider) || (storagePath && isCloudStorageEnabled && storageProvider !== 'local')) && storagePath) {
    await deleteObject(storagePath, { provider: storageProvider }).catch(() => {});
    return;
  }

  if (filename && localDir) {
    await removeLocalFile(path.join(localDir, filename));
    return;
  }

  if (fileUrl?.startsWith('/uploads/') && localDir) {
    await removeLocalFile(path.join(localDir, path.basename(fileUrl)));
  }
};

const populateInvite = (query) => query
  .populate('groupId', 'name description subject photo joinCode members creator')
  .populate('invitedBy', 'name email avatar isDeveloper')
  .populate('invitedUser', 'name email avatar isDeveloper');

const groupPhotoLocalStorage = multer.diskStorage({
  destination: groupPhotoUploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});

const groupPhotoUpload = multer({
  storage: isCloudStorageEnabled ? multer.memoryStorage() : groupPhotoLocalStorage,
  limits: { fileSize: MAX_GROUP_PHOTO_SIZE },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      const err = new Error('Please upload an image file');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

const uploadGroupPhoto = (req, res, next) => {
  groupPhotoUpload.single('photo')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ msg: 'Group photo must be 8MB or smaller' });
    }

    return res.status(err.status || 400).json({ msg: err.message || 'Upload failed' });
  });
};

// Get all groups where current user is a member
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user;
    const groups = await populateGroup(Group.find({ members: userId }));
    res.json(groups);
  } catch (err) {
    console.error('GET /groups error:', err);
    res.status(500).json({ msg: err.message });
  }
});

// Create a new group
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, subject, memberIds = [] } = req.body;
    const trimmedName = name?.trim();
    if (!trimmedName) return res.status(400).json({ msg: 'Group name is required' });
    if (trimmedName.length > 80) return res.status(400).json({ msg: 'Group name must be 80 characters or less' });

    const uniqueMemberIds = Array.from(new Set([
      req.user,
      ...(Array.isArray(memberIds) ? memberIds : [])
    ].map(id => String(id || '')).filter(Boolean)));
    if (uniqueMemberIds.some(id => !isValidObjectId(id))) {
      return res.status(400).json({ msg: 'Choose valid group members' });
    }

    const joinCode = await createUniqueJoinCode();
    const group = new Group({
      name: trimmedName,
      description: description?.trim() || '',
      subject: subject?.trim() || '',
      creator: req.user,
      members: uniqueMemberIds,
      joinCode
    });
    await group.save();
    await group.populate('creator', 'name email avatar isDeveloper');
    await group.populate('members', 'name email avatar isDeveloper');
    if (uniqueMemberIds.length > 1) {
      await createNotifications({
        io: req.app.get('io'),
        userIds: uniqueMemberIds.filter(id => id !== req.user),
        actorId: req.user,
        type: 'group',
        title: `Added to ${group.name}`,
        body: 'A new group chat is ready in Messages.',
        href: '/messages',
        meta: { groupId: group._id }
      }).catch(() => {});
    }
    const io = req.app.get('io');
    if (io) {
      uniqueMemberIds.forEach(memberId => io.to(`user_${memberId}`).emit('group-updated', group));
    }
    res.status(201).json(group);
  } catch (err) {
    console.error('POST /groups error:', err);
    res.status(500).json({ msg: err.message });
  }
});

// Join a group by code
router.post('/join', auth, async (req, res) => {
  try {
    const joinCode = req.body.joinCode?.trim().toUpperCase();
    if (!joinCode) return res.status(400).json({ msg: 'Join code is required' });

    const group = await Group.findOne({ joinCode });
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (isGroupMember(group, req.user)) {
      return res.status(400).json({ msg: 'You are already a member of this group' });
    }
    group.members.push(req.user);
    await group.save();
    await group.populate('creator', 'name email avatar isDeveloper');
    res.json(group);
  } catch (err) {
    console.error('POST /groups/join error:', err);
    res.status(500).json({ msg: err.message });
  }
});

router.get('/invites/me', auth, async (req, res) => {
  try {
    const invites = await populateInvite(GroupInvite.find({
      invitedUser: req.user,
      status: 'pending'
    }).sort({ createdAt: -1 }));

    res.json(invites.filter(invite => invite.groupId));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.put('/invites/:inviteId/respond', auth, async (req, res) => {
  try {
    const { action } = req.body;
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ msg: 'Invite action must be accept or decline' });
    }

    const invite = await GroupInvite.findOne({
      _id: req.params.inviteId,
      invitedUser: req.user,
      status: 'pending'
    });
    if (!invite) return res.status(404).json({ msg: 'Invitation not found' });

    const group = await Group.findById(invite.groupId);
    if (!group) {
      invite.status = 'declined';
      invite.respondedAt = new Date();
      await invite.save();
      return res.status(404).json({ msg: 'Group no longer exists' });
    }

    invite.status = action === 'accept' ? 'accepted' : 'declined';
    invite.respondedAt = new Date();

    if (action === 'accept' && !isGroupMember(group, req.user)) {
      group.members.push(req.user);
      await group.save();
      await createGroupActivity({
        groupId: group._id,
        actorId: req.user,
        type: 'group',
        title: 'accepted a group invite',
        detail: group.name,
        targetId: group._id,
        targetModel: 'Group'
      });
    }

    await invite.save();

    await createNotification({
      io: req.app.get('io'),
      userId: invite.invitedBy,
      actorId: req.user,
      type: 'group',
      title: action === 'accept' ? `${group.name}: invite accepted` : `${group.name}: invite declined`,
      body: action === 'accept' ? 'A user joined from your invitation.' : 'A user declined your invitation.',
      href: action === 'accept' ? `/group/${group._id}` : '/groups',
      meta: { groupId: group._id, inviteId: invite._id }
    });

    const populatedInvite = await populateInvite(GroupInvite.findById(invite._id));
    res.json({ invite: populatedInvite, group: action === 'accept' ? group : null });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/:id/invites', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ msg: 'Group not found' });

    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (!isGroupMember(group, req.user)) return res.status(403).json({ msg: 'You are not a member of this group' });
    if (!canManageGroup(group, req.user)) return res.status(403).json({ msg: 'Only group admins can view invitations' });

    const invites = await populateInvite(GroupInvite.find({
      groupId: req.params.id,
      status: 'pending'
    }).sort({ createdAt: -1 }));
    res.json(invites);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:id/invites', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ msg: 'Group not found' });

    const { userId } = req.body;
    if (!isValidObjectId(userId)) return res.status(400).json({ msg: 'Choose a valid user to invite' });

    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (!isGroupMember(group, req.user)) return res.status(403).json({ msg: 'You are not a member of this group' });
    if (!canManageGroup(group, req.user)) return res.status(403).json({ msg: 'Only group admins can invite members' });
    if (isSameId(userId, req.user)) return res.status(400).json({ msg: 'You are already in this group' });
    if (isGroupMember(group, userId)) return res.status(400).json({ msg: 'User is already a member of this group' });

    const targetUser = await User.findById(userId).select('name email avatar isDeveloper');
    if (!targetUser) return res.status(404).json({ msg: 'User not found' });

    const existingPending = await GroupInvite.findOne({
      groupId: req.params.id,
      invitedUser: userId,
      status: 'pending'
    });
    if (existingPending) return res.status(409).json({ msg: 'This user already has a pending invitation' });

    const invite = await GroupInvite.findOneAndUpdate(
      { groupId: req.params.id, invitedUser: userId },
      {
        groupId: req.params.id,
        invitedBy: req.user,
        invitedUser: userId,
        status: 'pending',
        respondedAt: null
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await createNotification({
      io: req.app.get('io'),
      userId,
      actorId: req.user,
      type: 'group',
      title: `Invitation to ${group.name}`,
      body: 'Accept or decline this group invitation from My Groups.',
      href: '/groups',
      meta: { groupId: group._id, inviteId: invite._id }
    });

    await createGroupActivity({
      groupId: group._id,
      actorId: req.user,
      type: 'group',
      title: 'sent a group invitation',
      detail: targetUser.name || targetUser.email,
      targetId: invite._id,
      targetModel: 'GroupInvite'
    });

    res.status(201).json(await populateInvite(GroupInvite.findById(invite._id)));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Get a single group (only if user is member)
router.get('/:id', auth, async (req, res) => {
  try {
    const group = await Group.findOne({
      _id: req.params.id,
      members: req.user
    }).populate('members', 'name email avatar isDeveloper')
      .populate('creator', 'name email avatar isDeveloper')
      .populate('coCreators', 'name email avatar isDeveloper');
    if (!group) return res.status(404).json({ msg: 'Group not found or you are not a member' });
    res.json(group);
  } catch (err) {
    console.error('GET /groups/:id error:', err);
    res.status(500).json({ msg: err.message });
  }
});

// Delete group (only creator)
router.delete('/:id', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (group.creator.toString() !== req.user) {
      return res.status(403).json({ msg: 'Only the group creator can delete this group' });
    }

    const [files, memories] = await Promise.all([
      File.find({ groupId: req.params.id }),
      Memory.find({ groupId: req.params.id })
    ]);

    await Promise.all([
      ...files.map(file => removeStoredAsset({
        storageProvider: file.storageProvider,
        storagePath: file.storagePath,
        filename: file.filename,
        fileUrl: file.url,
        localDir: uploadDir
      })),
      ...memories.map(memory => removeStoredAsset({
        storageProvider: memory.storageProvider,
        storagePath: memory.storagePath,
        fileUrl: memory.fileUrl,
        localDir: memoryUploadDir
      })),
      removeStoredAsset({
        storageProvider: group.photoStorageProvider,
        storagePath: group.photoStoragePath,
        fileUrl: group.photo,
        localDir: groupPhotoUploadDir
      })
    ]);

    // Delete related data
    await Post.deleteMany({ groupId: req.params.id });
    await Task.deleteMany({ groupId: req.params.id });
    await File.deleteMany({ groupId: req.params.id });
    await Memory.deleteMany({ groupId: req.params.id });
    await GroupNote.deleteMany({ groupId: req.params.id });
    await GroupInvite.deleteMany({ groupId: req.params.id });
    await group.deleteOne();
    res.json({ msg: 'Group deleted successfully' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Leave group (for members, not creator)
router.delete('/:id/leave', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (group.creator.toString() === req.user) {
      return res.status(400).json({ msg: 'Creator cannot leave. Delete the group instead.' });
    }
    if (!isGroupMember(group, req.user)) {
      return res.status(400).json({ msg: 'You are not a member of this group' });
    }
    group.members = group.members.filter(m => m.toString() !== req.user);
    group.coCreators = group.coCreators.filter(c => c.toString() !== req.user);
    await group.save();
    res.json({ msg: 'Left group successfully' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (!isGroupMember(group, req.user)) return res.status(403).json({ msg: 'You are not a member of this group' });
    if (!canManageGroup(group, req.user)) return res.status(403).json({ msg: 'Only group admins can update group settings' });

    const { name, description, subject } = req.body;
    if (!name?.trim()) return res.status(400).json({ msg: 'Group name is required' });

    group.name = name.trim();
    group.description = description?.trim() || '';
    group.subject = subject?.trim() || '';
    await group.save();

    await createGroupActivity({
      groupId: group._id,
      actorId: req.user,
      type: 'group',
      title: 'updated group settings',
      detail: group.name,
      targetId: group._id,
      targetModel: 'Group'
    });
    await createNotifications({
      io: req.app.get('io'),
      userIds: group.members,
      actorId: req.user,
      type: 'group',
      title: `${group.name} was updated`,
      body: 'Group settings were changed',
      href: `/group/${group._id}`,
      meta: { groupId: group._id }
    });

    await group.populate('creator', 'name email avatar isDeveloper');
    await group.populate('members', 'name email avatar isDeveloper');
    await group.populate('coCreators', 'name email avatar isDeveloper');
    const io = req.app.get('io');
    if (io) {
      group.members.forEach(member => io.to(`user_${getEntityId(member)}`).emit('group-updated', group));
    }
    res.json(group);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.put('/:id/background', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (!isGroupMember(group, req.user)) return res.status(403).json({ msg: 'You are not a member of this group' });

    const backgroundId = normalizeChatBackgroundId(req.body?.backgroundId);
    if (!backgroundId) return res.status(400).json({ msg: 'Invalid conversation background' });

    const previousBackgroundId = normalizeChatBackgroundId(group.backgroundId) || DEFAULT_CHAT_BACKGROUND_ID;
    const changed = previousBackgroundId !== backgroundId;
    group.backgroundId = backgroundId;
    await group.save();

    let systemMessage = null;
    if (changed) {
      const actor = await User.findById(req.user).select('name email avatar isDeveloper').lean();
      const actorName = actor?.name || 'Someone';
      systemMessage = await GroupChat.create({
        groupId: group._id,
        userId: req.user,
        text: backgroundId === DEFAULT_CHAT_BACKGROUND_ID
          ? `${actorName} reset the group chat background.`
          : `${actorName} changed the group chat background.`,
        system: true,
        systemType: 'background_changed',
        systemData: { backgroundId, previousBackgroundId },
        seenBy: [{ userId: req.user, seenAt: new Date() }]
      });
      systemMessage = await GroupChat.findById(systemMessage._id)
        .populate('userId', 'name email avatar isDeveloper')
        .populate('replyTo')
        .lean();
    }

    await group.populate('creator', 'name email avatar isDeveloper');
    await group.populate('members', 'name email avatar isDeveloper');
    await group.populate('coCreators', 'name email avatar isDeveloper');

    const io = req.app.get('io');
    if (io) {
      io.to(`group_${group._id}`).emit('group-updated', group);
      group.members.forEach(member => io.to(`user_${getEntityId(member)}`).emit('group-updated', group));
      if (systemMessage) io.to(`group_${group._id}`).emit('receive-group-message', systemMessage);
    }

    res.json({ group, backgroundId, changed, message: systemMessage });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:id/photo', auth, uploadGroupPhoto, async (req, res) => {
  let uploadedPhoto = null;

  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (!isGroupMember(group, req.user)) return res.status(403).json({ msg: 'You are not a member of this group' });
    if (!canManageGroup(group, req.user)) return res.status(403).json({ msg: 'Only group admins can update the group photo' });
    if (!req.file || req.file.size === 0) return res.status(400).json({ msg: 'Please upload a valid image file' });

    uploadedPhoto = isCloudStorageEnabled
      ? await uploadBuffer({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          folder: `groups/${req.params.id}/photo`
        })
      : {
          filename: req.file.filename,
          path: '',
          url: `/uploads/groups/${req.file.filename}`
        };

    const previousPath = group.photoStoragePath;
    const previousProvider = group.photoStorageProvider;
    const previousPhoto = group.photo;
    group.photo = uploadedPhoto.url;
    group.photoStoragePath = uploadedPhoto.path;
    group.photoStorageProvider = uploadedPhoto.provider || (isCloudStorageEnabled ? cloudStorageProvider : 'local');
    await group.save();

    await createGroupActivity({
      groupId: group._id,
      actorId: req.user,
      type: 'group',
      title: 'updated the group photo',
      detail: group.name,
      targetId: group._id,
      targetModel: 'Group'
    });

    await removeStoredAsset({
      storageProvider: previousProvider,
      storagePath: previousPath,
      fileUrl: previousPhoto,
      localDir: groupPhotoUploadDir
    });

    await group.populate('creator', 'name email avatar isDeveloper');
    await group.populate('members', 'name email avatar isDeveloper');
    await group.populate('coCreators', 'name email avatar isDeveloper');
    const io = req.app.get('io');
    if (io) {
      group.members.forEach(member => io.to(`user_${getEntityId(member)}`).emit('group-updated', group));
    }
    res.json(group);
  } catch (err) {
    if (isCloudStorageEnabled && uploadedPhoto?.path) {
      await deleteObject(uploadedPhoto.path, { provider: uploadedPhoto.provider }).catch(() => {});
    } else if (req.file?.path) {
      await removeLocalFile(req.file.path).catch(() => {});
    }
    res.status(err.status || 500).json({ msg: err.message });
  }
});

// ========== MEMBER MANAGEMENT ==========
// Get group members with roles (creator / co‑creator / member)
router.get('/:id/members', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members', 'name email avatar isDeveloper')
      .populate('creator', 'name email avatar isDeveloper')
      .populate('coCreators', 'name email avatar isDeveloper');
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (!group.members.some(m => m && m._id && m._id.toString() === req.user)) {
      return res.status(403).json({ msg: 'You are not a member of this group' });
    }
    const membersWithRoles = group.members
      .filter(m => m && m._id) // filter out any null or invalid members
      .map(member => {
        let role = 'member';
        if (member._id.toString() === group.creator._id.toString()) role = 'creator';
        else if (group.coCreators.some(c => c && c._id && c._id.toString() === member._id.toString())) role = 'co-creator';
        return { ...member.toObject(), role };
      });
    res.json(membersWithRoles);
  } catch (err) {
    console.error('Members error:', err);
    res.status(500).json({ msg: err.message });
  }
});

// Kick a member (creator or co‑creator can kick, with restrictions)
router.delete('/:id/kick/:userId', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ msg: 'Group not found' });

    const isCreator = group.creator.toString() === req.user;
    const isCoCreator = group.coCreators.some(c => c.toString() === req.user);
    if (!isCreator && !isCoCreator) {
      return res.status(403).json({ msg: 'Only creator or co‑creators can kick members' });
    }

    const targetUserId = req.params.userId;
    if (group.creator.toString() === targetUserId) {
      return res.status(403).json({ msg: 'Cannot kick the group creator' });
    }
    const isTargetCoCreator = group.coCreators.some(c => c.toString() === targetUserId);
    if (isTargetCoCreator && !isCreator) {
      return res.status(403).json({ msg: 'Only the creator can kick co‑creators' });
    }

    group.members = group.members.filter(m => m.toString() !== targetUserId);
    group.coCreators = group.coCreators.filter(c => c.toString() !== targetUserId);
    await group.save();
    res.json({ msg: 'Member kicked' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Promote member to co‑creator (only creator)
router.put('/:id/promote/:userId', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (group.creator.toString() !== req.user) {
      return res.status(403).json({ msg: 'Only the creator can promote members' });
    }
    const targetUserId = req.params.userId;
    if (!group.members.some(m => m.toString() === targetUserId)) {
      return res.status(400).json({ msg: 'User is not a member' });
    }
    if (group.coCreators.some(c => c.toString() === targetUserId)) {
      return res.status(400).json({ msg: 'User is already a co‑creator' });
    }
    group.coCreators.push(targetUserId);
    await group.save();
    res.json({ msg: 'User promoted to co‑creator' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Demote co‑creator to member (only creator)
router.put('/:id/demote/:userId', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (group.creator.toString() !== req.user) {
      return res.status(403).json({ msg: 'Only the creator can demote co‑creators' });
    }
    const targetUserId = req.params.userId;
    if (!group.coCreators.some(c => c.toString() === targetUserId)) {
      return res.status(400).json({ msg: 'User is not a co‑creator' });
    }
    group.coCreators = group.coCreators.filter(c => c.toString() !== targetUserId);
    await group.save();
    res.json({ msg: 'Co‑creator demoted to member' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
