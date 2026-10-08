const mongoose = require('mongoose');

const StorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  caption: { type: String, default: '' },
  privacy: { type: String, enum: ['friends', 'public', 'private'], default: 'friends', index: true },
  fileUrl: { type: String, required: true },
  fileType: { type: String, enum: ['image', 'video'], required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  storagePath: { type: String, default: '' },
  storageProvider: { type: String, enum: ['local', 'supabase', 'r2'], default: 'local' },
  mediaVariants: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  reactions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  viewers: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    viewedAt: { type: Date, default: Date.now }
  }],
  comments: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    createdAt: { type: Date, default: Date.now }
  }],
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now, index: true }
});

StorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Story', StorySchema);
