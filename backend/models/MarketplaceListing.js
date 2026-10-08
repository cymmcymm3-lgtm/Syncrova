const mongoose = require('mongoose');

const MarketplacePhotoSchema = new mongoose.Schema({
  url: { type: String, required: true },
  storagePath: { type: String, default: '' },
  storageProvider: { type: String, enum: ['local', 'supabase', 'r2'], default: 'local' },
  filename: { type: String, default: '' },
  originalName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 }
}, { _id: false });

const MarketplaceReportSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: {
    type: String,
    enum: ['suspicious', 'wrong_category', 'sold_unavailable', 'unsafe', 'spam', 'other'],
    default: 'other'
  },
  note: { type: String, default: '', trim: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const MarketplaceListingSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 90 },
  description: { type: String, default: '', trim: true, maxlength: 1200 },
  price: { type: Number, required: true, min: 0 },
  category: {
    type: String,
    enum: ['books', 'gadgets', 'school_supplies', 'uniforms', 'services', 'other'],
    default: 'other',
    index: true
  },
  condition: {
    type: String,
    enum: ['new', 'like_new', 'good', 'fair', 'used'],
    default: 'good'
  },
  meetupSpot: { type: String, default: '', trim: true, maxlength: 120 },
  campus: { type: String, default: '', trim: true, index: true },
  photos: { type: [MarketplacePhotoSchema], default: [] },
  savedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
  reports: { type: [MarketplaceReportSchema], default: [] },
  status: {
    type: String,
    enum: ['active', 'reserved', 'sold', 'hidden', 'removed'],
    default: 'active',
    index: true
  }
}, { timestamps: true });

MarketplaceListingSchema.index({ status: 1, createdAt: -1 });
MarketplaceListingSchema.index({ status: 1, price: 1 });
MarketplaceListingSchema.index({ title: 'text', description: 'text', campus: 'text' });

module.exports = mongoose.models.MarketplaceListing || mongoose.model('MarketplaceListing', MarketplaceListingSchema);
