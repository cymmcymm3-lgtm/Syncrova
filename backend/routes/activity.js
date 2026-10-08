const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Group = require('../models/Group');
const GroupActivity = require('../models/GroupActivity');
const { USER_AVATAR_MEDIA_FIELDS, hydrateMediaUserInPlace } = require('../utils/mediaUrls');
const router = express.Router();

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

router.get('/group/:groupId', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.groupId)) return res.status(400).json({ msg: 'Invalid group id' });

    const group = await Group.findOne({ _id: req.params.groupId, members: req.user });
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });

    const activities = await GroupActivity.find({ groupId: req.params.groupId })
      .populate('actorId', USER_AVATAR_MEDIA_FIELDS)
      .sort({ createdAt: -1 })
      .limit(80);
    activities.forEach(activity => hydrateMediaUserInPlace(activity.actorId));
    res.json(activities);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
