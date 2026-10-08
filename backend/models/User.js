const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  course: { type: String, default: '' },
  campus: { type: String, default: '' },
  bio: { type: String, default: '' },
  avatar: { type: String, default: '' },
  avatarStoragePath: { type: String, default: '' },
  avatarStorageProvider: { type: String, enum: ['', 'local', 'supabase', 'r2'], default: '' },
  coverPhoto: { type: String, default: '' },
  coverPhotoStoragePath: { type: String, default: '' },
  coverPhotoStorageProvider: { type: String, enum: ['', 'local', 'supabase', 'r2'], default: '' },
  lastSeen: { type: Date, default: null },
  gameRewardXp: { type: Number, default: 0 },
  gameCredits: { type: Number, default: 0 },
  isDeveloper: { type: Boolean, default: false },
  studentVerificationStatus: {
    type: String,
    enum: ['not_submitted', 'pending', 'approved', 'rejected'],
    default: 'not_submitted',
    index: true
  },
  studentVerifiedAt: { type: Date, default: null },
  studentVerificationReviewedAt: { type: Date, default: null },
  authProvider: { type: String, default: 'local' },
  passwordResetToken: { type: String, default: '' },
  passwordResetExpires: { type: Date, default: null },
  passwordResetRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  passwordResetRequestedAt: { type: Date, default: null },
  passwordChangedAt: { type: Date, default: null }
}, { timestamps: true });

// Used by the small onboarding suggestion list and name-sorted people views.
UserSchema.index({ name: 1, _id: 1 });

module.exports = mongoose.model('User', UserSchema);
