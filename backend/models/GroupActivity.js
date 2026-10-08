const mongoose = require('mongoose');

const GroupActivitySchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type: {
    type: String,
    enum: ['post', 'comment', 'reaction', 'task', 'file', 'memory', 'note', 'group'],
    required: true
  },
  title: { type: String, required: true },
  detail: { type: String, default: '' },
  targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
  targetModel: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

GroupActivitySchema.index({ groupId: 1, createdAt: -1 });

module.exports = mongoose.models.GroupActivity || mongoose.model('GroupActivity', GroupActivitySchema);
