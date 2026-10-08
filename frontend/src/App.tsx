import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Toaster } from 'react-hot-toast';
import { MotionConfig } from 'framer-motion';
import { Download, ExternalLink, Loader2, MessageCircle } from 'lucide-react';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PresenceProvider } from './context/PresenceContext';
import { CallProvider } from './context/CallContext';
import AppUpdatePrompt from './components/AppUpdatePrompt';
import WebUpdatePrompt from './components/WebUpdatePrompt';
import { PageSkeleton } from './components/SkeletonLoader';
import useFrameHealthMonitor from './hooks/useFrameHealthMonitor';
import { getBackendOrigin } from './utils/media';
import { RELEASE_ANDROID_VERSION_CODE, RELEASE_VERSION_NAME } from './generated/releaseInfo';

const Login = lazy(() => import('./components/Login'));
const Register = lazy(() => import('./components/Register'));
const Layout = lazy(() => import('./components/Layout'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const Profile = lazy(() => import('./components/Profile'));
const Messages = lazy(() => import('./components/Messages'));
const OpsArena = lazy(() => import('./components/OpsArena'));
const GamePlayPage = lazy(() => import('./components/GamePlayPage'));
const Friends = lazy(() => import('./components/Friends'));
const Reels = lazy(() => import('./components/Reels'));
const SettingsPage = lazy(() => import('./components/SettingsPage'));
const NotificationsPage = lazy(() => import('./components/NotificationsPage'));
const GlobalSearchPage = lazy(() => import('./components/GlobalSearchPage'));
const SavedItemsPage = lazy(() => import('./components/SavedItemsPage'));
const AppHealthPage = lazy(() => import('./components/AppHealthPage'));
type MessengerStatus = { installed?: boolean; versionCode?: number; updateRequired?: boolean };
type SyncrovaNativeBridgePlugin = {
  openExternalUrl?: (payload: { url: string }) => Promise<void>;
  openMessenger?: (payload: { path: string; minVersionCode?: number }) => Promise<MessengerStatus & { opened?: boolean }>;
  getMessengerStatus?: (payload?: { minVersionCode?: number }) => Promise<MessengerStatus>;
};

const SyncrovaNativeBridge = registerPlugin<SyncrovaNativeBridgePlugin>('SyncrovaNativeBridge');

const getNativeBackFallbackPath = (pathname = '/') => {
  if (pathname.startsWith('/group/')) return '/dashboard';
  if (pathname.startsWith('/messages')) return '/messages';
  if (pathname.startsWith('/arena')) return '/arena';
  if (pathname.startsWith('/developer-console')) return '/developer-console';
  if (pathname.startsWith('/settings')) return '/settings';
  if (pathname.startsWith('/notifications')) return '/notifications';
  if (pathname.startsWith('/search')) return '/search';
  if (pathname.startsWith('/saved')) return '/saved';
  if (pathname.startsWith('/app-health')) return '/app-health';
  if (pathname.startsWith('/profile')) return '/profile';
  if (pathname.startsWith('/friends')) return '/friends';
  if (pathname.startsWith('/groups')) return '/dashboard';
  if (pathname.startsWith('/marketplace')) return '/dashboard';
  if (pathname.startsWith('/reels')) return '/reels';
  return '/dashboard';
};

const INTRO_SPLASH_SESSION_KEY = 'syncrova-intro-splash-shown';
const MESSENGER_SPLASH_SESSION_KEY = 'syncrova-messenger-intro-splash-shown';
const MESSENGER_STANDALONE_STORAGE_KEY = 'syncrova:standalone-messenger';
const MESSENGER_WEB_CONTINUE_STORAGE_KEY = 'syncrova:web-messenger-continue';
const MESSENGER_APK_PATH = '/releases/syncrova-messenger-latest.apk';
const SYNCROVA_LOGO_SRC = '/syncrova-app-logo.png';
const SYNCROVA_MESSENGER_LOGO_SRC = '/syncrovaalogoformessenger.png';
const REQUIRED_MESSENGER_VERSION_CODE = RELEASE_ANDROID_VERSION_CODE;

const isNativeAndroid = () => {
  if (typeof window === 'undefined') return false;
  const importedPlatform = Capacitor?.getPlatform?.();
  if (importedPlatform) return importedPlatform === 'android';
  const platform = window.Capacitor?.getPlatform?.();
  if (platform) return platform === 'android';
  return Boolean(Capacitor?.isNativePlatform?.() || window.Capacitor?.isNativePlatform?.()) && /android/i.test(navigator.userAgent || '');
};

const getMessengerDownloadUrl = () => {
  const backendOrigin = getBackendOrigin();
  if (backendOrigin) return `${backendOrigin}${MESSENGER_APK_PATH}`;
  return MESSENGER_APK_PATH;
};

const hasSeenIntroSplash = (key = INTRO_SPLASH_SESSION_KEY) => {
  try {
    return window.sessionStorage?.getItem(key) === 'true';
  } catch {
    return false;
  }
};

const markIntroSplashSeen = (key = INTRO_SPLASH_SESSION_KEY) => {
  try {
    window.sessionStorage?.setItem(key, 'true');
  } catch {
    // Session storage can be blocked in some embedded browsers; the splash can still render normally.
  }
};

const isStandaloneMessengerApp = () => {
  if (import.meta.env.VITE_SYNCROVA_STANDALONE_MESSENGER === '1') return true;
  if (typeof window === 'undefined') return false;
  if (window.__SYNCROVA_MESSENGER_APP__ === true) return true;

  try {
    if (window.localStorage?.getItem(MESSENGER_STANDALONE_STORAGE_KEY) === 'true') return true;
  } catch {
    // Storage is only a native handoff; ignore blocked storage.
  }

  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('app') === 'messenger' || params.get('standalone') === 'messenger';
  } catch {
    return false;
  }
};

function useStandaloneMessengerMode() {
  const [enabled, setEnabled] = useState(() => isStandaloneMessengerApp());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = () => setEnabled(isStandaloneMessengerApp());
    window.addEventListener('syncrova:standalone-messenger-ready', refresh);
    return () => window.removeEventListener('syncrova:standalone-messenger-ready', refresh);
  }, []);

  return enabled;
}

function NativeBackButtonHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const isNative = typeof window !== 'undefined' && (
      window.Capacitor?.isNativePlatform?.() ||
      Capacitor.isNativePlatform?.() ||
      window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'ionic:'
    );
    if (!isNative) return undefined;

    let cancelled = false;
    let listenerPromise = null;

    const setupBackButton = async () => {
      try {
        const { App: CapacitorApp } = await import('@capacitor/app');
        if (cancelled || !CapacitorApp?.addListener) return;

        listenerPromise = CapacitorApp.addListener('backButton', () => {
          const backEvent = new CustomEvent('syncrova:native-back', {
            cancelable: true,
            detail: { pathname: window.location.pathname }
          });
          window.dispatchEvent(backEvent);
          if (backEvent.defaultPrevented) return;

          const pathname = window.location.pathname || '/';
          const historyIndex = Number(window.history.state?.idx || 0);
          const isAppRoot = pathname === '/' || pathname === '/dashboard' || pathname === '/login';

          if (historyIndex > 0 && !isAppRoot) {
            navigate(-1);
            return;
          }

          const fallbackPath = getNativeBackFallbackPath(pathname);
          if (fallbackPath && fallbackPath !== pathname) {
            navigate(fallbackPath, { replace: true });
          } else if (window.history.length > 1) {
            navigate(-1);
          } else if (isAppRoot) {
            CapacitorApp.exitApp?.();
          } else {
            navigate('/dashboard', { replace: true });
          }
        });
      } catch {
        // Web builds and old APKs without the plugin should keep working normally.
      }
    };

    setupBackButton();

    return () => {
      cancelled = true;
      Promise.resolve(listenerPromise)
        .then(listener => listener?.remove?.())
        .catch(() => {});
    };
  }, [navigate, location.pathname]);

  return null;
}

const getRouteLoadingSkeleton = (pathname = '') => {
  if (pathname === '/dashboard' || pathname === '/reels') return { variant: 'dashboard', rows: 3 };
  if (pathname === '/friends' || pathname === '/arena' || pathname.startsWith('/arena/')) return { variant: 'cards', rows: 4 };
  if (pathname === '/search') return { variant: 'search', rows: 5 };
  if (pathname === '/saved') return { variant: 'saved', rows: 4 };
  if (pathname === '/messages') return { variant: 'default', rows: 4 };
  return { variant: 'default', rows: 4 };
};

function RouteLoadingFallback() {
  const location = useLocation();
  const { variant, rows } = getRouteLoadingSkeleton(location.pathname);

  return (
    <PageSkeleton variant={variant} rows={rows} />
  );
}

function ThemedToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3000,
        style: {
          background: '#ffffff',
          border: '1px solid #dde1e6',
          boxShadow: '0 12px 28px rgba(20, 21, 24, 0.12)',
          color: '#1c1e21'
        }
      }}
    />
  );
}

function MessengerLoadingFallback() {
  return (
    <div className="syncrova-messenger-loading skeleton-motion-zone" role="status" aria-label="Loading Syncrova Messenger">
      <div className="syncrova-messenger-loading-card">
        <img src={SYNCROVA_MESSENGER_LOGO_SRC} alt="" draggable={false} />
        <p>Syncrova Messenger</p>
        <span>Opening chats</span>
        <div className="syncrova-messenger-loading-bar" aria-hidden="true">
          <i />
        </div>
      </div>
    </div>
  );
}

function NativeNotificationRouter() {
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const normalizePath = (value = '') => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      try {
        const url = new URL(raw);
        if (url.protocol === 'syncrova:' || url.protocol === 'syncrova-messenger:') {
          const path = url.pathname && url.pathname !== '/' ? url.pathname : '';
          return `${path || '/messages'}${url.search || ''}${url.hash || ''}`;
        }
        return `${url.pathname || '/messages'}${url.search || ''}${url.hash || ''}`;
      } catch {
        return raw.startsWith('/') ? raw : `/${raw}`;
      }
    };

    const openPath = (href) => {
      const path = normalizePath(href);
      if (path) navigate(path);
    };

    const handleNativeOpenPath = (event) => {
      openPath(event.detail?.href);
    };

    let appUrlListenerPromise = null;
    const setupAppUrlListener = async () => {
      try {
        const { App: CapacitorApp } = await import('@capacitor/app');
        appUrlListenerPromise = CapacitorApp.addListener('appUrlOpen', event => openPath(event?.url));
      } catch {
        // Deep linking is native-only.
      }
    };

    window.addEventListener('syncrova:native-open-path', handleNativeOpenPath);
    setupAppUrlListener();

    return () => {
      window.removeEventListener('syncrova:native-open-path', handleNativeOpenPath);
      Promise.resolve(appUrlListenerPromise)
        .then(listener => listener?.remove?.())
        .catch(() => {});
    };
  }, [navigate]);

  return null;
}

function NativeAppEnvironment() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const isNative = Boolean(window.Capacitor?.isNativePlatform?.()) ||
      window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'ionic:';
    const root = document.documentElement;
    const viewport = document.querySelector('meta[name="viewport"]');
    const previousViewport = viewport?.getAttribute('content') || '';

    const applyMessengerClass = () => {
      root.classList.toggle('syncrova-messenger-standalone', isStandaloneMessengerApp());
    };

    root.classList.toggle('syncrova-native-app', isNative);
    applyMessengerClass();
    window.addEventListener('syncrova:standalone-messenger-ready', applyMessengerClass);
    if (isNative && viewport) {
      viewport.setAttribute(
        'content',
        'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
      );
    }

    return () => {
      root.classList.remove('syncrova-native-app');
      root.classList.remove('syncrova-messenger-standalone');
      window.removeEventListener('syncrova:standalone-messenger-ready', applyMessengerClass);
      if (viewport && previousViewport) viewport.setAttribute('content', previousViewport);
    };
  }, []);

  return null;
}

function FrameStabilityMonitor() {
  useFrameHealthMonitor();
  return null;
}

function MobileScrollPerformanceGovernor() {
  const removeClassTimerRef = useRef(null);
  const removeInteractionTimerRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const root = document.documentElement;
    const isMobileViewport = () => (
      root.classList.contains('syncrova-native-app') ||
      window.matchMedia?.('(max-width: 900px), (pointer: coarse)').matches
    );

    const clearScrollStateLater = () => {
      if (removeClassTimerRef.current) window.clearTimeout(removeClassTimerRef.current);
      removeClassTimerRef.current = window.setTimeout(() => {
        root.classList.remove('syncrova-scroll-active');
      }, 150);
    };

    const clearInteractionStateLater = () => {
      if (removeInteractionTimerRef.current) window.clearTimeout(removeInteractionTimerRef.current);
      removeInteractionTimerRef.current = window.setTimeout(() => {
        root.classList.remove('syncrova-interaction-active');
      }, 120);
    };

    const markActiveScroll = () => {
      if (!isMobileViewport() || rafRef.current) return;
      // Performance-sensitive: keep this DOM write on the next frame so scroll handlers stay passive.
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        root.classList.add('syncrova-scroll-active');
        clearScrollStateLater();
      });
    };

    const markInteractionActive = () => {
      if (!isMobileViewport()) return;
      root.classList.add('syncrova-interaction-active');
      clearInteractionStateLater();
    };

    const listenerOptions = { passive: true, capture: true };
    window.addEventListener('scroll', markActiveScroll, listenerOptions);
    window.addEventListener('touchmove', markActiveScroll, listenerOptions);
    window.addEventListener('wheel', markActiveScroll, listenerOptions);
    window.addEventListener('pointerdown', markInteractionActive, listenerOptions);
    window.addEventListener('pointermove', markInteractionActive, listenerOptions);
    window.addEventListener('pointerup', clearInteractionStateLater, listenerOptions);
    window.addEventListener('pointercancel', clearInteractionStateLater, listenerOptions);
    window.addEventListener('touchstart', markInteractionActive, listenerOptions);
    window.addEventListener('touchend', clearInteractionStateLater, listenerOptions);
    window.addEventListener('touchcancel', clearInteractionStateLater, listenerOptions);

    return () => {
      window.removeEventListener('scroll', markActiveScroll, listenerOptions);
      window.removeEventListener('touchmove', markActiveScroll, listenerOptions);
      window.removeEventListener('wheel', markActiveScroll, listenerOptions);
      window.removeEventListener('pointerdown', markInteractionActive, listenerOptions);
      window.removeEventListener('pointermove', markInteractionActive, listenerOptions);
      window.removeEventListener('pointerup', clearInteractionStateLater, listenerOptions);
      window.removeEventListener('pointercancel', clearInteractionStateLater, listenerOptions);
      window.removeEventListener('touchstart', markInteractionActive, listenerOptions);
      window.removeEventListener('touchend', clearInteractionStateLater, listenerOptions);
      window.removeEventListener('touchcancel', clearInteractionStateLater, listenerOptions);
      if (removeClassTimerRef.current) window.clearTimeout(removeClassTimerRef.current);
      if (removeInteractionTimerRef.current) window.clearTimeout(removeInteractionTimerRef.current);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      root.classList.remove('syncrova-scroll-active');
      root.classList.remove('syncrova-interaction-active');
    };
  }, []);

  return null;
}

function MessengerHandoff({ onContinueWeb }) {
  const location = useLocation();
  const nativeAndroid = isNativeAndroid();
  const [checking, setChecking] = useState(nativeAndroid);
  const [opening, setOpening] = useState(false);
  const [installed, setInstalled] = useState(null);
  const [messengerStatus, setMessengerStatus] = useState(null);
  const [statusText, setStatusText] = useState(nativeAndroid ? 'Checking for Syncrova Messenger...' : '');
  const messengerPath = `${location.pathname || '/messages'}${location.search || ''}${location.hash || ''}`;
  const downloadUrl = getMessengerDownloadUrl();
  const installedMessengerVersionCode = Number(messengerStatus?.versionCode || 0);
  const messengerNeedsUpdate = Boolean(installed && installedMessengerVersionCode > 0 && installedMessengerVersionCode < REQUIRED_MESSENGER_VERSION_CODE);
  const messengerReady = Boolean(installed && !messengerNeedsUpdate);

  const openInstallLink = async ({ update = false } = {}) => {
    setOpening(true);
    setStatusText(update ? 'Opening the Syncrova Messenger update...' : 'Opening the Syncrova Messenger installer...');
    try {
      if (nativeAndroid && SyncrovaNativeBridge?.openExternalUrl) {
        await SyncrovaNativeBridge.openExternalUrl({ url: downloadUrl });
      } else {
        window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      }
    } catch {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setOpening(false);
    }
  };

  const openMessenger = async ({ silent = false } = {}) => {
    if (!nativeAndroid || !SyncrovaNativeBridge?.openMessenger) {
      if (!silent) await openInstallLink({ update: messengerNeedsUpdate });
      return;
    }

    if (!silent) {
      setOpening(true);
      setStatusText('Opening Syncrova Messenger...');
    }

    try {
      const result = await SyncrovaNativeBridge.openMessenger({
        path: messengerPath,
        minVersionCode: REQUIRED_MESSENGER_VERSION_CODE
      });
      const nextInstalled = Boolean(result?.installed);
      setMessengerStatus(result || null);
      setInstalled(nextInstalled);
      if (result?.updateRequired) {
        setStatusText(`Syncrova Messenger needs update ${RELEASE_VERSION_NAME} before chats can open.`);
        if (!silent) await openInstallLink({ update: true });
        return;
      }
      if (result?.opened) return;
      setStatusText(nextInstalled ? 'Syncrova Messenger is installed, but Android blocked the auto-open. Tap open again.' : 'Syncrova Messenger is not installed yet.');
      if (!silent && !nextInstalled) await openInstallLink();
    } catch {
      setStatusText('Could not open Syncrova Messenger automatically.');
    } finally {
      if (!silent) setOpening(false);
    }
  };

  useEffect(() => {
    if (!nativeAndroid || !SyncrovaNativeBridge?.getMessengerStatus) {
      setChecking(false);
      setInstalled(false);
      return undefined;
    }

    let cancelled = false;
    const checkMessenger = async () => {
      setChecking(true);
      try {
        const result = await SyncrovaNativeBridge.getMessengerStatus({
          minVersionCode: REQUIRED_MESSENGER_VERSION_CODE
        });
        if (cancelled) return;
        const nextInstalled = Boolean(result?.installed);
        const nextNeedsUpdate = Boolean(result?.updateRequired);
        setMessengerStatus(result || null);
        setInstalled(nextInstalled);
        if (nextNeedsUpdate) {
          setStatusText(`Syncrova Messenger is outdated. Update to ${RELEASE_VERSION_NAME} to continue.`);
          await openInstallLink({ update: true });
          return;
        }
        setStatusText(nextInstalled
          ? 'Native Messenger is installed. You can open it, or continue chatting here.'
          : 'Native Messenger is optional. You can continue here or download it anytime.');
      } catch {
        if (!cancelled) {
          setMessengerStatus(null);
          setInstalled(false);
          setStatusText('Native Messenger is optional. Continue in web chat or download it for Android.');
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    checkMessenger();
    return () => {
      cancelled = true;
    };
  }, [messengerPath, nativeAndroid]);

  return (
    <main className="messenger-handoff-page">
      <section className="messenger-handoff-card" aria-label="Choose Syncrova Messenger experience">
        <span className="messenger-handoff-icon">
          <MessageCircle size={30} />
        </span>
        <p className="messenger-handoff-kicker">Syncrova Messenger</p>
        <h1>Choose your chat experience</h1>
        <p className="messenger-handoff-copy">
          You can keep chatting in the web app without installing anything, or download the native Android Messenger for smoother media and notifications.
        </p>
        <div className="messenger-handoff-benefits" aria-label="Messenger options">
          <span>Web chat stays available</span>
          <span>Native app is optional</span>
          <span>Same Syncrova account</span>
        </div>
        {statusText && (
          <p className="messenger-handoff-status">
            {checking || opening ? <Loader2 size={15} className="skeleton-motion-zone animate-spin" /> : null}
            <span>{statusText}</span>
          </p>
        )}
        <div className="messenger-handoff-actions">
          <button
            type="button"
            onClick={onContinueWeb}
            className="messenger-handoff-primary"
          >
            <MessageCircle size={17} />
            Continue without native app
          </button>
          <button
            type="button"
            onClick={() => openInstallLink({ update: messengerNeedsUpdate })}
            disabled={checking || opening}
            className="messenger-handoff-secondary"
          >
            {checking || opening ? <Loader2 size={17} className="skeleton-motion-zone animate-spin" /> : <Download size={17} />}
            {messengerNeedsUpdate ? 'Update Syncrova native Messenger' : 'Download Syncrova native Messenger'}
          </button>
          {messengerReady && (
            <button
              type="button"
              onClick={() => openMessenger()}
              disabled={checking || opening}
              className="messenger-handoff-secondary"
            >
              <ExternalLink size={17} />
              Open installed Messenger
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function MessengerEntry() {
  const [continueWeb, setContinueWeb] = useState(() => {
    try {
      return window.localStorage?.getItem(MESSENGER_WEB_CONTINUE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const continueInWeb = () => {
    try {
      window.localStorage?.setItem(MESSENGER_WEB_CONTINUE_STORAGE_KEY, 'true');
    } catch {
      // Local storage can be blocked; render the web chat for this session anyway.
    }
    setContinueWeb(true);
  };

  if (continueWeb) return <Messages />;
  return <MessengerHandoff onContinueWeb={continueInWeb} />;
}

function AppRoutes() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <PageSkeleton variant="dashboard" rows={4} />;
  const protectedLayout = isAuthenticated ? <Layout>{null}</Layout> : <Navigate to="/login" replace />;
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
        <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/dashboard" />} />
        <Route path="/register" element={!isAuthenticated ? <Register /> : <Navigate to="/dashboard" />} />
        <Route element={protectedLayout}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/marketplace" element={<Navigate to="/dashboard" replace />} />
          <Route path="/groups" element={<Navigate to="/dashboard" replace />} />
          <Route path="/group/:id" element={<Navigate to="/dashboard" replace />} />
          <Route path="/group/:id/:section" element={<Navigate to="/dashboard" replace />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/messages" element={<MessengerEntry />} />
          <Route path="/reels" element={<Reels />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/arena" element={<OpsArena />} />
          <Route path="/arena/:gameKey" element={<GamePlayPage />} />
          <Route path="/developer-console" element={<OpsArena initialView="developer" consoleOnly />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/search" element={<GlobalSearchPage />} />
          <Route path="/saved" element={<SavedItemsPage />} />
          <Route path="/app-health" element={<AppHealthPage />} />
        </Route>
        <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </Suspense>
  );
}

function MessengerStandaloneRoutes() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <MessengerLoadingFallback />;

  return (
    <Suspense fallback={<MessengerLoadingFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to={isAuthenticated ? '/messages' : '/login'} replace />} />
        <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/messages" replace />} />
        <Route path="/register" element={!isAuthenticated ? <Register /> : <Navigate to="/messages" replace />} />
        <Route path="/messages" element={isAuthenticated ? <Messages /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to={isAuthenticated ? '/messages' : '/login'} replace />} />
      </Routes>
    </Suspense>
  );
}

function AppIntroSplash({ standaloneMessenger = false }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const isNative = Boolean(window.Capacitor?.isNativePlatform?.()) ||
      window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'ionic:';
    const isMobile = window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches;
    if (!isNative && !isMobile) return undefined;
    const splashKey = standaloneMessenger ? MESSENGER_SPLASH_SESSION_KEY : INTRO_SPLASH_SESSION_KEY;
    if (hasSeenIntroSplash(splashKey)) return undefined;

    markIntroSplashSeen(splashKey);
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 1900);
    return () => window.clearTimeout(timer);
  }, [standaloneMessenger]);

  if (!visible) return null;

  return (
    <div className={`syncrova-intro-splash messenger-motion-zone ${standaloneMessenger ? 'is-messenger' : ''}`} aria-label={`Welcome to ${standaloneMessenger ? 'Syncrova Messenger' : 'Syncrova'}`}>
      <div className="syncrova-intro-glow" />
      <div className="syncrova-intro-card">
        <div className="syncrova-intro-logo">
          <img src={standaloneMessenger ? SYNCROVA_MESSENGER_LOGO_SRC : SYNCROVA_LOGO_SRC} alt="" draggable={false} />
        </div>
        <p className="syncrova-intro-eyebrow">{standaloneMessenger ? 'Opening' : 'Welcome to'}</p>
        <h1>{standaloneMessenger ? 'Messenger' : 'Syncrova'}</h1>
        <p className="syncrova-intro-credit">{standaloneMessenger ? 'Opening chats' : 'Loading workspace'}</p>
        <div className="syncrova-intro-loader">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

type AppErrorBoundaryProps = { children: ReactNode };
type AppErrorBoundaryState = { hasError: boolean };

class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Syncrova render failed', error);
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem('syncrova:last-render-error', JSON.stringify({
          message: error?.message || String(error),
          stack: error?.stack || ''
        }));
      } catch {
        // Dev-only diagnostics should never affect recovery rendering.
      }
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="syncrova-error-fallback">
        <div className="syncrova-error-card">
          <img src="/syncrova-app-logo.png" alt="" draggable={false} />
          <p className="text-xs font-black uppercase text-[#0b57d0]">Syncrova recovered safely</p>
          <h1>Something went wrong</h1>
          <p>The app hit a temporary screen error. Reloading usually puts everything back in place.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload Syncrova
          </button>
        </div>
      </div>
    );
  }
}

function App() {
  const standaloneMessenger = useStandaloneMessengerMode();

  return (
    <ThemeProvider>
      <AuthProvider>
        <PresenceProvider>
          <MotionConfig reducedMotion="user">
            <ThemedToaster />
            {!standaloneMessenger && <AppUpdatePrompt />}
            <WebUpdatePrompt />
            <AppIntroSplash standaloneMessenger={standaloneMessenger} />
            <AppErrorBoundary>
              <BrowserRouter>
                <NativeAppEnvironment />
                <FrameStabilityMonitor />
                <MobileScrollPerformanceGovernor />
                <NativeBackButtonHandler />
                <NativeNotificationRouter />
                <CallProvider>
                  <div className={`app-no-motion app-stable-render relative min-h-screen overflow-hidden ${standaloneMessenger ? 'syncrova-messenger-root' : ''}`} style={{ background: 'var(--app-bg)' }}>
                    {!standaloneMessenger && (
                      <>
                        <div className="app-decorative-effect app-grid-overlay pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(var(--app-grid-a)_1px,transparent_1px),linear-gradient(90deg,var(--app-grid-b)_1px,transparent_1px)] bg-[size:42px_42px] opacity-70" />
                        <div className="app-decorative-effect app-ambient-overlay pointer-events-none fixed inset-x-0 top-0 z-0 h-80 blur-2xl" style={{ background: 'var(--app-ambient)' }} />
                      </>
                    )}
                    <div className="relative z-10">
                      {standaloneMessenger ? <MessengerStandaloneRoutes /> : <AppRoutes />}
                    </div>
                  </div>
                </CallProvider>
              </BrowserRouter>
            </AppErrorBoundary>
          </MotionConfig>
        </PresenceProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
