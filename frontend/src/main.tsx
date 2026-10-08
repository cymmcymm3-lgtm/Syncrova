import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
import './social-layout.css';

// Capacitor exposes a global at runtime. Keep this minimal — full typings
// can be introduced when we migrate native-bridge code.
declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}

const isNativeShell = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.Capacitor?.isNativePlatform?.()) ||
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'ionic:';
};

const clearNativeShellCaches = async (): Promise<void> => {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }
  } catch {
    // Cache cleanup is best-effort; app startup should stay fast and reliable.
  }
};

const startApp = (): void => {
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    throw new Error('Root element #root not found in document.');
  }
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

if (isNativeShell()) {
  clearNativeShellCaches().finally(startApp);
} else {
  let updateWebApp: (reloadPage?: boolean) => Promise<void> = async () => {
    window.location.reload();
  };

  updateWebApp = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent('syncrova:web-update-ready'));
    },
  });

  window.addEventListener('syncrova:apply-web-update', () => {
    void updateWebApp(true);
  });
  startApp();
}
