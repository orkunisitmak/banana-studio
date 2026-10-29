import { chooseProvider, providerKey } from './_lib/providerConfiguration.js';
import { PROVIDER_LABELS, type AIProvider } from '../src/lib/providers.js';
import { imageProviderModel, requestImage } from './_lib/imageProviders.js';
import { isReferenceUrl, providerImageUrl } from './_lib/providerMedia.js';
import { getPersonId, cleanPersonName } from '../src/lib/references/personReferences.js';
import { normalizePromptPreparation } from '../src/lib/prompts/promptPreparation.js';
import { normalizeYouTubeSource } from '../src/lib/youtube/youtubeSource.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createUserScopedClient, requireUser, type AuthenticatedUser } from './_lib/auth.js';
import { calculateOpenAIImageCost, getOpenAIImageOptions, getOpenAIImageSize, SUNBURST_MODEL, validateOpenAIImageOptions, validateOpenAIImageSize } from '../src/lib/images/openaiImage.js';
import { prepareSunburstGeneration, getSunburstEditIntent } from '../src/lib/images/imagePrompting.js';
import { EDIT_REGION_REQUIRED, isValidEditRegion, copyEditRegion, describeEditRegion } from '../src/lib/images/imageEditRegion.js';
import { readEditSource, compositeProtectedEdit } from './_lib/protectedImageEdit.js';
import { readImageDimensions } from './_lib/imageDimensions.js';
import { saveGeneratedImage, readStoredImage, imageSha256, signedMediaUrl, canonicalMediaUrl } from './_lib/imageStorage.js';
import { startOpenAIRequest } from './_lib/openaiGuard.js';
import { openAIErrorMessage, safeOpenAIErrorCode, imageRateLimitDelay } from './_lib/openaiError.js';

// Match the existing deployment's 300-second function budget. No automatic
// retry of a billable request; the saved row can be recovered after a reload.
export const config = { maxDuration: 300 };
const isImageUrl = isReferenceUrl;
class SavedImageError extends Error {}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;
  return executeOpenAIImage(req,res,{ user,db:createUserScopedClient(req) });
}

type ImageExecutionContext = {
  user: AuthenticatedUser;
  db: any;
  guard?: { id:string; finish(outcome:'completed'|'failed'|'rejected',requestId?:string|null,status?:number):Promise<void> };
  dispatch?: (metadata:Record<string,unknown>)=>Promise<boolean>;
  deferRateLimit?: (seconds:number,requestId:string|null,reason:'rate'|'quota')=>Promise<boolean>;
};

/** Shared provider/storage pipeline. A durable worker supplies its server-owned
 * admission and must atomically mark dispatch immediately before the paid call. */
export async function executeOpenAIImage(req:VercelRequest,res:VercelResponse,context:ImageExecutionContext) {
  const { user,db } = context;

  let body: any;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid request body' });
  if (!['gpt-image-2.5-sunburst','gemini-3-pro-image-preview','gemini-nano-banana-2.1'].includes(body.model)) return res.status(400).json({ error: 'Unsupported OpenAI image model' });
  if (typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.id)) return res.status(400).json({ error: 'Invalid generation ID' });
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 32000) return res.status(400).json({ error: 'Prompt must contain 1–32,000 characters.' });
  if (!['1:1', '4:3', '3:4', '16:9', '9:16'].includes(body.aspectRatio) || !['1K', '2K', '4K'].includes(body.resolution)) return res.status(400).json({ error: 'Invalid ratio or resolution.' });
  if (body.options != null && (typeof body.options !== 'object' || Array.isArray(body.options))) return res.status(400).json({ error: 'Invalid image options.' });
  let provider: AIProvider;
  try { provider = chooseProvider(body.model, body.provider ?? (context.guard && body.model === SUNBURST_MODEL ? 'openai' : 'auto')); } catch (error) { return res.status(503).json({ error: (error as Error).message }); }
  const key = providerKey(provider) || '';
  const options = getOpenAIImageOptions(body.model === SUNBURST_MODEL ? body.options : undefined);
  let size = getOpenAIImageSize({ ...body, openaiImageOptions: options });
  const optionError = validateOpenAIImageOptions(options) || validateOpenAIImageSize(size);
  if (optionError) return res.status(400).json({ error: optionError });
  const refs = body.referenceImages ?? [];
  if (!Array.isArray(refs) || refs.length > (body.model === SUNBURST_MODEL ? 16 : 14) || refs.some((r: any) => !r || !isImageUrl(r.data))) return res.status(400).json({ error: 'Provide up to 16 HTTPS reference images.' });
  if (refs.some((r: any) => r.isEditSource != null && typeof r.isEditSource !== 'boolean')) return res.status(400).json({ error: 'Invalid edit source role.' });
  if (refs.some((r: any) => r.isThumbnailStyle != null && typeof r.isThumbnailStyle !== 'boolean')) return res.status(400).json({ error: 'Invalid thumbnail style role.' });
  if (refs.some((r: any) => r.editRegion != null && !isValidEditRegion(r.editRegion))) return res.status(400).json({ error: 'Invalid edit area.' });
  if (refs.some((r: any) => (r.personId != null && (!Number.isInteger(r.personId) || r.personId < 1 || r.personId > 9999)) || (r.personName != null && (typeof r.personName !== 'string' || r.personName.length > 40)))) return res.status(400).json({ error: 'Invalid person group or name.' });
  // Older open tabs must not silently submit an unmasked, billable replacement.
  if (body.maskUrl != null || body.mask != null || refs.some((r: any) => r.mask != null)) return res.status(400).json({ error: 'Inpaint has been removed. Refresh the app and submit a regular image edit.' });
  if (body.originalPrompt != null && (typeof body.originalPrompt !== 'string' || body.originalPrompt.length > 32000)) return res.status(400).json({ error: 'Invalid original prompt.' });
  if (body.imagePromptCategory != null && !['youtube_thumbnail', 'product_shot', 'portrait', 'social_media', 'custom', 'simple'].includes(body.imagePromptCategory)) return res.status(400).json({ error: 'Invalid image category.' });
  const storedPrompt = typeof body.displayPrompt === 'string' && body.displayPrompt.length <= 32000 ? body.displayPrompt : body.prompt;
  const safeRefs = refs.map((r: any) => ({
    id: String(r.id || '').slice(0, 128), data: r.data, mimeType: typeof r.mimeType === 'string' ? r.mimeType.slice(0, 100) : 'image/png',
    personId: getPersonId(r), personName: cleanPersonName(r.personName || '') || undefined,
    isSubjectImage: getPersonId(r) === 1, isSecondPerson: getPersonId(r) === 2, isDraftImage: !!r.isDraftImage, isVideoContext: !!r.isVideoContext, isEditSource: !!r.isEditSource, isThumbnailStyle: !!r.isThumbnailStyle,
    ...(r.editRegion ? { editRegion: copyEditRegion(r.editRegion) } : {}),
  }));
  let generationPrompt: string;
  let generationReferences: ReturnType<typeof prepareSunburstGeneration>['referenceImages'];
  let protectedSource: Awaited<ReturnType<typeof readEditSource>> | undefined;
  let editReference: typeof safeRefs[number] | undefined;
  try {
    const prepared = prepareSunburstGeneration(body.prompt, safeRefs, { ...body, imageModel: body.model, openaiImageOptions: options });
    generationPrompt = prepared.prompt;
    generationReferences = prepared.referenceImages;
    const edit = getSunburstEditIntent(body.prompt, safeRefs, body);
    if (edit) {
      editReference = safeRefs[edit.sourceIndex!];
      if (!isValidEditRegion(editReference.editRegion)) return res.status(400).json({ error: EDIT_REGION_REQUIRED });
      protectedSource = await readEditSource(db, editReference.data, user.id);
      size = `${protectedSource.info.width}x${protectedSource.info.height}`;
      // OpenAI's size rules apply to API routes; Codex picks its own canvas and is resized to the source at the same ratio.
      const sourceSizeError = body.model === SUNBURST_MODEL && provider !== 'codex' ? validateOpenAIImageSize(size) : null;
      if (sourceSizeError) return res.status(400).json({ error: `Protected edits use the source canvas (${size}). ${sourceSizeError}` });
      generationPrompt += '\n\n' + describeEditRegion(editReference.editRegion, protectedSource.info.width, protectedSource.info.height);
    } else if (safeRefs.some(ref => ref.editRegion)) {
      return res.status(400).json({ error: 'Choose the reference with the selected Edit area.' });
    }
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid prompt references.' });
  }
  if (generationPrompt.length > 32000) return res.status(400).json({ error: 'Shorten the prompt to leave room for reference and canvas instructions (32,000 characters total).' });
  const guard = context.guard || await startOpenAIRequest(req, res, user, 'image', body.id);
  if (!guard) return;
  let providerStatus: number | undefined;
  let providerErrorCode: string | undefined;
  let outcome: 'completed' | 'failed' | 'rejected' = 'rejected';
  let storedPath: string | undefined;
  // Keep references/settings and the result durable even if the browser closes.
  // An INSERT also makes duplicate submissions with the same ID fail before
  // OpenAI is charged; no upsert may take over another user's generation.
  const startedAt = Date.now();
  const metadata: Record<string, unknown> = { generationProvider: provider, providerModel: imageProviderModel(provider, body.model, generationReferences.length > 0), originalPrompt: body.originalPrompt, youtubeSource: normalizeYouTubeSource(body.youtubeSource),
    promptPreparation: normalizePromptPreparation(body.promptPreparation),
    openaiImageOptions: body.model !== SUNBURST_MODEL ? undefined : protectedSource ? { ...options, size: 'custom', width: protectedSource.info.width, height: protectedSource.info.height } : options,
    openaiStartedAt: startedAt, generationStartedAt: startedAt,
    imagePromptCategory: body.imagePromptCategory, imageGenerationPrompt: generationPrompt,
    imageGenerationReferenceIds: generationReferences.map(ref => ref.id), imageRequestedSize: body.model === SUNBURST_MODEL || protectedSource ? size : `${body.resolution} · ${body.aspectRatio}`, openaiAuditId: guard.id };
  if (editReference?.id.startsWith('gallery-')) metadata.imageEditSourceId = editReference.id.slice(8);
  try {
    const { error: insertError } = context.dispatch ? { error:null } : await db.from('generations').insert({
      id: body.id, user_id: user.id, prompt: storedPrompt, url: '', type: 'image',
      aspect_ratio: body.aspectRatio, resolution: body.resolution, image_model: body.model,
      created_at: startedAt, folder_id: body.folderId || null, is_favorite: false,
      reference_images: safeRefs.map(ref => ({ ...ref, data: canonicalMediaUrl(ref.data) })), status: 'processing', metadata,
    });
    if (insertError) {
      await guard.finish('rejected');
      return res.status(insertError.code === '23505' ? 409 : 500).json({ error: 'Could not create the saved generation. No OpenAI request was sent.',
        ...(insertError.code === '23505' ? { code: 'GENERATION_EXISTS' } : {}),
      });
    }

    const input: Record<string, unknown> = { resolution: body.resolution, aspect_ratio: body.aspectRatio,
      model: body.model, prompt: generationPrompt, n: 1, size, quality: options.quality,
      background: options.background, output_format: options.outputFormat, moderation: options.moderation,
      user: user.id,
    };
    // Let Sunburst use its default input fidelity for generation and edits.
    if (generationReferences.length) input.images = await Promise.all(generationReferences.map(async ref => ({ image_url: await providerImageUrl(db, ref.data) })));

    if (context.dispatch && !await context.dispatch(metadata)) {
      await guard.finish('rejected');
      return res.status(409).json({ code:'IMAGE_CLAIM_LOST', error:'The saved worker claim is no longer active. No provider request was sent.' });
    }
    outcome = 'failed';
    const response = await requestImage(provider, body.model, input, db, key, guard.id);
    providerStatus = response.status;
    const data = await response.json().catch(() => null);
    metadata.openaiRequestId = response.headers.get('x-request-id');
    if (!response.ok) {
      providerErrorCode = safeOpenAIErrorCode(data);
      const quotaWait = response.status===429 && providerErrorCode==='insufficient_quota' && data?.usage==null
        && (data?.data==null || Array.isArray(data.data)&&data.data.length===0);
      const retryAfter = provider === 'openai' ? (quotaWait ? 3600 : imageRateLimitDelay(response,data)) : null;
      if (retryAfter && context.deferRateLimit) {
        outcome = 'rejected';
        let deferred = false;
        try { deferred = await context.deferRateLimit(retryAfter,metadata.openaiRequestId as string|null,quotaWait?'quota':'rate'); }
        catch { /* Reconcile this same job if the deferral acknowledgement was lost. */ }
        await guard.finish('rejected',metadata.openaiRequestId as string|null,429);
        return res.status(202).json({ code:deferred?'IMAGE_PROVIDER_RATE_WAIT':'IMAGE_PROVIDER_RATE_STATE_UNKNOWN',retryAfter });
      }
      metadata.openaiError = { status: response.status, ...(providerErrorCode ? { code: providerErrorCode } : {}) };
      const error = new Error(provider === 'openai' ? openAIErrorMessage(response.status, providerErrorCode) : provider === 'codex' ? `Codex could not create the image: ${String(data?.error?.message || response.status).slice(0, 500)}` : `${PROVIDER_LABELS[provider]} rejected the image request (${response.status}). Check the prompt, references, model access and account credit.`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const usd = provider === 'openai' ? calculateOpenAIImageCost(data?.usage) : typeof data?.usage?.cost === 'number' && Number.isFinite(data.usage.cost) && data.usage.cost >= 0 ? data.usage.cost : null;
    metadata.openaiUsage = data?.usage ?? null;
    metadata.generationCost = usd == null ? null : { usd, source: 'provider_usage' };
    // Log returned usage before storage, since a storage failure doesn't undo
    // the provider charge. Missing usage remains NULL, never a guessed price.
    const { error: usageError } = await db.from('usage_logs').insert({
      user_id: user.id, action: 'generate', model: body.model,
      prompt: storedPrompt.slice(0, 500), image_count: Array.isArray(data?.data) ? data.data.length : 0, estimated_cost: usd,
    });
    if (usageError) metadata.usageLogError = 'Usage could not be recorded in the admin log.';
    const b64 = data?.data?.[0]?.b64_json;
    if (typeof b64 !== 'string' || !b64) throw new SavedImageError(`${PROVIDER_LABELS[provider]} returned no image. Check usage before generating again.`);
    const returnedFormat = data?.data?.[0]?.media_type?.split('/')[1] || data.output_format;
    const outputFormat = protectedSource ? 'png' : ['png', 'jpeg', 'webp'].includes(returnedFormat) ? returnedFormat : options.outputFormat;
    let imageBytes = Buffer.from(b64, 'base64');
    if (protectedSource && editReference?.editRegion) {
      const providerOutputSha256 = imageSha256(imageBytes);
      // Codex picks its own supported canvas; accept it only at the source's aspect ratio.
      const result = await compositeProtectedEdit(protectedSource, imageBytes, editReference.editRegion, body.model !== SUNBURST_MODEL || provider === 'codex');
      imageBytes = result.bytes;
      metadata.imageEditProtection = { version: 1, sourceReferenceId: editReference.id, sourceSha256: protectedSource.sha256,
        sourceSize: size, region: editReference.editRegion, pixelRegion: result.bounds, preservedOutsideRegion: true, providerOutputSha256 };
    }
    // The requested size is not evidence of the returned file's size.
    metadata.imageOutputSize = readImageDimensions(imageBytes)
      || (typeof data.size === 'string' && /^[1-9]\d*x[1-9]\d*$/.test(data.size) ? data.size : undefined);
    const storagePath = `openai/${user.id}/${body.id}.${outputFormat === 'jpeg' ? 'jpg' : outputFormat}`;
    metadata.imageStoragePath = storagePath;
    metadata.imageOutputBytes = imageBytes.length;
    metadata.imageOutputSha256 = imageSha256(imageBytes);
    // This path belongs to the unique generation INSERT above. If an upload
    // succeeded but its response was lost, retrying these same bytes is safe.
    const uploadError = await saveGeneratedImage(upsert => db.storage.from('media').upload(storagePath, imageBytes, { contentType: `image/${outputFormat}`, upsert }));
    if (uploadError && !await readStoredImage(db.storage.from('media'), storagePath, metadata.imageOutputSha256 as string)) {
      metadata.storageError = { status: uploadError.statusCode || uploadError.status || null, message: 'Image storage failed.' };
      console.warn('OpenAI image storage failed', body.id, { ...metadata.storageError as object, bytes: imageBytes.length, elapsedMs: Date.now() - startedAt });
      throw new SavedImageError(`${PROVIDER_LABELS[provider]} generated the image, but saving it failed. Usage has been recorded; retrying generation may incur another charge.`);
    }
    storedPath = storagePath;
    const url = await signedMediaUrl(db.storage.from('media'), storagePath);
    metadata.generationCompletedAt = Date.now();
    metadata.generationTime = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const { error: saveError } = await db.from('generations').update({ status: 'completed', url: '', storage_path: storagePath, metadata }).eq('id', body.id).eq('user_id', user.id);
    if (saveError) metadata.persistenceWarning = 'Image stored; gallery metadata could not be updated.';
    outcome = 'completed';
    await guard.finish('completed', typeof metadata.openaiRequestId === 'string' ? metadata.openaiRequestId : null, providerStatus);
    // Return a compact URL rather than base64: high-quality PNGs exceed the
    // deployment's response-size limit. No credential is sent to the browser.
    return res.status(200).json({ id: body.id, url, storagePath, referenceImages: safeRefs, metadata });
  } catch (error: any) {
    if (storedPath) {
      // The billed image is already stored. A later signing or audit error must
      // not mark it failed and invite a second paid generation.
      console.warn('OpenAI image stored; finishing step failed', { id: body.id, auditId: guard.id });
      outcome = 'completed';
      metadata.generationCompletedAt ??= Date.now();
      metadata.generationTime ??= Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      await db.from('generations').update({ status: 'completed', url: '', storage_path: storedPath, metadata }).eq('id', body.id).eq('user_id', user.id);
      return res.status(200).json({ id: body.id, url: '', storagePath: storedPath, referenceImages: safeRefs, metadata });
    }
    const message = error?.name === 'TimeoutError' && provider !== 'codex'
      ? `${PROVIDER_LABELS[provider]} exceeded the request time limit. It may still have billed this request. Check usage before generating again.`
      : error instanceof SavedImageError ? error.message : provider === 'codex' ? String(error?.message || 'Codex could not finish the image.').slice(0, 600) : provider === 'openai' ? openAIErrorMessage(error?.status, providerErrorCode) : `${PROVIDER_LABELS[provider]} could not finish the image. Check provider usage before submitting again.`;
    console.warn('OpenAI image request failed', { id: body.id, auditId: guard.id, status: providerStatus ?? null,
      code: providerErrorCode ?? null, elapsedMs: Date.now() - startedAt });
    await db.from('generations').update({ status: 'failed', metadata: { ...metadata, error: message } }).eq('id', body.id).eq('user_id', user.id);
    await guard.finish('failed', typeof metadata.openaiRequestId === 'string' ? metadata.openaiRequestId : null, providerStatus);
    return res.status(error?.status >= 400 && error?.status <= 599 ? error.status : 502).json({ error: message });
  } finally {
    await guard.finish(outcome, typeof metadata.openaiRequestId === 'string' ? metadata.openaiRequestId : null, providerStatus);
  }
}
