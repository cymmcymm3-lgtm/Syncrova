const mongoose = require('mongoose');

const FileSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  url: { type: String, default: '' },
  storagePath: { type: String, default: '' },
  storageProvider: { type: String, enum: ['local', 'supabase', 'r2'], default: 'local' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadDate: { type: Date, default: Date.now }
});

FileSchema.index({ groupId: 1, uploadDate: -1 });

module.exports = mongoose.model('File', FileSchema);
