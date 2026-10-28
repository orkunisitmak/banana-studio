export const MAX_FRAME_EDGE = 2048;

export type FrameCaptureErrorCode =
  | 'invalid-duration'
  | 'invalid-timestamp'
  | 'invalid-dimensions'
  | 'metadata-unavailable'
  | 'canvas-unavailable'
  | 'tainted-video'
  | 'empty-frame'
  | 'unsupported';

export class FrameCaptureError extends Error {
  readonly code: FrameCaptureErrorCode;

  constructor(code: FrameCaptureErrorCode, message: string) {
    super(message);
    this.name = 'FrameCaptureError';
    this.code = code;
  }
}

export type FrameAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export type FrameResolutionLabel = '1K' | '2K' | '4K';

export interface FrameDimensions {
  width: number;
  height: number;
}

export interface CapturedFrame {
  dataUrl: string;
  mimeType: 'image/png';
  timestamp: number;
  width: number;
  height: number;
}

export interface CapturedFrameSaveRequest extends CapturedFrame {
  filename: string;
  sourceVideoId: string;
  folderId: string | null;
}

const ASPECT_RATIOS: { value: FrameAspectRatio; ratio: number }[] = [
  { value: '1:1', ratio: 1 },
  { value: '3:4', ratio: 3 / 4 },
  { value: '4:3', ratio: 4 / 3 },
  { value: '9:16', ratio: 9 / 16 },
  { value: '16:9', ratio: 16 / 9 },
];

const TURKISH_ASCII: Record<string, string> = {
  '\u00e7': 'c',
  '\u00c7': 'c',
  '\u011f': 'g',
  '\u011e': 'g',
  '\u0131': 'i',
  '\u0130': 'i',
  '\u00f6': 'o',
  '\u00d6': 'o',
  '\u015f': 's',
  '\u015e': 's',
  '\u00fc': 'u',
  '\u00dc': 'u',
};

/** Converts one user-facing label into an ASCII-safe filename segment. */
export const sanitizeFilenamePart = (value: string, fallback = 'video'): string => {
  const transliterated = Array.from(String(value ?? ''))
    .map(character => TURKISH_ASCII[character] ?? character)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  const safe = transliterated
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 80)
    .replace(/^[-_]+|[-_]+$/g, '')
    .toLowerCase();

  return safe || fallback;
};

/**
 * Clamps a playback position into the video's real duration. Invalid
 * timestamps and missing/zero durations are rejected instead of silently
 * producing a frame from an unknown position.
 */
export const clampTimestamp = (timestamp: number, duration: number): number => {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new FrameCaptureError('invalid-duration', 'The video duration is not available yet.');
  }
  if (!Number.isFinite(timestamp)) {
    throw new FrameCaptureError('invalid-timestamp', 'The playback position is not valid.');
  }
  return Math.min(Math.max(timestamp, 0), duration);
};

/** Scales natural video dimensions to a square-pixel canvas capped by maxEdge. */
export const computeFrameDimensions = (
  width: number,
  height: number,
  maxEdge = MAX_FRAME_EDGE,
): FrameDimensions => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || !Number.isFinite(maxEdge) || maxEdge <= 0) {
    throw new FrameCaptureError('invalid-dimensions', 'The video dimensions are not available yet.');
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

export const inferAspectRatio = (width: number, height: number): FrameAspectRatio => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new FrameCaptureError('invalid-dimensions', 'The video dimensions are not available yet.');
  }
  const ratio = width / height;
  return ASPECT_RATIOS.reduce((best, current) =>
    Math.abs(Math.log(ratio / current.ratio)) < Math.abs(Math.log(ratio / best.ratio)) ? current : best
  ).value;
};

export const inferResolutionLabel = (width: number, height: number): FrameResolutionLabel => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new FrameCaptureError('invalid-dimensions', 'The video dimensions are not available yet.');
  }
  const longestEdge = Math.max(width, height);
  if (longestEdge >= 3500) return '4K';
  if (longestEdge >= 1800) return '2K';
  return '1K';
};

/** Deterministic `HH-MM-SS.mmm` timestamp for filenames and captions. */
export const formatFrameTimestamp = (timestamp: number): string => {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new FrameCaptureError('invalid-timestamp', 'The playback position is not valid.');
  }
  const totalMilliseconds = Math.round(timestamp * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return `${pad(hours)}-${pad(minutes)}-${pad(seconds)}.${pad(milliseconds, 3)}`;
};

/** Records the source video and playback timestamp without path separators. */
export const buildFrameFilename = (
  source: string,
  timestamp: number,
  extension = 'png',
): string => {
  const safeExtension = sanitizeFilenamePart(extension, 'png');
  return `video-${sanitizeFilenamePart(source)}-frame-${formatFrameTimestamp(timestamp)}.${safeExtension}`;
};

/**
 * Draws one frame from an already-loaded video element. The caller owns the
 * element; this function never fetches media and never weakens CORS settings.
 * A cross-origin/tainted canvas surfaces as a `tainted-video` error.
 */
export const captureVideoFrame = (
  video: HTMLVideoElement | null | undefined,
  maxEdge = MAX_FRAME_EDGE,
): CapturedFrame => {
  if (!video || video.readyState < 2 || !Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight)
    || video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new FrameCaptureError('metadata-unavailable', 'The video is not ready to capture a frame yet.');
  }

  const timestamp = clampTimestamp(video.currentTime, video.duration);
  const dimensions = computeFrameDimensions(video.videoWidth, video.videoHeight, maxEdge);
  if (typeof document === 'undefined') {
    throw new FrameCaptureError('unsupported', 'Frame capture is not available in this environment.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;

  const context = canvas.getContext('2d');
  if (!context || typeof context.drawImage !== 'function' || typeof canvas.toDataURL !== 'function') {
    throw new FrameCaptureError('canvas-unavailable', 'This browser could not create a frame canvas.');
  }

  try {
    context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
  } catch {
    throw new FrameCaptureError('tainted-video', 'This video is protected by cross-origin restrictions.');
  }

  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    throw new FrameCaptureError('tainted-video', 'This video is protected by cross-origin restrictions.');
  }

  const pngPrefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(pngPrefix) || dataUrl.length <= pngPrefix.length) {
    throw new FrameCaptureError('empty-frame', 'The captured frame was empty. Try another moment.');
  }

  return {
    dataUrl,
    mimeType: 'image/png',
    timestamp,
    width: dimensions.width,
    height: dimensions.height,
  };
};

const waitForVideoEvent = (
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'loadeddata' | 'seeked',
  timeoutMs: number,
): Promise<void> => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (error?: FrameCaptureError) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    video.removeEventListener(eventName, onReady);
    video.removeEventListener('error', onError);
    if (error) reject(error);
    else resolve();
  };
  const onReady = () => finish();
  const onError = () => finish(new FrameCaptureError(
    'tainted-video',
    'This video could not be loaded with cross-origin access.',
  ));
  const timer = setTimeout(() => finish(new FrameCaptureError(
    'metadata-unavailable',
    'The video did not load in time.',
  )), timeoutMs);
  video.addEventListener(eventName, onReady, { once: true });
  video.addEventListener('error', onError, { once: true });
});

/**
 * Loads a separate CORS-annotated video element for cross-origin sources.
 * The visible player keeps its original fetch mode, so playback never breaks
 * for sources without CORS headers. A source that cannot be read this way is
 * reported as a tainted/CORS failure.
 */
export const captureFrameFromUrl = async (
  src: string,
  requestedTimestamp: number,
  maxEdge = MAX_FRAME_EDGE,
  timeoutMs = 20_000,
): Promise<CapturedFrame> => {
  if (typeof document === 'undefined') {
    throw new FrameCaptureError('unsupported', 'Frame capture is not available in this environment.');
  }
  if (!src) {
    throw new FrameCaptureError('unsupported', 'The video source is not available.');
  }

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    video.src = src;
    await waitForVideoEvent(video, 'loadedmetadata', timeoutMs);
    const timestamp = clampTimestamp(requestedTimestamp, video.duration);
    if (video.readyState < 2) await waitForVideoEvent(video, 'loadeddata', timeoutMs);
    if (Math.abs(video.currentTime - timestamp) > 0.01) {
      video.currentTime = timestamp;
      await waitForVideoEvent(video, 'seeked', timeoutMs);
      if (video.readyState < 2) await waitForVideoEvent(video, 'loadeddata', timeoutMs);
    }
    return captureVideoFrame(video, maxEdge);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
};

export const getFrameCaptureErrorMessage = (error: unknown): string => {
  if (error instanceof FrameCaptureError) {
    switch (error.code) {
      case 'invalid-duration':
      case 'metadata-unavailable':
        return 'The video is not ready to capture a frame yet. Let it load, then try again.';
      case 'invalid-timestamp':
        return 'That playback position is not valid. Move the timeline and try again.';
      case 'invalid-dimensions':
        return 'The video dimensions are not available yet. Try again once it has loaded.';
      case 'canvas-unavailable':
        return 'This browser could not create a frame canvas. Try a different browser.';
      case 'tainted-video':
        return 'This video is protected by cross-origin restrictions, so its frames cannot be captured.';
      case 'empty-frame':
        return 'The captured frame was empty. Pause on a different moment and try again.';
      case 'unsupported':
        return 'This browser cannot capture frames from this video.';
    }
  }
  return error instanceof Error && error.message
    ? error.message
    : 'The frame could not be captured. Try again.';
};
