const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Task = require('../models/Task');
const Group = require('../models/Group');
const { createNotification, createNotifications } = require('../services/notifications');
const { createGroupActivity } = require('../services/activity');
const { getMentionedMemberIds } = require('../services/mentions');
const router = express.Router();

const VALID_STATUSES = ['not_started', 'in_progress', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];
const VALID_APPROVAL_STATUSES = ['not_required', 'pending', 'approved', 'changes_requested'];
const MAX_DUE_DATE_YEARS = 5;

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const normalizeDueDate = (value) => {
  if (!value) return null;
  if (typeof value !== 'string') {
    const err = new Error('Due date must be a valid date');
    err.status = 400;
    throw err;
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const err = new Error('Due date must use YYYY-MM-DD format');
    err.status = 400;
    throw err;
  }

  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
    const err = new Error('Due date is not a real calendar date');
    err.status = 400;
    throw err;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setUTCFullYear(maxDate.getUTCFullYear() + MAX_DUE_DATE_YEARS);

  if (date < today) {
    const err = new Error('Due date cannot be in the past');
    err.status = 400;
    throw err;
  }

  if (date > maxDate) {
    const err = new Error(`Due date cannot be more than ${MAX_DUE_DATE_YEARS} years ahead`);
    err.status = 400;
    throw err;
  }

  return date;
};

const findMemberGroup = async (groupId, userId) => {
  if (!isValidObjectId(groupId)) return null;
  return Group.findOne({ _id: groupId, members: userId });
};

const populateTask = async (task) => {
  await task.populate('assignedTo', 'name avatar isDeveloper');
  await task.populate('createdBy', 'name avatar isDeveloper');
  await task.populate('completedBy', 'name avatar isDeveloper');
  await task.populate('comments.userId', 'name avatar isDeveloper');
  await task.populate('activity.userId', 'name avatar isDeveloper');
  return task;
};

const normalizeLabels = (labels) => {
  if (!Array.isArray(labels)) return [];
  return [...new Set(labels
    .map(label => String(label || '').trim())
    .filter(Boolean)
    .slice(0, 6))]
    .map(label => label.slice(0, 28));
};

router.get('/group/:groupId', auth, async (req, res) => {
  try {
    const group = await findMemberGroup(req.params.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });

    const tasks = await Task.find({ groupId: req.params.groupId })
      .populate('assignedTo', 'name avatar isDeveloper')
      .populate('createdBy', 'name avatar isDeveloper')
      .populate('completedBy', 'name avatar isDeveloper')
      .populate('comments.userId', 'name avatar isDeveloper')
      .populate('activity.userId', 'name avatar isDeveloper')
      .sort({ createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    res.status(err.status || 500).json({ msg: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { groupId, description, dueDate, priority, assignedTo, labels = [], approvalStatus } = req.body;
    const group = await findMemberGroup(groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });
    if (!description?.trim()) return res.status(400).json({ msg: 'Task title is required' });

    const task = new Task({
      groupId,
      description: description.trim(),
      createdBy: req.user,
      dueDate: normalizeDueDate(dueDate),
      priority: VALID_PRIORITIES.includes(priority) ? priority : 'medium',
      labels: normalizeLabels(labels),
      approvalStatus: VALID_APPROVAL_STATUSES.includes(approvalStatus) ? approvalStatus : 'not_required',
      assignedTo: assignedTo || null,
      activity: [{ userId: req.user, action: 'created this task' }]
    });
    await task.save();
    await createGroupActivity({
      groupId,
      actorId: req.user,
      type: 'task',
      title: 'created a task',
      detail: description.trim(),
      targetId: task._id,
      targetModel: 'Task'
    });
    if (assignedTo) {
      await createNotification({
        io: req.app.get('io'),
        userId: assignedTo,
        actorId: req.user,
        type: 'task',
        title: `Task assigned in ${group.name}`,
        body: description.trim(),
        href: `/group/${groupId}`,
        meta: { groupId, taskId: task._id }
      });
    } else {
      await createNotifications({
        io: req.app.get('io'),
        userIds: group.members,
        actorId: req.user,
        type: 'task',
        title: `${group.name}: new task`,
        body: description.trim(),
        href: `/group/${groupId}`,
        meta: { groupId, taskId: task._id }
      });
    }
    const mentionedUserIds = await getMentionedMemberIds(group, description);
    if (mentionedUserIds.length) {
      await createNotifications({
        io: req.app.get('io'),
        userIds: mentionedUserIds,
        actorId: req.user,
        type: 'task',
        title: `${group.name}: you were mentioned in a task`,
        body: description.trim(),
        href: `/group/${groupId}`,
        meta: { groupId, taskId: task._id, mention: true }
      });
    }
    res.status(201).json(await populateTask(task));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.put('/:taskId', auth, async (req, res) => {
  try {
    const { status, priority, dueDate, assignedTo, comment, labels, approvalStatus } = req.body;
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ msg: 'Task not found' });
    const group = await findMemberGroup(task.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });

    if (status && VALID_STATUSES.includes(status) && status !== task.status) {
      task.activity.push({ userId: req.user, action: `changed status to ${status}` });
      if (status === 'done') {
        task.completedAt = task.completedAt || new Date();
        task.completedBy = req.user;
      } else if (task.status === 'done') {
        task.completedAt = null;
        task.completedBy = null;
      }
      task.status = status;
    }
    if (priority && VALID_PRIORITIES.includes(priority) && priority !== task.priority) {
      task.activity.push({ userId: req.user, action: `changed priority to ${priority}` });
      task.priority = priority;
    }
    if (approvalStatus && VALID_APPROVAL_STATUSES.includes(approvalStatus) && approvalStatus !== task.approvalStatus) {
      task.activity.push({ userId: req.user, action: `changed approval to ${approvalStatus}` });
      task.approvalStatus = approvalStatus;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'labels')) {
      task.labels = normalizeLabels(labels);
      task.activity.push({ userId: req.user, action: 'updated task labels' });
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'dueDate')) {
      const nextDueDate = normalizeDueDate(dueDate);
      task.dueDate = nextDueDate;
      task.activity.push({ userId: req.user, action: nextDueDate ? 'updated the due date' : 'cleared the due date' });
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'assignedTo')) {
      task.assignedTo = assignedTo || null;
      task.activity.push({ userId: req.user, action: assignedTo ? 'updated the assignee' : 'cleared the assignee' });
      if (assignedTo) {
        await createNotification({
          io: req.app.get('io'),
          userId: assignedTo,
          actorId: req.user,
          type: 'task',
          title: `Task assigned in ${group.name}`,
          body: task.description,
          href: `/group/${task.groupId}`,
          meta: { groupId: task.groupId, taskId: task._id }
        });
      }
    }
    if (typeof comment === 'string' && comment.trim()) {
      const trimmedComment = comment.trim();
      task.comments.push({ userId: req.user, text: trimmedComment });
      task.activity.push({ userId: req.user, action: `commented: "${trimmedComment}"` });
      const mentionedUserIds = await getMentionedMemberIds(group, trimmedComment);
      if (mentionedUserIds.length) {
        await createNotifications({
          io: req.app.get('io'),
          userIds: mentionedUserIds,
          actorId: req.user,
          type: 'task',
          title: `${group.name}: you were mentioned in a task`,
          body: trimmedComment,
          href: `/group/${task.groupId}`,
          meta: { groupId: task.groupId, taskId: task._id, mention: true }
        });
      }
    }
    await task.save();
    await createGroupActivity({
      groupId: task.groupId,
      actorId: req.user,
      type: 'task',
      title: 'updated a task',
      detail: task.description,
      targetId: task._id,
      targetModel: 'Task'
    });
    res.json(await populateTask(task));
  } catch (err) {
    res.status(err.status || 500).json({ msg: err.message });
  }
});

router.put('/:taskId/complete', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ msg: 'Task not found' });
    const group = await findMemberGroup(task.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });

    task.status = task.status === 'done' ? 'not_started' : 'done';
    task.completedAt = task.status === 'done' ? new Date() : null;
    task.completedBy = task.status === 'done' ? req.user : null;
    task.activity.push({ userId: req.user, action: `changed status to ${task.status}` });
    await task.save();
    await createGroupActivity({
      groupId: task.groupId,
      actorId: req.user,
      type: 'task',
      title: task.status === 'done' ? 'completed a task' : 'reopened a task',
      detail: task.description,
      targetId: task._id,
      targetModel: 'Task'
    });
    res.json(await populateTask(task));
  } catch (err) {
    res.status(err.status || 500).json({ msg: err.message });
  }
});

router.delete('/:taskId', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ msg: 'Task not found' });

    const group = await findMemberGroup(task.groupId, req.user);
    if (!group) return res.status(403).json({ msg: 'You are not a member of this group' });
    if (!task.createdBy || task.createdBy.toString() !== req.user) {
      return res.status(403).json({ msg: 'Only the task creator can delete this task' });
    }

    await task.deleteOne();
    res.json({ msg: 'Task deleted', taskId: req.params.taskId });
  } catch (err) {
    res.status(err.status || 500).json({ msg: err.message });
  }
});

module.exports = router;
