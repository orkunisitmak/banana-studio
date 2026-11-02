import type { AIProvider } from '../providers.js';

/** Liquid Inference video routes (POST /v1/videos), checked against
 * GET /v1/exchange/models?kind=video on 2026-11-02. */
export const LIQUID_VIDEO_MODELS: Record<string, string> = { 'seedance-2.5': 'seedance-2-5' };
export const LIQUID_VIDEO_MAX_SECONDS = 10;

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
  if (counts.some((n, i) => n > (body.mode === 'image_to_video' ? [2,0,0] : newer ? [30,10,10] : [9,3,3])[i]) || counts.reduce((a,b) => a+b,0) > (newer ? 50 : 12)) return 'Too many references for this video mode.';
  if (body.mode === 'image_to_video' && !counts[0]) return 'Choose a first frame.';
  if (body.mode === 'reference_to_video' && !counts[0] && !counts[1]) return 'References mode needs an image or video.';
  if (body.mode.startsWith('video_') && !counts[1]) return 'This operation needs a source video.';
  if (!Number.isInteger(body.duration) || !(body.duration === -1 && newer) && (body.duration < 4 || body.duration > (newer ? 30 : 15))) return 'Choose a supported video duration.';
  if (!['480p','720p','1080p'].includes(body.quality)) return 'Unsupported video resolution.';
  if (!['adaptive','16:9','9:16','1:1','4:3','3:4','21:9'].includes(body.aspectRatio)) return 'Unsupported video aspect ratio.';
  if (provider === 'openrouter') {
    if (body.mode.startsWith('video_') || counts[1] || counts[2] || body.referenceEditMode) return 'OpenRouter supports text, first/last frames and image references here. Choose fal.ai or EvoLink in AI settings for video/audio references, Edit or Extend.';
    if (body.duration === -1) return 'OpenRouter requires a fixed duration. Choose 4–30 seconds or use fal.ai / EvoLink for Auto.';
    if (newer && body.quality === '1080p') return 'Seedance 2.5 on OpenRouter supports 480p and 720p. Choose 720p or use fal.ai / EvoLink for 1080p.';
    if (body.aspectRatio === 'adaptive') return 'Choose an aspect ratio for OpenRouter.';
    if (counts[0] > 9) return 'Use up to 9 image references with this OpenRouter route.';
  }
  if (provider === 'liquid') {
    if (!Object.hasOwn(LIQUID_VIDEO_MODELS, body.videoModel)) return 'Liquid Inference serves Seedance 2.5 here. Choose another provider for Seedance 2.0.';
    if (body.mode.startsWith('video_') || counts[1] || counts[2] || body.referenceEditMode) return 'Liquid Inference supports text, first/last frames and image references here. Choose fal.ai or EvoLink in AI settings for video/audio references, Edit or Extend.';
    if (body.duration === -1 || body.duration > LIQUID_VIDEO_MAX_SECONDS) return `Liquid Inference renders Seedance 2.5 for 4–${LIQUID_VIDEO_MAX_SECONDS} seconds. Choose a shorter fixed duration or another provider.`;
    if (body.aspectRatio === 'adaptive') return 'Choose an aspect ratio for Liquid Inference.';
    if (counts[0] > 9) return 'Use up to 9 image references with this Liquid Inference route.';
  }
}
const referencePrompt = (prompt = '') => prompt.replace(/@(?:REF[_ ]?)?IMAGE[_ ]?(\d+)/gi, '@Image$1').replace(/@VIDEO[_ ]?(\d+)/gi, '@Video$1').replace(/@AUDIO[_ ]?(\d+)/gi, '@Audio$1');
export function falSeedanceInput(body: SeedanceRequest) {
  const prompt = (body.prompt || '').replace(/@(?:REF[_ ]?)?IMAGE[_ ]?(\d+)/gi, '@Image$1').replace(/@VIDEO[_ ]?(\d+)/gi, '@Video$1').replace(/@AUDIO[_ ]?(\d+)/gi, '@Audio$1');
  const input: Record<string, unknown> = { prompt, resolution: body.quality, duration: body.duration === -1 ? 'auto' : String(body.duration),
    aspect_ratio: body.aspectRatio === 'adaptive' || body.mode === 'image_to_video' && body.videoModel === 'seedance-2.5' ? 'auto' : body.aspectRatio, generate_audio: body.generateAudio !== false };
  if (body.mode === 'image_to_video') { input.image_url = body.imageUrls?.[0]; if (body.imageUrls?.[1]) input.end_image_url = body.imageUrls[1]; }
  if (['reference_to_video','video_edit','video_extend'].includes(body.mode)) {
    input.image_urls = body.imageUrls || []; input.video_urls = body.videoUrls || []; input.audio_urls = body.audioUrls || [];
    if (body.mode === 'video_edit') { input.task = 'editing'; input.aspect_ratio = 'auto'; input.duration = 'auto'; }
    if (body.mode === 'video_extend') { input.task = 'extension'; input.aspect_ratio = 'auto'; }
  }
  const mode = body.mode.startsWith('video_') ? 'reference-to-video' : routeMode(body.mode).replaceAll('_','-');
  return { endpoint: `bytedance/${body.videoModel}/${mode}`, input };
}
export function openRouterSeedanceInput(body: SeedanceRequest) {
  return { model: `bytedance/${body.videoModel}`, prompt: referencePrompt(body.prompt), duration: body.duration, resolution: body.quality,
    ...(body.aspectRatio !== 'adaptive' ? { aspect_ratio: body.aspectRatio } : {}), generate_audio: body.generateAudio !== false,
    ...(body.mode === 'image_to_video' ? { frame_images: body.imageUrls!.map((url, i) => ({ type: 'image_url', image_url: { url }, frame_type: i ? 'last_frame' : 'first_frame' })) }
      : body.imageUrls?.length ? { input_references: body.imageUrls.map(url => ({ type: 'image_url', image_url: { url } })) } : {}),
    provider: { allow_fallbacks: false },
  };
}

const SHORT_SIDE: Record<string, number> = { '480p': 480, '720p': 720, '1080p': 1080 };
const RATIOS: Record<string, [number, number]> = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:3': [4, 3], '3:4': [3, 4], '21:9': [21, 9] };
/** Liquid takes `size` as `<width>x<height>`. The short side follows the chosen
 * resolution; the long side is the nearest even number to the exact ratio, so a
 * first frame with the same ratio stays within the exchange's 1% shape check. */
export function liquidVideoSize(quality: string, aspectRatio: string): string {
  const short = SHORT_SIDE[quality], ratio = RATIOS[aspectRatio];
  if (!short || !ratio) throw new Error('Unsupported video size.');
  const [w, h] = ratio, long = Math.round(short * Math.max(w, h) / Math.min(w, h) / 2) * 2;
  return w >= h ? `${long}x${short}` : `${short}x${long}`;
}
/** Liquid's POST /v1/videos takes OpenRouter-style frame_images and
 * input_references (https or data:image URLs) plus `seconds` and `size`. */
export function liquidSeedanceInput(body: SeedanceRequest) {
  return { model: LIQUID_VIDEO_MODELS[body.videoModel], prompt: referencePrompt(body.prompt), seconds: String(body.duration),
    size: liquidVideoSize(body.quality, body.aspectRatio),
    ...(body.mode === 'image_to_video' ? { frame_images: body.imageUrls!.map((url, i) => ({ type: 'image_url', image_url: { url }, frame_type: i ? 'last_frame' : 'first_frame' })) }
      : body.imageUrls?.length ? { input_references: body.imageUrls.map(url => ({ type: 'image_url', image_url: { url } })) } : {}),
  };
}
