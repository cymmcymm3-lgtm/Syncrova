import api from '../services/api';
import { RELEASE_VERSION_NAME } from '../generated/releaseInfo';
import { getBackendOrigin } from './media';
import type { User } from '../types/models';

type NotificationPayload = Record<string, unknown> & {
  title?: string;
  body?: string;
  href?: string;
  tag?: string;
  data?: Record<string, unknown>;
  senderId?: string;
  from?: string;
  messageId?: string;
  notificationId?: string;
  type?: string;
};

type SyncrovaNativeBridge = {
  clearAuth?: () => Promise<void>;
  syncAuth?: (payload: { token: string; apiBaseUrl: string; userId: string }) => Promise<void>;
};

const MESSAGE_CHANNEL_ID = 'syncrova_messages';
const MESSAGE_ACTION_TYPE_ID = 'SYNCROVA_MESSAGE_ACTIONS';

let nativePushSetupPromise: Promise<{ ok: boolean; reason?: string }> | null = null;
let nativeBridgePromise: Promise<SyncrovaNativeBridge | null> | null = null;

const isNativeApp = () => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.Capacitor?.isNativePlatform?.());
};

const isNotificationSupported = () => typeof window !== 'undefined' && 'Notification' in window;

const getNativeBridge = async (): Promise<SyncrovaNativeBridge | null> => {
  if (!nativeBridgePromise) {
    nativeBridgePromise = import('@capacitor/core')
      .then(({ registerPlugin }) => registerPlugin<SyncrovaNativeBridge>('SyncrovaNativeBridge'))
      .catch(() => null);
  }
  return nativeBridgePromise;
};

const getNativeApiBaseUrl = () => {
  const configured = String(api.defaults.baseURL || '').trim();
  if (/^https?:\/\//i.test(configured)) return configured.replace(/\/+$/, '');

  const backendOrigin = getBackendOrigin();
  if (backendOrigin) return `${backendOrigin.replace(/\/+$/, '')}/api`;

  if (typeof window !== 'undefined' && window.location?.origin) {
    const path = configured.startsWith('/') ? configured : `/${configured || 'api'}`;
    return `${window.location.origin}${path}`.replace(/\/+$/, '');
  }

  return '';
};

const getNativePlatform = () => {
  const platform = window.Capacitor?.getPlatform?.();
  return ['android', 'ios', 'web'].includes(platform) ? platform : 'unknown';
};

const getNotificationData = (notification: unknown = {}): NotificationPayload => {
  const source = (notification && typeof notification === 'object' ? notification : {}) as Record<string, unknown>;
  return (source.data
    || (source.notification as { data?: NotificationPayload } | undefined)?.data
    || source.extra
    || {}) as NotificationPayload;
};

const openNotificationPath = (data: NotificationPayload = {}) => {
  const href = String(data.href || (data.senderId || data.from ? `/messages?user=${data.senderId || data.from}` : '/messages')).trim();
  if (!href || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('syncrova:native-open-path', { detail: { href } }));
};

const ensureNativeNotificationChannel = async () => {
  if (!isNativeApp()) return;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.createChannel?.({
      id: MESSAGE_CHANNEL_ID,
      name: 'Messages',
      description: 'New Syncrova chat messages',
      importance: 5,
      visibility: 1,
      lights: true,
      lightColor: '#0B74FF',
      vibration: true
    });
  } catch {
    // Channel creation is Android-only and best-effort.
  }

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.createChannel?.({
      id: MESSAGE_CHANNEL_ID,
      name: 'Messages',
      description: 'New Syncrova chat messages',
      importance: 5,
      visibility: 1,
      lights: true,
      lightColor: '#0B74FF',
      vibration: true
    });
  } catch {
    // Old APKs or web previews can skip local channel setup.
  }
};

const scheduleNativeForegroundNotification = async (payload: NotificationPayload = {}) => {
  if (!isNativeApp() || !payload?.title) return;

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const state = await LocalNotifications.checkPermissions();
    if (state.display !== 'granted') return;

    await ensureNativeNotificationChannel();
    await LocalNotifications.schedule({
      notifications: [{
        id: Math.abs(String(payload.messageId || payload.notificationId || Date.now()).split('').reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)) || Math.floor(Date.now() % 2147483647),
        title: payload.title,
        body: payload.body || '',
        extra: payload,
        channelId: MESSAGE_CHANNEL_ID,
        smallIcon: 'ic_syncrova_notification',
        largeIcon: 'ic_launcher',
        iconColor: '#0B74FF',
        group: payload.senderId ? `syncrova_messages_${payload.senderId}` : 'syncrova_messages',
        autoCancel: true,
        schedule: { at: new Date(Date.now() + 80) },
        actionTypeId: MESSAGE_ACTION_TYPE_ID
      }]
    });
  } catch {
    // Foreground notification fallback should never break chat.
  }
};

export const syncNativeNotificationAuth = async ({ user }: { user?: User } = {}) => {
  if (!isNativeApp()) return;

  try {
    const bridge = await getNativeBridge();
    if (!bridge) return;

    const token = localStorage.getItem('token') || '';
    if (!token) {
      await bridge.clearAuth?.();
      return;
    }

    await bridge.syncAuth?.({
      token,
      apiBaseUrl: getNativeApiBaseUrl(),
      userId: String(user?._id || user?.id || '')
    });
  } catch {
    // Native bridge is optional; web auth should not depend on it.
  }
};

export const getNotificationPermissionState = async () => {
  if (isNativeApp()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const state = await LocalNotifications.checkPermissions();
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const pushState = await PushNotifications.checkPermissions();
      return pushState.receive || state.display || 'prompt';
    } catch {
      return 'prompt';
    }
  }

  if (!isNotificationSupported()) return 'unsupported';
  return window.Notification.permission;
};

export const requestNotificationPermission = async () => {
  if (isNativeApp()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const localState = await LocalNotifications.requestPermissions();
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const pushState = await PushNotifications.requestPermissions();
      if ((pushState.receive || localState.display) === 'granted') {
        setupNativePushNotifications().catch(() => {});
      }
      return pushState.receive || localState.display || 'prompt';
    } catch {
      return 'denied';
    }
  }

  if (!isNotificationSupported()) return 'unsupported';
  return window.Notification.requestPermission();
};

export const setupNativePushNotifications = async () => {
  if (!isNativeApp()) return { ok: false, reason: 'web' };
  if (nativePushSetupPromise) return nativePushSetupPromise;

  nativePushSetupPromise = (async () => {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    await ensureNativeNotificationChannel();
    await syncNativeNotificationAuth();

    try {
      await LocalNotifications.registerActionTypes?.({
        types: [{
          id: MESSAGE_ACTION_TYPE_ID,
          actions: [
            { id: 'open', title: 'Open', foreground: true },
            { id: 'reply', title: 'Reply', foreground: false }
          ]
        }]
      });
    } catch {
      // Android inline reply is handled by the native receiver; iOS can use this later.
    }

    await LocalNotifications.addListener?.('localNotificationActionPerformed', async (event: { actionId?: string; inputValue?: string; notification?: { extra?: NotificationPayload; data?: NotificationPayload } }) => {
      const data = event?.notification?.extra || event?.notification?.data || {};
      if (event?.actionId === 'reply') {
        const text = String(event?.inputValue || '').trim();
        const to = String(data.senderId || data.from || data.actorId || '').trim();
        if (text && to) {
          await api.post('/messages', { to, text }).catch(() => {});
          return;
        }
      }
      openNotificationPath(data);
    });

    await PushNotifications.addListener('registration', async token => {
      const value = String(token?.value || '').trim();
      if (!value) return;
      await syncNativeNotificationAuth();
      await api.post('/notifications/native/register', {
        token: value,
        platform: getNativePlatform(),
        appVersion: RELEASE_VERSION_NAME
      }).catch(() => {});
    });

    await PushNotifications.addListener('registrationError', error => {
      console.warn('Push registration failed:', error?.error || error);
    });

    await PushNotifications.addListener('pushNotificationReceived', notification => {
      const data = getNotificationData(notification);
      scheduleNativeForegroundNotification({
        ...data,
        title: data.title || notification?.title || 'Syncrova',
        body: data.body || notification?.body || ''
      }).catch(() => {});
    });

    await PushNotifications.addListener('pushNotificationActionPerformed', notification => {
      openNotificationPath(getNotificationData(notification));
    });

    const permission = await PushNotifications.checkPermissions();
    if (permission.receive !== 'granted') {
      const requested = await PushNotifications.requestPermissions();
      if (requested.receive !== 'granted') return { ok: false, reason: 'permission_denied' };
    }

    await PushNotifications.register();
    return { ok: true };
  })();

  return nativePushSetupPromise;
};

export const showAppNotification = async ({ title, body, tag, data }: NotificationPayload = {}) => {
  if (!title) return;

  if (isNativeApp()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const state = await LocalNotifications.checkPermissions();
      if (state.display !== 'granted') return;
      await LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Date.now() % 2147483647),
          title,
          body,
          channelId: MESSAGE_CHANNEL_ID,
          smallIcon: 'ic_syncrova_notification',
          largeIcon: 'ic_launcher',
          iconColor: '#0B74FF',
          actionTypeId: data?.type === 'message' ? MESSAGE_ACTION_TYPE_ID : undefined,
          extra: data,
          schedule: { at: new Date(Date.now() + 120) }
        }]
      });
    } catch {
      // Native notification support is optional.
    }
    return;
  }

  if (!isNotificationSupported() || window.Notification.permission !== 'granted') return;

  try {
    const registration = await navigator.serviceWorker?.ready?.catch(() => null);
    if (registration?.showNotification) {
      registration.showNotification(title, {
        body,
        tag,
        data,
        icon: '/syncrova-app-logo.png',
        badge: '/pwa-192.png'
      });
      return;
    }

    new window.Notification(title, { body, tag, data, icon: '/syncrova-app-logo.png' });
  } catch {
    // Never block realtime chat if notification delivery fails.
  }
};
