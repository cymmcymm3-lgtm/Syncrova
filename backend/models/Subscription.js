const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  subscription: { type: Object, required: true }
});

module.exports = mongoose.model('Subscription', SubscriptionSchema);