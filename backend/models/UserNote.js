const mongoose = require('mongoose');

const UserNoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  text: { type: String, required: true, maxlength: 140 },
  reactions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: { type: String }
  }],
  views: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    viewedAt: { type: Date, default: Date.now }
  }],
  comments: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true, maxlength: 300 },
    reactions: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      emoji: { type: String }
    }],
    date: { type: Date, default: Date.now }
  }],
  expiresAt: { type: Date, required: true, index: true }
}, { timestamps: true });

module.exports = mongoose.models.UserNote || mongoose.model('UserNote', UserNoteSchema);
