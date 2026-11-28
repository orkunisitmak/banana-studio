import type { GenerationConfig, ReferenceImage, ReferenceVideo, ReferenceAudio, VideoOperation, SeedanceVideoModelId } from '../../types.js';
import { getSeedanceFrameError } from './seedanceFrames.ts';

export type SeedanceModel = SeedanceVideoModelId;
export type SeedanceMode = 'text_only' | 'image_to_video' | 'reference_to_video' | 'video_edit' | 'video_extend';
export const isSeedanceModel = (model: unknown): model is SeedanceModel => model === 'seedance-2.0' || model === 'seedance-2.5';
export const SEEDANCE_QUALITIES = ['480p', '720p', '1080p', '4K'] as const;
export const isSeedanceQuality = (quality: unknown): quality is typeof SEEDANCE_QUALITIES[number] => SEEDANCE_QUALITIES.some(value => value === quality);

// EvoLink's per-mode schemas: https://evolink.ai/docs/llms.txt (seedance-2.0 / seedance-2.5).
export const SEEDANCE_LIMITS = {
  'seedance-2.0': { outputSeconds: 15, referenceSeconds: 15, images: 9, videos: 3, audios: 3, videoMB: 50 },
  'seedance-2.5': { outputSeconds: 30, referenceSeconds: 30, images: 30, videos: 10, audios: 10, videoMB: 200 },
} as const;

export function seedanceDraftDuration(model: SeedanceModel, operation: VideoOperation, seconds: number): number {
  if (model === 'seedance-2.5' && (operation === 'edit' || seconds === -1)) return -1;
  return Number.isFinite(seconds) && seconds !== -1
    ? Math.max(4, Math.min(SEEDANCE_LIMITS[model].outputSeconds, Math.round(seconds))) : 5;
}

export function seedanceDurationError(model: SeedanceModel, mode: SeedanceMode, seconds: number): string | undefined {
  if (mode === 'video_edit') return seconds === -1 ? undefined : 'Seedance 2.5 Video Edit duration must be Auto (-1).';
  if (seconds === -1 && model === 'seedance-2.5') return;
  const max = SEEDANCE_LIMITS[model].outputSeconds;
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > max) return `Output duration must be an integer from 4 to ${max} seconds${model === 'seedance-2.5' ? ' or Auto (-1)' : ''}.`;
}

export function seedanceReferenceError(model: SeedanceModel, mode: SeedanceMode, images: number, videos: number, audios: number): string | undefined {
  if (mode === 'text_only' && (images || videos || audios)) return 'Text-to-video does not accept references.';
  if (mode === 'image_to_video' && (images < 1 || images > 2 || videos || audios)) return 'First / last frames require one or two images and no video or audio references.';
  if (mode === 'reference_to_video' && !images && !videos && (!audios || model === 'seedance-2.0')) return 'Add a reference image or video for this model.';
  if ((mode === 'video_edit' || mode === 'video_extend') && !videos) return 'Add a source video for this action.';
  const limit = SEEDANCE_LIMITS[model];
  if (images > limit.images || videos > limit.videos || audios > limit.audios) return `Too many references: maximum ${limit.images} images, ${limit.videos} videos and ${limit.audios} audio clips.`;
}

export function seedanceReferenceDurationError(model: SeedanceModel, mode: SeedanceMode, kind: 'video' | 'audio', seconds: readonly (number | undefined)[]): string | undefined {
  const max = SEEDANCE_LIMITS[model].referenceSeconds;
  const min = mode === 'video_edit' && kind === 'video' ? 4 : 2;
  let total = 0;
  for (const duration of seconds) {
    // An unmeasured reference in the composer is checked again during preparation.
    if (duration === undefined) continue;
    if (!Number.isFinite(duration) || duration < min || duration > max) return `Each reference ${kind} must be ${min}-${max} seconds.`;
    total += duration;
  }
  if (total > max) return `Reference ${kind} clips must total no more than ${max} seconds.`;
}

// Start the scrollable compact picker with the upper bound; 30s must not be
// buried below the fold or mixed up with another model's 15s duration options.
const durationOptions = (model: SeedanceModel) => {
  const max = SEEDANCE_LIMITS[model].outputSeconds;
  const options = Array.from({ length: max - 3 }, (_, index) => ({ label: `${max - index}s`, value: String(max - index) }));
  if (model === 'seedance-2.5') options.unshift({ label: 'Auto (4–30s)', value: '-1' });
  return options;
};
export const SEEDANCE_DURATION_OPTIONS = { 'seedance-2.0': durationOptions('seedance-2.0'), 'seedance-2.5': durationOptions('seedance-2.5') };

export function seedanceMode(images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[], operation: VideoOperation): SeedanceMode {
  if (operation === 'edit') return 'video_edit';
  if (operation === 'extend') return 'video_extend';
  if (operation === 'reference_edit') return 'reference_to_video';
  if (images.length && images.every(image => image.isFirstFrame || image.isLastFrame) && !videos.length && !audios.length) return 'image_to_video';
  return images.length || videos.length || audios.length ? 'reference_to_video' : 'text_only';
}

export function seedanceConfigError(config: GenerationConfig): string | undefined {
  const model = config.videoModel;
  if (!isSeedanceModel(model)) return;
  const images = config.referenceImages || [], videos = config.referenceVideos || [], audios = config.referenceAudios || [];
  const mode = seedanceMode(images, videos, audios, config.videoOperation);
  if (!videos.some(video => video.isContinuation) && (model === 'seedance-2.5' || mode === 'image_to_video')) {
    const error = getSeedanceFrameError(images, videos.length, audios.length, config.videoOperation);
    if (error) return error;
  }
  if (config.videoOperation === 'upscale') return 'Seedance does not support the Upscale action.';
  if ((mode === 'video_edit' || mode === 'video_extend') && model !== 'seedance-2.5') return 'Dedicated Edit and Extend require Seedance 2.5.';
  if (config.videoOperation === 'reference_edit' && (model !== 'seedance-2.0' || !videos.length)) return 'Ref Edit requires Seedance 2.0 and a source video.';
  if (!isSeedanceQuality(config.videoQuality)) return 'Choose a Seedance output quality.';
  for (const image of images) {
    if (image.mimeType && !/^image\/(?:jpe?g|png|webp)$/i.test(image.mimeType)) return 'Seedance reference images must be JPEG, PNG or WebP.';
    if (image.width && image.height && (Math.min(image.width, image.height) < 300 || Math.max(image.width, image.height) > 6000 || image.width / image.height < 0.4 || image.width / image.height > 2.5)) return 'Seedance images must be 300–6000 px per side with an aspect ratio between 0.4 and 2.5.';
  }
  if (videos.some(video => video.mimeType && !/^video\/(?:mp4|quicktime|mov)$/i.test(video.mimeType))) return 'Seedance reference videos must be MP4 or MOV.';
  const sizeLimit = SEEDANCE_LIMITS[model].videoMB;
  if (videos.some(video => (video.size || 0) > sizeLimit * 1024 * 1024)) return `Each reference video must be ${sizeLimit} MB or smaller.`;
  if (audios.some(audio => (audio.size || 0) > 15 * 1024 * 1024)) return 'Each reference audio clip must be 15 MB or smaller.';
  return seedanceDurationError(model, mode, mode === 'video_edit' ? -1 : config.videoDuration)
    || seedanceReferenceError(model, mode, images.length, videos.length, audios.length)
    || seedanceReferenceDurationError(model, mode, 'audio', audios.map(audio => audio.duration))
    // Continue may extract a frame instead of sending the input clip. Check that
    // clip's duration only if it remains in the actual request after preparation.
    || seedanceReferenceDurationError(model, mode, 'video', videos.map(video =>
      video.duration === -1 || (config.videoOperation === 'generate' && video.isContinuation && config.videoAspectRatio !== 'adaptive') ? undefined : video.duration));
}
