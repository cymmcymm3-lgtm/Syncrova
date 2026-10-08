const mongoose = require('mongoose');

const MessageAttachmentSchema = new mongoose.Schema({
  fileUrl: { type: String, default: '' },
  fileType: { type: String, enum: ['', 'image', 'video', 'audio', 'file'], default: '' },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  durationMs: { type: Number, default: 0 },
  storagePath: { type: String, default: '' },
  storageProvider: { type: String, enum: ['', 'local', 'supabase', 'r2'], default: '' },
  variants: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
}, { _id: false });

const MessageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, default: '' },
  system: { type: Boolean, default: false },
  systemType: { type: String, default: '' },
  systemData: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  editedAt: { type: Date, default: null },
  fileUrl: { type: String, default: '' },
  fileType: { type: String, enum: ['', 'image', 'video', 'audio', 'file'], default: '' },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  durationMs: { type: Number, default: 0 },
  storagePath: { type: String, default: '' },
  storageProvider: { type: String, enum: ['', 'local', 'supabase', 'r2'], default: '' },
  mediaVariants: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  attachments: { type: [MessageAttachmentSchema], default: [] },
  read: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  pinned: { type: Boolean, default: false },
  unsent: { type: Boolean, default: false },
  unsentAt: { type: Date, default: null },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reactions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: { type: String }
  }],
  createdAt: { type: Date, default: Date.now }
});

MessageSchema.index({ from: 1, to: 1, createdAt: -1 });
// Direct-message reads query the same pair in either direction. The reverse
// index keeps the second `$or` branch from falling back to a broad scan.
MessageSchema.index({ to: 1, from: 1, createdAt: -1 });
// Conversation summaries also need the newest messages received by a user.
MessageSchema.index({ to: 1, createdAt: -1 });
MessageSchema.index({ to: 1, read: 1, unsent: 1, createdAt: -1 });
MessageSchema.index({ from: 1, createdAt: -1 });
MessageSchema.index({ deletedFor: 1, createdAt: -1 });

module.exports = mongoose.model('Message', MessageSchema);
