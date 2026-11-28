/** fal queue contracts verified against each endpoint's OpenAPI on 2026-10-17.
 * https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-max/...
 * The September prompting guide predates 1080P, target audio and editing routes.
 */
import { exceedsCharacterLimit } from './providerTextLimits.ts';
// Retired modes remain readable for saved metadata, billing and pending jobs.
export type H3MaxMode = 'text_to_video' | 'image_to_video' | 'reference_to_video' | 'extend_video' | 'insert_video' | 'lip_sync' | 'recast' | 'relight';
export type H3MaxSelection = H3MaxMode | 'auto';
export type H3MaxExpansionMode = 'disabled' | 'balanced' | 'quality';
export interface H3MaxReferenceCondition { type: 'image' | 'video' | 'audio'; url: string }
export interface H3MaxOptions {
  promptExpansionMode: H3MaxExpansionMode;
  enablePromptExpansion: boolean;
  seed?: number;
  enableTranscription: boolean;
  /** R2V: pin the attached recording as the soundtrack instead of using audio references. */
  useTargetAudio?: boolean;
  enhanceRealism: boolean;
  colorMatch: boolean;
  output: 'extended' | 'continuation';
  startTime: number;
  resumeTime: number;
  imageFrame: 'start' | 'end';
  /** Stable browser selections. The client resolves these to refreshed upload URLs. */
  startImageId?: string;
  endImageId?: string;
  middleImageId?: string;
  startImageUrl?: string;
  endImageUrl?: string;
  middleImageUrl?: string;
  middleFrameTime?: number;
  referenceConditions?: H3MaxReferenceCondition[];
}
export const DEFAULT_H3_MAX_OPTIONS: H3MaxOptions = {
  promptExpansionMode: 'balanced', enablePromptExpansion: true, enableTranscription: false,
  enhanceRealism: false, colorMatch: true, output: 'extended', startTime: 1.625, resumeTime: 3.25,
  imageFrame: 'start',
};
export const usesH3MaxTargetAudio = (mode: H3MaxMode, useTargetAudio?: unknown): boolean =>
  mode === 'text_to_video' || mode === 'image_to_video' || (mode === 'reference_to_video' && useTargetAudio === true);
export const H3_MAX_ENDPOINTS: Record<H3MaxMode, string> = {
  text_to_video: 'minimax/h3-max/text-to-video', image_to_video: 'minimax/h3-max/image-to-video',
  reference_to_video: 'minimax/h3-max/reference-to-video', extend_video: 'minimax/h3-max/extend-video',
  insert_video: 'minimax/h3-max/insert-video', lip_sync: 'minimax/h3-max/lip-sync/image-to-video',
  recast: 'minimax/h3-max/recast', relight: 'minimax/h3-max/relight',
};
export const H3_MAX_MODE_OPTIONS: { value: H3MaxMode; label: string }[] = [
  { value: 'text_to_video', label: 'Text to Video Max' }, { value: 'image_to_video', label: 'Image to Video Max' },
  { value: 'reference_to_video', label: 'Reference to Video Max' }, { value: 'extend_video', label: 'Extend Video Max' },
  { value: 'lip_sync', label: 'Lip Sync Max' }, { value: 'recast', label: 'Recast' },
];
export const isH3MaxModeAvailable = (mode: H3MaxMode): boolean => H3_MAX_MODE_OPTIONS.some(option => option.value === mode);
const modeLabel = (mode: H3MaxMode): string => H3_MAX_MODE_OPTIONS.find(option => option.value === mode)?.label
  || (mode === 'insert_video' ? 'Insert Video Max' : 'Relight Max');
interface CountRange { min: number; max: number }
export interface H3MaxCapability {
  resolutions: string[]; duration: { min: number; max: number; default: number } | null;
  aspectRatios: string[]; prompt: 'required' | 'optional' | 'unsupported';
  images: CountRange; videos: CountRange; audios: CountRange; description: string;
}
const fixedRatios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const nativeResolutions = ['480P', '768P', '1080P'];
const generatedDuration = { min: 0.92, max: 15, default: 5 };
const none = { min: 0, max: 0 }; const one = { min: 1, max: 1 };
export const H3_MAX_CAPABILITIES: Record<H3MaxMode, H3MaxCapability> = {
  text_to_video: { resolutions: nativeResolutions, duration: generatedDuration, aspectRatios: fixedRatios, prompt: 'required', images: none, videos: none, audios: { min: 0, max: 1 }, description: 'Prompt with optional target soundtrack.' },
  image_to_video: { resolutions: nativeResolutions, duration: generatedDuration, aspectRatios: [], prompt: 'required', images: { min: 1, max: 2 }, videos: none, audios: { min: 0, max: 1 }, description: 'Start and optional end frame, or an end frame alone; optional target soundtrack. The frame determines the canvas.' },
  reference_to_video: { resolutions: nativeResolutions, duration: generatedDuration, aspectRatios: ['adaptive', ...fixedRatios], prompt: 'required', images: { min: 0, max: 9 }, videos: { min: 0, max: 3 }, audios: { min: 0, max: 3 }, description: 'Up to 12 reference images, videos and audio clips; optional keyframes. Use audio as a reference or pin one track as the soundtrack.' },
  extend_video: { resolutions: [...nativeResolutions, '2K'], duration: { min: 0.71, max: 15, default: 5 }, aspectRatios: ['auto', ...fixedRatios], prompt: 'required', images: none, videos: one, audios: { min: 0, max: 3 }, description: 'Continue a source video with optional audio references. Return the full extended video or continuation.' },
  insert_video: { resolutions: ['480P', '768P'], duration: { min: 5, max: 13, default: 5 }, aspectRatios: [], prompt: 'optional', images: { min: 0, max: 9 }, videos: { min: 1, max: 4 }, audios: none, description: 'First video is the source; up to three additional videos guide the inserted scene between start and resume times.' },
  lip_sync: { resolutions: [...nativeResolutions, '2K'], duration: null, aspectRatios: [], prompt: 'unsupported', images: one, videos: none, audios: one, description: 'Animate one image to one supplied audio track (5 seconds to 15 minutes). Duration follows the audio.' },
  recast: { resolutions: ['768P', '1080P'], duration: null, aspectRatios: [], prompt: 'optional', images: { min: 1, max: 4 }, videos: one, audios: none, description: 'One photo per replacement person, replacing source people from left to right. Motion, cuts and soundtrack follow the source.' },
  relight: { resolutions: [...nativeResolutions, '2K'], duration: null, aspectRatios: ['adaptive', ...fixedRatios], prompt: 'unsupported', images: one, videos: one, audios: none, description: 'A lighting-sphere reference image relights the source video. Motion and soundtrack follow the source.' },
};

export const normalizeH3MaxMode = (raw: unknown): H3MaxMode | undefined => {
  if (raw === 'text_only') return 'text_to_video';
  return typeof raw === 'string' && Object.hasOwn(H3_MAX_ENDPOINTS, raw) ? raw as H3MaxMode : undefined;
};
export const resolveH3MaxMode = (selection: unknown, counts: { images: number; videos: number; audios: number }): H3MaxMode => {
  const explicit = normalizeH3MaxMode(selection);
  if (explicit) return explicit;
  if (selection !== undefined && selection !== null && selection !== 'auto') throw new Error('Invalid MiniMax H3 Max mode');
  if (counts.videos || counts.images > 2 || (counts.audios && counts.images)) return 'reference_to_video';
  return counts.images ? 'image_to_video' : 'text_to_video';
};

export interface H3MaxMediaMetadata { duration?: number | null; width?: number; height?: number; size?: number; shotCount?: number; maxShotDuration?: number }
export interface H3MaxMediaSet { images?: H3MaxMediaMetadata[]; videos?: H3MaxMediaMetadata[]; audios?: H3MaxMediaMetadata[]; startFrame?: Pick<H3MaxMediaMetadata, 'width' | 'height'> }
const finiteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
};
const between = (value: unknown, min: number, max: number, label: string): number => {
  const number = finiteNumber(value, label);
  if (number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return number;
};
const validateTimedReferences = (media: H3MaxMediaMetadata[], label: string) => {
  let total = 0;
  for (const item of media) if (item.duration !== undefined && item.duration !== null) total += between(item.duration, 2, 15, `${label} duration`);
  if (total > 15.001) throw new Error(`${label} combined duration must not exceed 15 seconds`);
};
/** Uses decoded file metadata when available. Provider still validates the actual uploaded media. */
export const validateH3MaxMediaMetadata = (mode: H3MaxMode, media: H3MaxMediaSet, options: Partial<H3MaxOptions> = {}): void => {
  const videos = media.videos || []; const audios = media.audios || [];
  const targetAudio = usesH3MaxTargetAudio(mode, options.useTargetAudio);
  if (mode === 'reference_to_video') validateTimedReferences(videos, 'Reference video');
  if ((mode === 'reference_to_video' && !targetAudio) || mode === 'extend_video') validateTimedReferences(audios, 'Reference audio');
  if (mode === 'insert_video') validateTimedReferences(videos.slice(1), 'Reference video');
  if (targetAudio) for (const audio of audios) {
    if (audio.duration != null && audio.duration < 2) throw new Error('Target audio must be at least 2 seconds long');
    if (audio.size != null && audio.size > 15 * 1024 * 1024) throw new Error('Target audio must not exceed 15 MB');
  }
  const source = videos[0];
  if (source) {
    if (source.duration != null) {
      if (mode === 'extend_video') between(source.duration, 1.625, 60, 'Extend source duration');
      if (mode === 'insert_video') {
        between(source.duration, 1.625, 60, 'Insert source duration');
        if ((options.resumeTime ?? DEFAULT_H3_MAX_OPTIONS.resumeTime) >= source.duration) throw new Error('Insert resume time must fall within the source video and leave footage after it');
      }
      if (mode === 'recast') between(source.duration, 5, 30, 'Recast source duration');
      if (mode === 'relight') between(source.duration, 56 / 24, 15, 'Relight source duration');
    }
    if (mode === 'recast' && source.maxShotDuration != null && source.maxShotDuration > 15) throw new Error('Recast source shots must not exceed 15 seconds');
    if ((mode === 'extend_video' || mode === 'insert_video') && source.size != null && source.size > 50 * 1024 * 1024) throw new Error(`${mode === 'extend_video' ? 'Extend' : 'Insert'} source must not exceed 50 MB`);
    if (mode === 'extend_video' && source.width && source.height) between(source.width / source.height, 0.4, 2.5, 'Extend source aspect ratio');
  }
  if (mode === 'reference_to_video') for (const image of media.images || []) if (image.width && image.height) between(image.width / image.height, 0.4, 2.5, 'Reference image aspect ratio');
  if (mode === 'lip_sync') {
    const image = media.images?.[0]; if (image?.width && image.height) between(image.width / image.height, 0.4, 2.5, 'Lip Sync image aspect ratio');
    if (audios[0]?.duration != null) between(audios[0].duration, 5, 900, 'Lip Sync audio duration');
  }
};

const publicUrl = (raw: unknown, label: string): string => {
  if (typeof raw !== 'string') throw new Error(`${label} must be an HTTP(S) URL`);
  try { const url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
  catch { throw new Error(`${label} must be an HTTP(S) URL`); }
  return raw;
};
const urls = (raw: unknown, label: string): string[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`${label} must be an array of HTTP(S) URLs`);
  return raw.map((entry, index) => publicUrl(entry, `${label} ${index + 1}`));
};
const validateCount = (count: number, allowed: CountRange, label: string, mode: H3MaxMode) => {
  if (count < allowed.min || count > allowed.max) throw new Error(`${modeLabel(mode)} requires ${allowed.min === allowed.max ? allowed.min : `${allowed.min}–${allowed.max}`} ${label}`);
};
const optionBoolean = (options: Record<string, unknown>, key: keyof H3MaxOptions, fallback: boolean): boolean => {
  const value = options[key]; if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
  return value;
};
export interface H3MaxRequestBody {
  mode?: unknown; prompt?: unknown; duration?: unknown; resolution?: unknown; aspectRatio?: unknown;
  imageUrls?: unknown; videoUrls?: unknown; audioUrls?: unknown; options?: unknown;
  promptExpansionMode?: unknown; mediaMetadata?: H3MaxMediaSet;
}
/** Pure whitelist mapper shared by the browser preflight and authenticated server. */
export const buildH3MaxInput = (body: H3MaxRequestBody): { mode: H3MaxMode; endpoint: string; input: Record<string, unknown> } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid MiniMax H3 Max request body');
  const imageUrls = urls(body.imageUrls, 'Image URLs'); const videoUrls = urls(body.videoUrls, 'Video URLs'); const audioUrls = urls(body.audioUrls, 'Audio URLs');
  const mode = resolveH3MaxMode(body.mode, { images: imageUrls.length, videos: videoUrls.length, audios: audioUrls.length });
  if (!isH3MaxModeAvailable(mode)) throw new Error(`${modeLabel(mode)} is no longer available. Choose another H3 Max action.`);
  const capability = H3_MAX_CAPABILITIES[mode];
  validateCount(imageUrls.length, capability.images, 'images', mode); validateCount(videoUrls.length, capability.videos, 'videos', mode); validateCount(audioUrls.length, capability.audios, 'audio clips', mode);
  if (body.options != null && (typeof body.options !== 'object' || Array.isArray(body.options))) throw new Error('MiniMax H3 Max options must be an object');
  const options = (body.options || {}) as Record<string, unknown>;
  const targetAudio = usesH3MaxTargetAudio(mode, mode === 'reference_to_video' && optionBoolean(options, 'useTargetAudio', false));
  const referenceAudioUrls = targetAudio ? [] : audioUrls;
  if (body.prompt !== undefined && body.prompt !== null && typeof body.prompt !== 'string') throw new Error('Prompt must be text');
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const maxPrompt = mode === 'recast' ? 2000 : 50_000;
  if (capability.prompt === 'required' && !prompt) throw new Error('Prompt is required for this MiniMax H3 Max mode');
  if (capability.prompt === 'unsupported' && prompt) throw new Error(`${modeLabel(mode)} uses supplied media and does not accept a text prompt`);
  if (exceedsCharacterLimit(prompt, maxPrompt)) throw new Error(`Prompt must not exceed ${maxPrompt.toLocaleString('en-US')} characters`);
  const resolution = String(body.resolution || (mode === 'recast' ? '1080P' : '768P')).toUpperCase();
  if (!capability.resolutions.includes(resolution)) throw new Error(`MiniMax H3 Max ${mode} resolution must be ${capability.resolutions.join(', ')}`);
  const input: Record<string, unknown> = { resolution: mode === 'insert_video' ? resolution.toLowerCase() : resolution };
  // Preserve the existing server-owned screening policy. Insert has no checker field.
  if (mode !== 'insert_video') input.enable_safety_checker = false;
  if (prompt) input.prompt = prompt;
  let duration: number | undefined;
  if (capability.duration) {
    duration = between(body.duration === undefined ? capability.duration.default : body.duration, capability.duration.min, capability.duration.max, 'MiniMax H3 Max duration');
    input.duration = duration;
  }
  if (capability.aspectRatios.length) {
    let ratio = String(body.aspectRatio || (mode === 'reference_to_video' ? 'adaptive' : mode === 'extend_video' ? 'auto' : '16:9'));
    if (mode === 'extend_video' && ratio === 'adaptive') ratio = 'auto';
    if (!capability.aspectRatios.includes(ratio)) throw new Error(`MiniMax H3 Max ${mode} aspect ratio must be ${capability.aspectRatios.join(', ')}`);
    input.aspect_ratio = ratio;
  }
  if (options.seed !== undefined && options.seed !== null) {
    const seed = finiteNumber(options.seed, 'Seed');
    if (!Number.isSafeInteger(seed)) throw new Error('Seed must be a safe integer');
    if (mode === 'lip_sync' && (seed < 0 || seed > 2_147_483_647)) throw new Error('Lip Sync seed must be between 0 and 2147483647');
    if (mode === 'recast' && seed < 0) throw new Error('Recast seed must be non-negative');
    input.seed = seed;
  }
  if (['text_to_video', 'image_to_video', 'reference_to_video'].includes(mode)) {
    const expansion = options.promptExpansionMode ?? body.promptExpansionMode ?? 'balanced';
    if (!['disabled', 'balanced', 'quality'].includes(String(expansion))) throw new Error('Prompt expansion must be disabled, balanced or quality');
    input.prompt_expansion_mode = expansion;
    input.sync_mode = false; // Queue results remain durable downloadable URLs.
  }
  if (targetAudio && audioUrls.length) {
    if (audioUrls.length !== 1) throw new Error('Use exactly one target soundtrack, without reference audio');
    if (duration! < 2) throw new Error('Generation duration must be at least 2 seconds with target audio');
    input.target_audio_url = audioUrls[0];
  }
  if (mode === 'image_to_video') {
    const imageFrame = options.imageFrame ?? 'start';
    if (imageFrame !== 'start' && imageFrame !== 'end') throw new Error('Image frame must be start or end');
    if (imageFrame === 'end') {
      if (imageUrls.length !== 1) throw new Error('End-only keyframe mode requires exactly one image');
      input.end_image_url = imageUrls[0];
    } else { input.image_url = imageUrls[0]; if (imageUrls[1]) input.end_image_url = imageUrls[1]; }
  }
  if (mode === 'reference_to_video') {
    if (imageUrls.length + videoUrls.length + referenceAudioUrls.length > 12) throw new Error('Reference images, videos and audio must add up to at most 12 files');
    if (options.referenceConditions !== undefined) {
      if (imageUrls.length || videoUrls.length || referenceAudioUrls.length) throw new Error('Ordered reference conditions cannot be combined with reference URL arrays');
      if (!Array.isArray(options.referenceConditions) || options.referenceConditions.length > 12) throw new Error('Ordered reference conditions must contain at most 12 files');
      const conditions = options.referenceConditions.map((entry: any) => {
        if (!entry || !['image', 'video', 'audio'].includes(entry.type)) throw new Error('Invalid ordered reference modality');
        return { type: entry.type, url: publicUrl(entry.url, 'Ordered reference URL') };
      });
      for (const [type, max] of [['image', 9], ['video', 3], ['audio', 3]] as const) if (conditions.filter(entry => entry.type === type).length > max) throw new Error(`Too many ordered ${type} references`);
      if (input.target_audio_url && conditions.some(entry => entry.type === 'audio')) throw new Error('A target soundtrack cannot be combined with reference audio');
      input.reference_conditions = conditions;
    } else {
      if (imageUrls.length) input.reference_image_urls = imageUrls;
      if (videoUrls.length) input.reference_video_urls = videoUrls;
      if (referenceAudioUrls.length) input.reference_audio_urls = referenceAudioUrls;
    }
    for (const [key, field] of [['startImageUrl', 'image_url'], ['endImageUrl', 'end_image_url'], ['middleImageUrl', 'middle_image_url']] as const) if (options[key]) input[field] = publicUrl(options[key], key);
    if (options.middleImageUrl || options.middleFrameTime !== undefined) {
      if (!input.image_url || !input.end_image_url || !input.middle_image_url) throw new Error('A middle keyframe requires start, middle and end images');
      if (resolution === '1080P') throw new Error('Middle keyframes require native 480P or 768P resolution');
      const time = finiteNumber(options.middleFrameTime, 'Middle keyframe time');
      if (time <= 0 || time >= duration! || Math.round(time * 24) <= 0 || Math.round(time * 24) >= Math.round(duration! * 24)) throw new Error('Middle keyframe time must fall strictly between the first and last frame');
      input.middle_frame_time = time;
    }
  }
  if (mode === 'extend_video') {
    input.video_url = videoUrls[0]; if (audioUrls.length) input.reference_audio_urls = audioUrls;
    input.enable_prompt_expansion = optionBoolean(options, 'enablePromptExpansion', true);
    const output = options.output ?? 'extended'; if (!['extended', 'continuation'].includes(String(output))) throw new Error('Extend output must be extended or continuation'); input.output = output;
  }
  if (mode === 'insert_video') {
    input.video_url = videoUrls[0]; if (imageUrls.length) input.reference_image_urls = imageUrls;
    if (videoUrls.length > 1) input.reference_video_urls = videoUrls.slice(1);
    if (imageUrls.length + videoUrls.length - 1 > 12) throw new Error('Insert references must add up to at most 12 files');
    const start = between(options.startTime ?? DEFAULT_H3_MAX_OPTIONS.startTime, 1.625, 60, 'Insert start time');
    const resume = between(options.resumeTime ?? DEFAULT_H3_MAX_OPTIONS.resumeTime, 1.625, 60, 'Insert resume time');
    if (resume <= start) throw new Error('Insert resume time must be after the start time');
    input.start_time = start; input.resume_time = resume;
    input.enable_prompt_expansion = optionBoolean(options, 'enablePromptExpansion', true); input.color_match = optionBoolean(options, 'colorMatch', true);
  }
  if (mode === 'lip_sync') { input.image_url = imageUrls[0]; input.audio_url = audioUrls[0]; input.enable_transcription = optionBoolean(options, 'enableTranscription', false); }
  if (mode === 'recast') { input.video_url = videoUrls[0]; input.reference_image_urls = imageUrls; input.enhance_realism = optionBoolean(options, 'enhanceRealism', false); }
  if (mode === 'relight') { input.video_url = videoUrls[0]; input.reference_image_url = imageUrls[0]; input.sync_mode = false; }
  if (body.mediaMetadata !== undefined) {
    if (!body.mediaMetadata || typeof body.mediaMetadata !== 'object' || Array.isArray(body.mediaMetadata)) throw new Error('Media metadata must be an object');
    for (const key of ['images', 'videos', 'audios'] as const) if (body.mediaMetadata[key] !== undefined && (!Array.isArray(body.mediaMetadata[key]) || body.mediaMetadata[key]!.some(item => !item || typeof item !== 'object' || Array.isArray(item)))) throw new Error(`Invalid ${key} metadata`);
    validateH3MaxMediaMetadata(mode, body.mediaMetadata, options as Partial<H3MaxOptions>);
  }
  return { mode, endpoint: H3_MAX_ENDPOINTS[mode], input };
};
