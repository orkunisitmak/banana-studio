import React, { useEffect, useRef, useState } from 'react';
import { getVideoPreviewSrc } from './videoPreview';

export const LazyVideoPreview: React.FC<{
  src: string;
  poster?: string;
  onLoadedMetadata?: (video: HTMLVideoElement) => void;
  onError?: () => void;
}> = ({ src, poster, onLoadedMetadata, onError }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [posterState, setPosterState] = useState<'missing' | 'loading' | 'ready' | 'failed'>(
    poster ? 'loading' : 'missing'
  );
  const [videoFrameReady, setVideoFrameReady] = useState(false);

  useEffect(() => {
    setPosterState(poster ? 'loading' : 'missing');
    setVideoFrameReady(false);
  }, [poster, src]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || shouldLoad) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '350px' });

    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    const video = videoRef.current;
    if (!shouldLoad || !video) return;

    let cancelled = false;
    let seekHandler: (() => void) | undefined;

    const revealCurrentFrame = () => {
      if (cancelled || !video.videoWidth || !video.videoHeight) return;
      setVideoFrameReady(true);
    };

    const prepareFirstFrame = () => {
      if (cancelled) return;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const targetTime = duration > 0.2
        ? Math.min(1, Math.max(0.1, duration * 0.1))
        : 0;

      if (targetTime > 0 && Math.abs(video.currentTime - targetTime) > 0.02) {
        seekHandler = revealCurrentFrame;
        video.addEventListener('seeked', seekHandler, { once: true });
        try {
          video.currentTime = targetTime;
        } catch {
          video.removeEventListener('seeked', seekHandler);
          seekHandler = undefined;
          revealCurrentFrame();
        }
      } else {
        revealCurrentFrame();
      }
    };

    video.muted = true;
    video.preload = 'auto';
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) prepareFirstFrame();
    else {
      video.addEventListener('loadeddata', prepareFirstFrame, { once: true });
      // Changing preload after a poster failure is not enough in every mobile
      // browser; explicitly restart loading so loadeddata/seeked can fire.
      video.load();
    }

    return () => {
      cancelled = true;
      video.removeEventListener('loadeddata', prepareFirstFrame);
      if (seekHandler) video.removeEventListener('seeked', seekHandler);
    };
  }, [shouldLoad, src]);

  return (
    <div ref={containerRef} className="relative h-full w-full bg-gray-900">
      {shouldLoad ? (
        <>
          <video
            ref={videoRef}
            src={getVideoPreviewSrc(src)}
            draggable={false}
            muted
            preload="auto"
            playsInline
            className="h-full w-full object-contain"
            onLoadedMetadata={(event) => onLoadedMetadata?.(event.currentTarget)}
            onError={onError}
          />
          {poster && posterState !== 'failed' && (
            <img
              src={poster}
              alt=""
              draggable={false}
              className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${
                posterState === 'ready' && !videoFrameReady ? 'opacity-100' : 'opacity-0'
              }`}
              loading="lazy"
              decoding="async"
              onLoad={() => setPosterState('ready')}
              onError={() => setPosterState('failed')}
            />
          )}
          {!videoFrameReady && posterState !== 'ready' && (
            <div className="pointer-events-none absolute inset-0 animate-pulse bg-gray-800/70" />
          )}
        </>
      ) : poster && posterState !== 'failed' ? (
        <img
          src={poster}
          alt=""
          draggable={false}
          className="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
          onLoad={() => setPosterState('ready')}
          onError={() => setPosterState('failed')}
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-gray-800/70" />
      )}
    </div>
  );
};
