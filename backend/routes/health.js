const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { getStorageConfigStatus } = require('../services/storage');
const { getLiveKitStatus } = require('../services/livekitConfig');
const { getMediaDiagnostics, runStorageProbe } = require('../services/mediaDiagnostics');

const router = express.Router();

const mongoStates = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting'
};

const bundledRelease = {
  versionName: '4.4.33',
  versionCode: 80
};

const getReleaseApkPath = () => {
  const configuredVersionCode = Number(process.env.APP_VERSION_CODE);
  const versionName = Number.isInteger(configuredVersionCode) && configuredVersionCode >= bundledRelease.versionCode
    ? String(process.env.APP_VERSION_NAME || bundledRelease.versionName).trim() || bundledRelease.versionName
    : bundledRelease.versionName;
  const safeVersion = versionName.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `/releases/syncrova-${safeVersion}.apk`;
};

router.get('/', auth, async (req, res) => {
  const io = req.app.get('io');
  const turnUrls = String(process.env.TURN_URLS || process.env.APP_TURN_URLS || process.env.VITE_TURN_URLS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const relayForced = String(
    process.env.CALL_FORCE_RELAY
    || process.env.APP_CALL_FORCE_RELAY
    || process.env.VITE_CALL_FORCE_RELAY
    || ''
  ).toLowerCase() === 'true';
  const livekitStatus = getLiveKitStatus();
  const livekitConfigured = Boolean(livekitStatus.livekitConfigured);
  const deepMediaCheck = ['1', 'true', 'yes'].includes(String(req.query.deep || '').toLowerCase());
  const runProbe = ['1', 'true', 'yes'].includes(String(req.query.probe || '').toLowerCase());
  let media;
  try {
    media = await getMediaDiagnostics({
      includeBrokenCheck: deepMediaCheck,
      brokenLimit: 12
    });
  } catch (err) {
    media = {
      status: 'failed',
      checkedAt: new Date().toISOString(),
      message: err.message || 'Media diagnostics failed'
    };
  }
  const storageProbe = runProbe ? await runStorageProbe() : null;

  res.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    api: {
      status: 'online',
      nodeEnv: process.env.NODE_ENV || 'development'
    },
    database: {
      status: mongoStates[mongoose.connection.readyState] || 'unknown',
      readyState: mongoose.connection.readyState
    },
    socket: {
      status: io ? 'online' : 'unavailable',
      connectedClients: io?.engine?.clientsCount || 0
    },
    storage: getStorageConfigStatus(),
    media,
    storageProbe,
    calls: {
      turnConfigured: turnUrls.length > 0,
      turnCount: turnUrls.length,
      livekitConfigured,
      livekitMissing: livekitStatus.livekitMissing,
      livekitWarnings: livekitStatus.livekitWarnings,
      livekitSourceKeys: livekitStatus.livekitSourceKeys,
      relayMode: relayForced
        ? 'relay preferred'
        : livekitConfigured
          ? 'livekit'
          : 'auto'
    },
    assistant: {
      openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    },
    app: {
      releaseUrl: getReleaseApkPath()
    }
  });
});

module.exports = router;
