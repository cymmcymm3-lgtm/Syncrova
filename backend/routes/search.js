const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Group = require('../models/Group');
const Post = require('../models/Post');
const Message = require('../models/Message');
const File = require('../models/File');
const Friendship = require('../models/Friendship');
const MarketplaceListing = require('../models/MarketplaceListing');

const router = express.Router();

const normalizeId = (value) => String(value?._id || value?.id || value || '');

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildRegex = (query = '') => new RegExp(escapeRegex(query.trim()).slice(0, 80), 'i');

const getAcceptedFriendIds = async (userId) => {
  const rows = await Friendship.find({
    status: 'accepted',
    $or: [{ requester: userId }, { recipient: userId }]
  }).select('requester recipient').lean();

  return rows.map(row => {
    const requester = normalizeId(row.requester);
    const recipient = normalizeId(row.recipient);
    return requester === normalizeId(userId) ? recipient : requester;
  }).filter(Boolean);
};

router.get('/', auth, async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    if (query.length < 2) {
      return res.json({ query, users: [], posts: [], marketplace: [], workspaces: [], messages: [], files: [] });
    }

    const regex = buildRegex(query);
    const currentUserId = new mongoose.Types.ObjectId(req.user);
    const [friendIds, memberGroups] = await Promise.all([
      getAcceptedFriendIds(req.user),
      Group.find({ members: req.user }).select('_id name').lean()
    ]);
    const groupIds = memberGroups.map(group => group._id);

    const [users, marketplace, workspaces, posts, messages, files] = await Promise.all([
      User.find({
        _id: { $ne: req.user },
        $or: [{ name: regex }, { email: regex }, { course: regex }, { campus: regex }]
      })
        .select('name email avatar isDeveloper course campus')
        .limit(8)
        .lean(),
      MarketplaceListing.find({
        status: 'active',
        $or: [{ title: regex }, { description: regex }, { category: regex }, { campus: regex }, { meetupSpot: regex }]
      })
        .populate('seller', 'name avatar isDeveloper campus studentVerificationStatus')
        .select('seller title description price category condition meetupSpot campus photos createdAt status')
        .sort({ createdAt: -1 })
        .limit(8)
        .lean(),
      Group.find({
        members: req.user,
        $or: [{ name: regex }, { description: regex }, { subject: regex }, { joinCode: regex }]
      })
        .select('name description subject photo joinCode members createdAt')
        .limit(8)
        .lean(),
      Post.find({
        $or: [
          {
            scope: 'timeline',
            $or: [
              { userId: req.user },
              { privacy: 'public' },
              { privacy: 'friends', userId: { $in: friendIds } }
            ]
          },
          { groupId: { $in: groupIds } }
        ],
        $and: [{ $or: [{ title: regex }, { content: regex }, { fileName: regex }] }]
      })
        .populate('userId', 'name avatar isDeveloper')
        .populate('groupId', 'name')
        .select('title content scope privacy fileUrl fileType createdAt userId groupId reactions comments')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      Message.find({
        deletedFor: { $ne: currentUserId },
        unsent: { $ne: true },
        $and: [
          { $or: [{ from: currentUserId }, { to: currentUserId }] },
          { $or: [{ text: regex }, { fileName: regex }] }
        ]
      })
        .populate('from', 'name avatar isDeveloper')
        .populate('to', 'name avatar isDeveloper')
        .select('from to text fileType fileName createdAt')
        .sort({ createdAt: -1 })
        .limit(8)
        .lean(),
      File.find({
        groupId: { $in: groupIds },
        $or: [{ originalName: regex }, { filename: regex }, { mimeType: regex }]
      })
        .populate('groupId', 'name')
        .populate('uploadedBy', 'name avatar isDeveloper')
        .select('groupId originalName filename url mimeType size uploadedBy uploadDate')
        .sort({ uploadDate: -1 })
        .limit(8)
        .lean()
    ]);

    res.json({
      query,
      users,
      marketplace,
      workspaces,
      posts,
      messages: messages.map(message => {
        const other = normalizeId(message.from) === normalizeId(req.user) ? message.to : message.from;
        return { ...message, otherUser: other };
      }),
      files
    });
  } catch (err) {
    console.error('Global search error:', err);
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
