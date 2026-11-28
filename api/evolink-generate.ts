import type { VercelRequest, VercelResponse } from '@vercel/node';
import { describeEvoLinkFailure } from './_lib/evolink-errors.js';
import { applyCors, requireUser } from './_lib/auth.js';
import { startPaidRequest, type PaidRequest } from './_lib/openaiGuard.js';
import { isGenerationId, prepareTaskRegistry, registerProviderTask, requireSavedVideo, saveGenerationTask } from './_lib/providerTasks.js';
import { isReferenceUrl } from './_lib/providerMedia.js';
import { admitProvider } from './_lib/providerConfiguration.js';
import { claimVideo, rejectVideoClaim } from './_lib/videoClaim.js';
import { buildEvoH3MaxInput, EVO_H3_MODEL } from '../src/lib/video/evoH3Max.js';
import { buildMagi2Input, isMagi2PublicUrl, MAGI2_MODEL } from '../src/lib/video/magi2.js';
import { seedanceDurationError, seedanceReferenceError, seedanceReferenceDurationError, isSeedanceQuality } from '../src/lib/video/seedance.js';

const EVOLINK_BASE = 'https://api.evolink.ai';

interface GenerateRequest {
  videoModel?: 'seedance-2.0' | 'seedance-2.5';
  mode: 'text_only' | 'image_to_video' | 'reference_to_video' | 'video_edit' | 'video_extend';
  prompt?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  videoDurations?: number[];
  audioDurations?: number[];
  duration: number;
  quality: string;
  aspectRatio: string;
  generateAudio: boolean;
  referenceEditMode?: boolean;
  editSourcePreparationVersion?: number;
  generationId?: string;
}

export const hasInvalidMediaUrls = (urls: unknown): boolean => urls != null && (
  !Array.isArray(urls)
  || urls.some(url => !isReferenceUrl(url))
);

const ensureVideoTargetTag = (prompt: string, mode: GenerateRequest['mode']): string => {
  const trimmedPrompt = prompt.trim();
  const hasTarget = /@video1\b/i.test(trimmedPrompt);
  const hasIntent = mode === 'video_edit' ? /\bedit\b/i.test(trimmedPrompt) : /\bextend\b/i.test(trimmedPrompt);
  if ((mode !== 'video_edit' && mode !== 'video_extend') || (hasTarget && hasIntent)) {
    return trimmedPrompt;
  }

  // Seedance validates edit/extend intent asynchronously and requires the
  // primary input video to be identified explicitly as @video1. Keep this at
  // the server boundary as well as in the UI so older or alternate clients do
  // not create a task that is accepted first and then fails model validation.
  return mode === 'video_edit'
    ? `Edit @video1 as the source video. ${trimmedPrompt}`
    : `Extend @video1 ${/\bbackwards?\b/i.test(trimmedPrompt) ? 'backward' : 'forward'} as the source video. ${trimmedPrompt}`;
};

const ensureSeedance20ReferenceEditAnchor = (prompt: string): string => {
  const trimmedPrompt = prompt.trim();
  if (/@VIDEO\b/i.test(trimmedPrompt)) return trimmedPrompt;

  // Ref Edit intentionally remains on Seedance 2.0 reference-to-video. The
  // @VIDEO anchor retains the source while allowing a configured ratio and
  // duration. This is an edit of that footage, not a following shot.
  return `Use @VIDEO as the primary source footage and visual source of truth. Preserve its action, sequence, people, identity, environment, and camera language while applying only the requested changes. ${trimmedPrompt}`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const apiKey = process.env.EVOLINK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'EvoLink API key not configured' });

  try {
    let body: GenerateRequest | { videoModel: typeof MAGI2_MODEL | typeof EVO_H3_MODEL; generationId?: string };
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: 'Request body must be valid JSON.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'A video generation request is required.' });
    }
    if (body.generationId !== undefined && !isGenerationId(body.generationId)) return res.status(400).json({ error: 'A valid generation ID is required.' });
    if (body.videoModel === MAGI2_MODEL || body.videoModel === EVO_H3_MODEL) {
      const model = body.videoModel;
      let input: Record<string, unknown>;
      try { input = model === MAGI2_MODEL ? buildMagi2Input(body) : buildEvoH3MaxInput(body); }
      catch (err) { return res.status(400).json({ error: (err as Error).message }); }
      const callback = model === MAGI2_MODEL && process.env.MAGI2_CALLBACK_URL;
      if (callback) {
        if (!isMagi2PublicUrl(callback)) return res.status(500).json({ error: 'Invalid configured MAGI-2 callback URL.' });
        input.callback_url = callback;
      }
      return await submit(body.generationId, model, String(input.model), input);
    }
    const { mode, prompt, imageUrls, videoUrls, audioUrls, duration = mode === 'video_edit' ? -1 : 5, quality = '720p', aspectRatio = 'adaptive', generateAudio = true } = body as GenerateRequest;
    const videoModel = body.videoModel || 'seedance-2.5';

    if (videoModel !== 'seedance-2.0' && videoModel !== 'seedance-2.5') {
      return res.status(400).json({ error: 'Video model must be Seedance 2.0 or Seedance 2.5.' });
    }

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'A non-empty prompt is required for Seedance video tasks.' });
    }

    if ([imageUrls, videoUrls, audioUrls].some(hasInvalidMediaUrls)) {
      return res.status(400).json({
        error: 'Reference media must be arrays of public HTTPS URLs. Local blob/data or plain HTTP URLs cannot be used by Seedance.',
      });
    }
    const mediaError = seedanceReferenceError(videoModel, mode, imageUrls?.length || 0, videoUrls?.length || 0, audioUrls?.length || 0);
    if (mediaError) return res.status(400).json({ error: mediaError });
    for (const [kind, durations, urls] of [['video', (body as GenerateRequest).videoDurations, videoUrls], ['audio', (body as GenerateRequest).audioDurations, audioUrls]] as const) {
      if (durations === undefined) continue;
      if (!Array.isArray(durations) || durations.length !== (urls?.length || 0)) return res.status(400).json({ error: 'Expected one duration per reference URL.' });
      const error = seedanceReferenceDurationError(videoModel, mode, kind, durations);
      if (error) return res.status(400).json({ error });
    }

    const isEdit = mode === 'video_edit';
    const isExtend = mode === 'video_extend';
    const isReferenceEdit = (body as GenerateRequest).referenceEditMode === true;
    if (isReferenceEdit && (videoModel !== 'seedance-2.0' || mode !== 'reference_to_video')) {
      return res.status(400).json({ error: 'Ref Edit requires Seedance 2.0 reference-to-video.' });
    }
    if (isReferenceEdit && (!videoUrls || videoUrls.length === 0)) {
      return res.status(400).json({ error: 'Seedance 2.0 Ref Edit requires a source video URL.' });
    }
    if ((isEdit || isExtend) && videoModel !== 'seedance-2.5') {
      return res.status(400).json({ error: 'Video Edit and Video Extend require Seedance 2.5.' });
    }
    if ((isEdit || isExtend) && (!videoUrls || videoUrls.length === 0)) {
      return res.status(400).json({ error: `Video ${isEdit ? 'Edit' : 'Extend'} requires at least one source video URL.` });
    }
    if (isEdit && (body as GenerateRequest).editSourcePreparationVersion !== 1) {
      return res.status(409).json({
        error: 'Refresh the app before running Video Edit. This client did not complete the required source-video compatibility check.',
      });
    }

    const durationError = seedanceDurationError(videoModel, mode, duration);
    if (durationError) return res.status(400).json({ error: durationError });
    if (!isSeedanceQuality(quality) || !['adaptive','16:9','9:16','1:1','3:4','4:3','21:9'].includes(aspectRatio) || typeof generateAudio !== 'boolean') return res.status(400).json({ error: 'Unsupported Seedance resolution, aspect ratio or audio setting.' });

    let model: string;
    const requestBody: Record<string, unknown> = {
      duration,
      quality: quality.toLowerCase(),
      generate_audio: generateAudio !== false,
      // Seedance 2.5's relaxed-content channel is selected by disabling the
      // standard filter. EvoLink charges 10% more for this route, and its
      // remaining provider policies still apply (including input review).
      // Keep Seedance 2.0 on its existing standard-filter path.
      content_filter: videoModel !== 'seedance-2.5',
      ...(videoModel === 'seedance-2.5' ? { output_format: 'mp4' } : {}),
    };

    // Seedance 2.5 first-frame generation derives its ratio from that image.
    // A ratio-adapted continuation already has the requested crop baked into
    // its extracted frame; sending the fixed ratio again is rejected.
    const usesSourceAspectRatio = isEdit || isExtend || (videoModel === 'seedance-2.5' && mode === 'image_to_video');
    requestBody.aspect_ratio = usesSourceAspectRatio ? 'adaptive' : aspectRatio || '16:9';

    if (prompt) {
      const taggedPrompt = ensureVideoTargetTag(prompt, mode);
      requestBody.prompt = isReferenceEdit
        ? ensureSeedance20ReferenceEditAnchor(taggedPrompt)
        : taggedPrompt;
    }

    if (mode === 'text_only') {
      model = `${videoModel}-text-to-video`;
    } else if (mode === 'image_to_video') {
      model = `${videoModel}-image-to-video`;
      if (!imageUrls || imageUrls.length === 0) {
        return res.status(400).json({ error: 'At least one image URL is required for image-to-video' });
      }
      requestBody.image_urls = imageUrls;
    } else if (mode === 'reference_to_video') {
      model = `${videoModel}-reference-to-video`;
      if (imageUrls && imageUrls.length > 0) requestBody.image_urls = imageUrls;
      if (videoUrls && videoUrls.length > 0) requestBody.video_urls = videoUrls;
      if (audioUrls && audioUrls.length > 0) requestBody.audio_urls = audioUrls;
    } else if (isEdit || isExtend) {
      model = isEdit ? 'seedance-2.5-video-edit' : 'seedance-2.5-video-extend';
      requestBody.video_urls = videoUrls;
      if (imageUrls && imageUrls.length > 0) requestBody.image_urls = imageUrls;
      if (audioUrls && audioUrls.length > 0) requestBody.audio_urls = audioUrls;
    } else {
      return res.status(400).json({ error: 'Unsupported Seedance video mode.' });
    }

    requestBody.model = model;

    return await submit(body.generationId, videoModel, model, requestBody);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }

  async function submit(generationId: string | undefined, videoModel: string, model: string, requestBody: Record<string, unknown>) {
    let acceptedTaskId: string | undefined;
    let guard: PaidRequest = null;
    try {
      const registry = await prepareTaskRegistry(res);
      if (!registry) return;
      if (generationId && !await requireSavedVideo(registry, res, generationId, user.id)) return;
      if (!await admitProvider(req, res, videoModel, 'evolink')) return;
      guard = await startPaidRequest(req, res, user, 'image', 'EvoLink');
      if (!guard) return;
  
      if (generationId && !await claimVideo(registry, res, generationId, user.id, { generationProvider: 'evolink', videoModel, providerModel: model, falEndpoint: 'evolink/' + model })) {
        await guard.finish('rejected');
        return;
      }
      const response = await fetch(`${EVOLINK_BASE}/v1/videos/generations`, {
        method: 'POST',
        redirect: 'error', signal: AbortSignal.timeout(55_000),
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      await guard.finish(response.ok ? 'completed' : 'failed', null, response.status);
      if (!response.ok) await rejectVideoClaim(registry, generationId, user.id, response.status);
  
      let data: any;
      try {
        data = await response.json();
      } catch {
        return res.status(502).json({
          error: `EvoLink ${model} returned an unreadable response (HTTP ${response.status}). No task ID was received; check provider task history before retrying.`,
        });
      }
  
      if (!response.ok) {
        return res.status(response.status).json({ error: describeEvoLinkFailure(data, `EvoLink ${model} (HTTP ${response.status})`) });
      }
      if (typeof data?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(data.id)) {
        return res.status(502).json({ error: `EvoLink ${model} did not return a task ID. Check provider task history before retrying.` });
      }
  
      acceptedTaskId = data.id;
      await registerProviderTask(registry, 'evolink', data.id, user.id);
      if (generationId && !await saveGenerationTask(registry, generationId, user.id, data.id)) {
        return res.status(503).json({ error: `Generation was submitted, but its saved video could not be updated (Task: ${data.id}). Do not submit again; check task history or contact an administrator.`, taskId: data.id, provider:'evolink', endpoint:'evolink/' + model, usage:data.usage || null });
      }
  
      return res.status(200).json({
        taskId: data.id, provider: 'evolink', endpoint: `evolink/${model}`,
        // credits_reserved is provider-calculated for the exact route, duration,
        // resolution, and reference inputs. Forward billing metadata so the app
        // does not have to guess from a rate card that may change over time.
        usage: data.usage || null,
      });
    } catch (error: any) {
      await guard?.finish('failed');
      console.error('EvoLink generate error:', error.message);
      return res.status(500).json({ error: error.message || 'Video generation failed', ...(acceptedTaskId ? { taskId: acceptedTaskId, provider:'evolink', endpoint:'evolink/' + model } : {}) });
    }
  }
}
