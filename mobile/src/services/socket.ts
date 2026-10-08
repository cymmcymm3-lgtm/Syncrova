import { io, Socket } from 'socket.io-client';
import { BACKEND_ORIGIN } from '../config';

type OnlineUsersPayload = string[] | {
  users?: Array<string | { _id?: string; id?: string }>;
  userIds?: string[];
};

type TypingPayload = {
  chatId: string;
  to?: string;
  from?: string;
};

type PresencePayload = string | {
  userId: string;
  token?: string;
};

let socket: Socket | null = null;
let tokenGetter: () => Promise<string | null> = async () => null;

const normalizeId = (value?: unknown) => String((value as { _id?: string; id?: string; userId?: string })?._id || (value as { id?: string; userId?: string })?.id || (value as { userId?: string })?.userId || value || '');

export const normalizeOnlineUsersPayload = (payload?: OnlineUsersPayload | unknown): string[] => {
  if (Array.isArray(payload)) return payload.map(normalizeId).filter(Boolean);

  if (!payload || typeof payload !== 'object') return [];

  const typedPayload = payload as Exclude<OnlineUsersPayload, string[]>;
  if (Array.isArray(typedPayload?.userIds)) return typedPayload.userIds.map(normalizeId).filter(Boolean);
  if (Array.isArray(typedPayload?.users)) return typedPayload.users.map(normalizeId).filter(Boolean);

  return [];
};

export const setSocketTokenGetter = (getter: () => Promise<string | null>) => {
  tokenGetter = getter;
};

const getAuthToken = async () => (await tokenGetter()) || '';

const buildPresencePayload = async (userId: string): Promise<PresencePayload> => {
  const token = await getAuthToken();
  return token ? { userId, token } : userId;
};

const applyFreshAuth = async (targetSocket: Socket) => {
  targetSocket.auth = { token: await getAuthToken() };
};

const createSocket = async () => {
  const nextSocket = io(BACKEND_ORIGIN, {
    auth: { token: await getAuthToken() },
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    timeout: 12000
  });

  nextSocket.io.on('reconnect_attempt', async () => {
    await applyFreshAuth(nextSocket);
  });

  return nextSocket;
};

export const getSocket = async () => {
  if (!socket) socket = await createSocket();
  await applyFreshAuth(socket);
  return socket;
};

export const connectSocket = async () => {
  const activeSocket = await getSocket();
  await applyFreshAuth(activeSocket);
  if (!activeSocket.connected) activeSocket.connect();
  return activeSocket;
};

export const refreshSocketAuth = async ({ reconnect = false } = {}) => {
  if (!socket) return;
  await applyFreshAuth(socket);
  if (reconnect) {
    socket.disconnect();
    socket.connect();
  }
};

export const emitUserOnline = async (userId: string) => {
  const activeSocket = await connectSocket();
  const id = normalizeId(userId);
  if (!id) return [];
  const payload = await buildPresencePayload(id);

  return new Promise<string[]>(resolve => {
    let settled = false;
    const done = (payload?: OnlineUsersPayload | unknown) => {
      if (settled) return;
      settled = true;
      resolve(normalizeOnlineUsersPayload(payload));
    };

    activeSocket.emit('user-online', payload, done);
    setTimeout(() => done(), 5000);
  });
};

export const emitUserOffline = async (userId: string) => {
  const activeSocket = await getSocket();
  const id = normalizeId(userId);
  if (!id || !activeSocket.connected) return null;
  const payload = await buildPresencePayload(id);

  return new Promise<{ lastSeen?: string | null } | null>(resolve => {
    let settled = false;
    const done = (payload?: { lastSeen?: string | null }) => {
      if (settled) return;
      settled = true;
      resolve(payload || null);
    };

    activeSocket.emit('user-offline', payload, done);
    setTimeout(() => done(), 3000);
  });
};

export const requestOnlineUsers = async () => {
  const activeSocket = await connectSocket();

  return new Promise<string[]>(resolve => {
    let settled = false;
    const done = (payload?: OnlineUsersPayload | unknown) => {
      if (settled) return;
      settled = true;
      resolve(normalizeOnlineUsersPayload(payload));
    };

    activeSocket.emit('get-online-users', done);
    setTimeout(() => done(), 5000);
  });
};

export const emitTypingStart = async ({ chatId, to, from }: TypingPayload) => {
  const activeSocket = await connectSocket();
  const targetId = normalizeId(to || chatId);
  const senderId = normalizeId(from);
  if (!targetId || !senderId) return;

  activeSocket.emit('typing-start', { chatId: targetId, to: targetId, from: senderId });
  activeSocket.emit('typing', { to: targetId, from: senderId });
};

export const emitTypingStop = async ({ chatId, to, from }: TypingPayload) => {
  const activeSocket = await getSocket();
  const targetId = normalizeId(to || chatId);
  const senderId = normalizeId(from);
  if (!targetId || !senderId || !activeSocket.connected) return;

  activeSocket.emit('typing-stop', { chatId: targetId, to: targetId, from: senderId });
  activeSocket.emit('stop-typing', { to: targetId, from: senderId });
};

export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
};
