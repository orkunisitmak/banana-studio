import { PROVIDER_LABELS } from '../lib/providers';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import { getPersonGroups, getPersonId } from '../lib/references/personReferences';
import { personColor } from './PersonAssignment';
import { getImageOutputRatio, getImageResolutionLabel, hasImageSizeMismatch, SUNBURST_MODEL } from '../lib/images/openaiImage';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import JSZip from 'jszip';
import { isMobilePhotoDevice, preparePhotosForSharing, sharePreparedPhotos } from '../services/photoShareService';
import { Link as ShareLink, Download, X, ZoomIn, ImagePlus, Grid3X3, Sparkles, Info, Copy, Check, Trash2, Image as ImageIcon, ChevronLeft, ChevronRight, ChevronDown, RotateCcw, RefreshCw, FolderPlus, Folder as FolderIcon, FolderOpen, ArrowLeft, MoreVertical, MousePointer2, Scan, Ratio, Layers, Pencil, Heart, MoreHorizontal, AlertCircle, Shuffle, Bell, CheckCircle, AlertTriangle, Loader2, Play, Pause, Video, Film, Clock, Volume2, VolumeX, CircleQuestionMark, ShieldCheck, Maximize2, Rewind, FastForward, Minus, Plus, Search, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { AdminUserSummary, GeneratedMedia, Folder, ReferenceImage, UserProfile, DEFAULT_IMAGE_MODEL, getImageModelLabel, IMAGE_COST_PER_GEN, estimateImageCost, type GenerationConfig, type TextModelId } from '../types';
import { getImageById, saveFolder, getFolders, renameFolder, refreshMediaAccessUrl, type DeleteFolderResult } from '../services/storageService';
import { ImageCompareDialog } from './ImageCompareDialog';
import { GallerySearchDialog } from './GallerySearchDialog';
import { GalleryImageEditor } from './GalleryImageEditor';
import { ImageEditComparison } from './ImageEditComparison';
import { useSavedImageEditSource } from './useSavedImageEditSource';
import { ImageEditDetails, PromptPreparationDetails } from './GenerationDetails';
import { getRecordedEditSourceReference, getRecordedGenerationTime } from './recordedGenerationDetails';
import { useGalleryMediaDetails } from './useGalleryMediaDetails';
import { DetailImage } from './GalleryDetailImage';
import { buildGalleryFolderStats } from './galleryFolderStats';
import type { GallerySearchEntry } from './gallerySearch';
import { getComparisonSelection, isComparableImage } from './imageComparison';
import { YouTubePreviewDialog } from './YouTubePreviewDialog';
import { Toast } from './Toast';
import { HelpCenter } from './HelpCenter';
import { FolderPreview } from './FolderPreview';
import { FolderShareDialog } from './FolderShareDialog';
import { buildFolderPreviewIndex } from './folderPreviews';
import { groupBrainstormImages } from './galleryOrdering';
import { getGalleryAspectRatio, getGalleryCardStyle, getGallerySwipeDirection, isGalleryDismissSwipe, getNavigableGalleryMedia, type GallerySwipeStart } from './galleryPresentation';
import { GALLERY_DRAG_TYPE, GALLERY_DRAG_ID, GALLERY_DRAG_MEDIA_IDS, getDraggedMediaIds, readGalleryDragPayload, getMediaIdsForMove, canMoveGalleryFolder, type GalleryDragPayload } from './galleryDragDrop';

// --- Constants ---
const ITEMS_PER_PAGE = 48;
const LOAD_MORE_THRESHOLD = 800; // pixels from bottom to trigger load more

const getVideoPreviewSrc = (src: string): string => {
  if (!src || /#t=/i.test(src)) return src;
  const hashIndex = src.indexOf('#');
  const base = hashIndex >= 0 ? src.slice(0, hashIndex) : src;
  // iOS Safari often leaves a controls-free video black until playback. A
  // media fragment makes it decode and paint an actual frame while paused.
  return `${base}#t=0.1`;
};

const formatPlaybackTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

interface GalleryProps {
  images: GeneratedMedia[];
  currentFolderId: string | null;
  onFolderSelect: (id: string | null) => void;
  selectedImageId: string | null;
  onImageSelect: (id: string | null) => void;
  onClear: () => void;
  onUseAsReference: (image: GeneratedMedia) => void;
  onRecreate: (image: GeneratedMedia) => void;
  onRecoverVideo?: (video: GeneratedMedia) => void;
  onRecoverImage?: (image: GeneratedMedia) => Promise<void>;
  onGenerateVariation?: (image: GeneratedMedia) => void;
  onEditGenerate?: (config: GenerationConfig) => Promise<string[]>;
  imageEditTextModel?: TextModelId;
  onCancelBrainstorm?: (batchId: string) => void;
  onToggleHistory: () => void;
  onDelete: (image: GeneratedMedia) => void;
  onDeleteMultiple?: (ids: string[]) => Promise<void>;
  onMove: (mediaIds: string[], folderId: string | null) => Promise<void> | void;
  onMoveFolder?: (folderId: string, targetParentId: string | null) => Promise<void> | void;
  onDeleteFolder: (folderId: string) => Promise<DeleteFolderResult>;
  onToggleFavorite?: (image: GeneratedMedia) => void;
  isHistoryOpen: boolean;
  // Toast/Notification props
  toasts?: Toast[];
  onDismissToast?: (id: string) => void;
  onDismissAllToasts?: () => void;
  // User props
  userProfile?: UserProfile | null;
  onSignOut?: () => void;
  onOpenAdmin?: () => void;
  galleryOwner?: AdminUserSummary | null;
  isReadOnly?: boolean;
  isGalleryLoading?: boolean;
  isGalleryIndexLoading?: boolean;
  galleryLoadError?: string | null;
  onExitAdminGallery?: () => void;
}

// --- Lazy Image Component ---
interface LazyImageProps {
  src: string;
  thumbSrc?: string;
  alt: string;
  className?: string;
  onError?: () => void;
  onLoadedDimensions?: (width: number, height: number) => void;
}

const LazyImage: React.FC<LazyImageProps> = ({ src, thumbSrc, alt, className, onError, onLoadedDimensions }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(thumbSrc || src);
  const imgRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setCurrentSrc(thumbSrc || src);
    setIsLoaded(false);
    setHasError(false);
  }, [src, thumbSrc]);

  useEffect(() => {
    if (!imgRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting);
          // If it goes out of view, we don't necessarily need to reset isLoaded
          // because when it comes back into view, it will load instantly from cache
          // and we want it to show up without a fade delay if possible.
        });
      },
      { rootMargin: '600px' } // Keep images loaded within 600px of viewport
    );

    observerRef.current.observe(imgRef.current);

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const handleError = () => {
    if (currentSrc !== src && thumbSrc) {
      // If thumbnail failed, try original
      setCurrentSrc(src);
    } else {
      setHasError(true);
      onError?.();
    }
  };

  if (hasError) {
    return (
      <div ref={imgRef} className={`${className} flex items-center justify-center bg-gray-800`}>
        <AlertCircle className="w-8 h-8 text-gray-600" />
      </div>
    );
  }

  return (
    <div ref={imgRef} className={`relative ${className}`}>
      {!isLoaded && isVisible && (
        <div className="absolute inset-0 bg-gray-800 animate-pulse" />
      )}
      {isVisible && (
        <img
          src={currentSrc}
          alt={alt}
          draggable={false}
          className={`w-full h-full object-contain transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          onLoad={(event) => {
            setIsLoaded(true);
            onLoadedDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          }}
          onError={handleError}
          loading="lazy"
          decoding="async"
        />
      )}
    </div>
  );
};

const LazyVideoPreview: React.FC<{
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

const CustomVideoPlayer: React.FC<{
  src: string;
  onError?: () => void;
}> = ({ src, onError }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [useNativeControls, setUseNativeControls] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [videoAspectRatio, setVideoAspectRatio] = useState(16 / 9);
  const [playerSize, setPlayerSize] = useState<{ width: number; height: number } | null>(null);
  const controlsHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setUseNativeControls(false);
    setControlsVisible(true);
    setVideoAspectRatio(16 / 9);
    setPlayerSize(null);
  }, [src]);

  const clearControlsHideTimer = () => {
    if (controlsHideTimerRef.current !== null) {
      window.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
  };

  const revealControls = () => {
    clearControlsHideTimer();
    setControlsVisible(true);

    if (videoRef.current && !videoRef.current.paused) {
      controlsHideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
        controlsHideTimerRef.current = null;
      }, 1200);
    }
  };

  useEffect(() => {
    clearControlsHideTimer();
    if (isPlaying) {
      controlsHideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
        controlsHideTimerRef.current = null;
      }, 700);
    } else {
      setControlsVisible(true);
    }

    return clearControlsHideTimer;
  }, [isPlaying]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updatePlayerSize = () => {
      const parent = stage.parentElement;
      const availableWidth = stage.clientWidth;
      if (!parent || !availableWidth || !Number.isFinite(videoAspectRatio) || videoAspectRatio <= 0) return;

      const parentStyle = window.getComputedStyle(parent);
      const verticalPadding =
        (Number.parseFloat(parentStyle.paddingTop) || 0)
        + (Number.parseFloat(parentStyle.paddingBottom) || 0);
      const fallbackHeight = (window.visualViewport?.height || window.innerHeight) * 0.55;
      const availableHeight = Math.max(180, parent.clientHeight - verticalPadding || fallbackHeight);

      let width = availableWidth;
      let height = width / videoAspectRatio;
      if (height > availableHeight) {
        height = availableHeight;
        width = height * videoAspectRatio;
      }

      const nextSize = {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      };
      setPlayerSize(current =>
        current && current.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize
      );
    };

    updatePlayerSize();
    const resizeObserver = new ResizeObserver(updatePlayerSize);
    resizeObserver.observe(stage);
    if (stage.parentElement) resizeObserver.observe(stage.parentElement);
    window.visualViewport?.addEventListener('resize', updatePlayerSize);
    return () => {
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener('resize', updatePlayerSize);
    };
  }, [videoAspectRatio]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleNativeFullscreenStart = () => {
      video.controls = true;
      setUseNativeControls(true);
    };
    const handleNativeFullscreenEnd = () => {
      video.controls = false;
      setUseNativeControls(false);
    };
    const handleFullscreenChange = () => {
      if (document.fullscreenElement === video) {
        handleNativeFullscreenStart();
      } else if (!document.fullscreenElement) {
        handleNativeFullscreenEnd();
      }
    };

    video.addEventListener('webkitbeginfullscreen', handleNativeFullscreenStart);
    video.addEventListener('webkitendfullscreen', handleNativeFullscreenEnd);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      video.removeEventListener('webkitbeginfullscreen', handleNativeFullscreenStart);
      video.removeEventListener('webkitendfullscreen', handleNativeFullscreenEnd);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [src]);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
      } catch {
        // Browsers can reject autoplay-style play attempts. The paused state
        // remains visible so the user can tap again.
      }
    } else {
      video.pause();
    }
  };

  const seekBy = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const end = Number.isFinite(video.duration) ? video.duration : duration;
    video.currentTime = Math.max(0, Math.min(end || 0, video.currentTime + seconds));
  };

  const handleSeek = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value;
    setCurrentTime(value);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted && video.volume === 0) video.volume = 0.5;
    video.muted = !video.muted;
    setIsMuted(video.muted || video.volume === 0);
  };

  const changeVolume = (amount: number) => {
    const video = videoRef.current;
    if (!video) return;
    const nextVolume = Math.max(0, Math.min(1, Number((video.volume + amount).toFixed(1))));
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
    setIsMuted(video.muted);
  };

  const openNativeFullscreen = async () => {
    const video = videoRef.current as (HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
    }) | null;
    if (!video) return;

    setUseNativeControls(true);
    video.controls = true;
    try {
      if (typeof video.webkitEnterFullscreen === 'function') {
        video.webkitEnterFullscreen();
      } else if (typeof video.requestFullscreen === 'function') {
        await video.requestFullscreen();
      } else if (containerRef.current && typeof containerRef.current.requestFullscreen === 'function') {
        await containerRef.current.requestFullscreen();
      } else {
        throw new Error('Fullscreen is not supported');
      }
    } catch {
      video.controls = false;
      setUseNativeControls(false);
    }
  };

  useEffect(() => {
    const handlePlayerKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, button, [contenteditable="true"]')) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const key = event.key.toLowerCase();
      const isShiftSeek = event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
      const isPlayerShortcut = isShiftSeek
        || !event.shiftKey && [' ', 'spacebar', 'arrowup', 'arrowdown', 'j', 'k', 'l', 'm', 'f'].includes(key);
      if (!isPlayerShortcut) return;

      event.preventDefault();
      if (event.repeat && [' ', 'spacebar', 'k', 'm', 'f'].includes(key)) return;

      revealControls();
      if (isShiftSeek) {
        seekBy(event.key === 'ArrowRight' ? 1 : -1);
        return;
      }

      switch (key) {
        case ' ':
        case 'spacebar':
        case 'k':
          void togglePlayback();
          break;
        case 'j':
          seekBy(-5);
          break;
        case 'l':
          seekBy(5);
          break;
        case 'm':
          toggleMute();
          break;
        case 'arrowup':
          changeVolume(0.1);
          break;
        case 'arrowdown':
          changeVolume(-0.1);
          break;
        case 'f':
          void openNativeFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handlePlayerKeyDown);
    return () => window.removeEventListener('keydown', handlePlayerKeyDown);
  }, [duration]);

  return (
    <div
      ref={stageRef}
      className="flex w-full items-center justify-center md:h-full"
      onClick={(event) => event.stopPropagation()}
    >
    <div
      ref={containerRef}
      style={playerSize ? { width: `${playerSize.width}px`, height: `${playerSize.height}px` } : undefined}
      className="relative max-h-full max-w-full overflow-hidden rounded-xl bg-black shadow-2xl"
      onPointerMove={revealControls}
      onPointerDown={revealControls}
    >
      <video
        ref={videoRef}
        src={getVideoPreviewSrc(src)}
        controls={useNativeControls}
        playsInline
        preload="auto"
        className="h-full w-full object-contain"
        onClick={() => {
          if (!useNativeControls) void togglePlayback();
        }}
        onLoadedMetadata={(event) => {
          if (event.currentTarget.videoWidth > 0 && event.currentTarget.videoHeight > 0) {
            setVideoAspectRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight);
          }
          setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
          setCurrentTime(event.currentTarget.currentTime);
        }}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onVolumeChange={(event) => setIsMuted(event.currentTarget.muted || event.currentTarget.volume === 0)}
        onError={onError}
      />

      {!useNativeControls && controlsVisible && (
        <>
          <div className="absolute right-3 top-3 flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMute}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-black/60 text-white shadow-lg backdrop-blur-md active:scale-95"
              aria-label={isMuted ? 'Unmute video' : 'Mute video'}
            >
              {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => void openNativeFullscreen()}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-black/60 text-white shadow-lg backdrop-blur-md active:scale-95"
              aria-label="Open native fullscreen player"
            >
              <Maximize2 className="h-5 w-5" />
            </button>
          </div>

          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
            <button
              type="button"
              onClick={() => seekBy(-10)}
              className="relative grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-md active:scale-95"
              aria-label="Go back 10 seconds"
            >
              <Rewind className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void togglePlayback()}
              className="grid h-16 w-16 place-items-center rounded-full border border-white/25 bg-black/65 text-white shadow-2xl backdrop-blur-md active:scale-95"
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
            >
              {isPlaying ? <Pause className="h-7 w-7 fill-current" /> : <Play className="ml-1 h-7 w-7 fill-current" />}
            </button>
            <button
              type="button"
              onClick={() => seekBy(10)}
              className="relative grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-md active:scale-95"
              aria-label="Go forward 10 seconds"
            >
              <FastForward className="h-5 w-5" />
            </button>
          </div>

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-3 pb-3 pt-10 sm:px-4">
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => handleSeek(Number(event.target.value))}
              className="h-5 w-full cursor-pointer"
              aria-label="Video progress"
            />
            <div className="mt-0.5 flex items-center justify-between text-[11px] font-medium tabular-nums text-white/75">
              <span>{formatPlaybackTime(currentTime)}</span>
              <span>-{formatPlaybackTime(Math.max(0, duration - currentTime))}</span>
            </div>
          </div>
        </>
      )}
    </div>
    </div>
  );
};


const RecoverImageButton = ({ media, onRecover }: { media: GeneratedMedia; onRecover?: (image: GeneratedMedia) => Promise<void> }) => {
  const [checking, setChecking] = useState(false);
  if (!onRecover || media.imageModel !== SUNBURST_MODEL) return null;
  return <button disabled={checking} onClick={async event => {
    event.stopPropagation();
    if (checking) return;
    setChecking(true);
    try { await onRecover(media); } finally { setChecking(false); }
  }} className="flex items-center gap-1.5 px-2 py-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 rounded text-white text-[10px] font-medium"
    title="Check the saved file and restore it. Does not generate an image or charge for generation.">
    <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />{checking ? 'Checking saved image…' : 'Recover saved image'}
  </button>;
};

export const Gallery: React.FC<GalleryProps> = ({
  images,
  currentFolderId,
  onFolderSelect,
  selectedImageId,
  onImageSelect,
  onClear,
  onUseAsReference,
  onRecreate,
  onRecoverVideo,
  onRecoverImage,
  onGenerateVariation,
  onEditGenerate,
  imageEditTextModel,
  onCancelBrainstorm,
  onDelete,
  onDeleteMultiple,
  onMove,
  onMoveFolder,
  onDeleteFolder,
  onToggleFavorite,
  toasts = [],
  onDismissToast,
  onDismissAllToasts,
  userProfile,
  onSignOut,
  onOpenAdmin,
  galleryOwner = null,
  isReadOnly = false,
  isGalleryLoading = false,
  isGalleryIndexLoading = isGalleryLoading,
  galleryLoadError = null,
  onExitAdminGallery,
}) => {
  // --- State ---
  const [folders, setFolders] = useState<Folder[]>([]);
  const [sharingFolder, setSharingFolder] = useState<Folder | null>(null);
  const [folderLoadError, setFolderLoadError] = useState<string | null>(null);
  const [isFoldersLoading, setIsFoldersLoading] = useState(true);
  const selectedMediaId = selectedImageId;
  const setSelectedMediaId = onImageSelect;
  const [gridCols, setGridCols] = useState<number>(4);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isYouTubePreviewOpen, setIsYouTubePreviewOpen] = useState(false);
  const [isDetailsVisible, setIsDetailsVisible] = useState(true);
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  useEffect(() => { setEditingMediaId(null); }, [galleryOwner?.user_id, userProfile?.id]);
  useEffect(() => { setIsYouTubePreviewOpen(false); }, [galleryOwner?.user_id, userProfile?.id]);
  const [searchRevealId, setSearchRevealId] = useState<string | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  // Pagination State
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Selection Mode State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [comparisonIds, setComparisonIds] = useState<string[] | null>(null);
  const [comparisonNotice, setComparisonNotice] = useState<string | null>(null);
  const compareButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isSelectionMode || comparisonIds || isSearchOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== 'c') return;
      if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]')) return;
      const button = compareButtonRef.current;
      if (!button || button.disabled) return;
      event.preventDefault(); event.stopPropagation(); button.focus({ preventScroll: true }); button.click();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [isSelectionMode, comparisonIds, isSearchOpen]);
  const comparableSelection = useMemo(() => getComparisonSelection(selectedIds, images), [selectedIds, images]);
  const comparisonImages = useMemo(() => getComparisonSelection(comparisonIds || [], images), [comparisonIds, images]);
  const closeComparison = useCallback((message?: string) => {
    setComparisonIds(null);
    setComparisonNotice(message || null);
  }, []);
  const loadComparisonDetails = useCallback((id: string) => getImageById(id, galleryOwner?.user_id), [galleryOwner?.user_id]);
  const refreshComparisonSource = useCallback((media: GeneratedMedia) => refreshMediaAccessUrl(media.url, false), []);
  useEffect(() => {
    if (comparisonIds && comparisonImages.length < 2) closeComparison('Comparison ended: fewer than two available images remain.');
  }, [comparisonIds, comparisonImages.length, closeComparison]);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const [activeDrag, setActiveDrag] = useState<GalleryDragPayload | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const moveInFlightRef = useRef(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Folder Creation/Edit State
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isSavingFolder, setIsSavingFolder] = useState(false);
  const [folderCreateError, setFolderCreateError] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const createFolderDialogRef = useRef<HTMLDivElement>(null);

  // Move Menu State
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [isDownloadingBatch, setIsDownloadingBatch] = useState(false);
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const isPhotoDevice = isMobilePhotoDevice();
  const [preparedPhotos, setPreparedPhotos] = useState<File[] | null>(null);
  const [isPreparingPhotos, setIsPreparingPhotos] = useState(false);
  const [isSharingPhotos, setIsSharingPhotos] = useState(false);
  const [photoProgress, setPhotoProgress] = useState({ completed: 0, total: 0 });
  const [photoShareMessage, setPhotoShareMessage] = useState<string | null>(null);
  const [photoShareError, setPhotoShareError] = useState<string | null>(null);
  const photoPreparationRef = useRef<AbortController | null>(null);
  const photoShareInFlightRef = useRef(false);
  const photoSelectionKey = JSON.stringify([galleryOwner?.user_id || 'self', [...selectedIds].sort()]);

  useEffect(() => {
    photoPreparationRef.current?.abort();
    photoPreparationRef.current = null;
    setPreparedPhotos(null);
    setIsPreparingPhotos(false);
    setPhotoShareMessage(null);
    setPhotoShareError(null);
  }, [photoSelectionKey]);

  useEffect(() => () => { photoPreparationRef.current?.abort(); }, []);

  // Media Type Filter
  const [mediaFilter, setMediaFilter] = useState<'all' | 'image' | 'video'>('all');

  // User Menu State
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isGridMenuOpen, setIsGridMenuOpen] = useState(false);
  const [isHelpCenterOpen, setIsHelpCenterOpen] = useState(false);
  const gridMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Broken Image Tracking
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set());
  const [detectedVideoAspectRatios, setDetectedVideoAspectRatios] = useState<Record<string, number>>({});
  const [detectedImageAspectRatios, setDetectedImageAspectRatios] = useState<Record<string, number>>({});
  const viewerSwipeRef = useRef<GallerySwipeStart | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const suppressViewerClickUntilRef = useRef(0);
  const [promptCopied, setPromptCopied] = useState(false);
  const [providerPromptCopied, setProviderPromptCopied] = useState(false);

  // Clear "Copied" badge when the user navigates to a different detail item.
  useEffect(() => {
    setPromptCopied(false);
    setProviderPromptCopied(false);
  }, [selectedImageId]);

  const handleCopyPrompt = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch (e) {
      console.warn('Copy to clipboard failed', e);
    }
  }, []);

  const handleCopyProviderPrompt = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setProviderPromptCopied(true);
      setTimeout(() => setProviderPromptCopied(false), 1500);
    } catch (e) {
      console.warn('Copy to clipboard failed', e);
    }
  }, []);

  // Popup Preview State
  const [previewRefImage, setPreviewRefImage] = useState<ReferenceImage | null>(null);

  // Notification Panel State
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const notificationPanelRef = useRef<HTMLDivElement>(null);

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
    setIsNotificationPanelOpen(false);
    setIsGridMenuOpen(false);
    setIsUserMenuOpen(false);
    setMoveMenuOpen(false);
  }, []);
  const closeSearch = useCallback(() => setIsSearchOpen(false), []);
  const selectSearchResult = useCallback((entry: GallerySearchEntry) => {
    setIsSearchOpen(false);
    setShowFavoritesOnly(false);
    setMediaFilter('all');
    setIsSelectionMode(false);
    if (entry.type === 'folder') {
      onImageSelect(null);
      onFolderSelect(entry.id);
    } else {
      onFolderSelect(entry.media?.folderId || null);
      // Running/failed generations open their gallery card instead of a blank viewer.
      onImageSelect(entry.status === 'completed' && entry.media?.url ? entry.id : null);
      setSearchRevealId(entry.id);
    }
  }, [onFolderSelect, onImageSelect]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey) return;
      const commandK = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k';
      const slash = event.key === '/' && !event.metaKey && !event.ctrlKey
        && !(event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      if ((!commandK && !slash) || isSearchOpen || comparisonIds || isYouTubePreviewOpen || isCreatingFolder || isHelpCenterOpen || previewRefImage) return;
      if ((event.target as HTMLElement)?.closest('[role="dialog"]')) return;
      event.preventDefault();
      openSearch();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [openSearch, isSearchOpen, comparisonIds, isYouTubePreviewOpen, isCreatingFolder, isHelpCenterOpen, previewRefImage]);

  // Close header menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        isNotificationPanelOpen &&
        notificationButtonRef.current && !notificationButtonRef.current.contains(target) &&
        notificationPanelRef.current && !notificationPanelRef.current.contains(target)
      ) {
        setIsNotificationPanelOpen(false);
      }
      if (isGridMenuOpen && gridMenuRef.current && !gridMenuRef.current.contains(target)) {
        setIsGridMenuOpen(false);
      }
      if (isUserMenuOpen && userMenuRef.current && !userMenuRef.current.contains(target)) {
        setIsUserMenuOpen(false);
      }
      if (moveMenuOpen && moveMenuRef.current && !moveMenuRef.current.contains(target)) {
        setMoveMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isGridMenuOpen, isNotificationPanelOpen, isUserMenuOpen, moveMenuOpen]);

  // --- Derived State ---
  const currentFolder = folders.find(f => f.id === currentFolderId);

  // One index serves every folder badge and descendant cost total.
  const folderStats = useMemo(() => {
    const costPerMedia = (m: GeneratedMedia): number => {
      if (m.generationCost && typeof m.generationCost.usd === 'number') return m.generationCost.usd;
      if (m.mediaType === 'video') return 0; // unknown video cost, don't guess
      const model = m.imageModel || DEFAULT_IMAGE_MODEL;
      return estimateImageCost(model, m.resolution, 1, m.aspectRatio, (m.referenceImages?.length || 0) > 0) ?? 0;
    };

    return buildGalleryFolderStats(folders, images, costPerMedia);
  }, [folders, images]);

  // Filter folders
  const visibleFolders = useMemo(() => folders.filter(f => {
    if (showFavoritesOnly) return false; // Don't show folders in Favorites view
    if (currentFolderId === null) return !f.parentId;
    return f.parentId === currentFolderId;
  }), [folders, showFavoritesOnly, currentFolderId]);

  const folderPreviews = useMemo(() => buildFolderPreviewIndex(folders, images), [folders, images]);


  const allVisibleImages = useMemo(() => groupBrainstormImages(images.filter(img => {
    if (mediaFilter !== 'all') {
      const type = img.mediaType || 'image';
      if (type !== mediaFilter) return false;
    }

    if (showFavoritesOnly) {
      if (currentFolderId === null) {
        return img.isFavorite;
      } else {
        return img.isFavorite && img.folderId === currentFolderId;
      }
    }

    const imgFolderId = img.folderId || null;
    return imgFolderId === currentFolderId;
  })), [images, showFavoritesOnly, currentFolderId, mediaFilter]);

  // Paginated images for display
  const visibleImages = useMemo(() =>
    allVisibleImages.slice(0, displayCount),
    [allVisibleImages, displayCount]
  );

  const hasMoreImages = displayCount < allVisibleImages.length;

  const { selectedMedia } = useGalleryMediaDetails(images, selectedMediaId, galleryOwner?.user_id, userProfile?.id);
  const selectedEditSourceReference = selectedMedia ? getRecordedEditSourceReference(selectedMedia) : undefined;
  const selectedReferenceImages = (selectedMedia?.referenceImages || []).filter(reference =>
    reference.data && (selectedMedia?.mediaType !== 'image' || reference !== selectedEditSourceReference)
  );
  const selectedGenerationTime = selectedMedia ? getRecordedGenerationTime(selectedMedia) : undefined;
  const canEditSelectedMedia = Boolean(onEditGenerate && !isReadOnly && selectedMedia && isComparableImage(selectedMedia) && !brokenImageIds.has(selectedMedia.id));
  const isEditingSelectedMedia = canEditSelectedMedia && editingMediaId === selectedMediaId;
  const savedEditSource = useSavedImageEditSource(!isEditingSelectedMedia ? selectedMedia : null, images, galleryOwner?.user_id, userProfile?.id);
  // A stacked mobile details pane must scroll below the complete image instead
  // of shrinking its zoom stage and clipping a square or portrait to a strip.
  const detailViewerLayout = isEditingSelectedMedia
    ? 'flex-none md:flex-1 overflow-visible md:overflow-y-auto min-h-0'
    : `${savedEditSource.source || (isDetailsVisible && selectedMedia?.mediaType === 'image') ? 'flex-none md:flex-1' : 'flex-1'} justify-center overflow-hidden ${selectedMedia?.mediaType === 'video' ? 'min-h-[40vh]' : 'min-h-0'}`;
  const normalDetailImage = selectedMedia?.mediaType === 'image' && !isEditingSelectedMedia ? (
    <DetailImage key={selectedMedia.id} src={selectedMedia.url} fallbackSrc={selectedMedia.thumbnailUrl} alt={selectedMedia.prompt}
      className={`h-auto w-auto shrink-0 max-w-full ${!isDetailsVisible ? 'max-h-[calc(100dvh-32px)] md:max-h-full' : canEditSelectedMedia ? 'max-h-[65dvh] md:max-h-[calc(100dvh-170px)]' : 'max-h-[75dvh] md:max-h-full'} rounded-lg shadow-2xl object-contain`}
      onClick={event => event.stopPropagation()} />
  ) : null;
  useEffect(() => {
    if (!selectedMedia || !isComparableImage(selectedMedia)) setIsYouTubePreviewOpen(false);
  }, [selectedMedia]);
  const navigableImages = useMemo(() => getNavigableGalleryMedia(allVisibleImages), [allVisibleImages]);
  const previewImages = useMemo(() => allVisibleImages.filter(isComparableImage), [allVisibleImages]);
  const previewIndex = previewImages.findIndex(img => img.id === selectedMediaId);
  const selectedIndex = navigableImages.findIndex(img => img.id === selectedMediaId);
  const selectedPersonGroups = useMemo(() => getPersonGroups(selectedMedia?.referenceImages || []), [selectedMedia]);
  const selectedReferenceVideos = useMemo(
    () => (selectedMedia?.referenceVideos || []).filter(ref => ref.url),
    [selectedMedia]
  );
  const selectedReferenceAudios = useMemo(
    () => (selectedMedia?.referenceAudios || []).filter(ref => ref.url),
    [selectedMedia]
  );

  // --- Effects ---
  const folderRequestRef = useRef(0);
  const refreshFolders = useCallback(() => {
    const request = ++folderRequestRef.current;
    setFolderLoadError(null);
    setIsFoldersLoading(true);
    getFolders(galleryOwner?.user_id)
      .then(items => { if (folderRequestRef.current === request) setFolders(items); })
      .catch((error: any) => {
        if (folderRequestRef.current !== request) return;
        console.error('Failed to load gallery folders:', error);
        setFolders([]);
        setFolderLoadError(error?.message || 'Folders could not be loaded.');
      })
      .finally(() => { if (folderRequestRef.current === request) setIsFoldersLoading(false); });
  }, [galleryOwner?.user_id]);

  useEffect(() => {
    refreshFolders();
    return () => { folderRequestRef.current++; };
  }, [refreshFolders]);

  // Reset pagination when folder changes
  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE);
  }, [currentFolderId, showFavoritesOnly]);

  useEffect(() => {
    if (!searchRevealId) return;
    const index = allVisibleImages.findIndex(item => item.id === searchRevealId);
    if (index < 0) return;
    setDisplayCount(count => Math.max(count, index + 1));
    const frame = requestAnimationFrame(() => {
      const card = (Array.from(scrollContainerRef.current?.querySelectorAll('[data-gallery-media-id]') || []) as HTMLElement[])
        .find(node => node.dataset.galleryMediaId === searchRevealId);
      if (card) { card.scrollIntoView({ block: 'center' }); setSearchRevealId(null); }
    });
    return () => cancelAnimationFrame(frame);
  }, [searchRevealId, allVisibleImages, displayCount]);

  // Infinite scroll handler
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      if (distanceFromBottom < LOAD_MORE_THRESHOLD && hasMoreImages) {
        setDisplayCount(prev => Math.min(prev + ITEMS_PER_PAGE, allVisibleImages.length));
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [hasMoreImages, allVisibleImages.length]);

  useEffect(() => {
    setComparisonIds(null);
    setComparisonNotice(null);
    setIsSelectionMode(false);
    setSelectedIds(new Set());
    setIsSearchOpen(false);
    setSearchRevealId(null);
  }, [galleryOwner?.user_id, userProfile?.id]);

  useEffect(() => {
    if (!isReadOnly) return;
    setIsSelectionMode(false);
    setSelectedIds(new Set());
    setIsCreatingFolder(false);
    setFolderCreateError(null);
    setRenamingFolderId(null);
    setMoveMenuOpen(false);
  }, [isReadOnly, galleryOwner?.user_id]);

  useEffect(() => {
    if (!isCreatingFolder) return;

    const focusFrame = window.requestAnimationFrame(() => newFolderInputRef.current?.focus());
    const handleModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSavingFolder) {
        setIsCreatingFolder(false);
        setNewFolderName("");
        setFolderCreateError(null);
        return;
      }

      if (event.key === 'Tab' && createFolderDialogRef.current) {
        const focusableElements = Array.from(
          createFolderDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
        ) as HTMLElement[];
        if (focusableElements.length === 0) return;
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };

    window.addEventListener('keydown', handleModalKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleModalKeyDown);
    };
  }, [isCreatingFolder, isSavingFolder]);

  useEffect(() => {
    if (selectedIds.size === 0) return;

    const validImageIds = new Set(images.map(image => image.id));
    const nextSelectedIds = new Set(Array.from(selectedIds).filter(id => validImageIds.has(id)));

    if (nextSelectedIds.size === selectedIds.size) return;

    setSelectedIds(nextSelectedIds);

    if (lastSelectedId && !validImageIds.has(lastSelectedId)) {
      setLastSelectedId(null);
    }

    if (nextSelectedIds.size === 0) {
      setIsSelectionMode(false);
    }
  }, [images, lastSelectedId, selectedIds]);

  // Track broken images and clean up stale entries
  const handleImageBroken = useCallback((id: string) => {
    setBrokenImageIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const handleRecoverBrokenVideo = useCallback((media: GeneratedMedia) => {
    setBrokenImageIds(prev => {
      const next = new Set(prev);
      next.delete(media.id);
      return next;
    });
    onRecoverVideo?.(media);
  }, [onRecoverVideo]);

  useEffect(() => {
    if (brokenImageIds.size === 0) return;
    const currentIds = new Set(images.map(img => img.id));
    const nextBroken = new Set([...brokenImageIds].filter(id => currentIds.has(id)));
    if (nextBroken.size !== brokenImageIds.size) {
      setBrokenImageIds(nextBroken);
    }
  }, [images, brokenImageIds]);

  // --- Navigation Logic ---
  const handleNavigate = useCallback((direction: number, stillsOnly = false) => {
    if (!selectedMediaId) return;
    const candidates = stillsOnly ? previewImages : navigableImages;
    const currentIndex = candidates.findIndex(img => img.id === selectedMediaId);
    if (currentIndex === -1) return;
    const next = candidates[currentIndex + direction];
    if (!next) return;
    // Viewer navigation is not limited to the grid's current 48-item page.
    const gridIndex = allVisibleImages.findIndex(img => img.id === next.id);
    setDisplayCount(count => Math.max(count, Math.ceil((gridIndex + 1) / ITEMS_PER_PAGE) * ITEMS_PER_PAGE));
    setSelectedMediaId(next.id);
  }, [selectedMediaId, navigableImages, previewImages, allVisibleImages, setSelectedMediaId]);

  const resetViewerPull = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.style.transition = 'transform 160ms ease-out, opacity 160ms ease-out';
    viewer.style.removeProperty('--gallery-pull-y');
    viewer.style.removeProperty('--gallery-pull-opacity');
  };

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || isEditingSelectedMedia || selectedMedia?.mediaType === 'video') return;
    // React's touchmove listener is passive. Veto only a downward image pull
    // before Safari takes it over as scrolling; upward scrolling and pinch
    // zoom retain their normal browser behavior. No listener on Details.
    const preventPullScroll = (event: TouchEvent) => {
      const start = viewerSwipeRef.current;
      const touch = event.touches[0];
      if (!start?.canDismiss || start.cancelled || start.axis === 'horizontal' || !touch || event.touches.length !== 1 || (window.visualViewport?.scale || 1) > 1.01) return;
      const dy = touch.clientY - start.y, dx = touch.clientX - start.x;
      if (dy > 0 && dy > Math.abs(dx) * 1.5 && event.cancelable) event.preventDefault();
    };
    viewer.addEventListener('touchmove', preventPullScroll, { passive: false });
    return () => { viewer.removeEventListener('touchmove', preventPullScroll); viewerSwipeRef.current = null; };
  }, [selectedMedia?.id, selectedMedia?.isLoading, selectedMedia?.mediaType, isEditingSelectedMedia, comparisonIds, isSearchOpen, isSelectionMode]);

  const handleViewerTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    resetViewerPull();
    const target = event.target as HTMLElement;
    const width = window.innerWidth;
    const touch = event.touches[0];
    if (isEditingSelectedMedia || selectedMedia?.mediaType === 'video' || event.touches.length !== 1 ||
      (window.visualViewport?.scale || 1) > 1.01 ||
      target.closest('button, a, input, textarea, select, video, [role="button"], [role="slider"], [data-image-edit-comparison] .cmp-stage') ||
      !touch || touch.clientX < 24 || touch.clientX > width - 24) {
      viewerSwipeRef.current = null;
      return;
    }
    const imageStage = target.closest<HTMLElement>('[data-gallery-image-zoom]');
    if (imageStage && Number(imageStage.getAttribute('data-gallery-image-zoom')) > 1.01) { viewerSwipeRef.current = null; return; }
    viewerSwipeRef.current = { x: touch.clientX, y: touch.clientY, startedAt: Date.now(), viewportWidth: width, cancelled: false, canDismiss: Boolean(imageStage) };
  };

  const handleViewerTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = viewerSwipeRef.current;
    if (!start) return;
    if (event.touches.length !== 1 || (window.visualViewport?.scale || 1) > 1.01) {
      start.cancelled = true;
      resetViewerPull();
      return;
    }
    const touch = event.touches[0];
    const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
    if (!start.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 12) start.axis = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
    if (start.axis === 'vertical' && start.canDismiss && dy > 0 && dy > Math.abs(dx) * 1.5) {
      const viewer = viewerRef.current;
      if (viewer) {
        // Transient movement stays in DOM/ref state, so a drag does not rerender
        // the gallery grid on every touch event.
        viewer.style.transition = 'none';
        viewer.style.setProperty('--gallery-pull-y', `${Math.min(dy * .85, 280)}px`);
        viewer.style.setProperty('--gallery-pull-opacity', String(Math.max(.45, 1 - dy / 600)));
      }
    } else if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) {
      start.cancelled = true;
      resetViewerPull();
    }
  };

  const handleViewerTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = viewerSwipeRef.current;
    viewerSwipeRef.current = null;
    resetViewerPull();
    const touch = event.changedTouches[0];
    if (!touch || event.touches.length > 0) return;
    const endpoint = {
      x: touch.clientX, y: touch.clientY, endedAt: Date.now(), scale: window.visualViewport?.scale,
    };
    if (isGalleryDismissSwipe(start, endpoint)) {
      event.preventDefault(); event.stopPropagation();
      suppressViewerClickUntilRef.current = Date.now() + 500;
      setSelectedMediaId(null);
      return;
    }
    const direction = getGallerySwipeDirection(start, endpoint);
    if (!direction) return;
    // iOS may synthesize a click after a swipe; it must not close the viewer.
    suppressViewerClickUntilRef.current = Date.now() + 500;
    handleNavigate(direction);
  };

  useEffect(() => {
    if (!selectedMedia || selectedMedia.isLoading || isSelectionMode || comparisonIds || isSearchOpen || isYouTubePreviewOpen || isHelpCenterOpen || previewRefImage || (!isReadOnly && (isCreatingFolder || sharingFolder))) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.isComposing || target?.closest('dialog, [role="dialog"], [role="listbox"], [role="menu"]')) return;
      const isTextTarget = target?.closest('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])');
      if (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'b') {
        if (isTextTarget || e.repeat) return;
        e.preventDefault();
        setIsDetailsVisible(visible => !visible);
        return;
      }
      const isInteractiveTarget = isTextTarget || target?.closest('[data-gallery-image-editor], [role="slider"], [data-image-edit-comparison] .cmp-stage')
        || (target?.closest('button') && !target.closest('[data-gallery-viewer-toolbar], [data-image-edit-comparison] [role="switch"]'));
      if (isInteractiveTarget && e.key !== 'Escape') return;
      if (e.key === 'ArrowLeft' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        handleNavigate(-1);
      } else if (e.key === 'ArrowRight' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        handleNavigate(1);
      } else if (e.key === 'Escape') {
        setSelectedMediaId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMedia?.id, selectedMedia?.isLoading, handleNavigate, isSelectionMode, comparisonIds, isSearchOpen, isYouTubePreviewOpen, isCreatingFolder, isHelpCenterOpen, previewRefImage, sharingFolder, isReadOnly]);

  // --- Actions ---

  const openCreateFolderModal = () => {
    if (isReadOnly) return;
    setNewFolderName("");
    setFolderCreateError(null);
    setRenamingFolderId(null);
    setIsNotificationPanelOpen(false);
    setIsGridMenuOpen(false);
    setIsUserMenuOpen(false);
    setIsCreatingFolder(true);
  };

  const closeCreateFolderModal = () => {
    if (isSavingFolder) return;
    setIsCreatingFolder(false);
    setNewFolderName("");
    setFolderCreateError(null);
  };

  const handleCreateFolder = async () => {
    if (isReadOnly || isSavingFolder) return;
    const folderName = newFolderName.trim();
    if (!folderName) return;
    const newFolder: Folder = {
      id: `folder-${Date.now()}`,
      name: folderName,
      createdAt: Date.now(),
      parentId: currentFolderId
    };
    setIsSavingFolder(true);
    setFolderCreateError(null);
    try {
      await saveFolder(newFolder);
      setFolders(prev => [newFolder, ...prev]);
      setNewFolderName("");
      setIsCreatingFolder(false);
    } catch (error: any) {
      setFolderCreateError(error?.message || 'The folder could not be created. Please try again.');
    } finally {
      setIsSavingFolder(false);
    }
  };

  const handleRenameFolder = async () => {
    if (isReadOnly) return;
    if (!renamingFolderId || !newFolderName.trim()) return;
    await renameFolder(renamingFolderId, newFolderName);
    setFolders(prev => prev.map(f => f.id === renamingFolderId ? { ...f, name: newFolderName } : f));
    setRenamingFolderId(null);
    setNewFolderName("");
  };

  const handleDeleteFolder = async (folder: Folder) => {
    if (isReadOnly || deletingFolderId) return;

    const subtreeIds = new Set<string>([folder.id]);
    let foundDescendant = true;
    while (foundDescendant) {
      foundDescendant = false;
      folders.forEach(candidate => {
        if (candidate.parentId && subtreeIds.has(candidate.parentId) && !subtreeIds.has(candidate.id)) {
          subtreeIds.add(candidate.id);
          foundDescendant = true;
        }
      });
    }

    const mediaCount = images.filter(media => media.folderId && subtreeIds.has(media.folderId)).length;
    const childFolderCount = Math.max(0, subtreeIds.size - 1);
    const details = [
      mediaCount > 0 ? `${mediaCount} item${mediaCount === 1 ? '' : 's'}` : null,
      childFolderCount > 0 ? `${childFolderCount} subfolder${childFolderCount === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' and ');
    const message = `Delete “${folder.name}” permanently?${details ? ` This also deletes ${details}.` : ''} This cannot be undone.`;
    if (!confirm(message)) return;

    setDeletingFolderId(folder.id);
    try {
      const result = await onDeleteFolder(folder.id);
      const deletedFolderIds = new Set(result.folderIds);
      setFolders(prev => prev.filter(item => !deletedFolderIds.has(item.id)));
      if (currentFolderId && deletedFolderIds.has(currentFolderId)) {
        onFolderSelect(currentFolder?.parentId || null);
      }
    } finally {
      setDeletingFolderId(null);
    }
  };

  // --- Drag & Drop Logic ---

  const clearDragState = () => {
    setActiveDrag(null);
    setDragOverTarget(null);
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
  };

  useEffect(() => () => dragPreviewRef.current?.remove(), []);

  const handleDragStart = (e: React.DragEvent, type: 'image' | 'folder', id: string, mediaObj?: GeneratedMedia) => {
    if (isReadOnly || moveInFlightRef.current) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    const ids = type === 'image' ? getDraggedMediaIds(id, isSelectionMode, selectedIds, images) : [];
    if (type === 'image' && ids.length === 0) {
      e.preventDefault();
      return;
    }
    setMoveError(null);
    setActiveDrag(type === 'image' ? { type, ids } : { type, id });
    e.dataTransfer.setData(GALLERY_DRAG_TYPE, type);
    e.dataTransfer.setData(GALLERY_DRAG_ID, id);
    if (type === 'image') {
      e.dataTransfer.setData(GALLERY_DRAG_MEDIA_IDS, JSON.stringify(ids));
      e.dataTransfer.setData('application/nanogen-image-id', id);
      // A batch is a folder move, not a single reference. Preserve the existing
      // reference-drag contract only for an actual single-media drag.
      if (mediaObj && ids.length === 1) {
        e.dataTransfer.setData('application/nanogen-media', JSON.stringify(mediaObj));
      }
    } else {
      e.dataTransfer.setData('application/nanogen-folder-id', id);
    }
    e.dataTransfer.effectAllowed = 'move';
    const target = e.currentTarget as HTMLElement;
    if (ids.length > 1) {
      const preview = document.createElement('div');
      preview.textContent = `${ids.length} selected items`;
      Object.assign(preview.style, {
        position: 'fixed', top: '-1000px', left: '-1000px', padding: '14px 20px',
        borderRadius: '12px', background: '#7c3aed', color: '#fff',
        font: '600 14px system-ui', boxShadow: '0 8px 28px #0006',
      });
      dragPreviewRef.current?.remove();
      dragPreviewRef.current = preview;
      document.body.appendChild(preview);
      e.dataTransfer.setDragImage(preview, 30, 24);
    } else {
      e.dataTransfer.setDragImage(target, target.offsetWidth / 2, target.offsetHeight / 2);
    }
  };

  const canDropIntoFolder = (payload: GalleryDragPayload, targetFolderId: string | null) => {
    if (targetFolderId && !folders.some(folder => folder.id === targetFolderId)) return false;
    return payload.type === 'image'
      ? getMediaIdsForMove(payload.ids, targetFolderId, images).length > 0
      : !!onMoveFolder && canMoveGalleryFolder(payload.id, targetFolderId, folders);
  };

  const handleFolderDragOver = (e: React.DragEvent, targetFolderId: string | null, targetKey: string) => {
    if (!e.dataTransfer.types.includes(GALLERY_DRAG_TYPE)) return;
    e.stopPropagation();
    if (isReadOnly || moveInFlightRef.current || (activeDrag && !canDropIntoFolder(activeDrag, targetFolderId))) {
      e.dataTransfer.dropEffect = 'none';
      setDragOverTarget(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(targetKey);
  };

  const handleFolderDragLeave = (e: React.DragEvent) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setDragOverTarget(null);
  };

  const moveMedia = async (requestedIds: string[], targetFolderId: string | null) => {
    if (isReadOnly || moveInFlightRef.current) return;
    if (targetFolderId && !folders.some(folder => folder.id === targetFolderId)) return;
    const ids = getMediaIdsForMove(requestedIds, targetFolderId, images);
    if (ids.length === 0) return;

    moveInFlightRef.current = true;
    setIsMoving(true);
    setMoveError(null);
    try {
      await onMove(ids, targetFolderId);
      // Only clear the media that actually moved, after persistence succeeds.
      // Cancelled/no-op/failed drags leave the current selection untouched.
      const movedIds = new Set(ids);
      const remainingSelection = new Set<string>(selectedIdsRef.current);
      ids.forEach(id => remainingSelection.delete(id));
      setSelectedIds(remainingSelection);
      if (remainingSelection.size === 0) setIsSelectionMode(false);
      setLastSelectedId(previous => previous && movedIds.has(previous) ? null : previous);
      setMoveMenuOpen(false);
    } catch (error) {
      console.error('Gallery move failed:', error);
      setMoveError('Could not move the media. Your selection has been kept; please try again.');
    } finally {
      moveInFlightRef.current = false;
      setIsMoving(false);
    }
  };

  const handleFolderDrop = async (e: React.DragEvent, targetFolderId: string | null) => {
    if (!e.dataTransfer.types.includes(GALLERY_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    const payload = readGalleryDragPayload(e.dataTransfer);
    clearDragState();
    if (isReadOnly || moveInFlightRef.current || !payload || !canDropIntoFolder(payload, targetFolderId)) return;

    if (payload.type === 'image') {
      await moveMedia(payload.ids, targetFolderId);
    } else if (onMoveFolder) {
      const folder = folders.find(item => item.id === payload.id)!;
      moveInFlightRef.current = true;
      setIsMoving(true);
      setMoveError(null);
      setFolders(prev => prev.map(item => item.id === payload.id ? { ...item, parentId: targetFolderId } : item));
      try {
        await onMoveFolder(payload.id, targetFolderId);
      } catch (error) {
        console.error('Gallery folder move failed:', error);
        setFolders(prev => prev.map(item => item.id === payload.id && item.parentId === targetFolderId
          ? { ...item, parentId: folder.parentId }
          : item));
        setMoveError('Could not move the folder. Please try again.');
      } finally {
        moveInFlightRef.current = false;
        setIsMoving(false);
      }
    }
  };

  const toggleSelection = (id: string, multiSelect: boolean) => {
    const newSet = new Set(selectedIds);

    if (multiSelect && lastSelectedId) {
      // Shift+click: select all images between lastSelectedId and current id
      const allIds = visibleImages.map(img => img.id);
      const lastIndex = allIds.indexOf(lastSelectedId);
      const currentIndex = allIds.indexOf(id);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const startIndex = Math.min(lastIndex, currentIndex);
        const endIndex = Math.max(lastIndex, currentIndex);

        // Add all images between start and end (inclusive)
        for (let i = startIndex; i <= endIndex; i++) {
          newSet.add(allIds[i]);
        }
      } else {
        newSet.add(id);
      }
    } else {
      // Normal click: toggle single selection
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
    }

    setSelectedIds(newSet);
    setLastSelectedId(id);
  };

  const handlePreparePhotos = async () => {
    if (!selectedIds.size || photoPreparationRef.current || photoShareInFlightRef.current) return;
    const controller = new AbortController();
    photoPreparationRef.current = controller;
    setIsPreparingPhotos(true);
    setPhotoShareError(null);
    setPhotoShareMessage(null);
    setPreparedPhotos(null);
    const selection = Array.from(selectedIds).map(id => images.find(media => media.id === id));
    try {
      if (selection.some(media => !media)) throw new Error('Some selected photos are no longer available. Select them again.');
      const files = await preparePhotosForSharing(selection as GeneratedMedia[], {
        signal: controller.signal,
        onProgress: (completed, total) => {
          if (!controller.signal.aborted) setPhotoProgress({ completed, total });
        },
      });
      if (!controller.signal.aborted) setPreparedPhotos(files);
    } catch (error) {
      if (!controller.signal.aborted) setPhotoShareError(error instanceof Error ? error.message : 'Photos could not be prepared. Please try again.');
    } finally {
      if (photoPreparationRef.current === controller) {
        photoPreparationRef.current = null;
        setIsPreparingPhotos(false);
      }
    }
  };

  const handleSharePhotos = () => {
    if (!preparedPhotos?.length || photoShareInFlightRef.current) return;
    photoShareInFlightRef.current = true;
    setIsSharingPhotos(true);
    setPhotoShareError(null);
    setPhotoShareMessage(null);
    // The native call happens in this tap, with no asynchronous preparation first.
    sharePreparedPhotos(preparedPhotos)
      .then(result => setPhotoShareMessage(result === 'cancelled'
        ? 'Sharing cancelled. Your photos are still selected.'
        : 'Share sheet closed. Your photos remain selected.'))
      .catch(error => setPhotoShareError(error instanceof Error ? error.message : 'The share sheet could not be opened. Try again.'))
      .finally(() => { photoShareInFlightRef.current = false; setIsSharingPhotos(false); });
  };

  const handleBatchDownload = async () => {
    if (selectedIds.size === 0) return;
    setIsDownloadingBatch(true);
    try {
      const zip = new JSZip();
      const promises = Array.from(selectedIds).map(async (id) => {
        const img = images.find(i => i.id === id);
        if (!img) return;
        const response = await fetch(img.url);
        const blob = await response.blob();
        zip.file(`banana-${id}.${blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'}`, blob);
      });

      await Promise.all(promises);
      const content = await zip.generateAsync({ type: "blob" });
      const url = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `banana-batch-${Date.now()}.zip`;
      link.click();
      window.URL.revokeObjectURL(url);
      setIsSelectionMode(false);
      setSelectedIds(new Set());
    } catch (e) {
      console.error("Batch download failed", e);
    } finally {
      setIsDownloadingBatch(false);
    }
  };

  const handleBatchMove = async (targetFolderId: string | null) => {
    await moveMedia(Array.from(selectedIds), targetFolderId);
  };

  const handleBatchDelete = async () => {
    if (isReadOnly) return;
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} images?`)) return;

    const ids = Array.from(selectedIds);
    if (onDeleteMultiple) {
      await onDeleteMultiple(ids);
    } else {
      // Fallback if not provided (should be provided)
      const toDelete = images.filter(i => selectedIds.has(i.id));
      for (const img of toDelete) {
        onDelete(img);
      }
    }
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  };

  // Download menu state - tracks which image has download options open
  const [downloadMenuId, setDownloadMenuId] = useState<string | null>(null);

  const handleDownloadPNG = async (media: GeneratedMedia) => {
    try {
      const response = await fetch(media.url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const ext = media.mediaType === 'video' ? 'mp4' : blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `banana-${media.id}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
      setDownloadMenuId(null);
    } catch (error) {
      console.error('Download PNG failed:', error);
      window.open(media.url, '_blank');
    }
  };

  const handleDownloadJPEG = async (media: GeneratedMedia) => {
    try {
      const response = await fetch(media.url);
      const blob = await response.blob();

      // Convert to JPEG using canvas
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = URL.createObjectURL(blob);
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context failed');

      // Fill with white background (JPEG doesn't support transparency)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Convert to JPEG at full quality
      canvas.toBlob((jpegBlob) => {
        if (!jpegBlob) {
          console.error('JPEG conversion failed');
          return;
        }

        const blobUrl = URL.createObjectURL(jpegBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `banana-${media.id}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
        setDownloadMenuId(null);
      }, 'image/jpeg', 1.0); // Quality 1.0 = 100%

      URL.revokeObjectURL(img.src);
    } catch (error) {
      console.error('Download JPEG failed:', error);
      window.open(media.url, '_blank');
    }
  };

  const handleDownloadClick = (e: React.MouseEvent, mediaId: string) => {
    e.stopPropagation();
    setDownloadMenuId(downloadMenuId === mediaId ? null : mediaId);
  };

  // Reset download menu when selected media changes
  useEffect(() => {
    setDownloadMenuId(null);
  }, [selectedMediaId]);

  const navigateUp = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (currentFolder) {
      onFolderSelect(currentFolder.parentId || null);
    } else {
      onFolderSelect(null);
    }
  };

  // --- Render ---

  const isEmpty = visibleImages.length === 0 && visibleFolders.length === 0;
  const galleryOwnerName = galleryOwner?.display_name || galleryOwner?.email || 'User';
  const adminGalleryBanner = galleryOwner ? (
    <div className="w-full shrink-0 border-b border-violet-500/20 bg-violet-500/10 px-4 py-3 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 text-left">
          {galleryOwner.avatar_url ? (
            <img src={galleryOwner.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white">
              {galleryOwnerName[0]?.toUpperCase() || '?'}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-white">Viewing {galleryOwnerName}'s gallery</p>
              <span className="rounded-full border border-violet-400/30 bg-violet-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-300">Read only</span>
            </div>
            <p className="truncate text-xs text-gray-400">{galleryOwner.email}</p>
            {isGalleryLoading && <p className="mt-1 text-xs text-violet-300">Loading generations...</p>}
            {galleryLoadError && <p className="mt-1 text-xs text-red-300">Generations unavailable: {galleryLoadError}</p>}
            {folderLoadError && <p className="mt-1 text-xs text-amber-300">Folders unavailable: {folderLoadError}</p>}
          </div>
        </div>
        {onExitAdminGallery && (
          <button
            onClick={onExitAdminGallery}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-violet-500/50 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to my gallery
          </button>
        )}
      </div>
    </div>
  ) : null;

  const searchDialog = isSearchOpen && <GallerySearchDialog images={images} folders={folders} ownerId={galleryOwner?.user_id} isLoading={isGalleryIndexLoading || isFoldersLoading} loadError={galleryLoadError || folderLoadError} onClose={closeSearch} onSelect={selectSearchResult} />;
  if (isEmpty && !currentFolderId && !showFavoritesOnly) {
    return (
      <div className="relative flex-1 flex min-h-screen flex-col bg-[#0d1117] text-gray-600">
        {searchDialog}
        {adminGalleryBanner}
        <button ref={searchButtonRef} onClick={openSearch} aria-label="Search gallery" aria-haspopup="dialog" aria-expanded={isSearchOpen} title="Search gallery (⌘K / Ctrl+K or /)" className="mr-4 mt-4 flex h-10 shrink-0 items-center gap-2 self-end rounded-xl border border-white/10 bg-[#161b22] px-3 text-sm text-gray-300 hover:text-white"><Search className="h-4 w-4" />Search</button>
        {comparisonNotice && <p role="status" className="px-4 py-2 text-xs text-amber-200">{comparisonNotice}</p>}
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          {(isGalleryLoading || isFoldersLoading) ? (
            <>
              <Loader2 className="mb-4 h-9 w-9 animate-spin text-violet-400" />
              <h3 className="text-lg font-semibold text-gray-300">Loading gallery...</h3>
              <p className="mt-2 max-w-md text-sm text-gray-500">Fetching this user's generations and folders.</p>
            </>
          ) : (galleryLoadError || folderLoadError) ? (
            <>
              <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10">
                <AlertCircle className="h-9 w-9 text-red-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-200">Gallery could not be loaded</h3>
              <p className="mt-2 max-w-lg text-sm text-red-300">{galleryLoadError || folderLoadError}</p>
              {folderLoadError && <button onClick={refreshFolders} className="mt-3 text-sm text-violet-300">Retry loading folders</button>}
            </>
          ) : (
            <>
              <div className="w-24 h-24 bg-gray-900 rounded-full flex items-center justify-center mb-6">
                <ZoomIn className="w-10 h-10 opacity-20" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No Generations Yet</h3>
              <p className="max-w-md text-gray-500 mb-6">
                {galleryOwner ? 'This user has no saved image or video generations.' : 'Create your first masterpiece.'}
              </p>
              {!isReadOnly && (
                <button onClick={() => setIsCreatingFolder(true)} className="flex items-center gap-2 text-violet-400 hover:text-violet-300">
                  <FolderPlus className="w-4 h-4" /> Create Folder
                </button>
              )}
              {!isReadOnly && isCreatingFolder && (
                <div className="mt-4 flex gap-2">
                  <input
                    autoFocus
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"
                    placeholder="Folder Name"
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                  />
                  <button onClick={handleCreateFolder} className="bg-violet-600 text-white px-3 py-1 rounded">Save</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  const getMediaDisplayAspectRatio = (media: GeneratedMedia): number => getGalleryAspectRatio(
    media, media.mediaType === 'video' ? detectedVideoAspectRatios[media.id] : detectedImageAspectRatios[media.id],
  );

  const handleImageDimensions = (mediaId: string, width: number, height: number) => {
    if (!width || !height) return;
    const ratio = width / height;
    setDetectedImageAspectRatios(prev => Math.abs((prev[mediaId] || 0) - ratio) < 0.001
      ? prev : { ...prev, [mediaId]: ratio });
  };

  const handleVideoMetadata = (mediaId: string, video: HTMLVideoElement) => {
    if (!video.videoWidth || !video.videoHeight) return;
    const ratio = video.videoWidth / video.videoHeight;
    setDetectedVideoAspectRatios(prev => {
      if (Math.abs((prev[mediaId] || 0) - ratio) < 0.001) return prev;
      return { ...prev, [mediaId]: ratio };
    });
  };

  // Target row height based on grid columns setting
  const targetRowHeight = {
    2: 280,
    3: 220,
    4: 180,
    5: 150,
    6: 130,
    7: 110,
    8: 100,
  }[gridCols] || 180;

  return (
    <div
      ref={scrollContainerRef}
      className={`flex-1 overflow-y-auto overflow-x-clip bg-[#0d1117] relative min-h-screen custom-scrollbar ${isReadOnly ? 'pb-8' : ''} ${dragOverTarget === 'current-folder' ? 'ring-2 ring-inset ring-violet-400/60' : ''}`}
      style={isReadOnly ? undefined : { paddingBottom: 'var(--generation-bar-safe-area, 16rem)' }}
      onDragOver={isReadOnly ? undefined : (e) => handleFolderDragOver(e, currentFolderId, 'current-folder')}
      onDragLeave={handleFolderDragLeave}
      onDrop={isReadOnly ? undefined : (e) => handleFolderDrop(e, currentFolderId)}
      onDragEnd={clearDragState}
    >

      <HelpCenter open={isHelpCenterOpen} onClose={() => setIsHelpCenterOpen(false)} />
      {sharingFolder && !isReadOnly && <FolderShareDialog key={sharingFolder.id} folder={sharingFolder} onClose={() => setSharingFolder(null)} />}

      {isCreatingFolder && !isReadOnly && (
        <div
          className="fixed inset-0 z-[310] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-150"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCreateFolderModal();
          }}
        >
          <div
            ref={createFolderDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-folder-title"
            aria-describedby="create-folder-description"
            className="w-full max-w-md overflow-hidden rounded-3xl border border-white/[0.1] bg-[#141a23] shadow-[0_32px_100px_rgba(0,0,0,0.65)] animate-in zoom-in-95 slide-in-from-bottom-2 duration-200"
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-6">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-violet-400/25 bg-violet-500/15 text-violet-300 shadow-lg shadow-violet-950/20">
                  <FolderPlus className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 id="create-folder-title" className="text-base font-semibold text-white">Create a new folder</h2>
                  <p id="create-folder-description" className="mt-1 truncate text-xs text-gray-500">
                    {currentFolder ? `Inside ${currentFolder.name}` : 'Inside Gallery'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeCreateFolderModal}
                disabled={isSavingFolder}
                aria-label="Close create folder dialog"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.07] text-gray-500 transition-colors hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              className="space-y-5 px-5 py-5 sm:px-6 sm:py-6"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateFolder();
              }}
            >
              <div>
                <label htmlFor="new-folder-name" className="mb-2 block text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Folder name</label>
                <input
                  ref={newFolderInputRef}
                  id="new-folder-name"
                  className="h-12 w-full rounded-xl border border-white/[0.09] bg-black/25 px-4 text-sm text-white outline-none transition-all placeholder:text-gray-600 focus:border-violet-400/55 focus:ring-4 focus:ring-violet-500/10"
                  placeholder="e.g. Campaign concepts"
                  value={newFolderName}
                  maxLength={80}
                  onChange={(event) => {
                    setNewFolderName(event.target.value);
                    if (folderCreateError) setFolderCreateError(null);
                  }}
                  aria-invalid={!!folderCreateError}
                  aria-describedby={folderCreateError ? 'create-folder-error' : undefined}
                  disabled={isSavingFolder}
                />
                <div className="mt-2 flex items-start justify-between gap-3 text-[10px]">
                  <div className="min-h-4 flex-1">
                    {folderCreateError && <p id="create-folder-error" className="text-red-300">{folderCreateError}</p>}
                  </div>
                  <span className="shrink-0 text-gray-600">{newFolderName.length}/80</span>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeCreateFolderModal}
                  disabled={isSavingFolder}
                  className="h-11 rounded-xl border border-white/[0.08] px-4 text-xs font-semibold text-gray-300 transition-colors hover:border-white/15 hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newFolderName.trim() || isSavingFolder}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-600 px-5 text-xs font-semibold text-white shadow-lg shadow-violet-950/25 transition-all hover:-translate-y-0.5 hover:bg-violet-500 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-40"
                >
                  {isSavingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
                  {isSavingFolder ? 'Creating...' : 'Create folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sticky Header Container */}
      <div className="sticky top-0 z-50 flex flex-col">
        {/* Header Bar */}
        <div className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] bg-[#0d1117]/95 px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:px-4 md:flex-nowrap lg:px-6">
          <div className="order-1 flex min-w-0 flex-1 items-center gap-2">
            {currentFolderId && !showFavoritesOnly ? (
              <div
                className={`flex min-w-0 items-center gap-2 rounded-xl ${dragOverTarget === 'parent-folder' ? 'bg-violet-500/15 ring-2 ring-violet-400/60' : ''}`}
                onDragOver={isReadOnly ? undefined : (e) => handleFolderDragOver(e, currentFolder?.parentId || null, 'parent-folder')}
                onDragLeave={handleFolderDragLeave}
                onDrop={isReadOnly ? undefined : (e) => handleFolderDrop(e, currentFolder?.parentId || null)}
              >
                <button onClick={navigateUp} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-[#161b22] text-gray-400 transition-colors hover:border-white/15 hover:text-white" title="Back to parent folder">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <h2 className="min-w-0 truncate text-sm font-semibold text-white sm:text-base">{currentFolder?.name}</h2>
              </div>
            ) : (
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-white sm:text-base">{showFavoritesOnly ? 'Favorites' : 'Gallery'}</h2>
                <p className="hidden text-[11px] text-gray-500 lg:block">{visibleImages.length} items</p>
              </div>
            )}
          </div>

          <div className="order-3 flex w-full min-w-0 items-center gap-2 overflow-x-auto border-t border-white/[0.06] pt-2 no-scrollbar md:order-2 md:w-auto md:overflow-visible md:border-0 md:pt-0">
            <div className="flex shrink-0 items-center gap-1.5" aria-label="Gallery view controls">
              {/* Media Type Filter */}
              <div className="flex h-10 items-center overflow-hidden rounded-xl border border-white/[0.08] bg-[#161b22] p-1">
                <button
                  onClick={() => setMediaFilter('all')}
                  aria-label="Show all media"
                  aria-pressed={mediaFilter === 'all'}
                  className={`grid h-8 w-8 place-items-center rounded-lg transition-colors sm:w-9 ${mediaFilter === 'all' ? 'bg-violet-600 text-white shadow-sm' : 'text-gray-500 hover:bg-white/[0.05] hover:text-white'}`}
                  title="All"
                >
                  <Grid3X3 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setMediaFilter('image')}
                  aria-label="Show images"
                  aria-pressed={mediaFilter === 'image'}
                  className={`grid h-8 w-8 place-items-center rounded-lg transition-colors sm:w-9 ${mediaFilter === 'image' ? 'bg-violet-600 text-white shadow-sm' : 'text-gray-500 hover:bg-white/[0.05] hover:text-white'}`}
                  title="Images"
                >
                  <ImageIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setMediaFilter('video')}
                  aria-label="Show videos"
                  aria-pressed={mediaFilter === 'video'}
                  className={`grid h-8 w-8 place-items-center rounded-lg transition-colors sm:w-9 ${mediaFilter === 'video' ? 'bg-violet-600 text-white shadow-sm' : 'text-gray-500 hover:bg-white/[0.05] hover:text-white'}`}
                  title="Videos"
                >
                  <Play className="h-4 w-4" />
                </button>
              </div>

              <button
                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                aria-label="Toggle favorites"
                aria-pressed={showFavoritesOnly}
                className={`grid h-10 w-10 place-items-center rounded-xl border transition-colors ${showFavoritesOnly ? 'border-pink-400/60 bg-pink-600 text-white' : 'border-white/[0.08] bg-[#161b22] text-gray-400 hover:border-white/15 hover:text-white'}`}
                title="Favorites"
              >
                <Heart className={`h-4 w-4 ${showFavoritesOnly ? 'fill-current' : ''}`} />
              </button>

              <div ref={gridMenuRef} className="relative hidden sm:block">
                <button
                  onClick={() => setIsGridMenuOpen(!isGridMenuOpen)}
                  aria-label="Grid density"
                  aria-expanded={isGridMenuOpen}
                  className={`relative grid h-10 w-10 place-items-center rounded-xl border transition-colors ${isGridMenuOpen ? 'border-violet-400/60 bg-violet-600 text-white' : 'border-white/[0.08] bg-[#161b22] text-gray-400 hover:border-white/15 hover:text-white'}`}
                  title="Grid density"
                >
                  <Grid3X3 className="h-4 w-4" />
                </button>
                {isGridMenuOpen && (
                  <div className="absolute right-0 top-full z-[200] mt-2 w-56 rounded-2xl border border-white/10 bg-[#161b22] p-4 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-white">Grid density</p>
                        <p className="mt-0.5 text-[10px] text-gray-500">{gridCols} columns</p>
                      </div>
                      <Grid3X3 className="h-4 w-4 text-violet-400" />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setGridCols(current => Math.max(2, current - 1))}
                        disabled={gridCols <= 2}
                        aria-label="Decrease grid density and enlarge items"
                        title="Larger items"
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-black/20 text-gray-400 transition-colors hover:border-violet-400/30 hover:bg-violet-500/10 hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/[0.08] disabled:hover:bg-black/20 disabled:hover:text-gray-400"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        aria-label="Grid columns"
                        type="range" min="2" max="8" value={gridCols}
                        onChange={(event) => setGridCols(parseInt(event.target.value, 10))}
                        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg bg-gray-700 accent-violet-500"
                      />
                      <button
                        type="button"
                        onClick={() => setGridCols(current => Math.min(8, current + 1))}
                        disabled={gridCols >= 8}
                        aria-label="Increase grid density and shrink items"
                        title="Smaller items"
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-black/20 text-gray-400 transition-colors hover:border-violet-400/30 hover:bg-violet-500/10 hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/[0.08] disabled:hover:bg-black/20 disabled:hover:text-gray-400"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex justify-between text-[9px] font-medium text-gray-600"><span>Large</span><span>Compact</span></div>
                  </div>
                )}
              </div>
            </div>

              <>
                <div className="h-6 w-px shrink-0 bg-white/[0.08]" />
                <div className="flex shrink-0 items-center gap-1.5" aria-label="Gallery actions">
                  {!isLocalWorkspace() && !isReadOnly && currentFolder && !showFavoritesOnly && <button
                    onClick={() => setSharingFolder(currentFolder)} title="Share folder with URL" aria-label="Share folder with URL"
                    className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-[#161b22] px-3 text-xs font-semibold text-gray-300 hover:text-white">
                    <ShareLink className="h-4 w-4" /><span className="hidden xl:inline">Share</span>
                  </button>}
                  <button
                    onClick={() => { setIsSelectionMode(!isSelectionMode); setSelectedIds(new Set()); }}
                    aria-label={isSelectionMode ? `Exit selection mode, ${selectedIds.size} selected` : 'Select gallery items'}
                    aria-pressed={isSelectionMode}
                    className={`flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors ${isSelectionMode ? 'border-violet-400/60 bg-violet-600 text-white' : 'border-white/[0.08] bg-[#161b22] text-gray-300 hover:border-white/15 hover:text-white'}`}
                    title="Select items"
                  >
                    <MousePointer2 className="h-4 w-4" />
                    <span className="hidden xl:inline">{isSelectionMode ? `Selected (${selectedIds.size})` : 'Select'}</span>
                  </button>
                  {!isReadOnly && <button
                    onClick={openCreateFolderModal}
                    className="flex h-10 items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/15 px-3 text-xs font-semibold text-violet-200 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-300/45 hover:bg-violet-500/25 hover:text-white"
                    title="New Folder"
                  >
                    <FolderPlus className="h-4 w-4" />
                    <span className="hidden xl:inline">New Folder</span>
                  </button>}
                </div>
              </>
          </div>

          <div className="order-2 ml-auto flex shrink-0 items-center gap-1.5 md:order-3 sm:gap-2">
            <button ref={searchButtonRef} onClick={openSearch} aria-label="Search gallery" aria-haspopup="dialog" aria-expanded={isSearchOpen} aria-keyshortcuts="Meta+K Control+K /" title="Search gallery (⌘K / Ctrl+K or /)"
              className="flex h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-[#161b22] px-3 text-gray-400 transition-colors hover:border-violet-400/40 hover:text-white">
              <Search className="h-4 w-4" /><span className="hidden xl:inline text-sm">Search</span><kbd className="hidden 2xl:inline text-[10px] text-gray-500">⌘ / Ctrl K</kbd>
            </button>
            <button
              onClick={() => {
                setIsHelpCenterOpen(true);
                setIsNotificationPanelOpen(false);
                setIsGridMenuOpen(false);
                setIsUserMenuOpen(false);
              }}
              aria-label="Open Help Center"
              aria-haspopup="dialog"
              aria-expanded={isHelpCenterOpen}
              className={`grid h-10 w-10 place-items-center rounded-xl border transition-colors ${isHelpCenterOpen ? 'border-violet-400/60 bg-violet-600 text-white' : 'border-white/[0.08] bg-[#161b22] text-gray-400 hover:border-white/15 hover:text-white'}`}
              title="Help Center"
            >
              <CircleQuestionMark className="h-4 w-4" />
            </button>

            {/* Notification Bell */}
            <div className="relative">
              <button
                ref={notificationButtonRef}
                onClick={() => {
                  setIsNotificationPanelOpen(!isNotificationPanelOpen);
                  setIsGridMenuOpen(false);
                  setIsUserMenuOpen(false);
                }}
                aria-label="Notifications"
                aria-expanded={isNotificationPanelOpen}
                className={`relative grid h-10 w-10 place-items-center rounded-xl border transition-colors ${isNotificationPanelOpen
                    ? 'border-violet-400/60 bg-violet-600 text-white'
                    : toasts.length > 0
                      ? 'border-violet-500/40 bg-[#161b22] text-violet-400 hover:border-violet-400/70'
                      : 'border-white/[0.08] bg-[#161b22] text-gray-400 hover:border-white/15 hover:text-white'
                  }`}
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {toasts.length > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#0d1117] bg-violet-500 px-1 text-[10px] font-bold text-white">
                    {toasts.length > 9 ? '9+' : toasts.length}
                  </span>
                )}
              </button>

              {/* Notification Panel Dropdown */}
              {isNotificationPanelOpen && (
                <div
                  ref={notificationPanelRef}
                  className="fixed left-3 right-3 top-[4.5rem] z-[200] overflow-hidden rounded-2xl border border-gray-700/50 bg-[#161b22] shadow-2xl animate-in slide-in-from-top-2 fade-in duration-200 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[380px] sm:max-w-[calc(100vw-32px)]"
                >
                  {/* Header */}
                  <div className="px-4 py-3 bg-gray-900/50 border-b border-gray-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-violet-400" />
                      <span className="text-sm font-semibold text-white">Notifications</span>
                      <span className="text-xs text-gray-500">({toasts.length})</span>
                    </div>
                    {toasts.length > 0 && onDismissAllToasts && (
                      <button
                        onClick={onDismissAllToasts}
                        className="text-[10px] font-medium text-gray-400 hover:text-red-400 px-2 py-1 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        Clear All
                      </button>
                    )}
                  </div>

                  {/* Notification List */}
                  <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                    {toasts.length === 0 ? (
                      <div className="p-8 text-center">
                        <Bell className="w-10 h-10 text-gray-700 mx-auto mb-3" />
                        <p className="text-sm text-gray-500">No notifications</p>
                        <p className="text-xs text-gray-600 mt-1">Generation updates will appear here</p>
                      </div>
                    ) : (
                      <div className="p-2 space-y-2">
                        {toasts.map((toast) => {
                          const icons: Record<string, React.ReactNode> = {
                            success: <CheckCircle className="w-4 h-4 text-green-400" />,
                            error: <AlertCircle className="w-4 h-4 text-red-400" />,
                            warning: <AlertTriangle className="w-4 h-4 text-yellow-400" />,
                            info: <Info className="w-4 h-4 text-blue-400" />,
                            loading: <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />,
                          };
                          const borderColors: Record<string, string> = {
                            success: 'border-green-500/20',
                            error: 'border-red-500/20',
                            warning: 'border-yellow-500/20',
                            info: 'border-blue-500/20',
                            loading: 'border-violet-500/20',
                          };

                          return (
                            <div
                              key={toast.id}
                              className={`flex items-start gap-3 p-3 rounded-xl border bg-gray-900/50 ${borderColors[toast.type]} group`}
                            >
                              <div className="shrink-0 mt-0.5">{icons[toast.type]}</div>
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-white text-sm truncate">{toast.title}</h4>
                                {toast.message && (
                                  <p className="text-gray-400 text-xs mt-0.5 line-clamp-2">{toast.message}</p>
                                )}
                                {/* Progress Bar for loading */}
                                {toast.type === 'loading' && typeof toast.progress === 'number' && (
                                  <div className="mt-2">
                                    <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-gradient-to-r from-violet-500 to-violet-400 rounded-full transition-all duration-300"
                                        style={{ width: `${toast.progress}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] text-gray-500 mt-1">{Math.round(toast.progress)}%</span>
                                  </div>
                                )}
                              </div>
                              {toast.type !== 'loading' && onDismissToast && (
                                <button
                                  onClick={() => onDismissToast(toast.id)}
                                  className="shrink-0 p-1 text-gray-600 hover:text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Footer with loading summary */}
                  {toasts.filter(t => t.type === 'loading').length > 0 && (
                    <div className="px-4 py-2 border-t border-gray-800 bg-violet-500/5">
                      <div className="flex items-center gap-2 text-xs text-violet-300">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>{toasts.filter(t => t.type === 'loading').length} generation(s) in progress</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Separator + User Menu */}
            {userProfile && (
              <>
                <div className="mx-0.5 hidden h-6 w-px shrink-0 bg-white/[0.08] sm:block" />
                <div ref={userMenuRef} className="relative shrink-0">
                  <button
                    onClick={() => {
                      setIsUserMenuOpen(!isUserMenuOpen);
                      setIsNotificationPanelOpen(false);
                      setIsGridMenuOpen(false);
                    }}
                    aria-label="Open user menu"
                    aria-expanded={isUserMenuOpen}
                    className={`flex h-10 items-center gap-2 rounded-xl border bg-[#161b22] p-1.5 transition-colors ${isUserMenuOpen ? 'border-violet-400/60' : 'border-white/[0.08] hover:border-white/15'}`}
                  >
                    {userProfile.avatar_url ? (
                      <img src={userProfile.avatar_url} alt="" className="h-7 w-7 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-[10px] font-bold text-white">
                        {(userProfile.display_name || userProfile.email || '?')[0].toUpperCase()}
                      </div>
                    )}
                    <span className="hidden max-w-[112px] truncate pr-1 text-xs font-medium text-gray-300 xl:block">
                      {userProfile.display_name || userProfile.email}
                    </span>
                  </button>
                  {isUserMenuOpen && (
                    <div className="absolute top-full right-0 mt-2 w-56 bg-[#161b22] border border-gray-800 rounded-xl shadow-2xl overflow-hidden z-[200] animate-in fade-in slide-in-from-top-1 duration-150">
                      <div className="p-3 border-b border-gray-800">
                        <p className="text-sm font-medium text-white truncate">{userProfile.display_name}</p>
                        <p className="text-xs text-gray-500 truncate">{userProfile.email}</p>
                      </div>
                      <div className="p-1">
                        {!isLocalWorkspace() && userProfile.role === 'admin' && onOpenAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsUserMenuOpen(false);
                              onOpenAdmin();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-violet-300 transition-colors hover:bg-violet-500/10 hover:text-violet-200"
                          >
                            <ShieldCheck className="h-4 w-4" />
                            Admin Dashboard
                          </button>
                        )}
                        {onSignOut && (
                          <button
                            onClick={onSignOut}
                            className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
                          >
                            {isLocalWorkspace() ? 'Close workspace' : 'Sign Out'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {adminGalleryBanner}

        {!isReadOnly && (activeDrag || isMoving || moveError) && (
          <div
            role={moveError ? 'alert' : 'status'}
            className={`flex items-center gap-2 border-b px-4 py-2 text-xs sm:px-6 ${moveError ? 'border-red-400/20 bg-[#25151d] text-red-200' : 'border-violet-400/20 bg-[#1c1531] text-violet-200'}`}
          >
            {isMoving ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5 shrink-0" />}
            <span>{moveError || (isMoving ? 'Moving to folder...' : activeDrag?.type === 'image'
              ? `Dragging ${activeDrag.ids.length} item${activeDrag.ids.length === 1 ? '' : 's'}. Drop on a folder${currentFolderId ? ' or the back arrow' : ''}.`
              : 'Drop the folder on another folder or the back arrow.')}</span>
            {moveError && <button type="button" onClick={() => setMoveError(null)} aria-label="Dismiss move error" className="ml-auto p-1"><X className="h-3.5 w-3.5" /></button>}
          </div>
        )}

        {/* Action Bar (When Selected) */}
        {comparisonNotice && <p role="status" className="px-4 py-2 text-xs text-amber-200">{comparisonNotice}</p>}
        {isSelectionMode && selectedIds.size > 0 && (
          <div className="animate-in slide-in-from-top-2 border-b border-white/[0.07] bg-[#0d1117]/95 px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.14)] backdrop-blur-xl sm:px-4 lg:px-6">
            <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-violet-400/30 bg-violet-500/15 text-violet-300">
                  <Check className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{selectedIds.size} selected</p>
                  <p className="hidden text-[11px] text-gray-500 sm:block">{isReadOnly ? 'Choose images to compare' : 'Compare images, or choose an action'}</p>
                </div>
              </div>

              <div className="order-3 flex w-full flex-wrap items-center gap-1.5 sm:order-none sm:ml-auto sm:w-auto sm:gap-2">
              <button ref={compareButtonRef} type="button" aria-label="Compare selected images" aria-keyshortcuts="C" disabled={comparableSelection.length < 2 || isMoving}
                onClick={() => { setComparisonNotice(null); setComparisonIds(comparableSelection.map(media => media.id)); setMoveMenuOpen(false); }}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/15 px-3 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/25 disabled:opacity-40 sm:flex-none"
                title={comparableSelection.length < 2 ? 'Select at least two available images' : 'Compare selected images (C)'}>
                <Layers className="h-4 w-4" /> Compare <kbd className="rounded border border-violet-400/25 px-1 text-[10px] opacity-70">C</kbd>
              </button>
              {!isReadOnly && <>
              {isPhotoDevice && (
                <button type="button" onClick={preparedPhotos ? handleSharePhotos : handlePreparePhotos}
                  aria-label={preparedPhotos ? 'Save selected images to Photos' : 'Prepare selected images for Photos'}
                  disabled={isMoving || isDownloadingBatch || isPreparingPhotos || isSharingPhotos}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/15 px-3 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/25 disabled:opacity-50 sm:flex-none">
                  {isPreparingPhotos || isSharingPhotos ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  {isPreparingPhotos ? 'Preparing…' : preparedPhotos ? 'Save to Photos' : 'Prepare photos'}
                </button>
              )}
              {!isPhotoDevice && (
                <button
                  onClick={handleBatchDownload}
                  disabled={isDownloadingBatch || isMoving}
                  aria-label="Download selected media as ZIP"
                  className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#161b22] px-3 text-xs font-semibold text-gray-300 transition-colors hover:border-white/15 hover:text-white disabled:cursor-wait disabled:opacity-60"
                >
                  {isDownloadingBatch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  <span className="hidden md:inline">Download ZIP</span>
                </button>
              )}
              </>}
              </div>

              <div className="order-2 ml-auto flex items-center gap-1.5 sm:order-none sm:ml-0 sm:gap-2">
              {!isReadOnly && <>
              <div ref={moveMenuRef} className="relative">
                <button
                  onClick={() => setMoveMenuOpen(!moveMenuOpen)}
                  disabled={isMoving}
                  onDragOver={(e) => {
                    if (isMoving || !e.dataTransfer.types.includes(GALLERY_DRAG_TYPE)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverTarget(null);
                    setMoveMenuOpen(true);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={moveMenuOpen}
                  className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors ${moveMenuOpen ? 'border-violet-400/50 bg-violet-500/15 text-violet-200' : 'border-white/[0.08] bg-[#161b22] text-gray-300 hover:border-white/15 hover:text-white'}`}
                >
                  <FolderOpen className="h-4 w-4" />
                  <span className="hidden sm:inline">Move</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${moveMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {moveMenuOpen && (
                  <div role="menu" className="absolute right-0 top-full z-[200] mt-2 w-72 max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-white/[0.09] bg-[#151a22] shadow-[0_24px_70px_rgba(0,0,0,0.55)] animate-in fade-in slide-in-from-top-2 duration-150 sm:w-80">
                    {/* Header */}
                    <div className="border-b border-white/[0.07] bg-[#11161d] px-4 py-3">
                      <span className="text-xs font-bold uppercase tracking-[0.12em] text-gray-400">Move to folder</span>
                    </div>

                    <div className="max-h-72 space-y-1 overflow-y-auto p-2 custom-scrollbar">
                      {/* Root Directory Option */}
                      <button
                        role="menuitem"
                        onClick={() => handleBatchMove(null)}
                        disabled={isMoving}
                        onDragOver={(e) => handleFolderDragOver(e, null, 'move-menu-root')}
                        onDragLeave={handleFolderDragLeave}
                        onDrop={(e) => handleFolderDrop(e, null)}
                        className={`group flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-white/[0.05] hover:text-white ${dragOverTarget === 'move-menu-root' ? 'bg-violet-500/15 ring-2 ring-inset ring-violet-400/60' : ''}`}
                      >
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.06] bg-[#202735] text-gray-500 transition-colors group-hover:border-violet-400/25 group-hover:bg-violet-500/15 group-hover:text-violet-300">
                          <FolderIcon className="h-5 w-5" />
                        </div>
                        <span className="min-w-0 flex-1 truncate font-semibold">Root Directory</span>
                      </button>

                      {/* Folders List */}
                      {folders.filter(f => f.id !== currentFolderId).length > 0 && (
                        <div className="my-2 border-t border-gray-800" />
                      )}

                      {folders.filter(f => f.id !== currentFolderId).map(f => (
                        <button
                          key={f.id}
                          role="menuitem"
                          onClick={() => handleBatchMove(f.id)}
                          disabled={isMoving}
                          onDragOver={(e) => handleFolderDragOver(e, f.id, `move-menu-${f.id}`)}
                          onDragLeave={handleFolderDragLeave}
                          onDrop={(e) => handleFolderDrop(e, f.id)}
                          className={`group flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-white/[0.05] hover:text-white ${dragOverTarget === `move-menu-${f.id}` ? 'bg-violet-500/15 ring-2 ring-inset ring-violet-400/60' : ''}`}
                        >
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.06] bg-[#202735] text-gray-500 transition-colors group-hover:border-violet-400/25 group-hover:bg-violet-500/15 group-hover:text-violet-300">
                            <FolderIcon className="h-5 w-5" />
                          </div>
                          <span className="min-w-0 flex-1 truncate font-semibold">{f.name}</span>
                        </button>
                      ))}

                      {folders.filter(f => f.id !== currentFolderId).length === 0 && (
                        <div className="text-center py-3 text-gray-600 text-xs">No other folders</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleBatchDelete}
                disabled={isMoving}
                aria-label="Delete selected media"
                className="flex h-10 items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 text-xs font-semibold text-red-300 transition-colors hover:border-red-400/35 hover:bg-red-500/15 hover:text-red-200"
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Delete</span>
              </button>
              </>}

              <button
                onClick={() => {
                  setMoveMenuOpen(false);
                  setSelectedIds(new Set());
                  setIsSelectionMode(false);
                }}
                aria-label="Exit selection mode"
                className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-[#161b22] text-gray-500 transition-colors hover:border-white/15 hover:text-white"
                title="Exit selection"
              >
                <X className="h-4 w-4" />
              </button>
              </div>
            </div>
            {selectedIds.size > comparableSelection.length && <p role="status" className="mt-2 text-[11px] text-gray-400">{selectedIds.size - comparableSelection.length} unavailable or non-image items excluded from comparison</p>}
            {!isReadOnly && isPhotoDevice && (
              <div className="mt-2 border-t border-white/[0.06] pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p role="status" className="text-xs text-gray-400">
                    {isPreparingPhotos ? `Preparing photos ${photoProgress.completed}/${photoProgress.total || selectedIds.size}…`
                      : preparedPhotos ? `${preparedPhotos.length} photos ready. Choose “Save ${preparedPhotos.length === 1 ? 'Image' : 'Images'}” in the share sheet.`
                      : 'Save originals to Photos using your phone’s share sheet.'}
                  </p>
                  {isPreparingPhotos && (
                    <button type="button" className="rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-300" onClick={() => {
                      photoPreparationRef.current?.abort(); photoPreparationRef.current = null; setIsPreparingPhotos(false);
                    }}>Cancel</button>
                  )}
                </div>
                {(photoShareError || photoShareMessage) && <p role={photoShareError ? 'alert' : 'status'} className={`mt-2 text-xs ${photoShareError ? 'text-red-300' : 'text-gray-400'}`}>{photoShareError || photoShareMessage}</p>}
                <button type="button" onClick={handleBatchDownload} disabled={isDownloadingBatch || isPreparingPhotos || isSharingPhotos || isMoving}
                  className="mt-2 text-[11px] text-gray-500 underline underline-offset-2 disabled:opacity-50">Download ZIP to Files instead</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-6 md:p-8">

        {/* Newest batches first, with each brainstorm idea's variants adjacent. */}
        <div className="flex flex-wrap items-start gap-3 after:content-[''] after:flex-grow-[10] after:h-0">

          {/* Folders */}
          {visibleFolders.map(folder => {
            const isRenaming = renamingFolderId === folder.id;
            const isDropTarget = dragOverTarget === `folder-${folder.id}`;
            const dropItemCount = isDropTarget && activeDrag?.type === 'image'
              ? getMediaIdsForMove(activeDrag.ids, folder.id, images).length
              : 0;
            const folderAspectRatio = 16 / 9;
            const folderWidth = targetRowHeight * folderAspectRatio;
            const childFolderCount = folderStats.get(folder.id)?.directChildFolderCount || 0;
            const folderItemCount = folderStats.get(folder.id)?.itemCount || 0;
            return (
              <div
                key={folder.id}
                data-gallery-folder-id={folder.id}
                draggable={!isReadOnly && !isMoving && !isRenaming}
                onDragStart={(e) => handleDragStart(e, 'folder', folder.id)}
                onDragOver={isReadOnly ? undefined : (e) => handleFolderDragOver(e, folder.id, `folder-${folder.id}`)}
                onDragLeave={handleFolderDragLeave}
                onDrop={isReadOnly ? undefined : (e) => handleFolderDrop(e, folder.id)}
                onClick={() => !isRenaming && onFolderSelect(folder.id)}
                style={{ width: folderWidth, height: targetRowHeight, flexGrow: folderAspectRatio }}
                className={`group relative min-w-0 max-w-full basis-full cursor-pointer overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121923] shadow-[0_14px_35px_rgba(0,0,0,0.18)] transition-all hover:-translate-y-0.5 hover:border-violet-400/35 hover:shadow-[0_20px_45px_rgba(0,0,0,0.28)] sm:basis-auto ${isDropTarget ? 'ring-2 ring-violet-400 bg-violet-500/15' : ''}`}
              >
                {isDropTarget && (
                  <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-violet-950/85 p-3 text-center text-sm font-semibold text-violet-100">
                    {activeDrag?.type === 'image' ? `Move ${dropItemCount} item${dropItemCount === 1 ? '' : 's'} here` : 'Move here'}
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(139,92,246,0.13),transparent_44%)]" />
                <FolderPreview key={`${galleryOwner?.user_id || 'self'}:${folder.id}`} media={folderPreviews.get(folder.id) || []} />
                {isRenaming ? (
                  <div className="absolute inset-0 z-30 flex flex-col justify-center gap-2 bg-[#121923]/95 p-4 backdrop-blur-md" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-2 text-xs font-semibold text-violet-200"><Pencil className="h-3.5 w-3.5" />Rename folder</div>
                    <input
                      autoFocus
                      className="h-9 w-full rounded-lg border border-violet-400/30 bg-black/30 px-2.5 text-xs text-white outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/10"
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRenameFolder()}
                    />
                    <div className="flex w-full gap-1.5">
                      <button onClick={() => setRenamingFolderId(null)} className="h-8 flex-1 rounded-lg border border-white/[0.07] text-[10px] font-semibold text-gray-400 hover:bg-white/[0.04] hover:text-white">Cancel</button>
                      <button onClick={handleRenameFolder} disabled={!newFolderName.trim()} className="h-8 flex-1 rounded-lg bg-violet-600 text-[10px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40">Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="relative z-10 flex h-full flex-col justify-between p-4 sm:p-5">
                      <div className="grid h-11 w-11 place-items-center rounded-xl border border-violet-400/20 bg-violet-500/15 text-violet-300 shadow-lg shadow-violet-950/20 transition-colors group-hover:border-violet-400/35 group-hover:bg-violet-500/20">
                        <FolderIcon className="h-5 w-5 fill-violet-500/10" />
                      </div>
                      <div className="max-w-[78%] min-w-0">
                        <span className="block truncate text-sm font-semibold text-gray-200 transition-colors group-hover:text-white sm:text-[15px]">{folder.name}</span>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
                          <span className="rounded-full border border-white/[0.07] bg-black/20 px-2 py-0.5 text-gray-500">{folderItemCount} item{folderItemCount === 1 ? '' : 's'}</span>
                          {childFolderCount > 0 && <span className="rounded-full border border-white/[0.07] bg-black/20 px-2 py-0.5 text-gray-500">{childFolderCount} folder{childFolderCount === 1 ? '' : 's'}</span>}
                          {(folderStats.get(folder.id)?.totalCost || 0) > 0 && (
                            <span className="rounded-full border border-emerald-400/15 bg-emerald-500/[0.08] px-2 py-0.5 text-emerald-400/90">~${(folderStats.get(folder.id)?.totalCost || 0).toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {!isReadOnly && <div className="absolute right-2.5 top-2.5 z-20 flex gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                      {!isLocalWorkspace() && <button onClick={event => { event.stopPropagation(); setSharingFolder(folder); }} title="Share folder with URL" aria-label={`Share ${folder.name} with URL`}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-black/55 text-gray-400 backdrop-blur-sm hover:text-white"><ShareLink className="h-3.5 w-3.5" /></button>}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingFolderId(folder.id);
                          setNewFolderName(folder.name);
                        }}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-black/55 text-gray-400 backdrop-blur-sm transition-colors hover:border-white/15 hover:text-white"
                        title="Rename"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFolder(folder);
                        }}
                        disabled={deletingFolderId === folder.id}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-black/55 text-gray-400 backdrop-blur-sm transition-colors hover:border-red-400/30 hover:text-red-300 disabled:cursor-wait disabled:opacity-60"
                        title="Delete folder and contents"
                      >
                        {deletingFolderId === folder.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>}
                  </>
                )}
              </div>
            );
          })}

          {/* Images */}
          {visibleImages.map((media) => {
            const isSelected = selectedIds.has(media.id);
            const aspectRatio = getMediaDisplayAspectRatio(media);
            const cardStyle = getGalleryCardStyle(aspectRatio, targetRowHeight);

            if (media.isLoading) {
              const isVideoLoading = media.mediaType === 'video';
              const isPreparingImage = !isVideoLoading && media.imageStage === 'preparing';
              const isQueuedImage = !isVideoLoading && media.imageStage === 'queued';
              const isSavingVideo = isVideoLoading && media.videoStage === 'saving' && !!media.url;
              const rawProgress = isPreparingImage || isQueuedImage ? undefined : isVideoLoading ? media.videoProgress : media.imageProgress;
              const estimatedProgress = !isVideoLoading && !isPreparingImage && !isQueuedImage && media.imageModel === 'gpt-image-2.5-sunburst';
              const pct = rawProgress != null ? Math.max(0, Math.min(100, Math.round(rawProgress * 100))) : estimatedProgress ? 0 : null;
              if (isSavingVideo) {
                return (
                  <div
                    key={media.id}
                    style={cardStyle}
                    className="bg-gray-900 rounded-2xl border border-violet-500/40 relative overflow-hidden shadow-lg group"
                  >
                    <video
                      src={media.url}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-contain"
                      onClick={(e) => e.stopPropagation()}
                      onLoadedMetadata={(e) => handleVideoMetadata(media.id, e.currentTarget)}
                      onError={() => handleImageBroken(media.id)}
                    />
                    <div className="absolute top-2 left-2 pointer-events-none flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-black/75 px-2.5 py-1 text-[10px] font-semibold text-violet-200 backdrop-blur-sm">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving to Gallery...
                    </div>
                  </div>
                );
              }
              const loadingTitle = isVideoLoading
                ? (pct != null && pct > 0 ? 'Generating video' : 'Starting video')
                : isPreparingImage ? 'Preparing image' : isQueuedImage ? 'Queued' : 'Generating image';
              const showLoadingProgress = pct != null && (pct > 0 || estimatedProgress);
              return (
                <div
                  key={media.id}
                  style={cardStyle}
                  className="bg-[#111821] rounded-2xl border border-violet-500/20 flex flex-col items-center justify-center relative overflow-hidden group"
                  role="status"
                  aria-live="polite"
                  aria-label={`${loadingTitle}${showLoadingProgress ? ` ${estimatedProgress ? 'estimated ' : ''}${pct}%` : ''}`}
                  title={estimatedProgress ? 'Estimated progress. OpenAI does not report a completion percentage.' : undefined}
                >
                  {isVideoLoading && !isReadOnly && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(media); }}
                      className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-black/60 hover:bg-red-500 text-white flex items-center justify-center transition-colors opacity-70 hover:opacity-100"
                      title="Cancel generation and remove"
                      aria-label="Cancel generation"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {isPreparingImage && media.brainstormBatchId && onCancelBrainstorm && !isReadOnly && (
                    <button onClick={() => onCancelBrainstorm(media.brainstormBatchId!)} aria-label="Cancel brainstorm batch"
                      title="Cancel all images in this brainstorm batch before generation starts"
                      className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-gray-400 hover:bg-red-500 hover:text-white">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.09),transparent_58%)]" />
                  <div className="relative flex max-w-full flex-col items-center px-3 text-center">
                    <div className="grid h-12 w-12 place-items-center rounded-full border border-violet-400/10 bg-violet-500/[0.07]">
                      <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-violet-400/30 border-t-violet-400" />
                    </div>
                    <div className="mt-3 flex flex-col items-center gap-0.5 leading-none">
                      <span className="whitespace-nowrap text-[11px] font-medium tracking-wide text-gray-300">
                        {loadingTitle}
                      </span>
                      {isQueuedImage && <span className="mt-1 text-[10px] leading-snug text-gray-500">{media.imageQueueWaitReason === 'quota'
                        ? 'OpenAI balance or spend limit needs attention. Job saved; checks again automatically.'
                        : media.imageQueueWaitReason === 'rate' ? 'Waiting for OpenAI rate limit. Starts automatically.' : 'Starts automatically when a slot is available'}</span>}
                      {showLoadingProgress && (
                        <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-violet-300">
                          {estimatedProgress ? 'Est. ' : ''}{pct}%
                        </span>
                      )}
                    </div>
                  </div>
                  {pct != null && (
                    <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/30">
                      <div
                        className="h-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-500 ease-out"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div
                key={media.id}
                data-gallery-media-id={media.id}
                draggable={!isReadOnly && !isMoving}
                onDragStart={(e) => handleDragStart(e, 'image', media.id, media)}
                onClick={(e) => {
                  if (e.shiftKey && !isSelectionMode) {
                    setIsSelectionMode(true);
                    setSelectedIds(new Set([media.id]));
                    setLastSelectedId(media.id);
                    setSelectedMediaId(null);
                  } else if (isSelectionMode) {
                    toggleSelection(media.id, e.shiftKey);
                  } else {
                    setSelectedMediaId(media.id);
                  }
                }}
                style={cardStyle}
                className={`group relative bg-gray-800 rounded-2xl overflow-hidden border transition-all shadow-lg ${isSelected
                    ? 'border-violet-500 ring-2 ring-violet-500/50 scale-[0.98]'
                    : 'border-gray-700/50 hover:border-violet-500/50 hover:shadow-xl'
                  }`}
              >
                {isSelectionMode && (
                  <div className={`absolute top-2 left-2 z-20 w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${isSelected ? 'bg-violet-600 border-violet-600' : 'bg-black/40 border-gray-400'}`}>
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </div>
                )}

                {/* Favorite Button Overlay */}
                {!isReadOnly && !isSelectionMode && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onToggleFavorite) onToggleFavorite(media);
                    }}
                    className={`absolute top-2 right-2 z-20 p-2 rounded-full transition-all ${media.isFavorite ? 'bg-pink-600 text-white' : 'bg-black/40 text-white/50 hover:bg-black/60 hover:text-white'}`}
                  >
                    <Heart className={`w-4 h-4 ${media.isFavorite ? 'fill-current' : ''}`} />
                  </button>
                )}

                {media.mediaType === 'video' ? (
                  <div className="w-full h-full bg-gray-900 relative">
                    {media.status === 'failed' ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3">
                        <AlertCircle className="w-8 h-8 text-red-500" />
                        <span className="text-[10px] text-red-400 text-center line-clamp-3">{media.error || 'Generation failed'}</span>
                        {!isReadOnly && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onDelete(media); }}
                            className="px-2 py-1 bg-red-600/80 hover:bg-red-500 rounded text-white text-[10px] font-medium"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ) : media.url && !brokenImageIds.has(media.id) ? (
                      <>
                        <LazyVideoPreview
                          src={media.url}
                          poster={media.thumbnailUrl}
                          onLoadedMetadata={(video) => handleVideoMetadata(media.id, video)}
                          onError={() => handleImageBroken(media.id)}
                        />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20">
                            <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                          </div>
                        </div>
                      </>
                    ) : !media.url ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
                      </div>
                    ) : null /* broken: handled by the broken-image overlay below */}
                  </div>
                ) : media.status === 'failed' ? (
                  <div className="w-full h-full bg-gray-900 flex flex-col items-center justify-center gap-2 p-3">
                    <AlertCircle className="w-8 h-8 text-red-500" />
                    <span className="text-[10px] text-red-400 text-center line-clamp-3">{media.error || 'Generation failed'}</span>
                    {!isReadOnly && (
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {media.imageStage !== 'preparing' && <RecoverImageButton media={media} onRecover={onRecoverImage} />}
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(media); }}
                          className="px-2 py-1 bg-red-600/80 hover:bg-red-500 rounded text-white text-[10px] font-medium"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <LazyImage
                    src={media.url}
                    thumbSrc={media.thumbnailUrl}
                    alt={media.prompt}
                    className="absolute inset-0 bg-gray-900"
                    onLoadedDimensions={(width, height) => handleImageDimensions(media.id, width, height)}
                    onError={() => handleImageBroken(media.id)}
                  />
                )}

                {/* Persistent delete button for broken images — always visible */}
                {brokenImageIds.has(media.id) && !isSelectionMode && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 bg-gray-900/90">
                    <AlertCircle className="w-7 h-7 text-red-400" />
                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                      {media.mediaType === 'video' ? 'Video unavailable' : 'Broken image'}
                    </span>
                    <span className="text-[9px] text-gray-500 max-w-[80%] text-center leading-tight">
                      {media.error || 'Source URL may have expired'}
                    </span>
                    {!isReadOnly && <div className="flex items-center gap-2">
                      {media.mediaType === 'video' && media.taskId && onRecoverVideo && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRecoverBrokenVideo(media); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600/90 hover:bg-violet-500 rounded-lg text-white text-xs font-medium transition-colors shadow-lg"
                          title="Retry recovery from EvoLink"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Retry
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(media); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/90 hover:bg-red-500 rounded-lg text-white text-xs font-medium transition-colors shadow-lg"
                        title="Delete broken media"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>}
                  </div>
                )}

                {media.mediaType !== 'video' && hasImageSizeMismatch(media) && !media.isLoading && (
                  <div className="absolute bottom-2 left-2 right-2 pointer-events-none group-hover:opacity-0 transition-opacity">
                    <span className="inline-flex items-center gap-1 rounded-lg border border-amber-400/30 bg-gray-950/90 px-2 py-1 text-[10px] font-semibold text-amber-200">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {media.imageOutputSize} · requested {media.imageRequestedSize}
                    </span>
                  </div>
                )}
                {!isSelectionMode && media.status !== 'failed' && !brokenImageIds.has(media.id) && (
                  <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex flex-col justify-end pointer-events-none ${aspectRatio < 1 ? 'p-2' : 'p-4'}`}>
                    <div className="pointer-events-auto">
                      <div className={`mb-2 flex flex-wrap items-center gap-1.5 font-mono font-semibold ${aspectRatio < 1 ? 'text-[9px]' : 'text-[10px]'}`}>
                        <span title={hasImageSizeMismatch(media) ? `Output size differs. Requested: ${media.imageRequestedSize}` : undefined} className={`rounded-full border px-2 py-0.5 shadow-sm backdrop-blur-sm ${hasImageSizeMismatch(media) ? 'border-amber-400/30 bg-black/70 text-amber-200' : 'border-white/[0.1] bg-black/45 text-gray-200'}`}>
                          {media.mediaType === 'video' ? media.videoQuality || '720p' : getImageResolutionLabel(media)}
                        </span>
                        {media.mediaType === 'video' && media.generationCost && (
                          <span className="rounded-full border border-emerald-400/20 bg-emerald-500/[0.12] px-2 py-0.5 text-emerald-300 shadow-sm backdrop-blur-sm">
                            ${media.generationCost.usd.toFixed(2)}
                          </span>
                        )}
                      </div>
                      <div className={`grid ${isReadOnly ? 'grid-cols-1 gap-1' : aspectRatio < 1 ? 'grid-cols-2 gap-1' : onEditGenerate && media.mediaType !== 'video' ? 'grid-cols-5 gap-2' : 'grid-cols-4 gap-2'}`}>
                        {!isReadOnly && (
                          <>
                            {onEditGenerate && isComparableImage(media) && <button type="button" onClick={(e) => { e.stopPropagation(); setEditingMediaId(media.id); setSelectedMediaId(media.id); }} aria-label={`Edit image ${media.id}`} className={`${aspectRatio < 1 ? 'p-1.5' : 'p-2'} bg-lime-400/90 hover:bg-lime-300 rounded-lg text-black transition-colors backdrop-blur-sm flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300`} title="Edit image"><Pencil className={aspectRatio < 1 ? 'w-3.5 h-3.5' : 'w-5 h-5'} /></button>}
                            <button onClick={(e) => { e.stopPropagation(); onRecreate(media); }} className={`${aspectRatio < 1 ? 'p-1.5' : 'p-2'} bg-gray-800/80 hover:bg-violet-600 rounded-lg text-white/90 hover:text-white transition-colors backdrop-blur-sm flex items-center justify-center`} title="Re-create"><RotateCcw className={aspectRatio < 1 ? 'w-3.5 h-3.5' : 'w-5 h-5'} /></button>
                            <button onClick={(e) => { e.stopPropagation(); onUseAsReference(media); }} className={`${aspectRatio < 1 ? 'p-1.5' : 'p-2'} bg-gray-800/80 hover:bg-violet-600 rounded-lg text-white/90 hover:text-white transition-colors backdrop-blur-sm flex items-center justify-center`} title="Use as Reference"><ImagePlus className={aspectRatio < 1 ? 'w-3.5 h-3.5' : 'w-5 h-5'} /></button>
                          </>
                        )}
                        {/* Download Button */}
                        {media.mediaType === 'video' ? (
                          <button onClick={(e) => { e.stopPropagation(); handleDownloadPNG(media); }} className={`${aspectRatio < 1 ? 'p-1.5' : 'p-2'} bg-gray-800/80 hover:bg-violet-600 rounded-lg text-white/90 hover:text-white transition-colors backdrop-blur-sm flex items-center justify-center`} title="Download Video"><Download className={aspectRatio < 1 ? 'w-3.5 h-3.5' : 'w-5 h-5'} /></button>
                        ) : downloadMenuId === media.id ? (
                          <div className={`flex gap-0.5 ${aspectRatio < 1 ? '' : ''}`}>
                            <button onClick={(e) => { e.stopPropagation(); handleDownloadPNG(media); }} className={`flex-1 ${aspectRatio < 1 ? 'p-1 text-[8px]' : 'p-1.5 text-[10px]'} bg-violet-600 hover:bg-violet-500 rounded-l-lg text-white transition-colors backdrop-blur-sm flex items-center justify-center font-bold`} title="Download original">{media.openaiImageOptions?.outputFormat.toUpperCase() || 'PNG'}</button>
                            <button onClick={(e) => { e.stopPropagation(); handleDownloadJPEG(media); }} className={`flex-1 ${aspectRatio < 1 ? 'p-1 text-[8px]' : 'p-1.5 text-[10px]'} bg-violet-600 hover:bg-violet-500 rounded-r-lg text-white transition-colors backdrop-blur-sm flex items-center justify-center font-bold`} title="Download JPEG">JPG</button>
                          </div>
                        ) : (
                          <button onClick={(e) => handleDownloadClick(e, media.id)} className={`${aspectRatio < 1 ? 'p-1.5' : 'p-2'} bg-gray-800/80 hover:bg-violet-600 rounded-lg text-white/90 hover:text-white transition-colors backdrop-blur-sm flex items-center justify-center`} title="Download"><Download className={aspectRatio < 1 ? 'w-3.5 h-3.5' : 'w-5 h-5'} /></button>
                        )}
                        {!isReadOnly && <button onClick={(e) => { e.stopPropagation(); onDelete(media); }} className={`${aspectRatio < 1 ? 'p-1.5' : 'p-2'} bg-red-900/50 hover:bg-red-500 rounded-lg text-white/90 hover:text-white transition-colors backdrop-blur-sm flex items-center justify-center`} title="Delete"><Trash2 className={aspectRatio < 1 ? 'w-3.5 h-3.5' : 'w-5 h-5'} /></button>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Load More Indicator */}
        {hasMoreImages && (
          <div className="flex justify-center py-8">
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <div className="w-4 h-4 border-2 border-gray-600 border-t-violet-500 rounded-full animate-spin" />
              <span>Loading more images...</span>
            </div>
          </div>
        )}
      </div>

      {/* Reference Image Preview Popup */}
      {previewRefImage && (
        <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex items-center justify-center p-8 animate-in fade-in duration-200" onClick={() => setPreviewRefImage(null)}>
          <button className="absolute top-4 right-4 p-2 bg-gray-800 rounded-full text-white hover:bg-gray-700"><X className="w-6 h-6" /></button>
          <img src={previewRefImage.data} alt="Reference" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {comparisonIds && <ImageCompareDialog images={comparisonImages} onClose={closeComparison}
        onToggleFavorite={onToggleFavorite} isReadOnly={isReadOnly} loadDetails={loadComparisonDetails} refreshSource={refreshComparisonSource} />}

      {isYouTubePreviewOpen && selectedMedia && isComparableImage(selectedMedia) && <YouTubePreviewDialog
        media={selectedMedia}
        currentIndex={previewIndex} totalImages={previewImages.length} favoritesOnly={showFavoritesOnly}
        onNavigate={direction => handleNavigate(direction, true)}
        initialTitle={folders.find(folder => folder.id === selectedMedia.folderId)?.name || selectedMedia.referenceImages?.find(ref => ref.youtubeSource?.title)?.youtubeSource?.title || 'Your next video'}
        channelName={galleryOwner?.display_name || userProfile?.display_name}
        onClose={() => setIsYouTubePreviewOpen(false)} refreshSource={refreshComparisonSource} />}

      {/* Detail Modal */}
      {searchDialog}

      {selectedMedia && !comparisonIds && !isSearchOpen && !isSelectionMode && !selectedMedia.isLoading && (
        <div className="fixed inset-0 z-[150] flex flex-col md:flex-row bg-[#0d1117] animate-in fade-in duration-200 overflow-y-auto md:overflow-hidden">
          <div
            ref={viewerRef}
            className={`flex flex-col items-center ${detailViewerLayout} p-4 md:p-10 relative bg-black/80 backdrop-blur-sm min-w-0 md:h-full group shrink-0`}
            data-gallery-viewer="true"
            style={{ touchAction: selectedMedia.mediaType === 'video' ? 'auto' : 'pan-y pinch-zoom', transform: 'translateY(var(--gallery-pull-y, 0px))', opacity: 'var(--gallery-pull-opacity, 1)' }}
            onTouchStart={handleViewerTouchStart}
            onTouchMove={handleViewerTouchMove}
            onTouchEnd={handleViewerTouchEnd}
            onTouchCancel={() => { viewerSwipeRef.current = null; resetViewerPull(); }}
            onClickCapture={(event) => {
              if (Date.now() < suppressViewerClickUntilRef.current) { event.preventDefault(); event.stopPropagation(); }
            }}
            onClick={() => setSelectedMediaId(null)}
          >
            <div data-gallery-viewer-toolbar className={`${isEditingSelectedMedia ? 'mb-3 flex w-full shrink-0 justify-end' : 'absolute right-4 top-4 z-50 flex'} items-center gap-2`}>
              <button type="button" data-gallery-details-toggle aria-label={isDetailsVisible ? 'Hide details' : 'Show details'} aria-expanded={isDetailsVisible} aria-controls="gallery-details-pane" aria-keyshortcuts="Shift+B" title={`${isDetailsVisible ? 'Hide' : 'Show'} details (Shift+B)`}
                onClick={event => { event.stopPropagation(); setIsDetailsVisible(visible => !visible); }}
                className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/60 px-3 text-xs font-medium text-gray-200 backdrop-blur-sm transition-colors hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/50">
                {isDetailsVisible ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}Details
              </button>
              <button type="button" className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-black/60 text-gray-300 backdrop-blur-sm transition-colors hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/50" aria-label="Close image viewer" title="Close viewer (Esc)" onClick={event => { event.stopPropagation(); setSelectedMediaId(null); }}><X className="h-5 w-5" /></button>
            </div>

            {/* Previous Button */}
            {!isEditingSelectedMedia && selectedIndex > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); handleNavigate(-1); }}
                aria-label="Previous gallery item"
                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/40 hover:bg-black/80 rounded-full text-white transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 z-50 shadow-lg border border-white/10"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            {/* Next Button */}
            {!isEditingSelectedMedia && selectedIndex >= 0 && selectedIndex < navigableImages.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); handleNavigate(1); }}
                aria-label="Next gallery item"
                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/40 hover:bg-black/80 rounded-full text-white transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 z-50 shadow-lg border border-white/10"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}

            {!isEditingSelectedMedia && selectedIndex >= 0 && navigableImages.length > 1 && (
              <div className="absolute bottom-2 left-1/2 z-20 max-w-[calc(100%-16px)] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/75 pointer-events-none" aria-live="polite">
                {selectedIndex + 1} / {navigableImages.length}{selectedMedia.mediaType !== 'video' && <span className="md:hidden"> · Swipe to browse · Swipe down to close</span>}
              </div>
            )}

            {selectedMedia.mediaType === 'video' ? (
              brokenImageIds.has(selectedMedia.id) ? (
                <div className="flex flex-col items-center gap-4 text-center text-gray-400 max-w-md p-8">
                  <AlertCircle className="w-12 h-12 text-red-400" />
                  <span className="text-sm font-semibold">Video unavailable</span>
                  <span className="text-xs text-gray-500">
                    {selectedMedia.error || 'The source URL is no longer accessible. EvoLink media URLs expire after a period of time and the file was not cached locally.'}
                  </span>
                  {!isReadOnly && <div className="flex items-center gap-2">
                    {selectedMedia.taskId && onRecoverVideo && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRecoverBrokenVideo(selectedMedia); setSelectedMediaId(null); }}
                        className="flex items-center gap-1.5 px-3 py-2 bg-violet-600/90 hover:bg-violet-500 rounded-lg text-white text-xs font-medium transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Retry recovery
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(selectedMedia); setSelectedMediaId(null); }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-red-600/90 hover:bg-red-500 rounded-lg text-white text-xs font-medium transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove from gallery
                    </button>
                  </div>}
                </div>
              ) : (
                <CustomVideoPlayer
                  src={selectedMedia.url}
                  onError={() => handleImageBroken(selectedMedia.id)}
                />
              )
            ) : !isEditingSelectedMedia ? savedEditSource.source ? (
              <ImageEditComparison key={`${selectedMedia.id}:${savedEditSource.source.id}`} source={savedEditSource.source} result={selectedMedia} refreshSource={refreshComparisonSource} expanded={!isDetailsVisible} fill normalResult={normalDetailImage} />
            ) : <>
              {normalDetailImage}
              {savedEditSource.isEditedImage && <div className="flex shrink-0 items-center gap-2 py-2 text-xs text-gray-500" role="status" onClick={event => event.stopPropagation()}>
                {savedEditSource.loadingSource ? 'Loading source for comparison…' : 'Source image unavailable for comparison.'}
                {savedEditSource.canRetrySource && <button type="button" onClick={savedEditSource.retrySource} className="rounded-md px-2 py-1 text-gray-300 hover:bg-white/5 hover:text-white">Retry</button>}
              </div>}
            </> : null}
            {canEditSelectedMedia && (isEditingSelectedMedia || isDetailsVisible) && <div className={`w-full flex shrink-0 flex-col items-center ${isEditingSelectedMedia ? 'md:my-auto' : ''}`} onClick={event => event.stopPropagation()}>
              <GalleryImageEditor key={selectedMedia.id} image={selectedMedia} images={images} isEditing={isEditingSelectedMedia} onStart={() => setEditingMediaId(selectedMedia.id)} onGenerate={onEditGenerate!} onClose={() => setEditingMediaId(null)} onEditResult={result => { setSelectedMediaId(result.id); setEditingMediaId(result.id); }} initialTextModel={imageEditTextModel} refreshSource={refreshComparisonSource} />
            </div>}
          </div>

          <div id="gallery-details-pane" data-gallery-details-pane hidden={!isDetailsVisible} className={`w-full md:w-[400px] bg-[#161b22] border-l border-gray-800 ${isDetailsVisible ? 'flex' : 'hidden'} flex-col min-h-[50vh] md:h-full shrink-0 shadow-2xl`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-white">{isEditingSelectedMedia ? 'Source details' : 'Details'}</h3>
              <button onClick={() => setSelectedMediaId(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Prompt */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{selectedMedia.imageGenerationPrompt ? 'Generation prompt' : 'Prompt'}</h4>
                  <button
                    onClick={() => handleCopyPrompt(selectedMedia.imageGenerationPrompt || selectedMedia.prompt || '')}
                    disabled={!selectedMedia.imageGenerationPrompt && !selectedMedia.prompt}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                      promptCopied
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                    title={promptCopied ? 'Copied' : 'Copy prompt'}
                  >
                    {promptCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {promptCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className={`bg-gray-800/50 rounded-xl p-4 border border-gray-700/50 ${selectedMedia.imageGenerationPrompt ? 'max-h-80 overflow-y-auto' : ''}`}>
                  <div className="whitespace-pre-wrap break-words text-sm text-gray-300 leading-relaxed">
                    {selectedMedia.imageGenerationPrompt || selectedMedia.prompt}
                  </div>
                </div>
              </div>

              <PromptPreparationDetails media={selectedMedia} />

              {selectedMedia.providerExpandedPrompt && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Provider Expanded Prompt</h4>
                      <p className="mt-1 text-[10px] text-gray-600">Final prompt returned by fal.ai</p>
                    </div>
                    <button
                      onClick={() => handleCopyProviderPrompt(selectedMedia.providerExpandedPrompt || '')}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                        providerPromptCopied
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700'
                      }`}
                      title={providerPromptCopied ? 'Copied' : 'Copy provider-expanded prompt'}
                    >
                      {providerPromptCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {providerPromptCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="bg-violet-500/5 rounded-xl p-4 border border-violet-500/20">
                    <div className="whitespace-pre-wrap break-words text-sm text-gray-300 leading-relaxed">
                      {selectedMedia.providerExpandedPrompt}
                    </div>
                  </div>
                </div>
              )}

              {selectedMedia.generationProvider && <div className="mb-4 rounded-xl border border-gray-700/50 bg-gray-800/30 p-3">
                <p className="text-[10px] font-bold uppercase text-gray-500">Provider</p>
                <p className="mt-1 text-sm text-white">{PROVIDER_LABELS[selectedMedia.generationProvider]}</p>
                {selectedMedia.providerModel && <p className="mt-1 break-all text-xs text-gray-500">{selectedMedia.providerModel}</p>}
              </div>}
              {/* Metadata Grid */}
              {selectedMedia.mediaType === 'video' ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
                    <div className="flex items-center gap-2 mb-1">
                      <Ratio className="w-3.5 h-3.5 text-violet-400" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase">Ratio</span>
                    </div>
                    <span className="text-sm font-semibold text-white">
                      {selectedMedia.videoOperation === 'edit' || selectedMedia.videoOperation === 'extend'
                        ? 'Source'
                        : selectedMedia.videoAspectRatio || selectedMedia.aspectRatio || '—'}
                    </span>
                  </div>
                  <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
                    <div className="flex items-center gap-2 mb-1">
                      <Scan className="w-3.5 h-3.5 text-violet-400" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase">Quality</span>
                    </div>
                    <span className="text-sm font-semibold text-white">{selectedMedia.videoQuality || '720p'}</span>
                  </div>
                  <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="w-3.5 h-3.5 text-violet-400" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase">Duration</span>
                    </div>
                    <span className="text-sm font-semibold text-white">
                      {selectedMedia.videoDuration === -1 ? 'Auto' : selectedMedia.videoDuration ? `${selectedMedia.videoDuration}s` : '—'}
                    </span>
                  </div>
                  <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
                    <div className="flex items-center gap-2 mb-1">
                      <Video className="w-3.5 h-3.5 text-violet-400" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase">Model</span>
                    </div>
                    <span className="text-sm font-semibold text-white">
                      {selectedMedia.videoModel === 'seedance-2.0'
                        ? 'Seedance 2.0'
                        : selectedMedia.videoModel === 'minimax-h3'
                          ? selectedMedia.falEndpoint?.includes('h3-max')
                            ? 'MiniMax H3 Max'
                            : 'MiniMax H3'
                          : selectedMedia.generationProvider && selectedMedia.generationProvider !== 'evolink' ? 'Seedance 2.5' : 'Seedance 2.5 Relaxed'}
                    </span>
                  </div>
                  <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
                    <div className="flex items-center gap-2 mb-1">
                      <Film className="w-3.5 h-3.5 text-violet-400" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase">Action</span>
                    </div>
                    <span className="text-sm font-semibold text-white">
                      {selectedMedia.videoOperation === 'reference_edit'
                        ? 'Ref Edit'
                        : selectedMedia.videoOperation === 'edit'
                          ? 'Edit'
                          : selectedMedia.videoOperation === 'extend'
                            ? 'Extend'
                            : 'Generate'}
                    </span>
                  </div>
                  {selectedMedia.generationCost && (
                    <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase">
                          {selectedMedia.generationCost.source === 'provider_actual' ? 'Actual Cost' : 'Est. Cost'}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-green-400">
                          ${selectedMedia.generationCost.usd.toFixed(
                            selectedMedia.generationCost.source === 'provider_actual' || selectedMedia.videoModel === 'minimax-h3'
                              ? 4
                              : 3
                          )}
                        </span>
                        {selectedMedia.generationCost.credits != null && (
                          <span className="text-xs text-gray-500">{selectedMedia.generationCost.credits.toFixed(1)} credits</span>
                        )}
                      </div>
                    </div>
                  )}
                  {selectedMedia.generationTime != null && (
                    <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
                      <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-[10px] font-bold text-gray-500 uppercase">Gen Time</span>
                      </div>
                      <span className="text-sm font-semibold text-white">
                        {selectedMedia.generationStartedAt == null
                          && selectedMedia.generationCompletedAt == null
                          && selectedMedia.generationTime < 10
                          ? 'Unavailable'
                          : selectedMedia.generationTime >= 60
                            ? `${Math.floor(selectedMedia.generationTime / 60)}m ${selectedMedia.generationTime % 60}s`
                            : `${selectedMedia.generationTime}s`}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
                  <div className="flex items-center gap-2 mb-1">
                    <Scan className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-[10px] font-bold text-gray-500 uppercase">Resolution</span>
                  </div>
                  <span className="text-sm font-semibold text-white">{selectedMedia.imageOutputSize || (selectedMedia.imageModel === SUNBURST_MODEL ? 'Unavailable' : selectedMedia.resolution)}</span>
                  {selectedMedia.imageRequestedSize && (
                    <span className={`block mt-1 text-xs ${hasImageSizeMismatch(selectedMedia) ? 'text-amber-300' : 'text-gray-500'}`}>
                      Requested: {selectedMedia.imageRequestedSize}
                      {hasImageSizeMismatch(selectedMedia) && <span className="block">Output size differs</span>}
                    </span>
                  )}
                </div>
                <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
                  <div className="flex items-center gap-2 mb-1">
                    <Ratio className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-[10px] font-bold text-gray-500 uppercase">Aspect Ratio</span>
                  </div>
                  <span className="text-sm font-semibold text-white">{getImageOutputRatio(selectedMedia.imageOutputSize) || selectedMedia.aspectRatio}</span>
                </div>
                <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30 col-span-2">
                  <div className="flex items-center gap-2 mb-1">
                    <ImageIcon className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-[10px] font-bold text-gray-500 uppercase">Model</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-white">{getImageModelLabel(selectedMedia.imageModel)}</span>
                    <span className="text-xs text-gray-500 font-mono">{selectedMedia.imageModel || DEFAULT_IMAGE_MODEL}</span>
                    {selectedMedia.openaiImageOptions && <span className="mt-1 text-xs text-gray-400">{selectedMedia.openaiImageOptions.quality} · {selectedMedia.openaiImageOptions.outputFormat.toUpperCase()}</span>}
                  </div>
                </div>
                <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">{selectedMedia.generationCost?.source === 'provider_usage' ? 'Usage Cost' : 'Est. Cost'}</span>
                  </div>
                  <span className="text-sm font-semibold text-green-400">
                    {selectedMedia.generationCost ? `$${selectedMedia.generationCost.usd.toFixed(4)}` : ['gpt-image-2.5-sunburst','gemini-nano-banana-2.1'].includes(selectedMedia.imageModel || '') || selectedMedia.generationProvider ? 'Unavailable' : `~$${estimateImageCost(
                      (selectedMedia.imageModel as keyof typeof IMAGE_COST_PER_GEN) || DEFAULT_IMAGE_MODEL,
                      selectedMedia.resolution,
                      1,
                      selectedMedia.aspectRatio,
                      (selectedMedia.referenceImages?.length || 0) > 0,
                    )?.toFixed(3)}`}
                  </span>
                </div>
                {selectedGenerationTime && <div className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/30">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-[10px] font-bold text-gray-500 uppercase">Gen Time</span>
                  </div>
                  <span className="text-sm font-semibold text-white">{selectedGenerationTime}</span>
                </div>}
              </div>
              )}

              <ImageEditDetails media={selectedMedia} images={images} onOpenSource={id => { setEditingMediaId(null); setSelectedMediaId(id); }} />

              {/* Reference Images Details */}
              {selectedReferenceImages.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Layers className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">References ({selectedReferenceImages.length})</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {selectedReferenceImages.map((ref, idx) => {
                      const markerBadges: { label: string; className: string }[] = [];
                      const person = selectedPersonGroups.find(group => group.id === getPersonId(ref));
                      const isEditSource = ref === selectedEditSourceReference;
                      markerBadges.push({ label: isEditSource ? 'Edit source' : person?.label || 'Ref', className: isEditSource ? 'bg-lime-400/90 text-black' : person ? 'text-black' : 'bg-gray-700 text-gray-100' });

                      if (ref.isDraftImage) {
                        markerBadges.push({
                          label: 'Draft',
                          className: 'bg-violet-500 text-white'
                        });
                      }

                      return (
                        <div
                          key={idx}
                          className="aspect-square rounded-lg border border-gray-700 overflow-hidden bg-black/50 relative isolate group cursor-pointer"
                          onClick={() => setPreviewRefImage(ref)}
                        >
                          <img src={ref.data} alt={isEditSource ? 'Edit source reference' : 'Reference image'} className="w-full h-full object-cover" />

                          <div className="absolute top-1 left-1 right-1 flex flex-col items-start gap-1 z-20 pointer-events-none">
                            {markerBadges.map((badge, badgeIndex) => (
                              <span
                                key={`${idx}-${badge.label}-${badgeIndex}`}
                                className={`max-w-full truncate px-1.5 py-0.5 text-[9px] font-bold rounded ${badge.className}`}
                                style={badgeIndex === 0 && person && !isEditSource ? { backgroundColor: personColor(person.id) } : undefined}
                              >
                                {badge.label}
                              </span>
                            ))}
                          </div>

                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <ZoomIn className="w-5 h-5 text-white" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedMedia.mediaType === 'video' && selectedReferenceVideos.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Video className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Video References ({selectedReferenceVideos.length})</span>
                  </div>
                  <div className="space-y-3">
                    {selectedReferenceVideos.map((ref, idx) => (
                      <div key={`${ref.id}-${idx}`} className="rounded-lg border border-gray-700 overflow-hidden bg-black/50">
                        <div className="aspect-video bg-black">
                          <video
                            src={ref.url}
                            controls
                            muted
                            preload="metadata"
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="flex items-center justify-between px-3 py-2 bg-gray-900/80">
                          <span className="text-[10px] font-bold text-gray-400 uppercase">
                            {ref.isContinuation ? 'Continuation' : 'Reference'}
                          </span>
                          <span className="text-[10px] text-gray-500">{ref.mimeType || 'video/mp4'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedMedia.mediaType === 'video' && selectedReferenceAudios.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Volume2 className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Audio References ({selectedReferenceAudios.length})</span>
                  </div>
                  <div className="space-y-2">
                    {selectedReferenceAudios.map((ref, idx) => (
                      <div key={`${ref.id}-${idx}`} className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <span className="text-xs font-semibold text-gray-300 truncate">{ref.name || `Audio ${idx + 1}`}</span>
                          <span className="text-[10px] text-gray-500 shrink-0">{ref.mimeType || 'audio'}</span>
                        </div>
                        <audio src={ref.url} controls className="w-full h-8" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Creation Info */}
              <div className="pt-4 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
                <span>Created {new Date(selectedMedia.createdAt).toLocaleDateString()}</span>
                <span>{new Date(selectedMedia.createdAt).toLocaleTimeString()}</span>
              </div>
            </div>

            <div className="p-6 border-t border-gray-800 space-y-3 bg-[#161b22] sticky bottom-0">
              {isComparableImage(selectedMedia) && <button type="button" aria-label="Preview thumbnail on YouTube" onClick={() => setIsYouTubePreviewOpen(true)}
                className="w-full py-3 bg-gray-800 text-gray-200 rounded-xl flex items-center justify-center gap-2 hover:bg-gray-700 transition-colors border border-gray-700 font-medium">
                <Play className="w-4 h-4 text-red-400" /> YouTube Preview
              </button>}
              {!isReadOnly && <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { onRecreate(selectedMedia); setSelectedMediaId(null); }} className="py-4 bg-lime-400 hover:bg-lime-300 text-black font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg transition-colors"><RotateCcw className="w-5 h-5" /> Re-create</button>
                {onGenerateVariation && (
                  <button
                    onClick={() => { onGenerateVariation(selectedMedia); }}
                    className="py-4 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg transition-colors"
                    title="Generate a variation of this image with a slightly different prompt"
                  >
                    <Shuffle className="w-5 h-5" /> Variation
                  </button>
                )}
              </div>}

              <div className={`grid gap-3 ${isReadOnly ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {!isReadOnly && <button onClick={() => { onUseAsReference(selectedMedia); setSelectedMediaId(null); }} className="py-3 bg-gray-800 text-gray-200 rounded-xl flex items-center justify-center gap-2 hover:bg-gray-700 transition-colors border border-gray-700 font-medium"><ImagePlus className="w-4 h-4" /> Reference</button>}
                {/* Download Button */}
                {selectedMedia.mediaType === 'video' ? (
                  <button onClick={() => handleDownloadPNG(selectedMedia)} className="py-3 bg-gray-800 text-gray-200 rounded-xl flex items-center justify-center gap-2 hover:bg-gray-700 transition-colors border border-gray-700 font-medium"><Download className="w-4 h-4" /> Download Video</button>
                ) : downloadMenuId === selectedMedia.id ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button onClick={() => handleDownloadPNG(selectedMedia)} className="py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl flex items-center justify-center gap-1.5 transition-colors font-bold text-sm"><Download className="w-4 h-4" /> {selectedMedia.openaiImageOptions?.outputFormat.toUpperCase() || 'PNG'}</button>
                    <button onClick={() => handleDownloadJPEG(selectedMedia)} className="py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl flex items-center justify-center gap-1.5 transition-colors font-bold text-sm"><Download className="w-4 h-4" /> JPG</button>
                  </div>
                ) : (
                  <button onClick={(e) => handleDownloadClick(e, selectedMedia.id)} className="py-3 bg-gray-800 text-gray-200 rounded-xl flex items-center justify-center gap-2 hover:bg-gray-700 transition-colors border border-gray-700 font-medium"><Download className="w-4 h-4" /> Download</button>
                )}
              </div>

              {!isReadOnly && <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    if (onToggleFavorite) onToggleFavorite(selectedMedia);
                  }}
                  className={`py-2 rounded-xl flex items-center justify-center transition-colors border ${selectedMedia.isFavorite ? 'bg-pink-900/30 border-pink-500 text-pink-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                  title="Favorite"
                >
                  <Heart className={`w-4 h-4 ${selectedMedia.isFavorite ? 'fill-current' : ''}`} />
                </button>

                <button
                  onClick={() => { onDelete(selectedMedia); setSelectedMediaId(null); }}
                  className="py-2 bg-gray-800 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded-xl flex items-center justify-center transition-colors border border-gray-700"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
