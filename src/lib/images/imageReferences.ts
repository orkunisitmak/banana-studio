import { getPersonId } from '../references/personReferences';
import { isOpenAIImageModel, isGptImage26Model } from './openaiImage';
import { H3_MAX_CAPABILITIES, isH3MaxModeAvailable } from '../video/h3Max';
import { getH3MaxMode } from '../video/h3MaxConfig';
import type { GenerationConfig, ReferenceImage } from '../../types';

import { NANO_BANANA_21_MODEL } from './nanoBanana21';
import { SEEDREAM_MODEL } from './seedreamModel';
import { MAGI2_MODEL } from '../video/magi2';
import { getMagi2Limits } from '../video/magi2Config';
import { OMNI_MODEL, OMNI_LIMITS } from '../video/omniFlash';
import { EVO_H3_CAPABILITIES } from '../video/evoH3Max';
import { isFalSeedanceModel, falSeedanceLimits } from '../video/falSeedance25';

/** Choosing a whole-image source selects the Edit action and replaces any
 * earlier source or area. Releasing it returns to Generate. */
export const toggleWholeImageEditSource = (config: GenerationConfig, id: string): GenerationConfig => {
  const source = config.referenceImages.find(ref => ref.id === id);
  if (!source || getPersonId(source) != null || source.isVideoContext) return config;
  if (config.imageModel !== NANO_BANANA_21_MODEL && !isGptImage26Model(config.imageModel)) throw new Error('Whole-image Edit is available with GPT Image 2.6 and Nano Banana 2.1. Use Edit area with this model.');
  const enable = source.editScope !== 'image';
  const ratios: GenerationConfig['aspectRatio'][] = ['1:1', '4:3', '3:4', '16:9', '9:16'];
  const sourceRatio = source.width && source.height ? source.width / source.height : undefined;
  const matchingRatio = enable && sourceRatio ? ratios.find(value => {
    const [width, height] = value.split(':').map(Number);
    return Math.abs(sourceRatio / (width / height) - 1) <= .01;
  }) : undefined;
  return { ...config, imageOperation: enable ? 'edit' : 'generate', ...(matchingRatio ? { aspectRatio: matchingRatio } : {}), referenceImages: config.referenceImages.map(ref => ({ ...ref,
    ...(enable || ref.id === id ? { isEditSource: enable && ref.id === id, editScope: enable && ref.id === id ? 'image' as const : undefined, editRegion: undefined } : {}),
  })), imagePromptCategory: undefined, originalPrompt: undefined, promptPreparation: undefined,
    enhancedForMode: undefined, enhancedForImageModel: undefined, enhancedForImageContextKey: undefined };
};

/** Photo counts are distinct from identity counts; face photos are never style references. */
export const summarizeImageReferences = (references: ReferenceImage[]) => ({
  mainPersonPhotos: references.filter(ref => getPersonId(ref) === 1).length,
  secondPersonPhotos: references.filter(ref => getPersonId(ref) === 2).length,
  otherReferences: references.filter(ref => getPersonId(ref) == null).length,
  total: references.length,
});

/** Reference photos one image request can carry: GPT Image takes 16, Seedream edit 10, Nano Banana 14. */
export const imageReferenceLimit = (imageModel: string): number => isOpenAIImageModel(imageModel) ? 16 : imageModel === SEEDREAM_MODEL ? 10 : 14;

/** The error for an image request whose references exceed the model's limit or lack data, else null. */
export const imageReferenceError = (imageModel: string, references: { data?: string }[]): string | null =>
  references.length > imageReferenceLimit(imageModel) || references.some(ref => !ref.data?.trim())
    ? `Attach up to ${imageReferenceLimit(imageModel)} valid reference images.` : null;

/** Keep every draft entry point within the active model/action's image capacity. */
export const getReferenceImageLimit = (config: GenerationConfig): number => {
  if (config.mode === 'image' && config.imageModel === SEEDREAM_MODEL) return config.seedreamOptions?.mode === 'edit' ? 10 : config.seedreamOptions?.mode === 'layerize' ? 1 : 0;
  if (config.mode === 'video' && config.videoModel === MAGI2_MODEL) return getMagi2Limits(config.magi2Mode).images;
  if (config.mode === 'video' && config.videoModel === OMNI_MODEL) return config.videoOperation === 'generate' ? OMNI_LIMITS.referenceImages : 0;
  if (config.mode === 'video' && config.videoModel === 'minimax-h3' && config.videoProvider === 'evolink') {
    return config.h3MaxMode === 'reference_to_video' ? Math.max(0, Math.min(EVO_H3_CAPABILITIES.maxImages,
      EVO_H3_CAPABILITIES.maxReferences - (config.referenceVideos?.length || 0) - (config.referenceAudios?.length || 0))) : config.h3MaxMode === 'image_to_video' ? 2 : 0;
  }
  if (config.mode === 'video' && config.videoModel === 'minimax-h3') {
    const mode = getH3MaxMode(config);
    if (!isH3MaxModeAvailable(mode)) return 0;
    const frames = new Set([config.h3MaxOptions?.startImageId, config.h3MaxOptions?.middleImageId, config.h3MaxOptions?.endImageId]
      .filter(id => id && config.referenceImages.some(image => image.id === id)));
    return H3_MAX_CAPABILITIES[mode].images.max + (mode === 'reference_to_video' ? frames.size : 0);
  }
  if (config.mode === 'video' && isFalSeedanceModel(config.videoModel)) {
    const frameOnly = (config.videoOperation || 'generate') === 'generate'
      && !config.referenceVideos?.length && !config.referenceAudios?.length
      && config.referenceImages.some(image => image.isFirstFrame || image.isLastFrame);
    return frameOnly ? 2 : config.videoProvider === 'openrouter' ? 9 : config.videoProvider === 'fal' ? falSeedanceLimits(config.videoModel).images : config.videoModel === 'seedance-2.5' ? 30 : 9;
  }
  return config.mode === 'image' ? imageReferenceLimit(config.imageModel) : 14;
};
