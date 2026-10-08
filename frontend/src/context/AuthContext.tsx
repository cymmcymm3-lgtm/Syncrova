import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  ReactNode,
} from 'react';
import api from '../services/api';
import { disconnectSocket, getSocket, refreshSocketAuth } from '../services/socket';
// notifications.js is still untyped; allowJs in tsconfig handles the import.
import {
  setupNativePushNotifications,
  syncNativeNotificationAuth,
} from '../utils/notifications';
import type { User, EntityRef } from '../types/models';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (newToken: string, userData: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const getEntityId = (entity: EntityRef): string => {
  if (!entity) return '';
  if (typeof entity === 'string') return entity;
  return String(entity._id || entity.id || '');
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));

  // `logout` is referenced inside the token effect's `.catch`. We declare it
  // before the effect so the closure captures the stable identity. (It only
  // touches setters and module-scoped helpers, so it doesn't need useCallback.)
  const logout = (): void => {
    localStorage.removeItem('token');
    delete api.defaults.headers.common['x-auth-token'];
    syncNativeNotificationAuth().catch(() => {});
    disconnectSocket();
    setToken(null);
    setUser(null);
  };

  useEffect(() => {
    if (token) {
      api.defaults.headers.common['x-auth-token'] = token;
      refreshSocketAuth({ reconnect: true });
      // Fetch user profile
      api.get<User>('/users/profile')
        .then((res) => {
          setUser(res.data);
          syncNativeNotificationAuth({ user: res.data }).catch(() => {});
          setupNativePushNotifications().catch(() => {});
        })
        .catch(() => logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    // logout intentionally omitted from deps: it's stable for our purposes
    // (only touches setState + module-scoped helpers) and including it would
    // require useCallback gymnastics for zero practical benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const userId = getEntityId(user);
    if (!userId) return undefined;

    const socket = getSocket();
    const announceOnline = (): void => {
      socket.emit('user-online', userId);
    };

    socket.on('connect', announceOnline);

    if (socket.connected) {
      announceOnline();
    } else {
      socket.connect();
    }

    const heartbeat = setInterval(announceOnline, 30000);

    return () => {
      socket.off('connect', announceOnline);
      clearInterval(heartbeat);
    };
  }, [user]);

  const login = (newToken: string, userData: User): void => {
    localStorage.setItem('token', newToken);
    api.defaults.headers.common['x-auth-token'] = newToken;
    refreshSocketAuth({ reconnect: true });
    setToken(newToken);
    setUser(userData);
    syncNativeNotificationAuth({ user: userData }).catch(() => {});
    setupNativePushNotifications().catch(() => {});
  };

  const value: AuthContextValue = {
    user,
    loading,
    login,
    logout,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Access the auth context.
 *
 * Throws if called outside an `<AuthProvider>`. The app always mounts the
 * provider at the root in `App`, so any thrown error here indicates a wiring
 * bug (e.g. a test render or storybook missing the provider) — surfacing it
 * loudly is better than letting destructuring crash deeper in the stack.
 */
export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return ctx;
};
