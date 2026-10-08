type NativeBridgeStatus = {
  supported: boolean;
  enabled: boolean;
  canDrawOverlays: boolean;
};

type NativeBridgeOpenResult = {
  supported: boolean;
  installed: boolean;
  opened: boolean;
};

type SyncrovaNativeBridge = {
  getChatHeadsStatus?: () => Promise<Partial<NativeBridgeStatus>>;
  setChatHeadsEnabled?: (payload: { enabled: boolean }) => Promise<Partial<NativeBridgeStatus>>;
  openChatHeadSettings?: () => Promise<Partial<NativeBridgeStatus>>;
  openMainApp?: (payload: { path: string }) => Promise<Partial<NativeBridgeOpenResult>>;
};

let nativeBridgePromise: Promise<SyncrovaNativeBridge | null> | null = null;

const defaultStatus: NativeBridgeStatus = {
  supported: false,
  enabled: false,
  canDrawOverlays: false
};

export const isNativeAndroid = () => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.Capacitor?.isNativePlatform?.()) && window.Capacitor?.getPlatform?.() === 'android';
};

const getNativeBridge = async (): Promise<SyncrovaNativeBridge | null> => {
  if (!nativeBridgePromise) {
    nativeBridgePromise = import('@capacitor/core')
      .then(({ registerPlugin }) => registerPlugin<SyncrovaNativeBridge>('SyncrovaNativeBridge'))
      .catch(() => null);
  }
  return nativeBridgePromise;
};

const normalizeStatus = (status: Partial<NativeBridgeStatus> = {}): NativeBridgeStatus => ({
  supported: Boolean(status.supported),
  enabled: Boolean(status.enabled),
  canDrawOverlays: Boolean(status.canDrawOverlays)
});

const normalizeOpenResult = (result: Partial<NativeBridgeOpenResult> = {}): NativeBridgeOpenResult => ({
  supported: true,
  installed: Boolean(result.installed),
  opened: Boolean(result.opened)
});

export const getChatHeadsStatus = async (): Promise<NativeBridgeStatus> => {
  if (!isNativeAndroid()) return defaultStatus;

  try {
    const bridge = await getNativeBridge();
    if (!bridge?.getChatHeadsStatus) return defaultStatus;
    return normalizeStatus(await bridge.getChatHeadsStatus());
  } catch {
    return defaultStatus;
  }
};

export const setChatHeadsEnabled = async (enabled: boolean): Promise<NativeBridgeStatus> => {
  if (!isNativeAndroid()) return defaultStatus;

  try {
    const bridge = await getNativeBridge();
    if (!bridge?.setChatHeadsEnabled) return defaultStatus;
    return normalizeStatus(await bridge.setChatHeadsEnabled({ enabled: Boolean(enabled) }));
  } catch {
    return defaultStatus;
  }
};

export const openChatHeadSettings = async (): Promise<NativeBridgeStatus> => {
  if (!isNativeAndroid()) return defaultStatus;

  try {
    const bridge = await getNativeBridge();
    if (!bridge?.openChatHeadSettings) return defaultStatus;
    return normalizeStatus(await bridge.openChatHeadSettings());
  } catch {
    return defaultStatus;
  }
};

export const openMainApp = async (path = '/'): Promise<NativeBridgeOpenResult> => {
  if (!isNativeAndroid()) {
    if (typeof window !== 'undefined') window.location.assign(path || '/');
    return { supported: false, installed: false, opened: true };
  }

  try {
    const bridge = await getNativeBridge();
    if (!bridge?.openMainApp) return { supported: true, installed: false, opened: false };
    return normalizeOpenResult(await bridge.openMainApp({ path: path || '/' }));
  } catch {
    return { supported: true, installed: false, opened: false };
  }
};
