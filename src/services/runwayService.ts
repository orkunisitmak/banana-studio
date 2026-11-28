import { selectProvider } from './providerRouting';
import { videoProviderName } from '../lib/video/videoProviderName';
import { seedanceProviderError } from '../lib/video/seedanceProviders';
import type { AIProvider } from '../lib/providers';
import { isSeedanceModel, isSeedanceQuality, seedanceConfigError, seedanceMode, seedanceReferenceDurationError, type SeedanceModel, type SeedanceMode } from '../lib/video/seedance';
import { buildFalSeedanceInput, estimateFalSeedance20Usd, falSeedanceLimits, falSeedanceReferenceError, falSeedanceReferenceDurationError, FAL_SEEDANCE_20_MODEL, type FalSeedanceModel } from '../lib/video/falSeedance25';
import { buildEvoH3MaxInput, EVO_H3_ENDPOINTS, EVO_H3_MODEL } from '../lib/video/evoH3Max';
import { getEvoH3DraftMode, getEvoH3MaxError, normalizeEvoH3Prompt, toEvoH3Mode, EVO_H3_CLIP_MIME } from '../lib/video/evoH3MaxConfig';
import { buildMagi2Input, isMagi2PublicUrl, MAGI2_MODEL, MAGI2_ENDPOINTS, MAGI2_LIMITS } from '../lib/video/magi2';
import { getMagi2Error, getMagi2Images, getMagi2Prompt, isWorkspaceMediaUrl } from '../lib/video/magi2Config';
import { buildOmniInput, estimateOmniCost, getOmniConfigError, getOmniFrames, getOmniMode, normalizeOmniPrompt, OMNI_MODEL, OMNI_QUEUE_APP, toOmniResolution, type OmniMode, type OmniRequestBody } from '../lib/video/omniFlash';
import { getPersonGroups, buildPersonIdentityContract } from '../lib/references/personReferences';
import { getMultilineQuotedPromptPattern } from '../lib/references/referenceTokens';
import { GenerationConfig, ReferenceImage, ReferenceVideo, ReferenceAudio, DEFAULT_VIDEO_MODEL, VideoAspectRatio, VideoQuality, VideoCost, VideoModelId, VideoOperation, H3GenerationMode, estimateVideoCost, EVOLINK_CREDITS_PER_USD } from '../types';
import { logUsage, supabase } from './authService';
import { uploadBase64ToPublicUrl, uploadBlobToPublicUrl, uploadVideoBlobToPublicUrl, refreshMediaAccessUrl } from './storageService';
import { MAX_VIDEO_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_MB } from '../lib/references/mediaUploadLimits';
import { getSeedanceFrameError, prepareSeedanceFramePrompt } from '../lib/video/seedanceFrames';
import { prepareReferenceAudio } from '../lib/video/referenceAudio';
import { formatRejectedDuration } from '../lib/video/rejectedDuration';
import { buildH3MaxInput, H3_MAX_CAPABILITIES, type H3MaxMode } from '../lib/video/h3Max';
import { getH3MaxConfigError, getH3MaxMode, getH3MaxReferenceImages, getH3MaxRequestBody, getKnownVideoDuration } from '../lib/video/h3MaxConfig';
import { estimateH3MaxCost } from '../lib/video/h3MaxPricing';
import { hydrateH3MaxReferenceDimensions } from '../lib/video/h3MaxReferenceMetadata';
export { hydrateH3MaxReferenceDimensions } from '../lib/video/h3MaxReferenceMetadata';

const POLL_INTERVAL = 5000;
const H3_MAX_POLL_INTERVAL = 750;
const VIDEO_PREPROCESS_POLL_INTERVAL = 1500;
const VIDEO_PREPROCESS_TIMEOUT = 5 * 60 * 1000;

type SeedanceVideoQuality = Extract<VideoQuality, '480p' | '720p' | '1080p' | '4K'>;

const VIDEO_QUALITY_PIXEL_BUDGET: Record<SeedanceVideoQuality, number> = {
  '480p': 854 * 480,
  '720p': 1280 * 720,
  '1080p': 1920 * 1080,
  '4K': 3840 * 2160,
};

type EvoMode = H3GenerationMode | H3MaxMode | OmniMode | SeedanceMode;

class TerminalVideoTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalVideoTaskError';
  }
}

export class RecoverableVideoTaskError extends Error {
  readonly recoverable = true;

  constructor(message: string) {
    super(message);
    this.name = 'RecoverableVideoTaskError';
  }
}

class VideoStatusHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
    this.name = 'VideoStatusHttpError';
  }
}

export const isRecoverableVideoTaskError = (error: unknown): boolean => {
  return error instanceof RecoverableVideoTaskError
    || (typeof error === 'object' && error !== null && (error as any).recoverable === true);
};

const determineMode = seedanceMode;

const resolveImageUrl = async (img: ReferenceImage, maxBytes = 30 * 1024 * 1024): Promise<string | null> => {
  if (isHttpUrl(img.data)) return refreshMediaAccessUrl(img.data);
  if (img.data.startsWith('blob:')) {
    const response = await fetch(img.data);
    if (!response.ok) throw new Error('Could not read the reference image. Attach it again.');
    const blob = await response.blob();
    const mime = blob.type || img.mimeType;
    if (!blob.size || blob.size > maxBytes || !/^image\/[a-z0-9.+-]+$/i.test(mime)) throw new Error('Invalid or oversized reference image.');
    return uploadBlobToPublicUrl(blob, mime, 'vref', mime.split('/')[1].replace('jpeg','jpg'));
  }
  return uploadBase64ToPublicUrl(img.data, img.mimeType || 'image/jpeg', 'vref');
};

const isHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url);

const getServerAuthHeaders = async (expectedUserId?: string): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (expectedUserId && data?.session?.user?.id !== expectedUserId) throw new Error('Session changed before video request.');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const VIDEO_ASPECT_RATIO_VALUES: Partial<Record<VideoAspectRatio, number>> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '21:9': 21 / 9,
};

const TARGET_VIDEO_DIMENSIONS: Record<Exclude<VideoAspectRatio, 'adaptive'>, Record<SeedanceVideoQuality, { width: number; height: number }>> = {
  '16:9': {
    '480p': { width: 864, height: 496 },
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
    '4K': { width: 3840, height: 2160 },
  },
  '9:16': {
    '480p': { width: 496, height: 864 },
    '720p': { width: 720, height: 1280 },
    '1080p': { width: 1080, height: 1920 },
    '4K': { width: 2160, height: 3840 },
  },
  '1:1': {
    '480p': { width: 640, height: 640 },
    '720p': { width: 960, height: 960 },
    '1080p': { width: 1440, height: 1440 },
    '4K': { width: 2880, height: 2880 },
  },
  '4:3': {
    '480p': { width: 752, height: 560 },
    '720p': { width: 1112, height: 834 },
    '1080p': { width: 1664, height: 1248 },
    '4K': { width: 3326, height: 2494 },
  },
  '3:4': {
    '480p': { width: 560, height: 752 },
    '720p': { width: 834, height: 1112 },
    '1080p': { width: 1248, height: 1664 },
    '4K': { width: 2494, height: 3326 },
  },
  '21:9': {
    '480p': { width: 992, height: 432 },
    '720p': { width: 1470, height: 630 },
    '1080p': { width: 2206, height: 946 },
    '4K': { width: 4398, height: 1886 },
  },
};

const getTargetVideoDimensions = (
  aspectRatio: VideoAspectRatio,
  quality: VideoQuality, model: SeedanceModel
): { width: number; height: number } => {
  const seedanceQuality = isSeedanceQuality(quality) ? quality : '720p';
  if (model === 'seedance-2.5' && seedanceQuality === '480p') {
    if (aspectRatio === '16:9') return { width: 854, height: 480 };
    if (aspectRatio === '9:16') return { width: 480, height: 854 };
  }
  if (aspectRatio === 'adaptive') return TARGET_VIDEO_DIMENSIONS['16:9'][seedanceQuality];
  return TARGET_VIDEO_DIMENSIONS[aspectRatio][seedanceQuality];
};

const getMediaDuration = (url: string, kind: 'video' | 'audio'): Promise<number | null> => {
  return new Promise(resolve => {
    const el = document.createElement(kind);
    const timeout = window.setTimeout(() => {
      el.removeAttribute('src');
      el.load();
      resolve(null);
    }, 3000);

    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const duration = Number.isFinite(el.duration) ? el.duration : null;
      el.removeAttribute('src');
      el.load();
      resolve(duration);
    };
    el.onerror = () => {
      window.clearTimeout(timeout);
      el.removeAttribute('src');
      el.load();
      resolve(null);
    };
    el.src = url;
  });
};

const loadVideoMetadata = (url: string, needsCanvasAccess = true): Promise<HTMLVideoElement> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const timeout = window.setTimeout(() => {
      video.removeAttribute('src');
      video.load();
      reject(new Error('Could not read video metadata'));
    }, 8000);

    // Dimensions/duration do not need canvas access. Requiring CORS for those
    // checks rejects otherwise public videos before Edit can be submitted.
    if (needsCanvasAccess) video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      resolve(video);
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      video.removeAttribute('src');
      video.load();
      reject(new Error('Could not load reference video'));
    };
    video.src = url;
  });
};

const cleanupVideoElement = (video: HTMLVideoElement): void => {
  video.pause();
  video.removeAttribute('src');
  video.load();
};

const inspectVideo = async (url: string): Promise<{ duration: number | null; width: number; height: number }> => {
  const video = await loadVideoMetadata(url, false);
  try {
    return {
      duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    cleanupVideoElement(video);
  }
};

export const getNormalizedVideoDimensions = (
  width: number,
  height: number,
  quality: VideoQuality,
): { width: number; height: number } | null => {
  if (!width || !height) return null;
  const seedanceQuality = isSeedanceQuality(quality) ? quality : '720p';
  const pixelBudget = VIDEO_QUALITY_PIXEL_BUDGET[seedanceQuality];
  const sourcePixels = width * height;
  if (sourcePixels <= pixelBudget) return null;

  const scale = Math.min(Math.sqrt(pixelBudget / sourcePixels), 4320 / height);
  const toEven = (value: number): number => Math.max(300, Math.round(value / 2) * 2);
  const dimensions = {
    width: toEven(width * scale),
    height: toEven(height * scale),
  };
  // Rounding to even H.264 dimensions can take a 480p frame below Seedance's
  // 409,600-pixel input minimum (e.g. 2048x1080 -> 882x464 = 409,248).
  while (dimensions.width * dimensions.height < 409600) {
    const sourceRatio = width / height;
    const widerError = Math.abs((dimensions.width + 2) / dimensions.height - sourceRatio);
    const tallerError = Math.abs(dimensions.width / (dimensions.height + 2) - sourceRatio);
    if (widerError < tallerError) dimensions.width += 2;
    else dimensions.height += 2;
  }
  // Even rounding at 4K can cross EvoLink's 8,295,044-pixel input ceiling.
  while (dimensions.width * dimensions.height > 8295044) {
    const sourceRatio = width / height;
    if (Math.abs((dimensions.width - 2) / dimensions.height - sourceRatio) < Math.abs(dimensions.width / (dimensions.height - 2) - sourceRatio)) dimensions.width -= 2;
    else dimensions.height -= 2;
  }
  return dimensions;
};

export const validateEditSourceMetadata = (
  metadata: { duration: number | null; width: number; height: number },
  label: string,
  willDownscale = false,
): void => {
  const { duration, width, height } = metadata;
  if (duration == null || !Number.isFinite(duration) || duration < 4 || duration > 30) {
    throw new Error(`${label} must be 4-30 seconds for Video Edit.${duration != null && Number.isFinite(duration) ? ` Current duration is ${formatRejectedDuration(duration, 4, 30)}s.` : ' Could not detect its duration.'}`);
  }
  const aspect = width / height;
  if (!Number.isFinite(aspect) || width < 300 || height < 300 || aspect < 0.4 || aspect > 2.5 || width * height < 409600) {
    throw new Error(`${label} is not compatible with Video Edit. Use a video with at least 409,600 pixels per frame, both dimensions at least 300px, and an aspect ratio between 0.4 and 2.5.`);
  }
  if (!willDownscale && (width > 6000 || height > 6000 || width * height > 8295044)) {
    throw new Error(`${label} is too large for Video Edit. Supplementary videos must have dimensions no greater than 6000px and at most 8,295,044 pixels per frame.`);
  }
};

const normalizeVideoForEdit = async (
  videoUrl: string,
  width: number,
  height: number,
): Promise<string> => {
  const headers = await getServerAuthHeaders();
  const submitResponse = await fetch('/api/fal-video-scale', {
    method: 'POST',
    headers,
    body: JSON.stringify({ videoUrl, width, height }),
  });
  const submitData = await submitResponse.json().catch(() => null);
  if (!submitResponse.ok || !submitData?.requestId) {
    throw new Error(submitData?.error || 'Could not start source-video compatibility preprocessing.');
  }

  const startedAt = Date.now();
  // The scale job is already paid for; ride out brief poll failures like the other task pollers.
  let transientErrors = 0;
  while (Date.now() - startedAt < VIDEO_PREPROCESS_TIMEOUT) {
    await new Promise(resolve => setTimeout(resolve, VIDEO_PREPROCESS_POLL_INTERVAL));
    const pollHeaders = await getServerAuthHeaders();
    let statusResponse: Response;
    try {
      statusResponse = await fetch(
        `/api/fal-video-scale?requestId=${encodeURIComponent(submitData.requestId)}`,
        { headers: pollHeaders },
      );
    } catch (error) {
      if (++transientErrors >= 5) throw error;
      continue;
    }
    const statusData = await statusResponse.json().catch(() => null);
    if (!statusResponse.ok) {
      const transient = statusResponse.status === 408 || statusResponse.status === 429 || statusResponse.status >= 500;
      if (transient && ++transientErrors < 5) continue;
      throw new Error(statusData?.error || 'Source-video compatibility preprocessing failed.');
    }
    // An unreadable 200 body is a failed poll too; reset only after a readable status.
    if (!statusData) {
      if (++transientErrors >= 5) throw new Error('Source-video compatibility preprocessing status could not be read.');
      continue;
    }
    transientErrors = 0;
    if (statusData?.status === 'SUCCEEDED' && typeof statusData.videoUrl === 'string') {
      return statusData.videoUrl;
    }
    if (statusData?.status === 'FAILED' || statusData?.status === 'CANCELLED') {
      throw new Error(statusData?.error || 'Source-video compatibility preprocessing failed.');
    }
  }

  throw new Error('Source-video compatibility preprocessing timed out. Please try a 720p or 1080p MP4 source.');
};

const seekVideo = (video: HTMLVideoElement, time: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Could not seek reference video'));
    }, 8000);

    video.onseeked = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Could not seek reference video'));
    };

    video.currentTime = time;
  });
};

const validateLocalReferenceMedia = async (
  url: string,
  blob: Blob,
  mimeType: string | undefined,
  label: string,
  kind: 'video' | 'audio',
  minDuration: number,
  maxDuration: number,
  nativeFalMedia = false,
  maxAudioBytes = 15 * 1024 * 1024,
): Promise<void> => {
  const normalizedMime = (mimeType || blob.type || '').toLowerCase();
  const allowed = kind === 'video'
    ? /mp4|quicktime|mov/.test(normalizedMime) || (nativeFalMedia && /webm|gif/.test(normalizedMime))
    : /mpeg|mp3|wav/.test(normalizedMime) || (nativeFalMedia && /mp4|m4a|aac|ogg/.test(normalizedMime));
  const maxBytes = kind === 'video' ? MAX_VIDEO_UPLOAD_BYTES : maxAudioBytes;
  const formats = kind === 'video' ? nativeFalMedia ? 'MP4, MOV, WEBM or GIF' : 'MP4 or MOV' : nativeFalMedia ? 'MP3, WAV, M4A, AAC or OGG' : 'MP3 or WAV';

  if (!allowed) {
    throw new Error(`${label} must be ${formats} for video generation.`);
  }

  if (blob.size > maxBytes) {
    throw new Error(`${label} is too large for video generation. Maximum is ${maxBytes / (1024 * 1024)} MB.`);
  }

  const duration = await getMediaDuration(url, kind);
  if (duration != null && (duration < minDuration || duration > maxDuration)) {
    throw new Error(`${label} must be ${minDuration}-${maxDuration} seconds. Current duration is ${formatRejectedDuration(duration, minDuration, maxDuration)}s.`);
  }
};

const extractContinuationFirstFrame = async (
  url: string,
  targetAspectRatio: Exclude<VideoAspectRatio, 'adaptive'>,
  quality: VideoQuality,
  label: string, model: SeedanceModel
): Promise<ReferenceImage> => {
  let video: HTMLVideoElement | null = null;
  try {
    video = await loadVideoMetadata(url);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const seekTime = Math.max(0, duration - 0.08);
    if (seekTime > 0) await seekVideo(video, seekTime);

    const { width, height } = getTargetVideoDimensions(targetAspectRatio, quality, model);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare canvas');

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('Could not read video dimensions');

    const sourceAspect = sourceWidth / sourceHeight;
    const targetAspect = width / height;
    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;

    if (sourceAspect > targetAspect) {
      sw = sourceHeight * targetAspect;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth / targetAspect;
      sy = (sourceHeight - sh) / 2;
    }

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    const data = canvas.toDataURL('image/jpeg', 0.92);
    return {
      id: `${label.toLowerCase().replace(/\s+/g, '-')}-first-frame-${Date.now()}`,
      data,
      mimeType: 'image/jpeg',
      isFirstFrame: true,
    };
  } catch (error: any) {
    throw new Error(`Could not adapt ${label} to ${targetAspectRatio}. Use a reference video with the same aspect ratio, or upload an accessible video that allows frame extraction. ${error.message || ''}`.trim());
  } finally {
    if (video) cleanupVideoElement(video);
  }
};

const videoAspectMatchesTarget = async (
  url: string,
  targetAspectRatio: VideoAspectRatio
): Promise<boolean> => {
  if (targetAspectRatio === 'adaptive') return true;
  const targetAspect = VIDEO_ASPECT_RATIO_VALUES[targetAspectRatio];
  if (!targetAspect) return true;

  let video: HTMLVideoElement | null = null;
  try {
    video = await loadVideoMetadata(url);
    const sourceAspect = video.videoWidth / video.videoHeight;
    if (!Number.isFinite(sourceAspect) || sourceAspect <= 0) return true;
    return Math.abs(sourceAspect - targetAspect) / targetAspect < 0.08;
  } finally {
    if (video) cleanupVideoElement(video);
  }
};

const resolveReferenceMediaUrl = async (
  url: string,
  mimeType: string | undefined,
  label: string,
  prefix: string,
  fallbackExtension: string,
  kind: 'video' | 'audio',
  minDuration: number = 2,
  maxDuration: number = 15,
  nativeFalMedia = false,
  maxAudioBytes = 15 * 1024 * 1024,
): Promise<string> => {
  if (isHttpUrl(url)) return refreshMediaAccessUrl(url);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not read local ${label} (${response.status})`);

    const sourceBlob = await response.blob();
    const blob = kind === 'audio' && !nativeFalMedia
      ? await prepareReferenceAudio(sourceBlob, label, minDuration, maxDuration)
      : sourceBlob;
    const uploadMime = kind === 'audio' && !nativeFalMedia ? blob.type : mimeType || blob.type;
    await validateLocalReferenceMedia(url, blob, uploadMime, label, kind, minDuration, maxDuration, nativeFalMedia, maxAudioBytes);

    const uploadMedia = kind === 'video' ? uploadVideoBlobToPublicUrl : uploadBlobToPublicUrl;
    const publicUrl = await uploadMedia(blob, uploadMime, prefix, fallbackExtension);
    if (!publicUrl) throw new Error('Public upload failed');

    return publicUrl;
  } catch (error: any) {
    throw new Error(`Could not prepare ${label}. ${error.message || 'Check the file and try attaching it again.'}`.trim());
  }
};

const prepareH3ReferenceAudio = async (reference: ReferenceAudio, index: number): Promise<ReferenceAudio> => {
  const label = `H3 Max reference audio ${index + 1}`;
  try {
    const sourceUrl = isHttpUrl(reference.url) ? await refreshMediaAccessUrl(reference.url) : reference.url;
    if (!sourceUrl) throw new Error('The saved audio is no longer accessible. Attach it again.');
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Could not read the audio (${response.status})`);
    const source = await response.blob();
    // Ref2VA's short reference-audio decoder differs from the target-audio
    // routes. In paid QA, valid M4A worked as a target but failed as a reference.
    // Sniff real bytes and convert compressed input to PCM; never relabel it.
    const prepared = await prepareReferenceAudio(source, label, 2, 15);
    const extension = prepared.type === 'audio/mpeg' ? 'mp3' : 'wav';
    const [sourceHeader, preparedHeader] = await Promise.all([
      source.slice(0, 12).arrayBuffer(), prepared.slice(0, 12).arrayBuffer(),
    ]);
    const oldBytes = new Uint8Array(sourceHeader), newBytes = new Uint8Array(preparedHeader);
    const unchanged = source.size === prepared.size && oldBytes.length === newBytes.length && oldBytes.every((value, offset) => value === newBytes[offset]);
    const safeHostedSource = isHttpUrl(sourceUrl) && new URL(sourceUrl).pathname.toLowerCase().endsWith(`.${extension}`) && unchanged;
    const url = safeHostedSource ? sourceUrl : await uploadBlobToPublicUrl(prepared, prepared.type, 'h3_reference_audio', extension);
    if (!url || !isHttpUrl(url)) throw new Error('The prepared reference audio could not be uploaded.');
    const duration = reference.duration ?? await getMediaDuration(sourceUrl, 'audio') ?? undefined;
    return { ...reference, url, mimeType: prepared.type, duration };
  } catch (error) {
    throw new Error(`Could not prepare ${label}. ${error instanceof Error ? error.message : 'Export the audio as MP3/WAV and attach it again.'}`);
  }
};

const prepareReferenceVideos = async (
  refVids: ReferenceVideo[],
  targetAspectRatio: VideoAspectRatio,
  quality: VideoQuality,
  videoModel: SeedanceModel,
  operation: VideoOperation,
  hasManualFirstFrame = false,
  assertRoomForFrames: (frameCount: number) => void = () => {},
): Promise<{
  requestVideos: ReferenceVideo[];
  persistedVideos: ReferenceVideo[];
  generatedFirstFrames: ReferenceImage[];
  extractedVideoIndices: number[];
}> => {
  const requestVideos: ReferenceVideo[] = [];
  const persistedVideos: ReferenceVideo[] = [];
  const generatedFirstFrames: ReferenceImage[] = [];
  const extractedVideoIndices: number[] = [];
  let editNormalization: { width: number; height: number } | null = null;

  for (let i = 0; i < refVids.length; i++) {
    const ref = refVids[i];
    const label = `reference video ${i + 1}`;
    const minDuration = operation === 'edit' ? 4 : 2;
    const maxDuration = videoModel === 'seedance-2.5' ? 30 : 15;
    const publicUrl = await resolveReferenceMediaUrl(ref.url, ref.mimeType, label, 'vref_video', 'mp4', 'video', minDuration, maxDuration);
    let inspectedVideo: { duration: number | null; width: number; height: number } | null = null;
    if (operation === 'edit') {
      try {
        inspectedVideo = await inspectVideo(publicUrl);
      } catch (error: any) {
        throw new Error(
          `Could not inspect the source video before editing. ${error?.message || 'Reload the video and try again.'}`,
        );
      }
      validateEditSourceMetadata(inspectedVideo, label, i === 0);
    }
    const detectedDuration = inspectedVideo?.duration
      ?? (ref.duration != null && ref.duration > 0 ? ref.duration : null)
        ?? await getMediaDuration(ref.url, 'video')
        ?? await getMediaDuration(publicUrl, 'video');
    const persistedRef = {
      ...ref,
      url: publicUrl,
      ...(detectedDuration != null && detectedDuration > 0 ? { duration: detectedDuration } : {}),
    };
    persistedVideos.push(persistedRef);

    if (operation === 'generate' && ref.isContinuation && targetAspectRatio !== 'adaptive') {
      const matchesTarget = await videoAspectMatchesTarget(publicUrl, targetAspectRatio);
      if (!matchesTarget) {
        if (hasManualFirstFrame) {
          throw new Error('Continue needs the previous video\'s final frame to match the selected ratio. Remove the First Frame role from the attached image or disable Continue before generating.');
        }
        assertRoomForFrames(generatedFirstFrames.length + 1);
        generatedFirstFrames.push(await extractContinuationFirstFrame(publicUrl, targetAspectRatio, quality, label, videoModel));
        extractedVideoIndices.push(i);
        continue;
      }
    }

    if (operation === 'edit' && i === 0 && inspectedVideo) {
      editNormalization = getNormalizedVideoDimensions(
        inspectedVideo.width,
        inspectedVideo.height,
        quality,
      );
    }

    requestVideos.push(persistedRef);
  }

  const durationError = seedanceReferenceDurationError(videoModel, seedanceMode([], requestVideos, [], operation), 'video', requestVideos.map(v => v.duration));
  if (durationError) throw new Error(durationError);
  // Validate all sources before requesting potentially billable preprocessing.
  if (editNormalization && requestVideos[0]) {
    requestVideos[0] = {
      ...requestVideos[0],
      url: await normalizeVideoForEdit(requestVideos[0].url, editNormalization.width, editNormalization.height),
    };
  }

  return { requestVideos, persistedVideos, generatedFirstFrames, extractedVideoIndices };
};

// A ratio-adapted continuation is replaced by its final frame. Keep original
// UI tag numbers mapped to the actual provider arrays, including later videos.
export const remapVideoReferencesForRequest = (
  prompt: string,
  extractedVideoIndices: number[],
  originalImageCount: number,
  mode: EvoMode,
): string => {
  if (extractedVideoIndices.length === 0) return prompt;
  return prompt.replace(/\\_/g, '_').replace(/[@#]VIDEO(?:[_ ]?(\d+))?\b/gi, (_match, index) => {
    const sourceIndex = Number(index || 1) - 1;
    const frameIndex = extractedVideoIndices.indexOf(sourceIndex);
    if (frameIndex !== -1) {
      return mode === 'image_to_video'
        ? 'the provided first frame'
        : `@REF_IMAGE_${originalImageCount + frameIndex + 1}`;
    }
    return `@VIDEO_${sourceIndex + 1 - extractedVideoIndices.filter(value => value < sourceIndex).length}`;
  });
};

const buildImageUrls = async (refs: ReferenceImage[], mode: EvoMode) => {
  const resolvedById = new Map<string, string>();
  const urls: string[] = [];
  const inputs = mode === 'image_to_video'
    ? [refs.find(r => r.isFirstFrame), refs.find(r => r.isLastFrame)].filter((ref): ref is ReferenceImage => !!ref)
    : refs;
  for (const ref of inputs) {
    const u = await resolveImageUrl(ref);
    if (!u) throw new Error('A reference image could not be loaded. Restore it before generating so person identities stay correctly matched.');
    urls.push(u);
    resolvedById.set(ref.id, u);
  }
  return { urls, resolvedById };
};

const normalizeVideoPromptWhitespace = (value: string): string => value
  .replace(/[^\S\r\n]{2,}/g, ' ')
  .replace(/[ \t]+$/gm, '')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/,\s*,/g, ',')
  .trim();

const matchReplacementCase = (source: string, replacement: string): string =>
  /^[A-Z]/.test(source)
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement;

/**
 * Seedance 2.5 infers edit/extend jobs from prompt wording even when the
 * reference-to-video endpoint is used. Those inferred jobs reject a fixed
 * aspect ratio asynchronously. Generate mode means "compose a new shot", so
 * make that intent unambiguous and remove the provider's documented trigger
 * wording before submitting fixed-ratio reference generations.
 */
export const prepareSeedanceReferenceGenerationPrompt = (
  prompt: string,
  aspectRatio: Exclude<VideoAspectRatio, 'adaptive'>,
  referenceCount: number,
  continuationSource?: string,
): string => {
  const referenceTags = Array.from(
    { length: referenceCount },
    (_, index) => `@video${index + 1}`,
  );
  const referenceList = referenceTags.length > 1
    ? `${referenceTags.slice(0, -1).join(', ')} and ${referenceTags[referenceTags.length - 1]}`
    : referenceTags[0] || 'the attached material';

  // Keep literal copy opaque while matching whole commands around quoted nouns.
  const literals: string[] = [];
  let literalMarker = '\uE000';
  while (prompt.includes(literalMarker)) literalMarker += literalMarker;
  const protectedPrompt = prompt.replace(getMultilineQuotedPromptPattern(), literal => `${literalMarker}${literals.push(literal) - 1}\uE001`);
  const rephrased = protectedPrompt
    .replace(/\[(?:EDIT|EXTEND)(?:\s+DIRECTION)?\]/gi, '[NEW SHOT DIRECTION]')
    .replace(
      /\b(?:edit|extend)\s+(@video\d+)\b[^:.\n\uE000]*[:.]\s*/gi,
      (_match, tag: string) => `Use ${tag} as visual reference material. `,
    )
    .replace(
      /\breplace\s+([^.!?\n]{1,160}?)\s+with\s+([^.!?\n]{1,160})(?=[.!?\n]|$)/gi,
      '$2 appears in place of $1',
    )
    .replace(
      /\b(?:remove|delete)\s+([^.!?\n]{1,160})(?=[.!?\n]|$)/gi,
      '$1 is absent from the new shot',
    )
    .replace(
      /\b(?:add|insert)\s+([^.!?\n]{1,160})(?=[.!?\n]|$)/gi,
      'The new shot features $1',
    )
    .replace(
      /\bchange\s+([^.!?\n]{1,120}?)\s+(?:to|into)\s+([^.!?\n]{1,120})(?=[.!?\n]|$)/gi,
      '$1 appears as $2',
    )
    .replace(
      /\b(?:edit|edits|editing|edited|add|adds|adding|added|insert|inserts|inserting|inserted|remove|removes|removing|removed|delete|deletes|deleting|deleted|change|changes|changing|changed|modify|modifies|modifying|modified|replace|replaces|replacing|replaced|extend|extends|extending|extended|continue|continues|continuing|continued|sequel)\b/gi,
      (word) => {
        const replacements: Record<string, string> = {
          edit: 'compose',
          edits: 'composes',
          editing: 'composing',
          edited: 'composed',
          add: 'feature',
          adds: 'features',
          adding: 'featuring',
          added: 'featured',
          insert: 'place',
          inserts: 'places',
          inserting: 'placing',
          inserted: 'placed',
          remove: 'omit',
          removes: 'omits',
          removing: 'omitting',
          removed: 'omitted',
          delete: 'omit',
          deletes: 'omits',
          deleting: 'omitting',
          deleted: 'omitted',
          change: 'render',
          changes: 'renders',
          changing: 'rendering',
          changed: 'rendered',
          modify: 'render',
          modifies: 'renders',
          modifying: 'rendering',
          modified: 'rendered',
          replace: 'feature',
          replaces: 'features',
          replacing: 'featuring',
          replaced: 'featured',
          extend: 'depict',
          extends: 'depicts',
          extending: 'depicting',
          extended: 'depicted',
          continue: 'depict',
          continues: 'depicts',
          continuing: 'depicting',
          continued: 'depicted',
          sequel: 'following shot',
        };
        return matchReplacementCase(word, replacements[word.toLowerCase()] || word);
      },
    );

  const direction = continuationSource
    ? `Create a new ${aspectRatio} shot that chronologically follows ${continuationSource}'s final visible moment. Match the opening pose, identity, environment, camera framing, and motion to that terminal state; portray only subsequent action. Use other attached material as supplementary visual guidance.`
    : `Create a new standalone ${aspectRatio} composition. Use ${referenceList} only as visual reference material for the people, setting, lighting, camera language, and motion. The result is a newly generated shot with independent framing.`;
  return normalizeVideoPromptWhitespace(`${direction} ${rephrased}`)
    .replace(new RegExp(`${literalMarker}(\\d+)\uE001`, 'g'), (_match, index) => literals[Number(index)]);
};

// Convert app-internal @ tags (and user-entered @/# aliases) to each
// provider's accepted prompt language. H3 Max receives ordered start/end
// images rather than numbered media references, so no @ marker survives.
const findPersonGroup = (refs: ReferenceImage[], id: number) => {
  const group = getPersonGroups(refs).find(person => person.id === id);
  if (!group) throw new Error(`Person ${id} için ekli referans yok.`);
  return group;
};

const cleanPromptForVideoModel = (
  prompt: string,
  videoModel: VideoModelId,
  refs: ReferenceImage[],
  videoOperation: VideoOperation,
): string => {
  const literals: string[] = [];
  let literalMarker = '\uE000';
  while (prompt.includes(literalMarker)) literalMarker += literalMarker;
  let cleaned = prompt.replace(getMultilineQuotedPromptPattern(), literal => `${literalMarker}${literals.push(literal) - 1}\uE001`);
  const restoreLiterals = (value: string): string => value
    .replace(new RegExp(`${literalMarker}(\\d+)\uE001`, 'g'), (_match, index) => literals[Number(index)]);
  if (videoModel === 'minimax-h3') {
    const frameLabel = (rawIndex: string): string => {
      const index = Number(rawIndex);
      if (refs.length === 0) return 'the described scene';
      if (index === 1) return 'the start image';
      if (index === 2 && refs.length > 1) return 'the end image';
      return 'the provided image';
    };
    cleaned = cleaned.replace(/\\_/g, '_');
    cleaned = cleaned.replace(/@FIRST[_ ]?FRAME/gi, refs.length > 0 ? 'the start image' : 'the opening scene');
    cleaned = cleaned.replace(/@LAST[_ ]?FRAME/gi, refs.length > 1 ? 'the end image' : 'the closing scene');
    cleaned = cleaned.replace(/@MAIN[_ ]?PERSON/gi, refs.length > 0 ? 'the people in the start image' : 'the described people');
    cleaned = cleaned.replace(/@SECOND[_ ]?PERSON/gi, refs.length > 1 ? 'the people in the end image' : 'the other described people');
    cleaned = cleaned.replace(/@PERSON_\d+\b/gi, refs.length ? 'the people in the provided image' : 'the described people');
    cleaned = cleaned.replace(/@REF[_ ]?IMAGE[_ ]?(\d+)/gi, (_m, n) => frameLabel(n));
    cleaned = cleaned.replace(/[@#]IMAGE[_ ]?(\d+)/gi, (_m, n) => frameLabel(n));
    cleaned = cleaned.replace(/\b(?:reference\s+)?image\s+(\d+)\b/gi, (_m, n) => frameLabel(n));
    cleaned = cleaned.replace(/\[REFERENCE ROLES\]/gi, '[FRAME GUIDANCE]');
    cleaned = cleaned.replace(/\[EDIT DIRECTION\]/gi, '[VIDEO DIRECTION]');
    cleaned = cleaned.replace(/[@#]VIDEO(?:[_ ]?\d+)?\b/gi, 'the described motion');
    cleaned = cleaned.replace(/[@#]AUDIO(?:[_ ]?\d+)?\b/gi, 'the requested sound');
    return restoreLiterals(normalizeVideoPromptWhitespace(cleaned));
  }

  const personBinding = (personId: number, fallback: string): string => {
    const group = getPersonGroups(refs).find(person => person.id === personId);
    if (!group || group.images.length === 0) return fallback;
    const imageTags = group.images
      .map(image => refs.indexOf(image) + 1)
      .filter(index => index > 0)
      .map(index => `@image${index}`);
    return imageTags.length > 0
      ? `${fallback} shown in ${imageTags.join(' and ')} (the SAME single person)`
      : fallback;
  };

  cleaned = cleaned.replace(/@PERSON_(\d+)\b/gi, (_tag, number) => {
    const id = Number(number);
    const group = findPersonGroup(refs, id);
    return `person ${id} shown in ${group.images.map(image => `@image${refs.indexOf(image) + 1}`).join(' and ')} (the SAME single person)`;
  });
  if (getPersonGroups(refs).some(group => group.id > 2)) cleaned += `\n${buildPersonIdentityContract(refs, index => `@image${index + 1}`)}`;

  if (videoModel === 'seedance-2.0' && videoOperation === 'reference_edit') {
    // The July 2026 source-anchored Seedance 2.0 result that users approved
    // passed a single reference video as the bare @VIDEO token. Preserve that
    // empirically successful contract for Ref Edit instead of rewriting it to
    // Seedance 2.5's stricter @video1 syntax.
    cleaned = cleaned.replace(/@MAIN[_ ]?PERSON/gi, () => personBinding(1, 'the first person'));
    cleaned = cleaned.replace(/@SECOND[_ ]?PERSON/gi, () => personBinding(2, 'the second person'));
    cleaned = cleaned.replace(/@REF_IMAGE_(\d+)/gi, (_m, n) => `@image${n}`);
    cleaned = cleaned.replace(/@VIDEO_(\d+)/gi, (_m, n) => Number(n) === 1 ? '@VIDEO' : `reference video ${n}`);
    cleaned = cleaned.replace(/@AUDIO_(\d+)/gi, (_m, n) => `@audio${n}`);
    cleaned = cleaned.replace(/@AUDIO\b/gi, '@audio1');
    return restoreLiterals(normalizeVideoPromptWhitespace(cleaned));
  }

  // Seedance 2.5 is stricter than 2.0 here: a bare @VIDEO can be interpreted
  // as an edit or extension request, while the provider expects @video1,
  // @video2, and so on.
  // Keep the stable identity-to-input binding all the way to Seedance. A
  // generic "first/second person" lets the provider average two people when
  // several identity photos are attached; explicit @imageN tags preserve the
  // group and the SAME-single-person contract from the enhancer.
  cleaned = cleaned.replace(/@MAIN[_ ]?PERSON/gi, () => personBinding(1, 'the first person'));
  cleaned = cleaned.replace(/@SECOND[_ ]?PERSON/gi, () => personBinding(2, 'the second person'));
  cleaned = cleaned.replace(/@REF_IMAGE_(\d+)/gi, (_m, n) => `@image${n}`);
  cleaned = cleaned.replace(/@VIDEO_(\d+)/gi, (_m, n) => `@video${n}`);
  cleaned = cleaned.replace(/@AUDIO_(\d+)/gi, (_m, n) => `@audio${n}`);
  cleaned = cleaned.replace(/@VIDEO\b/gi, '@video1');
  cleaned = cleaned.replace(/@AUDIO\b/gi, '@audio1');
  return restoreLiterals(normalizeVideoPromptWhitespace(cleaned));
};

interface VideoSubmissionContext {
  id: string;
  userId?: string;
  savePreparedReferences?: (refs: Pick<GenerationConfig, 'referenceImages' | 'referenceVideos' | 'referenceAudios'>) => Promise<boolean>;
}

async function submitVideo(path: string, body: object, refs: Pick<GenerationConfig, 'referenceImages' | 'referenceVideos' | 'referenceAudios'>, owner: string | undefined, context?: VideoSubmissionContext) {
  if (context?.savePreparedReferences && !await context.savePreparedReferences(refs)) throw new Error('Could not save video references. No provider request was sent.');
  const headers = await getServerAuthHeaders(owner);
  if (!owner || !headers.Authorization) throw new Error('Sign in before submitting a video.');
  let response: Response;
  try { response = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ ...body, ...(context?.id ? { generationId: context.id } : {}) }) }); }
  catch { throw new RecoverableVideoTaskError('Video acceptance is unknown. Check the saved task before submitting again.'); }
  const result = await response.json().catch(() => null);
  if ((await supabase.auth.getSession()).data.session?.user.id !== owner) throw new RecoverableVideoTaskError('Session changed. Check the saved task from the original account.');
  if (typeof result?.taskId !== 'string' || !result.taskId.trim()) {
    const definitelyNotSent = (result?.code === 'PROVIDER_ADMISSION_REJECTED' && result.providerRequestSent === false)
      || (typeof result?.error === 'string' && /No (?:(?:provider|generation) request was sent|generation was submitted)\./i.test(result.error));
    if (result?.code === 'GENERATION_SUBMITTING' || result?.code === 'SUBMISSION_UNKNOWN' || !result || response.ok || ((response.status === 408 || response.status >= 500) && !definitelyNotSent))
      throw new RecoverableVideoTaskError(result?.error || 'No task ID was confirmed. Check task history before submitting again.');
    throw new Error(result.error || 'The provider rejected this video.');
  }
  return { taskId: result.taskId as string, endpoint: typeof result.endpoint === 'string' ? result.endpoint as string : undefined,
    queueEndpoint: typeof result.queueEndpoint === 'string' ? result.queueEndpoint as string : undefined,
    cost: readEvoReservation(result.usage?.credits_reserved ?? result.usage?.credits_consumed ?? result.usage?.credits_used ?? result.usage?.total_credits) };
}

const usesDesktopMedia = (refs: Pick<GenerationConfig, 'referenceImages' | 'referenceVideos' | 'referenceAudios'>) =>
  refs.referenceImages.some(ref => isWorkspaceMediaUrl(ref.data)) || refs.referenceVideos.some(ref => isWorkspaceMediaUrl(ref.url)) || refs.referenceAudios.some(ref => isWorkspaceMediaUrl(ref.url));

const createOmniVideoTask = async (config: GenerationConfig, initiatingUserId?: string, context?: VideoSubmissionContext) => {
  const error = getOmniConfigError(config);
  if (error) throw new Error(error);
  const mode = getOmniMode(config);
  const referenceImages = await Promise.all(config.referenceImages.map(async image => {
    const url = await resolveImageUrl(image);
    if (!url || !isHttpUrl(url)) throw new Error('An Omni reference image could not be loaded. Attach it again.');
    return { ...image, data: url };
  }));
  const frames = getOmniFrames(referenceImages);
  const referenceVideos = await Promise.all((config.referenceVideos || []).map(async (ref, index) => {
    // Extend accepts any length and conditions on the last 10 seconds.
    const url = await resolveReferenceMediaUrl(ref.url, ref.mimeType, `Omni video ${index + 1}`, 'omni_video', 'mp4', 'video', 1, mode === 'extend' ? Infinity : 15, true);
    const duration = ref.duration ?? await getMediaDuration(url, 'video') ?? undefined;
    return { ...ref, url, duration };
  }));
  const resolved = { ...config, referenceVideos };
  const hydratedError = getOmniConfigError(resolved);
  if (hydratedError) throw new Error(hydratedError);
  const body: OmniRequestBody & { videoModel: typeof OMNI_MODEL } = {
    videoModel: OMNI_MODEL, mode,
    ...(mode !== 'upscale' ? { prompt: normalizeOmniPrompt(config.prompt, mode, referenceImages) } : {}),
    resolution: toOmniResolution(config.videoQuality),
    ...(mode === 'text_to_video' || mode === 'image_to_video' || mode === 'reference_to_video' ? { aspectRatio: config.videoAspectRatio } : {}),
    ...(mode !== 'edit' && mode !== 'upscale' ? { duration: Number(config.videoDuration) } : {}),
    imageUrls: mode === 'image_to_video' ? [frames.start!.data] : referenceImages.map(image => image.data),
    ...(mode === 'image_to_video' && frames.end ? { endImageUrl: frames.end.data } : {}),
    videoUrls: referenceVideos.map(video => video.url),
  };
  const refs = { referenceImages, referenceVideos, referenceAudios: [] as ReferenceAudio[] };
  if (!usesDesktopMedia(refs)) buildOmniInput(body);
  return { ...await submitVideo('/api/fal-h3-video', body, refs, initiatingUserId, context), provider: 'fal' as const,
    cost: estimateOmniCost(resolved) ?? undefined, mode, ...refs };
};

const mediaExtension = (mime: string, kind: 'video' | 'audio') => kind === 'video'
  ? /quicktime|mov/i.test(mime) ? 'mov' : 'mp4'
  : /mpeg|mp3/i.test(mime) ? 'mp3' : 'wav';

/** Both owned EvoLink routes upload native clips without rewriting their content. */
async function prepareEvoClip<T extends ReferenceVideo | ReferenceAudio>(
  ref: T, index: number, kind: 'video' | 'audio', model: typeof EVO_H3_MODEL | typeof MAGI2_MODEL,
) {
  const label = `${kind} ${index + 1}`;
  let url: string | null;
  let { size, mimeType } = ref;
  if (model === MAGI2_MODEL) mimeType = mimeType.split(';')[0].trim().toLowerCase();
  if (isHttpUrl(ref.url)) {
    url = await refreshMediaAccessUrl(ref.url);
  } else {
    if (!/^(?:blob:|data:)/i.test(ref.url)) throw new Error(`Restore ${label} before generating.`);
    const response = await fetch(ref.url);
    if (!response.ok) throw new Error(`Could not read ${label}.`);
    const blob = await response.blob();
    size = blob.size;
    const maxMB = kind === 'audio' ? 15 : model === MAGI2_MODEL ? MAGI2_LIMITS.videoMaxMB : 50;
    if (!size || size > maxMB * 1024 * 1024) throw new Error(`${label} must be nonempty and no larger than ${maxMB} MB.`);
    if (blob.type && blob.type !== 'application/octet-stream') mimeType = blob.type.split(';')[0].trim().toLowerCase();
    if (!EVO_H3_CLIP_MIME[kind].test(mimeType)) throw new Error(`Unsupported ${label} format: ${mimeType}.`);
    const upload = kind === 'video' ? uploadVideoBlobToPublicUrl : uploadBlobToPublicUrl;
    const extension = mediaExtension(mimeType, kind);
    url = await upload(blob, mimeType, `${model === MAGI2_MODEL ? 'magi2' : 'evo_h3'}_${kind}`, extension);
  }
  if (!url || (model === MAGI2_MODEL ? !isMagi2PublicUrl(url) && !isWorkspaceMediaUrl(url) : !isHttpUrl(url))) throw new Error(`Restore ${label} before generating.`);
  const knownDuration = getKnownVideoDuration(ref.duration);
  const metadata = model === EVO_H3_MODEL && kind === 'video' && knownDuration == null ? await inspectVideo(url) : undefined;
  const source = model === MAGI2_MODEL && !isHttpUrl(ref.url) ? ref.url : url;
  const duration = knownDuration ?? (metadata ? metadata.duration : await getMediaDuration(source, kind));
  if (duration == null) throw new Error(`Could not measure ${label}. Reattach it before generating.`);
  return { ...ref, ...(metadata ? { width: metadata.width, height: metadata.height } : {}), url, mimeType, duration, size };
}

const createMagi2VideoTask = async (config: GenerationConfig, owner: string | undefined, context?: VideoSubmissionContext) => {
  if (!owner) throw new Error('Sign in before submitting an EvoLink video.');
  const error = getMagi2Error(config);
  if (error) throw new Error(error);
  const mode = config.magi2Mode ?? 'text_only';
  const duration = config.videoDuration ?? 5;
  const [referenceImages, referenceVideos, referenceAudios] = await Promise.all([
    Promise.all(config.referenceImages.map(async (image, i) => {
      let data: string | null;
      let mimeType = image.mimeType;
      if (/^blob:/i.test(image.data)) {
        const response = await fetch(image.data);
        if (!response.ok) throw new Error(`Could not read Image ${i + 1}.`);
        const blob = await response.blob();
        if (!blob.size || blob.size >= MAGI2_LIMITS.imageMaxMB * 1024 * 1024) throw new Error(`Image ${i + 1} must be nonempty and under ${MAGI2_LIMITS.imageMaxMB} MB.`);
        if (blob.type && blob.type !== 'application/octet-stream') mimeType = blob.type;
        if (!/^image\//i.test(mimeType)) throw new Error(`Image ${i + 1} must be an image file.`);
        data = await uploadBlobToPublicUrl(blob, mimeType, 'magi2_image', 'jpg');
      } else {
        if (isHttpUrl(image.data)) data = await refreshMediaAccessUrl(image.data);
        else {
          const header = /^data:(image\/[\w.+-]+);base64,/i.exec(image.data);
          if (header) mimeType = header[1].toLowerCase();
          data = await uploadBase64ToPublicUrl(image.data, mimeType, 'magi2_image');
        }
      }
      if (!data || (!isMagi2PublicUrl(data) && !isWorkspaceMediaUrl(data))) throw new Error(`Restore Image ${i + 1} with a public HTTPS URL before generating.`);
      return { ...image, data, mimeType };
    })),
    Promise.all((config.referenceVideos || []).map((ref, i) => prepareEvoClip(ref, i, 'video', MAGI2_MODEL))),
    Promise.all((config.referenceAudios || []).map((ref, i) => prepareEvoClip(ref, i, 'audio', MAGI2_MODEL))),
  ]);
  const refs = { referenceImages, referenceVideos, referenceAudios };
  const body = {
    videoModel: MAGI2_MODEL, mode, prompt: getMagi2Prompt(config), duration,
    quality: config.videoQuality ?? '1080p', aspectRatio: config.videoAspectRatio,
    generateAudio: config.audioEnabled ?? true, ...(context?.id ? { generationId: context.id } : {}),
    ...(referenceImages.length ? { imageUrls: getMagi2Images({ magi2Mode: mode, referenceImages }).map(image => image.data) } : {}),
    ...(referenceVideos.length ? { videoUrls: referenceVideos.map(ref => ref.url), videoDurations: referenceVideos.map(ref => ref.duration) } : {}),
    ...(referenceAudios.length ? { audioUrls: referenceAudios.map(ref => ref.url), audioDurations: referenceAudios.map(ref => ref.duration) } : {}),
  };
  if (!usesDesktopMedia(refs)) buildMagi2Input(body);
  const accepted = await submitVideo('/api/evolink-generate', body, refs, owner, context);
  return { ...accepted, provider: 'evolink' as const, cost: accepted.cost ?? estimateVideoCost(MAGI2_MODEL, '1080p', duration, false), mode, ...refs };
};

/** EvoLink accepts native media, not fal's frame controls or Seedance's edit/continuation preprocessing. */
const createEvoH3VideoTask = async (config: GenerationConfig, owner: string | undefined, context?: VideoSubmissionContext) => {
  if (!owner) throw new Error('Sign in before submitting an EvoLink video.');
  const error = getEvoH3MaxError(config);
  if (error) throw new Error(error);
  const mode = getEvoH3DraftMode(config);
  const prompt = normalizeEvoH3Prompt(config.prompt, mode, config);
  const prepareImage = async (image: ReferenceImage, i: number) => {
    // Raw base64 and data URLs contain four characters per three decoded bytes.
    if (!isHttpUrl(image.data)) {
      const encodedLength = image.data.length - (image.data.indexOf(',') + 1);
      if (encodedLength > 4 * Math.ceil(30 * 1024 * 1024 / 3)) throw new Error(`Image ${i + 1} exceeds 30 MB.`);
    }
    const data = await resolveImageUrl(image);
    if (!data || !isHttpUrl(data)) throw new Error(`Restore Image ${i + 1} before generating.`);
    return { ...image, data };
  };
  // Preserve the original media bytes and hydrate missing reference geometry.
  const [images, videos, referenceAudios] = await Promise.all([
    Promise.all(config.referenceImages.map(prepareImage)),
    Promise.all((config.referenceVideos || []).map((v, i) => prepareEvoClip(v, i, 'video', EVO_H3_MODEL))),
    Promise.all((config.referenceAudios || []).map((a, i) => prepareEvoClip(a, i, 'audio', EVO_H3_MODEL))),
  ]);
  const resolved = await hydrateH3MaxReferenceDimensions({ ...config, referenceImages: images, referenceVideos: videos, referenceAudios }, inspectVideo);
  const { referenceImages, referenceVideos } = resolved;
  const hydratedError = getEvoH3MaxError(resolved);
  if (hydratedError) throw new Error(hydratedError);
  const body = {
    videoModel: EVO_H3_MODEL, mode: toEvoH3Mode(mode), duration: config.videoDuration, quality: config.videoQuality,
    prompt,
    ...(mode !== 'image_to_video' ? { aspectRatio: config.videoAspectRatio } : {}),
    ...(referenceImages.length ? { imageUrls: referenceImages.map(i => i.data) } : {}),
    ...(referenceVideos.length ? { videoUrls: referenceVideos.map(v => v.url) } : {}),
    ...(referenceAudios.length ? { audioUrls: referenceAudios.map(a => a.url) } : {}),
    ...(context?.id ? { generationId: context.id } : {}),
  };
  const refs = { referenceImages, referenceVideos, referenceAudios };
  if (!usesDesktopMedia(refs)) buildEvoH3MaxInput(body);
  return { ...await submitVideo('/api/evolink-generate', body, refs, owner, context), provider: 'evolink' as const, mode, ...refs };
};

/** fal accepts the original footage; never apply EvoLink's edit transcode or final-frame extraction. */
async function createFalSeedanceTask(config: GenerationConfig, model: FalSeedanceModel, owner?: string, context?: VideoSubmissionContext) {
  const limits = falSeedanceLimits(model);
  if (!owner) throw new Error('Sign in before submitting a fal video.');
  const { referenceImages: images, referenceVideos: videos = [], referenceAudios: audios = [], videoOperation: operation } = config;
  if (operation === 'upscale') throw new Error('Seedance does not support Upscale.');
  const mode = seedanceMode(images, videos, audios, operation);
  const setupError = getSeedanceFrameError(images, videos.length, audios.length, operation)
    || falSeedanceReferenceError(mode, images.length, videos.length, audios.length, model)
    || falSeedanceReferenceDurationError(mode, 'video', videos.map(ref => getKnownVideoDuration(ref.duration)), model)
    || falSeedanceReferenceDurationError(mode, 'audio', audios.map(ref => getKnownVideoDuration(ref.duration)), model);
  if (setupError) throw new Error(setupError);
  if (operation === 'reference_edit' && (model !== 'seedance-2.0' || !videos.length)) throw new Error('Ref Edit needs Seedance 2.0 and a source video.');
  // Validate person bindings before uploading reference files.
  const continuations = operation === 'generate' ? videos.flatMap((video,i) => video.isContinuation ? ['@Video'+(i+1)] : []) : [];
  const intent = operation === 'reference_edit' ? 'Edit @Video1 as the source footage; preserve anything not requested to change. '
    : continuations.length ? 'Continue seamlessly from '+continuations.join(' and ')+' (the previous shot). ' : '';
  const prompt = mode === 'image_to_video' ? config.prompt.trim() && prepareSeedanceFramePrompt(config.prompt, images)
    : intent + cleanPromptForVideoModel(config.prompt, model, images, operation === 'reference_edit' ? 'generate' : operation);
  const referenceImages = await Promise.all(images.map(async (ref, i) => {
    if (!ref.data) throw new Error(`Restore Image ${i + 1} before generating.`);
    if (!isHttpUrl(ref.data) && ref.data.length - (ref.data.indexOf(',') + 1) > 4 * Math.ceil(limits.imageMB * 1024 * 1024 / 3))
      throw new Error(`Image ${i + 1} exceeds ${limits.imageMB} MB.`);
    const data = await resolveImageUrl(ref, limits.imageMB * 1024 * 1024);
    if (!data || !isHttpUrl(data)) throw new Error(`Restore Image ${i + 1} before generating.`);
    return { ...ref, data };
  }));
  const prepareClip = async (ref: ReferenceVideo | ReferenceAudio, index: number, kind: 'video' | 'audio') => {
    const label = `${kind} ${index + 1}`;
    let { url, size, mimeType } = ref;
    if (isHttpUrl(url)) {
      url = await refreshMediaAccessUrl(url);
    } else {
      if (!/^(blob:|data:)/i.test(url)) throw new Error(`Restore ${label} before generating.`);
      const source = await fetch(url);
      if (!source.ok) throw new Error(`Could not read ${label}.`);
      let blob = await source.blob();
      if (kind === 'audio') blob = await prepareReferenceAudio(blob, label, model === FAL_SEEDANCE_20_MODEL ? 0 : 1.8, limits.referenceSeconds);
      size = blob.size;
      mimeType = blob.type || mimeType;
      const maxMB = kind === 'video' ? limits.videoMB : limits.audioMB;
      if (!size || size > maxMB * 1024 * 1024) throw new Error(`${label} must be nonempty and no larger than ${maxMB} MB.`);
      const upload = kind === 'video' ? uploadVideoBlobToPublicUrl : uploadBlobToPublicUrl;
      url = await upload(blob, mimeType, `fal_seedance_${kind}`, mediaExtension(mimeType, kind)) || '';
    }
    if (!url || !isHttpUrl(url)) throw new Error(`Restore ${label} before generating.`);
    return { url, size, mimeType };
  };
  const [referenceVideos, referenceAudios] = await Promise.all([
    Promise.all(videos.map(async (ref, i) => {
      const clip = await prepareClip(ref, i, 'video');
      const meta = getKnownVideoDuration(ref.duration) && ref.width && ref.height ? ref : await inspectVideo(clip.url);
      if (!meta.duration || !meta.width || !meta.height) throw new Error(`Could not measure Video ${i + 1}. Reattach it before generating.`);
      return { ...ref, ...clip, duration: meta.duration, width: meta.width, height: meta.height };
    })),
    Promise.all(audios.map(async (ref, i) => {
      const clip = await prepareClip(ref, i, 'audio');
      const duration = getKnownVideoDuration(ref.duration) ?? await getMediaDuration(clip.url, 'audio');
      if (!duration) throw new Error(`Could not measure Audio ${i + 1}. Reattach it before generating.`);
      return { ...ref, ...clip, duration };
    })),
  ]);
  const orderedImages = mode === 'image_to_video'
    ? [referenceImages.find(ref => ref.isFirstFrame)!, ...referenceImages.filter(ref => ref.isLastFrame)]
    : referenceImages;
  const { seed, task, draft, outputFormat, ...options } = config.falSeedanceOptions || {};
  const body = {
    ...options, provider: 'fal', videoModel: model, mode, prompt, duration: mode === 'video_edit' ? -1 : config.videoDuration,
    quality: config.videoQuality, aspectRatio: config.videoAspectRatio, generateAudio: config.audioEnabled !== false,
    ...(model !== FAL_SEEDANCE_20_MODEL ? { draft, outputFormat,
      ...(mode === 'reference_to_video' ? { task } : {}),
      ...(mode !== 'text_only' && mode !== 'image_to_video' ? { seed } : {}),
    } : {}),
    imageUrls: orderedImages.map(ref => ref.data), videoUrls: referenceVideos.map(ref => ref.url), audioUrls: referenceAudios.map(ref => ref.url),
    videoDurations: referenceVideos.map(ref => ref.duration), audioDurations: referenceAudios.map(ref => ref.duration),
    mediaMetadata: {
      images: orderedImages.map(({ width, height, mimeType }) => ({ width, height, mimeType })),
      videos: referenceVideos.map(({ width, height, duration, size, mimeType }) => ({ width, height, duration, size, mimeType })),
      audios: referenceAudios.map(({ duration, size, mimeType }) => ({ duration, size, mimeType })),
    },
    generationId: context?.id,
  };
  const refs = { referenceImages, referenceVideos, referenceAudios };
  if (!usesDesktopMedia(refs)) buildFalSeedanceInput(body);
  const accepted = await submitVideo('/api/seedance-video', body, refs, owner, context);
  const usd = model === FAL_SEEDANCE_20_MODEL ? estimateFalSeedance20Usd({ videoQuality: body.quality, videoDuration: body.duration, referenceVideos }) : undefined;
  return { ...accepted, provider: 'fal' as const, cost: usd === undefined ? undefined : {usd, source:'published_estimate' as const}, mode, ...refs };
}

/** Every Max route uses its own media contract; no Seedance extraction or
 * edit preprocessing is allowed to rewrite its source footage. */
const createH3MaxVideoTask = async (config: GenerationConfig, initiatingUserId?: string, context?: VideoSubmissionContext) => {
  const error=getH3MaxConfigError(config);if(error)throw new Error(error);
  const mode=getH3MaxMode(config);
  const referenceImages=await Promise.all(config.referenceImages.map(async image=>{
    const url=await resolveImageUrl(image);
    if(!url||!isHttpUrl(url))throw new Error('An H3 Max reference image could not be loaded. Attach it again.');
    return {...image,data:url};
  }));
  const videoLimits=mode==='extend_video'||mode==='insert_video'?[1.625,60]:mode==='recast'?[5,30]:mode==='relight'?[56/24,15]:[2,15];
  const referenceVideos=await Promise.all((config.referenceVideos||[]).map(async(ref,index)=>{
    const isSupplemental=mode==='insert_video'&&index>0;
    const url=await resolveReferenceMediaUrl(ref.url,ref.mimeType,`H3 Max video ${index+1}`,'h3_video','mp4','video',isSupplemental?2:videoLimits[0],isSupplemental?15:videoLimits[1],true);
    const duration=getKnownVideoDuration(ref.duration)??await getMediaDuration(url,'video')??undefined;
    return {...ref,url,duration};
  }));
  const referenceAudios=await Promise.all((config.referenceAudios||[]).map(async(ref,index)=>{
    if ((mode === 'reference_to_video' && !config.h3MaxOptions?.useTargetAudio) || mode === 'extend_video') return prepareH3ReferenceAudio(ref,index);
    // Lip Sync follows its source. Target soundtracks can extend beyond the generated clip.
    const url=await resolveReferenceMediaUrl(ref.url,ref.mimeType,`H3 Max audio ${index+1}`,'h3_audio','wav','audio',mode==='lip_sync'?5:2,mode==='lip_sync'?900:Infinity,true,mode==='lip_sync'?MAX_VIDEO_UPLOAD_BYTES:15*1024*1024);
    const duration=ref.duration??await getMediaDuration(url,'audio')??undefined;
    return {...ref,url,duration};
  }));
  const resolved=await hydrateH3MaxReferenceDimensions({...config,referenceImages,referenceVideos,referenceAudios},inspectVideo);
  const preparedBody=getH3MaxRequestBody(resolved,{images:new Map(referenceImages.map(image=>[image.id,image.data])),videos:referenceVideos.map(video=>video.url),audios:referenceAudios.map(audio=>audio.url)});
  const body={...preparedBody,mediaMetadata:{...preparedBody.mediaMetadata,
    images:getH3MaxReferenceImages(resolved).map(image=>({width:image.width,height:image.height})),
    videos:resolved.referenceVideos.map(video=>({duration:video.duration,width:video.width,height:video.height,size:video.size})),
  }};
  const refs = { referenceImages: resolved.referenceImages, referenceVideos: resolved.referenceVideos, referenceAudios };
  // The desktop sidecar replaces local media with public URLs and runs the same validator before billing.
  if (!usesDesktopMedia(refs)) buildH3MaxInput(body);
  const accepted = await submitVideo('/api/fal-h3-video', { ...body, videoModel: 'minimax-h3' }, refs, initiatingUserId, context);
  return { ...accepted, provider: 'fal' as const, cost: estimateH3MaxCost(resolved), mode, ...refs };
};

export const createVideoTask = async (
  config: GenerationConfig, context?: VideoSubmissionContext
): Promise<{ taskId: string; provider: AIProvider; endpoint?: string; queueEndpoint?: string; cost?: VideoCost; mode: EvoMode; referenceImages: ReferenceImage[]; referenceVideos: ReferenceVideo[]; referenceAudios: ReferenceAudio[] }> => {
  const { data: { session: startingSession } } = await supabase.auth.getSession();
  const initiatingUserId = startingSession?.user?.id;
  const { prompt, referenceImages, referenceVideos, referenceAudios, videoAspectRatio, videoQuality, videoDuration, audioEnabled } = config;
  const videoModel = config.videoModel || DEFAULT_VIDEO_MODEL;
  const videoOperation = config.videoOperation || 'generate';
  if (context?.userId && initiatingUserId !== context.userId) throw new Error('Session changed before video submission.');
  if (referenceImages.some(ref => typeof ref?.data !== 'string' || !ref.data.trim())) throw new Error('A reference image could not be loaded. Restore it before generating so person identities stay correctly matched.');
  const selectedProvider = await selectProvider(videoModel);
  if (config.videoProvider && selectedProvider !== config.videoProvider) throw new Error('Video provider changed. Review the model settings before submitting.');
  if (videoModel === EVO_H3_MODEL) return selectedProvider === 'evolink' ? createEvoH3VideoTask(config, initiatingUserId, context) : createH3MaxVideoTask(config, initiatingUserId, context);
  if (videoModel === OMNI_MODEL) return createOmniVideoTask(config, initiatingUserId, context);
  if (videoModel === MAGI2_MODEL) return createMagi2VideoTask(config, initiatingUserId, context);
  if (!isSeedanceModel(videoModel)) throw new Error('Unsupported video model.');
  if (selectedProvider === 'fal') return createFalSeedanceTask(config, videoModel, initiatingUserId, context);
  if (selectedProvider === 'evolink') {
    const configError = seedanceConfigError(config);
    if (configError) throw new Error(configError);
  }
  const refVids = referenceVideos || [];
  const refAudios = referenceAudios || [];
  if (videoModel === 'seedance-2.5' && !refVids.some(video => video.isContinuation)) {
    const error = getSeedanceFrameError(referenceImages, refVids.length, refAudios.length, videoOperation);
    if (error) throw new Error(error);
  }
  if (videoOperation === 'reference_edit' && videoModel !== 'seedance-2.0') {
    throw new Error('Ref Edit is available only for Seedance 2.0. Use Video Edit with Seedance 2.5.');
  }
  if ((videoOperation === 'edit' || videoOperation === 'extend') && videoModel !== 'seedance-2.5') {
    throw new Error('Video Edit and Video Extend require Seedance 2.5.');
  }
  if (videoOperation !== 'generate' && refVids.length === 0) {
    const operationLabel = videoOperation === 'reference_edit'
      ? 'Ref Edit'
      : videoOperation === 'edit'
        ? 'Edit'
        : 'Extend';
    throw new Error(`Video ${operationLabel} requires at least one source video.`);
  }

  // Re-create can bypass the composer. Reject incompatible routes before
  // reference preparation, which may itself invoke paid fal.ai resizing.
  const routeError = seedanceProviderError(selectedProvider, {
    videoModel, mode: determineMode(referenceImages, refVids, refAudios, videoOperation),
    duration: videoOperation === 'edit' ? -1 : videoDuration, quality: videoQuality, aspectRatio: videoAspectRatio,
    imageUrls: referenceImages.map(() => ''), videoUrls: refVids.map(() => ''), audioUrls: refAudios.map(() => ''),
    referenceEditMode: videoOperation === 'reference_edit',
  });
  if (routeError) throw new Error(routeError);

  // Same person-tag check cleanPromptForVideoModel runs later, moved ahead of
  // the paid video preparation and the image uploads.
  if (!(videoModel === 'seedance-2.5' && determineMode(referenceImages, refVids, refAudios, videoOperation) === 'image_to_video')) {
    for (const [, id] of (prompt || '').replace(getMultilineQuotedPromptPattern(), '').matchAll(/@PERSON_(\d+)\b/gi)) findPersonGroup(referenceImages, Number(id));
  }

  // Audio size, format and length checks are cheap; run them before the paid
  // fal.ai source-video scaling that prepareReferenceVideos can submit.
  const maximumReferenceDuration = videoModel === 'seedance-2.5' ? 30 : 15;
  const audioUrls = await Promise.all(refAudios.map((a, i) =>
    resolveReferenceMediaUrl(a.url, a.mimeType, `reference audio ${i + 1}`, 'vref_audio', 'mp3', 'audio', 2, maximumReferenceDuration)
  ));

  const audioDurations = await Promise.all(refAudios.map(async audio => audio.duration ?? await getMediaDuration(audio.url, 'audio') ?? undefined));
  const audioError = seedanceReferenceDurationError(videoModel, determineMode(referenceImages, refVids, refAudios, videoOperation), 'audio', audioDurations);
  if (audioDurations.some(value => value === undefined) || audioError) throw new Error(audioError || 'Could not determine the reference audio duration.');

  const preparedVideos = await prepareReferenceVideos(
    refVids,
    videoAspectRatio,
    videoQuality,
    videoModel,
    videoOperation,
    referenceImages.some(image => image.isFirstFrame),
    // The extracted frame becomes one more image reference; stop before extracting if that exceeds the route limit.
    frameCount => {
      const frames = Array.from({ length: frameCount }, () => ({ isFirstFrame: true }) as ReferenceImage);
      const frameRouteError = seedanceProviderError(selectedProvider, {
        videoModel, mode: determineMode([...referenceImages, ...frames], refVids.slice(frameCount), refAudios, videoOperation),
        duration: videoDuration, quality: videoQuality, aspectRatio: videoAspectRatio,
        imageUrls: Array.from({ length: referenceImages.length + frameCount }, () => ''),
        videoUrls: refVids.slice(frameCount).map(() => ''), audioUrls: refAudios.map(() => ''),
      });
      if (frameRouteError) throw new Error(`Continue turns the previous video into a first-frame image, which needs one more image slot than is free. Remove a reference image or disable Continue.`);
    },
  );
  const effectiveReferenceImages = [...referenceImages, ...preparedVideos.generatedFirstFrames];
  const requestReferenceImages=effectiveReferenceImages;
  const mode=determineMode(requestReferenceImages,preparedVideos.requestVideos,refAudios,videoOperation);
  // Internally extracted continuation frames can also be ordinary references.
  // Explicit editor frame roles, however, must never silently fall back to R2V.
  if (videoModel === 'seedance-2.5' && (mode === 'image_to_video' || referenceImages.some(image => image.isFirstFrame || image.isLastFrame))) {
    const error = getSeedanceFrameError(requestReferenceImages, preparedVideos.requestVideos.length, refAudios.length, videoOperation);
    if (error) throw new Error(error);
  }
  const { urls: imageUrls, resolvedById } = await buildImageUrls(requestReferenceImages, mode);
  const videoUrls = preparedVideos.requestVideos.map(v => v.url);
  const resolvedReferenceVideos = preparedVideos.persistedVideos;
  const resolvedReferenceAudios = refAudios.map((a, i) => ({ ...a, url: audioUrls[i] }));

  const hasVideoInput = videoUrls.length > 0;
  const referenceVideoDuration = preparedVideos.requestVideos.reduce(
    (total, video) => total + (video.duration != null && video.duration > 0 ? video.duration : 0),
    0
  );
  const primaryVideoDuration = preparedVideos.requestVideos[0]?.duration != null && preparedVideos.requestVideos[0].duration! > 0
    ? preparedVideos.requestVideos[0].duration!
    : 0;
  const requestDuration = videoOperation === 'edit' ? -1 : videoDuration;
  const cost = estimateVideoCost(
    videoModel,
    videoQuality,
    requestDuration,
    hasVideoInput,
    referenceVideoDuration,
    videoOperation,
    primaryVideoDuration,
    mode === 'reference_to_video' ? imageUrls.length : 0,
    undefined,
  );

  const continuationTags = preparedVideos.requestVideos
    .map((v, i) => v.isContinuation ? `@VIDEO_${i + 1}` : null)
    .filter(Boolean);
  const frameContinuationPrefix = videoOperation === 'generate' && preparedVideos.generatedFirstFrames.length > 0
    ? `Continue seamlessly from the provided first frame extracted from the previous shot, adapting the composition to ${videoAspectRatio}. `
    : '';
  const continuationPrefix = videoOperation === 'generate' && continuationTags.length > 0
    ? `Continue seamlessly from ${continuationTags.join(' and ')} (the previous shot). `
    : '';

  const extendDirection = videoOperation === 'extend'
    && /\b(?:backward|backwards|reverse|geriye|tersine)\b/i.test(prompt || '')
    ? 'backward'
    : 'forward';
  const operationPrefix = videoOperation === 'edit'
    ? 'Edit @video1 as follows: '
    : videoOperation === 'reference_edit'
      ? `Use @VIDEO_1 as the primary source footage and visual source of truth for a source-anchored edit in ${videoAspectRatio === 'adaptive' ? 'a composition faithful to the source' : `${videoAspectRatio} framing`}. Preserve the source action, sequence, visible people and identity, clothing, environment, lighting, and camera language unless the requested change explicitly says otherwise. Apply only the requested changes to the source footage. `
    : videoOperation === 'extend'
      ? `Extend @video1 ${extendDirection} seamlessly: `
      : '';
  const requestPrompt = (operationPrefix + frameContinuationPrefix + continuationPrefix + remapVideoReferencesForRequest(
    prompt || '',
    preparedVideos.extractedVideoIndices,
    referenceImages.length,
    mode,
  )).trim();
  const cleanedPrompt = videoModel === 'seedance-2.5' && mode === 'image_to_video'
    ? prepareSeedanceFramePrompt(requestPrompt, requestReferenceImages)
    : cleanPromptForVideoModel(
      requestPrompt,
      videoModel,
      requestReferenceImages,
      videoOperation,
    );
  const continuedSourceIndex = refVids.findIndex(video => video.isContinuation);
  const continuationSource = continuedSourceIndex < 0 ? undefined : cleanPromptForVideoModel(
    remapVideoReferencesForRequest(`@VIDEO_${continuedSourceIndex + 1}`, preparedVideos.extractedVideoIndices, referenceImages.length, mode),
    videoModel,
    requestReferenceImages,
    videoOperation,
  );
  const finalPrompt = videoModel === 'seedance-2.5'
    && videoOperation === 'generate'
    && videoUrls.length > 0
    && videoAspectRatio !== 'adaptive'
    ? prepareSeedanceReferenceGenerationPrompt(cleanedPrompt, videoAspectRatio, videoUrls.length, continuationSource)
    : cleanedPrompt;
  const body: Record<string, unknown> = {
        provider: selectedProvider, videoModel,
        mode,
        prompt: finalPrompt || undefined,
        duration: requestDuration,
        quality: videoQuality,
        aspectRatio: videoAspectRatio,
        generateAudio: audioEnabled !== false,
        ...(videoOperation === 'reference_edit' ? { referenceEditMode: true } : {}),
        ...(videoOperation === 'edit' ? { editSourcePreparationVersion: 1 } : {}),
        ...(context?.id ? { generationId: context.id } : {}),
      };

  if (imageUrls.length > 0) body.imageUrls = imageUrls;
  if (videoUrls.length > 0) {
    const durations = preparedVideos.requestVideos.map(video => video.duration);
    if (durations.some(value => !value)) throw new Error('Could not measure a reference video. Reattach it before generating.');
    body.videoUrls = videoUrls; body.videoDurations = durations;
  }
  if (audioUrls.length > 0) { body.audioUrls = audioUrls; body.audioDurations = audioDurations; }

  const preparedRouteError = seedanceProviderError(selectedProvider, body as any);
  if (preparedRouteError) throw new Error(preparedRouteError);
  const resolvedReferenceImages = referenceImages.map(ref => ({ ...ref, data: resolvedById.get(ref.id) ?? ref.data }));
  const refs = { referenceImages: resolvedReferenceImages, referenceVideos: resolvedReferenceVideos, referenceAudios: resolvedReferenceAudios };
  const accepted = await submitVideo('/api/seedance-video', body, refs, initiatingUserId, context);
  return { ...accepted, provider: selectedProvider, cost: selectedProvider === 'evolink' ? accepted.cost ?? cost : undefined, mode, ...refs };
};

export interface VideoTaskResult {
  urls: string[];
  actualCostUsd?: number;
  expandedPrompt?: string;
  duration?: number;
  reservedCost?: VideoCost;
  falSeedanceResult?: { seed?: number; draftId?: string; lastFrameUrl?: string };
}

const parseVideoActualCostUsd = (value: unknown): number | undefined => {
  // Missing billing information must retain the published estimate. In
  // particular, Number(null), Number(false), and Number('') all invent $0.
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return undefined;
  const amount = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
};

function readEvoReservation(value: unknown): VideoCost | undefined {
  const credits = parseVideoActualCostUsd(value);
  return credits === undefined ? undefined : { credits, usd: credits / EVOLINK_CREDITS_PER_USD, source: 'provider_reserved' };
}

export const pollVideoTask = async (
  taskId: string,
  onProgress?: (progress: number) => void,
  videoModel: VideoModelId = DEFAULT_VIDEO_MODEL,
  endpoint?: string,
  queueEndpoint?: string,
  provider?: AIProvider,
  expectedUserId?: string,
): Promise<VideoTaskResult> => {
  const { data: { session: startingSession } } = await supabase.auth.getSession();
  const initiatingUserId = startingSession?.user?.id;
  if (expectedUserId && expectedUserId !== initiatingUserId) throw new RecoverableVideoTaskError('Resume this task from the original account.');
  const isFalVideo = provider ? provider === 'fal' : !endpoint?.startsWith('evolink/') && (videoModel === 'minimax-h3' || videoModel === OMNI_MODEL);
  const effectiveQueueEndpoint = queueEndpoint || endpoint || (videoModel === OMNI_MODEL ? OMNI_QUEUE_APP : undefined);
  const isH3Max = isFalVideo && (
    endpoint?.startsWith('minimax/h3-max/') === true
    || effectiveQueueEndpoint === 'minimax/h3-max'
  );
  const routed = taskId.startsWith('bs_fal_') || taskId.startsWith('bs_openrouter_');
  const providerName = videoProviderName(taskId, isFalVideo, provider);
  let consecutiveErrors = 0;
  const MAX_ERRORS = 5;
  let retryableStatusErrors = 0;
  const MAX_RETRYABLE_STATUS_ERRORS = 360; // Keep an accepted task recoverable for up to 30 minutes.

  while (true) {
    const { data: { session: pollingSession } } = await supabase.auth.getSession();
    if (pollingSession?.user?.id !== initiatingUserId) throw new RecoverableVideoTaskError('Session changed while checking the video.');
    let pollDelay = isH3Max ? H3_MAX_POLL_INTERVAL : POLL_INTERVAL;
    try {
      const res = await fetch(
        routed ? `/api/seedance-video?taskId=${encodeURIComponent(taskId)}` : isFalVideo
          ? `/api/fal-h3-video?requestId=${encodeURIComponent(taskId)}${effectiveQueueEndpoint ? `&endpoint=${encodeURIComponent(effectiveQueueEndpoint)}` : ''}`
          : `/api/evolink-status?taskId=${encodeURIComponent(taskId)}`,
        { headers: await getServerAuthHeaders(initiatingUserId), cache: 'no-store' },
      );
      if (res.status === 429) {
        const retryAfter = res.headers?.get('retry-after');
        if (retryAfter && /^\d+$/.test(retryAfter)) {
          const waitMs = Number(retryAfter) * 1000;
          if (waitMs >= 30 * 60_000) throw new RecoverableVideoTaskError('Rate limited. Resume the saved video later.');
          pollDelay = Math.max(pollDelay, waitMs);
        }
      }

      let data: any;
      // Read the body once: after json() fails, text() is always empty.
      const text = await res.text().catch(() => '');
      if ((await supabase.auth.getSession()).data.session?.user.id !== initiatingUserId) throw new RecoverableVideoTaskError('Session changed while checking the video.');
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 100)}`);
      }

      if (!res.ok) {
        throw new VideoStatusHttpError(
          data.error || `Status check failed (${res.status})`,
          res.status,
          data.retryable === true
        );
      }

      consecutiveErrors = 0;
      retryableStatusErrors = 0;

      if (data.status === 'SUCCEEDED') {
        const output = Array.isArray(data.output) ? data.output : [];
        if (output.length === 0) {
          throw new TerminalVideoTaskError('Video generation completed without an output URL');
        }
        onProgress?.(1);
        const actualCostUsd = parseVideoActualCostUsd(data.actualCostUsd);
        const expandedPrompt = typeof data.expandedPrompt === 'string' && data.expandedPrompt.trim().length > 0
          ? data.expandedPrompt.trim()
          : undefined;
        const providerDuration = typeof data.duration === 'number' && Number.isFinite(data.duration) && data.duration > 0 ? data.duration : undefined;
        return {
          urls: output,
          actualCostUsd,
          ...(!routed && !isFalVideo ? { reservedCost: readEvoReservation(data.usage?.credits_reserved) } : {}),
          ...(taskId.startsWith('bs_fal_') ? { falSeedanceResult: {
            seed: Number.isSafeInteger(data.seed) ? data.seed : undefined, draftId: typeof data.draftId === 'string' ? data.draftId : undefined,
            lastFrameUrl: typeof data.lastFrameUrl === 'string' && /^https:\/\//i.test(data.lastFrameUrl) ? data.lastFrameUrl : undefined,
          } } : {}),
          expandedPrompt,
          duration: providerDuration ?? (isH3Max ? await getMediaDuration(output[0], 'video') ?? undefined : undefined),
        };
      }
      if (data.status === 'FAILED') throw new TerminalVideoTaskError(data.error || 'Video generation failed');
      if (data.status === 'CANCELLED') throw new TerminalVideoTaskError(data.error || 'Video generation was cancelled');
      onProgress?.(data.progress ?? 0);
    } catch (err: any) {
      if (err instanceof TerminalVideoTaskError || isRecoverableVideoTaskError(err)) throw err;
      if (err instanceof VideoStatusHttpError && err.retryable) {
        retryableStatusErrors++;
        consecutiveErrors = 0;
        if (retryableStatusErrors >= MAX_RETRYABLE_STATUS_ERRORS) {
          throw new RecoverableVideoTaskError(
            err.status === 402
              ? `${providerName} accepted the task, but its status is temporarily unavailable because the account balance is low. The task ID was saved and will be checked again after refresh.`
              : `${providerName} accepted the task, but its result is temporarily unavailable. The task ID was saved and will be checked again after refresh.`
          );
        }
        if (retryableStatusErrors === 1 || retryableStatusErrors % 12 === 0) {
          console.warn(`${providerName} status returned ${err.status}; task is still recoverable (${retryableStatusErrors}/${MAX_RETRYABLE_STATUS_ERRORS}).`);
        }
      } else {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_ERRORS) {
          throw new RecoverableVideoTaskError(
            `${providerName} task status is temporarily unavailable. The task ID was saved and will be checked again after refresh. ${err.message || ''}`.trim()
          );
        }
        console.warn(`Poll error (${consecutiveErrors}/${MAX_ERRORS}), retrying:`, err.message);
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollDelay));
  }
};

export const logVideoUsage = (prompt: string, count: number, config: GenerationConfig, mode: EvoMode, cost: VideoCost | undefined) => {
  const videoModel = config.videoModel || DEFAULT_VIDEO_MODEL;
  const referenceVideoDuration = (config.referenceVideos || []).reduce(
    (total, video) => total + (video.duration != null && video.duration > 0 ? video.duration : 0),
    0,
  );
  const evoH3 = videoModel === EVO_H3_MODEL && config.videoProvider === 'evolink';
  const usageModel = videoModel === MAGI2_MODEL && (mode === 'text_only' || mode === 'image_to_video' || mode === 'reference_to_video')
    ? MAGI2_ENDPOINTS[mode]
    : evoH3 && (mode === 'text_to_video' || mode === 'image_to_video' || mode === 'reference_to_video')
      ? EVO_H3_ENDPOINTS[toEvoH3Mode(mode)]
      : videoModel + '-' + mode.replace(/_/g, '-');
  logUsage('video_generate', usageModel, prompt, count, {
    videoProvider: config.videoProvider,
    estimatedCost: cost?.usd ?? null,
    videoQuality: config.videoQuality,
    videoDuration: config.videoDuration,
    audioEnabled: evoH3 ? undefined : config.audioEnabled !== false,
    referenceImageCount: config.referenceImages.length,
    referenceVideoCount: (config.referenceVideos || []).length,
    referenceVideoDuration,
    primaryVideoDuration: config.referenceVideos?.[0]?.duration != null && config.referenceVideos[0].duration! > 0
      ? config.referenceVideos[0].duration
      : 0,
    videoOperation: config.videoOperation || 'generate',
    promptExpansionMode: videoModel === EVO_H3_MODEL && !evoH3 ? config.h3MaxOptions?.promptExpansionMode || config.videoPromptExpansionMode || 'balanced' : undefined,
    h3MaxMode: videoModel === EVO_H3_MODEL ? getH3MaxMode(config) : undefined,
    h3MaxOptions: videoModel === EVO_H3_MODEL && !evoH3 ? config.h3MaxOptions : undefined,
    referenceAudioCount: (config.referenceAudios || []).length,
  }).catch(e => console.warn('Failed to log video usage:', e));
};
