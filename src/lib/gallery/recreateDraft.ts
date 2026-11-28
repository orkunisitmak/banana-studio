import type { GeneratedMedia, GenerationConfig, ReferenceImage, SavedPerson } from '../../types.js';
import { DEFAULT_VIDEO_MODEL, getPromptEnhancementTarget } from '../../types.js';
import { getRecreateOriginalPrompt, getRecreatePrompt } from '../prompts/promptHistory.js';
import { normalizeH3MaxDraft } from '../video/h3MaxConfig.js';
import { isSeedanceModel, seedanceDraftDuration } from '../video/seedance.js';
import { getImageOperation } from '../images/imageOperation.js';

const savedPhotoId = /^saved-person:([^:]+):(.+)$/;
const hasPixels = (ref: { data?: unknown } | null | undefined) => typeof ref?.data === 'string' && Boolean(ref.data.trim());

/** Look up only the people whose pixels are missing. Reserve exact matches
 * before assigning replacements so an earlier missing photo cannot consume a
 * later slot's exact photo. Never change a slot's identity, role, or position. */
export async function restoreRecreateReferences(
  refs: ReferenceImage[],
  loadPerson: (id: string) => Promise<SavedPerson>,
): Promise<ReferenceImage[]> {
  const people = new Map<string, number[]>();
  refs.forEach((ref, index) => {
    const match = !hasPixels(ref) && savedPhotoId.exec(ref.id);
    if (!match) return;
    const indices = people.get(match[1]);
    if (indices) indices.push(index);
    else people.set(match[1], [index]);
  });
  if (!people.size) return refs;
  const restored = [...refs];
  await Promise.all([...people].map(async ([personId, indices]) => {
    let person: SavedPerson;
    try { person = await loadPerson(personId); } catch { return; }
    if (person?.id !== personId || !Array.isArray(person.photos)) return;
    const used = new Set(refs.filter(hasPixels).map(ref => ref.data));
    const usedIds = new Set(refs.filter(hasPixels).map(ref => ref.id));
    const prefix = `saved-person:${personId}:`;
    const take = (i: number, exact: boolean) => {
      const photo = person.photos.find(p => hasPixels(p) && typeof p.id === 'string' && !used.has(p.data) && !usedIds.has(prefix + p.id)
        && (!exact || prefix + p.id === refs[i].id));
      if (!photo) return;
      used.add(photo.data);
      usedIds.add(prefix + photo.id);
      restored[i] = { ...refs[i], data: photo.data, mimeType: photo.mimeType || refs[i].mimeType };
    };
    indices.forEach(i => take(i, true));
    indices.forEach(i => { if (!hasPixels(restored[i])) take(i, false); });
  }));
  return restored;
}

export const createRecreateConfig = (media: GeneratedMedia, imageModel: GenerationConfig['imageModel']): GenerationConfig => {
  const mode = media.mediaType === 'video' ? 'video' : 'image';
  const videoModel = media.videoModel || DEFAULT_VIDEO_MODEL;
  const operation = media.videoOperation || 'generate';
  const evoH3 = videoModel === 'minimax-h3' && media.generationProvider === 'evolink';
  const duration = media.videoDuration ?? media.videoOutputDuration;
  const magi = mode === 'video' && videoModel === 'magi-2';
  const available = media.referenceImages || [];
  const manifest = (mode === 'video' ? media.videoReferenceImageIds : media.imageGenerationReferenceIds) || [];
  // Video prompts may refer directly to image numbers. Never slide the second
  // photo into the first photo's missing slot (or reorder a partial detail row).
  const referenceImages = mode === 'video' && manifest.length
    ? [...manifest.map(id => available.find(ref => ref.id === id) || { id, data: '', mimeType: 'image/png' }),
      ...available.filter(ref => !manifest.includes(ref.id))]
    : [...available];
  if (mode === 'image') {
    for (const id of manifest) {
      if (!referenceImages.some(ref => ref.id === id)) referenceImages.push({ id, data: '', mimeType: 'image/png' });
    }
  }
  const draft: GenerationConfig = {
    prompt: getRecreatePrompt(media),
    originalPrompt: mode === 'image' ? getRecreateOriginalPrompt(media) : media.originalPrompt,
    promptPreparation: media.promptPreparation,
    youtubeSource: media.youtubeSource,
    count: 1,
    // A saved video stores its quality and ratio in these columns; the image
    // controls keep their defaults so switching to Image shows valid options.
    aspectRatio: mode === 'video' ? '1:1' : media.aspectRatio,
    resolution: mode === 'video' ? '1K' : media.resolution,
    imageModel,
    imageProvider: mode === 'image' ? media.generationProvider : undefined,
    imageOperation: mode === 'image' ? getImageOperation({ imageModel, imageOperation: media.imageOperation, seedreamOptions: media.seedreamOptions, referenceImages }) : 'generate',
    seedreamOptions: media.seedreamOptions,
    openaiImageOptions: media.openaiImageOptions,
    imagePromptCategory: media.imagePromptCategory,
    referenceImages,
    referenceVideos: media.referenceVideos || [],
    referenceAudios: media.referenceAudios || [],
    mode,
    videoModel,
    videoProvider: mode === 'video' ? media.generationProvider : undefined,
    magi2Mode: magi ? media.magi2Mode ?? 'text_only' : undefined,
    falSeedanceOptions: isSeedanceModel(videoModel) ? media.falSeedanceOptions : undefined,
    h3MaxMode: videoModel === 'minimax-h3' ? media.h3MaxMode ?? (evoH3 ? 'text_to_video' : undefined) : undefined,
    h3MaxOptions: videoModel === 'minimax-h3' && !evoH3 ? media.h3MaxOptions : undefined,
    videoOperation: operation,
    videoAspectRatio: media.videoAspectRatio || (magi && media.magi2Mode === 'image_to_video' || evoH3 && media.h3MaxMode === 'reference_to_video' ? 'adaptive' : '16:9'),
    videoQuality: media.videoQuality || (magi ? '1080p' : evoH3 ? '768p' : '720p'),
    videoDuration: mode === 'video' && isSeedanceModel(videoModel)
      ? (media.generationProvider === 'fal' && duration === -1 ? -1 : seedanceDraftDuration(videoModel, operation, duration ?? 5))
      : media.videoDuration || (videoModel === 'gemini-omni-1.2-flash' ? 8 : 5),
    audioEnabled: media.audioEnabled !== false,
    videoPromptExpansionMode: media.videoPromptExpansionMode || 'balanced',
  };
  // Prepared video prompts retain their original Revert target and model/ref
  // binding. Image recreations remain directly editable without Enhance.
  const restored = mode === 'video' && draft.videoModel === 'minimax-h3' && !evoH3 ? normalizeH3MaxDraft(draft) : draft;
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
    || current.videoModel !== initial.videoModel || current.videoProvider !== initial.videoProvider
    || current.h3MaxMode !== initial.h3MaxMode || current.magi2Mode !== initial.magi2Mode) return current;
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

/** Variation rewrites the prompt and starts an image generation; there is no video variation path. */
export const canGenerateVariation = (media: GeneratedMedia): boolean => media.mediaType !== 'video';
