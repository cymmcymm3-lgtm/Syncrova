const GroupActivity = require('../models/GroupActivity');
const { USER_AVATAR_MEDIA_FIELDS, hydrateMediaUserInPlace } = require('../utils/mediaUrls');

const createGroupActivity = async ({ groupId, actorId, type, title, detail = '', targetId = null, targetModel = '' }) => {
  if (!groupId || !type || !title) return null;

  const activity = await GroupActivity.create({
    groupId,
    actorId: actorId || null,
    type,
    title,
    detail,
    targetId,
    targetModel
  });
  await activity.populate('actorId', USER_AVATAR_MEDIA_FIELDS);
  hydrateMediaUserInPlace(activity.actorId);
  return activity;
};

module.exports = { createGroupActivity };
