import axios, { AxiosError } from 'axios';
import { API_BASE_URL } from '../config';

let tokenGetter: () => Promise<string | null> = async () => null;
let unauthorizedHandler: (() => void) | null = null;

export const setApiTokenGetter = (getter: () => Promise<string | null>) => {
  tokenGetter = getter;
};

export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  unauthorizedHandler = handler;
};

export const getApiToken = () => tokenGetter();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 25000
});

api.interceptors.request.use(async config => {
  const token = await tokenGetter();
  if (token) {
    config.headers.set?.('x-auth-token', token);
    if (!config.headers.get?.('x-auth-token')) {
      config.headers['x-auth-token'] = token;
    }
  }

  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.headers.delete?.('Content-Type');
    delete config.headers['Content-Type'];
    delete config.headers['content-type'];
  }

  return config;
});

api.interceptors.response.use(
  response => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) unauthorizedHandler?.();
    return Promise.reject(error);
  }
);

export default api;
