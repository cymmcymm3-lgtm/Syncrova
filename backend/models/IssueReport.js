const mongoose = require('mongoose');

const IssueMessageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 1500 },
  role: { type: String, enum: ['member', 'developer'], default: 'member' },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const IssueReportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['problem', 'suggestion'], default: 'problem', index: true },
  category: {
    type: String,
    enum: ['bug', 'feature', 'ui', 'performance', 'account', 'workspace', 'messages', 'other'],
    default: 'other',
    index: true
  },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium', index: true },
  status: {
    type: String,
    enum: ['new', 'reviewing', 'approved', 'rejected', 'resolved', 'closed'],
    default: 'new',
    index: true
  },
  title: { type: String, required: true, trim: true, maxlength: 140 },
  details: { type: String, required: true, trim: true, maxlength: 2500 },
  expected: { type: String, default: '', trim: true, maxlength: 1200 },
  workspaceName: { type: String, default: '', trim: true, maxlength: 120 },
  messages: [IssueMessageSchema]
}, { timestamps: true });

module.exports = mongoose.model('IssueReport', IssueReportSchema);
