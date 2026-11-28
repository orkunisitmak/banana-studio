import { exceedsCharacterLimit } from './providerTextLimits.ts';
/** EvoLink OpenAPI (not the fal.ai H3 Max queue contracts):
 * https://evolink.ai/docs/en/api-manual/video-series/minimax/minimax-h3/h3-max/minimax-h3-max-text-to-video.md
 * https://evolink.ai/docs/en/api-manual/video-series/minimax/minimax-h3/h3-max/minimax-h3-max-image-to-video.md
 * https://evolink.ai/docs/en/api-manual/video-series/minimax/minimax-h3/h3-max/minimax-h3-max-reference-to-video.md
 * The only other provider option is callback_url. Banana tracks owned task IDs
 * and polls; a browser cannot redirect completion notifications or set safety policy.
 */
export const EVO_H3_MODEL = 'minimax-h3';
const modes = ['text_only', 'image_to_video', 'reference_to_video'] as const;
export type EvoH3Mode = typeof modes[number];
export const EVO_H3_ENDPOINTS = {
  text_only: 'minimax-h3-max-text-to-video',
  image_to_video: 'minimax-h3-max-image-to-video',
  reference_to_video: 'minimax-h3-max-reference-to-video',
} as const satisfies Record<EvoH3Mode, string>;
const textAspectRatios = ['16:9', '21:9', '4:3', '1:1', '3:4', '9:16'] as const;
export const EVO_H3_CAPABILITIES = {
  modes,
  durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  qualities: ['480p', '768p'],
  textAspectRatios,
  referenceAspectRatios: ['adaptive', ...textAspectRatios],
  maxPromptLength: 7000,
  maxImages: 9, maxVideos: 3, maxAudio: 3, maxReferences: 12,
} as const;

export function validateEvoH3MediaCounts(mode: EvoH3Mode, images: number, videos: number, audios: number): void {
  const total = images + videos + audios;
  if (mode === 'text_only' && total) throw new Error('EvoLink H3 Max text mode does not accept media.');
  if (mode === 'image_to_video' && (images < 1 || images > 2 || videos || audios)) {
    throw new Error('EvoLink H3 Max image mode needs a first image and optionally a last image. Video and audio are not supported.');
  }
  if (mode === 'reference_to_video') {
    const { maxImages, maxVideos, maxAudio, maxReferences } = EVO_H3_CAPABILITIES;
    if (!(images || videos)) throw new Error('EvoLink H3 Max reference mode needs at least one image or video.');
    if (images > maxImages || videos > maxVideos || audios > maxAudio || total > maxReferences) {
      throw new Error(`EvoLink H3 Max accepts up to ${maxImages} reference images, ${maxVideos} videos and ${maxAudio} audio clips (${maxReferences} total).`);
    }
  }
}

const commonKeys = ['videoModel', 'generationId', 'mode', 'prompt', 'duration', 'quality'];
const allowedKeys: Record<EvoH3Mode, readonly string[]> = {
  text_only: [...commonKeys, 'aspectRatio'],
  image_to_video: [...commonKeys, 'imageUrls'],
  reference_to_video: [...commonKeys, 'aspectRatio', 'imageUrls', 'videoUrls', 'audioUrls'],
};
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T => choices.some(choice => choice === value);
const noMedia: string[] = [];
const isMediaUrl = (value: unknown): boolean => {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
};
const mediaUrls = (value: unknown, field: string): string[] => {
  if (value === undefined) return noMedia;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of HTTPS media URLs.`);
  for (const url of value) {
    if (!isMediaUrl(url)) throw new Error(`${field} must contain HTTPS media URLs without credentials.`);
  }
  return value;
};

export type EvoH3MaxInput = {
  model: typeof EVO_H3_ENDPOINTS[EvoH3Mode];
  prompt: string;
  duration: number;
  quality: typeof EVO_H3_CAPABILITIES.qualities[number];
  aspect_ratio?: typeof EVO_H3_CAPABILITIES.referenceAspectRatios[number];
  image_start?: string;
  image_end?: string;
  image_urls?: string[];
  video_urls?: string[];
  audio_urls?: string[];
};

export function buildEvoH3MaxInput(body: unknown): EvoH3MaxInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('An EvoLink H3 Max request is required.');
  const request = body as Record<string, unknown>;
  if (request.videoModel !== EVO_H3_MODEL) throw new Error('Invalid EvoLink H3 Max model.');
  const { mode, duration = 5, quality = '768p' } = request;
  if (!oneOf(mode, modes)) throw new Error('Unsupported EvoLink H3 Max mode.');
  for (const key of Object.keys(request)) {
    if (!allowedKeys[mode].includes(key)) throw new Error(`EvoLink H3 Max ${mode} does not accept ${key}.`);
  }
  if (request.generationId !== undefined && (typeof request.generationId !== 'string' || !request.generationId.trim())) {
    throw new Error('generationId must be a non-empty string.');
  }
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
  if (!prompt || exceedsCharacterLimit(prompt, EVO_H3_CAPABILITIES.maxPromptLength)) throw new Error('EvoLink H3 Max needs a prompt of 1–7000 characters.');
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 5 || duration > 15) throw new Error('EvoLink H3 Max duration must be an integer from 5 to 15 seconds.');
  if (!oneOf(quality, EVO_H3_CAPABILITIES.qualities)) throw new Error('EvoLink H3 Max quality must be 480p or 768p.');
  const images = mediaUrls(request.imageUrls, 'imageUrls');
  const videos = mediaUrls(request.videoUrls, 'videoUrls');
  const audios = mediaUrls(request.audioUrls, 'audioUrls');
  validateEvoH3MediaCounts(mode, images.length, videos.length, audios.length);

  const input: EvoH3MaxInput = { model: EVO_H3_ENDPOINTS[mode], prompt, duration, quality };
  if (mode === 'image_to_video') {
    input.image_start = images[0];
    if (images.length === 2) input.image_end = images[1];
  } else {
    const ratios = mode === 'text_only' ? textAspectRatios : EVO_H3_CAPABILITIES.referenceAspectRatios;
    const { aspectRatio = ratios[0] } = request;
    if (!oneOf(aspectRatio, ratios)) throw new Error(`EvoLink H3 Max ${mode} aspect ratio must be ${ratios.join(', ')}.`);
    input.aspect_ratio = aspectRatio;
    if (images.length) input.image_urls = images;
    if (videos.length) input.video_urls = videos;
    if (audios.length) input.audio_urls = audios;
  }
  return input;
}
