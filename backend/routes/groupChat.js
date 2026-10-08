const express = require('express');
const auth = require('../middleware/auth');
const GroupChat = require('../models/GroupChat');
const Group = require('../models/Group');
const User = require('../models/User');
const { createNotifications } = require('../services/notifications');
const { getMentionedMemberIds } = require('../services/mentions');
const router = express.Router();

const isGroupMember = (group, userId) => group.members.some(member => member.toString() === userId);
const populateMessage = async (message) => {
  await message.populate('userId', 'name avatar isDeveloper');
  await message.populate('seenBy.userId', 'name avatar isDeveloper');
  await message.populate('reactions.userId', 'name avatar isDeveloper');
  await message.populate({
    path: 'replyTo',
    select: 'text fileUrl fileType userId createdAt',
    populate: { path: 'userId', select: 'name avatar isDeveloper' }
  });
  return message;
};

const markMessagesSeen = async ({ groupId, userId, messageIds = [] }) => {
  const query = {
    groupId,
    userId: { $ne: userId },
    deletedFor: { $ne: userId },
    'seenBy.userId': { $ne: userId }
  };

  if (messageIds.length) {
    query._id = { $in: messageIds };
  }

  const messagesToMark = await GroupChat.find(query).select('_id');
  if (messagesToMark.length === 0) return [];

  const ids = messagesToMark.map(message => message._id);
  await GroupChat.updateMany(
    { _id: { $in: ids } },
    { $push: { seenBy: { userId, seenAt: new Date() } } }
  );

  return ids.map(id => id.toString());
};

// Get all messages for a group (only if user is member)
router.get('/:groupId', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (!isGroupMember(group, req.user)) return res.status(403).json({ msg: 'Not a member' });

    const newlySeenMessageIds = await markMessagesSeen({
      groupId: req.params.groupId,
      userId: req.user
    });

    const messages = await GroupChat.find({ groupId: req.params.groupId, deletedFor: { $ne: req.user } })
      .populate('userId', 'name avatar isDeveloper')
      .populate('seenBy.userId', 'name avatar isDeveloper')
      .populate('reactions.userId', 'name avatar isDeveloper')
      .populate({
        path: 'replyTo',
        select: 'text fileUrl fileType userId createdAt',
        populate: { path: 'userId', select: 'name avatar isDeveloper' }
      })
      .sort({ createdAt: 1 });

    if (newlySeenMessageIds.length) {
      const reader = await User.findById(req.user).select('name avatar isDeveloper');
      const io = req.app.get('io');

      if (io && reader) {
        io.to(`group_${req.params.groupId}`).emit('group-messages-seen', {
          groupId: req.params.groupId,
          messageIds: newlySeenMessageIds,
          seenBy: {
            userId: reader,
            seenAt: new Date()
          }
        });
      }
    }

    res.json(messages);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Mark selected or all visible group messages as seen.
router.put('/:groupId/seen', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (!isGroupMember(group, req.user)) return res.status(403).json({ msg: 'Not a member' });

    const messageIds = Array.isArray(req.body.messageIds) ? req.body.messageIds : [];
    const newlySeenMessageIds = await markMessagesSeen({
      groupId: req.params.groupId,
      userId: req.user,
      messageIds
    });
    const reader = await User.findById(req.user).select('name avatar isDeveloper');

    if (newlySeenMessageIds.length && reader) {
      const seenBy = {
        userId: reader,
        seenAt: new Date()
      };
      const io = req.app.get('io');

      if (io) {
        io.to(`group_${req.params.groupId}`).emit('group-messages-seen', {
          groupId: req.params.groupId,
          messageIds: newlySeenMessageIds,
          seenBy
        });
      }

      return res.json({ messageIds: newlySeenMessageIds, seenBy });
    }

    res.json({ messageIds: [], seenBy: null });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// React to a group chat message.
router.post('/:messageId/react', auth, async (req, res) => {
  try {
    const emoji = String(req.body.emoji || '').trim().slice(0, 8);
    if (!emoji) return res.status(400).json({ msg: 'Emoji is required' });

    const message = await GroupChat.findById(req.params.messageId);
    if (!message) return res.status(404).json({ msg: 'Message not found' });

    const group = await Group.findById(message.groupId);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (!isGroupMember(group, req.user)) return res.status(403).json({ msg: 'Not a member' });

    const existingIndex = (message.reactions || []).findIndex(reaction => reaction.userId.toString() === req.user);
    if (existingIndex >= 0 && message.reactions[existingIndex].emoji === emoji) {
      message.reactions.splice(existingIndex, 1);
    } else if (existingIndex >= 0) {
      message.reactions[existingIndex].emoji = emoji;
      message.reactions[existingIndex].createdAt = new Date();
    } else {
      message.reactions.push({ userId: req.user, emoji });
    }

    await message.save();
    await populateMessage(message);

    const io = req.app.get('io');
    if (io) {
      io.to(`group_${message.groupId}`).emit('group-message-updated', message);
    }

    res.json(message);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Pin or unpin a group chat message.
router.put('/:messageId/pin', auth, async (req, res) => {
  try {
    const message = await GroupChat.findById(req.params.messageId);
    if (!message) return res.status(404).json({ msg: 'Message not found' });

    const group = await Group.findById(message.groupId);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (!isGroupMember(group, req.user)) return res.status(403).json({ msg: 'Not a member' });

    message.pinned = !message.pinned;
    message.pinnedAt = message.pinned ? new Date() : null;
    await message.save();
    await populateMessage(message);

    const io = req.app.get('io');
    if (io) {
      io.to(`group_${message.groupId}`).emit('group-message-updated', message);
    }

    res.json(message);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Delete a group chat message (only the sender can delete)
router.delete('/:messageId', auth, async (req, res) => {
  try {
    const message = await GroupChat.findById(req.params.messageId);
    if (!message) return res.status(404).json({ msg: 'Message not found' });
    if (message.userId.toString() !== req.user) {
      return res.status(403).json({ msg: 'Not authorized' });
    }
    await message.deleteOne();
    res.json({ msg: 'Message deleted' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Post a message to group chat
router.post('/', auth, async (req, res) => {
  try {
    const { groupId, text, fileUrl, fileType, replyTo } = req.body;
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ msg: 'Group not found' });
    if (!isGroupMember(group, req.user)) return res.status(403).json({ msg: 'Not a member' });

    let replyMessageId = null;
    if (replyTo) {
      const replyMessage = await GroupChat.findOne({ _id: replyTo, groupId }).select('_id');
      replyMessageId = replyMessage?._id || null;
    }

    const message = new GroupChat({ groupId, userId: req.user, text, fileUrl, fileType, replyTo: replyMessageId });
    await message.save();
    const mentionedUserIds = await getMentionedMemberIds(group, text);
    if (mentionedUserIds.length) {
      await createNotifications({
        io: req.app.get('io'),
        userIds: mentionedUserIds,
        actorId: req.user,
        type: 'group',
        title: `${group.name}: you were mentioned in chat`,
        body: text,
        href: `/group/${groupId}`,
        meta: { groupId, messageId: message._id, mention: true }
      });
    }
    await populateMessage(message);
    res.json(message);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});
// Delete for me (just add current user to deletedFor)
router.delete('/me/:messageId', auth, async (req, res) => {
  try {
    const message = await GroupChat.findById(req.params.messageId);
    if (!message) return res.status(404).json({ msg: 'Message not found' });
    if (!message.deletedFor.some(userId => userId.toString() === req.user)) {
      message.deletedFor.push(req.user);
      await message.save();
    }
    res.json({ msg: 'Message hidden for you' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Unsend for everyone (permanent delete)
router.delete('/everyone/:messageId', auth, async (req, res) => {
  try {
    const message = await GroupChat.findById(req.params.messageId);
    if (!message) return res.status(404).json({ msg: 'Message not found' });
    if (message.userId.toString() !== req.user) {
      return res.status(403).json({ msg: 'Not authorized' });
    }
    await message.deleteOne();
    res.json({ msg: 'Message deleted for everyone' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
