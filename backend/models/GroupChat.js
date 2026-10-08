const mongoose = require('mongoose');

const GroupChatSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String },
  system: { type: Boolean, default: false },
  systemType: { type: String, default: '' },
  systemData: { type: mongoose.Schema.Types.Mixed, default: {} },
  fileUrl: { type: String },
  fileType: { type: String },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupChat', default: null },
  pinned: { type: Boolean, default: false },
  pinnedAt: { type: Date, default: null },
  reactions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  seenBy: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    seenAt: { type: Date, default: Date.now }
  }],
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now }
});

// The chat history is always scoped to a group and ordered by creation time.
GroupChatSchema.index({ groupId: 1, createdAt: -1 });

module.exports = mongoose.model('GroupChat', GroupChatSchema);
