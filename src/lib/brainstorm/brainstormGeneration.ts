import type { BrainstormCategory, BrainstormIdea, GeneratedMedia, GenerationConfig, TextModelId } from '../../types';
import type { OpenAIReasoningEffort } from '../prompts/openaiText';
import type { TextTaskOptions } from '../../services/geminiClient';
import { getOpenAIImageOptions, getOpenAIImageSize, SUNBURST_MODEL, validateOpenAIImageOptions, validateOpenAIImageSize } from '../images/openaiImage';
import { createTaskDeadline, waitForTask } from '../shared/asyncTask';
import { validateImageGenerationReferences } from '../images/imagePrompting';
import { createPromptPreparation } from '../prompts/promptPreparation';

export interface BrainstormGenerationRequest {
  settings: GenerationConfig;
  category: BrainstormCategory;
  ideaCount: number;
  textModel: TextModelId;
  reasoningEffort: OpenAIReasoningEffort;
  thinkingLevel?: TextTaskOptions['thinkingLevel'];
}

interface Dependencies {
  prepare: (settings: GenerationConfig, ideaCount: number, options: TextTaskOptions) => Promise<BrainstormIdea[]>;
  generate: (placeholder: GeneratedMedia, settings: GenerationConfig, folderId: string | null) => Promise<{ ok: boolean; error?: string }>;
  patch: (ids: string[], patch: Partial<GeneratedMedia>) => void;
  onPrepared?: () => void;
  onSettled?: (completed: number, failed: number) => void;
}

/** Own the accepted settings and cards independently of the Brainstorm popover. */
export const createBrainstormBatch = (request: BrainstormGenerationRequest, folderId: string | null, deps: Dependencies) => {
  const settings: GenerationConfig = structuredClone({ ...request.settings, mode: 'image', imagePromptCategory: request.category, originalPrompt: undefined, promptPreparation: undefined });
  const { ideaCount, textModel, reasoningEffort, thinkingLevel } = request;
  if (!Number.isInteger(ideaCount) || ideaCount < 1 || ideaCount > 20 || !Number.isInteger(settings.count) || settings.count < 1 || settings.count > 10) {
    throw new Error('Choose 1–20 ideas and 1–10 images per idea.');
  }
  if (request.category === 'simple' || settings.youtubeSource ? !settings.prompt.trim() && !settings.referenceImages.length : !settings.referenceImages.length) {
    throw new Error('Add a concept or the required reference images first.');
  }
  validateImageGenerationReferences(settings);
  if (settings.imageModel === SUNBURST_MODEL) {
    const error = validateOpenAIImageOptions(getOpenAIImageOptions(settings.openaiImageOptions)) || validateOpenAIImageSize(getOpenAIImageSize(settings), settings.imageProvider);
    if (error) throw new Error(error);
  }
  const id = `brainstorm-${crypto.randomUUID()}`;
  const createdAt = Date.now();
  const placeholders: GeneratedMedia[] = Array.from({ length: ideaCount * settings.count }, (_, index) => ({
    id: `${id}-${index}`, url: '', prompt: settings.prompt, aspectRatio: settings.aspectRatio, resolution: settings.resolution,
    imageModel: settings.imageModel, referenceImages: settings.referenceImages, imagePromptCategory: request.category,
    youtubeSource: settings.youtubeSource,
    openaiImageOptions: settings.imageModel === SUNBURST_MODEL ? getOpenAIImageOptions(settings.openaiImageOptions) : undefined,
    imageRequestedSize: settings.imageModel === SUNBURST_MODEL ? getOpenAIImageSize(settings) : undefined,
    createdAt, folderId, isLoading: true, isFavorite: false, mediaType: 'image', status: 'pending',
    imageStage: 'preparing', brainstormBatchId: id,
  }));
  let task: ReturnType<typeof createTaskDeadline> | undefined;
  let preparing = true;
  let cancelled = false;
  let pending: Promise<{ completed: number; failed: number }> | undefined;
  const execute = async () => {
    let completed = 0;
    let failed = 0;
    task = createTaskDeadline(330_000, undefined, 'Brainstorm timed out. No image generation was started.');
    if (cancelled) task.abort(new Error('Brainstorm cancelled. No image generation was started.'));
    try {
      task.signal.throwIfAborted();
      const ideas = await waitForTask(deps.prepare(settings, ideaCount, { model: textModel, reasoningEffort, thinkingLevel, signal: task.signal }), task.signal);
      task.check();
      task.signal.throwIfAborted();
      // A partial/malformed text response must not silently bill a different batch.
      if (ideas.length !== ideaCount || ideas.some(idea => !idea.text?.trim())) throw new Error('The model did not return all requested ideas. No image generation was started.');
      const promptPreparation = createPromptPreparation('brainstorm', { model: textModel, reasoningEffort, thinkingLevel });
      preparing = false;
      task.dispose();
      deps.onPrepared?.();
      await Promise.all(placeholders.map(async (placeholder, index) => {
        const prompt = ideas[Math.floor(index / settings.count)].text;
        const patch = { prompt, originalPrompt: settings.prompt, promptPreparation, imageStage: 'generating' as const, brainstormBatchId: undefined, status: 'processing' as const };
        deps.patch([placeholder.id], patch);
        try {
          const result = await deps.generate({ ...placeholder, ...patch }, { ...settings, prompt, originalPrompt: settings.prompt, promptPreparation }, folderId);
          if (!result.ok) throw new Error(result.error || 'Image generation failed.');
          completed++;
        } catch (error) {
          failed++;
          deps.patch([placeholder.id], { isLoading: false, status: 'failed', imageStage: undefined, imageProgress: undefined, error: error instanceof Error ? error.message : 'Image generation failed.' });
        }
        deps.onSettled?.(completed, failed);
      }));
    } catch (error) {
      failed = placeholders.length;
      deps.patch(placeholders.map(item => item.id), { isLoading: false, status: 'failed', imageStage: 'preparing', brainstormBatchId: undefined, promptPreparation: undefined, error: error instanceof Error ? error.message : 'Brainstorm failed.' });
      deps.onSettled?.(0, failed);
    } finally { preparing = false; task.dispose(); }
    return { completed, failed };
  };
  return {
    id, placeholders,
    run: () => pending ||= execute(), // A repeated callback must not submit twice.
    check: () => task?.check(),
    cancel: () => { if (preparing) { cancelled = true; task?.abort(new Error('Brainstorm cancelled. No image generation was started.')); } },
  };
};
