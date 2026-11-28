import { referencePrompt } from './seedanceProviders.ts';
/** Providers fetch reference media themselves: only HTTPS without embedded credentials is forwarded. */
const isReferenceUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};
import { FAL_SEEDANCE_20_MODEL, FAL_SEEDANCE_MODEL, isFalSeedanceModel, type FalSeedanceModel } from './falSeedanceModel.ts';
import type { SeedanceMode } from './seedance.js';

// US schemas: https://fal.ai/models/bytedance/seedance-2.5/us/reference-to-video/api
// Text and image have their own schemas (notably, neither accepts an input seed).
export { FAL_SEEDANCE_MODEL, FAL_SEEDANCE_20_MODEL, isFalSeedanceModel, type FalSeedanceModel };
export const FAL_SEEDANCE_QUEUE_APP = 'bytedance/seedance-2.5';
const US = `${FAL_SEEDANCE_QUEUE_APP}/us`;
export const FAL_SEEDANCE_ENDPOINTS = {
  text_only: `${US}/text-to-video`, image_to_video: `${US}/image-to-video`,
  reference_to_video: `${US}/reference-to-video`, video_edit: `${US}/reference-to-video`, video_extend: `${US}/reference-to-video`,
} as const satisfies Record<SeedanceMode, string>;
// Standard (not US, fast or mini): https://fal.ai/models/bytedance/seedance-2.0/reference-to-video/llms.txt
export const FAL_SEEDANCE_20_QUEUE_APP = 'bytedance/seedance-2.0';
export const FAL_SEEDANCE_20_ENDPOINTS = {
  text_only: `${FAL_SEEDANCE_20_QUEUE_APP}/text-to-video`,
  image_to_video: `${FAL_SEEDANCE_20_QUEUE_APP}/image-to-video`,
  reference_to_video: `${FAL_SEEDANCE_20_QUEUE_APP}/reference-to-video`,
} as const;
export const falSeedanceQueueApp = (model: FalSeedanceModel) =>
  model === FAL_SEEDANCE_20_MODEL ? FAL_SEEDANCE_20_QUEUE_APP : FAL_SEEDANCE_QUEUE_APP;
export const FAL_SEEDANCE_QUALITIES = ['480p', '720p', '1080p', '4K'] as const;
export const FAL_SEEDANCE_LIMITS = {
  images: 30, videos: 10, audios: 10, imageMB: 30, videoMB: 200, audioMB: 15,
  outputSeconds: 30, referenceSeconds: 30.2, extensionSeconds: 120,
} as const;
const FAL_SEEDANCE_20_LIMITS = {
  images: 9, videos: 3, audios: 3, imageMB: 30, videoMB: 50, audioMB: 15,
  outputSeconds: 15, referenceSeconds: 15, extensionSeconds: 0,
} as const;
export const falSeedanceLimits = (model: FalSeedanceModel) =>
  model === FAL_SEEDANCE_20_MODEL ? FAL_SEEDANCE_20_LIMITS : FAL_SEEDANCE_LIMITS;

// Preview only: nominal pixel area and known input+output seconds, not measured usage.
// fal bills per 1,000 tokens ((pixels * seconds * 24) / 1024), subject to minimums.
const nominalPixels: Record<string, number> = { '480p': 640 * 640, '720p': 1280 * 720, '1080p': 1920 * 1080, '4K': 3840 * 2160 };
export function estimateFalSeedance20Usd(config: {
  videoQuality: string; videoDuration: number; referenceVideos?: readonly { duration?: number | null }[];
}): number | undefined {
  const pixels = nominalPixels[config.videoQuality];
  if (!pixels || !Number.isInteger(config.videoDuration) || config.videoDuration < 4 || config.videoDuration > 15) return;
  const videos = config.referenceVideos || [];
  let seconds = config.videoDuration;
  for (const video of videos) {
    if (video.duration == null || !Number.isFinite(video.duration) || video.duration <= 0) return;
    seconds += video.duration;
  }
  const rate = config.videoQuality === '4K' ? (videos.length ? 0.0048 : 0.008) : (videos.length ? 0.0086016 : 0.014);
  return pixels * seconds * 24 / 1024 * rate / 1000;
}

export function falSeedanceReferenceError(mode: SeedanceMode, images: number, videos: number, audios: number, model: FalSeedanceModel = FAL_SEEDANCE_MODEL): string | undefined {
  const limits = falSeedanceLimits(model);
  if (model === FAL_SEEDANCE_20_MODEL) {
    if (!Object.hasOwn(FAL_SEEDANCE_20_ENDPOINTS, mode)) return 'Seedance 2.0 does not support dedicated editing or extension.';
    if (images + videos + audios > 12) return 'Seedance 2.0 supports up to 12 reference files in total.';
    if (mode === 'reference_to_video' && !images && !videos) return 'Seedance 2.0 requires a reference image or video.';
  }
  if (images > limits.images || videos > limits.videos || audios > limits.audios) return `Seedance supports up to ${limits.images} images, ${limits.videos} videos and ${limits.audios} audio references.`;
  if (mode === 'text_only' && (images || videos || audios)) return 'Text-to-video does not accept references.';
  if (mode === 'image_to_video' && (!images || images > 2 || videos || audios)) return 'Image-to-video requires a first frame and optionally a last frame, with no other references.';
  if (mode === 'reference_to_video' && !images && !videos && !audios) return 'Add a reference image, video or audio clip.';
  if ((mode === 'video_edit' || mode === 'video_extend') && !videos) return 'Add a source video for this action.';
}
export function falSeedanceDurationError(_mode: SeedanceMode, seconds: number, model: FalSeedanceModel = FAL_SEEDANCE_MODEL): string | undefined {
  const max = falSeedanceLimits(model).outputSeconds;
  if (seconds !== -1 && (!Number.isInteger(seconds) || seconds < 4 || seconds > max)) return `Seedance duration must be Auto or an integer from 4 to ${max} seconds.`;
}
export function falSeedanceReferenceDurationError(mode: SeedanceMode, kind: 'video' | 'audio', seconds: readonly (number | null | undefined)[], model: FalSeedanceModel = FAL_SEEDANCE_MODEL): string | undefined {
  const limits = falSeedanceLimits(model);
  const standard = model === FAL_SEEDANCE_20_MODEL;
  const limit = !standard && kind === 'video' && mode === 'video_extend' && seconds.length === 1 ? limits.extensionSeconds : limits.referenceSeconds;
  let total = 0;
  for (const value of seconds) {
    if (value == null) continue; // Composition previews may not have measured every clip yet.
    if (!Number.isFinite(value) || value <= 0 || (!standard && value < 1.8) || value > limit) return standard
      ? `Each reference ${kind} duration must be positive and at most ${limit} seconds.`
      : `Each reference ${kind} must be between 1.8 and ${limit} seconds.`;
    total += value;
  }
  if (total > limit + 1e-9) return `Reference ${kind} clips must total no more than ${limit} seconds.`;
  if (standard && kind === 'video' && seconds.length && seconds.every(value => value != null) && total < 2) return 'Reference videos must total at least 2 seconds.';
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function enumField(value: unknown, choices: readonly string[], label: string): string {
  if (typeof value !== 'string' || !choices.includes(value)) throw new Error(`${label} must be ${choices.join(', ')}.`);
  return value;
}
function urls(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isReferenceUrl)) throw new Error(`${label} must be an array of HTTPS URLs without credentials.`);
  return value;
}
const formats = {
  images: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/gif', 'image/heic', 'image/heif'],
  videos: ['video/mp4', 'video/quicktime'], audios: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
};
export const isFalSeedanceMime = (kind: keyof typeof formats, mime: string): boolean =>
  formats[kind].includes(mime.split(';', 1)[0].trim().toLowerCase());
function measured(value: unknown, low: number, high: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) throw new Error(`${label} must be between ${low} and ${high}.`);
  return value;
}
function validateMedia(body: Record<string, unknown>, model: FalSeedanceModel, mode: SeedanceMode, counts: Record<keyof typeof formats, number>) {
  const limits = falSeedanceLimits(model);
  const metadata = body.mediaMetadata === undefined ? {} : body.mediaMetadata;
  if (!record(metadata)) throw new Error('Invalid Seedance media metadata.');
  for (const kind of ['images', 'videos', 'audios'] as const) {
    const items = metadata[kind];
    const durations = kind === 'videos' ? body.videoDurations : kind === 'audios' ? body.audioDurations : undefined;
    for (const values of [items, durations]) if (values !== undefined && (!Array.isArray(values) || values.length !== counts[kind])) throw new Error(`Expected one metadata entry per ${kind} URL.`);
    const maxMB = kind === 'images' ? limits.imageMB : kind === 'videos' ? limits.videoMB : limits.audioMB;
    let bytes = 0;
    const seconds: (number | undefined)[] = [];
    for (let i = 0; i < counts[kind]; i++) {
      const item = Array.isArray(items) ? items[i] : {};
      if (!record(item)) throw new Error(`Invalid ${kind} metadata.`);
      if (item.size !== undefined) bytes += measured(item.size, 0, maxMB * 1024 * 1024, `${kind} file size in bytes`);
      if (item.mimeType !== undefined && item.mimeType !== '' && (typeof item.mimeType !== 'string' || !isFalSeedanceMime(kind, item.mimeType))) throw new Error(`Unsupported ${kind} format.`);
      if (kind === 'videos' && model === FAL_SEEDANCE_20_MODEL) {
        const width = item.width === undefined ? undefined : measured(item.width, 1, Number.MAX_SAFE_INTEGER, 'Video width');
        const height = item.height === undefined ? undefined : measured(item.height, 1, Number.MAX_SAFE_INTEGER, 'Video height');
        if (width && height) measured(width * height, 640 * 640, 834 * 1112, 'Reference video pixel area');
      } else if (kind === 'videos') {
        const width = item.width === undefined ? undefined : measured(item.width, 300, 6000, 'Video width');
        const height = item.height === undefined ? undefined : measured(item.height, 300, 6000, 'Video height');
        if (width && height) measured(width / height, 0.4, 2.5, 'Video aspect ratio');
        if (item.fps !== undefined) measured(item.fps, 24, 60, 'Video frame rate');
      }
      if (kind !== 'images') {
        if (Array.isArray(durations) && (typeof durations[i] !== 'number' || (item.duration != null && durations[i] !== item.duration))) throw new Error(`Invalid or conflicting ${kind} duration metadata.`);
        const duration = Array.isArray(durations) ? durations[i] : item.duration;
        if (duration != null && typeof duration !== 'number') throw new Error(`Invalid ${kind} duration.`);
        seconds.push(duration ?? undefined);
      }
    }
    if (model === FAL_SEEDANCE_20_MODEL && kind === 'videos' && bytes >= maxMB * 1024 * 1024) throw new Error('Reference videos must total under 50 MB.');
    if (kind !== 'images') {
      const error = falSeedanceReferenceDurationError(mode, kind === 'videos' ? 'video' : 'audio', seconds, model);
      if (error) throw new Error(error);
    }
  }
}

/** Translate the app contract into the schema of the explicitly selected fal variant. */
export function buildFalSeedanceInput(body: unknown, authenticatedUserId?: string) {
  if (!record(body) || !isFalSeedanceModel(body.videoModel) || typeof body.mode !== 'string' || !Object.hasOwn(FAL_SEEDANCE_ENDPOINTS, body.mode)) throw new Error('Select a valid fal Seedance model and mode.');
  const model = body.videoModel;
  const standard = model === FAL_SEEDANCE_20_MODEL;
  const mode = body.mode as SeedanceMode;
  const images = urls(body.imageUrls, 'Image references'), videos = urls(body.videoUrls, 'Video references'), audios = urls(body.audioUrls, 'Audio references');
  const error = falSeedanceReferenceError(mode, images.length, videos.length, audios.length, model);
  if (error) throw new Error(error);
  validateMedia(body, model, mode, { images: images.length, videos: videos.length, audios: audios.length });
  if (standard && [body.task, body.seed, body.draft, body.outputFormat].some(value => value !== undefined)) throw new Error('Seedance 2.0 does not accept task, seed, draft or output format controls.');
  if (body.prompt != null && typeof body.prompt !== 'string') throw new Error('Seedance prompt must be text.');
  const prompt = typeof body.prompt === 'string' ? referencePrompt(body.prompt.trim()) : '';
  if (standard && !prompt) throw new Error('A prompt is required for Seedance 2.0.');
  if (mode === 'text_only' && !prompt) throw new Error('A prompt is required for text-to-video.');
  const seconds = body.duration === undefined || body.duration === 'auto' ? -1 : body.duration;
  const durationError = typeof seconds === 'number' ? falSeedanceDurationError(mode, seconds, model) : 'Invalid Seedance duration.';
  if (durationError) throw new Error(durationError);
  const resolution = enumField(body.quality === '4k' ? '4K' : body.quality === undefined ? '720p' : body.quality, FAL_SEEDANCE_QUALITIES, 'Resolution').toLowerCase();
  const ratio = enumField(body.aspectRatio === undefined || body.aspectRatio === 'adaptive' ? 'auto' : body.aspectRatio, ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], 'Aspect ratio');
  const input: Record<string, unknown> = {
    ...(prompt ? { prompt } : {}), resolution: body.draft === true ? '480p' : resolution,
    duration: seconds === -1 || mode === 'video_edit' ? 'auto' : String(seconds),
    aspect_ratio: !standard && (mode === 'image_to_video' || mode === 'video_edit' || mode === 'video_extend') ? 'auto' : ratio,
    generate_audio: true,
  };
  for (const [key, wire] of [['generateAudio', 'generate_audio'], ['draft', 'draft'], ['returnLastFrame', 'return_last_frame']] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'boolean') throw new Error(`${key} must be a boolean.`);
    input[wire] = body[key];
  }
  if (body.bitrateMode !== undefined) input.bitrate_mode = enumField(body.bitrateMode, ['standard', 'high'], 'Bitrate mode');
  if (body.codec !== undefined) input.codec = enumField(body.codec, ['auto', 'H264', 'H265'], 'Codec');
  if (body.outputFormat !== undefined) input.output_format = enumField(body.outputFormat, ['mp4', 'mov'], 'Output format');
  if (authenticatedUserId) input.end_user_id = authenticatedUserId;
  if (mode === 'text_only' || mode === 'image_to_video') {
    if (body.task !== undefined || body.seed !== undefined) throw new Error('Task and seed controls require the reference-to-video endpoint.');
    if (mode === 'image_to_video') {
      input.image_url = images[0];
      if (images.length === 2) input.end_image_url = images[1];
    }
  } else {
    if (!standard) {
      const task = mode === 'video_edit' ? 'editing' : mode === 'video_extend' ? 'extension' : 'reference';
      input.task = body.task === undefined ? task : enumField(body.task, mode === 'reference_to_video' ? ['reference', 'auto'] : [task], 'Task');
    }
    if (images.length) input.image_urls = images;
    if (videos.length) input.video_urls = videos;
    if (audios.length) input.audio_urls = audios;
    if (body.seed !== undefined) {
      if (!Number.isSafeInteger(body.seed)) throw new Error('Seed must be an integer.');
      input.seed = body.seed;
    }
  }
  const endpoint = standard ? FAL_SEEDANCE_20_ENDPOINTS[mode as keyof typeof FAL_SEEDANCE_20_ENDPOINTS] : FAL_SEEDANCE_ENDPOINTS[mode];
  return { mode, endpoint, input };
}
