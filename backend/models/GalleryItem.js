const mongoose = require('mongoose');

const GalleryCommentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const GalleryItemSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  caption: { type: String, default: '', trim: true },
  fileUrl: { type: String, required: true },
  fileType: { type: String, enum: ['image', 'video'], required: true, index: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  storagePath: { type: String, default: '' },
  storageProvider: { type: String, enum: ['local', 'supabase', 'r2'], default: 'local' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reactions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: { type: String, default: 'like' },
    createdAt: { type: Date, default: Date.now }
  }],
  savedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  viewers: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    viewedAt: { type: Date, default: Date.now }
  }],
  comments: [GalleryCommentSchema]
}, { timestamps: true });

GalleryItemSchema.index({ createdAt: -1 });

module.exports = mongoose.models.GalleryItem || mongoose.model('GalleryItem', GalleryItemSchema);
