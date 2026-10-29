import type { VercelRequest, VercelResponse } from '@vercel/node';
import { describeEvoLinkFailure } from './_lib/evolink-errors.js';
import { applyCors, requireUser } from './_lib/auth.js';
import { prepareTaskRegistry, registerProviderTask } from './_lib/providerTasks.js';
import { isReferenceUrl } from './_lib/providerMedia.js';

const EVOLINK_BASE = 'https://api.evolink.ai';

interface GenerateRequest {
  videoModel?: 'seedance-2.0' | 'seedance-2.5';
  mode: 'text_only' | 'image_to_video' | 'reference_to_video' | 'video_edit' | 'video_extend';
  prompt?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  duration: number;
  quality: string;
  aspectRatio: string;
  generateAudio: boolean;
  referenceEditMode?: boolean;
  editSourcePreparationVersion?: number;
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
    let body: GenerateRequest;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: 'Request body must be valid JSON.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'A video generation request is required.' });
    }
    const { mode, prompt, imageUrls, videoUrls, audioUrls, duration, quality, aspectRatio, generateAudio } = body;
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
    const maxImages = mode === 'image_to_video' ? 2 : videoModel === 'seedance-2.5' ? 30 : 9;
    const maxVideos = videoModel === 'seedance-2.5' ? 10 : 3;
    if (mode === 'image_to_video' && ((videoUrls?.length || 0) > 0 || (audioUrls?.length || 0) > 0)) {
      return res.status(400).json({ error: 'First / last frame generation does not accept video or audio references.' });
    }
    if ((imageUrls?.length || 0) > maxImages || (videoUrls?.length || 0) > maxVideos || (audioUrls?.length || 0) > maxVideos) {
      return res.status(400).json({ error: `Too many references for this mode (maximum ${maxImages} images, ${maxVideos} videos, ${maxVideos} audio clips).` });
    }

    const isEdit = mode === 'video_edit';
    const isExtend = mode === 'video_extend';
    const isReferenceEdit = body.referenceEditMode === true;
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
    if (isEdit && body.editSourcePreparationVersion !== 1) {
      return res.status(409).json({
        error: 'Refresh the app before running Video Edit. This client did not complete the required source-video compatibility check.',
      });
    }

    const maximumDuration = videoModel === 'seedance-2.0' ? 15 : 30;
    const isSupportedAutoDuration = videoModel === 'seedance-2.5' && duration === -1;
    if (isEdit && duration !== -1) {
      return res.status(400).json({ error: 'Seedance 2.5 Video Edit duration must be Auto (-1).' });
    }
    if (!Number.isInteger(duration) || (!isSupportedAutoDuration && (duration < 4 || duration > maximumDuration))) {
      return res.status(400).json({
        error: `${videoModel === 'seedance-2.0' ? 'Seedance 2.0' : 'Seedance 2.5'} duration must be an integer from 4 to ${maximumDuration} seconds${videoModel === 'seedance-2.5' ? ' or Auto (-1)' : ''}.`,
      });
    }

    const allowedQualities = ['480p', '720p', '1080p'];
    if (!allowedQualities.includes(quality)) {
      return res.status(400).json({
        error: `${videoModel === 'seedance-2.0' ? 'Seedance 2.0' : 'Seedance 2.5'} quality must be ${allowedQualities.join(', ')}.`,
      });
    }

    let model: string;
    const requestBody: Record<string, unknown> = {
      duration,
      quality: quality || '720p',
      generate_audio: generateAudio !== false,
      // Seedance 2.5's relaxed-content channel is selected by disabling the
      // standard filter. EvoLink charges 10% more for this route, and its
      // remaining provider policies still apply (including input review).
      // Keep Seedance 2.0 on its existing standard-filter path.
      content_filter: videoModel !== 'seedance-2.5',
      output_format: 'mp4',
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

    const registry = await prepareTaskRegistry(res);
    if (!registry) return;

    const response = await fetch(`${EVOLINK_BASE}/v1/videos/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

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
    if (typeof data?.id !== 'string' || !data.id.trim()) {
      return res.status(502).json({ error: `EvoLink ${model} did not return a task ID. Check provider task history before retrying.` });
    }

    await registerProviderTask(registry, 'evolink', data.id, user.id);

    return res.status(200).json({
      taskId: data.id,
      // credits_reserved is provider-calculated for the exact route, duration,
      // resolution, and reference inputs. Forward billing metadata so the app
      // does not have to guess from a rate card that may change over time.
      usage: data.usage || null,
    });
  } catch (error: any) {
    console.error('EvoLink generate error:', error.message);
    return res.status(500).json({ error: error.message || 'Video generation failed' });
  }
}
