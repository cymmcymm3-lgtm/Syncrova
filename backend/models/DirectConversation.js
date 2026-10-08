const mongoose = require('mongoose');
const { CHAT_BACKGROUND_IDS, DEFAULT_CHAT_BACKGROUND_ID } = require('../utils/chatBackgrounds');

const DirectConversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  participantKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  backgroundId: {
    type: String,
    enum: CHAT_BACKGROUND_IDS,
    default: DEFAULT_CHAT_BACKGROUND_ID
  },
  participantNicknames: {
    type: Map,
    of: String,
    default: () => ({})
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { timestamps: true });

DirectConversationSchema.index({ participants: 1 });

module.exports = mongoose.model('DirectConversation', DirectConversationSchema);
