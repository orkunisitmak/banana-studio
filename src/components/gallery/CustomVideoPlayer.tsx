import React, { useEffect, useRef, useState } from 'react';
import { FastForward, Maximize2, Pause, Play, Rewind, Volume2, VolumeX } from 'lucide-react';
import { formatPlaybackTime, getVideoPreviewSrc } from './videoPreview';

export const CustomVideoPlayer: React.FC<{
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
