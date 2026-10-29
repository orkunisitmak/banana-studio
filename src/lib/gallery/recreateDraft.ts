import type { GeneratedMedia, GenerationConfig } from '../../types.js';
import { DEFAULT_VIDEO_MODEL, getPromptEnhancementTarget } from '../../types.js';
import { getRecreateOriginalPrompt, getRecreatePrompt } from '../prompts/promptHistory.js';
import { normalizeH3MaxDraft } from '../video/h3MaxConfig.js';

export const createRecreateConfig = (media: GeneratedMedia, imageModel: GenerationConfig['imageModel']): GenerationConfig => {
  const mode = media.mediaType === 'video' ? 'video' : 'image';
  const referenceImages = [...(media.referenceImages || [])];
  // Keep unavailable saved input slots visible and unresolved. A failed detail
  // read must not silently turn an identity-based recreation into a no-ref job.
  if (mode === 'image') {
    for (const id of media.imageGenerationReferenceIds || []) {
      if (!referenceImages.some(reference => reference.id === id)) {
        referenceImages.push({ id, data: '', mimeType: 'image/png' });
      }
    }
  }
  const draft: GenerationConfig = {
    prompt: getRecreatePrompt(media),
    originalPrompt: mode === 'image' ? getRecreateOriginalPrompt(media) : media.originalPrompt,
    promptPreparation: media.promptPreparation,
    youtubeSource: media.youtubeSource,
    count: 1,
    aspectRatio: media.aspectRatio,
    resolution: media.resolution,
    imageModel,
    openaiImageOptions: media.openaiImageOptions,
    imagePromptCategory: media.imagePromptCategory,
    // Re-create with the local model repeats the recorded seed and negative prompt.
    ...(imageModel === 'local-image' && mode === 'image' ? { localSeed: media.localSeed, localNegativePrompt: media.localNegativePrompt } : {}),
    referenceImages,
    referenceVideos: media.referenceVideos || [],
    referenceAudios: media.referenceAudios || [],
    mode,
    videoModel: media.videoModel || DEFAULT_VIDEO_MODEL,
    h3MaxMode: media.h3MaxMode,
    h3MaxOptions: media.h3MaxOptions,
    videoOperation: media.videoOperation || 'generate',
    videoAspectRatio: media.videoAspectRatio || '16:9',
    videoQuality: media.videoQuality || '720p',
    videoDuration: media.videoDuration || 5,
    audioEnabled: media.audioEnabled !== false,
    videoPromptExpansionMode: media.videoPromptExpansionMode || 'balanced',
  };
  // Prepared video prompts retain their original Revert target and model/ref
  // binding. Image recreations remain directly editable without Enhance.
  const restored = mode === 'video' && draft.videoModel === 'minimax-h3' ? normalizeH3MaxDraft(draft) : draft;
  return {
    ...restored,
    ...(mode === 'video' && restored.originalPrompt != null ? getPromptEnhancementTarget(restored) : {}),
  };
};

/** Complete a lazy recreation without replacing edits made while it loaded. */
export const mergeRecreateHydration = (
  current: GenerationConfig,
  initial: GenerationConfig,
  hydrated: GenerationConfig,
): GenerationConfig => {
  if (current.mode !== initial.mode || current.imageModel !== initial.imageModel
    || current.videoModel !== initial.videoModel || current.h3MaxMode !== initial.h3MaxMode) return current;
  if (initial.prompt.trim() && !current.prompt.trim()
    && current.referenceImages.length === 0
    && (current.referenceVideos?.length || 0) === 0
    && (current.referenceAudios?.length || 0) === 0) return current;
  const next = { ...current };
  for (const key of Object.keys(hydrated) as (keyof GenerationConfig)[]) {
    if (JSON.stringify(current[key]) === JSON.stringify(initial[key])) {
      (next as unknown as Record<string, unknown>)[key] = hydrated[key];
    }
  }
  return next;
};
