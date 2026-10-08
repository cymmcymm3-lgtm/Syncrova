const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Post = require('../models/Post');
const Group = require('../models/Group');
const Friendship = require('../models/Friendship');
const User = require('../models/User');
const { createNotification, createNotifications, removeNotifications } = require('../services/notifications');
const { createGroupActivity } = require('../services/activity');
const { getMentionedMemberIds } = require('../services/mentions');
const { cloudStorageProvider, isCloudStorageEnabled, uploadBuffer } = require('../services/storage');
const { createImageVariants } = require('../services/mediaVariants');
const { hydratePostMedia } = require('../utils/mediaUrls');
const router = express.Router();

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const USER_MEDIA_FIELDS = 'name avatar avatarStoragePath avatarStorageProvider isDeveloper';
const POST_AUTHOR_FIELDS = `${USER_MEDIA_FIELDS} studentVerificationStatus`;
const postUploadDir = path.join(__dirname, '..', 'uploads', 'posts');
fs.mkdirSync(postUploadDir, { recursive: true });

const MAX_POST_UPLOAD_SIZE = 35 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.exe', '.msi', '.ps1', '.scr', '.sh']);
const POST_COMMENT_PREVIEW_LIMIT = 3;

const normalizeId = (value) => String(value?._id || value?.id || value || '');
const parseLimit = (value, fallback = 60, max = 100) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(number)));
};

const encodePostCursor = (post = {}) => {
  const time = new Date(post.createdAt || 0).getTime();
  const id = normalizeId(post._id);
  return Number.isFinite(time) && time > 0 && id ? `${time}_${id}` : '';
};

const parsePostCursor = (value = '') => {
  const [timeValue, id] = String(value || '').split('_');
  const time = Number(timeValue);
  if (!Number.isFinite(time) || time <= 0 || !isValidObjectId(id)) return null;
  return { createdAt: new Date(time), id: new mongoose.Types.ObjectId(id) };
};

const getPostCursorFilter = (cursorValue) => {
  const cursor = parsePostCursor(cursorValue);
  if (!cursor) return null;
  return {
    $or: [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }
    ]
  };
};

const withCursorFilter = (query, cursorValue) => {
  const cursorFilter = getPostCursorFilter(cursorValue);
  return cursorFilter ? { $and: [query, cursorFilter] } : query;
};

const localStorage = multer.diskStorage({
  destination: postUploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});

const upload = multer({
  storage: isCloudStorageEnabled ? multer.memoryStorage() : localStorage,
  limits: { fileSize: MAX_POST_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      const err = new Error('This file type is not allowed');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

const uploadPostMedia = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ msg: 'Post upload is too large. Maximum size is 35MB.' });
    }

    return res.status(err.status || 400).json({ msg: err.message || 'Upload failed' });
  });
};

const getFileType = (file) => {
  const mimeType = file?.mimetype || '';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
};

const normalizePrivacy = (value) => {
  const normalized = String(value || '').toLowerCase().replace(/[-\s]/g, '_');
  if (normalized === 'friends') return 'friends';
  if (['private', 'only_me', 'onlyme'].includes(normalized)) return 'private';
  return 'public';
};

const normalizeAttachment = (value = {}) => {
  const fileUrl = String(value.fileUrl || '').trim();
  if (!fileUrl) return null;
  const fileType = ['image', 'video', 'file'].includes(value.fileType) ? value.fileType : 'file';
  const storageProvider = ['local', 'supabase', 'r2'].includes(value.storageProvider) ? value.storageProvider : '';
  return {
    fileUrl,
    fileType,
    fileName: String(value.fileName || '').trim().slice(0, 220),
    mimeType: String(value.mimeType || '').trim().slice(0, 120),
    fileSize: Number(value.fileSize || 0),
    storagePath: String(value.storagePath || '').trim(),
    storageProvider,
    variants: normalizeMediaVariants(value.variants || value.mediaVariants)
  };
};

const normalizeMediaVariants = (variants = {}) => {
  if (!variants || typeof variants !== 'object') return {};
  return Object.entries(variants).reduce((acc, [key, value]) => {
    const variant = typeof value === 'string' ? { fileUrl: value } : value;
    const fileUrl = String(variant?.fileUrl || variant?.url || '').trim();
    if (!fileUrl) return acc;
    const storageProvider = ['local', 'supabase', 'r2'].includes(variant.storageProvider) ? variant.storageProvider : '';
    acc[String(key).trim().slice(0, 40)] = {
      fileUrl,
      mimeType: String(variant.mimeType || 'image/webp').trim().slice(0, 120),
      fileSize: Number(variant.fileSize || 0),
      storagePath: String(variant.storagePath || '').trim(),
      storageProvider
    };
    return acc;
  }, {});
};

const normalizeAttachments = (attachments, legacyAttachment = {}) => {
  const source = Array.isArray(attachments) ? attachments : [];
  const normalized = source.map(normalizeAttachment).filter(Boolean).slice(0, 12);
  if (normalized.length) return normalized;
  const legacy = normalizeAttachment(legacyAttachment);
  return legacy ? [legacy] : [];
};

const findMemberGroup = async (groupId, userId) => {
  if (!isValidObjectId(groupId)) return null;
  return Group.findOne({ _id: groupId, members: userId });
};

const ensurePostMember = async (post, userId) => {
  if (!post) return null;
  return findMemberGroup(post.groupId, userId);
};

const canManageGroup = (group, userId) => (
  group?.creator?.toString() === userId || group?.coCreators?.some(member => member.toString() === userId)
);

const canModeratePosts = async (userId) => {
  const user = await User.findById(userId).select('isDeveloper').lean().catch(() => null);
  return Boolean(user?.isDeveloper);
};

const getAcceptedFriendIds = async (userId) => {
  const rows = await Friendship.find({
    status: 'accepted',
    $or: [{ requester: userId }, { recipient: userId }]
  }).select('requester recipient').lean();

  return rows.map(row => {
    const requester = normalizeId(row.requester);
    const recipient = normalizeId(row.recipient);
    return requester === normalizeId(userId) ? recipient : requester;
  }).filter(Boolean);
};

const areFriends = async (a, b) => {
  if (!a || !b) return false;
  return Boolean(await Friendship.exists({
    status: 'accepted',
    $or: [
      { requester: a, recipient: b },
      { requester: b, recipient: a }
    ]
  }));
};

const isTimelinePost = (post) => post?.scope === 'timeline' || !post?.groupId;

const canViewTimelinePost = async (post, userId) => {
  const ownerId = normalizeId(post.userId);
  if (ownerId === normalizeId(userId)) return true;
  if (post.privacy === 'public') return true;
  if (post.privacy === 'friends') return areFriends(ownerId, userId);
  return false;
};

const ensurePostViewer = async (post, userId) => {
  if (!post) return null;
  if (!isTimelinePost(post)) return ensurePostMember(post, userId);
  return canViewTimelinePost(post, userId);
};

const populatePost = async (post) => {
  await post.populate('groupId', 'name subject description');
  await post.populate('userId', POST_AUTHOR_FIELDS);
  await post.populate('comments.userId', USER_MEDIA_FIELDS);
  await post.populate('comments.reactions.userId', USER_MEDIA_FIELDS);
  await post.populate('reactions.userId', USER_MEDIA_FIELDS);
  await post.populate('taggedUsers', USER_MEDIA_FIELDS);
  return hydratePostMedia(post);
};

const toPostPayload = (post, { summary = false } = {}) => {
  const hydrated = hydratePostMedia(post);
  if (!summary) return hydrated;

  const comments = Array.isArray(hydrated.comments) ? hydrated.comments : [];
  const commentsPreview = comments.slice(-POST_COMMENT_PREVIEW_LIMIT);
  return {
    ...hydrated,
    comments: commentsPreview,
    commentsPreview,
    commentCount: comments.length,
    commentsTruncated: comments.length > commentsPreview.length
  };
};

const toPostPagePayload = (posts = [], limit, { summary = false } = {}) => {
  const itemsSource = posts.slice(0, limit);
  const items = itemsSource.map(post => toPostPayload(post, { summary }));
  const hasMore = posts.length > limit;
  return {
    items,
    hasMore,
    nextCursor: hasMore ? encodePostCursor(itemsSource[itemsSource.length - 1]) : ''
  };
};

router.post('/upload', auth, uploadPostMedia, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ msg: 'No file uploaded' });

    const uploadedFile = isCloudStorageEnabled
      ? await uploadBuffer({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          folder: `posts/${req.user}`
        })
      : {
          filename: req.file.filename,
          path: `posts/${req.file.filename}`,
          url: `/uploads/posts/${req.file.filename}`
        };
    const variants = await createImageVariants({
      file: req.file,
      uploadedFile,
      folder: `posts/${req.user}`
    }).catch(() => ({}));

    res.status(201).json({
      fileUrl: uploadedFile.url,
      fileType: getFileType(req.file),
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      storagePath: uploadedFile.path,
      storageProvider: uploadedFile.provider || (isCloudStorageEnabled ? cloudStorageProvider : 'local'),
      variants
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/home', auth, async (req, res) => {
  try {
    const friendIds = await getAcceptedFriendIds(req.user);
    const limit = parseLimit(req.query.limit, 36, 80);
    const summary = req.query.summary === '1';
    const paged = req.query.paged === '1';
    const query = withCursorFilter({
      scope: 'timeline',
      $or: [
        { userId: req.user },
        { privacy: 'public' },
        { privacy: 'friends', userId: { $in: friendIds } }
      ]
    }, req.query.cursor);
    const posts = await Post.find(query)
      .populate('userId', POST_AUTHOR_FIELDS)
      .populate('comments.userId', USER_MEDIA_FIELDS)
      .populate('comments.reactions.userId', USER_MEDIA_FIELDS)
      .populate('reactions.userId', USER_MEDIA_FIELDS)
      .populate('taggedUsers', USER_MEDIA_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .limit(paged ? limit + 1 : limit)
      .lean();

    res.json(paged ? toPostPagePayload(posts, limit, { summary }) : posts.map(post => toPostPayload(post, { summary })));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/home', auth, async (req, res) => {
  try {
    const { content, fileUrl, fileType, fileName, mimeType, fileSize, storagePath, storageProvider } = req.body;
    const text = String(content || '').trim();
    const attachments = normalizeAttachments(req.body.attachments, {
      fileUrl,
      fileType,
      fileName,
      mimeType,
      fileSize,
      storagePath,
      storageProvider,
      variants: req.body.variants || req.body.mediaVariants
    });
    const primaryAttachment = attachments[0] || {};
    if (!text && !attachments.length) return res.status(400).json({ msg: 'Write something or attach media first' });

    const post = new Post({
      groupId: null,
      scope: 'timeline',
      privacy: normalizePrivacy(req.body.privacy),
      userId: req.user,
      title: String(req.body.title || text || 'Timeline post').trim().slice(0, 120),
      content: text || 'Shared media',
      background: String(req.body.background || '').trim().slice(0, 40),
      mood: String(req.body.mood || '').trim().slice(0, 60),
      activity: String(req.body.activity || '').trim().slice(0, 80),
      taggedUsers: Array.isArray(req.body.taggedUsers) ? req.body.taggedUsers.filter(isValidObjectId).slice(0, 20) : [],
      fileUrl: primaryAttachment.fileUrl || '',
      fileType: primaryAttachment.fileType || '',
      fileName: primaryAttachment.fileName || '',
      mimeType: primaryAttachment.mimeType || '',
      fileSize: Number(primaryAttachment.fileSize || 0),
      storagePath: primaryAttachment.storagePath || '',
      storageProvider: primaryAttachment.storageProvider || '',
      mediaVariants: primaryAttachment.variants || normalizeMediaVariants(req.body.mediaVariants || req.body.variants),
      attachments
    });

    await post.save();
    res.status(201).json(await populatePost(post));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/feed', auth, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user }).select('_id').lean();
    const groupIds = groups.map(group => group._id);
    if (!groupIds.length) return res.json([]);
    const limit = parseLimit(req.query.limit, 36, 100);
    const summary = req.query.summary === '1';

    const posts = await Post.find({ groupId: { $in: groupIds } })
      .populate('groupId', 'name subject description')
      .populate('userId', POST_AUTHOR_FIELDS)
      .populate('comments.userId', USER_MEDIA_FIELDS)
      .populate('comments.reactions.userId', USER_MEDIA_FIELDS)
      .populate('reactions.userId', USER_MEDIA_FIELDS)
      .populate('taggedUsers', USER_MEDIA_FIELDS)
      .sort({ pinned: -1, pinnedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(posts.map(post => toPostPayload(post, { summary })));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const group = await findMemberGroup(req.params.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });
    const limit = parseLimit(req.query.limit, 80, 180);

    const posts = await Post.find({ groupId: req.params.groupId })
      .populate('groupId', 'name subject description')
      .populate('userId', POST_AUTHOR_FIELDS)
      .populate('comments.userId', USER_MEDIA_FIELDS)
      .populate('comments.reactions.userId', USER_MEDIA_FIELDS)
      .populate('reactions.userId', USER_MEDIA_FIELDS)
      .populate('taggedUsers', USER_MEDIA_FIELDS)
      .sort({ pinned: -1, pinnedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    res.json(posts.map(hydratePostMedia));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { groupId, title, content, fileUrl } = req.body;
    const group = await findMemberGroup(groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ msg: 'Title and content are required' });
    }

    const post = new Post({
      groupId,
      scope: 'group',
      privacy: 'private',
      userId: req.user,
      title: title.trim(),
      content: content.trim(),
      background: String(req.body.background || '').trim().slice(0, 40),
      mood: String(req.body.mood || '').trim().slice(0, 60),
      activity: String(req.body.activity || '').trim().slice(0, 80),
      taggedUsers: Array.isArray(req.body.taggedUsers) ? req.body.taggedUsers.filter(isValidObjectId).slice(0, 20) : [],
      fileUrl
    });
    await post.save();
    await createGroupActivity({
      groupId,
      actorId: req.user,
      type: 'post',
      title: 'published a post',
      detail: title.trim(),
      targetId: post._id,
      targetModel: 'Post'
    });
    await createNotifications({
      io: req.app.get('io'),
      userIds: group.members,
      actorId: req.user,
      type: 'post',
      title: `${group.name}: new post`,
      body: title.trim(),
      href: `/group/${groupId}`,
      meta: { groupId, postId: post._id }
    });
    const mentionedUserIds = await getMentionedMemberIds(group, `${title} ${content}`);
    if (mentionedUserIds.length) {
      await createNotifications({
        io: req.app.get('io'),
        userIds: mentionedUserIds,
        actorId: req.user,
        type: 'post',
        title: `${group.name}: you were mentioned`,
        body: title.trim(),
        href: `/group/${groupId}`,
        meta: { groupId, postId: post._id, mention: true }
      });
    }
    res.status(201).json(await populatePost(post));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/:postId', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.postId)) return res.status(404).json({ msg: 'Post not found' });
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const access = await ensurePostViewer(post, req.user);
    if (!access) return res.status(403).json({ msg: 'You cannot view this post' });
    res.json(await populatePost(post));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.put('/:postId/like', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const access = await ensurePostViewer(post, req.user);
    if (!access) return res.status(403).json({ msg: 'You cannot view this post' });

    const index = post.likes.findIndex(userId => userId.toString() === req.user);
    if (index === -1) post.likes.push(req.user);
    else post.likes.splice(index, 1);
    await post.save();
    res.json(await populatePost(post));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:postId/comment', auth, async (req, res) => {
  try {
    const { text, replyTo } = req.body;
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const access = await ensurePostViewer(post, req.user);
    if (!access) return res.status(403).json({ msg: 'You cannot view this post' });
    if (!text?.trim()) return res.status(400).json({ msg: 'Comment is required' });

    let parentComment = null;
    if (replyTo) {
      if (!isValidObjectId(replyTo)) return res.status(400).json({ msg: 'Invalid reply target' });
      parentComment = post.comments.id(replyTo);
      if (!parentComment) return res.status(404).json({ msg: 'Comment to reply to was not found' });
    }

    post.comments.push({ userId: req.user, text: text.trim(), replyTo: parentComment?._id || null });
    const newComment = post.comments[post.comments.length - 1];
    await post.save();
    const group = isTimelinePost(post) ? null : access;
    if (group) {
      await createGroupActivity({
        groupId: post.groupId,
        actorId: req.user,
        type: 'comment',
        title: 'commented on a post',
        detail: post.title,
        targetId: post._id,
        targetModel: 'Post'
      });
    }
    await createNotification({
      io: req.app.get('io'),
      userId: post.userId,
      actorId: req.user,
      type: 'comment',
      title: parentComment ? 'New comment in your post' : 'New comment on your post',
      body: text.trim(),
      href: group ? `/group/${post.groupId}?post=${post._id}&comment=${newComment._id}` : `/dashboard?post=${post._id}&comment=${newComment._id}`,
      meta: { groupId: post.groupId, postId: post._id, commentId: newComment._id }
    });

    if (parentComment && normalizeId(parentComment.userId) !== normalizeId(post.userId)) {
      await createNotification({
        io: req.app.get('io'),
        userId: parentComment.userId,
        actorId: req.user,
        type: 'comment',
        title: 'New reply to your comment',
        body: text.trim(),
        href: group ? `/group/${post.groupId}?post=${post._id}&comment=${parentComment._id}` : `/dashboard?post=${post._id}&comment=${parentComment._id}`,
        meta: { groupId: post.groupId, postId: post._id, commentId: parentComment._id, reply: true }
      });
    }

    const mentionedUserIds = group ? await getMentionedMemberIds(group, text) : [];
    if (mentionedUserIds.length) {
      await createNotifications({
        io: req.app.get('io'),
        userIds: mentionedUserIds,
        actorId: req.user,
        type: 'comment',
        title: `${group.name}: you were mentioned`,
        body: text.trim(),
        href: `/group/${post.groupId}`,
        meta: { groupId: post.groupId, postId: post._id, mention: true }
      });
    }
    res.json(await populatePost(post));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:postId/comments/:commentId/react', auth, async (req, res) => {
  try {
    const emoji = String(req.body?.emoji || '').trim().slice(0, 12);
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const access = await ensurePostViewer(post, req.user);
    if (!access) return res.status(403).json({ msg: 'You cannot view this post' });
    if (!emoji) return res.status(400).json({ msg: 'Reaction is required' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    if (!comment.reactions) comment.reactions = [];
    const existingIndex = comment.reactions.findIndex(reaction => normalizeId(reaction.userId) === normalizeId(req.user));
    let reactionApplied = true;
    if (existingIndex !== -1) {
      if (comment.reactions[existingIndex].emoji === emoji) {
        comment.reactions.splice(existingIndex, 1);
        reactionApplied = false;
      } else {
        comment.reactions[existingIndex].emoji = emoji;
      }
    } else {
      comment.reactions.push({ userId: req.user, emoji });
    }

    await post.save();
    const group = isTimelinePost(post) ? null : access;
    const notificationMeta = { groupId: post.groupId, postId: post._id, commentId: comment._id };
    const dedupeKey = `reaction:comment:${comment._id}:actor:${req.user}`;
    if (reactionApplied) {
      await createNotification({
        io: req.app.get('io'),
        userId: comment.userId,
        actorId: req.user,
        type: 'reaction',
        title: 'New reaction on your comment',
        body: `${emoji} ${String(comment.text || '').slice(0, 90)}`,
        href: group ? `/group/${post.groupId}?post=${post._id}&comment=${comment._id}` : `/dashboard?post=${post._id}&comment=${comment._id}`,
        meta: { ...notificationMeta, emoji },
        dedupeKey
      });
    } else {
      await removeNotifications({
        io: req.app.get('io'),
        userId: comment.userId,
        actorId: req.user,
        type: 'reaction',
        meta: notificationMeta,
        dedupeKey
      });
    }

    res.json(await populatePost(post));
  } catch (err) {
    console.error('Comment reaction error:', err);
    res.status(500).json({ msg: err.message });
  }
});

router.put('/:postId/pin', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const group = await ensurePostMember(post, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });
    if (!canManageGroup(group, req.user)) return res.status(403).json({ msg: 'Only workspace admins can pin announcements' });

    post.pinned = !post.pinned;
    post.pinnedAt = post.pinned ? new Date() : null;
    post.pinnedBy = post.pinned ? req.user : null;
    await post.save();

    await createGroupActivity({
      groupId: post.groupId,
      actorId: req.user,
      type: 'post',
      title: post.pinned ? 'pinned an announcement' : 'unpinned an announcement',
      detail: post.title,
      targetId: post._id,
      targetModel: 'Post'
    });

    res.json(await populatePost(post));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.delete('/:postId', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ msg: 'Post not found' });

    const isDeveloper = await canModeratePosts(req.user);

    if (isTimelinePost(post)) {
      const isPostCreator = normalizeId(post.userId) === normalizeId(req.user);
      if (!isPostCreator && !isDeveloper) {
        return res.status(403).json({ msg: 'Not authorized' });
      }
      await post.deleteOne();
      return res.json({ msg: 'Post deleted' });
    }

    const group = isDeveloper ? null : await ensurePostMember(post, req.user);
    if (!isDeveloper && !group) return res.status(403).json({ msg: 'You are not a member of this group' });

    const isPostCreator = post.userId.toString() === req.user;
    const isGroupCreator = group?.creator?.toString() === req.user;
    const isCoCreator = group?.coCreators?.some(c => c.toString() === req.user);
    if (!isPostCreator && !isGroupCreator && !isCoCreator && !isDeveloper) {
      return res.status(403).json({ msg: 'Not authorized' });
    }
    await post.deleteOne();
    res.json({ msg: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:postId/react', auth, async (req, res) => {
  try {
    const { emoji } = req.body;
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const access = await ensurePostViewer(post, req.user);
    if (!access) return res.status(403).json({ msg: 'You cannot view this post' });
    if (!emoji?.trim()) return res.status(400).json({ msg: 'Reaction is required' });

    if (!post.reactions) post.reactions = [];
    const existingIndex = post.reactions.findIndex(r => r.userId.toString() === req.user);
    let reactionApplied = true;
    if (existingIndex !== -1) {
      if (post.reactions[existingIndex].emoji === emoji) {
        post.reactions.splice(existingIndex, 1);
        reactionApplied = false;
      } else {
        post.reactions[existingIndex].emoji = emoji;
      }
    } else {
      post.reactions.push({ userId: req.user, emoji });
    }
    await post.save();
    const group = isTimelinePost(post) ? null : access;
    if (group && reactionApplied) {
      await createGroupActivity({
        groupId: post.groupId,
        actorId: req.user,
        type: 'reaction',
        title: 'reacted to a post',
        detail: post.title,
        targetId: post._id,
        targetModel: 'Post'
      });
    }
    const notificationMeta = { groupId: post.groupId, postId: post._id };
    const dedupeKey = `reaction:post:${post._id}:actor:${req.user}`;
    if (reactionApplied) {
      await createNotification({
        io: req.app.get('io'),
        userId: post.userId,
        actorId: req.user,
        type: 'reaction',
        title: 'New reaction on your post',
        body: `${emoji} ${post.title}`,
        href: group ? `/group/${post.groupId}?post=${post._id}` : `/dashboard?post=${post._id}`,
        meta: { ...notificationMeta, emoji },
        dedupeKey
      });
    } else {
      await removeNotifications({
        io: req.app.get('io'),
        userId: post.userId,
        actorId: req.user,
        type: 'reaction',
        meta: notificationMeta,
        dedupeKey
      });
    }
    res.json(await populatePost(post));
  } catch (err) {
    console.error('Reaction error:', err);
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:postId/share', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const access = await ensurePostViewer(post, req.user);
    if (!access) return res.status(403).json({ msg: 'You cannot view this post' });

    if (!post.shares) post.shares = [];
    post.shares.push({ userId: req.user });
    await post.save();

    const group = isTimelinePost(post) ? null : access;
    if (group) {
      await createGroupActivity({
        groupId: post.groupId,
        actorId: req.user,
        type: 'post',
        title: 'shared a post',
        detail: post.title,
        targetId: post._id,
        targetModel: 'Post'
      });
    }

    res.json(await populatePost(post));
  } catch (err) {
    console.error('Share error:', err);
    res.status(500).json({ msg: err.message });
  }
});

router.put('/:postId/save', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const access = await ensurePostViewer(post, req.user);
    if (!access) return res.status(403).json({ msg: 'You cannot view this post' });

    const index = post.savedBy.findIndex(userId => userId.toString() === req.user);
    if (index === -1) post.savedBy.push(req.user);
    else post.savedBy.splice(index, 1);

    await post.save();
    res.json(await populatePost(post));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
