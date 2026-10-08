const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const StudentVerification = require('../models/StudentVerification');
const MarketplaceListing = require('../models/MarketplaceListing');
const { createNotification } = require('../services/notifications');
const { cloudStorageProvider, deleteObject, isCloudStorageEnabled, uploadBuffer } = require('../services/storage');
const { normalizeCampus } = require('../utils/academics');
const { hydrateMediaAsset, serializeMediaUser } = require('../utils/mediaUrls');

const router = express.Router();

const uploadsRoot = path.join(__dirname, '..', 'uploads');
const verificationUploadDir = path.join(uploadsRoot, 'marketplace', 'verification');
const listingsUploadDir = path.join(uploadsRoot, 'marketplace', 'listings');
fs.mkdirSync(verificationUploadDir, { recursive: true });
fs.mkdirSync(listingsUploadDir, { recursive: true });

const MAX_VERIFICATION_SIZE = 10 * 1024 * 1024;
const MAX_LISTING_PHOTO_SIZE = 8 * 1024 * 1024;
const LISTING_PHOTO_LIMIT = 5;
const USER_SELECT = 'name email avatar avatarStoragePath avatarStorageProvider campus course isDeveloper studentVerificationStatus studentVerifiedAt';
const VERIFIED_STATUS = 'approved';
const CATEGORIES = new Set(['books', 'gadgets', 'school_supplies', 'uniforms', 'services', 'other']);
const CONDITIONS = new Set(['new', 'like_new', 'good', 'fair', 'used']);
const PUBLIC_LISTING_STATUSES = ['active', 'reserved'];
const VIEWABLE_LISTING_STATUSES = new Set(['active', 'reserved', 'sold']);
const OWNER_LISTING_STATUSES = new Set(['active', 'reserved', 'sold', 'hidden']);
const REPORT_REASONS = new Set(['suspicious', 'wrong_category', 'sold_unavailable', 'unsafe', 'spam', 'other']);

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const getId = (value) => String(value?._id || value?.id || value || '');
const cleanText = (value = '', max = 500) => String(value || '').trim().slice(0, max);

const safeFilename = (file) => {
  const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
  return `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
};

const verificationLocalStorage = multer.diskStorage({
  destination: verificationUploadDir,
  filename: (req, file, cb) => cb(null, safeFilename(file))
});

const listingLocalStorage = multer.diskStorage({
  destination: listingsUploadDir,
  filename: (req, file, cb) => cb(null, safeFilename(file))
});

const verificationUpload = multer({
  storage: isCloudStorageEnabled ? multer.memoryStorage() : verificationLocalStorage,
  limits: { fileSize: MAX_VERIFICATION_SIZE },
  fileFilter: (req, file, cb) => {
    const isAllowed = file.mimetype?.startsWith('image/') || file.mimetype === 'application/pdf';
    if (!isAllowed) {
      const err = new Error('Upload a campus ID image or COR PDF/image only');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

const listingPhotoUpload = multer({
  storage: isCloudStorageEnabled ? multer.memoryStorage() : listingLocalStorage,
  limits: { fileSize: MAX_LISTING_PHOTO_SIZE },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      const err = new Error('Listing photos must be image files');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

const runUpload = (uploader, errorLabel) => (req, res, next) => {
  uploader(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ msg: errorLabel });
    }

    return res.status(err.status || 400).json({ msg: err.message || 'Upload failed' });
  });
};

const uploadVerificationDocument = runUpload(
  verificationUpload.single('document'),
  'Verification document must be 10MB or smaller'
);

const uploadListingPhotos = runUpload(
  listingPhotoUpload.array('photos', LISTING_PHOTO_LIMIT),
  'Each listing photo must be 8MB or smaller'
);

const removeStoredFile = async ({ storageProvider, storagePath, url }) => {
  if (!storagePath && !url) return;
  if ((['supabase', 'r2'].includes(storageProvider) || (storagePath && isCloudStorageEnabled && storageProvider !== 'local')) && storagePath) {
    await deleteObject(storagePath, { provider: storageProvider }).catch(() => {});
    return;
  }

  const localPath = storagePath || String(url || '').replace(/^\/uploads\//, '');
  if (!localPath) return;
  await fs.promises.unlink(path.join(uploadsRoot, localPath)).catch(() => {});
};

const storeUploadedFile = async (file, folder, localPrefix) => {
  if (isCloudStorageEnabled) {
    const uploaded = await uploadBuffer({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder
    });
    return {
      filename: uploaded.filename,
      url: uploaded.url,
      storagePath: uploaded.path,
      storageProvider: uploaded.provider || cloudStorageProvider
    };
  }

  const storagePath = `${localPrefix}/${file.filename}`.replace(/\\/g, '/');
  return {
    filename: file.filename,
    url: `/uploads/${storagePath}`,
    storagePath,
    storageProvider: 'local'
  };
};

const serializeUser = (user) => {
  if (!user) return null;
  const object = serializeMediaUser(user);
  return {
    _id: object._id,
    id: object._id,
    name: object.name,
    email: object.email,
    avatar: object.avatar,
    campus: normalizeCampus(object.campus),
    course: object.course,
    isDeveloper: Boolean(object.isDeveloper),
    studentVerificationStatus: object.studentVerificationStatus || 'not_submitted',
    studentVerifiedAt: object.studentVerifiedAt || null
  };
};

const serializeVerification = (verification) => {
  if (!verification) {
    return {
      status: 'not_submitted',
      documentType: '',
      documentUrl: '',
      rejectionReason: '',
      submittedAt: null,
      reviewedAt: null
    };
  }

  const object = typeof verification.toObject === 'function' ? verification.toObject() : verification;
  const document = hydrateMediaAsset({
    fileUrl: object.documentUrl,
    storagePath: object.documentStoragePath,
    storageProvider: object.documentStorageProvider
  }, 'fileUrl');
  return {
    _id: object._id,
    id: object._id,
    user: serializeUser(object.userId),
    status: object.status,
    documentType: object.documentType,
    documentUrl: document.fileUrl || object.documentUrl,
    originalName: object.originalName,
    mimeType: object.mimeType,
    size: object.size,
    rejectionReason: object.rejectionReason || '',
    submittedAt: object.submittedAt,
    reviewedAt: object.reviewedAt,
    reviewedBy: serializeUser(object.reviewedBy),
    createdAt: object.createdAt,
    updatedAt: object.updatedAt
  };
};

const serializeListing = (listing, viewerId = '', options = {}) => {
  const object = typeof listing.toObject === 'function' ? listing.toObject() : listing;
  const viewer = getId(viewerId);
  const savedBy = object.savedBy || [];
  const reports = object.reports || [];
  const serialized = {
    _id: object._id,
    id: object._id,
    seller: serializeUser(object.seller),
    title: object.title,
    description: object.description,
    price: object.price,
    category: object.category,
    condition: object.condition,
    meetupSpot: object.meetupSpot,
    campus: normalizeCampus(object.campus),
    photos: (object.photos || []).map(photo => {
      const hydrated = hydrateMediaAsset({ ...photo, fileUrl: photo.url }, 'fileUrl');
      return { ...photo, url: hydrated.fileUrl || photo.url };
    }),
    status: object.status,
    saveCount: savedBy.length,
    reportCount: reports.length,
    isSaved: Boolean(viewer && savedBy.some(id => getId(id) === viewer)),
    hasReported: Boolean(viewer && reports.some(report => getId(report.user) === viewer)),
    createdAt: object.createdAt,
    updatedAt: object.updatedAt
  };

  if (options.includeReports) {
    serialized.reports = reports.map(report => ({
      user: serializeUser(report.user),
      reason: report.reason,
      note: report.note || '',
      createdAt: report.createdAt
    }));
  }

  return serialized;
};

const requireDeveloper = async (req, res, next) => {
  try {
    const user = await User.findById(req.user).select(USER_SELECT);
    if (!user?.isDeveloper) return res.status(403).json({ msg: 'Developer access is required' });
    req.currentUser = user;
    next();
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

const requireVerifiedStudent = async (req, res, next) => {
  try {
    const user = await User.findById(req.user).select(USER_SELECT);
    if (!user) return res.status(404).json({ msg: 'User not found' });
    if (!user.isDeveloper && user.studentVerificationStatus !== VERIFIED_STATUS) {
      return res.status(403).json({
        msg: 'Campus verification is required before using the marketplace',
        verificationStatus: user.studentVerificationStatus || 'not_submitted'
      });
    }
    req.currentUser = user;
    next();
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

router.get('/status', auth, async (req, res) => {
  try {
    const [user, verification] = await Promise.all([
      User.findById(req.user).select(USER_SELECT),
      StudentVerification.findOne({ userId: req.user })
        .populate('userId', USER_SELECT)
        .populate('reviewedBy', USER_SELECT)
    ]);

    if (!user) return res.status(404).json({ msg: 'User not found' });

    const userStatus = user.isDeveloper ? VERIFIED_STATUS : user.studentVerificationStatus || 'not_submitted';
    const status = userStatus === 'not_submitted' && verification?.status ? verification.status : userStatus;
    res.json({
      user: serializeUser(user),
      verification: verification ? serializeVerification(verification) : { status },
      canBuySell: user.isDeveloper || status === VERIFIED_STATUS,
      developerAccess: Boolean(user.isDeveloper)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/verification', auth, uploadVerificationDocument, async (req, res) => {
  let uploadedDocument = null;
  try {
    if (!req.file) return res.status(400).json({ msg: 'Please upload your campus ID or COR' });

    const documentType = cleanText(req.body.documentType, 40);
    if (!['campus_id', 'cor'].includes(documentType)) {
      return res.status(400).json({ msg: 'Choose Campus ID or COR as the document type' });
    }

    const existing = await StudentVerification.findOne({ userId: req.user });
    uploadedDocument = await storeUploadedFile(
      req.file,
      `marketplace/verification/${req.user}`,
      'marketplace/verification'
    );

    const verification = await StudentVerification.findOneAndUpdate(
      { userId: req.user },
      {
        userId: req.user,
        status: 'pending',
        documentType,
        documentUrl: uploadedDocument.url,
        documentStoragePath: uploadedDocument.storagePath,
        documentStorageProvider: uploadedDocument.storageProvider,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        rejectionReason: '',
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )
      .populate('userId', USER_SELECT)
      .populate('reviewedBy', USER_SELECT);

    if (existing?.documentUrl && existing.documentUrl !== uploadedDocument.url) {
      await removeStoredFile({
        storageProvider: existing.documentStorageProvider,
        storagePath: existing.documentStoragePath,
        url: existing.documentUrl
      });
    }

    await User.findByIdAndUpdate(req.user, {
      studentVerificationStatus: 'pending',
      studentVerifiedAt: null,
      studentVerificationReviewedAt: null
    });

    res.status(201).json({
      verification: serializeVerification(verification),
      canBuySell: false
    });
  } catch (err) {
    if (uploadedDocument) {
      await removeStoredFile({
        storageProvider: uploadedDocument.storageProvider,
        storagePath: uploadedDocument.storagePath,
        url: uploadedDocument.url
      });
    }
    res.status(500).json({ msg: err.message });
  }
});

router.get('/verification/queue', auth, requireDeveloper, async (req, res) => {
  try {
    const status = cleanText(req.query.status, 20);
    const filter = ['pending', 'approved', 'rejected'].includes(status) ? { status } : {};
    const submissions = await StudentVerification.find(filter)
      .populate('userId', USER_SELECT)
      .populate('reviewedBy', USER_SELECT)
      .sort({ submittedAt: -1, updatedAt: -1 })
      .limit(100);

    res.json({ submissions: submissions.map(serializeVerification) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.put('/verification/:id/review', auth, requireDeveloper, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ msg: 'Submission not found' });

    const action = cleanText(req.body.action || req.body.status, 20);
    const nextStatus = action === 'approve' || action === 'approved'
      ? 'approved'
      : action === 'reject' || action === 'rejected'
        ? 'rejected'
        : '';
    if (!nextStatus) return res.status(400).json({ msg: 'Review action must be approve or reject' });

    const now = new Date();
    const rejectionReason = nextStatus === 'rejected'
      ? cleanText(req.body.rejectionReason || 'Please submit a clearer campus ID or COR.', 300)
      : '';
    const verification = await StudentVerification.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      {
        status: nextStatus,
        reviewedAt: now,
        reviewedBy: req.user,
        rejectionReason
      },
      { new: true }
    );

    if (!verification) {
      const existing = await StudentVerification.findById(req.params.id)
        .populate('userId', USER_SELECT)
        .populate('reviewedBy', USER_SELECT);
      if (!existing) return res.status(404).json({ msg: 'Submission not found' });
      return res.status(409).json({
        msg: `Submission was already ${existing.status}. Ask the student to resubmit before reviewing again.`,
        verification: serializeVerification(existing)
      });
    }

    await User.findByIdAndUpdate(verification.userId, {
      studentVerificationStatus: nextStatus,
      studentVerifiedAt: nextStatus === 'approved' ? now : null,
      studentVerificationReviewedAt: now
    });

    await verification.populate('userId', USER_SELECT);
    await verification.populate('reviewedBy', USER_SELECT);

    await createNotification({
      io: req.app.get('io'),
      userId: verification.userId,
      actorId: req.user,
      type: 'marketplace',
      title: nextStatus === 'approved' ? 'Campus verification approved' : 'Campus verification needs resubmission',
      body: nextStatus === 'approved'
        ? 'You can now buy and sell inside the Student Marketplace.'
        : verification.rejectionReason,
      href: '/marketplace',
      meta: { verificationId: verification._id, status: nextStatus }
    });

    res.json({
      verification: serializeVerification(verification)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/listings', auth, async (req, res) => {
  try {
    const status = cleanText(req.query.status, 20);
    const category = cleanText(req.query.category, 40);
    const search = cleanText(req.query.q, 80);
    const campus = normalizeCampus(req.query.campus || '');
    const sort = cleanText(req.query.sort, 30);
    const minPrice = Number(req.query.minPrice);
    const maxPrice = Number(req.query.maxPrice);
    const filter = {};

    if (VIEWABLE_LISTING_STATUSES.has(status)) {
      filter.status = status;
    } else if (status === 'all') {
      filter.status = { $in: [...VIEWABLE_LISTING_STATUSES] };
    } else {
      filter.status = { $in: PUBLIC_LISTING_STATUSES };
    }

    if (CATEGORIES.has(category)) filter.category = category;
    if (campus) filter.campus = campus;
    if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
      filter.price = {};
      if (Number.isFinite(minPrice) && minPrice >= 0) filter.price.$gte = minPrice;
      if (Number.isFinite(maxPrice) && maxPrice >= 0) filter.price.$lte = maxPrice;
      if (Object.keys(filter.price).length === 0) delete filter.price;
    }
    if (search) filter.$text = { $search: search };

    const sortMap = {
      oldest: { createdAt: 1 },
      price_low: { price: 1, createdAt: -1 },
      price_high: { price: -1, createdAt: -1 },
      newest: { createdAt: -1 }
    };

    const listings = await MarketplaceListing.find(filter)
      .populate('seller', USER_SELECT)
      .sort(sortMap[sort] || sortMap.newest)
      .limit(80);

    res.json({ listings: listings.map(listing => serializeListing(listing, req.user)) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/listings/reports', auth, requireDeveloper, async (req, res) => {
  try {
    const status = cleanText(req.query.status, 20);
    const filter = {
      reports: { $exists: true, $ne: [] },
      status: status && OWNER_LISTING_STATUSES.has(status) ? status : { $ne: 'removed' }
    };

    const listings = await MarketplaceListing.find(filter)
      .populate('seller', USER_SELECT)
      .populate('reports.user', USER_SELECT)
      .sort({ updatedAt: -1 })
      .limit(100);

    res.json({ listings: listings.map(listing => serializeListing(listing, req.user, { includeReports: true })) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/listings/mine', auth, async (req, res) => {
  try {
    const listings = await MarketplaceListing.find({ seller: req.user, status: { $ne: 'removed' } })
      .populate('seller', USER_SELECT)
      .sort({ createdAt: -1 })
      .limit(80);
    res.json({ listings: listings.map(listing => serializeListing(listing, req.user)) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/listings', auth, requireVerifiedStudent, uploadListingPhotos, async (req, res) => {
  const uploadedPhotos = [];
  try {
    const title = cleanText(req.body.title, 90);
    const description = cleanText(req.body.description, 1200);
    const category = CATEGORIES.has(req.body.category) ? req.body.category : 'other';
    const condition = CONDITIONS.has(req.body.condition) ? req.body.condition : 'good';
    const meetupSpot = cleanText(req.body.meetupSpot, 120);
    const price = Number(req.body.price);

    if (!title) return res.status(400).json({ msg: 'Listing title is required' });
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ msg: 'Enter a valid price' });
    if (!meetupSpot) return res.status(400).json({ msg: 'Choose a safe campus meetup spot' });

    for (const file of req.files || []) {
      const uploaded = await storeUploadedFile(
        file,
        `marketplace/listings/${req.user}`,
        'marketplace/listings'
      );
      uploadedPhotos.push({
        url: uploaded.url,
        storagePath: uploaded.storagePath,
        storageProvider: uploaded.storageProvider,
        filename: uploaded.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size
      });
    }

    const listing = await MarketplaceListing.create({
      seller: req.user,
      title,
      description,
      price,
      category,
      condition,
      meetupSpot,
      campus: normalizeCampus(req.currentUser.campus),
      photos: uploadedPhotos
    });
    await listing.populate('seller', USER_SELECT);

    res.status(201).json({ listing: serializeListing(listing, req.user) });
  } catch (err) {
    await Promise.all(uploadedPhotos.map(photo => removeStoredFile(photo)));
    res.status(500).json({ msg: err.message });
  }
});

router.put('/listings/:id/save', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ msg: 'Listing not found' });

    const listing = await MarketplaceListing.findOne({ _id: req.params.id, status: { $ne: 'removed' } });
    if (!listing) return res.status(404).json({ msg: 'Listing not found' });

    const saved = (listing.savedBy || []).some(id => getId(id) === getId(req.user));
    if (saved) {
      listing.savedBy = listing.savedBy.filter(id => getId(id) !== getId(req.user));
    } else {
      listing.savedBy.push(req.user);
    }

    await listing.save();
    await listing.populate('seller', USER_SELECT);
    res.json({ listing: serializeListing(listing, req.user), saved: !saved });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/listings/:id/report', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ msg: 'Listing not found' });

    const listing = await MarketplaceListing.findOne({ _id: req.params.id, status: { $ne: 'removed' } });
    if (!listing) return res.status(404).json({ msg: 'Listing not found' });
    if (getId(listing.seller) === getId(req.user)) {
      return res.status(400).json({ msg: 'You cannot report your own listing' });
    }

    const alreadyReported = (listing.reports || []).some(report => getId(report.user) === getId(req.user));
    if (alreadyReported) {
      await listing.populate('seller', USER_SELECT);
      return res.json({ listing: serializeListing(listing, req.user), reported: true });
    }

    const reason = REPORT_REASONS.has(req.body.reason) ? req.body.reason : 'other';
    listing.reports.push({
      user: req.user,
      reason,
      note: cleanText(req.body.note, 500),
      createdAt: new Date()
    });
    await listing.save();
    await listing.populate('seller', USER_SELECT);

    res.status(201).json({ listing: serializeListing(listing, req.user), reported: true });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.put('/listings/:id/status', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ msg: 'Listing not found' });

    const nextStatus = cleanText(req.body.status, 20);
    if (!OWNER_LISTING_STATUSES.has(nextStatus)) {
      return res.status(400).json({ msg: 'Invalid listing status' });
    }

    const [listing, user] = await Promise.all([
      MarketplaceListing.findById(req.params.id),
      User.findById(req.user).select(USER_SELECT)
    ]);
    if (!listing) return res.status(404).json({ msg: 'Listing not found' });

    const isOwner = getId(listing.seller) === getId(req.user);
    if (!isOwner && !user?.isDeveloper) return res.status(403).json({ msg: 'Not authorized to update this listing' });

    listing.status = nextStatus;
    await listing.save();
    await listing.populate('seller', USER_SELECT);

    res.json({ listing: serializeListing(listing, req.user) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.delete('/listings/:id', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ msg: 'Listing not found' });

    const [listing, user] = await Promise.all([
      MarketplaceListing.findById(req.params.id),
      User.findById(req.user).select(USER_SELECT)
    ]);
    if (!listing) return res.status(404).json({ msg: 'Listing not found' });

    const isOwner = getId(listing.seller) === getId(req.user);
    if (!isOwner && !user?.isDeveloper) return res.status(403).json({ msg: 'Not authorized to delete this listing' });

    listing.status = 'removed';
    await listing.save();
    res.json({ msg: 'Listing removed', listingId: listing._id });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
