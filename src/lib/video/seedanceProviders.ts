import { getMultilineQuotedPromptPattern } from '../references/referenceTokens.ts';
import type { AIProvider } from '../providers.js';

export type SeedanceRequest = { videoModel: string; mode: string; prompt?: string; duration: number; quality: string; aspectRatio: string;
  generateAudio?: boolean; referenceEditMode?: boolean; editSourcePreparationVersion?: number; imageUrls?: string[]; videoUrls?: string[]; audioUrls?: string[] };
// The app and EvoLink call a prompt-only task `text_only`; fal names its route text-to-video.
const routeMode = (mode: string) => mode === 'text_only' ? 'text_to_video' : mode;
export function seedanceProviderError(provider: AIProvider, body: SeedanceRequest): string | undefined {
  const newer = body.videoModel === 'seedance-2.5';
  if (!['seedance-2.0','seedance-2.5'].includes(body.videoModel)) return 'Unsupported Seedance model.';
  if (!['text_to_video','image_to_video','reference_to_video','video_edit','video_extend'].includes(routeMode(body.mode))) return 'Unsupported video operation.';
  if (body.mode.startsWith('video_') && !newer) return 'Video editing and extension require Seedance 2.5.';
  const counts = [body.imageUrls?.length || 0, body.videoUrls?.length || 0, body.audioUrls?.length || 0];
  if (routeMode(body.mode) === 'text_to_video' && counts.some(Boolean)) return 'Text-to-video does not accept references.';
  if (counts.some((n, i) => n > (body.mode === 'image_to_video' ? [2,0,0] : newer ? [30,10,10] : [9,3,3])[i]) || counts.reduce((a,b) => a+b,0) > (newer ? 50 : 12)) return 'Too many references for this video mode.';
  if (body.mode === 'image_to_video' && !counts[0]) return 'Choose a first frame.';
  if (body.mode === 'reference_to_video' && !counts[0] && !counts[1] && (!newer || !counts[2])) return 'References mode needs an image or video.';
  if (body.mode.startsWith('video_') && !counts[1]) return 'This operation needs a source video.';
  const auto = body.duration === -1 && (newer || provider === 'fal');
  if (!Number.isInteger(body.duration) || (!auto && (body.duration < 4 || body.duration > (newer ? 30 : 15)))) return 'Choose a supported video duration.';
  if (!['480p','720p','1080p','4K'].includes(body.quality) || provider === 'openrouter' && body.quality === '4K') return 'Unsupported video resolution.';
  if (!['adaptive','16:9','9:16','1:1','4:3','3:4','21:9'].includes(body.aspectRatio)) return 'Unsupported video aspect ratio.';
  if (provider === 'openrouter') {
    if (body.mode.startsWith('video_') || counts[1] || counts[2] || body.referenceEditMode) return 'OpenRouter supports text, first/last frames and image references here. Choose fal.ai or EvoLink in AI settings for video/audio references, Edit or Extend.';
    if (body.duration === -1) return 'OpenRouter requires a fixed duration. Choose 4–30 seconds or use fal.ai / EvoLink for Auto.';
    if (newer && body.quality === '1080p') return 'Seedance 2.5 on OpenRouter supports 480p and 720p. Choose 720p or use fal.ai / EvoLink for 1080p.';
    if (body.aspectRatio === 'adaptive') return 'Choose an aspect ratio for OpenRouter.';
    if (counts[0] > 9) return 'Use up to 9 image references with this OpenRouter route.';
  }
}
const referenceAliases = (text: string) => text.replace(/@(?:REF[_ ]?)?IMAGE[_ ]?(\d+)/gi, '@Image$1').replace(/@VIDEO[_ ]?(\d+)/gi, '@Video$1').replace(/@AUDIO[_ ]?(\d+)/gi, '@Audio$1');
// Quoted visible copy is literal, even when it looks like a reference.
export const referencePrompt = (prompt = '') => {
  let end = 0, result = '';
  for (const match of prompt.matchAll(getMultilineQuotedPromptPattern())) {
    result += referenceAliases(prompt.slice(end, match.index)) + match[0];
    end = match.index! + match[0].length;
  }
  return result + referenceAliases(prompt.slice(end));
};
export function openRouterSeedanceInput(body: SeedanceRequest) {
  return { model: `bytedance/${body.videoModel}`, prompt: referencePrompt(body.prompt), duration: body.duration, resolution: body.quality,
    ...(body.aspectRatio !== 'adaptive' ? { aspect_ratio: body.aspectRatio } : {}), generate_audio: body.generateAudio !== false,
    ...(body.mode === 'image_to_video' ? { frame_images: body.imageUrls!.map((url, i) => ({ type: 'image_url', image_url: { url }, frame_type: i ? 'last_frame' : 'first_frame' })) }
      : body.imageUrls?.length ? { input_references: body.imageUrls.map(url => ({ type: 'image_url', image_url: { url } })) } : {}),
    provider: { allow_fallbacks: false },
  };
}
