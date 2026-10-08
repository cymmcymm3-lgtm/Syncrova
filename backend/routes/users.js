const express = require('express');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { cloudStorageProvider, deleteObject, isCloudStorageEnabled, uploadBuffer } = require('../services/storage');
const Group = require('../models/Group');
const Task = require('../models/Task');
const GameSession = require('../models/GameSession');
const Friendship = require('../models/Friendship');
const Post = require('../models/Post');
const { RANK_TIERS, buildLeaderboard, buildRankStats } = require('../services/ranks');
const { buildGameStats } = require('../services/gameRanks');
const { syncDeveloperAccess } = require('../services/roles');
const { normalizeCampus, normalizeCourse } = require('../utils/academics');
const { hydratePostMedia, serializeMediaUser } = require('../utils/mediaUrls');
const { invalidateAuthUserState } = require('../utils/authSessionCache');
const router = express.Router();

const USER_MEDIA_FIELDS = 'avatar avatarStoragePath avatarStorageProvider coverPhoto coverPhotoStoragePath coverPhotoStorageProvider';
const USER_PUBLIC_SELECT = `name email course campus ${USER_MEDIA_FIELDS} lastSeen isDeveloper studentVerificationStatus studentVerifiedAt`;
const POST_USER_MEDIA_FIELDS = 'name avatar avatarStoragePath avatarStorageProvider isDeveloper';
const POST_AUTHOR_FIELDS = `${POST_USER_MEDIA_FIELDS} studentVerificationStatus`;

const avatarUploadDir = path.join(__dirname, '..', 'uploads', 'avatars');
const coverUploadDir = path.join(__dirname, '..', 'uploads', 'covers');
fs.mkdirSync(avatarUploadDir, { recursive: true });
fs.mkdirSync(coverUploadDir, { recursive: true });

const isBcryptHash = (value = '') => /^\$2[aby]\$\d{2}\$/.test(value);

const toClientUser = (user) => {
  const mediaUser = serializeMediaUser(user);
  return {
    _id: mediaUser?._id,
    id: mediaUser?._id,
    name: mediaUser?.name,
    email: mediaUser?.email,
    course: normalizeCourse(mediaUser?.course),
    campus: normalizeCampus(mediaUser?.campus),
    bio: mediaUser?.bio,
    avatar: mediaUser?.avatar,
    coverPhoto: mediaUser?.coverPhoto,
    lastSeen: mediaUser?.lastSeen,
    isDeveloper: mediaUser?.isDeveloper,
    studentVerificationStatus: mediaUser?.studentVerificationStatus || 'not_submitted',
    studentVerifiedAt: mediaUser?.studentVerifiedAt || null,
    studentVerificationReviewedAt: mediaUser?.studentVerificationReviewedAt || null,
    createdAt: mediaUser?.createdAt
  };
};

const getFriendshipState = (friendship, currentUserId) => {
  if (!friendship) return { status: 'none' };

  const requesterId = String(friendship.requester?._id || friendship.requester || '');
  const recipientId = String(friendship.recipient?._id || friendship.recipient || '');
  const currentId = String(currentUserId || '');

  if (friendship.status === 'accepted') {
    return { status: 'friends', requestId: friendship._id };
  }

  if (friendship.status === 'pending') {
    return {
      status: requesterId === currentId ? 'outgoing' : 'incoming',
      requestId: friendship._id,
      otherUserId: requesterId === currentId ? recipientId : requesterId
    };
  }

  return { status: 'none' };
};

const friendshipStatusPriority = { accepted: 2, pending: 1 };
const getActiveFriendshipBetween = async (currentUserId, profileUserId) => {
  const relationships = await Friendship.find({
    $or: [
      { requester: currentUserId, recipient: profileUserId },
      { requester: profileUserId, recipient: currentUserId }
    ],
    status: { $in: ['pending', 'accepted'] }
  }).select('requester recipient status updatedAt createdAt').lean();

  return relationships.sort((a, b) => {
    const statusDelta = (friendshipStatusPriority[b.status] || 0) - (friendshipStatusPriority[a.status] || 0);
    if (statusDelta !== 0) return statusDelta;
    return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
  })[0] || null;
};

const getAcceptedFriendIds = async (userId) => {
  const rows = await Friendship.find({
    status: 'accepted',
    $or: [{ requester: userId }, { recipient: userId }]
  }).select('requester recipient').lean();

  return rows.map(row => {
    const requester = String(row.requester || '');
    const recipient = String(row.recipient || '');
    return requester === String(userId) ? recipient : requester;
  }).filter(Boolean);
};

const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, file.fieldname === 'coverPhoto' ? coverUploadDir : avatarUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});

const upload = multer({
  storage: isCloudStorageEnabled ? multer.memoryStorage() : localStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      const err = new Error('Please upload an image file');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

const uploadAvatar = (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ msg: 'Avatar must be 5MB or smaller' });
    }

    return res.status(err.status || 400).json({ msg: err.message || 'Upload failed' });
  });
};

const uploadCoverPhoto = (req, res, next) => {
  upload.single('coverPhoto')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ msg: 'Cover photo must be 5MB or smaller' });
    }

    return res.status(err.status || 400).json({ msg: err.message || 'Upload failed' });
  });
};

router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user).select('-password');
    await syncDeveloperAccess(user);
    res.json(toClientUser(user));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.put('/profile', auth, async (req, res) => {
  try {
    const { name, course, campus, bio } = req.body;
    if (!name?.trim()) return res.status(400).json({ msg: 'Name is required' });
    const normalizedCourse = normalizeCourse(course);
    const normalizedCampus = normalizeCampus(campus);
    if (course && !normalizedCourse) return res.status(400).json({ msg: 'Please choose a valid NEMSU course' });
    if (campus && !normalizedCampus) return res.status(400).json({ msg: 'Please choose a valid NEMSU campus' });

    const user = await User.findByIdAndUpdate(
      req.user,
      {
        name: name.trim(),
        course: normalizedCourse,
        campus: normalizedCampus,
        bio: bio?.trim() || ''
      },
      { new: true }
    ).select('-password');

    res.json(toClientUser(user));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.put('/password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ msg: 'Current and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ msg: 'New password must be at least 6 characters' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ msg: 'New password must be different' });
    }

    const user = await User.findById(req.user);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const passwordMatches = isBcryptHash(user.password)
      ? await bcrypt.compare(currentPassword, user.password)
      : user.password === currentPassword;

    if (!passwordMatches) {
      return res.status(400).json({ msg: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    // The checked password must still be current, and changing it also revokes
    // any outstanding recovery link, including one issued during this request.
    const updatedUser = await User.findOneAndUpdate({ _id: user._id, password: user.password }, { $set: {
      password: passwordHash,
      passwordChangedAt: new Date(),
      passwordResetToken: '',
      passwordResetExpires: null,
      passwordResetRequestedBy: null,
      passwordResetRequestedAt: null
    } }, { new: true, runValidators: true });
    if (!updatedUser) {
      return res.status(409).json({ msg: 'Password changed while this request was processing. Please log in again.' });
    }
    invalidateAuthUserState(user._id);

    res.json({ msg: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/avatar', auth, uploadAvatar, async (req, res) => {
  let uploadedAvatar = null;
  try {
    if (!req.file || req.file.size === 0) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ msg: 'Please upload a valid image file' });
    }

    uploadedAvatar = isCloudStorageEnabled
      ? await uploadBuffer({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          folder: `avatars/${req.user}`
        })
      : null;
    const avatarUrl = uploadedAvatar?.url || `/uploads/avatars/${req.file.filename}`;
    const user = await User.findByIdAndUpdate(req.user, {
      avatar: avatarUrl,
      avatarStoragePath: uploadedAvatar?.path || (isCloudStorageEnabled ? '' : `avatars/${req.file.filename}`),
      avatarStorageProvider: uploadedAvatar?.provider || (isCloudStorageEnabled ? cloudStorageProvider : 'local')
    }, { new: true }).select('-password');
    const payloadUser = toClientUser(user);
    res.json({ avatar: payloadUser.avatar, user: payloadUser });
  } catch (err) {
    if (uploadedAvatar?.path) {
      await deleteObject(uploadedAvatar.path, { provider: uploadedAvatar.provider }).catch(() => {});
    }
    res.status(500).json({ msg: err.message });
  }
});

router.post('/cover-photo', auth, uploadCoverPhoto, async (req, res) => {
  let uploadedCover = null;
  try {
    if (!req.file || req.file.size === 0) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ msg: 'Please upload a valid image file' });
    }

    uploadedCover = isCloudStorageEnabled
      ? await uploadBuffer({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          folder: `covers/${req.user}`
        })
      : null;
    const coverPhotoUrl = uploadedCover?.url || `/uploads/covers/${req.file.filename}`;
    const user = await User.findByIdAndUpdate(req.user, {
      coverPhoto: coverPhotoUrl,
      coverPhotoStoragePath: uploadedCover?.path || (isCloudStorageEnabled ? '' : `covers/${req.file.filename}`),
      coverPhotoStorageProvider: uploadedCover?.provider || (isCloudStorageEnabled ? cloudStorageProvider : 'local')
    }, { new: true }).select('-password');
    const payloadUser = toClientUser(user);
    res.json({ coverPhoto: payloadUser.coverPhoto, user: payloadUser });
  } catch (err) {
    if (uploadedCover?.path) {
      await deleteObject(uploadedCover.path, { provider: uploadedCover.provider }).catch(() => {});
    }
    res.status(500).json({ msg: err.message });
  }
});

router.get('/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const users = await User.find({
      _id: { $ne: req.user },
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    }).select(USER_PUBLIC_SELECT).limit(10);
    res.json(users.map(toClientUser));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/rankings/me', auth, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user }).select('members').lean();
    const memberIds = [
      ...new Set([
        req.user,
        ...groups.flatMap(group => (group.members || []).map(member => String(member)))
      ])
    ];

    const [networkUsers, networkTasks, myTasks] = await Promise.all([
      User.find({ _id: { $in: memberIds } }).select(`name email course campus ${USER_MEDIA_FIELDS} isDeveloper`).lean(),
      Task.find({ assignedTo: { $in: memberIds } })
        .select('assignedTo status priority approvalStatus completedAt dueDate')
        .lean(),
      Task.find({ assignedTo: req.user })
        .select('assignedTo status priority approvalStatus completedAt dueDate')
        .lean()
    ]);

    const leaderboard = buildLeaderboard(networkTasks, networkUsers);
    const currentUserRank = leaderboard.find(entry => String(entry.user._id) === String(req.user)) || null;

    res.json({
      me: buildRankStats(myTasks, req.user),
      leaderboard: leaderboard.slice(0, 12),
      currentUserRank,
      totalRanked: leaderboard.length,
      tiers: RANK_TIERS
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/:id/public', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const profile = await User.findById(req.params.id)
      .select(`name email course campus bio ${USER_MEDIA_FIELDS} lastSeen isDeveloper createdAt studentVerificationStatus studentVerifiedAt studentVerificationReviewedAt`);

    if (!profile) return res.status(404).json({ msg: 'User not found' });

    const isSelf = String(profile._id) === String(req.user);
    const [sharedWorkspaces, rankTasks, gameSessions, friendship, viewerFriendIds, profileFriendIds] = await Promise.all([
      Group.countDocuments({
        members: { $all: [req.user, profile._id] }
      }),
      Task.find({ assignedTo: profile._id })
        .select('assignedTo status priority approvalStatus completedAt dueDate')
        .lean(),
      GameSession.find({ userId: profile._id, completedAt: { $ne: null } })
        .select('score accuracy wpm correctCount totalCount maxStreak elapsedMs completedAt achievements')
        .lean(),
      isSelf
        ? Promise.resolve(null)
        : getActiveFriendshipBetween(req.user, profile._id),
      getAcceptedFriendIds(req.user),
      getAcceptedFriendIds(profile._id)
    ]);

    const profileObject = serializeMediaUser(profile.toObject());
    const profileFriendIdSet = new Set(profileFriendIds.map(String));
    const mutualFriendIds = viewerFriendIds
      .map(String)
      .filter(friendId => friendId !== String(profile._id) && profileFriendIdSet.has(friendId));
    const isFriend = isSelf || friendship?.status === 'accepted';
    const visiblePostPrivacy = isSelf ? ['public', 'friends', 'private'] : isFriend ? ['public', 'friends'] : ['public'];
    const [posts, mutualFriends] = await Promise.all([
      Post.find({
        userId: profile._id,
        scope: 'timeline',
        privacy: { $in: visiblePostPrivacy }
      })
        .populate('userId', POST_AUTHOR_FIELDS)
        .populate('comments.userId', POST_USER_MEDIA_FIELDS)
        .populate('comments.reactions.userId', POST_USER_MEDIA_FIELDS)
        .populate('reactions.userId', POST_USER_MEDIA_FIELDS)
        .populate('taggedUsers', POST_USER_MEDIA_FIELDS)
        .sort({ pinned: -1, pinnedAt: -1, createdAt: -1 })
        .limit(12)
        .lean(),
      User.find({ _id: { $in: mutualFriendIds.slice(0, 12) } })
        .select(`name email course campus ${USER_MEDIA_FIELDS} lastSeen isDeveloper createdAt`)
        .lean()
    ]);

    res.json({
      ...profileObject,
      course: normalizeCourse(profileObject.course),
      campus: normalizeCampus(profileObject.campus),
      studentVerificationStatus: profileObject.studentVerificationStatus || 'not_submitted',
      studentVerifiedAt: profileObject.studentVerifiedAt || null,
      studentVerificationReviewedAt: profileObject.studentVerificationReviewedAt || null,
      sharedWorkspaces,
      friendCount: profileFriendIds.length,
      mutualFriendCount: mutualFriendIds.length,
      mutualFriends: mutualFriends.map(toClientUser),
      posts: posts.map(hydratePostMedia),
      rankStats: buildRankStats(rankTasks, profile._id),
      gameStats: buildGameStats(gameSessions),
      gameAchievements: [...new Set(gameSessions.flatMap(session => session.achievements || []))],
      friendship: isSelf ? { status: 'self' } : getFriendshipState(friendship, req.user)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
