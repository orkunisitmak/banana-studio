import type { BrainstormCategory, BrainstormIdea, GeneratedMedia, GenerationConfig, TextModelId } from '../../types';
import type { OpenAIReasoningEffort } from '../prompts/openaiText';
import type { TextTaskOptions } from '../../services/geminiClient';
import { getOpenAIImageOptions, getOpenAIImageSize, SUNBURST_MODEL, validateOpenAIImageOptions, validateOpenAIImageSize } from '../images/openaiImage';
import { createTaskDeadline, waitForTask } from '../shared/asyncTask';
import { validateImageGenerationReferences } from '../images/imagePrompting';
import { createPromptPreparation } from '../prompts/promptPreparation';
import { MODEL_ROUTES, type AIProvider } from '../providers';
import { getReferenceImageLimit } from '../images/imageReferences';

export type BrainstormGenerationMode = 'all' | 'sample_first';
export interface BrainstormBatchState {
  id: string;
  phase: 'preparing' | 'sampling' | 'awaiting_approval' | 'generating' | 'completed' | 'failed' | 'stopped';
  total: number;
  sampleId: string;
  completed: number;
  failed: number;
  remaining: number;
  canApprove: boolean;
  imageModel: GenerationConfig['imageModel'];
  provider?: AIProvider;
}
export interface BrainstormBatchResult { completed: number; failed: number; skipped: number; stopped: boolean }

export interface BrainstormGenerationRequest {
  settings: GenerationConfig;
  category: BrainstormCategory;
  ideaCount: number;
  textModel: TextModelId;
  reasoningEffort: OpenAIReasoningEffort;
  thinkingLevel?: TextTaskOptions['thinkingLevel'];
  generationMode?: BrainstormGenerationMode;
  imageProvider?: AIProvider;
  /** Client-only owner check; never included in a provider request or saved row. */
  isCurrent?: () => boolean;
}

interface Dependencies {
  prepare: (settings: GenerationConfig, ideaCount: number, options: TextTaskOptions) => Promise<BrainstormIdea[]>;
  generate: (placeholder: GeneratedMedia, settings: GenerationConfig, folderId: string | null) => Promise<{ ok: boolean; error?: string }>;
  patch: (ids: string[], patch: Partial<GeneratedMedia>) => void;
  onPrepared?: () => void;
  onSettled?: (completed: number, failed: number) => void;
  onRemainingStart?: (placeholders: GeneratedMedia[]) => void;
  onStateChange?: (state: BrainstormBatchState) => void;
}

/** Own the accepted settings and cards independently of the Brainstorm popover. */
export const createBrainstormBatch = (request: BrainstormGenerationRequest, folderId: string | null, deps: Dependencies) => {
  const settings: GenerationConfig = structuredClone({ ...request.settings, mode: 'image', imagePromptCategory: request.category, originalPrompt: undefined, promptPreparation: undefined });
  const { ideaCount, textModel, reasoningEffort, thinkingLevel } = request;
  const generationMode = request.generationMode || 'all';
  if (generationMode !== 'all' && generationMode !== 'sample_first') throw new Error('Geçerli bir Brainstorm üretim yöntemi seç.');
  const staged = generationMode === 'sample_first';
  settings.imageProvider = request.imageProvider || settings.imageProvider;
  if (staged && (!settings.imageProvider || !MODEL_ROUTES[settings.imageModel]?.includes(settings.imageProvider))) {
    throw new Error('Önce kullanılabilir bir görsel sağlayıcısı seç.');
  }
  if (!Number.isInteger(ideaCount) || ideaCount < 1 || ideaCount > 20 || !Number.isInteger(settings.count) || settings.count < 1 || settings.count > 10) {
    throw new Error('Choose 1–20 ideas and 1–10 images per idea.');
  }
  if (request.category === 'simple' || settings.youtubeSource ? !settings.prompt.trim() && !settings.referenceImages.length : !settings.referenceImages.length) {
    throw new Error('Add a concept or the required reference images first.');
  }
  validateImageGenerationReferences(settings);
  if (settings.referenceImages.length > getReferenceImageLimit(settings)) throw new Error('Seçili model için fazla referans görsel var.');
  if (settings.imageModel === SUNBURST_MODEL) {
    const error = validateOpenAIImageOptions(getOpenAIImageOptions(settings.openaiImageOptions)) || validateOpenAIImageSize(getOpenAIImageSize(settings));
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
  const initialPlaceholders = staged ? placeholders.slice(0, 1) : placeholders;
  let phase: BrainstormBatchState['phase'] = 'preparing';
  let cancelled = false;
  let completed = 0, failed = 0, submitted = 0, sampleViewed = false, approvalRequested = false;
  let pending: Promise<BrainstormBatchResult> | undefined;
  let resolveApproval: (approved: boolean) => void;
  const approval = new Promise<boolean>(resolve => { resolveApproval = resolve; });
  const isCurrent = () => {
    try { return !staged || request.isCurrent?.() !== false; } catch { return false; }
  };
  const snapshot = (): BrainstormBatchState => ({ id, phase, total: placeholders.length, sampleId: placeholders[0].id,
    completed, failed, remaining: placeholders.length - submitted,
    imageModel: settings.imageModel, provider: settings.imageProvider,
    canApprove: phase === 'awaiting_approval' && sampleViewed && !approvalRequested && !cancelled });
  const publish = () => {
    // A presentation callback must not change which paid requests are accepted.
    try { deps.onStateChange?.(snapshot()); } catch { /* Owner can still stop the batch. */ }
  };
  const settle = () => {
    try { deps.onSettled?.(completed, failed); } catch { /* Keep accepted jobs independent of presentation. */ }
  };
  const cancel = () => {
    if (phase !== 'preparing' && !(staged && submitted <= 1 && !['completed', 'failed', 'stopped'].includes(phase))) return false;
    const wasPreparing = phase === 'preparing';
    cancelled = true;
    phase = 'stopped';
    if (wasPreparing) task?.abort(new Error('Brainstorm cancelled. No image generation was started.'));
    resolveApproval!(false);
    publish();
    return true;
  };
  const stopIfObsolete = () => {
    if (!cancelled && !isCurrent()) cancel();
    return cancelled;
  };
  const execute = async () => {
    task = createTaskDeadline(330_000, undefined, 'Brainstorm timed out. No image generation was started.');
    if (cancelled) task.abort(new Error('Brainstorm cancelled. No image generation was started.'));
    publish();
    try {
      stopIfObsolete();
      task.signal.throwIfAborted();
      const ideas = await waitForTask(deps.prepare(settings, ideaCount, { model: textModel, reasoningEffort, thinkingLevel, signal: task.signal }), task.signal);
      task.check();
      task.signal.throwIfAborted();
      // A partial/malformed text response must not silently bill a different batch.
      if (ideas.length !== ideaCount || ideas.some(idea => !idea.text?.trim())) throw new Error('The model did not return all requested ideas. No image generation was started.');
      const promptPreparation = createPromptPreparation('brainstorm', { model: textModel, reasoningEffort, thinkingLevel });
      task.dispose();
      if (stopIfObsolete()) return;
      phase = staged && placeholders.length > 1 ? 'sampling' : 'generating';
      publish();
      deps.onPrepared?.();
      const generateOne = async (placeholder: GeneratedMedia, index: number) => {
        const prompt = ideas[Math.floor(index / settings.count)].text;
        const patch = { prompt, originalPrompt: settings.prompt, promptPreparation, imageStage: 'generating' as const, brainstormBatchId: undefined, status: 'processing' as const };
        deps.patch([placeholder.id], patch);
        submitted++;
        try {
          const result = await deps.generate({ ...placeholder, ...patch }, { ...settings, prompt, originalPrompt: settings.prompt, promptPreparation }, folderId);
          if (!result.ok) throw new Error(result.error || 'Image generation failed.');
          completed++;
        } catch (error) {
          failed++;
          deps.patch([placeholder.id], { isLoading: false, status: 'failed', imageStage: undefined, imageProgress: undefined, error: error instanceof Error ? error.message : 'Image generation failed.' });
        }
        settle();
      };
      if (stopIfObsolete()) return;
      if (staged && placeholders.length > 1) {
        await generateOne(placeholders[0], 0);
        if (stopIfObsolete() || failed) return;
        phase = 'awaiting_approval';
        publish();
        if (!await approval || stopIfObsolete()) return;
        phase = 'generating';
        publish();
        const remaining = placeholders.slice(1);
        deps.onRemainingStart?.(remaining);
        await Promise.all(remaining.map((placeholder, index) => generateOne(placeholder, index + 1)));
      } else {
        await Promise.all(placeholders.map(generateOne));
      }
    } catch (error) {
      if (submitted) {
        // A failed remainder handoff must preserve the completed sample.
        cancelled = true;
      } else {
        failed = initialPlaceholders.length;
        deps.patch(initialPlaceholders.map(item => item.id), { isLoading: false, status: 'failed', imageStage: 'preparing', brainstormBatchId: undefined, promptPreparation: undefined, error: error instanceof Error ? error.message : 'Brainstorm failed.' });
        settle();
      }
    } finally {
      task.dispose();
      if (cancelled && !submitted && !failed) {
        failed = initialPlaceholders.length;
        deps.patch(initialPlaceholders.map(item => item.id), { isLoading: false, status: 'failed', imageStage: undefined,
          brainstormBatchId: undefined, error: 'Taslak değişti veya Brainstorm durduruldu. Görsel üretimi başlatılmadı.' });
        settle();
      }
      phase = cancelled ? 'stopped' : failed ? 'failed' : 'completed';
      publish();
    }
  };
  const finish = async (): Promise<BrainstormBatchResult> => {
    await execute();
    return { completed, failed, skipped: placeholders.length - completed - failed, stopped: cancelled };
  };
  return {
    id, placeholders, initialPlaceholders, generationMode,
    get snapshot() { return snapshot(); },
    run: () => pending ||= finish(), // A repeated callback must not submit twice.
    check: () => { if (phase === 'preparing') task?.check(); stopIfObsolete(); },
    cancel,
    markSampleViewed: (viewed = true) => {
      if (!['sampling', 'awaiting_approval'].includes(phase) || stopIfObsolete()) return;
      sampleViewed = viewed; publish();
    },
    approve: () => {
      if (stopIfObsolete() || !snapshot().canApprove) return false;
      approvalRequested = true; // Lock before resolving: repeated click callbacks are harmless.
      publish(); resolveApproval!(true); return true;
    },
  };
};
