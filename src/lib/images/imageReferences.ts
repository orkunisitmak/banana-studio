import { getPersonId } from '../references/personReferences';
import { SUNBURST_MODEL } from './openaiImage';
import { H3_MAX_CAPABILITIES, isH3MaxModeAvailable } from '../video/h3Max';
import { getH3MaxMode } from '../video/h3MaxConfig';
import type { GenerationConfig, ReferenceImage } from '../../types';

/** Photo counts are distinct from identity counts; face photos are never style references. */
export const summarizeImageReferences = (references: ReferenceImage[]) => ({
  mainPersonPhotos: references.filter(ref => getPersonId(ref) === 1).length,
  secondPersonPhotos: references.filter(ref => getPersonId(ref) === 2).length,
  otherReferences: references.filter(ref => getPersonId(ref) == null).length,
  total: references.length,
});

/** Reference photos one image request can carry: GPT Image 2.5 takes 16, Nano Banana 14. */
export const imageReferenceLimit = (imageModel: string): number => imageModel === SUNBURST_MODEL ? 16 : 14;

/** The error for an image request whose references exceed the model's limit or lack data, else null. */
export const imageReferenceError = (imageModel: string, references: { data?: string }[]): string | null =>
  references.length > imageReferenceLimit(imageModel) || references.some(ref => !ref.data)
    ? `Attach up to ${imageReferenceLimit(imageModel)} valid reference images.` : null;

/** Keep every draft entry point within the active model/action's image capacity. */
export const getReferenceImageLimit = (config: GenerationConfig): number => {
  if (config.mode === 'video' && config.videoModel === 'minimax-h3') {
    const mode = getH3MaxMode(config);
    if (!isH3MaxModeAvailable(mode)) return 0;
    const frames = new Set([config.h3MaxOptions?.startImageId, config.h3MaxOptions?.middleImageId, config.h3MaxOptions?.endImageId]
      .filter(id => id && config.referenceImages.some(image => image.id === id)));
    return H3_MAX_CAPABILITIES[mode].images.max + (mode === 'reference_to_video' ? frames.size : 0);
  }
  if (config.mode === 'video' && config.videoModel === 'seedance-2.5') {
    const frameOnly = (config.videoOperation || 'generate') === 'generate'
      && !config.referenceVideos?.length && !config.referenceAudios?.length
      && config.referenceImages.some(image => image.isFirstFrame || image.isLastFrame);
    return frameOnly ? 2 : 30;
  }
  if (config.mode === 'video' && config.videoModel === 'seedance-2.0') return 9;
  return config.mode === 'image' ? imageReferenceLimit(config.imageModel) : 14;
};
