const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Group = require('../models/Group');
const Task = require('../models/Task');
const Message = require('../models/Message');
const { hydrateGroupMedia, serializeMediaUser } = require('../utils/mediaUrls');

const router = express.Router();

const getId = (value) => String(value?._id || value?.id || value || '');
const DASHBOARD_USER_FIELDS = 'name email avatar avatarStoragePath avatarStorageProvider isDeveloper';
const DASHBOARD_TASK_USER_FIELDS = 'name avatar avatarStoragePath avatarStorageProvider isDeveloper';
const serializeMaybeUser = (value) => (
  value && typeof value === 'object' && (value.name || value.avatar || value.avatarStoragePath)
    ? serializeMediaUser(value)
    : value
);

const describeMessage = (message) => {
  if (!message) return 'Open chat';
  if (message.unsent) return 'Message removed';
  if (message.text) return message.text;
  if (message.fileType === 'image') return 'Photo';
  if (message.fileType === 'video') return 'Video';
  if (message.fileType === 'audio') return 'Voice message';
  if (message.fileUrl) return message.fileName || 'File';
  return 'Open chat';
};

const fetchConversationSummaries = async (userId) => {
  const currentUserId = new mongoose.Types.ObjectId(userId);
  const rows = await Message.aggregate([
    {
      $match: {
        $or: [{ from: currentUserId }, { to: currentUserId }],
        deletedFor: { $ne: currentUserId }
      }
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: {
          $cond: [{ $eq: ['$from', currentUserId] }, '$to', '$from']
        },
        lastMessageDoc: {
          $first: {
            text: '$text',
            fileType: '$fileType',
            fileUrl: '$fileUrl',
            unsent: '$unsent',
            createdAt: '$createdAt'
          }
        },
        unreadCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$to', currentUserId] },
                  { $eq: ['$read', false] },
                  { $eq: ['$unsent', false] }
                ]
              },
              1,
              0
            ]
          }
        }
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: '$user' },
    {
      $project: {
        _id: 0,
        user: {
          _id: '$user._id',
            name: '$user.name',
            email: '$user.email',
            avatar: '$user.avatar',
            avatarStoragePath: '$user.avatarStoragePath',
            avatarStorageProvider: '$user.avatarStorageProvider',
            lastSeen: '$user.lastSeen'
          },
        lastMessageDoc: 1,
        lastTime: '$lastMessageDoc.createdAt',
        unreadCount: 1
      }
    },
    { $sort: { lastTime: -1 } }
  ]);

  return rows.map(item => ({
    user: serializeMediaUser(item.user),
    lastMessage: describeMessage(item.lastMessageDoc),
    lastTime: item.lastTime,
    unreadCount: item.unreadCount || 0
  }));
};

router.get('/summary', auth, async (req, res) => {
  try {
    const requestedTaskLimit = Number(req.query.taskLimit || 220);
    const taskLimit = Number.isFinite(requestedTaskLimit) ? Math.max(60, Math.min(500, Math.floor(requestedTaskLimit))) : 220;
    const groups = await Group.find({ members: req.user })
      .populate('creator', DASHBOARD_USER_FIELDS)
      .populate('members', DASHBOARD_USER_FIELDS)
      .sort({ createdAt: -1 })
      .lean();

    const groupIds = groups.map(group => group._id);
    const [tasks, conversations] = await Promise.all([
      groupIds.length
        ? Task.find({ groupId: { $in: groupIds } })
            .populate('assignedTo', DASHBOARD_TASK_USER_FIELDS)
            .populate('createdBy', DASHBOARD_TASK_USER_FIELDS)
            .populate('completedBy', DASHBOARD_TASK_USER_FIELDS)
            .sort({ createdAt: -1 })
            .limit(taskLimit)
            .lean()
        : [],
      fetchConversationSummaries(req.user)
    ]);
    const openTasks = tasks.filter(task => task.status !== 'done');
    const assignedOpenTasks = openTasks.filter(task => getId(task.assignedTo) === getId(req.user));
    const unreadMessages = conversations.reduce((sum, conversation) => sum + (conversation.unreadCount || 0), 0);

    res.json({
      groups: groups.map(hydrateGroupMedia),
      tasks: tasks.map(task => ({
        ...task,
        assignedTo: serializeMaybeUser(task.assignedTo),
        createdBy: serializeMaybeUser(task.createdBy),
        completedBy: serializeMaybeUser(task.completedBy)
      })),
      conversations,
      summary: {
        groupCount: groups.length,
        ownedCount: groups.filter(group => getId(group.creator) === getId(req.user)).length,
        taskCount: tasks.length,
        openTaskCount: openTasks.length,
        assignedOpenTaskCount: assignedOpenTasks.length,
        unreadMessages
      }
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
