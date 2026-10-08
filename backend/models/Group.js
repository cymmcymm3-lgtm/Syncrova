const mongoose = require('mongoose');
const { CHAT_BACKGROUND_IDS, DEFAULT_CHAT_BACKGROUND_ID } = require('../utils/chatBackgrounds');

const GroupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  subject: { type: String, default: '' },
  photo: { type: String, default: '' },
  photoStoragePath: { type: String, default: '' },
  photoStorageProvider: { type: String, enum: ['', 'local', 'supabase', 'r2'], default: '' },
  backgroundId: { type: String, enum: CHAT_BACKGROUND_IDS, default: DEFAULT_CHAT_BACKGROUND_ID },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  coCreators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // 👈 add this line
  joinCode: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});

// Supports membership lookups used by the dashboard, feeds, and group routes.
GroupSchema.index({ members: 1, createdAt: -1 });

module.exports = mongoose.model('Group', GroupSchema);
