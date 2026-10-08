const mongoose = require('mongoose');

const ReelReactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['like', 'love', 'wow'], default: 'like' },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const ReelSchema = new mongoose.Schema({
  source: { type: String, enum: ['tiktok', 'seed', 'upload'], default: 'tiktok', index: true },
  sourceUrl: { type: String, required: true, trim: true },
  videoId: { type: String, required: true, trim: true },
  embedUrl: { type: String, required: true, trim: true },
  title: { type: String, default: 'TikTok Reel', trim: true },
  caption: { type: String, default: '', trim: true },
  authorName: { type: String, default: 'TikTok creator', trim: true },
  authorUrl: { type: String, default: '', trim: true },
  providerName: { type: String, default: 'TikTok', trim: true },
  thumbnailUrl: { type: String, default: '', trim: true },
  importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['active', 'hidden'], default: 'active', index: true },
  reactions: [ReelReactionSchema],
  savedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  viewCount: { type: Number, default: 0 }
}, { timestamps: true });

ReelSchema.index({ videoId: 1 }, { unique: true });
ReelSchema.index({ sourceUrl: 1 }, { unique: true });
ReelSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.models.Reel || mongoose.model('Reel', ReelSchema);
