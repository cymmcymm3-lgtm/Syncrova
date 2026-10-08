import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Check, ChevronDown, Image as ImageIcon, Loader2, PlayCircle, RefreshCw, Video, X } from 'lucide-react';
import {
  listNativeMedia,
  requestNativeMediaPermission
} from '../utils/nativeMediaLibrary';
import VideoThumbnail from './VideoThumbnail';

const PAGE_SIZE = 30;
const INITIAL_RENDER_COUNT = 18;
const RENDER_CHUNK_SIZE = 12;

const FILTERS = [
  { id: 'all', label: 'All photos', icon: ImageIcon },
  { id: 'image', label: 'Images', icon: ImageIcon },
  { id: 'video', label: 'Videos', icon: Video }
];

const formatNativeMediaDuration = (duration = 0) => {
  const rawSeconds = Number(duration || 0) > 999 ? Number(duration || 0) / 1000 : Number(duration || 0);
  const totalSeconds = Math.max(0, Math.round(rawSeconds));
  if (!totalSeconds) return '';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

function NativeMediaVideoPreview({ asset }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const thumbnailSrc = thumbnailFailed ? '' : asset.thumbnailWebPath;
  const durationLabel = formatNativeMediaDuration(asset.duration);

  return (
    <span className="native-media-video-preview">
      {thumbnailSrc ? (
        <img src={thumbnailSrc} alt="" loading="lazy" decoding="async" draggable="false" onError={() => setThumbnailFailed(true)} />
      ) : asset.webPath ? (
        <VideoThumbnail
          src={asset.webPath}
          className="h-full w-full"
          rounded="rounded-none"
          iconSize={20}
          showOverlay={false}
          preload="metadata"
          label={asset.name || 'Video preview'}
        />
      ) : (
        <span className="native-media-video-placeholder">
          <Video size={24} />
        </span>
      )}
      <span className="native-media-play"><PlayCircle size={20} /></span>
      {durationLabel && <span className="native-media-duration">{durationLabel}</span>}
    </span>
  );
}

function NativeMediaImagePreview({ asset }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const source = previewFailed ? '' : asset.webPath;

  if (!source) {
    return (
      <span className="native-media-image-placeholder">
        <ImageIcon size={24} />
      </span>
    );
  }

  return (
    <img
      src={source}
      alt=""
      loading="lazy"
      decoding="async"
      draggable="false"
      onError={() => setPreviewFailed(true)}
    />
  );
}

type NativeMediaTileProps = {
  asset: {
    id?: string;
    name?: string;
    type?: string;
    webPath?: string;
    thumbnailWebPath?: string;
    duration?: number;
  };
  selectedIndex: number;
  onToggle: (asset: NativeMediaTileProps['asset']) => void;
};

const NativeMediaTile = memo(function NativeMediaTile({ asset, selectedIndex, onToggle }: NativeMediaTileProps) {
  const isSelected = selectedIndex >= 0;

  const handleClick = useCallback(() => {
    onToggle(asset);
  }, [asset, onToggle]);

  return (
    <button
      type="button"
      className={`native-media-tile ${isSelected ? 'native-media-tile--selected' : ''}`}
      onClick={handleClick}
      aria-label={`Select ${asset.name}`}
    >
      {asset.type === 'video' ? (
        <NativeMediaVideoPreview asset={asset} />
      ) : (
        <NativeMediaImagePreview asset={asset} />
      )}
      <span className="native-media-check">
        {isSelected ? selectedIndex + 1 : null}
      </span>
    </button>
  );
});

export default function NativeMediaLibrarySheet({
  open,
  initialFilter = 'all',
  maxSelection = 10,
  existingCount = 0,
  title = 'All photos',
  confirmLabel = 'Send',
  onClose,
  onSelect
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [permission, setPermission] = useState('prompt');
  const [assets, setAssets] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [visibleAssetCount, setVisibleAssetCount] = useState(INITIAL_RENDER_COUNT);

  const availableSlots = Math.max(0, maxSelection - existingCount);
  const activeFilter = FILTERS.find(item => item.id === filter) || FILTERS[0];
  const selectedAssets = useMemo(
    () => selectedIds.map(id => assets.find(asset => asset.id === id)).filter(Boolean),
    [assets, selectedIds]
  );
  const visibleAssets = useMemo(
    () => assets.slice(0, Math.min(visibleAssetCount, assets.length)),
    [assets, visibleAssetCount]
  );

  const loadMedia = async ({ reset = false, nextFilter = filter } = {}) => {
    setLoading(true);
    setError('');
    if (reset) setVisibleAssetCount(INITIAL_RENDER_COUNT);
    try {
      const nextOffset = reset ? 0 : assets.length;
      const result = await listNativeMedia({
        filter: nextFilter,
        limit: PAGE_SIZE,
        offset: nextOffset
      });
      setPermission(result.permission || 'prompt');
      setAssets(prev => (reset ? result.assets : [...prev, ...result.assets]));
      setHasMore(result.assets.length >= PAGE_SIZE);
    } catch (err) {
      setError(err?.message || 'Could not load media');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setFilter(initialFilter);
    setAssets([]);
    setSelectedIds([]);
    setHasMore(false);
    setError('');
    loadMedia({ reset: true, nextFilter: initialFilter });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFilter]);

  useEffect(() => {
    if (!open || visibleAssetCount >= assets.length) return undefined;

    const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 32));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const handle = schedule(() => {
      setVisibleAssetCount(count => Math.min(assets.length, count + RENDER_CHUNK_SIZE));
    });

    return () => cancel(handle);
  }, [assets.length, open, visibleAssetCount]);

  const changeFilter = (nextFilter) => {
    setFilter(nextFilter);
    setSelectedIds([]);
    setAssets([]);
    setHasMore(false);
    setVisibleAssetCount(INITIAL_RENDER_COUNT);
    loadMedia({ reset: true, nextFilter });
  };

  const requestAccess = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await requestNativeMediaPermission();
      setPermission(result?.permission || 'prompt');
      await loadMedia({ reset: true });
    } catch (err) {
      setError(err?.message || 'Media permission was not granted');
    } finally {
      setLoading(false);
    }
  };

  const toggleAsset = useCallback((asset) => {
    setSelectedIds(prev => {
      if (prev.includes(asset.id)) return prev.filter(id => id !== asset.id);
      if (prev.length >= availableSlots) {
        toast.error(`You can select up to ${maxSelection} photos or videos`);
        return prev;
      }
      return [...prev, asset.id];
    });
  }, [availableSlots, maxSelection]);

  const finishSelection = async () => {
    if (!selectedAssets.length || preparing) return;
    setPreparing(true);
    try {
      await onSelect?.(selectedAssets);
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'Could not prepare selected media');
    } finally {
      setPreparing(false);
    }
  };

  const permissionBlocked = permission !== 'granted';

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="native-media-overlay messenger-motion-zone" onClick={onClose}>
      <section className="native-media-sheet" onClick={event => event.stopPropagation()} aria-label={title}>
        <header className="native-media-header">
          <div className="native-media-title">
            <span>{activeFilter.label}</span>
            <ChevronDown size={18} />
          </div>
          <div className="native-media-header-actions">
            <span className="native-media-count">{selectedIds.length}/{availableSlots}</span>
            <button type="button" className="native-media-icon-button" onClick={() => loadMedia({ reset: true })} aria-label="Refresh media">
              <RefreshCw size={18} />
            </button>
            <button type="button" className="native-media-icon-button" onClick={onClose} aria-label="Close media library">
              <X size={19} />
            </button>
          </div>
        </header>

        <div className="native-media-filters" role="tablist" aria-label="Media filters">
          {FILTERS.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`native-media-filter ${filter === item.id ? 'native-media-filter--active' : ''}`}
                onClick={() => changeFilter(item.id)}
              >
                <Icon size={17} />
                {item.label.replace('All photos', 'All')}
              </button>
            );
          })}
        </div>

        {permissionBlocked ? (
          <div className="native-media-empty">
            <ImageIcon size={34} />
            <p className="native-media-empty-title">Allow photo and video access</p>
            <p className="native-media-empty-copy">Syncrova needs Android media permission to show your gallery inside the chat.</p>
            <button type="button" className="native-media-primary" onClick={requestAccess} disabled={loading}>
              {loading ? <Loader2 size={17} className="animate-spin" /> : <ImageIcon size={17} />}
              Allow access
            </button>
          </div>
        ) : (
          <>
            {error && <p className="native-media-error">{error}</p>}
            <div className="native-media-grid">
              {visibleAssets.map(asset => {
                const selectedIndex = selectedIds.indexOf(asset.id);
                return (
                  <NativeMediaTile
                    key={asset.id}
                    asset={asset}
                    selectedIndex={selectedIndex}
                    onToggle={toggleAsset}
                  />
                );
              })}
              {loading && (
                <div className="native-media-loading">
                  <Loader2 size={24} className="animate-spin" />
                </div>
              )}
            </div>
            {!loading && assets.length === 0 && (
              <div className="native-media-empty native-media-empty--compact">
                <ImageIcon size={30} />
                <p className="native-media-empty-title">No media found</p>
              </div>
            )}
            {hasMore && !loading && (
              <button type="button" className="native-media-load-more" onClick={() => loadMedia()}>
                Load more
              </button>
            )}
          </>
        )}

        <footer className="native-media-footer">
          <button type="button" className="native-media-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="native-media-primary"
            onClick={finishSelection}
            disabled={!selectedAssets.length || preparing}
          >
            {preparing ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
            {confirmLabel}{selectedAssets.length ? ` ${selectedAssets.length}` : ''}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
