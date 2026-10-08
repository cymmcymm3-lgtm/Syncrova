const mongoose = require('mongoose');

const GroupInviteSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  invitedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending',
    index: true
  },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

GroupInviteSchema.index({ groupId: 1, invitedUser: 1, status: 1 });

module.exports = mongoose.models.GroupInvite || mongoose.model('GroupInvite', GroupInviteSchema);
