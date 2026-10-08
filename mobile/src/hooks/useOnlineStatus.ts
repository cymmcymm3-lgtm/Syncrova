import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  connectSocket,
  emitUserOffline,
  emitUserOnline,
  normalizeOnlineUsersPayload,
  requestOnlineUsers
} from '../services/socket';
import { usePresenceStore } from '../store/presenceStore';
import { getEntityId } from '../utils/ids';

type StatusPayload = string | {
  userId?: string;
  id?: string;
  status?: 'online' | 'offline' | string;
  online?: boolean;
  lastSeen?: string | null;
};

type TypingPayload = {
  chatId?: string;
  from?: string;
  userId?: string;
};

const normalizeStatusPayload = (payload: StatusPayload, fallbackOnline?: boolean) => {
  if (typeof payload === 'string') {
    return { userId: payload, online: Boolean(fallbackOnline), lastSeen: null };
  }

  const userId = getEntityId(payload) || payload?.userId || '';
  const online = typeof payload?.online === 'boolean'
    ? payload.online
    : payload?.status
      ? payload.status === 'online'
      : Boolean(fallbackOnline);

  return {
    userId,
    online,
    lastSeen: payload?.lastSeen ?? null
  };
};

const normalizeTypingPayload = (payload: TypingPayload) => {
  const userId = getEntityId(payload?.from) || getEntityId(payload?.userId);
  const chatId = getEntityId(payload?.chatId) || userId;
  return { chatId, userId };
};

/**
 * Owns the native app presence lifecycle. It authenticates the socket, mirrors
 * AppState into online/offline events, and keeps the Zustand presence store hot.
 */
export const useOnlineStatus = (currentUserId?: string | null) => {
  const userId = getEntityId(currentUserId);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!userId) return undefined;

    let disposed = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let cleanupSocketListeners: undefined | (() => void);
    const store = usePresenceStore.getState();

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const startHeartbeat = () => {
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (!disposed && appStateRef.current === 'active') {
          goOnline().catch(() => {});
        }
      }, 30000);
    };

    const goOnline = async () => {
      if (disposed) return;
      const ids = await emitUserOnline(userId).catch(() => []);
      if (!disposed && ids.length) store.setOnlineUsers(ids);
      if (!disposed) store.setUserStatus(userId, true, null);

      const freshIds = await requestOnlineUsers().catch(() => []);
      if (!disposed && freshIds.length) store.setOnlineUsers(freshIds);
    };

    const goOffline = async () => {
      if (disposed) return;
      const payload = await emitUserOffline(userId).catch(() => null);
      if (!disposed) store.setUserStatus(userId, false, payload?.lastSeen || new Date().toISOString());
    };

    const setup = async () => {
      const socket = await connectSocket();

      const onConnect = () => {
        store.setConnected(true);
        goOnline().catch(() => {});
        startHeartbeat();
      };
      const onDisconnect = () => {
        store.setConnected(false);
        stopHeartbeat();
      };
      const onOnlineUsers = (payload: unknown) => {
        store.setOnlineUsers(normalizeOnlineUsersPayload(payload));
      };
      const onUserOnline = (payload: StatusPayload) => {
        const status = normalizeStatusPayload(payload, true);
        if (status.userId) store.setUserStatus(status.userId, true, null);
      };
      const onUserOffline = (payload: StatusPayload) => {
        const status = normalizeStatusPayload(payload, false);
        if (status.userId) {
          store.setUserStatus(status.userId, false, status.lastSeen || new Date().toISOString());
          store.clearTypingForUser(status.userId);
        }
      };
      const onStatusChange = (payload: StatusPayload) => {
        const status = normalizeStatusPayload(payload);
        if (!status.userId) return;
        store.setUserStatus(status.userId, status.online, status.lastSeen || (status.online ? null : new Date().toISOString()));
        if (!status.online) store.clearTypingForUser(status.userId);
      };
      const onTyping = (payload: TypingPayload) => {
        const typing = normalizeTypingPayload(payload);
        if (typing.chatId && typing.userId && typing.userId !== userId) {
          store.setTyping(typing.chatId, typing.userId, true);
        }
      };
      const onStopTyping = (payload: TypingPayload) => {
        const typing = normalizeTypingPayload(payload);
        if (typing.chatId && typing.userId) store.setTyping(typing.chatId, typing.userId, false);
      };

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('online-users', onOnlineUsers);
      socket.on('user-online', onUserOnline);
      socket.on('user-offline', onUserOffline);
      socket.on('user-status-change', onStatusChange);
      socket.on('user-typing', onTyping);
      socket.on('user-stop-typing', onStopTyping);

      cleanupSocketListeners = () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('online-users', onOnlineUsers);
        socket.off('user-online', onUserOnline);
        socket.off('user-offline', onUserOffline);
        socket.off('user-status-change', onStatusChange);
        socket.off('user-typing', onTyping);
        socket.off('user-stop-typing', onStopTyping);
      };

      if (socket.connected) onConnect();
      else socket.connect();
    };

    const subscription = AppState.addEventListener('change', nextState => {
      const wasActive = appStateRef.current === 'active';
      const isActive = nextState === 'active';
      appStateRef.current = nextState;

      if (!wasActive && isActive) {
        goOnline().catch(() => {});
        startHeartbeat();
      }
      if (wasActive && !isActive) {
        stopHeartbeat();
        goOffline().catch(() => {});
      }
    });

    setup().catch(() => {
      store.setConnected(false);
    });

    return () => {
      subscription.remove();
      stopHeartbeat();
      cleanupSocketListeners?.();
      goOffline().catch(() => {});
      disposed = true;
    };
  }, [userId]);
};
