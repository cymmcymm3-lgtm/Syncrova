import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { setApiTokenGetter, setUnauthorizedHandler } from '../services/api';
import { disconnectSocket, refreshSocketAuth, setSocketTokenGetter } from '../services/socket';
import type { User } from '../types';
import { usePresenceStore } from './presenceStore';

const TOKEN_KEY = 'syncrova.nativeMessenger.token';
const USER_CACHE_KEY = 'syncrova.nativeMessenger.user';

type AuthContextValue = {
  user: User | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: { name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const getToken = useCallback(async () => token || AsyncStorage.getItem(TOKEN_KEY), [token]);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_CACHE_KEY]);
    disconnectSocket();
    usePresenceStore.getState().resetPresence();
    setToken(null);
    setUser(null);
  }, []);

  const cacheUser = useCallback(async (nextUser: User | null) => {
    if (!nextUser) {
      await AsyncStorage.removeItem(USER_CACHE_KEY);
      return;
    }
    await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(nextUser));
  }, []);

  const refreshProfile = useCallback(async () => {
    const res = await api.get<User>('/users/profile');
    const nextUser = res.data || null;
    setUser(nextUser);
    await cacheUser(nextUser);
  }, [cacheUser]);

  useEffect(() => {
    setApiTokenGetter(getToken);
    setSocketTokenGetter(getToken);
    setUnauthorizedHandler(() => {
      logout().catch(() => {});
    });
  }, [getToken, logout]);

  useEffect(() => {
    let cancelled = false;

    const parseCachedUser = (raw: string | null) => {
      if (!raw) return null;
      try {
        return JSON.parse(raw) as User;
      } catch {
        return null;
      }
    };

    const bootstrap = async () => {
      let hadCachedUser = false;
      try {
        const [storedToken, cachedUserRaw] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_CACHE_KEY)
        ]);
        if (!storedToken) {
          if (!cancelled) setLoading(false);
          return;
        }

        const cachedUser = parseCachedUser(cachedUserRaw);
        hadCachedUser = Boolean(cachedUser);
        if (cancelled) return;
        setToken(storedToken);
        if (cachedUser) {
          setUser(cachedUser);
          setLoading(false);
        }

        const res = await api.get<User>('/users/profile');
        if (!cancelled) {
          const nextUser = res.data || null;
          setUser(nextUser);
          await cacheUser(nextUser);
        }
      } catch {
        if (!hadCachedUser) {
          await AsyncStorage.multiRemove([TOKEN_KEY, USER_CACHE_KEY]);
          if (!cancelled) {
            setToken(null);
            setUser(null);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    await AsyncStorage.multiSet([
      [TOKEN_KEY, res.data.token],
      [USER_CACHE_KEY, JSON.stringify(res.data.user)]
    ]);
    setToken(res.data.token);
    setUser(res.data.user);
    setLoading(false);
    refreshSocketAuth({ reconnect: true }).catch(() => {});
  }, []);

  const register = useCallback(async ({ name, email, password }: { name: string; email: string; password: string }) => {
    const res = await api.post<{ token: string; user: User }>('/auth/register', { name, email, password });
    await AsyncStorage.multiSet([
      [TOKEN_KEY, res.data.token],
      [USER_CACHE_KEY, JSON.stringify(res.data.user)]
    ]);
    setToken(res.data.token);
    setUser(res.data.user);
    setLoading(false);
    refreshSocketAuth({ reconnect: true }).catch(() => {});
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    token,
    loading,
    isAuthenticated: Boolean(user && token),
    login,
    register,
    logout,
    refreshProfile
  }), [loading, login, logout, refreshProfile, register, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
