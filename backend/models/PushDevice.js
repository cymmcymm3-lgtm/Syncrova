const mongoose = require('mongoose');

const PushDeviceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token: { type: String, required: true, unique: true },
  platform: { type: String, enum: ['android', 'ios', 'web', 'unknown'], default: 'unknown', index: true },
  appVersion: { type: String, default: '' },
  deviceId: { type: String, default: '' },
  active: { type: Boolean, default: true, index: true },
  lastSeenAt: { type: Date, default: Date.now },
  failedAt: { type: Date, default: null },
  failureReason: { type: String, default: '' }
}, { timestamps: true });

PushDeviceSchema.index({ userId: 1, active: 1, lastSeenAt: -1 });

module.exports = mongoose.models.PushDevice || mongoose.model('PushDevice', PushDeviceSchema);
