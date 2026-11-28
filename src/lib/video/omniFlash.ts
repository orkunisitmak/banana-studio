/**
 * Gemini Omni 1.2 Flash on fal. Contracts verified 2026-11-27 against:
 * https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/gemini-omni-flash/v1.2/<route>
 * https://fal.ai/models/google/gemini-omni-flash/v1.2/text-to-video (and image-to-video,
 * reference-to-video, edit, extend, upscale)
 * Google announcement: https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemini-omni-1-2-flash/
 */
import type { GenerationConfig, ReferenceImage, ReferenceVideo, VideoCost, VideoOperation, VideoQuality } from '../../types.js';
import { mapUnquotedPrompt, resolveStableImageReferences } from '../references/referenceTokens.ts';
import { exceedsCharacterLimit } from './providerTextLimits.ts';

export const OMNI_MODEL = 'gemini-omni-1.2-flash' as const;
export const OMNI_LABEL = 'Gemini Omni 1.2 Flash';
/** fal serves status/result for every route from the parent queue app. */
export const OMNI_QUEUE_APP = 'google/gemini-omni-flash';

export type OmniMode = 'text_to_video' | 'image_to_video' | 'reference_to_video' | 'edit' | 'extend' | 'upscale';
export const OMNI_ENDPOINTS: Record<OmniMode, string> = {
  text_to_video: 'google/gemini-omni-flash/v1.2/text-to-video',
  image_to_video: 'google/gemini-omni-flash/v1.2/image-to-video',
  reference_to_video: 'google/gemini-omni-flash/v1.2/reference-to-video',
  edit: 'google/gemini-omni-flash/v1.2/edit',
  extend: 'google/gemini-omni-flash/v1.2/extend',
  upscale: 'google/gemini-omni-flash/v1.2/upscale',
};
export const OMNI_MODE_LABELS: Record<OmniMode, string> = {
  text_to_video: 'Text to video', image_to_video: 'Image to video', reference_to_video: 'Reference to video',
  edit: 'Video edit', extend: 'Extend', upscale: 'Upscale',
};

/** Omni uses the shared Action menu; Generate picks text/image/reference input by attachments. */
export const OMNI_OPERATIONS: { label: string; value: VideoOperation }[] = [
  { label: 'Generate', value: 'generate' },
  { label: 'Edit', value: 'edit' },
  { label: 'Extend', value: 'extend' },
  { label: 'Upscale', value: 'upscale' },
];
export const OMNI_ASPECT_RATIOS = ['16:9', '9:16'] as const;
export const OMNI_QUALITIES: VideoQuality[] = ['360p', '720p', '1080p', '4K'];
/** Upscale targets must be higher than the source; fal offers no 360p target. */
export const OMNI_UPSCALE_QUALITIES: VideoQuality[] = ['720p', '1080p', '4K'];
export const OMNI_DURATION = { min: 3, max: 15, endFrameMax: 10, extendMin: 3, extendMax: 10, default: 8 } as const;
export const OMNI_LIMITS = { referenceImages: 10, referenceVideos: 3, sourceVideoSeconds: 15, prompt: 20000 } as const;

// fal per-second output pricing, audio included for text/image/reference video.
// Edit bills each second of edited output; extend bills only new seconds.
export const OMNI_PRICE_PER_SECOND: Record<'360p' | '720p' | '1080p' | '4K', number> = {
  '360p': 0.0273, '720p': 0.0819, '1080p': 0.1229, '4K': 0.2457,
};
// https://fal.ai/models/google/gemini-omni-flash/v1.2/upscale: "360p to 720p or
// 720p to 1080p costs about $0.041 per second; 360p to 1080p costs $0.0819 per
// second; and 720p or 1080p to 4K costs $0.1638 per second." Other pairs are unpublished.
export const OMNI_UPSCALE_PRICE_PER_SECOND: Record<string, number> = {
  '360p>720p': 0.041, '720p>1080p': 0.041, '360p>1080p': 0.0819, '720p>4K': 0.1638, '1080p>4K': 0.1638,
};

type OmniConfig = Pick<GenerationConfig, 'videoOperation' | 'videoQuality' | 'videoDuration' | 'videoAspectRatio' | 'referenceImages' | 'referenceVideos'>
  & Partial<Pick<GenerationConfig, 'referenceAudios' | 'prompt'>>;

export const isOmniQuality = (quality: unknown): quality is '360p' | '720p' | '1080p' | '4K' => OMNI_QUALITIES.includes(quality as VideoQuality);
export const toOmniResolution = (quality: VideoQuality): '360p' | '720p' | '1080p' | '4k' => quality === '4K' ? '4k' : quality as '360p' | '720p' | '1080p';

export const getOmniFrames = (images: ReferenceImage[]) => ({
  start: images.find(image => image.isFirstFrame), end: images.find(image => image.isLastFrame),
});

/** Generate is text, start/end-frame or reference input, chosen only by attachments. */
export const getOmniMode = (config: Pick<OmniConfig, 'videoOperation' | 'referenceImages' | 'referenceVideos'>): OmniMode => {
  const operation = config.videoOperation || 'generate';
  if (operation === 'edit' || operation === 'extend' || operation === 'upscale') return operation;
  const images = config.referenceImages || [];
  if (getOmniFrames(images).start) return 'image_to_video';
  return images.length || config.referenceVideos?.length ? 'reference_to_video' : 'text_to_video';
};

export const getOmniDurationOptions = (mode: OmniMode, hasEndFrame = false): number[] => {
  if (mode === 'edit' || mode === 'upscale') return [];
  const [min, max] = mode === 'extend' ? [OMNI_DURATION.extendMin, OMNI_DURATION.extendMax]
    : [OMNI_DURATION.min, mode === 'image_to_video' && hasEndFrame ? OMNI_DURATION.endFrameMax : OMNI_DURATION.max];
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
};

/** Keep a valid length, clamp others into range, and use -1 (source) for Edit and Upscale. */
export const normalizeOmniDuration = (mode: OmniMode, hasEndFrame: boolean, current: number): number => {
  const options = getOmniDurationOptions(mode, hasEndFrame);
  if (!options.length) return -1;
  const value = Number.isFinite(current) && current > 0 ? Math.round(current) : OMNI_DURATION.default;
  return Math.max(options[0], Math.min(options.at(-1)!, value));
};

const sourceTier = (video?: ReferenceVideo): '360p' | '720p' | '1080p' | undefined => {
  const edge = video?.width && video?.height ? Math.min(video.width, video.height) : undefined;
  if (!edge) return undefined;
  return edge === 360 ? '360p' : edge === 720 ? '720p' : edge === 1080 ? '1080p' : undefined;
};

/** Browser-side validation before upload or billing; the server repeats the schema checks. */
export const getOmniConfigError = (config: OmniConfig): string | null => {
  const mode = getOmniMode(config);
  const images = config.referenceImages || [], videos = config.referenceVideos || [];
  if (config.referenceAudios?.length) return 'Omni 1.2 Flash does not accept separate audio files. Remove the audio; Omni generates its own sound.';
  const qualities = mode === 'upscale' ? OMNI_UPSCALE_QUALITIES : OMNI_QUALITIES;
  if (!qualities.includes(config.videoQuality)) return `Choose ${qualities.join(', ')} for Omni ${OMNI_MODE_LABELS[mode]}.`;
  if (mode === 'text_to_video' || mode === 'image_to_video' || mode === 'reference_to_video') {
    if (!OMNI_ASPECT_RATIOS.includes(config.videoAspectRatio as typeof OMNI_ASPECT_RATIOS[number])) return 'Omni 1.2 Flash supports 16:9 and 9:16.';
    if (!getOmniDurationOptions(mode, !!getOmniFrames(images).end).includes(Number(config.videoDuration))) {
      return mode === 'image_to_video' && getOmniFrames(images).end ? 'With an end frame, choose 3–10 seconds.' : 'Choose 3–15 seconds.';
    }
  }
  if (mode === 'image_to_video') {
    if (videos.length) return 'Image to video uses a start image and optional end image only. Remove the videos or clear the frame roles.';
    if (images.some(image => !image.isFirstFrame && !image.isLastFrame)) return 'With a start frame, every image must be the start or end frame. Clear the frame roles to use images as references.';
  }
  if (mode === 'reference_to_video') {
    if (images.length > OMNI_LIMITS.referenceImages) return `Use up to ${OMNI_LIMITS.referenceImages} reference images.`;
    if (videos.length > OMNI_LIMITS.referenceVideos) return `Use up to ${OMNI_LIMITS.referenceVideos} reference videos.`;
    if (videos.some(video => (video.duration || 0) > OMNI_LIMITS.sourceVideoSeconds)) return 'Each reference video must be 15 seconds or shorter.';
    if (images.some(image => image.isLastFrame)) return 'Add a start frame for the end frame, or clear the frame roles.';
  }
  if (mode === 'edit' || mode === 'extend' || mode === 'upscale') {
    if (videos.length !== 1) return `${OMNI_MODE_LABELS[mode]} needs exactly one source video.`;
    if (images.length) return `${OMNI_MODE_LABELS[mode]} uses only the source video. Remove the images.`;
    if (mode !== 'extend' && (videos[0].duration || 0) > OMNI_LIMITS.sourceVideoSeconds) return `${OMNI_MODE_LABELS[mode]} accepts a source video up to 15 seconds.`;
    if (mode === 'extend' && !getOmniDurationOptions('extend').includes(Number(config.videoDuration))) return 'Extend adds 3–10 seconds.';
    if (mode === 'upscale') {
      const { width, height } = videos[0];
      const target = config.videoQuality === '4K' ? 2160 : parseInt(config.videoQuality, 10);
      if (width && height && target <= Math.min(width, height)) return 'Choose an upscale resolution higher than the source video.';
    }
  }
  if (mode !== 'upscale' && !config.prompt?.trim()) return 'Enter a prompt for Omni 1.2 Flash.';
  if (mode !== 'upscale' && exceedsCharacterLimit(config.prompt || '', OMNI_LIMITS.prompt)) return 'Prompt must not exceed 20,000 characters.';
  return null;
};

/** Published video component, not an all-inclusive quote: non-upscale routes
 * also bill tokens not known until execution. Unpublished upscale pairs have no estimate. */
export const estimateOmniCost = (config: OmniConfig): VideoCost | null => {
  const mode = getOmniMode(config);
  const source = config.referenceVideos?.[0];
  const sourceSeconds = source?.duration && source.duration > 0 ? source.duration : undefined;
  if (mode === 'upscale') {
    const from = sourceTier(source);
    const rate = from ? OMNI_UPSCALE_PRICE_PER_SECOND[`${from}>${config.videoQuality}`] : undefined;
    return rate != null && sourceSeconds ? { usd: rate * sourceSeconds, source: 'published_estimate' } : null;
  }
  if (!isOmniQuality(config.videoQuality)) return null;
  const rate = OMNI_PRICE_PER_SECOND[config.videoQuality];
  // Edit bills the edited output; its length follows the source clip.
  const seconds = mode === 'edit' ? sourceSeconds : Number(config.videoDuration);
  return seconds && seconds > 0 ? { usd: rate * seconds, source: 'published_estimate' } : null;
};

/** Omni reference prompts address inputs in list order as <IMAGE_REF_n> and
 * <VIDEO_REF_n> (fal reference-to-video example). Other routes get plain roles. */
export const normalizeOmniPrompt = (prompt: string, mode: OmniMode, images: ReferenceImage[]): string => {
  const image = (raw: string) => {
    const index = Number(raw) - 1;
    if (mode === 'reference_to_video') return `<IMAGE_REF_${index}>`;
    if (mode === 'image_to_video') return images[index]?.isLastFrame ? 'the end image' : 'the start image';
    return 'the image';
  };
  const video = (raw: string) => mode === 'reference_to_video' ? `<VIDEO_REF_${Math.max(0, Number(raw || 1) - 1)}>` : 'the source video';
  const person = (id: number) => {
    const refs = images.flatMap((ref, index) => (ref.personId ?? (ref.isSubjectImage ? 1 : ref.isSecondPerson ? 2 : undefined)) === id ? [index] : []);
    if (!refs.length) return id === 1 ? 'the main person' : `person ${id}`;
    return mode === 'reference_to_video' ? `the person shown in ${refs.map(index => `<IMAGE_REF_${index}>`).join(' and ')}` : 'the person in the image';
  };
  return mapUnquotedPrompt(prompt.trim(), text => text.replace(/\\_/g, '_')
    .replace(/@REFERENCE\[[^\]\n]*\]|@MISSING_IMAGE_\d+\b/gi, token => image(resolveStableImageReferences(token, images).slice('image '.length)))
    .replace(/[@#](?:REF[_ ]?)?IMAGE[_ ]?(\d+)\b/gi, (_match, number) => image(number))
    .replace(/@FIRST[_ ]?FRAME/gi, 'the start image').replace(/@LAST[_ ]?FRAME/gi, 'the end image')
    .replace(/@VIDEO(?:[_ ]?(\d+))?\b/gi, (_match, number) => video(number))
    .replace(/@MAIN[_ ]?PERSON|@ME\b/gi, () => person(1)).replace(/@SECOND[_ ]?PERSON/gi, () => person(2))
    .replace(/@PERSON_(\d+)\b/gi, (_match, number) => person(Number(number)))
    .replace(/[ \t]+/g, ' '));
};

export type OmniRequestBody = {
  mode: OmniMode; prompt?: string; resolution?: string; aspectRatio?: string; duration?: number;
  imageUrls?: string[]; endImageUrl?: string; videoUrls?: string[];
};

const httpsUrl = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length > 4000) throw new Error(`${label} must be an HTTPS URL.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an HTTPS URL.`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label} must be an HTTPS URL.`);
  return value;
};
const urlList = (value: unknown, label: string, max: number): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`Use up to ${max} ${label}.`);
  return value.map((item, index) => httpsUrl(item, `${label} ${index + 1}`));
};

/** Server admission: map a whitelisted request onto the exact fal schema. */
export const buildOmniInput = (body: OmniRequestBody): { endpoint: string; mode: OmniMode; input: Record<string, unknown> } => {
  if (!body || typeof body !== 'object') throw new Error('Invalid Omni request.');
  const mode = body.mode;
  if (!Object.prototype.hasOwnProperty.call(OMNI_ENDPOINTS, mode)) throw new Error('Unsupported Omni action.');
  const resolution = typeof body.resolution === 'string' ? body.resolution.toLowerCase() : '';
  const resolutions = mode === 'upscale' ? ['720p', '1080p', '4k'] : ['360p', '720p', '1080p', '4k'];
  if (!resolutions.includes(resolution)) throw new Error(`Choose ${resolutions.join(', ')}.`);
  const input: Record<string, unknown> = { resolution };
  if (mode !== 'upscale') {
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || exceedsCharacterLimit(body.prompt, OMNI_LIMITS.prompt)) throw new Error('Prompt must contain 1–20,000 characters.');
    input.prompt = body.prompt;
  }
  const integerDuration = (min: number, max: number) => {
    if (!Number.isInteger(body.duration) || body.duration! < min || body.duration! > max) throw new Error(`Duration must be ${min}–${max} seconds.`);
    return body.duration;
  };
  if (mode === 'text_to_video' || mode === 'image_to_video' || mode === 'reference_to_video') {
    if (!OMNI_ASPECT_RATIOS.includes(body.aspectRatio as typeof OMNI_ASPECT_RATIOS[number])) throw new Error('Aspect ratio must be 16:9 or 9:16.');
    input.aspect_ratio = body.aspectRatio;
  }
  if (mode === 'text_to_video') {
    input.duration = integerDuration(OMNI_DURATION.min, OMNI_DURATION.max);
    if (body.imageUrls?.length || body.videoUrls?.length || body.endImageUrl) throw new Error('Text to video does not take media.');
  } else if (mode === 'image_to_video') {
    const [start] = urlList(body.imageUrls, 'start images', 1);
    if (!start) throw new Error('Image to video needs a start image.');
    input.image_url = start;
    if (body.endImageUrl != null) input.end_image_url = httpsUrl(body.endImageUrl, 'End image');
    input.duration = integerDuration(OMNI_DURATION.min, body.endImageUrl != null ? OMNI_DURATION.endFrameMax : OMNI_DURATION.max);
    if (body.videoUrls?.length) throw new Error('Image to video does not take videos.');
  } else if (mode === 'reference_to_video') {
    if (body.endImageUrl != null) throw new Error('Reference to video does not take an end frame.');
    const images = urlList(body.imageUrls, 'reference images', OMNI_LIMITS.referenceImages);
    const videos = urlList(body.videoUrls, 'reference videos', OMNI_LIMITS.referenceVideos);
    if (!images.length && !videos.length) throw new Error('Reference to video needs an image or video.');
    if (images.length) input.image_urls = images;
    if (videos.length) input.reference_video_urls = videos;
    input.duration = integerDuration(OMNI_DURATION.min, OMNI_DURATION.max);
  } else {
    const [video] = urlList(body.videoUrls, 'source videos', 1);
    if (!video || body.imageUrls?.length || body.endImageUrl) throw new Error(`${OMNI_MODE_LABELS[mode]} needs exactly one source video.`);
    input.video_url = video;
    if (mode === 'extend') input.duration = integerDuration(OMNI_DURATION.extendMin, OMNI_DURATION.extendMax);
  }
  return { endpoint: OMNI_ENDPOINTS[mode], mode, input };
};
