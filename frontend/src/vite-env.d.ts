/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Virtual module published by vite-plugin-pwa.
declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}

// Allow importing static assets without TS complaining.
declare module '*.mp3';
declare module '*.png';
declare module '*.webp';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.svg';

// Loose typing for Capacitor window globals used across the app.
declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
    __SYNCROVA_MESSENGER_APP__?: boolean;
  }

  interface Navigator {
    standalone?: boolean;
  }
}

export {};
