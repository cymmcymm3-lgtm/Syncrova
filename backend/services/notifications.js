const Notification = require('../models/Notification');
const { sendNativePushNotification } = require('./nativePush');
const { USER_AVATAR_MEDIA_FIELDS, hydrateMediaUserInPlace } = require('../utils/mediaUrls');

const normalizeId = (value) => String(value?._id || value?.id || value || '');

const messageNotificationClauses = [
  { type: 'message' },
  // `type` has always been required, but this protects any very old record
  // that predates it without misclassifying note/post activity that happens
  // to link to the Messages screen.
  {
    $and: [
      { type: { $exists: false } },
      { href: { $regex: '^/messages(?:[/?]|$)' } }
    ]
  }
];

const retiredNotificationClauses = [
  { type: { $in: ['marketplace', 'listing', 'group'] } },
  { href: { $regex: '^/(?:marketplace|groups|group)(?:/|$)', $options: 'i' } },
  { title: { $regex: '\\b(?:marketplace|listing|buy(?:ing)? and sell(?:ing)?|item sold)\\b', $options: 'i' } },
  { body: { $regex: '\\b(?:marketplace|listing|buy(?:ing)? and sell(?:ing)?|item sold)\\b', $options: 'i' } }
];

// The app deliberately shows attention *categories*, not an ever-growing
// event counter. A busy conversation is still one thing for a person to
// check, just as several reactions are one activity bucket. Keep this on the
// server so a client that only has the newest page of notifications cannot
// accidentally turn a 1/2 badge back into a 9+ badge.
const getUnreadSummary = async (userId) => {
  const visibleUnreadClauses = [
    { userId, read: false },
    // These sections are no longer surfaced in Syncrova, so old records must
    // not keep an attention badge alive.
    { $nor: retiredNotificationClauses }
  ];

  const [messageUnreadCount, activityUnreadCount] = await Promise.all([
    Notification.countDocuments({
      $and: [
        ...visibleUnreadClauses,
        { $or: messageNotificationClauses }
      ]
    }),
    Notification.countDocuments({
      $and: [
        ...visibleUnreadClauses,
        { $nor: messageNotificationClauses }
      ]
    })
  ]);

  const messages = messageUnreadCount > 0 ? 1 : 0;
  const activity = activityUnreadCount > 0 ? 1 : 0;

  return {
    messages,
    activity,
    total: messages + activity,
    // Useful for richer surfaces, without using them as a badge value.
    messageUnreadCount,
    activityUnreadCount
  };
};

const emitNotificationState = async (io, userId, notification = null) => {
  if (!userId) return null;
  const unreadSummary = await getUnreadSummary(userId);
  const state = {
    // This is intentionally an attention-category count (0, 1, or 2), not
    // the raw total of individual notification documents.
    unreadCount: unreadSummary.total,
    unreadSummary,
    notification
  };
  if (io) io.to(`user_${normalizeId(userId)}`).emit('notifications-updated', state);
  return state;
};

const normalizeDedupeKey = (value) => String(value || '').trim().slice(0, 220);

const createNotification = async ({
  io,
  userId,
  actorId,
  type,
  title,
  body = '',
  href = '',
  meta = {},
  dedupeKey = ''
}) => {
  const targetId = normalizeId(userId);
  if (!targetId || (actorId && normalizeId(actorId) === targetId)) return null;

  const normalizedDedupeKey = normalizeDedupeKey(dedupeKey);
  const values = {
    actorId: actorId || null,
    type,
    title,
    body,
    href,
    meta,
    read: false,
    createdAt: new Date()
  };
  const notification = normalizedDedupeKey
    ? await Notification.findOneAndUpdate(
      { userId: targetId, dedupeKey: normalizedDedupeKey },
      { $set: values, $setOnInsert: { userId: targetId, dedupeKey: normalizedDedupeKey } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )
    : await Notification.create({ userId: targetId, ...values });

  await notification.populate('actorId', USER_AVATAR_MEDIA_FIELDS);
  hydrateMediaUserInPlace(notification.actorId);
  await emitNotificationState(io, targetId, notification);
  sendNativePushNotification({
    userId: targetId,
    title,
    body,
    href,
    type,
    actorId,
    actorName: notification.actorId?.name || '',
    actorAvatar: notification.actorId?.avatar || '',
    meta: {
      ...meta,
      notificationId: notification._id
    }
  }).catch(err => {
    console.warn('Native push notification failed:', err.message);
  });
  return notification;
};

const removeNotifications = async ({
  io,
  userId,
  actorId,
  type,
  meta = {},
  dedupeKey = ''
}) => {
  const targetId = normalizeId(userId);
  if (!targetId) return 0;

  const baseQuery = { userId: targetId };
  if (actorId) baseQuery.actorId = normalizeId(actorId);
  if (type) baseQuery.type = type;

  const legacyMetaQuery = Object.entries(meta || {}).reduce((query, [key, value]) => {
    if (value !== undefined && value !== null && value !== '') query[`meta.${key}`] = value;
    return query;
  }, {});
  const normalizedDedupeKey = normalizeDedupeKey(dedupeKey);
  const identities = [];
  if (normalizedDedupeKey) identities.push({ dedupeKey: normalizedDedupeKey });
  if (Object.keys(legacyMetaQuery).length) identities.push(legacyMetaQuery);
  if (!identities.length) return 0;

  const query = { ...baseQuery };
  if (identities.length === 1) Object.assign(query, identities[0]);
  if (identities.length > 1) query.$or = identities;

  const result = await Notification.deleteMany(query);
  if (result.deletedCount) await emitNotificationState(io, targetId);
  return result.deletedCount || 0;
};

const createNotifications = async ({ io, userIds = [], actorId, type, title, body = '', href = '', meta = {}, dedupeKey = '' }) => {
  const uniqueUserIds = [...new Set(userIds.map(normalizeId).filter(Boolean))];
  const created = [];

  for (const userId of uniqueUserIds) {
    const notification = await createNotification({ io, userId, actorId, type, title, body, href, meta, dedupeKey });
    if (notification) created.push(notification);
  }

  return created;
};

module.exports = {
  createNotification,
  createNotifications,
  removeNotifications,
  emitNotificationState,
  getUnreadSummary
};
