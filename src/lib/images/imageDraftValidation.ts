import type { GenerationConfig } from '../../types';
import { imageReferenceError } from './imageReferences';
import { getImageOperation, resolveImageOperation } from './imageOperation';
import { validateImageGenerationReferences } from './imagePrompting';
import { getOpenAIImageOptions, getOpenAIImageSize, getSunburstReferences, isOpenAIImageModel, getOpenAIImageOutputError, validateOpenAIImageOptions, validateOpenAIImageSize } from './openaiImage';

/** Validate the exact image draft before paying for a generation or a text preparation call. */
export function resolveImageDraft(draft: GenerationConfig, preparingIdeas = false): GenerationConfig {
  const resolved = resolveImageOperation(draft);
  const referenceError = imageReferenceError(resolved.imageModel, resolved.referenceImages);
  if (referenceError) throw new Error(referenceError);
  validateImageGenerationReferences(resolved, preparingIdeas);
  if (isOpenAIImageModel(resolved.imageModel)) {
    const options = getOpenAIImageOptions(resolved.openaiImageOptions, resolved.imageModel);
    const error = validateOpenAIImageOptions(options, resolved.imageModel) || validateOpenAIImageSize(getOpenAIImageSize(resolved), options.outputFormat)
      || getOpenAIImageOutputError(options, getImageOperation(resolved), getSunburstReferences(resolved.referenceImages).length);
    if (error) throw new Error(error);
  }
  if (!Number.isInteger(resolved.count) || resolved.count < 1 || resolved.count > 10) throw new Error('Choose 1–10 image requests.');
  if (!preparingIdeas && !resolved.prompt.trim() && (isOpenAIImageModel(resolved.imageModel) || !resolved.referenceImages.length)) throw new Error('Enter a prompt to generate an image.');
  return resolved;
}
