import { chooseProvider } from './providerConfiguration.js';
import { isSecureReferenceUrl } from './providerMedia.js';
import type { ReferenceImage } from '../../src/types.js';
import { getPersonId, cleanPersonName } from '../../src/lib/references/personReferences.js';
import { getOpenAIImageOptions, getOpenAIImageSize, validateOpenAIImageOptions, validateOpenAIImageSize, SUNBURST_MODEL } from '../../src/lib/images/openaiImage.js';
import { prepareSunburstGeneration } from '../../src/lib/images/imagePrompting.js';
import { copyEditRegion, isValidEditRegion } from '../../src/lib/images/imageEditRegion.js';
import { normalizePromptPreparation } from '../../src/lib/prompts/promptPreparation.js';
import { normalizeYouTubeSource } from '../../src/lib/youtube/youtubeSource.js';
import { canonicalMediaUrl, signedMediaUrl } from './imageStorage.js';
import { MediaAccessError } from '../../src/lib/references/mediaAccess.js';
import { LOCAL_IMAGE_MODEL, localImageOptionsError } from '../../src/lib/localModels.js';

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
  if (!['gpt-image-2.5-sunburst','gemini-3-pro-image-preview','gemini-nano-banana-2.1',LOCAL_IMAGE_MODEL].includes(body.model) || typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.id)) invalid('Invalid image job ID or model.');
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 32000) invalid('Prompt must contain 1–32,000 characters.');
  if (!['1:1','4:3','3:4','16:9','9:16'].includes(body.aspectRatio) || !['1K','2K','4K'].includes(body.resolution)) invalid('Invalid ratio or resolution.');
  if (body.options != null && (typeof body.options !== 'object' || Array.isArray(body.options))) invalid('Invalid image options.');
  let provider;
  try { provider = chooseProvider(body.model, body.provider); } catch (error) { return invalid((error as Error).message); }
  const options = getOpenAIImageOptions(body.model === SUNBURST_MODEL ? body.options : undefined);
  const optionError = validateOpenAIImageOptions(options) || validateOpenAIImageSize(getOpenAIImageSize({ ...body, openaiImageOptions: options }));
  if (optionError) invalid(optionError);
  const localError = localImageOptionsError(body);
  if (localError) invalid(localError);
  if (body.originalPrompt != null && (typeof body.originalPrompt !== 'string' || body.originalPrompt.length > 32000)) invalid('Invalid original prompt.');
  if (body.imagePromptCategory != null && !['simple','youtube_thumbnail','product_shot','portrait','social_media','custom'].includes(body.imagePromptCategory)) invalid('Invalid image category.');
  if (body.folderId != null && (typeof body.folderId !== 'string' || body.folderId.length > 200)) invalid('Invalid folder.');
  const references = body.referenceImages ?? [];
  if (!Array.isArray(references) || references.length > (body.model === SUNBURST_MODEL ? 16 : 14) || body.mask != null || body.maskUrl != null) invalid('Invalid reference images.');
  const refs: ReferenceImage[] = references.map((ref: any) => {
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
    return { id: ref.id, data: canonicalMediaUrl(ref.data), mimeType: typeof ref.mimeType === 'string' ? ref.mimeType.slice(0,100) : 'image/png',
      personId: getPersonId(ref), personName: cleanPersonName(ref.personName || '') || undefined,
      isSubjectImage: getPersonId(ref)===1, isSecondPerson: getPersonId(ref)===2, isDraftImage: !!ref.isDraftImage,
      isVideoContext: !!ref.isVideoContext, isEditSource: !!ref.isEditSource, isThumbnailStyle: !!ref.isThumbnailStyle,
      ...(ref.editRegion ? { editRegion: copyEditRegion(ref.editRegion) } : {}) };
  });
  if (new Set(refs.map(ref=>ref.id)).size !== refs.length) invalid('Reference IDs must be unique.');
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
    options, referenceImages: refs, privateReferencePaths, folderId: body.folderId || null,
    ...(body.model === LOCAL_IMAGE_MODEL ? { localModel: body.localModel, localWorkflow: body.localWorkflow, localSeed: body.localSeed,
      localNegativePrompt: body.localNegativePrompt, localUpscale: body.localUpscale } : {}),
    imagePromptCategory: body.imagePromptCategory, promptPreparation: normalizePromptPreparation(body.promptPreparation), youtubeSource: normalizeYouTubeSource(body.youtubeSource) };
  const prepared = prepareSunburstGeneration(payload.prompt, refs, { ...payload, imageModel: body.model, openaiImageOptions: options });
  if (prepared.prompt.length > 32000) invalid('Shorten the prompt to leave room for reference instructions.');
  const metadata = { generationProvider: provider, providerModel: payload.model, originalPrompt: payload.originalPrompt, youtubeSource: payload.youtubeSource, promptPreparation: payload.promptPreparation,
    openaiImageOptions: payload.model === SUNBURST_MODEL ? options : undefined, imagePromptCategory: payload.imagePromptCategory,
    imageGenerationPrompt: prepared.prompt, imageGenerationReferenceIds: prepared.referenceImages.map(ref=>ref.id),
    imageRequestedSize: payload.model === SUNBURST_MODEL ? getOpenAIImageSize({ ...payload, openaiImageOptions: options }) : `${payload.resolution} · ${payload.aspectRatio}` };
  return { payload, metadata };
};

export type QueuedImagePayload = Awaited<ReturnType<typeof prepareImageJobPayload>>['payload'];
export const refreshImageJobReferences = async (db: any, payload: QueuedImagePayload) => Promise.all(payload.referenceImages.map(async (ref, index) => {
  const path = privateReferencePath(ref.data);
  if (path !== payload.privateReferencePaths[index]) throw new Error('Saved reference authorization does not match.');
  return { ...ref, data: path ? await signedMediaUrl(db.storage.from('media'),path) : ref.data };
}));
