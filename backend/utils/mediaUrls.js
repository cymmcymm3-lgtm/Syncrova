const { getObjectUrl, getSupabaseObjectPathFromUrl } = require('../services/storage');

const USER_AVATAR_MEDIA_FIELDS = 'name avatar avatarStoragePath avatarStorageProvider isDeveloper';
const USER_PROFILE_MEDIA_FIELDS = [
  USER_AVATAR_MEDIA_FIELDS,
  'email',
  'course',
  'campus',
  'coverPhoto',
  'coverPhotoStoragePath',
  'coverPhotoStorageProvider',
  'lastSeen',
  'studentVerificationStatus'
].join(' ');

const cloneObject = (value) => {
  if (!value) return value;
  if (typeof value.toObject === 'function') return value.toObject();
  return { ...value };
};

const resolveStoredMediaUrl = ({ url = '', storagePath = '', storageProvider = '' } = {}) => {
  const provider = String(storageProvider || '').trim();
  const path = String(storagePath || '').trim();
  if (provider && path) return getObjectUrl(provider, path) || url || '';
  const legacySupabasePath = getSupabaseObjectPathFromUrl(url);
  if (legacySupabasePath) return getObjectUrl('r2', legacySupabasePath) || url || '';

  const rawUrl = String(url || '').trim();
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl, 'http://syncrova.local');
    if (parsed.pathname.startsWith('/uploads/')) {
      return parsed.pathname;
    }
  } catch {
    // Keep the original value when it is not URL-shaped.
  }
  return rawUrl;
};

const serializeMediaUser = (user) => {
  const object = cloneObject(user);
  if (!object) return object;

  object.avatar = resolveStoredMediaUrl({
    url: object.avatar,
    storagePath: object.avatarStoragePath,
    storageProvider: object.avatarStorageProvider
  });
  object.coverPhoto = resolveStoredMediaUrl({
    url: object.coverPhoto,
    storagePath: object.coverPhotoStoragePath,
    storageProvider: object.coverPhotoStorageProvider
  });
  delete object.avatarStoragePath;
  delete object.avatarStorageProvider;
  delete object.coverPhotoStoragePath;
  delete object.coverPhotoStorageProvider;

  return object;
};

const hydrateMediaUserInPlace = (user) => {
  if (!user || typeof user !== 'object') return user;
  const serialized = serializeMediaUser(user);
  Object.assign(user, serialized);
  return user;
};

const hydrateMediaAsset = (asset = {}, urlField = 'fileUrl') => {
  const object = cloneObject(asset);
  if (!object) return object;
  object[urlField] = resolveStoredMediaUrl({
    url: object[urlField],
    storagePath: object.storagePath,
    storageProvider: object.storageProvider
  });
  object.variants = hydrateMediaVariants(object.variants || object.mediaVariants || {});
  return object;
};

const hydrateMediaVariants = (variants = {}) => {
  if (!variants || typeof variants !== 'object') return {};

  return Object.entries(variants).reduce((acc, [key, value]) => {
    const variant = typeof value === 'string'
      ? { fileUrl: value }
      : cloneObject(value);
    if (!variant || typeof variant !== 'object') return acc;

    const fileUrl = resolveStoredMediaUrl({
      url: variant.fileUrl || variant.url,
      storagePath: variant.storagePath,
      storageProvider: variant.storageProvider
    });
    if (!fileUrl) return acc;

    acc[key] = {
      ...variant,
      fileUrl
    };
    return acc;
  }, {});
};

const hydrateGroupMedia = (group) => {
  const object = cloneObject(group);
  if (!object) return object;

  object.photo = resolveStoredMediaUrl({
    url: object.photo,
    storagePath: object.photoStoragePath,
    storageProvider: object.photoStorageProvider
  });
  hydrateMediaUserInPlace(object.creator);
  (object.members || []).forEach(hydrateMediaUserInPlace);
  delete object.photoStoragePath;
  delete object.photoStorageProvider;
  return object;
};

const hydratePostMedia = (post) => {
  const object = cloneObject(post);
  if (!object) return object;

  hydrateMediaUserInPlace(object.userId);
  (object.comments || []).forEach(comment => {
    hydrateMediaUserInPlace(comment.userId);
    (comment.reactions || []).forEach(reaction => hydrateMediaUserInPlace(reaction.userId));
  });
  (object.reactions || []).forEach(reaction => hydrateMediaUserInPlace(reaction.userId));
  (object.taggedUsers || []).forEach(hydrateMediaUserInPlace);

  const hydratedPrimary = hydrateMediaAsset(object, 'fileUrl');
  object.fileUrl = hydratedPrimary.fileUrl || '';
  object.attachments = (object.attachments || []).map(attachment => hydrateMediaAsset(attachment, 'fileUrl'));
  object.mediaVariants = hydrateMediaVariants(object.mediaVariants || hydratedPrimary.variants || object.attachments[0]?.variants || {});
  return object;
};

const hydrateStoryMedia = (story) => {
  const object = cloneObject(story);
  if (!object) return object;

  hydrateMediaUserInPlace(object.userId);
  (object.reactions || []).forEach(reaction => hydrateMediaUserInPlace(reaction.userId));
  (object.viewers || []).forEach(viewer => hydrateMediaUserInPlace(viewer.userId));
  (object.comments || []).forEach(comment => hydrateMediaUserInPlace(comment.userId));

  const hydrated = hydrateMediaAsset(object, 'fileUrl');
  object.fileUrl = hydrated.fileUrl || '';
  object.mediaVariants = hydrateMediaVariants(object.mediaVariants || hydrated.variants || {});
  return object;
};

const hydrateMessageMedia = (message) => {
  const object = cloneObject(message);
  if (!object) return object;

  hydrateMediaUserInPlace(object.from);
  hydrateMediaUserInPlace(object.to);
  (object.reactions || []).forEach(reaction => hydrateMediaUserInPlace(reaction.userId));
  if (object.replyTo) {
    hydrateMediaUserInPlace(object.replyTo.from);
  }

  const hydratedPrimary = hydrateMediaAsset(object, 'fileUrl');
  object.fileUrl = hydratedPrimary.fileUrl || '';
  object.attachments = (object.attachments || []).map(attachment => hydrateMediaAsset(attachment, 'fileUrl'));
  object.mediaVariants = hydrateMediaVariants(object.mediaVariants || hydratedPrimary.variants || object.attachments[0]?.variants || {});
  return object;
};

const hydrateGalleryMedia = (item) => {
  const object = cloneObject(item);
  if (!object) return object;

  hydrateMediaUserInPlace(object.uploadedBy);
  (object.comments || []).forEach(comment => hydrateMediaUserInPlace(comment.userId));
  (object.reactions || []).forEach(reaction => hydrateMediaUserInPlace(reaction.userId));
  (object.viewers || []).forEach(viewer => hydrateMediaUserInPlace(viewer.userId));

  const hydrated = hydrateMediaAsset(object, 'fileUrl');
  object.fileUrl = hydrated.fileUrl || '';
  return object;
};

module.exports = {
  hydrateGalleryMedia,
  hydrateGroupMedia,
  hydrateMediaAsset,
  hydrateMediaVariants,
  hydrateMediaUserInPlace,
  hydrateMessageMedia,
  hydratePostMedia,
  hydrateStoryMedia,
  resolveStoredMediaUrl,
  serializeMediaUser,
  USER_AVATAR_MEDIA_FIELDS,
  USER_PROFILE_MEDIA_FIELDS
};
