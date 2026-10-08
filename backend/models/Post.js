const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  scope: { type: String, enum: ['group', 'timeline'], default: 'group', index: true },
  privacy: { type: String, enum: ['public', 'friends', 'private'], default: 'public', index: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  background: { type: String, default: '' },
  mood: { type: String, default: '' },
  activity: { type: String, default: '' },
  taggedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  fileUrl: { type: String }, // para sa image/file attachment
  fileType: { type: String, enum: ['image', 'video', 'file', ''], default: '' },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  storagePath: { type: String, default: '' },
  storageProvider: { type: String, enum: ['local', 'supabase', 'r2', ''], default: '' },
  mediaVariants: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  attachments: [{
    fileUrl: { type: String, required: true },
    fileType: { type: String, enum: ['image', 'video', 'file'], default: 'file' },
    fileName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    storagePath: { type: String, default: '' },
    storageProvider: { type: String, enum: ['local', 'supabase', 'r2', ''], default: '' },
    variants: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
  }],
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  savedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  pinned: { type: Boolean, default: false, index: true },
  pinnedAt: { type: Date, default: null },
  pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  comments: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    replyTo: { type: mongoose.Schema.Types.ObjectId, default: null },
    reactions: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      emoji: { type: String }
    }],
    date: { type: Date, default: Date.now }
  }],
  reactions: [{                           // ✅ ito ang kailangan para sa react endpoint
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: { type: String }
  }],
  shares: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    date: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

PostSchema.index({ scope: 1, privacy: 1, createdAt: -1 });
PostSchema.index({ scope: 1, createdAt: -1, _id: -1 });
PostSchema.index({ groupId: 1, pinned: -1, pinnedAt: -1, createdAt: -1 });
PostSchema.index({ userId: 1, scope: 1, createdAt: -1 });
// Public-profile timelines are scoped to one user and shown with pinned posts
// first, so keep their visible ordering index-backed as they grow.
PostSchema.index({ userId: 1, scope: 1, pinned: -1, pinnedAt: -1, createdAt: -1 });

module.exports = mongoose.model('Post', PostSchema);
