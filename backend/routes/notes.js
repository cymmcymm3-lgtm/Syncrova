const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Group = require('../models/Group');
const GroupNote = require('../models/GroupNote');
const Message = require('../models/Message');
const UserNote = require('../models/UserNote');
const { createGroupActivity } = require('../services/activity');
const { createNotification, removeNotifications } = require('../services/notifications');
const router = express.Router();

const NOTE_TTL_MS = 24 * 60 * 60 * 1000;
const USER_NOTE_MAX_LENGTH = 140;

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const normalizeId = (value) => String(value?._id || value?.id || value || '');

const findMemberGroup = async (groupId, userId) => {
  if (!isValidObjectId(groupId)) return null;
  return Group.findOne({ _id: groupId, members: userId });
};

const populateNote = async (note) => {
  await note.populate('userId', 'name avatar isDeveloper');
  return note;
};

const populateUserNote = async (note) => {
  if (!note) return null;
  await note.populate('userId', 'name avatar lastSeen isDeveloper');
  await note.populate('reactions.userId', 'name avatar isDeveloper');
  await note.populate('views.userId', 'name avatar isDeveloper');
  await note.populate('comments.userId', 'name avatar isDeveloper');
  await note.populate('comments.reactions.userId', 'name avatar isDeveloper');
  return note;
};

const removeExpiredUserNotes = () => UserNote.deleteMany({ expiresAt: { $lte: new Date() } });

const emitUserNoteUpdated = (req, note) => {
  const io = req.app.get('io');
  if (io && note) io.emit('user-note-updated', note);
};

const emitUserNoteDeleted = (req, payload) => {
  const io = req.app.get('io');
  if (io) io.emit('user-note-deleted', payload);
};

const populateDirectMessage = (messageId) => Message.findById(messageId)
  .populate('from', 'name email avatar isDeveloper lastSeen')
  .populate('to', 'name email avatar isDeveloper lastSeen')
  .populate('reactions.userId', 'name avatar isDeveloper')
  .populate({
    path: 'replyTo',
    populate: { path: 'from', select: 'name email avatar isDeveloper lastSeen' }
  })
  .lean();

router.get('/me', auth, async (req, res) => {
  try {
    await removeExpiredUserNotes();
    const note = await UserNote.findOne({
      userId: req.user,
      expiresAt: { $gt: new Date() }
    });
    res.json(note ? await populateUserNote(note) : null);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/active', auth, async (req, res) => {
  try {
    await removeExpiredUserNotes();
    const notes = await UserNote.find({ expiresAt: { $gt: new Date() } })
      .populate('userId', 'name avatar lastSeen isDeveloper')
      .populate('reactions.userId', 'name avatar isDeveloper')
      .populate('views.userId', 'name avatar isDeveloper')
      .populate('comments.userId', 'name avatar isDeveloper')
      .populate('comments.reactions.userId', 'name avatar isDeveloper')
      .sort({ updatedAt: -1 })
      .limit(100);
    res.json(notes);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/me', auth, async (req, res) => {
  try {
    const text = req.body.text?.trim();
    if (!text) return res.status(400).json({ msg: 'Note text is required' });
    if (text.length > USER_NOTE_MAX_LENGTH) {
      return res.status(400).json({ msg: `Note must be ${USER_NOTE_MAX_LENGTH} characters or less` });
    }

    const existingNote = await UserNote.findOne({ userId: req.user }).select('expiresAt');
    const resetEngagement = !existingNote || existingNote.expiresAt <= new Date();
    const updatePayload = {
      userId: req.user,
      text,
      expiresAt: new Date(Date.now() + NOTE_TTL_MS)
    };
    if (resetEngagement) {
      updatePayload.reactions = [];
      updatePayload.views = [];
      updatePayload.comments = [];
    }

    const note = await UserNote.findOneAndUpdate(
      { userId: req.user },
      updatePayload,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const populatedNote = await populateUserNote(note);
    emitUserNoteUpdated(req, populatedNote);
    res.status(201).json(populatedNote);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.delete('/me', auth, async (req, res) => {
  try {
    const note = await UserNote.findOne({ userId: req.user }).select('_id userId');
    await UserNote.deleteOne({ userId: req.user });
    if (note) emitUserNoteDeleted(req, { noteId: note._id, userId: req.user });
    res.json({ msg: 'Note removed' });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:noteId/react', auth, async (req, res) => {
  try {
    const emoji = String(req.body?.emoji || '').trim().slice(0, 12);
    if (!emoji) return res.status(400).json({ msg: 'Reaction is required' });
    if (!isValidObjectId(req.params.noteId)) return res.status(400).json({ msg: 'Invalid note id' });

    const note = await UserNote.findOne({
      _id: req.params.noteId,
      expiresAt: { $gt: new Date() }
    });
    if (!note) return res.status(404).json({ msg: 'Note not found' });

    if (!note.reactions) note.reactions = [];
    const existingIndex = note.reactions.findIndex(reaction => normalizeId(reaction.userId) === normalizeId(req.user));
    let reactionApplied = true;
    if (existingIndex !== -1) {
      if (note.reactions[existingIndex].emoji === emoji) {
        note.reactions.splice(existingIndex, 1);
        reactionApplied = false;
      } else {
        note.reactions[existingIndex].emoji = emoji;
      }
    } else {
      note.reactions.push({ userId: req.user, emoji });
    }

    await note.save();
    const populatedNote = await populateUserNote(note);
    emitUserNoteUpdated(req, populatedNote);

    const notificationMeta = { noteId: note._id };
    const dedupeKey = `reaction:note:${note._id}:actor:${req.user}`;
    if (reactionApplied) {
      await createNotification({
        io: req.app.get('io'),
        userId: note.userId,
        actorId: req.user,
        type: 'reaction',
        title: 'New reaction on your note',
        body: `${emoji} ${note.text}`,
        href: '/messages',
        meta: { ...notificationMeta, emoji },
        dedupeKey
      });
    } else {
      await removeNotifications({
        io: req.app.get('io'),
        userId: note.userId,
        actorId: req.user,
        type: 'reaction',
        meta: notificationMeta,
        dedupeKey
      });
    }

    res.json(populatedNote);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:noteId/view', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.noteId)) return res.status(400).json({ msg: 'Invalid note id' });

    const note = await UserNote.findOne({
      _id: req.params.noteId,
      expiresAt: { $gt: new Date() }
    });
    if (!note) return res.status(404).json({ msg: 'Note not found' });

    if (!note.views) note.views = [];
    const viewerIndex = note.views.findIndex(view => normalizeId(view.userId) === normalizeId(req.user));
    if (viewerIndex === -1) {
      note.views.push({ userId: req.user, viewedAt: new Date() });
    } else {
      note.views[viewerIndex].viewedAt = new Date();
    }

    await note.save();
    const populatedNote = await populateUserNote(note);
    emitUserNoteUpdated(req, populatedNote);
    res.json(populatedNote);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:noteId/comments', auth, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ msg: 'Reply text is required' });
    if (text.length > 300) return res.status(400).json({ msg: 'Reply must be 300 characters or less' });
    if (!isValidObjectId(req.params.noteId)) return res.status(400).json({ msg: 'Invalid note id' });

    const note = await UserNote.findOne({
      _id: req.params.noteId,
      expiresAt: { $gt: new Date() }
    }).populate('userId', 'name avatar lastSeen isDeveloper');
    if (!note) return res.status(404).json({ msg: 'Note not found' });

    note.comments.push({ userId: req.user, text });
    const newComment = note.comments[note.comments.length - 1];
    await note.save();

    const io = req.app.get('io');
    const noteOwnerId = normalizeId(note.userId);
    const ownerName = note.userId?.name || 'their';

    if (noteOwnerId && noteOwnerId !== normalizeId(req.user)) {
      const message = new Message({
        from: req.user,
        to: noteOwnerId,
        text: `Replied to ${ownerName}'s Note: ${text}`
      });
      await message.save();
      const populatedMessage = await populateDirectMessage(message._id);

      if (io && populatedMessage) {
        io.to(`user_${noteOwnerId}`).emit('receiveMessage', populatedMessage);
        io.to(`user_${req.user}`).emit('receiveMessage', populatedMessage);
      }

      await createNotification({
        io,
        userId: noteOwnerId,
        actorId: req.user,
        type: 'note',
        title: 'New reply to your note',
        body: text,
        href: `/messages?user=${req.user}`,
        meta: { noteId: note._id, commentId: newComment._id, messageId: message._id }
      });
    }

    const populatedNote = await populateUserNote(note);
    emitUserNoteUpdated(req, populatedNote);
    res.json(populatedNote);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/:noteId/comments/:commentId/react', auth, async (req, res) => {
  try {
    const emoji = String(req.body?.emoji || '').trim().slice(0, 12);
    if (!emoji) return res.status(400).json({ msg: 'Reaction is required' });
    if (!isValidObjectId(req.params.noteId)) return res.status(400).json({ msg: 'Invalid note id' });

    const note = await UserNote.findOne({
      _id: req.params.noteId,
      expiresAt: { $gt: new Date() }
    });
    if (!note) return res.status(404).json({ msg: 'Note not found' });

    const comment = note.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ msg: 'Reply not found' });

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

    await note.save();
    const populatedNote = await populateUserNote(note);
    emitUserNoteUpdated(req, populatedNote);

    const notificationMeta = { noteId: note._id, commentId: comment._id };
    const dedupeKey = `reaction:note-comment:${comment._id}:actor:${req.user}`;
    if (reactionApplied) {
      await createNotification({
        io: req.app.get('io'),
        userId: comment.userId,
        actorId: req.user,
        type: 'reaction',
        title: 'New reaction on your note reply',
        body: `${emoji} ${comment.text}`,
        href: '/messages',
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

    res.json(populatedNote);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const group = await findMemberGroup(req.params.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });

    await GroupNote.deleteMany({ groupId: req.params.groupId, expiresAt: { $lte: new Date() } });
    const notes = await GroupNote.find({
      groupId: req.params.groupId,
      expiresAt: { $gt: new Date() }
    })
      .populate('userId', 'name avatar isDeveloper')
      .sort({ createdAt: -1 });
    res.json(notes);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/group/:groupId', auth, async (req, res) => {
  try {
    const group = await findMemberGroup(req.params.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });

    const text = req.body.text?.trim();
    if (!text) return res.status(400).json({ msg: 'Note text is required' });
    if (text.length > 180) return res.status(400).json({ msg: 'Note must be 180 characters or less' });

    const note = new GroupNote({
      groupId: req.params.groupId,
      userId: req.user,
      text,
      expiresAt: new Date(Date.now() + NOTE_TTL_MS)
    });
    await note.save();
    await createGroupActivity({
      groupId: req.params.groupId,
      actorId: req.user,
      type: 'note',
      title: 'posted a group note',
      detail: text,
      targetId: note._id,
      targetModel: 'GroupNote'
    });
    res.status(201).json(await populateNote(note));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.delete('/:noteId', auth, async (req, res) => {
  try {
    const note = await GroupNote.findById(req.params.noteId);
    if (!note) return res.status(404).json({ msg: 'Note not found' });

    const group = await findMemberGroup(note.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });

    const isOwner = note.userId.toString() === req.user;
    const isCreator = group.creator.toString() === req.user;
    const isCoCreator = group.coCreators?.some(userId => userId.toString() === req.user);
    if (!isOwner && !isCreator && !isCoCreator) {
      return res.status(403).json({ msg: 'Not authorized to delete this note' });
    }

    await note.deleteOne();
    res.json({ msg: 'Note deleted', noteId: req.params.noteId });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
