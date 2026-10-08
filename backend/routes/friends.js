const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const { normalizeCampus, normalizeCourse } = require('../utils/academics');
const { createNotification } = require('../services/notifications');
const { serializeMediaUser } = require('../utils/mediaUrls');

const router = express.Router();

const userFields = 'name email course campus avatar avatarStoragePath avatarStorageProvider coverPhoto coverPhotoStoragePath coverPhotoStorageProvider bio lastSeen isDeveloper createdAt';
const suggestionFields = 'name course campus avatar avatarStoragePath avatarStorageProvider lastSeen isDeveloper createdAt';
const normalizeId = (value) => String(value?._id || value?.id || value || '');
const activeStatuses = ['pending', 'accepted'];
const statusPriority = { accepted: 2, pending: 1, declined: 0 };

const getPairKey = (firstUserId, secondUserId) => (
  [normalizeId(firstUserId), normalizeId(secondUserId)].sort().join(':')
);

const sortRelationships = (relationships = []) => [...relationships].sort((a, b) => {
  const statusDelta = (statusPriority[b.status] || 0) - (statusPriority[a.status] || 0);
  if (statusDelta !== 0) return statusDelta;
  return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
});

const toClientUser = (user) => {
  if (!user) return null;
  const object = serializeMediaUser(user);
  return {
    _id: object._id,
    id: object._id,
    name: object.name,
    email: object.email,
    course: normalizeCourse(object.course),
    campus: normalizeCampus(object.campus),
    bio: object.bio,
    avatar: object.avatar,
    coverPhoto: object.coverPhoto,
    lastSeen: object.lastSeen,
    isDeveloper: object.isDeveloper,
    createdAt: object.createdAt
  };
};

const toSuggestionUser = (user) => {
  if (!user) return null;
  const object = serializeMediaUser(user);
  return {
    _id: object._id,
    id: object._id,
    name: object.name,
    course: normalizeCourse(object.course),
    campus: normalizeCampus(object.campus),
    avatar: object.avatar,
    lastSeen: object.lastSeen,
    isDeveloper: object.isDeveloper,
    createdAt: object.createdAt
  };
};

const relationPayload = (friendship, currentUserId) => {
  if (!friendship) return { status: 'none' };

  const requesterId = normalizeId(friendship.requester);
  const recipientId = normalizeId(friendship.recipient);
  const currentId = normalizeId(currentUserId);

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

const findRelationships = (currentUserId, otherUserId, statuses = null) => Friendship.find({
  $or: [
    { requester: currentUserId, recipient: otherUserId },
    { requester: otherUserId, recipient: currentUserId }
  ],
  ...(statuses ? { status: { $in: statuses } } : {})
});

const cleanupDuplicateActiveRelationships = async (relationships = [], keepId) => {
  const keep = normalizeId(keepId);
  const duplicateIds = relationships
    .filter(item => activeStatuses.includes(item.status))
    .filter(item => normalizeId(item._id) !== keep)
    .map(item => item._id);

  if (duplicateIds.length) {
    await Friendship.deleteMany({ _id: { $in: duplicateIds } });
  }
};

const cleanupPairActiveRelationships = async (firstUserId, secondUserId, keepId) => {
  const relationships = await findRelationships(firstUserId, secondUserId, activeStatuses);
  await cleanupDuplicateActiveRelationships(relationships, keepId);
};

const emitFriendSync = (io, userIds = []) => {
  if (!io) return;
  userIds.map(normalizeId).filter(Boolean).forEach(userId => {
    io.to(`user_${userId}`).emit('friend-request-updated');
  });
};

router.get('/summary', auth, async (req, res) => {
  try {
    const currentUserId = req.user;
    const [connections, users] = await Promise.all([
      Friendship.find({
        $or: [{ requester: currentUserId }, { recipient: currentUserId }],
        status: { $in: ['pending', 'accepted'] }
      })
        .populate('requester', userFields)
        .populate('recipient', userFields)
        .sort({ updatedAt: -1 })
        .lean(),
      User.find({ _id: { $ne: currentUserId } })
        .select(userFields)
        .sort({ name: 1 })
        .lean()
    ]);

    const relationByUser = new Map();
    const friends = [];
    const incoming = [];
    const outgoing = [];

    const sortedConnections = sortRelationships(connections);
    const duplicateActiveIds = [];
    const seenPairs = new Set();

    sortedConnections.forEach(connection => {
      const requesterId = normalizeId(connection.requester);
      const recipientId = normalizeId(connection.recipient);
      const pairKey = getPairKey(requesterId, recipientId);
      if (seenPairs.has(pairKey)) {
        duplicateActiveIds.push(connection._id);
        return;
      }
      seenPairs.add(pairKey);

      const isRequester = requesterId === normalizeId(currentUserId);
      const otherUser = isRequester ? connection.recipient : connection.requester;
      if (!otherUser) return;

      const relation = relationPayload(connection, currentUserId);
      relationByUser.set(normalizeId(otherUser), relation);

      if (connection.status === 'accepted') {
        friends.push({
          _id: connection._id,
          since: connection.respondedAt || connection.updatedAt,
          user: toClientUser(otherUser),
          friendship: relation
        });
      } else if (isRequester) {
        outgoing.push({
          _id: connection._id,
          createdAt: connection.createdAt,
          recipient: toClientUser(connection.recipient),
          friendship: relation
        });
      } else {
        incoming.push({
          _id: connection._id,
          createdAt: connection.createdAt,
          requester: toClientUser(connection.requester),
          friendship: relation
        });
      }
    });

    if (duplicateActiveIds.length) {
      Friendship.deleteMany({ _id: { $in: duplicateActiveIds } }).catch(() => {});
    }

    const people = users.map(user => ({
      ...toClientUser(user),
      friendship: relationByUser.get(normalizeId(user)) || { status: 'none' }
    }));

    res.json({
      friends,
      incoming,
      outgoing,
      people,
      counts: {
        friends: friends.length,
        incoming: incoming.length,
        outgoing: outgoing.length,
        people: people.length
      }
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// A small, privacy-safe list for first-time onboarding. The full friend
// directory stays on /summary; this endpoint deliberately excludes email,
// existing connections, and unbounded user reads.
router.get('/suggestions', auth, async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 12) : 3;
    const currentUserId = req.user;
    const relationships = await Friendship.find({
      $or: [{ requester: currentUserId }, { recipient: currentUserId }],
      status: { $in: activeStatuses }
    }).select('requester recipient').lean();

    const excludedIds = new Set([normalizeId(currentUserId)]);
    relationships.forEach(relationship => {
      excludedIds.add(normalizeId(relationship.requester));
      excludedIds.add(normalizeId(relationship.recipient));
    });

    const users = await User.find({ _id: { $nin: [...excludedIds] } })
      .select(suggestionFields)
      .sort({ name: 1, _id: 1 })
      .limit(limit)
      .lean();

    res.json({ people: users.map(toSuggestionUser).filter(Boolean) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/request/:userId', auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(404).json({ msg: 'User not found' });
    }
    if (normalizeId(targetId) === normalizeId(req.user)) {
      return res.status(400).json({ msg: 'You cannot add yourself' });
    }

    const targetUser = await User.findById(targetId).select(userFields).lean();
    if (!targetUser) return res.status(404).json({ msg: 'User not found' });

    const relationships = sortRelationships(await findRelationships(req.user, targetId));
    let friendship = relationships.find(item => activeStatuses.includes(item.status));

    if (friendship?.status === 'accepted') {
      await cleanupDuplicateActiveRelationships(relationships, friendship._id);
      return res.json({ msg: 'Already friends', friendship: relationPayload(friendship, req.user) });
    }
    if (friendship?.status === 'pending') {
      await cleanupDuplicateActiveRelationships(relationships, friendship._id);
      const relation = relationPayload(friendship, req.user);
      return res.json({
        msg: relation.status === 'incoming' ? 'This user already sent you a request' : 'Friend request already pending',
        friendship: relation
      });
    }

    friendship = relationships.find(item => (
      item.status === 'declined'
      && normalizeId(item.requester) === normalizeId(req.user)
      && normalizeId(item.recipient) === normalizeId(targetId)
    )) || relationships.find(item => item.status === 'declined');

    if (friendship) {
      friendship.requester = req.user;
      friendship.recipient = targetId;
      friendship.status = 'pending';
      friendship.respondedAt = null;
    } else {
      friendship = new Friendship({
        requester: req.user,
        recipient: targetId,
        status: 'pending'
      });
    }

    await friendship.save();
    await cleanupDuplicateActiveRelationships(relationships, friendship._id);
    await cleanupPairActiveRelationships(req.user, targetId, friendship._id);
    emitFriendSync(req.app.get('io'), [req.user, targetId]);
    await createNotification({
      io: req.app.get('io'),
      userId: targetId,
      actorId: req.user,
      type: 'friend',
      title: 'New friend request',
      body: 'wants to connect with you.',
      href: '/friends',
      meta: { friendshipId: friendship._id }
    });

    res.status(201).json({
      msg: 'Friend request sent',
      user: toClientUser(targetUser),
      friendship: relationPayload(friendship, req.user)
    });
  } catch (err) {
    if (err.code === 11000) {
      const existing = sortRelationships(await findRelationships(req.user, req.params.userId, activeStatuses))[0];
      return res.json({
        msg: 'Friend request already exists',
        friendship: relationPayload(existing, req.user)
      });
    }
    res.status(500).json({ msg: err.message });
  }
});

router.put('/requests/:requestId/accept', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.requestId)) {
      return res.status(404).json({ msg: 'Friend request not found' });
    }

    const friendship = await Friendship.findOneAndUpdate(
      {
        _id: req.params.requestId,
        recipient: req.user,
        status: 'pending'
      },
      {
        status: 'accepted',
        respondedAt: new Date()
      },
      { new: true }
    );

    if (!friendship) return res.status(404).json({ msg: 'Friend request not found' });
    const relationships = await findRelationships(friendship.requester, friendship.recipient, activeStatuses);
    await cleanupDuplicateActiveRelationships(relationships, friendship._id);
    await cleanupPairActiveRelationships(friendship.requester, friendship.recipient, friendship._id);

    emitFriendSync(req.app.get('io'), [friendship.requester, friendship.recipient]);
    await createNotification({
      io: req.app.get('io'),
      userId: friendship.requester,
      actorId: req.user,
      type: 'friend',
      title: 'Friend request accepted',
      body: 'accepted your friend request.',
      href: '/friends',
      meta: { friendshipId: friendship._id }
    });
    res.json({ msg: 'Friend request accepted', friendship: relationPayload(friendship, req.user) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.put('/requests/:requestId/decline', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.requestId)) {
      return res.status(404).json({ msg: 'Friend request not found' });
    }

    const friendship = await Friendship.findOne({
      _id: req.params.requestId,
      recipient: req.user,
      status: 'pending'
    });

    if (!friendship) return res.status(404).json({ msg: 'Friend request not found' });

    friendship.status = 'declined';
    friendship.respondedAt = new Date();
    await friendship.save();
    await Friendship.updateMany({
      _id: { $ne: friendship._id },
      status: 'pending',
      $or: [
        { requester: friendship.requester, recipient: friendship.recipient },
        { requester: friendship.recipient, recipient: friendship.requester }
      ]
    }, {
      $set: { status: 'declined', respondedAt: new Date() }
    });

    emitFriendSync(req.app.get('io'), [friendship.requester, friendship.recipient]);
    res.json({ msg: 'Friend request declined', friendship: { status: 'none' } });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.delete('/requests/:requestId', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.requestId)) {
      return res.status(404).json({ msg: 'Friend request not found' });
    }

    const friendship = await Friendship.findOneAndDelete({
      _id: req.params.requestId,
      requester: req.user,
      status: 'pending'
    });

    if (!friendship) return res.status(404).json({ msg: 'Friend request not found' });

    const remaining = sortRelationships(
      await findRelationships(friendship.requester, friendship.recipient, activeStatuses)
    )[0];

    emitFriendSync(req.app.get('io'), [friendship.requester, friendship.recipient]);
    res.json({ msg: 'Friend request canceled', friendship: relationPayload(remaining, req.user) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.delete('/:friendshipId', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.friendshipId)) {
      return res.status(404).json({ msg: 'Friendship not found' });
    }

    const friendship = await Friendship.findOneAndDelete({
      _id: req.params.friendshipId,
      status: 'accepted',
      $or: [{ requester: req.user }, { recipient: req.user }]
    });

    if (!friendship) return res.status(404).json({ msg: 'Friendship not found' });

    emitFriendSync(req.app.get('io'), [friendship.requester, friendship.recipient]);
    res.json({ msg: 'Friend removed' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
