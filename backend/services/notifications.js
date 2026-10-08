const Notification = require('../models/Notification');
const { sendNativePushNotification } = require('./nativePush');
const { USER_AVATAR_MEDIA_FIELDS, hydrateMediaUserInPlace } = require('../utils/mediaUrls');

const normalizeId = (value) => String(value?._id || value?.id || value || '');

const getUnreadCount = (userId) => Notification.countDocuments({ userId, read: false });

const emitNotificationState = async (io, userId, notification = null) => {
  if (!io || !userId) return;
  const unreadCount = await getUnreadCount(userId);
  io.to(`user_${normalizeId(userId)}`).emit('notifications-updated', {
    unreadCount,
    notification
  });
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
  getUnreadCount
};
