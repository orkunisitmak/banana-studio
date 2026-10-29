import { getImagePromptContextKey, isImagePromptContextCurrent, SUNBURST_MODEL } from './lib/images/openaiImage.ts';
import { resolveH3MaxMode, type H3MaxMode, type H3MaxOptions, type H3MaxSelection } from './lib/video/h3Max.ts';
export type { H3MaxMode, H3MaxOptions, H3MaxSelection } from './lib/video/h3Max.js';
export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export type Resolution = '1K' | '2K' | '4K';
/** Retired model IDs remain readable in historical gallery rows. */
export type ImageModelId = 'gemini-3-pro-image-preview' | 'gemini-nano-banana-2.1' | 'gemini-3.1-flash-image-preview' | 'gpt-image-2-beta' | 'gpt-image-2.5-sunburst';
export interface OpenAIImageOptions {
  quality: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  size: 'preset' | 'auto' | 'custom';
  width: number;
  height: number;
  background: 'auto' | 'opaque' | 'transparent';
  /** Legacy formats remain readable in history; new Sunburst requests use PNG. */
  outputFormat: 'png' | 'jpeg' | 'webp';
  outputCompression: number;
  moderation: 'auto' | 'low';
  inputFidelity?: 'high' | 'low';
}
export type LocalImageSyncStatus = 'local-only' | 'synced';

export type GenerationMode = 'image' | 'video';
export type MediaType = 'image' | 'video';
export type VideoModelId = 'seedance-2.0' | 'seedance-2.5' | 'minimax-h3';
export type VideoOperation = 'generate' | 'reference_edit' | 'edit' | 'extend';
/** Continue can also create a new shot from a marked reference in Generate mode. */
export type VideoPromptIntent = VideoOperation | 'continue';
export type H3GenerationMode = 'text_only' | 'image_to_video' | 'reference_to_video';
export type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | 'adaptive';
export type VideoQuality = '480p' | '720p' | '768p' | '1080p' | '2K' | '4K';
export type VideoPromptExpansionMode = 'disabled' | 'fast' | 'balanced' | 'quality';
/** Provider validation owns bounds; H3 Max also accepts fractional seconds. */
export type VideoDuration = number;

export const DEFAULT_IMAGE_MODEL: ImageModelId = SUNBURST_MODEL;
export const DEFAULT_VIDEO_MODEL: VideoModelId = 'seedance-2.5';

export const IMAGE_MODEL_OPTIONS: { label: string; value: ImageModelId }[] = [
  { label: 'Nano Banana Pro', value: 'gemini-3-pro-image-preview' },
  { label: 'Nano Banana 2.1', value: 'gemini-nano-banana-2.1' },
  { label: 'GPT Image 2.5', value: 'gpt-image-2.5-sunburst' },
];

/** Resolve new drafts without relabeling or rewriting saved generations. */
export const getActiveImageModel = (value: unknown): ImageModelId => {
  if (value === 'gemini-3.1-flash-image-preview') return 'gemini-nano-banana-2.1';
  if (value === 'gpt-image-2-beta') return SUNBURST_MODEL;
  return IMAGE_MODEL_OPTIONS.some(option => option.value === value) ? value as ImageModelId : DEFAULT_IMAGE_MODEL;
};
export const getImageModelLabel = (value?: string): string => {
  if (value === 'gemini-3.1-flash-image-preview') return 'Nano Banana 2';
  if (value === 'gpt-image-2-beta') return 'GPT Image 2 (retired)';
  const model = value || DEFAULT_IMAGE_MODEL;
  return IMAGE_MODEL_OPTIONS.find(option => option.value === model)?.label || model;
};

export const VIDEO_ASPECT_RATIO_OPTIONS: { label: string; value: VideoAspectRatio }[] = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1', value: '1:1' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '21:9', value: '21:9' },
  { label: 'Adaptive', value: 'adaptive' },
];

export const VIDEO_MODEL_OPTIONS: { label: string; value: VideoModelId }[] = [
  { label: 'Seedance 2.0', value: 'seedance-2.0' },
  { label: 'Seedance 2.5 Relaxed', value: 'seedance-2.5' },
  { label: 'MiniMax H3 Max', value: 'minimax-h3' },
];

export const VIDEO_QUALITY_OPTIONS: { label: string; value: VideoQuality }[] = [
  { label: '480p', value: '480p' },
  { label: '720p', value: '720p' },
  { label: '768p', value: '768p' },
  { label: '1080p', value: '1080p' },
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' },
];

export const VIDEO_DURATION_OPTIONS: { label: string; value: VideoDuration }[] = Array.from(
  { length: 27 },
  (_, index) => {
    const value = (index + 4) as VideoDuration;
    return { label: `${value}s`, value };
  }
);

export type TextModelId = 'gemini-3.8-flash' | 'gpt-6.1-sol' | 'anthropic/claude-opus-5.5';

export const TEXT_MODEL_OPTIONS: { label: string; value: TextModelId; description: string }[] = [
  {
    label: 'Claude Opus 5.5',
    value: 'anthropic/claude-opus-5.5',
    description: 'Default via OpenRouter. Adjustable thinking. Enhance, brainstorm, variations and evidence-based video briefs with image references.',
  },
  {
    label: 'Gemini 3.8 Flash',
    value: 'gemini-3.8-flash',
    description: 'Adjustable thinking · Medium by default. Enhance, brainstorm, and variations. Video brief extraction uses Low.',
  },
  {
    label: 'GPT-6.1 Sol',
    value: 'gpt-6.1-sol',
    description: 'Adjustable reasoning · High by default. Enhance, brainstorm, variations and evidence-based video briefs with image references.',
  },
];

export const DEFAULT_TEXT_MODEL: TextModelId = 'anthropic/claude-opus-5.5';
export const getTextModelLabel = (model: string): string => TEXT_MODEL_OPTIONS.find(option => option.value === model)?.label || model;
/** Gemini reads native YouTube footage; the selected text model prepares its final analysis. */
export const GEMINI_TEXT_MODEL: TextModelId = 'gemini-3.8-flash';

export interface PersonGroupDefinition {
  id: number;
  name?: string;
  savedPersonId?: string;
}

export interface ImageEditLayer {
  id: string;
  tool: 'mask' | 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
  points?: { x: number; y: number }[];
}

/** Episode research is metadata; it does not attach the published cover. */
export interface YouTubeEpisodeSource {
  videoId: string;
  title: string;
  analysisSource: 'video' | 'metadata';
  brief?: string;
  premise?: string;
  warning?: string;
  analysisModel?: TextModelId;
  reasoningEffort?: import('./lib/prompts/openaiText.js').OpenAIReasoningEffort;
  evidence?: { timestamp: string; fact: string; relevance?: 'premise' | 'context' }[];
}

export { normalizeYouTubeSource } from './lib/youtube/youtubeSource.ts';

export interface ReferenceImage {
  id: string;
  data: string; // base64 or URL
  mimeType: string;
  /** Decoded source dimensions, when available; used for reference-cost estimates. */
  width?: number;
  height?: number;
  isSubjectImage?: boolean;
  isSecondPerson?: boolean;
  /** Stable identity group; 1/2 also map to legacy Me/2nd flags. */
  personId?: number;
  personName?: string;
  isDraftImage?: boolean;
  /** Approved base of a local image edit; other attachments are donors. */
  isEditSource?: boolean;
  /** Normalized selection envelope. Layers form a union; gaps stay original. */
  editRegion?: { x: number; y: number; width: number; height: number; points?: { x: number; y: number }[]; layers?: ImageEditLayer[] };
  /** Original video thumbnail: episode context, not a layout to copy. */
  isVideoContext?: boolean;
  /** Example cover chosen for thumbnail design language, not episode facts or identity. */
  isThumbnailStyle?: boolean;
  /** Provenance for the imported episode cover, retained with saved references. */
  youtubeSource?: YouTubeEpisodeSource;
  isFirstFrame?: boolean;
  isLastFrame?: boolean;
}

export interface ReferenceVideo {
  id: string;
  url: string;
  mimeType: string;
  duration?: number;
  size?: number;
  /** Decoded source dimensions. Frame rate remains an explicit pricing assumption. */
  width?: number;
  height?: number;
  isContinuation?: boolean;
  previousPrompt?: string;
}

export interface ReferenceAudio {
  id: string;
  url: string;
  mimeType: string;
  name?: string;
  duration?: number;
  size?: number;
}

export interface VideoCost {
  credits?: number;
  usd: number;
  source?: 'provider_actual' | 'provider_reserved' | 'provider_usage' | 'published_estimate';
}

// EvoLink's public price cards express roughly 68 credits as $1. Provider
// responses are the authoritative source for credits; USD remains approximate
// because top-up bonuses or account-specific terms can change their cash value.
export const EVOLINK_CREDITS_PER_USD = 68;

export type VideoPricingRate = {
  noVideoInput: number;
  withVideoInput: number;
  credits: { noVideoInput: number; withVideoInput: number };
};

// EvoLink Standard-route pricing per billed second. Seedance video-input jobs
// bill max(total input video duration, output duration) + output duration.
// Sources: https://evolink.ai/seedance-2-0 and https://evolink.ai/seedance-2-5
export const EVOLINK_PRICING: Record<Exclude<VideoModelId, 'minimax-h3'>, Partial<Record<VideoQuality, VideoPricingRate>>> = {
  'seedance-2.0': {
    '480p': { noVideoInput: 0.092, withVideoInput: 0.056, credits: { noVideoInput: 6.2775, withVideoInput: 3.834 } },
    '720p': { noVideoInput: 0.199, withVideoInput: 0.121, credits: { noVideoInput: 13.5, withVideoInput: 8.2215 } },
    '1080p': { noVideoInput: 0.496, withVideoInput: 0.302, credits: { noVideoInput: 33.75, withVideoInput: 20.52 } },
  },
  'seedance-2.5': {
    '480p': { noVideoInput: 0.138, withVideoInput: 0.084, credits: { noVideoInput: 9.34, withVideoInput: 5.71 } },
    '720p': { noVideoInput: 0.296, withVideoInput: 0.180, credits: { noVideoInput: 20.09, withVideoInput: 12.23 } },
    // EvoLink's limited 1080p rate is active through 2026-09-17 (UTC+8).
    // Provider-returned credits remain authoritative after task acceptance.
    '1080p': { noVideoInput: 0.532, withVideoInput: 0.324, credits: { noVideoInput: 36.16, withVideoInput: 21.99 } },
  },
};

// Legacy base-H3 pricing is retained only to reconcile historical generation
// records created before the H3 product selection became Max-only.
// Reference-to-video also added $0.08 for every image after the first five.
// Source: https://fal.ai/models/minimax/h3/reference-to-video
export const FAL_H3_REFERENCE_PRICING: Record<Extract<VideoQuality, '480p' | '768p' | '2K' | '4K'>, number> = {
  '480p': 0.05,
  '768p': 0.08,
  '2K': 0.13,
  '4K': 0.16,
};

// H3 Max is fal's fast text/image path. Launch pricing is 50% off through
// August 31, 2026; normal rates begin September 1.
// Sources:
//   https://fal.ai/models/minimax/h3-max/text-to-video
//   https://fal.ai/models/minimax/h3-max/image-to-video
export const FAL_H3_MAX_PRICING: Record<Extract<VideoQuality, '480p' | '768p'>, number> = {
  '480p': 0.05,
  '768p': 0.08,
};
export const FAL_H3_MAX_LAUNCH_PRICING: Record<Extract<VideoQuality, '480p' | '768p'>, number> = {
  '480p': 0.025,
  '768p': 0.04,
};
const FAL_H3_MAX_LAUNCH_PROMO_END = Date.UTC(2026, 8, 1);

export const isFalH3MaxPromoActive = (): boolean => Date.now() < FAL_H3_MAX_LAUNCH_PROMO_END;

export const getFalH3MaxPricing = (quality: VideoQuality): number => {
  const normalizedQuality: Extract<VideoQuality, '480p' | '768p'> = quality === '480p' ? '480p' : '768p';
  const pricing = isFalH3MaxPromoActive() ? FAL_H3_MAX_LAUNCH_PRICING : FAL_H3_MAX_PRICING;
  return pricing[normalizedQuality];
};

const SEEDANCE_25_1080_PROMO_END = Date.UTC(2026, 8, 17, 16, 0, 0);
const SEEDANCE_25_RELAXED_CHANNEL_MULTIPLIER = 1.1;

export const isSeedance25PromoActive = (): boolean => Date.now() <= SEEDANCE_25_1080_PROMO_END;

export const getEvoLinkVideoPricing = (model: Exclude<VideoModelId, 'minimax-h3'>, quality: VideoQuality): VideoPricingRate => {
  let pricing = EVOLINK_PRICING[model][quality] || EVOLINK_PRICING[model]['720p']!;
  if (model === 'seedance-2.5' && quality === '1080p' && !isSeedance25PromoActive()) {
    // After the promotion, EvoLink documents 1080p as 2.5x the 720p rate.
    const base = EVOLINK_PRICING['seedance-2.5']['720p']!;
    pricing = {
      noVideoInput: base.noVideoInput * 2.5,
      withVideoInput: base.withVideoInput * 2.5,
      credits: {
        noVideoInput: base.credits.noVideoInput * 2.5,
        withVideoInput: base.credits.withVideoInput * 2.5,
      },
    };
  }

  if (model !== 'seedance-2.5') return pricing;

  // The app always sends content_filter:false for Seedance 2.5. EvoLink bills
  // that relaxed-content channel at 10% above its published Standard rates.
  return {
    noVideoInput: pricing.noVideoInput * SEEDANCE_25_RELAXED_CHANNEL_MULTIPLIER,
    withVideoInput: pricing.withVideoInput * SEEDANCE_25_RELAXED_CHANNEL_MULTIPLIER,
    credits: {
      noVideoInput: pricing.credits.noVideoInput * SEEDANCE_25_RELAXED_CHANNEL_MULTIPLIER,
      withVideoInput: pricing.credits.withVideoInput * SEEDANCE_25_RELAXED_CHANNEL_MULTIPLIER,
    },
  };
};

export const estimateVideoCost = (
  model: VideoModelId,
  quality: VideoQuality,
  outputDuration: number,
  hasVideoInput: boolean,
  referenceVideoDuration: number = 0,
  operation: VideoOperation = 'generate',
  primaryVideoDuration: number = 0,
  referenceImageCount: number = 0,
  h3Mode?: H3GenerationMode,
): VideoCost => {
  if (model === 'minimax-h3') {
    const duration = Math.max(5, Math.min(15, outputDuration === -1 ? 5 : outputDuration));
    if (h3Mode === 'text_only' || h3Mode === 'image_to_video') {
      return {
        usd: getFalH3MaxPricing(quality) * duration,
        source: 'published_estimate',
      };
    }

    const h3Quality = quality === '480p' || quality === '768p' || quality === '2K' || quality === '4K'
      ? quality
      : '2K';
    // Historical base-H3 reference records billed referenced video seconds at
    // the generated-output rate. Keep this branch for old usage reconciliation;
    // active H3 generation passes text_only or image_to_video above.
    const billedReferenceVideoDuration = hasVideoInput ? Math.max(0, referenceVideoDuration) : 0;
    const referenceImageSurcharge = Math.max(0, referenceImageCount - 5) * 0.08;
    return {
      usd: (FAL_H3_REFERENCE_PRICING[h3Quality] * (duration + billedReferenceVideoDuration)) + referenceImageSurcharge,
      source: 'published_estimate',
    };
  }

  const pricing = getEvoLinkVideoPricing(model, quality);
  const creditPerSec = hasVideoInput ? pricing.credits.withVideoInput : pricing.credits.noVideoInput;
  const estimatedOutputDuration = outputDuration === -1
    ? operation === 'edit'
      ? Math.max(4, primaryVideoDuration || referenceVideoDuration || 5)
      : 30
    : Math.max(0, outputDuration);
  const inputDuration = Math.max(0, referenceVideoDuration);
  const billedDuration = hasVideoInput
    ? Math.max(inputDuration, estimatedOutputDuration) + estimatedOutputDuration
    : estimatedOutputDuration;
  const credits = creditPerSec * billedDuration;
  return {
    usd: credits / EVOLINK_CREDITS_PER_USD,
    credits,
    source: 'published_estimate',
  };
};

// Flat fal image prices for Pro and historical Nano Banana 2/GPT Image 2.
// Nano Banana 2.1 uses token billing and is intentionally absent: its preview
// estimates output only, and unreported total usage remains unknown.
//
// Sources:
//   - Nano Banana Pro: https://fal.ai/models/fal-ai/nano-banana-pro
//     "$0.15 per image. 4K outputs charged at double the standard rate."
//   - Nano Banana 2:   https://fal.ai/models/fal-ai/nano-banana-2
//     "$0.08 per image. 2K = 1.5×, 4K = 2×, high thinking +$0.002."
//     We always send thinking_level='high' so the +$0.002 is baked in.
//   - GPT Image 2 (fal): aspect-ratio-aware table in estimateImageCost.
export const IMAGE_COST_PER_GEN: Partial<Record<ImageModelId, Record<Resolution, number>>> = {
  'gemini-3-pro-image-preview':    { '1K': 0.150, '2K': 0.150, '4K': 0.300 },
  'gemini-3.1-flash-image-preview':{ '1K': 0.082, '2K': 0.122, '4K': 0.162 },
  // GPT Image 2 cost depends on aspect ratio AND resolution; the entries
  // below are an aspect-agnostic average. The aspect-ratio-aware lookup in
  // `estimateImageCost` overrides these for accurate per-call estimates.
  'gpt-image-2-beta': { '1K': 0.18, '2K': 0.30, '4K': 0.55 },
};

// GPT Image 2 (fal.ai) per-image pricing at HIGH quality, indexed by app
// aspect ratio AND resolution. Text generation and editing have different
// prices, so keep separate tables and select based on whether references are
// included in the request.
// Sources: https://fal.ai/models/openai/gpt-image-2 and
//          https://fal.ai/models/openai/gpt-image-2/edit
// Documented data points:
//   1024x768 -> $0.15  (4:3 1K)
//   1024x1024 -> $0.22 (1:1 1K)
//   1024x1536 -> $0.17 (3:4 1K)
//   1920x1080 -> $0.16 (16:9 1K)
//   2560x1440 -> $0.23 (16:9 2K)
//   3840x2160 -> $0.41 (16:9 4K)
// fal publishes canonical rows for a subset of dimensions. Non-canonical
// aspect/size combinations remain estimates; the admin provider reconciliation
// uses fal's billing API when an admin billing key is configured.
export const GPT_IMAGE_2_HIGH_QUALITY_TEXT_COST: Record<AspectRatio, Record<Resolution, number>> = {
  '1:1':  { '1K': 0.211, '2K': 0.44, '4K': 0.82 },
  '4:3':  { '1K': 0.145, '2K': 0.29, '4K': 0.401 },
  '3:4':  { '1K': 0.165, '2K': 0.31, '4K': 0.401 },
  '16:9': { '1K': 0.145, '2K': 0.222, '4K': 0.401 },
  '9:16': { '1K': 0.145, '2K': 0.222, '4K': 0.401 },
};

export const GPT_IMAGE_2_HIGH_QUALITY_EDIT_COST: Record<AspectRatio, Record<Resolution, number>> = {
  '1:1':  { '1K': 0.219, '2K': 0.45, '4K': 0.84 },
  '4:3':  { '1K': 0.151, '2K': 0.30, '4K': 0.413 },
  '3:4':  { '1K': 0.178, '2K': 0.32, '4K': 0.413 },
  '16:9': { '1K': 0.151, '2K': 0.234, '4K': 0.413 },
  '9:16': { '1K': 0.151, '2K': 0.234, '4K': 0.413 },
};

// Backward-compatible export for callers that only need a conservative cost.
export const GPT_IMAGE_2_HIGH_QUALITY_COST = GPT_IMAGE_2_HIGH_QUALITY_EDIT_COST;

export const estimateImageCost = (
  model: ImageModelId,
  resolution: Resolution,
  count: number,
  aspectRatio?: AspectRatio,
  hasReferenceInput: boolean = false,
): number | null => {
  // Historical costs cannot be inferred without Sunburst quality/size. New
  // generation previews use getImageCostPreview with the full settings.
  if (model === 'gpt-image-2.5-sunburst') return count === 0 ? 0 : null;
  // Nano Banana 2.1 bills actual input, thinking and image-output tokens.
  // The queue does not expose them; never reuse Nano Banana 2's flat fees.
  if (model === 'gemini-nano-banana-2.1') return count === 0 ? 0 : null;
  if (model === 'gpt-image-2-beta') {
    const ar = aspectRatio || '1:1';
    const pricing = hasReferenceInput
      ? GPT_IMAGE_2_HIGH_QUALITY_EDIT_COST
      : GPT_IMAGE_2_HIGH_QUALITY_TEXT_COST;
    const perImage = pricing[ar]?.[resolution]
      ?? pricing[ar]?.['1K']
      ?? 0.18;
    return perImage * count;
  }
  const perImage = IMAGE_COST_PER_GEN[model]?.[resolution] || 0.134;
  return perImage * count;
};

// Brainstorm feature types
export type BrainstormCategory = 'youtube_thumbnail' | 'product_shot' | 'portrait' | 'social_media' | 'custom' | 'simple';

export interface BrainstormConfig {
  category: BrainstormCategory;
  customInstructions?: string;
  ideaCount?: number;
}

export interface BrainstormIdea {
  id: string;
  text: string;
  isUsed?: boolean;
}

/** Text task that produced the current prompt; independent of the image/video model. */
export interface PromptPreparation {
  action: 'enhance' | 'brainstorm' | 'variation';
  model: string;
  reasoningEffort?: import('./lib/prompts/openaiText.js').OpenAIReasoningEffort;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface GenerationConfig {
  imageProvider?: import('./lib/providers.js').AIProvider;
  prompt: string;
  /** Brief before Enhance or Brainstorm, retained for Revert/Re-create. */
  originalPrompt?: string;
  promptPreparation?: PromptPreparation;
  /** Source details shown separately from the short creative brief and image inputs. */
  youtubeSource?: YouTubeEpisodeSource;
  /** The mode/model/action target used to create the current enhanced prompt. */
  enhancedForMode?: GenerationMode;
  enhancedForImageModel?: ImageModelId;
  enhancedForImageContextKey?: string;
  enhancedForVideoModel?: VideoModelId;
  enhancedForVideoOperation?: VideoPromptIntent;
  /** Ordered reference roles and video timing used by Enhance, excluding mutable upload URLs. */
  enhancedForVideoReferenceKey?: string;
  enhancedForH3MaxMode?: H3MaxMode;
  enhancedForH3MaxOptionsKey?: string;
  count: number;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  imageModel: ImageModelId;
  openaiImageOptions?: OpenAIImageOptions;
  imagePromptCategory?: BrainstormCategory;
  referenceImages: ReferenceImage[];
  /** Draft/template identities, including people with no assigned photo yet. */
  personGroups?: PersonGroupDefinition[];
  referenceVideos: ReferenceVideo[];
  referenceAudios: ReferenceAudio[];
  mode: GenerationMode;
  videoModel: VideoModelId;
  h3MaxMode?: H3MaxSelection;
  h3MaxOptions?: Partial<H3MaxOptions>;
  videoOperation: VideoOperation;
  videoAspectRatio: VideoAspectRatio;
  videoQuality: VideoQuality;
  videoDuration: VideoDuration;
  audioEnabled: boolean;
  videoPromptExpansionMode: VideoPromptExpansionMode;
}

export const getVideoPromptIntent = (
  config: Pick<GenerationConfig, 'videoOperation' | 'referenceVideos'>,
): VideoPromptIntent => (config.videoOperation || 'generate') === 'generate' && config.referenceVideos?.some(video => video.isContinuation)
  ? 'continue'
  : config.videoOperation || 'generate';

export const getVideoEnhancementReferenceKey = (
  config: Pick<GenerationConfig, 'referenceImages' | 'referenceVideos' | 'referenceAudios' | 'videoDuration'>,
): string => JSON.stringify({
  duration: config.videoDuration,
  images: (config.referenceImages || []).map(image => [
    image.id, !!image.isSubjectImage, !!image.isSecondPerson, image.personId, image.personName, !!image.isFirstFrame, !!image.isLastFrame,
  ]),
  videos: (config.referenceVideos || []).map(video => [
    video.id, !!video.isContinuation, video.previousPrompt || '',
  ]),
  audios: (config.referenceAudios || []).map(audio => audio.id),
});

export const getPromptEnhancementTarget = (config: GenerationConfig): Pick<GenerationConfig,
  'enhancedForMode' | 'enhancedForImageModel' | 'enhancedForImageContextKey' | 'enhancedForVideoModel' | 'enhancedForVideoOperation' | 'enhancedForVideoReferenceKey' | 'enhancedForH3MaxMode' | 'enhancedForH3MaxOptionsKey'
> => ({
  enhancedForMode: config.mode,
  enhancedForImageModel: config.mode === 'image' ? config.imageModel : undefined,
  enhancedForImageContextKey: config.mode === 'image' ? getImagePromptContextKey(config) : undefined,
  enhancedForVideoModel: config.mode === 'video' ? config.videoModel : undefined,
  enhancedForVideoOperation: config.mode === 'video' ? getVideoPromptIntent(config) : undefined,
  enhancedForVideoReferenceKey: config.mode === 'video' ? getVideoEnhancementReferenceKey(config) : undefined,
  enhancedForH3MaxMode: config.mode === 'video' && config.videoModel === 'minimax-h3'
    ? resolveH3MaxMode(config.h3MaxMode, {images:config.referenceImages.length,videos:config.referenceVideos?.length||0,audios:config.referenceAudios?.length||0}) : undefined,
  enhancedForH3MaxOptionsKey: config.mode === 'video' && config.videoModel === 'minimax-h3' ? getH3MaxEnhancementKey(config) : undefined,
});

const getH3MaxEnhancementKey = (config: GenerationConfig) => JSON.stringify({
  options:Object.entries(config.h3MaxOptions||{}).filter(([key])=>!['seed','startImageUrl','middleImageUrl','endImageUrl'].includes(key)).sort(([a],[b])=>a.localeCompare(b)),
  expansion:config.videoPromptExpansionMode,ratio:config.videoAspectRatio,quality:config.videoQuality,
});

export const isEnhancedPromptStale = (config: GenerationConfig): boolean => Boolean(
  config.originalPrompt != null
  && config.enhancedForMode
  && (
    config.enhancedForMode !== config.mode
    || (config.mode === 'image' && (
      (config.enhancedForImageModel != null && config.enhancedForImageModel !== config.imageModel)
      || (config.enhancedForImageContextKey != null && !isImagePromptContextCurrent(config.enhancedForImageContextKey, config))
    ))
    || (config.mode === 'video' && (
      config.enhancedForVideoModel !== config.videoModel
      || config.enhancedForVideoOperation !== getVideoPromptIntent(config)
      || (config.enhancedForVideoReferenceKey != null
        && config.enhancedForVideoReferenceKey !== getVideoEnhancementReferenceKey(config))
      || (config.videoModel === 'minimax-h3' && config.enhancedForH3MaxMode != null && (
        config.enhancedForH3MaxMode !== resolveH3MaxMode(config.h3MaxMode,{images:config.referenceImages.length,videos:config.referenceVideos?.length||0,audios:config.referenceAudios?.length||0})
        || config.enhancedForH3MaxOptionsKey !== getH3MaxEnhancementKey(config)
      ))
    ))
  )
);

export interface GeneratedMedia {
  generationProvider?: import('./lib/providers.js').AIProvider;
  providerModel?: string;
  id: string;
  url: string;
  thumbnailUrl?: string;
  storagePath?: string;
  thumbnailPath?: string;
  syncStatus?: LocalImageSyncStatus;
  prompt: string;
  originalPrompt?: string;
  promptPreparation?: PromptPreparation;
  youtubeSource?: YouTubeEpisodeSource;
  /** The final prompt returned by the video provider after its own expansion pass. */
  providerExpandedPrompt?: string;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  imageModel?: ImageModelId;
  openaiImageOptions?: OpenAIImageOptions;
  imagePromptCategory?: BrainstormCategory;
  /** Exact prompt sent to the image provider, including reference roles. */
  imageGenerationPrompt?: string;
  /** Actual provider input order; referenceImages also retains context-only photos. */
  imageGenerationReferenceIds?: string[];
  /** Requested canvas, stored separately from measured output dimensions. */
  imageRequestedSize?: string;
  /** Actual output dimensions returned by OpenAI, including automatic sizing. */
  imageOutputSize?: string;
  imageEditProtection?: { version: number; sourceReferenceId: string; sourceSha256: string; sourceSize: string;
    region: NonNullable<ReferenceImage['editRegion']>; pixelRegion: { left: number; top: number; width: number; height: number };
    preservedOutsideRegion: boolean; providerOutputSha256: string };
  /** Gallery source for pending and completed edits, retained in the lightweight index. */
  imageEditSourceId?: string;
  openaiUsage?: Record<string, unknown>;
  openaiStartedAt?: number;
  createdAt: number;
  referenceImages: ReferenceImage[];
  folderId?: string | null;
  isFavorite?: boolean;
  mediaType: MediaType;
  videoModel?: VideoModelId;
  videoOperation?: VideoOperation;
  videoAspectRatio?: VideoAspectRatio;
  videoQuality?: VideoQuality;
  videoDuration?: VideoDuration;
  audioEnabled?: boolean;
  videoPromptExpansionMode?: VideoPromptExpansionMode;
  /** Measured/provider output length; requested duration remains separate for billing. */
  videoOutputDuration?: number;
  h3MaxMode?: H3MaxMode;
  h3MaxOptions?: Partial<H3MaxOptions>;
  generationCost?: VideoCost;
  generationTime?: number;
  generationStartedAt?: number;
  generationCompletedAt?: number;
  referenceVideos?: ReferenceVideo[];
  referenceAudios?: ReferenceAudio[];
  error?: string;
  taskId?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  // UI state
  isLoading?: boolean;
  videoProgress?: number;
  videoStage?: 'generating' | 'saving';
  /** Shared by tabs/devices while a video provider submission is in flight. */
  submissionHeartbeatAt?: number;
  imageProgress?: number;
  imageStage?: 'preparing' | 'queued' | 'generating';
  imageQueue?: { version: 1; queuedAt: number };
  imageQueueWaitReason?: 'rate' | 'quota';
  brainstormBatchId?: string;
  // Persisted fal.ai queue handle. falEndpoint identifies the submitted model;
  // falQueueEndpoint is the authoritative lifecycle route returned by fal.
  falRequestId?: string;
  falEndpoint?: string;
  falQueueEndpoint?: string;
}

export interface Template {
  id: string;
  name: string;
  config: GenerationConfig;
  createdAt: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt: number;
}

export interface SavedReferenceImage {
  id: string;
  data: string; // base64
  mimeType: string;
  name?: string;
  createdAt: number;
  isShared?: boolean;
  canEdit?: boolean;
}

/** Reusable identity with independent photo snapshots. Private unless shared. */
export interface SavedPerson {
  id: string;
  name: string;
  photos: Pick<ReferenceImage, 'id' | 'data' | 'mimeType'>[];
  isMe: boolean;
  createdAt: number;
  updatedAt: number;
  isShared?: boolean;
  canEdit?: boolean;
}

/** A saved person without photos; load the full record before adding or editing. */
export type SavedPersonSummary = Omit<SavedPerson, 'photos'>;

export type GeneratedImage = GeneratedMedia;

export interface AIStudio {
  hasSelectedApiKey: () => Promise<boolean>;
  openSelectKey: () => Promise<void>;
}

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: 'user' | 'admin';
  created_at: string;
  updated_at: string;
}

export interface UsageLog {
  id: string;
  user_id: string;
  action: 'generate' | 'enhance' | 'brainstorm' | 'variation' | 'video_generate' | 'video_enhance';
  model: string;
  prompt: string;
  image_count: number;
  estimated_cost: number | null;
  created_at: string;
}

export interface AdminModelUsageSummary {
  model: string;
  requests: number;
  images: number;
  videos: number;
  text_requests: number;
  enhance_requests: number;
  brainstorm_requests: number;
  variation_requests: number;
  /** Sum of recorded costs, which may mix provider usage and old estimates. */
  total_cost: number;
  unknown_cost_requests: number;
}

export interface AdminUserSummary {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  total_generations: number;
  total_images: number;
  total_videos: number;
  total_enhances: number;
  total_cost: number;
  image_cost: number;
  video_cost: number;
  enhance_cost: number;
  model_usage?: AdminModelUsageSummary[];
  unknown_cost_requests?: number;
}
