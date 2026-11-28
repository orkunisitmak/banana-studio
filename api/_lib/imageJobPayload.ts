import { chooseProvider } from './providerConfiguration.js';
import { isSecureReferenceUrl } from './providerMedia.js';
import type { ReferenceImage } from '../../src/types.js';
import { getPersonId, cleanPersonName, normalizeReferencePrompt } from '../../src/lib/references/personReferences.js';
import { getOpenAIImageOptions, getOpenAIImageSize, getOpenAIImageOutputError, validateOpenAIImageOptions, validateOpenAIImageSize, isOpenAIImageModel, RECOVERABLE_IMAGE_MODELS } from '../../src/lib/images/openaiImage.js';
import { getRequestedImageOperation, resolveImageOperation } from '../../src/lib/images/imageOperation.js';
import { DEFAULT_SEEDREAM_OPTIONS, getSeedreamDraftError, SEEDREAM_MODEL } from '../../src/lib/images/seedream55.js';
import { prepareSunburstGeneration, supportsWholeImageEdit } from '../../src/lib/images/imagePrompting.js';
import { copyEditRegion, isValidEditRegion } from '../../src/lib/images/imageEditRegion.js';
import { normalizePromptPreparation } from '../../src/lib/prompts/promptPreparation.js';
import { normalizeYouTubeSource } from '../../src/lib/youtube/youtubeSource.js';
import { canonicalMediaUrl, signedMediaUrl } from './imageStorage.js';
import { MediaAccessError } from '../../src/lib/references/mediaAccess.js';

export class ImageJobInputError extends Error {}
const invalid = (message: string): never => { throw new ImageJobInputError(message); };
const projectOrigin = () => new URL(process.env.SUPABASE_URL || '').origin;

export const privateReferencePath = (value: string): string | null => {
  const url = new URL(value);
  if (url.origin !== projectOrigin()) return null;
  const match = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated|sign|public)\/media\/(.+)$/);
  const path = match ? decodeURIComponent(match[1]) : '';
  if (!path || path.split('/').some(part => !part || part === '.' || part === '..')) invalid('Invalid private reference path.');
  return path;
};

/** Whitelist the immutable snapshot. No authorization header, JWT or client
 * worker/claim flags are copied into durable storage. */
export const prepareImageJobPayload = async (body: any, callerDb: any) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Invalid image job.');
  const seedream = body.model === SEEDREAM_MODEL;
  if ((!seedream && !RECOVERABLE_IMAGE_MODELS.includes(body.model)) || typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.id)) invalid('Invalid image job ID or model.');
  if (seedream && body.seedreamOptions != null && (typeof body.seedreamOptions !== 'object' || Array.isArray(body.seedreamOptions) || Object.keys(body.seedreamOptions).some(key => !Object.hasOwn(DEFAULT_SEEDREAM_OPTIONS,key)))) invalid('Invalid Seedream options.');
  const seedreamOptions = seedream ? { ...DEFAULT_SEEDREAM_OPTIONS, ...body.seedreamOptions } : undefined;
  if (typeof body.prompt !== 'string' || (!body.prompt.trim() && seedreamOptions?.mode !== 'layerize') || body.prompt.length > 32000) invalid('A prompt of up to 32,000 characters is required except for layer extraction.');
  if (!['1:1','4:3','3:4','16:9','9:16'].includes(body.aspectRatio) || !['1K','2K','4K'].includes(body.resolution)) invalid('Invalid ratio or resolution.');
  if (body.options != null && (typeof body.options !== 'object' || Array.isArray(body.options))) invalid('Invalid image options.');
  let provider;
  try { provider = chooseProvider(body.model, body.provider); } catch (error) { return invalid((error as Error).message); }
  const options = getOpenAIImageOptions(isOpenAIImageModel(body.model) ? body.options : undefined, body.model);
  const optionError = validateOpenAIImageOptions(options, body.model) || validateOpenAIImageSize(getOpenAIImageSize({ ...body, openaiImageOptions: options }), options.outputFormat);
  if (optionError) invalid(optionError);
  if (body.originalPrompt != null && (typeof body.originalPrompt !== 'string' || body.originalPrompt.length > 32000)) invalid('Invalid original prompt.');
  if (body.imagePromptCategory != null && !['simple','youtube_thumbnail','product_shot','portrait','social_media','custom'].includes(body.imagePromptCategory)) invalid('Invalid image category.');
  if (body.folderId != null && (typeof body.folderId !== 'string' || body.folderId.length > 200)) invalid('Invalid folder.');
  const references = body.referenceImages ?? [];
  if (!Array.isArray(references) || references.length > (isOpenAIImageModel(body.model) ? 16 : seedream ? 10 : 14) || body.mask != null || body.maskUrl != null) invalid('Invalid reference images.');
  let refs: ReferenceImage[] = references.map((ref: any) => {
    if (!ref || typeof ref.id !== 'string' || !ref.id || ref.id.length > 128 || typeof ref.data !== 'string' || ref.data.length > 4000) invalid('Invalid reference image.');
    let url: URL;
    try { url = new URL(ref.data); } catch { return invalid('References must use HTTPS.'); }
    if (!isSecureReferenceUrl(url) || url.username || url.password || ref.mask != null) invalid('References must use HTTPS without embedded credentials.');
    if (ref.personId != null && (!Number.isInteger(ref.personId) || ref.personId < 1 || ref.personId > 9999)) invalid('Invalid person group.');
    if (ref.personName != null && (typeof ref.personName !== 'string' || ref.personName.length > 40)) invalid('Invalid person name.');
    for (const role of ['isSubjectImage','isSecondPerson','isDraftImage','isVideoContext','isEditSource','isThumbnailStyle']) {
      if (ref[role] != null && typeof ref[role] !== 'boolean') invalid('Invalid reference role.');
    }
    if (ref.editRegion != null && !isValidEditRegion(ref.editRegion)) invalid('Invalid edit area.');
    if (ref.editScope != null && ref.editScope !== 'image') invalid('Invalid edit scope.');
    return { id: ref.id, data: canonicalMediaUrl(ref.data), mimeType: typeof ref.mimeType === 'string' ? ref.mimeType.slice(0,100) : 'image/png',
      personId: getPersonId(ref), personName: cleanPersonName(ref.personName || '') || undefined,
      isSubjectImage: getPersonId(ref)===1, isSecondPerson: getPersonId(ref)===2, isDraftImage: !!ref.isDraftImage,
      isVideoContext: !!ref.isVideoContext, isEditSource: !!ref.isEditSource, isThumbnailStyle: !!ref.isThumbnailStyle,
      ...(ref.editScope === 'image' ? { editScope: 'image' as const } : {}),
      ...(ref.editRegion ? { editRegion: copyEditRegion(ref.editRegion) } : {}) };
  });
  if (new Set(refs.map(ref=>ref.id)).size !== refs.length) invalid('Reference IDs must be unique.');
  const requestedOperation = getRequestedImageOperation(body.imageOperation, refs) ?? invalid('Invalid image action.');
  const imageOperation = seedream ? seedreamOptions.mode === 'text-to-image' ? 'generate' : 'edit' : requestedOperation;
  if (seedream) {
    const error = getSeedreamDraftError(seedreamOptions, body.prompt, refs);
    if (error) invalid(error);
  } else {
    try { refs = resolveImageOperation({ imageOperation, referenceImages: refs }).referenceImages; } catch (error) { invalid((error as Error).message); }
    if (refs.some(ref => ref.editScope === 'image') && !supportsWholeImageEdit(body.model)) invalid('Draw an edit area for this model.');
    const error = getOpenAIImageOutputError(options, imageOperation, refs.length);
    if (error) invalid(error);
  }
  const privateReferencePaths = await Promise.all(refs.map(async (ref, index) => {
    const path = privateReferencePath(ref.data);
    if (path) {
      // This read uses the caller's RLS permissions, before the worker is ever
      // allowed to sign this exact immutable path with server credentials.
      try { await signedMediaUrl(callerDb.storage.from('media'), path); }
      catch (error) {
        if (error instanceof MediaAccessError && error.temporary) throw error;
        invalid(`Reference ${index + 1} is unavailable or was removed. Attach that image again. No generation was submitted.`);
      }
    }
    return path;
  }));
  const payload = { id: body.id, model: body.model as string, provider, prompt: body.prompt,
    displayPrompt: typeof body.displayPrompt === 'string' && body.displayPrompt.length <= 32000 ? body.displayPrompt : body.prompt,
    originalPrompt: body.originalPrompt, aspectRatio: body.aspectRatio, resolution: body.resolution,
    imageOperation, seedreamOptions,
    options, referenceImages: refs, privateReferencePaths, folderId: body.folderId || null,
    imagePromptCategory: body.imagePromptCategory, promptPreparation: normalizePromptPreparation(body.promptPreparation), youtubeSource: normalizeYouTubeSource(body.youtubeSource) };
  let prepared: { prompt:string; referenceImages:ReferenceImage[] };
  try {
    prepared = seedream ? { prompt: seedreamOptions.mode === 'edit' ? normalizeReferencePrompt(payload.prompt,refs) : payload.prompt, referenceImages: refs }
      : prepareSunburstGeneration(payload.prompt, refs, { ...payload, imageModel: body.model, openaiImageOptions: options });
  } catch (error) { return invalid(error instanceof Error ? error.message : 'Invalid prompt references.'); }
  if (prepared.prompt.length > 32000) invalid('Shorten the prompt to leave room for reference instructions.');
  const metadata = { generationProvider: provider, providerModel: payload.model, originalPrompt: payload.originalPrompt, youtubeSource: payload.youtubeSource, promptPreparation: payload.promptPreparation,
    imageOperation, seedreamOptions, openaiImageOptions: isOpenAIImageModel(payload.model) ? options : undefined, imagePromptCategory: payload.imagePromptCategory,
    imageGenerationPrompt: prepared.prompt, imageGenerationReferenceIds: prepared.referenceImages.map(ref=>ref.id),
    imageRequestedSize: isOpenAIImageModel(payload.model) ? getOpenAIImageSize({ ...payload, openaiImageOptions: options }) : seedream ? undefined : `${payload.resolution} · ${payload.aspectRatio}` };
  return { payload, metadata };
};

export type QueuedImagePayload = Awaited<ReturnType<typeof prepareImageJobPayload>>['payload'];
export const refreshImageJobReferences = async (db: any, payload: QueuedImagePayload) => Promise.all(payload.referenceImages.map(async (ref, index) => {
  const path = privateReferencePath(ref.data);
  if (path !== payload.privateReferencePaths[index]) throw new Error('Saved reference authorization does not match.');
  return { ...ref, data: path ? await signedMediaUrl(db.storage.from('media'),path) : ref.data };
}));
