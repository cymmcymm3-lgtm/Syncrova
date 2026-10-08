const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const auth = require('../middleware/auth');
const User = require('../models/User');
const { getLiveKitConfig } = require('../services/livekitConfig');

const router = express.Router();

const normalizeId = (value) => String(value?._id || value?.id || value || '').trim();
const sanitizeRoomName = (value) => (
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 96)
);

router.post('/livekit-token', auth, async (req, res) => {
  try {
    const { livekitUrl, apiKey, apiSecret, missing } = getLiveKitConfig();
    if (missing.length) {
      return res.status(503).json({
        msg: `LiveKit is not configured on the server. Missing: ${missing.join(', ')}`,
        missing
      });
    }

    const userId = normalizeId(req.user);
    const partnerId = normalizeId(req.body?.partnerId);
    const callId = sanitizeRoomName(req.body?.callId);
    const requestedRoom = sanitizeRoomName(req.body?.roomName);
    const roomName = requestedRoom || (callId ? `syncrova-call-${callId}` : '');
    if (!userId || !partnerId || !roomName) {
      return res.status(400).json({ msg: 'Missing call room details.' });
    }

    const user = await User.findById(userId).select('name email avatar profilePicture').lean().catch(() => null);
    const identity = `user-${userId}`;
    const displayName = String(user?.name || user?.email || 'Syncrova User').slice(0, 80);
    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName,
      ttl: '2h'
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    res.json({
      token: await token.toJwt(),
      url: livekitUrl,
      roomName,
      identity,
      participant: {
        userId,
        name: displayName,
        avatar: user?.avatar || user?.profilePicture || ''
      }
    });
  } catch (err) {
    res.status(500).json({ msg: err.message || 'Could not create LiveKit call token.' });
  }
});

module.exports = router;
