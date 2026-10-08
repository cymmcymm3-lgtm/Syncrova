const mongoose = require('mongoose');

const GroupNoteSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 180 },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

GroupNoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('GroupNote', GroupNoteSchema);
