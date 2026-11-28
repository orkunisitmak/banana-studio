import { exceedsCharacterLimit } from './providerTextLimits.ts';
/** Sand.ai MAGI-2 through EvoLink's /v1/videos/generations endpoint. */
export const MAGI2_MODEL = 'magi-2';
export const MAGI2_ENDPOINTS = {
  text_only: 'magi-2-text-to-video',
  image_to_video: 'magi-2-image-to-video',
  reference_to_video: 'magi-2-reference-to-video',
} as const;
export type Magi2Mode = keyof typeof MAGI2_ENDPOINTS;
export const MAGI2_LIMITS = {
  minDuration: 4, maxDuration: 30, maxPromptLength: 15000,
  maxImages: 10, maxVideos: 5, maxAudios: 5,
  imageMaxMB: 30, videoMaxMB: 200, audioMaxMB: 15,
} as const;
const fixedRatios = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
const imageRatios = ['adaptive', ...fixedRatios] as const;
const textRatios = [...fixedRatios, '21:9'] as const;
export type Magi2AspectRatio = typeof imageRatios[number] | typeof textRatios[number];
export function getMagi2AspectRatios(mode: Magi2Mode): readonly Magi2AspectRatio[] {
  return mode === 'image_to_video' ? imageRatios : textRatios;
}

/** Local syntactic check. EvoLink is the fetcher and must validate DNS, redirects and media bytes. */
export function isMagi2PublicUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !/^https:\/\/[^/\\]/i.test(value) || /[\s\\]/.test(value)) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password) return false;
  // URL normalizes alternate IPv4 encodings and compresses IPv6 literals.
  const host = url.hostname.replace(/\.$/, '');
  if (host.startsWith('[')) {
    // Global unicast only; exclude documentation and tunneling prefixes as well.
    return /^\[[23][\da-f]{3}:/.test(host) && !/^\[(?:2001:(?::|db8:)|2002:|3fff:)/.test(host);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b, c] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  return host.length <= 253 && host.includes('.') && host.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))
    && !/(?:^|\.)(?:localhost|local|internal|lan|home\.arpa)$/.test(host);
}

export function validateMagi2MediaCounts(mode: Magi2Mode, images: number, videos: number, audios: number): void {
  if (mode === 'text_only' && (images || videos || audios)) throw new Error('MAGI-2 text mode does not accept media.');
  if (mode === 'image_to_video' && (images < 1 || images > 2 || videos || audios)) {
    throw new Error('MAGI-2 image mode needs a first image and optionally a last image; video and audio references are not accepted.');
  }
  if (mode === 'reference_to_video') {
    if (!(images || videos || audios)) throw new Error('MAGI-2 reference mode requires at least one image, video or audio reference.');
    const { maxImages, maxVideos, maxAudios } = MAGI2_LIMITS;
    if (images > maxImages || videos > maxVideos || audios > maxAudios) throw new Error(`MAGI-2 accepts up to ${maxImages} images, ${maxVideos} videos and ${maxAudios} audio clips.`);
  }
}

/** The app measures each clip before submission. These hints never go in the provider payload. */
export function validateMagi2Durations(kind: 'video' | 'audio', durations: unknown, count: number): void {
  if (durations === undefined && !count) return;
  if (!Array.isArray(durations) || durations.length !== count) throw new Error(`Provide one duration for each MAGI-2 ${kind} reference.`);
  let total = 0;
  for (const seconds of durations) {
    if (!Number.isFinite(seconds) || seconds < 2 || seconds > 30) throw new Error(`MAGI-2 ${kind} references must each be 2–30 seconds.`);
    total += seconds;
  }
  if (total > 30) throw new Error(`MAGI-2 ${kind} references must total at most 30 seconds.`);
}

const commonKeys = ['videoModel', 'generationId', 'mode', 'prompt', 'duration', 'quality', 'aspectRatio', 'generateAudio'];
const allowedKeys: Record<Magi2Mode, readonly string[]> = {
  text_only: commonKeys,
  image_to_video: [...commonKeys, 'imageUrls'],
  reference_to_video: [...commonKeys, 'imageUrls', 'videoUrls', 'audioUrls', 'videoDurations', 'audioDurations'],
};
const mediaUrls = (urls: unknown, field: string): string[] | undefined => {
  if (urls === undefined) return;
  if (!Array.isArray(urls) || !urls.every(isMagi2PublicUrl)) throw new Error(`${field} must be an array of public HTTPS URLs without credentials.`);
  return urls;
};
export type Magi2Input = {
  model: typeof MAGI2_ENDPOINTS[Magi2Mode]; prompt: string; duration: number; quality: '1080p';
  aspect_ratio: Exclude<Magi2AspectRatio, 'adaptive'> | 'auto'; generate_audio: boolean;
  image_urls?: string[]; video_urls?: string[]; audio_urls?: string[];
};

export function buildMagi2Input(body: unknown): Magi2Input {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('A MAGI-2 request is required.');
  const request = body as Record<string, unknown>;
  if (request.videoModel !== MAGI2_MODEL) throw new Error('Invalid MAGI-2 model.');
  const { mode = 'text_only', duration = 5, quality = '1080p', generateAudio = true } = request;
  if (mode !== 'text_only' && mode !== 'image_to_video' && mode !== 'reference_to_video') throw new Error('Unsupported MAGI-2 mode.');
  for (const key of Object.keys(request)) {
    if (!allowedKeys[mode].includes(key)) throw new Error(`MAGI-2 ${mode} does not accept ${key}.`);
  }
  if (request.generationId !== undefined && (typeof request.generationId !== 'string' || !request.generationId.trim())) throw new Error('generationId must be a non-empty string.');
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
  if (!prompt) throw new Error('MAGI-2 requires a nonblank prompt.');
  if (exceedsCharacterLimit(prompt, MAGI2_LIMITS.maxPromptLength)) throw new Error('MAGI-2 prompts must not exceed 15,000 characters.');
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < MAGI2_LIMITS.minDuration || duration > MAGI2_LIMITS.maxDuration) throw new Error('MAGI-2 duration must be a whole number from 4 to 30 seconds.');
  if (quality !== '1080p') throw new Error('MAGI-2 quality must be 1080p.');
  if (typeof generateAudio !== 'boolean') throw new Error('generateAudio must be a boolean.');
  const ratios = getMagi2AspectRatios(mode);
  const { aspectRatio = ratios[0] } = request;
  const ratio = ratios.find(item => item === aspectRatio);
  if (!ratio) throw new Error(`MAGI-2 ${mode} aspect ratio must be ${ratios.join(', ')}.`);

  const images = mediaUrls(request.imageUrls, 'imageUrls'), videos = mediaUrls(request.videoUrls, 'videoUrls'), audios = mediaUrls(request.audioUrls, 'audioUrls');
  validateMagi2MediaCounts(mode, images?.length ?? 0, videos?.length ?? 0, audios?.length ?? 0);
  validateMagi2Durations('video', request.videoDurations, videos?.length ?? 0);
  validateMagi2Durations('audio', request.audioDurations, audios?.length ?? 0);
  const input: Magi2Input = { model: MAGI2_ENDPOINTS[mode], prompt, duration, quality, aspect_ratio: ratio === 'adaptive' ? 'auto' : ratio, generate_audio: generateAudio };
  if (images?.length) input.image_urls = images;
  if (videos?.length) input.video_urls = videos;
  if (audios?.length) input.audio_urls = audios;
  return input;
}
