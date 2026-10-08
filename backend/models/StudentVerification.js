const mongoose = require('mongoose');

const StudentVerificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  documentType: {
    type: String,
    enum: ['campus_id', 'cor'],
    required: true
  },
  documentUrl: { type: String, required: true },
  documentStoragePath: { type: String, default: '' },
  documentStorageProvider: { type: String, enum: ['local', 'supabase', 'r2'], default: 'local' },
  originalName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  rejectionReason: { type: String, default: '' },
  submittedAt: { type: Date, default: Date.now, index: true },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

StudentVerificationSchema.index({ status: 1, submittedAt: -1 });

module.exports = mongoose.models.StudentVerification || mongoose.model('StudentVerification', StudentVerificationSchema);
