// Server-safe video pricing. Usage routes import it without the app's types
// module, which stays out of the function runtime dependency graph.
import type { H3GenerationMode, VideoCost, VideoModelId, VideoOperation, VideoQuality } from '../../types.js';

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
