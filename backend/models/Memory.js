const mongoose = require('mongoose');

const MemorySchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  caption: { type: String, default: '' },
  fileUrl: { type: String, required: true },
  fileType: { type: String, enum: ['image', 'video'], required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  storagePath: { type: String, default: '' },
  storageProvider: { type: String, enum: ['local', 'supabase', 'r2'], default: 'local' },
  createdAt: { type: Date, default: Date.now }
});

MemorySchema.index({ groupId: 1, createdAt: -1 });

module.exports = mongoose.model('Memory', MemorySchema);
