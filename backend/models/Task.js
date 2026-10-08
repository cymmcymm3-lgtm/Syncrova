const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  description: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  dueDate: { type: Date },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  status: { type: String, enum: ['not_started', 'in_progress', 'done'], default: 'not_started' },
  completedAt: { type: Date, default: null },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  labels: [{ type: String, trim: true, maxlength: 28 }],
  approvalStatus: {
    type: String,
    enum: ['not_required', 'pending', 'approved', 'changes_requested'],
    default: 'not_required'
  },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  comments: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  activity: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String },
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

TaskSchema.index({ groupId: 1, createdAt: -1 });
TaskSchema.index({ assignedTo: 1, createdAt: -1 });

module.exports = mongoose.model('Task', TaskSchema);
