import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getBackendOrigin } from '../utils/media';

const backendOrigin = getBackendOrigin();
const apiBaseUrl = backendOrigin ? `${backendOrigin}/api` : '/api';
const DEFAULT_API_TIMEOUT_MS = 30_000;
const MAX_API_TIMEOUT_MS = 120_000;

const getApiTimeout = (): number => {
  const configuredTimeout = Number(import.meta.env.VITE_API_TIMEOUT_MS);

  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    return DEFAULT_API_TIMEOUT_MS;
  }

  return Math.min(Math.round(configuredTimeout), MAX_API_TIMEOUT_MS);
};

const api: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  // Individual requests can still provide their own timeout where needed.
  timeout: getApiTimeout()
});

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('token');

    if (token && config.headers) {
      // Axios v1 typings allow string-indexed header access on AxiosHeaders.
      (config.headers as Record<string, unknown>)['x-auth-token'] = token;
    }

    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      const headers = config.headers as
        | (Record<string, unknown> & { delete?: (key: string) => void })
        | undefined;

      if (typeof headers?.delete === 'function') {
        headers.delete('Content-Type');
      } else if (headers) {
        delete headers['Content-Type'];
        delete headers['content-type'];
      }
    }

    return config;
  },
  error => Promise.reject(error)
);

api.interceptors.response.use(
  response => response,
  error => {
    if (error?.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);

export default api;
