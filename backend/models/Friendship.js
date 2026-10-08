const mongoose = require('mongoose');

const FriendshipSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending',
    index: true
  },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

FriendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });
FriendshipSchema.index({ recipient: 1, status: 1, updatedAt: -1 });
FriendshipSchema.index({ requester: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.models.Friendship || mongoose.model('Friendship', FriendshipSchema);
