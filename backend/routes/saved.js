const express = require('express');
const auth = require('../middleware/auth');
const Post = require('../models/Post');
const Reel = require('../models/Reel');
const Message = require('../models/Message');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const [posts, reels, pinnedMessages] = await Promise.all([
      Post.find({ savedBy: req.user })
        .populate('userId', 'name avatar isDeveloper')
        .populate('groupId', 'name')
        .select('title content scope privacy fileUrl fileType fileName attachments createdAt userId groupId reactions comments shares')
        .sort({ createdAt: -1 })
        .limit(40)
        .lean(),
      Reel.find({ savedBy: req.user, status: 'active' })
        .select('title caption authorName thumbnailUrl embedUrl sourceUrl providerName updatedAt createdAt')
        .sort({ updatedAt: -1 })
        .limit(30)
        .lean(),
      Message.find({
        pinned: true,
        deletedFor: { $ne: req.user },
        $or: [{ from: req.user }, { to: req.user }]
      })
        .populate('from', 'name avatar isDeveloper')
        .populate('to', 'name avatar isDeveloper')
        .select('from to text fileUrl fileType fileName attachments createdAt')
        .sort({ createdAt: -1 })
        .limit(30)
        .lean()
    ]);

    res.json({ posts, reels, messages: pinnedMessages });
  } catch (err) {
    console.error('Saved items error:', err);
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
