import { io, Socket } from 'socket.io-client';
import { getBackendOrigin } from '../utils/media';

let socket: Socket | undefined;

const getDefaultSocketUrl = (): string => {
  return getBackendOrigin();
};

const getToken = (): string => localStorage.getItem('token') || '';

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io(getDefaultSocketUrl(), {
      auth: { token: getToken() },
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000
    });

    socket.io.on('reconnect_attempt', () => {
      if (socket) socket.auth = { token: getToken() };
    });
  } else {
    socket.auth = { token: getToken() };
  }

  return socket;
};

interface RefreshSocketAuthOptions {
  reconnect?: boolean;
}

export const refreshSocketAuth = ({ reconnect = false }: RefreshSocketAuthOptions = {}): void => {
  if (!socket) return;
  const previousToken =
    (typeof socket.auth === 'object' && socket.auth && (socket.auth as { token?: string }).token) || '';
  const nextToken = getToken();
  socket.auth = { token: nextToken };

  if (!reconnect) return;
  if (socket.connected && previousToken !== nextToken) {
    socket.disconnect();
    socket.connect();
    return;
  }
  if (!socket.connected) socket.connect();
};

export const disconnectSocket = (): void => {
  if (!socket) return;

  socket.disconnect();
  socket = undefined;
};
