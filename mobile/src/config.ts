import Constants from 'expo-constants';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

const extra = Constants.expoConfig?.extra || {};
const env = typeof process !== 'undefined' ? process.env || {} : {};

export const BACKEND_ORIGIN = String(
  env.EXPO_PUBLIC_BACKEND_ORIGIN || extra.backendOrigin || ''
).replace(/\/+$/, '');

export const API_BASE_URL = String(
  env.EXPO_PUBLIC_API_BASE_URL || extra.apiBaseUrl || (BACKEND_ORIGIN ? `${BACKEND_ORIGIN}/api` : '')
).replace(/\/+$/, '');

export const WEB_APP_ORIGIN = String(
  env.EXPO_PUBLIC_WEB_APP_ORIGIN || extra.webAppOrigin || ''
).replace(/\/+$/, '');
