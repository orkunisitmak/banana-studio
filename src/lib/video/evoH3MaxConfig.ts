import { exceedsCharacterLimit } from './providerTextLimits.ts';
import { getPersonId } from '../references/personReferences.ts';
import { mapUnquotedPrompt, resolveStableImageReferences } from '../references/referenceTokens.ts';
import type { GenerationConfig } from '../../types.js';
import { EVO_H3_CAPABILITIES, validateEvoH3MediaCounts, type EvoH3Mode } from './evoH3Max.ts';

export type EvoH3DraftMode = 'text_to_video' | 'image_to_video' | 'reference_to_video';
export const EVO_H3_CLIP_MIME = { video: /^video\/(?:mp4|quicktime|mov)$/i, audio: /^audio\/(?:mpeg|mp3|wav|wave|x-wav|vnd\.wave)$/i };

export function getEvoH3DraftMode(config: Pick<GenerationConfig, 'h3MaxMode'>): EvoH3DraftMode {
  const mode = config.h3MaxMode ?? 'text_to_video';
  if (mode === 'text_to_video' || mode === 'image_to_video' || mode === 'reference_to_video') return mode;
  throw new Error('Choose Text, Image, or Reference to Video for H3 Max on EvoLink.');
}

export const toEvoH3Mode = (mode: EvoH3DraftMode): EvoH3Mode => mode === 'text_to_video' ? 'text_only' : mode;

const invalidDimensions = ({width, height}: {width?: number; height?: number}) =>
  [width, height].some(n => n != null && (!Number.isInteger(n) || n < 256 || n > 5760))
  || (width != null && height != null && (width / height < 0.4 || width / height > 2.5));

/** Validate known attachment metadata without fetching, signing, or uploading during render. */
export function getEvoH3MaxError(config: GenerationConfig): string | undefined {
  const { referenceImages: images, referenceVideos: videos = [], referenceAudios: audios = [] } = config;
  let mode: EvoH3DraftMode;
  try {
    mode = getEvoH3DraftMode(config);
    validateEvoH3MediaCounts(toEvoH3Mode(mode), images.length, videos.length, audios.length);
  } catch (error) { return (error as Error).message; }
  if (config.videoOperation && config.videoOperation !== 'generate') return 'EvoLink H3 Max supports generation only.';
  if (config.h3MaxOptions && Object.keys(config.h3MaxOptions).length) return 'Clear fal-only H3 Max options before generating on EvoLink.';
  if (images.some(ref => ref.isFirstFrame || ref.isLastFrame) || videos.some(ref => ref.isContinuation)) return 'EvoLink H3 Max uses attachment order, not frame or continuation tags.';
  const trimmed = config.prompt.trim();
  if (!trimmed || exceedsCharacterLimit(trimmed, EVO_H3_CAPABILITIES.maxPromptLength)) return 'Enter a prompt of 1–7000 characters.';
  if (!Number.isInteger(config.videoDuration) || config.videoDuration < 5 || config.videoDuration > 15) return 'Choose a whole duration from 5 to 15 seconds.';
  if (config.videoQuality !== '480p' && config.videoQuality !== '768p') return 'Choose 480p or 768p for EvoLink H3 Max.';
  if (mode !== 'image_to_video' && !(mode === 'reference_to_video' ? EVO_H3_CAPABILITIES.referenceAspectRatios : EVO_H3_CAPABILITIES.textAspectRatios).some(ratio => ratio === config.videoAspectRatio)) return 'Choose a supported EvoLink H3 Max aspect ratio.';
  for (const [i, ref] of images.entries()) {
    if (!ref.data) return `Restore Image ${i + 1} before generating.`;
    if (!/^image\/(?:jpe?g|png|webp|heic|heif)$/i.test(ref.mimeType)) return `Image ${i + 1} must be JPEG, PNG, WEBP, HEIC or HEIF.`;
    if (invalidDimensions(ref)) return `Image ${i + 1} must be 256–5760 px on each side with a width-to-height ratio of 0.4–2.5.`;
  }
  for (const [label, refs, allowed, maxMB] of [
    ['Video', videos, EVO_H3_CLIP_MIME.video, 50], ['Audio', audios, EVO_H3_CLIP_MIME.audio, 15],
  ] as const) {
    let total = 0;
    for (const [i, ref] of refs.entries()) {
      if (!ref.url) return `Restore ${label} ${i + 1} before generating.`;
      if (!allowed.test(ref.mimeType)) return `${label} ${i + 1} must be ${label === 'Video' ? 'MP4 or MOV' : 'MP3 or WAV'}.`;
      if (ref.size != null && (!Number.isFinite(ref.size) || ref.size <= 0 || ref.size > maxMB * 1024 * 1024)) return `${label} ${i + 1} must be a nonempty file of at most ${maxMB} MB.`;
      if (ref.duration != null) {
        if (!Number.isFinite(ref.duration) || ref.duration < 2 || ref.duration > 15) return `${label} ${i + 1} must be 2–15 seconds.`;
        total += ref.duration;
      }
    }
    if (total > 15) return `${label} references together must be no longer than 15 seconds.`;
  }
  if (videos.some(invalidDimensions)) return 'Video references must be 256–5760 px on each side with a width-to-height ratio of 0.4–2.5.';
}

/** Translate editor tokens only. Native EvoLink prose and quoted dialogue are not rewritten. */
export function normalizeEvoH3Prompt(prompt: string, mode: EvoH3DraftMode, refs: Pick<GenerationConfig, 'referenceImages' | 'referenceVideos' | 'referenceAudios'>): string {
  const {referenceImages: images, referenceVideos: videos = [], referenceAudios: audios = []} = refs;
  const label = (kind: string, n: number) => {
    const count = kind === 'Image' ? images.length : kind === 'Video' ? videos.length : audios.length;
    if (n < 1 || n > count || mode === 'text_to_video') throw new Error(`${kind} ${n} is not attached to this EvoLink task.`);
    if (mode === 'image_to_video') return n === 1 ? 'the start image' : 'the end image';
    return `${kind} ${n}`;
  };
  return mapUnquotedPrompt(prompt.trim(), text => text.replace(/\\_/g, '_')
    .replace(/@REFERENCE\[[^\]\n]*\]|@MISSING_IMAGE_\d+\b/gi, token => label('Image', Number(resolveStableImageReferences(token, images).slice('image '.length))))
    .replace(/[@#](?:REF[_ ]?)?IMAGE[_ ]?(\d+)\b/gi, (_, n) => label('Image', Number(n)))
    .replace(/[@#](VIDEO|AUDIO)(?:[_ ]?(\d+))?\b/gi, (_, kind, n) => label(kind.toLowerCase() === 'video' ? 'Video' : 'Audio', Number(n || 1)))
    .replace(/@(FIRST|LAST)[_ ]?FRAME\b/gi, (_, kind) => {
      if (mode !== 'image_to_video') throw new Error('Frame tokens require EvoLink Image to Video.');
      return label('Image', kind.toLowerCase() === 'first' ? 1 : 2);
    })
    .replace(/@(ME|MAIN[_ ]?PERSON|SECOND[_ ]?PERSON|PERSON[_ ]?(\d+))\b/gi, (_, tag, n) => {
      const group = Number(n || (/^second/i.test(tag) ? 2 : 1));
      const matches = images.flatMap((ref, i) => getPersonId(ref) === group ? [label('Image', i + 1)] : []);
      if (!matches.length) throw new Error(`No identity image is attached for ${tag}.`);
      return `the person shown in ${matches.join(' and ')}`;
    }));
}
