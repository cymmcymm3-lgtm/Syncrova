const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const MEDIA_QUALITY_KEY = 'syncrova.media.quality';

type MediaVariantRecord = Record<string, string | { fileUrl?: string; url?: string }>;
type MediaAssetLike = string | {
  fileUrl?: string;
  url?: string;
  variants?: MediaVariantRecord;
  mediaVariants?: MediaVariantRecord;
};

type OptimizeOptions = {
  maxDimension?: number;
  quality?: number;
  minBytes?: number;
  useQualityPreference?: boolean;
};

export const isAbsoluteUrl = (value = ''): boolean => /^(https?:|data:|blob:)/i.test(value);

const isNativeShell = () => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.Capacitor?.isNativePlatform?.()) ||
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'ionic:';
};

const encodeObjectPath = (value = '') => String(value || '')
  .split('/')
  .map(part => encodeURIComponent(part))
  .join('/');

const getLegacySupabaseProxyPath = (url: URL): string => {
  const markers = [
    '/storage/v1/object/public/',
    '/storage/v1/object/sign/',
    '/storage/v1/object/'
  ];
  const marker = markers.find(item => url.pathname.includes(item));
  if (!marker) return '';

  try {
    const afterMarker = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
    const objectPath = afterMarker.split('/').slice(1).join('/');
    if (!objectPath || objectPath.includes('\0') || objectPath.split('/').some(part => part === '..')) return '';
    return `/uploads/r2/${encodeObjectPath(objectPath)}`;
  } catch {
    return '';
  }
};

export const getBackendOrigin = (): string => {
  const configured = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_ORIGIN || '';
  if (configured) return configured.replace(/\/+$/, '');

  // Local Vite requests use its development proxy. Hosted and native builds must
  // set VITE_BACKEND_URL so REST, media, and Socket.IO use the same Render API.
  return '';
};

export const resolveMediaUrl = (value: string): string => {
  if (!value) return '';
  if (isAbsoluteUrl(value)) {
    try {
      const url = new URL(value);
      const legacySupabaseProxyPath = getLegacySupabaseProxyPath(url);
      if (legacySupabaseProxyPath) {
        return `${getBackendOrigin()}${legacySupabaseProxyPath}`;
      }
      if (url.pathname.startsWith('/uploads')) {
        const backendOrigin = getBackendOrigin();
        if (backendOrigin && (isNativeShell() || LOCAL_HOSTS.has(url.hostname))) {
          return `${backendOrigin}${url.pathname}`;
        }
      }
    } catch {
      return value;
    }
    return value;
  }

  const path = value.startsWith('/') ? value : `/${value}`;

  if (path.startsWith('/uploads')) {
    return `${getBackendOrigin()}${path}`;
  }

  return path;
};

const getMediaQualityPreference = (): 'balanced' | 'high' | 'original' => {
  if (typeof window === 'undefined') return 'balanced';
  try {
    const value = window.localStorage.getItem(MEDIA_QUALITY_KEY) || '';
    if (value === 'balanced' || value === 'high' || value === 'original') return value;
    return 'balanced';
  } catch {
    return 'balanced';
  }
};

export const resolveMediaVariantUrl = (
  asset: MediaAssetLike = {},
  preferred: string[] = ['feed', 'large', 'thumb'],
): string => {
  if (!asset) return '';
  if (typeof asset === 'string') return resolveMediaUrl(asset);

  const preference = getMediaQualityPreference();
  if (preference === 'original') return resolveMediaUrl(asset.fileUrl || asset.url || '');

  const variants = asset.variants || asset.mediaVariants || {};
  const preferredKeys = preference === 'high'
    ? [...new Set(['large', ...preferred, 'feed', 'thumb'])]
    : [...new Set([...preferred, 'feed', 'large', 'thumb'])];

  for (const key of preferredKeys) {
    const variant = variants[key];
    const variantUrl = typeof variant === 'string' ? variant : (variant?.fileUrl || variant?.url);
    if (variantUrl) return resolveMediaUrl(variantUrl);
  }

  return resolveMediaUrl(asset.fileUrl || asset.url || '');
};

const resolveImageOptimizationOptions = (options: OptimizeOptions = {}) => {
  const explicitMaxDimension = Object.prototype.hasOwnProperty.call(options, 'maxDimension');
  const explicitQuality = Object.prototype.hasOwnProperty.call(options, 'quality');
  const explicitMinBytes = Object.prototype.hasOwnProperty.call(options, 'minBytes');
  const preference = options.useQualityPreference === false ? 'balanced' : getMediaQualityPreference();

  if (preference === 'original') {
    return { skip: true };
  }

  let maxDimension = explicitMaxDimension ? options.maxDimension : 1600;
  let quality = explicitQuality ? options.quality : 0.82;
  let minBytes = explicitMinBytes ? options.minBytes : 900 * 1024;

  if (preference === 'high') {
    if (!explicitMaxDimension) maxDimension = 2048;
    if (!explicitQuality) quality = 0.88;
    if (!explicitMinBytes) minBytes = 650 * 1024;
  } else if (!explicitQuality) {
    quality = 0.84;
  }

  return { maxDimension, quality, minBytes };
};

export const optimizeImageFile = async (file: File, options: OptimizeOptions = {}): Promise<File> => {
  const { skip, maxDimension, quality, minBytes } = resolveImageOptimizationOptions(options);

  if (
    skip ||
    typeof window === 'undefined' ||
    !file?.type?.startsWith('image/') ||
    file.size < minBytes ||
    file.type === 'image/gif' ||
    file.type === 'image/svg+xml'
  ) {
    return file;
  }

  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageUrl;
    });

    const ratio = Math.min(1, maxDimension / Math.max(image.width, image.height));
    if (ratio >= 1 && file.size < minBytes * 1.5) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext('2d', { alpha: file.type === 'image/png' });
    if (!context) return file;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, quality));
    if (!blob || blob.size >= file.size * 0.96) return file;

    return new File([blob], file.name, {
      type: outputType,
      lastModified: Date.now()
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};
