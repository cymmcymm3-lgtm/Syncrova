import { Capacitor, registerPlugin } from '@capacitor/core';

type NativeMediaAsset = {
  id?: string;
  uri?: string;
  contentUri?: string;
  webPath?: string;
  thumbnailWebPath?: string;
  thumbnailUri?: string;
  posterUri?: string;
  name?: string;
  displayName?: string;
  mimeType?: string;
  type?: 'image' | 'video' | string;
  size?: number;
  duration?: number;
  dateAdded?: number;
  dateModified?: number;
  width?: number;
  height?: number;
};

type SyncrovaMediaLibraryPlugin = {
  checkMediaPermissions: () => Promise<{ permission: string }>;
  requestMediaPermissions: () => Promise<{ permission: string }>;
  listMedia: (options: { filter: string; limit: number; offset: number }) => Promise<{ permission?: string; assets?: NativeMediaAsset[] }>;
  copyMediaToCache: (options: { uri: string; name: string; mimeType: string; type: 'image' | 'video' }) => Promise<Partial<NativeMediaAsset>>;
};

const SyncrovaMediaLibrary = registerPlugin<SyncrovaMediaLibraryPlugin>('SyncrovaMediaLibrary');

const getPlatform = (): string => {
  if (typeof window === 'undefined') return 'web';
  return window.Capacitor?.getPlatform?.() || Capacitor.getPlatform?.() || 'web';
};

export const isNativeMediaLibraryAvailable = () => (
  getPlatform() === 'android'
  && Boolean(Capacitor.isPluginAvailable?.('SyncrovaMediaLibrary'))
);

export const getNativeMediaWebPath = (asset: NativeMediaAsset = {}): string => {
  const uri = asset.webPath || asset.uri || asset.contentUri || '';
  if (!uri) return '';
  return Capacitor.convertFileSrc ? Capacitor.convertFileSrc(uri) : uri;
};

export const getNativeMediaThumbnailWebPath = (asset: NativeMediaAsset = {}): string => {
  const uri = asset.thumbnailWebPath || asset.thumbnailUri || asset.posterUri || '';
  if (!uri) return '';
  return Capacitor.convertFileSrc ? Capacitor.convertFileSrc(uri) : uri;
};

const normalizeAsset = (asset: NativeMediaAsset = {}) => ({
  id: String(asset.id || asset.uri || ''),
  uri: asset.uri || asset.contentUri || '',
  webPath: getNativeMediaWebPath(asset),
  thumbnailWebPath: getNativeMediaThumbnailWebPath(asset),
  name: asset.name || asset.displayName || 'Syncrova media',
  mimeType: asset.mimeType || '',
  type: asset.type === 'video' ? 'video' : 'image',
  size: Number(asset.size || 0),
  duration: Number(asset.duration || 0),
  dateAdded: Number(asset.dateAdded || 0),
  dateModified: Number(asset.dateModified || asset.dateAdded || 0),
  width: Number(asset.width || 0),
  height: Number(asset.height || 0)
});

export const checkNativeMediaPermission = async () => {
  if (!isNativeMediaLibraryAvailable()) return { permission: 'unavailable' };
  return SyncrovaMediaLibrary.checkMediaPermissions();
};

export const requestNativeMediaPermission = async () => {
  if (!isNativeMediaLibraryAvailable()) return { permission: 'unavailable' };
  return SyncrovaMediaLibrary.requestMediaPermissions();
};

export const listNativeMedia = async (
  { filter = 'all', limit = 90, offset = 0 }: { filter?: string; limit?: number; offset?: number } = {},
) => {
  if (!isNativeMediaLibraryAvailable()) {
    return { permission: 'unavailable', assets: [] };
  }

  const result = await SyncrovaMediaLibrary.listMedia({
    filter,
    limit,
    offset
  });

  return {
    permission: result?.permission || 'prompt',
    assets: Array.isArray(result?.assets) ? result.assets.map(normalizeAsset).filter(asset => asset.id && asset.uri) : []
  };
};

const getExtensionFromMime = (mimeType = '', fallbackType: 'image' | 'video' = 'image'): string => {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('heic')) return 'heic';
  if (mimeType.includes('quicktime')) return 'mov';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('video')) return 'mp4';
  return fallbackType === 'video' ? 'mp4' : 'jpg';
};

const safeFileName = (name = '', mimeType = '', type: 'image' | 'video' = 'image'): string => {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|]+/g, '-').trim();
  if (cleaned && /\.[a-z0-9]{2,5}$/i.test(cleaned)) return cleaned;
  const extension = getExtensionFromMime(mimeType, type);
  return `${cleaned || `syncrova-${type}`}.${extension}`;
};

const prepareNativeMediaForRead = async (asset: NativeMediaAsset = {}): Promise<NativeMediaAsset> => {
  if (!isNativeMediaLibraryAvailable() || !String(asset.uri || '').startsWith('content://')) {
    return asset;
  }

  const copied = await SyncrovaMediaLibrary.copyMediaToCache({
    uri: asset.uri,
    name: asset.name || asset.displayName || '',
    mimeType: asset.mimeType || '',
    type: asset.type === 'video' ? 'video' : 'image'
  });

  const nextAsset = {
    ...asset,
    ...copied,
    uri: copied?.uri || asset.uri,
    webPath: getNativeMediaWebPath(copied || asset)
  };

  return nextAsset;
};

export const nativeMediaAssetToFile = async (asset: NativeMediaAsset = {}): Promise<File> => {
  const readableAsset = await prepareNativeMediaForRead(asset);
  const source = getNativeMediaWebPath(readableAsset);
  if (!source) throw new Error('Media source is unavailable');

  const response = await fetch(source);
  if (!response.ok) throw new Error('Could not read selected media');

  const blob = await response.blob();
  if (!blob.size) throw new Error('Selected media is empty');

  const mimeType = readableAsset.mimeType || blob.type || (readableAsset.type === 'video' ? 'video/mp4' : 'image/jpeg');
  const lastModified = Number(readableAsset.dateModified || readableAsset.dateAdded || 0) > 0
    ? Number(readableAsset.dateModified || readableAsset.dateAdded) * 1000
    : Date.now();

  return new File([blob], safeFileName(readableAsset.name, mimeType, readableAsset.type === 'video' ? 'video' : 'image'), {
    type: mimeType,
    lastModified
  });
};
