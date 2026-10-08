const admin = require('firebase-admin');
const PushDevice = require('../models/PushDevice');

let firebaseInitialized = false;
let firebaseInitializationFailed = false;

const normalizeString = (value) => String(value || '').trim();

const normalizePrivateKey = (value) => normalizeString(value).replace(/\\n/g, '\n');

const getServiceAccount = () => {
  const json = normalizeString(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed?.project_id && parsed?.client_email && parsed?.private_key) return parsed;
    } catch (err) {
      console.warn('Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', err.message);
    }
  }

  const projectId = normalizeString(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = normalizeString(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) return null;

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey
  };
};

const getMessaging = () => {
  if (firebaseInitializationFailed) return null;

  if (!firebaseInitialized) {
    const serviceAccount = getServiceAccount();
    if (!serviceAccount) return null;

    try {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      }
      firebaseInitialized = true;
    } catch (err) {
      firebaseInitializationFailed = true;
      console.warn('Firebase Admin initialization failed:', err.message);
      return null;
    }
  }

  return admin.messaging();
};

const isNativePushConfigured = () => Boolean(getServiceAccount()) && !firebaseInitializationFailed;

const registerNativePushDevice = async ({ userId, token, platform = 'unknown', appVersion = '', deviceId = '' }) => {
  const normalizedToken = normalizeString(token);
  if (!userId || !normalizedToken) return null;

  const safePlatform = ['android', 'ios', 'web'].includes(platform) ? platform : 'unknown';
  return PushDevice.findOneAndUpdate(
    { token: normalizedToken },
    {
      $set: {
        userId,
        platform: safePlatform,
        appVersion: normalizeString(appVersion).slice(0, 40),
        deviceId: normalizeString(deviceId).slice(0, 120),
        active: true,
        lastSeenAt: new Date(),
        failedAt: null,
        failureReason: ''
      }
    },
    { upsert: true, new: true }
  );
};

const unregisterNativePushDevice = async ({ userId, token }) => {
  const normalizedToken = normalizeString(token);
  if (!userId || !normalizedToken) return null;
  return PushDevice.findOneAndUpdate(
    { userId, token: normalizedToken },
    { $set: { active: false, failedAt: new Date(), failureReason: 'unregistered' } },
    { new: true }
  );
};

const toDataPayload = (payload = {}) => Object.fromEntries(
  Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)])
);

const deactivateFailedTokens = async (devices = [], responses = []) => {
  const invalidCodes = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
    'messaging/invalid-argument'
  ]);

  const operations = responses
    .map((response, index) => ({ response, device: devices[index] }))
    .filter(({ response }) => !response?.success && invalidCodes.has(response?.error?.code))
    .map(({ response, device }) => PushDevice.updateOne(
      { _id: device._id },
      {
        $set: {
          active: false,
          failedAt: new Date(),
          failureReason: response.error.code
        }
      }
    ));

  if (operations.length) await Promise.allSettled(operations);
};

const sendNativePushNotification = async ({ userId, title, body = '', href = '', type = 'notification', actorId = '', actorName = '', actorAvatar = '', meta = {} }) => {
  const messaging = getMessaging();
  if (!messaging || !userId) return { ok: false, reason: 'not_configured', sent: 0 };

  const devices = await PushDevice.find({ userId, active: true }).sort({ lastSeenAt: -1 }).limit(8).lean();
  const tokens = devices.map(device => device.token).filter(Boolean);
  if (!tokens.length) return { ok: true, sent: 0 };

  const data = toDataPayload({
    title,
    body,
    href,
    type,
    actorId,
    actorName,
    actorAvatar,
    notificationId: meta?.notificationId,
    messageId: meta?.messageId,
    from: meta?.from,
    senderId: meta?.from || actorId,
    createdAt: new Date().toISOString()
  });

  try {
    const response = await messaging.sendEachForMulticast({
      tokens,
      data,
      android: {
        priority: 'high',
        ttl: 1000 * 60 * 60 * 24,
        collapseKey: type === 'message' ? `message_${data.senderId || 'syncrova'}` : 'syncrova_notification'
      }
    });

    await deactivateFailedTokens(devices, response.responses || []);
    return { ok: true, sent: response.successCount || 0, failed: response.failureCount || 0 };
  } catch (err) {
    console.warn('Native push send failed:', err.message);
    return { ok: false, reason: err.message, sent: 0 };
  }
};

module.exports = {
  isNativePushConfigured,
  registerNativePushDevice,
  sendNativePushNotification,
  unregisterNativePushDevice
};
