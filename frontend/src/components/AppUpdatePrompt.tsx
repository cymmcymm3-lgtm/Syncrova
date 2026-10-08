import React, { useEffect, useMemo, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Download, Loader2, RefreshCw, X } from 'lucide-react';
import { getBackendOrigin } from '../utils/media';
import { RELEASE_ANDROID_VERSION_CODE } from '../generated/releaseInfo';

const FALLBACK_ANDROID_VERSION_CODE = Number(import.meta.env.VITE_ANDROID_VERSION_CODE || RELEASE_ANDROID_VERSION_CODE);
const CHECK_SCHEDULE_MS = [1200, 8000, 30000, 90000];
const CHECK_TIMEOUT_MS = 18000;
type SyncrovaNativeBridgePlugin = {
  openExternalUrl?: (payload: { url: string }) => Promise<void>;
};

type UpdatePayload = {
  versionCode: number;
  versionName: string;
  notes: string;
  required: boolean;
  apkUrl: string;
  downloadPageUrl: string;
  externalDownload: boolean;
  apkSize: number;
  apkSha256: string;
};

const SyncrovaNativeBridge = registerPlugin<SyncrovaNativeBridgePlugin>('SyncrovaNativeBridge');

const isNativeAndroid = () => {
  if (typeof window === 'undefined') return false;
  const importedPlatform = Capacitor?.getPlatform?.();
  if (importedPlatform) return importedPlatform === 'android';
  const capacitor = window.Capacitor;
  const platform = capacitor?.getPlatform?.();
  if (platform) return platform === 'android';
  return Boolean(Capacitor?.isNativePlatform?.() || capacitor?.isNativePlatform?.()) && /android/i.test(navigator.userAgent || '');
};

const getCurrentAndroidVersionCode = async (): Promise<number> => {
  try {
    if (isNativeAndroid()) {
      const info = await CapacitorApp.getInfo();
      const nativeBuild = Number(info?.build);
      if (Number.isFinite(nativeBuild) && nativeBuild > 0) return nativeBuild;
    }
  } catch {
    // Old APKs should still compare against the bundled generated version.
  }

  return FALLBACK_ANDROID_VERSION_CODE;
};

const getUpdateEndpoint = (): string => {
  const configured = import.meta.env.VITE_APP_UPDATE_URL || '';
  if (configured) return configured;
  const backendOrigin = getBackendOrigin();
  return `${backendOrigin || ''}/api/app/update`;
};

const formatBytes = (bytes = 0) => {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
};

const openExternalUrl = async (url: string): Promise<void> => {
  if (!url) return;

  if (isNativeAndroid() && SyncrovaNativeBridge?.openExternalUrl) {
    await SyncrovaNativeBridge.openExternalUrl({ url });
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
};

export default function AppUpdatePrompt() {
  const [update, setUpdate] = useState<UpdatePayload | null>(null);
  const [hidden, setHidden] = useState(false);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState('');

  const dismissKey = useMemo(() => (
    update?.versionCode ? `syncrova-update-dismissed-${update.versionCode}` : ''
  ), [update?.versionCode]);

  useEffect(() => {
    if (!isNativeAndroid()) return undefined;

    let cancelled = false;
    const timers: number[] = [];
    let appStateHandle: { remove?: () => void } | null = null;

    const checkForUpdate = async () => {
      if (cancelled || !isNativeAndroid()) return;
      setChecking(true);
      let timeout: number | null = null;
      try {
        const controller = new AbortController();
        timeout = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
        const endpoint = getUpdateEndpoint();
        const separator = endpoint.includes('?') ? '&' : '?';
        const response = await fetch(`${endpoint}${separator}t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
          signal: controller.signal
        });
        if (!response.ok) return;
        const payload = await response.json();
        const nextVersionCode = Number(payload?.versionCode || 0);
        const currentVersionCode = await getCurrentAndroidVersionCode();
        const apkUrl = String(payload?.apkUrl || '');
        const downloadPageUrl = String(payload?.downloadPageUrl || '');
        const updateUrl = downloadPageUrl || apkUrl;
        const required = Boolean(payload?.required);
        const dismissed = localStorage.getItem(`syncrova-update-dismissed-${nextVersionCode}`) === '1';

        if (
          !cancelled &&
          payload?.available !== false &&
          updateUrl &&
          nextVersionCode > currentVersionCode &&
          (required || !dismissed)
        ) {
          setHidden(false);
          setUpdate({
            versionCode: nextVersionCode,
            versionName: payload.versionName || `v${nextVersionCode}`,
            notes: payload.notes || 'New Syncrova update is ready.',
            required,
            apkUrl: updateUrl,
            downloadPageUrl,
            externalDownload: Boolean(payload?.externalDownload || downloadPageUrl),
            apkSize: Number(payload.apkSize || 0),
            apkSha256: String(payload.apkSha256 || '')
          });
        }
      } catch {
        // Update checks should never interrupt login or app usage.
      } finally {
        if (timeout) window.clearTimeout(timeout);
        if (!cancelled) setChecking(false);
      }
    };

    CHECK_SCHEDULE_MS.forEach(delay => {
      timers.push(window.setTimeout(checkForUpdate, delay));
    });

    const onOnline = () => checkForUpdate();
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) checkForUpdate();
    }).then(handle => {
      appStateHandle = handle;
    }).catch(() => {});

    return () => {
      cancelled = true;
      timers.forEach(timer => window.clearTimeout(timer));
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      appStateHandle?.remove?.();
    };
  }, []);

  if (!update || hidden) return null;

  const dismiss = () => {
    if (dismissKey && !update.required) localStorage.setItem(dismissKey, '1');
    setHidden(true);
  };

  const downloadUpdate = async () => {
    setChecking(true);
    setDownloading(true);
    setDownloadMessage('');

    try {
      const downloadUrl = update.downloadPageUrl || update.apkUrl;
      if (!downloadUrl) {
        setDownloadMessage('Download page is not available yet.');
        setDownloading(false);
        return;
      }

      await openExternalUrl(downloadUrl);
      setDownloadMessage(update.externalDownload ? 'Opening the MediaFire download page in your browser.' : 'Opening the APK download in your browser.');
      setDownloading(false);
      } catch (err) {
      setDownloadMessage((err as Error)?.message || 'Could not open the download page.');
      setDownloading(false);
    } finally {
      setChecking(false);
    }
  };

  const noteItems = String(update.notes || '')
    .split(/\n|\|/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 5);
  const apkSizeLabel = formatBytes(update.apkSize);
  const downloadTargetLabel = update.externalDownload ? 'download page' : 'APK download';
  const deliveryCopy = update.externalDownload
    ? 'This opens the official MediaFire page only; Syncrova will not install an APK inside the app.'
    : 'This opens the APK download in your browser; Syncrova will not install it inside the app.';

  const card = (
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#111827]/95 text-white shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="flex items-start gap-3 p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#1877f2] text-white shadow-lg shadow-blue-500/20">
            <RefreshCw size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black">{update.required ? 'Syncrova update required' : 'New Syncrova update available'}</p>
            <p className="mt-1 text-xs font-semibold text-white/70">
              Version {update.versionName} is ready{apkSizeLabel ? ` - ${apkSizeLabel}` : ''}. {deliveryCopy}
            </p>
            {noteItems.length > 0 && (
              <div className="mt-2 rounded-2xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/80">
                <p className="mb-1 font-black text-white">What's new</p>
                <ul className="space-y-1">
                  {noteItems.map(item => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-300" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {downloadMessage && (
              <p className="mt-2 rounded-2xl bg-blue-500/15 px-3 py-2 text-xs font-semibold text-blue-100">
                <span className="inline-flex items-center gap-2">
                  {downloading && <Loader2 size={13} className="animate-spin" />}
                  {downloadMessage}
                </span>
              </p>
            )}
          </div>
          {!update.required && (
            <button
              type="button"
              onClick={dismiss}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label="Dismiss update"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <div className="flex gap-2 border-t border-white/10 p-3">
          {!update.required && (
            <button
              type="button"
              onClick={dismiss}
              className="h-11 flex-1 rounded-2xl bg-white/10 px-4 text-sm font-black text-white transition hover:bg-white/20"
            >
              Later
            </button>
          )}
          <button
            type="button"
            onClick={downloadUpdate}
            disabled={checking || downloading}
            className="h-11 flex-[1.5] rounded-2xl bg-[#1877f2] px-4 text-sm font-black text-white transition hover:bg-[#0f63d5] disabled:opacity-60"
          >
            <span className="inline-flex items-center justify-center gap-2">
              {downloading ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
              {downloading ? 'Opening...' : checking ? 'Preparing...' : `Open ${downloadTargetLabel}`}
            </span>
          </button>
        </div>
      </div>
  );

  if (update.required) {
    return (
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md">
          {card}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-3 bottom-4 z-[120] mx-auto max-w-md sm:bottom-5">
      {card}
    </div>
  );
}
