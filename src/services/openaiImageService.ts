import { selectProvider } from './providerRouting';
import type { GeneratedMedia, GenerationConfig } from '../types';
import { normalizePromptPreparation } from '../lib/prompts/promptPreparation';
import { withoutLegacyMask } from '../lib/references/referenceImages';
import { getOpenAIImageOptions, getOpenAIImageSize, getSunburstReferences, SUNBURST_MODEL, validateOpenAIImageOptions, validateOpenAIImageSize } from '../lib/images/openaiImage';
import { supabase, getSession } from './authService';
import { isTransientReadError } from '../lib/shared/transientRead';
import { getImageById, uploadBase64ToPublicUrl, refreshMediaAccessUrl } from './storageService';
import { estimateImageProgress } from '../lib/images/imageProgress';
import { createReferenceUploader } from '../lib/references/referenceUploadCache';
import type { Session } from '@supabase/supabase-js';
import { validateImageGenerationReferences } from '../lib/images/imagePrompting';
import { imageGenerationQueue, type ImageSubmissionStage } from '../lib/images/imageGenerationQueue';

export type ImageGenerationContext = { id: string; folderId?: string | null; onStage?: (stage: ImageSubmissionStage, waitReason?: 'rate'|'quota') => void };

let refreshingImageSession: Promise<Session | null> | null = null;
const getImageSession = async (): Promise<Session> => {
  let session = await getSession();
  // Refresh before acceptance so authorization and private-reference checks
  // complete with a current session. The worker never stores this credential.
  if (session?.expires_at && session.expires_at < Date.now() / 1000 + 360) {
    if (!refreshingImageSession) {
      refreshingImageSession = supabase.auth.refreshSession().then(({ data, error }) => {
        if (error) throw new Error('Your session could not be refreshed. Sign in again before generating.');
        return data.session;
      }).finally(() => { refreshingImageSession = null; });
    }
    session = await refreshingImageSession;
    if (session?.expires_at && session.expires_at < Date.now() / 1000 + 330) {
      throw new Error('Your session expires too soon to safely save this image. Sign in again before generating.');
    }
  }
  if (!session?.access_token) throw new Error('Sign in before generating an image.');
  return session;
};

const assertImageSession = async (userId: string | undefined): Promise<void> => {
  const session = await getSession();
  if (!session || session.user?.id !== userId) throw new Error('Session changed. Sign in again to continue.');
};

/** Recover storage and metadata only; never invoke the paid generation endpoint. */
export const recoverOpenAIImage = async (media: GeneratedMedia): Promise<GeneratedMedia> => {
  const session = await getImageSession();
  const response = await fetch('/api/openai-image-recover', {
    method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: media.id }),
  });
  const data = await response.json().catch(() => null);
  await assertImageSession(session.user?.id);
  if (!response.ok || !data?.url) throw new Error(data?.error || 'Saved image recovery failed. Try again shortly.');
  return { ...media, ...data.metadata, url: data.url, storagePath: data.storagePath, status: 'completed', error: undefined, isLoading: false, imageProgress: undefined };
};

const uploadReference = createReferenceUploader(
  (data, mime, prefix) => uploadBase64ToPublicUrl(data, mime, prefix, { throwOnError: true }),
  refreshMediaAccessUrl,
);
const activeImageJobs = new Map<string, Promise<GeneratedMedia>>();

/** Only polls saved state; never resubmits a paid Images API request. */
export const resumeOpenAIImage = async (
  pending: GeneratedMedia, onProgress?: (progress: number) => void, onStage?: ImageGenerationContext['onStage'],
): Promise<GeneratedMedia> => {
  let session: Session;
  for (let attempt = 1; ; attempt++) {
    try { session = await getImageSession(); break; }
    catch (error) {
      if (!isTransientReadError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(30_000, attempt * 3000)));
    }
  }
  const deadline = (pending.openaiStartedAt || pending.createdAt) + 330_000;
  let missingDeadline = Date.now() + 30_000;
  let readFailures = 0;
  if (!pending.imageQueue) onProgress?.(estimateImageProgress(pending.openaiStartedAt || pending.createdAt));
  for (;;) {
    let saved: GeneratedMedia | null;
    try {
      await assertImageSession(session.user?.id);
      saved = await getImageById(pending.id, undefined, { requireRemote: true });
      await assertImageSession(session.user?.id);
      readFailures = 0;
    } catch (error) {
      if (!isTransientReadError(error)) throw error;
      // Read interruptions say nothing about the paid job. Reconnect to this
      // same ID, retaining its last visible stage, even after a long outage.
      missingDeadline = Date.now() + 30_000;
      await new Promise(resolve => setTimeout(resolve, Math.min(30_000, 3000 * ++readFailures)));
      continue;
    }
    if (saved?.status === 'completed' && saved.url) {
      onProgress?.(1);
      return { ...saved, isLoading: false, imageStage: undefined, imageProgress: undefined };
    }
    if (saved?.status === 'failed') throw new Error(saved.error || 'OpenAI image generation failed.');
    const durable = saved?.imageQueue?.version === 1 || pending.imageQueue?.version === 1;
    if (!saved && durable && Date.now() > missingDeadline) throw new Error('The saved image job could not be found. Refresh the gallery before submitting again.');
    if (durable && (!saved || saved.status === 'pending')) {
      onStage?.('queued',saved?.imageQueueWaitReason);
    } else {
      onStage?.('generating');
      onProgress?.(estimateImageProgress(saved?.openaiStartedAt || pending.openaiStartedAt || pending.createdAt));
    }
    if (!durable && Date.now() > deadline) break;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('OpenAI generation could not be recovered. Check provider usage before generating again.');
};

/** The eight browser slots cover only preparation/enqueue, never image rendering.
 * Every accepted job lives in the server outbox before this starts polling. */
export const generateOpenAIImage = async (
  config: GenerationConfig,
  prompt: string,
  context?: ImageGenerationContext,
  onProgress?: (progress: number) => void,
): Promise<GeneratedMedia> => {
  config = structuredClone(config);
  config.imageProvider = config.imageProvider || await selectProvider(config.imageModel);
  validateImageGenerationReferences({ ...config, prompt });
  const options = getOpenAIImageOptions(config.imageModel === SUNBURST_MODEL ? config.openaiImageOptions : undefined);
  const optionError = validateOpenAIImageOptions(options) || validateOpenAIImageSize(getOpenAIImageSize({ ...config, openaiImageOptions: options }));
  if (optionError) throw new Error(optionError);
  const refs = getSunburstReferences(config.referenceImages || []);
  if (refs.length > (config.imageModel === SUNBURST_MODEL ? 16 : 14) || refs.some(ref => !ref.data)) throw new Error('Attach up to 16 valid reference images.');
  const initialSession = await getImageSession();
  const owner = initialSession.user?.id;
  const id = context?.id || crypto.randomUUID();
  const jobKey = JSON.stringify([owner || initialSession.access_token, id]);
  const existingJob = activeImageJobs.get(jobKey);
  if (existingJob) return existingJob;
  const work = (async () => {
    const pending: GeneratedMedia = { id, url: '', prompt: config.prompt, originalPrompt: config.originalPrompt,
      createdAt: Date.now(), imageQueue: { version: 1, queuedAt: Date.now() }, imageStage: 'queued', status: 'pending',
      mediaType: 'image', imageModel: config.imageModel, aspectRatio: config.aspectRatio, resolution: config.resolution,
      folderId: context?.folderId, referenceImages: refs };
    const accepted = await imageGenerationQueue.run(initialSession.user?.id || initialSession.access_token, id, async () => {
      await assertImageSession(owner);
      let session = await getImageSession();
      const referenceImages = await Promise.all(refs.map(async ref => {
        await assertImageSession(owner);
        return { ...withoutLegacyMask(ref), data: await uploadReference(ref.data, ref.mimeType, 'openai_ref', session.user?.id || session.access_token) };
      }));
      session = await getImageSession();
      if (session.user?.id !== owner) throw new Error('Session changed before image submission.');
      let response: Response;
      try {
        response = await fetch('/api/openai-image-enqueue', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          // The enqueue function stops at 60 s. A request still open after that
          // takes the reconnect path below, so the card cannot stay preparing.
          signal: AbortSignal.timeout(75_000),
          body: JSON.stringify({ id, model: config.imageModel, provider: config.imageProvider, prompt, displayPrompt: config.prompt,
            originalPrompt: config.originalPrompt, promptPreparation: normalizePromptPreparation(config.promptPreparation), youtubeSource: config.youtubeSource,
            aspectRatio: config.aspectRatio, resolution: config.resolution, imagePromptCategory: config.imagePromptCategory,
            options, referenceImages, folderId: context?.folderId }),
        });
      } catch {
        // The enqueue transaction may have committed. Reconnect to its saved ID;
        // neither this request nor a page reload may create another generation.
        await assertImageSession(owner);
        return pending;
      }
      const data = await response.json().catch(() => null);
      await assertImageSession(owner);
      if (response.status === 202 && data?.durable === true && data.id === id) return pending;
      // A 202 whose body could not be read (e.g. the timeout fired mid-body) was still accepted.
      if ((!data && (response.status === 202 || response.status >= 500)) || data?.code === 'QUEUE_STATE_UNKNOWN' || (response.status === 409 && data?.code === 'GENERATION_EXISTS')) return pending;
      throw new Error(data?.error || `Image queue request failed (${response.status}). Check the gallery before submitting again.`);
    }, () => context?.onStage?.('preparing'));
    context?.onStage?.('queued');
    return resumeOpenAIImage(accepted, onProgress, context?.onStage);
  })();
  activeImageJobs.set(jobKey, work);
  try { return await work; } finally { activeImageJobs.delete(jobKey); }
};
