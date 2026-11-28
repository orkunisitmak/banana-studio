import { exceedsCharacterLimit } from './providerTextLimits.ts';
import type { GenerationConfig, ReferenceImage } from '../../types.js';
import { MAGI2_LIMITS, getMagi2AspectRatios, isMagi2PublicUrl, validateMagi2Durations, validateMagi2MediaCounts, type Magi2Mode } from './magi2.ts';
import { getSeedanceFrameError } from './seedanceFrames.ts';
import { EVO_H3_CLIP_MIME, normalizeEvoH3Prompt } from './evoH3MaxConfig.ts';
import { getStableImageTag, mapUnquotedPrompt } from '../references/referenceTokens.ts';

// Both EvoLink models accept native MP4/MOV and WAV/MP3 references, without transcoding.
export const MAGI2_CLIP_MIME = EVO_H3_CLIP_MIME;
const attachmentLimits = {
  text_only: { images: 0, videos: 0, audios: 0 },
  image_to_video: { images: 2, videos: 0, audios: 0 },
  reference_to_video: { images: MAGI2_LIMITS.maxImages, videos: MAGI2_LIMITS.maxVideos, audios: MAGI2_LIMITS.maxAudios },
} as const;
export const getMagi2Limits = (mode: Magi2Mode = 'text_only') =>
  mode === 'image_to_video' || mode === 'reference_to_video' ? attachmentLimits[mode] : attachmentLimits.text_only;

/** Gallery order is editor order; only the request array moves a tagged start ahead of its end. */
export function getMagi2Images(config: Pick<GenerationConfig, 'magi2Mode' | 'referenceImages'>): ReferenceImage[] {
  const images = config.referenceImages;
  return config.magi2Mode === 'image_to_video' && images.length === 2 && images[1].isFirstFrame
    ? [images[1], images[0]] : images;
}

export function getMagi2Prompt(config: Pick<GenerationConfig, 'magi2Mode' | 'prompt' | 'referenceImages' | 'referenceVideos' | 'referenceAudios'>): string {
  const mode = config.magi2Mode ?? 'text_only';
  const ordered = getMagi2Images(config);
  // Resolve positional aliases in their original editor order before translating them to frame roles.
  const prompt = ordered === config.referenceImages ? config.prompt : mapUnquotedPrompt(config.prompt, text => text
    .replace(/\\_/g, '_').replace(/[@#](?:REF[_ ]?)?IMAGE[_ ]?(\d+)\b/gi, (tag, n) => {
      const image = config.referenceImages[Number(n) - 1];
      return image ? getStableImageTag(image.id) : tag;
    }));
  return normalizeEvoH3Prompt(prompt, mode === 'text_only' ? 'text_to_video' : mode, { ...config, referenceImages: ordered });
}

// Only the desktop sidecar may resolve a local object into a provider upload.
export function isWorkspaceMediaUrl(value: string): boolean {
  if (typeof window === 'undefined' || window.__BANANA_STUDIO_CONFIG__?.mode !== 'local') return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.origin === window.location.origin
      && /^\/storage\/v1\/object\/(?:authenticated|sign|public)\/media\/[^/]/.test(url.pathname);
  } catch { return false; }
}

const hasScheme = /^[a-z][a-z\d+.-]*:/i;

/** Pure preflight: use available metadata now; the service measures missing durations before admission. */
export function getMagi2Error(config: GenerationConfig): string | null {
  const mode = config.magi2Mode ?? 'text_only';
  if (mode !== 'text_only' && mode !== 'image_to_video' && mode !== 'reference_to_video') return 'Choose Text, Image, or Reference to Video for MAGI-2.';
  const { referenceImages: images, referenceVideos: videos = [], referenceAudios: audios = [] } = config;
  try {
    validateMagi2MediaCounts(mode, images.length, videos.length, audios.length);
    const prompt = getMagi2Prompt(config);
    if (!prompt || exceedsCharacterLimit(prompt, MAGI2_LIMITS.maxPromptLength)) return 'Enter a prompt of 1–15,000 characters.';
  } catch (error) { return (error as Error).message; }
  if (config.videoOperation && config.videoOperation !== 'generate') return 'MAGI-2 supports generation only.';
  if (videos.some(video => video.isContinuation)) return 'Clear continuation roles before generating with MAGI-2.';
  if (mode === 'image_to_video') {
    const error = getSeedanceFrameError(images);
    if (error) return error;
  } else if (images.some(image => image.isFirstFrame || image.isLastFrame)) return 'Frame roles require MAGI-2 Image to Video.';
  const duration = config.videoDuration ?? 5;
  if (!Number.isInteger(duration) || duration < MAGI2_LIMITS.minDuration || duration > MAGI2_LIMITS.maxDuration) return 'Choose a whole output duration from 4 to 30 seconds.';
  if (config.videoQuality !== undefined && config.videoQuality !== '1080p') return 'MAGI-2 supports 1080p only.';
  if (config.videoAspectRatio !== undefined && !getMagi2AspectRatios(mode).some(r => r === config.videoAspectRatio)) return 'Choose a supported MAGI-2 aspect ratio for this mode.';
  if (config.audioEnabled !== undefined && typeof config.audioEnabled !== 'boolean') return 'Choose whether to generate synchronized audio.';
  for (const [i, image] of images.entries()) {
    const value = image.data;
    if (!value) return `Restore Image ${i + 1} before generating.`;
    if (!/^image\/[\w.+-]+$/i.test(image.mimeType)) return `Image ${i + 1} must be an image file.`;
    if (/^blob:/i.test(value)) continue; // Blob size and MIME are inspected at preparation time.
    if (hasScheme.test(value) && !/^data:/i.test(value)) {
      if (!isMagi2PublicUrl(value) && !isWorkspaceMediaUrl(value)) return `Image ${i + 1} must use a public HTTPS URL.`;
      continue;
    }
    const header = /^data:/i.test(value) ? /^data:(image\/[\w.+-]+);base64,/i.exec(value) : null;
    if (/^data:/i.test(value) && !header) return `Image ${i + 1} is not an encoded image.`;
    const encodedLength = value.length - (header?.[0].length ?? 0);
    const size = Math.floor(encodedLength * 3 / 4) - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
    if (size <= 0 || size >= MAGI2_LIMITS.imageMaxMB * 1024 * 1024) return `Image ${i + 1} must be nonempty and under ${MAGI2_LIMITS.imageMaxMB} MB.`;
  }
  for (const [kind, refs, maxMB] of [['video', videos, MAGI2_LIMITS.videoMaxMB], ['audio', audios, MAGI2_LIMITS.audioMaxMB]] as const) {
    const knownDurations: number[] = [];
    for (const [i, ref] of refs.entries()) {
      const label = `${kind} ${i + 1}`;
      if (!ref.url || (!/^(blob:|data:)/i.test(ref.url) && !isMagi2PublicUrl(ref.url) && !isWorkspaceMediaUrl(ref.url))) return `Attach a file or use a public HTTPS URL for ${label}.`;
      if (typeof ref.mimeType !== 'string' || !MAGI2_CLIP_MIME[kind].test(ref.mimeType.split(';')[0].trim())) return `${label} must be ${kind === 'video' ? 'MP4 or MOV' : 'WAV or MP3'}.`;
      if (ref.size != null && (!Number.isFinite(ref.size) || ref.size <= 0 || ref.size > maxMB * 1024 * 1024)) return `${label} must be nonempty and at most ${maxMB} MB.`;
      if (ref.duration != null) knownDurations.push(ref.duration);
    }
    try { validateMagi2Durations(kind, knownDurations, knownDurations.length); }
    catch (error) { return (error as Error).message; }
  }
  return null;
}
