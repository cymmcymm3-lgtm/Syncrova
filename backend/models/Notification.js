const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type: {
    type: String,
    enum: ['message', 'post', 'comment', 'reaction', 'task', 'file', 'memory', 'note', 'group', 'friend', 'story', 'marketplace'],
    required: true
  },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  href: { type: String, default: '' },
  // A stable identity for an event that may be updated (for example, a
  // reaction that changes from one emoji to another). This keeps a user from
  // receiving a new notification document for every state change.
  dedupeKey: { type: String, default: '', trim: true, maxlength: 220 },
  read: { type: Boolean, default: false, index: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true }
});

NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
// The notification center lists all of one user's events by recency, while
// the preceding index is reserved for unread-count queries.
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, dedupeKey: 1, createdAt: -1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
