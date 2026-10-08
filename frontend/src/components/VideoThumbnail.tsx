import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import useRenderDebug from '../hooks/useRenderDebug';

type VideoThumbnailProps = {
  src?: string;
  className?: string;
  videoClassName?: string;
  iconSize?: number;
  showOverlay?: boolean;
  rounded?: string;
  label?: string;
  preload?: string;
  onReady?: (event?: Event) => void;
};

const withPreviewTime = (src?: string): string => {
  if (!src) return '';
  if (src.includes('#')) return src;
  return `${src}#t=0.1`;
};

const isTouchMediaViewport = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches);
};

function VideoThumbnail({
  src,
  className = '',
  videoClassName = '',
  iconSize = 28,
  showOverlay = true,
  rounded = 'rounded-2xl',
  label = 'Video preview',
  preload = 'metadata',
  onReady,
}: VideoThumbnailProps) {
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const revealedRef = useRef(false);
  const loadFrameRef = useRef<number | null>(null);
  const pendingShouldLoadRef = useRef(false);
  const previewSrc = useMemo(() => withPreviewTime(src), [src]);
  const canUseIntersectionObserver = typeof window !== 'undefined' && 'IntersectionObserver' in window;
  const [shouldLoad, setShouldLoad] = useState(!canUseIntersectionObserver || !isTouchMediaViewport());

  useRenderDebug('VideoThumbnail', () => ({
    src: previewSrc,
    shouldLoad
  }));

  useEffect(() => {
    revealedRef.current = false;
    setShouldLoad(!canUseIntersectionObserver || !isTouchMediaViewport());
  }, [canUseIntersectionObserver, previewSrc]);

  useEffect(() => {
    if (!canUseIntersectionObserver || !wrapperRef.current) return undefined;

    const unloadOffscreen = isTouchMediaViewport();
    if (!unloadOffscreen && shouldLoad) return undefined;

    const observer = new IntersectionObserver((entries) => {
      const isNearViewport = entries.some(entry => entry.isIntersecting || entry.intersectionRatio > 0);
      pendingShouldLoadRef.current = isNearViewport;
      if (loadFrameRef.current) return;
      loadFrameRef.current = window.requestAnimationFrame(() => {
        loadFrameRef.current = null;
        setShouldLoad(previous => (
          unloadOffscreen ? pendingShouldLoadRef.current : previous || pendingShouldLoadRef.current
        ));
      });
    }, {
      rootMargin: unloadOffscreen ? '720px 0px' : '360px 0px'
    });

    observer.observe(wrapperRef.current);
    return () => {
      observer.disconnect();
      if (loadFrameRef.current) {
        window.cancelAnimationFrame(loadFrameRef.current);
        loadFrameRef.current = null;
      }
    };
  }, [canUseIntersectionObserver, previewSrc, shouldLoad]);

  useEffect(() => {
    if (shouldLoad) return;
    const video = videoRef.current;
    if (!video) return;
    try {
      video.pause?.();
      video.removeAttribute('src');
      video.load?.();
    } catch {
      // Some WebViews can throw while a video element is being detached.
    }
  }, [previewSrc, shouldLoad]);

  const revealFirstFrame = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    const video = videoRef.current;
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      try {
        video.currentTime = Math.min(0.12, Math.max(0, video.duration - 0.05));
      } catch {
        // Some mobile browsers block seeking before enough metadata is ready.
      }
    }
    onReady?.(event.nativeEvent);
  };

  return (
    <span ref={wrapperRef} className={`relative block overflow-hidden bg-black ${rounded} ${className}`}>
      <video
        ref={videoRef}
        src={shouldLoad ? previewSrc : undefined}
        muted
        playsInline
        preload={preload}
        controls={false}
        disablePictureInPicture
        tabIndex={-1}
        aria-label={label}
        onLoadedMetadata={revealFirstFrame}
        onLoadedData={revealFirstFrame}
        className={`pointer-events-none h-full w-full object-cover ${rounded} ${videoClassName}`}
      />
      {showOverlay && (
        <span className="absolute inset-0 grid place-items-center bg-black/12">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-gray-950 shadow-2xl backdrop-blur">
            <PlayCircle size={iconSize} fill="currentColor" />
          </span>
        </span>
      )}
    </span>
  );
}

export default memo(VideoThumbnail);
