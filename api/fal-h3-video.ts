import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser } from './_lib/auth.js';
import { startPaidRequest, type PaidRequest } from './_lib/openaiGuard.js';
import { prepareTaskRegistry, registerProviderTask, requireProviderTask } from './_lib/providerTasks.js';
import { persistFalFailure } from './_lib/videoTerminal.js';
import { buildH3MaxInput, H3_MAX_ENDPOINTS } from '../src/lib/video/h3Max.js';
import { fetchFalRequestCosts } from './_lib/falBillingCosts.js';
import { recordH3Usage } from './_lib/h3Usage.js';
import { estimateH3MaxCost } from '../src/lib/video/h3MaxPricing.js';
import type { GenerationConfig } from '../src/types.js';
import { admitProvider } from './_lib/providerConfiguration.js';
import { buildOmniInput, OMNI_ENDPOINTS, OMNI_MODEL, OMNI_QUEUE_APP } from '../src/lib/video/omniFlash.js';
import type { H3MaxMode } from '../src/lib/video/h3Max.js';

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const LEGACY_H3_QUEUE_APP = 'minimax/h3';
const LEGACY_H3_REFERENCE_ENDPOINT = 'minimax/h3/reference-to-video';
const H3_MAX_QUEUE_APP = 'minimax/h3-max';
// Lookup failures do not prove that an already accepted generation failed.
// 401/403 (a rotated or wrong key) and 404 (a lookup route miss) included:
// the client keeps the task recoverable instead of marking it failed.
const RETRYABLE_LOOKUP_STATUSES = new Set([401, 402, 403, 404, 408, 409, 425, 429]);

const ALLOWED_QUEUE_ENDPOINTS = new Set<string>([
  H3_MAX_QUEUE_APP, ...Object.values(H3_MAX_ENDPOINTS),
  OMNI_QUEUE_APP, ...Object.values(OMNI_ENDPOINTS),
  // Polling-only compatibility for generations submitted before Max-only routing.
  LEGACY_H3_QUEUE_APP, LEGACY_H3_REFERENCE_ENDPOINT,
]);

const queueEndpointFromFalUrl = (
  rawUrl: unknown,
  requestId: string,
  lifecycle: 'status' | 'response',
  submittedEndpoint: string, parent: string,
): string | undefined => {
  if (typeof rawUrl !== 'string') return undefined;
  try {
    const url = new URL(rawUrl);
    if (url.origin !== FAL_QUEUE_BASE || url.username || url.password) return undefined;
    const path = '/requests/' + encodeURIComponent(requestId);
    const suffix = lifecycle === 'response' && url.pathname.endsWith(path) ? path : path + '/' + lifecycle;
    if (!url.pathname.endsWith(suffix)) return undefined;
    const endpoint = url.pathname.slice(1, -suffix.length);
    return endpoint === submittedEndpoint || endpoint === parent ? endpoint : undefined;
  } catch {
    return undefined;
  }
};

const extractFalErrorMessage = (raw: unknown): string => {
  if (!raw) return 'fal.ai video generation failed';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const messages = raw
      .map((entry: any) => entry?.msg || entry?.message)
      .filter((message: unknown): message is string => typeof message === 'string' && message.length > 0);
    if (messages.length > 0) return messages.join(' • ');
  }
  if (typeof raw === 'object') {
    const value = raw as Record<string, any>;
    return extractFalErrorMessage(value.detail || value.error || value.message);
  }
  return 'fal.ai video generation failed';
};

const readJson = async (response: Response): Promise<any> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`fal.ai returned a non-JSON response (${response.status}): ${text.slice(0, 160)}`);
  }
};

const getActualRequestCost = async (requestId: string, fallbackKey: string): Promise<number | undefined> => {
  const normalizeKey = (key?: string) => key?.trim().replace(/^Key\s+/i, '').trim() || '';
  const billingKey = normalizeKey(process.env.FAL_ADMIN_KEY) || normalizeKey(fallbackKey);
  try {
    return (await fetchFalRequestCosts([requestId], billingKey, { timeoutMs: 5000 })).get(requestId);
  } catch (error: any) {
    // A failed/incomplete billing read must never hold the completed video or
    // turn an unknown charge into zero. Reconciliation can fill it in later.
    console.warn(`fal billing lookup failed for ${requestId}:`, error?.message || error);
    return undefined;
  }
};


export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleFalVideo(req, res);
}

/** Desktop prepares local media only for a newly admitted submission, never for an accepted task lookup. */
export async function handleFalVideo(req: VercelRequest, res: VercelResponse, prepareMedia?: (body: VercelRequest['body']) => Promise<VercelRequest['body']>) {
  applyCors(res);
  // Queue state changes behind the same request URL. Without an explicit
  // no-store policy Vercel/browser revalidation can turn later polls into 304
  // responses and leave the client replaying the first RUNNING payload even
  // after fal has completed the job.
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, max-age=0, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const apiKey = process.env.FAL_KEY || '';
  if (req.method === 'GET' && !apiKey) return res.status(500).json({ error: 'FAL_KEY not configured on server' });

  let guard: PaidRequest = null;
  try {
    if (req.method === 'POST') {
      let prepared: { endpoint: string; mode: string; input: Record<string, unknown> };
      let body: any;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (body?.videoModel !== undefined && body.videoModel !== 'minimax-h3' && body.videoModel !== OMNI_MODEL) throw new Error('Unsupported fal video model.');
        if (body.generationId !== undefined && (typeof body.generationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(body.generationId))) throw new Error('A valid generation ID is required');
      } catch (error: any) {
        return res.status(400).json({ error: error?.message || 'Invalid MiniMax H3 Max request' });
      }
      const isOmni = body.videoModel === OMNI_MODEL;
      const model = isOmni ? OMNI_MODEL : 'minimax-h3';
      const parent = isOmni ? OMNI_QUEUE_APP : H3_MAX_QUEUE_APP;

      const registry = await prepareTaskRegistry(res);
      if (!registry) return;
      let galleryClaim: { id: string; metadata: Record<string, unknown> } | undefined;
      let pending: { metadata: Record<string, unknown>; originalMetadata: unknown; taskId: string | null } | undefined;
      if (body.generationId) {
        const { data: saved, error: readError } = await registry.from('generations')
          .select('id,user_id,type,status,task_id,metadata').eq('id', body.generationId).eq('user_id', user.id).maybeSingle();
        if (readError) return res.status(503).json({ error: 'Saved generation access could not be verified. No provider request was sent.' });
        if (!saved || saved.user_id !== user.id || saved.type !== 'video') return res.status(404).json({ error: 'Saved video generation not found' });
        const metadata = saved.metadata && typeof saved.metadata === 'object' && !Array.isArray(saved.metadata) ? saved.metadata : {};
        if (metadata.videoModel && metadata.videoModel !== model || metadata.generationProvider && metadata.generationProvider !== 'fal') return res.status(409).json({ error: 'This saved task belongs to a different model or provider.' });
        if (saved.task_id) {
          if (!await requireProviderTask(req, res, 'fal', saved.task_id)) return;
          const savedEndpoint = typeof metadata.falEndpoint === 'string' && ALLOWED_QUEUE_ENDPOINTS.has(metadata.falEndpoint) ? metadata.falEndpoint : parent;
          const savedQueueEndpoint = typeof metadata.falQueueEndpoint === 'string' && ALLOWED_QUEUE_ENDPOINTS.has(metadata.falQueueEndpoint) ? metadata.falQueueEndpoint : savedEndpoint;
          return res.status(200).json({ taskId: saved.task_id, endpoint: savedEndpoint, queueEndpoint: savedQueueEndpoint });
        }
        if (saved.status !== 'pending' || metadata.h3SubmissionStartedAt) return res.status(409).json({
          code: 'GENERATION_SUBMITTING', error: 'This saved video was already submitted or its acceptance is uncertain. Do not submit again; check its saved task history and usage.',
        });
        pending = { metadata, originalMetadata: saved.metadata, taskId: saved.task_id };
      }
      if (!await admitProvider(req, res, model, 'fal')) return;
      if (!apiKey) return res.status(500).json({ error: 'FAL_KEY not configured on server' });
      try {
        if (prepareMedia) body = await prepareMedia(body);
        prepared = isOmni ? buildOmniInput(body) : buildH3MaxInput(body);
      } catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid fal video request' });
      }
      const { endpoint, input, mode } = prepared;
      const estimatedCostUsd = isOmni ? undefined : estimateH3MaxCost({
        h3MaxMode: mode as H3MaxMode, h3MaxOptions: body.options,
        videoAspectRatio: input.aspect_ratio,
        videoQuality: String(input.resolution || body.resolution || '768P'),
        videoDuration: Number(input.duration || body.duration) || 5,
        referenceImages: [
          ...(body.imageUrls || []).map((_: unknown, index: number) => ({ ...body.mediaMetadata?.images?.[index], id: 'request-image-' + index })),
          ...(mode === 'reference_to_video' && body.options?.startImageId && input.image_url ? [{ ...body.mediaMetadata?.startFrame, id: body.options.startImageId }] : []),
        ],
        referenceVideos: (body.videoUrls || []).map((_: unknown, index: number) => ({ ...body.mediaMetadata?.videos?.[index] })),
        referenceAudios: (body.audioUrls || []).map((_: unknown, index: number) => ({ ...body.mediaMetadata?.audios?.[index] })),
      } as GenerationConfig).usd;
      guard = await startPaidRequest(req, res, user, 'image', 'fal.ai');
      if (!guard) return;
      if (pending) {
        const { metadata } = pending;
        const claimedMetadata = { ...metadata, h3SubmissionStartedAt: Date.now(), generationProvider: 'fal', videoModel: model, providerModel: endpoint, ...(isOmni ? { omniMode: mode } : { h3MaxMode: mode }), falEndpoint: endpoint };
        let claim = registry.from('generations').update({ status:'processing', metadata:claimedMetadata })
          .eq('id',body.generationId).eq('user_id',user.id).eq('type','video').eq('status','pending');
        claim = pending.taskId == null ? claim.is('task_id',null) : claim.eq('task_id',pending.taskId);
        claim = pending.originalMetadata == null ? claim.is('metadata',null) : claim.eq('metadata',JSON.stringify(pending.originalMetadata));
        const {data: claimed, error: claimError} = await claim.select('id').maybeSingle();
        if (claimError || !claimed) await guard.finish('rejected');
        if (claimError) return res.status(503).json({ error: 'The saved video could not be claimed. No provider request was sent.' });
        if (!claimed) return res.status(409).json({ code: 'GENERATION_SUBMITTING', error: 'This saved video is already being submitted. Check the existing task instead of submitting again.' });
        galleryClaim = { id: body.generationId, metadata: claimedMetadata };
      }
      const response = await fetch(`${FAL_QUEUE_BASE}/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        redirect: 'error', signal: AbortSignal.timeout(55_000),
        body: JSON.stringify(input),
      });
      await guard.finish(response.ok ? 'completed' : 'failed', null, response.status);
      const data = await readJson(response);
      if (!response.ok) {
        const error = extractFalErrorMessage(data?.detail ?? data?.error ?? data?.message ?? data);
        // A definitive provider rejection may finish the card. Keep the admission
        // marker: reusing this ID must never issue another billable submission.
        if (galleryClaim && response.status >= 400 && response.status < 500 && response.status !== 408) {
          await registry.from('generations').update({ status: 'failed', metadata: { ...galleryClaim.metadata, error } })
            .eq('id', galleryClaim.id).eq('user_id', user.id).eq('status','processing').eq('metadata',JSON.stringify(galleryClaim.metadata));
        }
        return res.status(response.status).json({ error });
      }
      if (typeof data?.request_id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.request_id)) return res.status(502).json({ error: 'fal.ai response missing request_id' });
      await registerProviderTask(registry, 'fal', data.request_id, user.id);
      // The REST submit response is authoritative for lifecycle routing. Some
      // model IDs submit at a sub-route while fal serves status/result from the
      // parent queue app, so do not reconstruct this path from the model ID.
      const queueEndpoint = queueEndpointFromFalUrl(data.status_url, data.request_id, 'status', endpoint, parent)
        || queueEndpointFromFalUrl(data.response_url, data.request_id, 'response', endpoint, parent)
        || parent;
      if (galleryClaim) {
        const { data: saved, error: saveError } = await registry.from('generations')
          .update({ task_id: data.request_id, status: 'processing', metadata: { ...galleryClaim.metadata, falQueueEndpoint: queueEndpoint } })
          .eq('id', galleryClaim.id).eq('user_id', user.id).eq('type','video').eq('status','processing')
          .eq('metadata',JSON.stringify(galleryClaim.metadata)).select('id').maybeSingle();
        if (saveError || !saved) {
          if (!isOmni) await recordH3Usage(registry, { taskId: data.request_id, userId: user.id, mode: mode as H3MaxMode,
            prompt: typeof body.prompt === 'string' ? body.prompt : '', generationId: galleryClaim.id, estimatedCostUsd });
          return res.status(503).json({
            error: `fal.ai accepted this video, but its saved task could not be updated (Task: ${data.request_id}). Do not submit again; check task history or contact an administrator.`,
            taskId: data.request_id, endpoint, queueEndpoint,
          });
        }
      }
      // Accepted provider requests are logged on the server, independently of
      // the browser receiving this acknowledgement or remaining open.
      if (!isOmni) await recordH3Usage(registry, { taskId: data.request_id, userId: user.id, mode: mode as H3MaxMode,
        prompt: typeof body.prompt === 'string' ? body.prompt : '', generationId: galleryClaim?.id, estimatedCostUsd });
      return res.status(200).json({
        taskId: data.request_id,
        endpoint,
        queueEndpoint,
      });
    }

    const requestId = req.query.requestId as string;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(requestId)) return res.status(400).json({ error: 'Valid requestId is required' });
    const requestedEndpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint : H3_MAX_QUEUE_APP;
    if (!ALLOWED_QUEUE_ENDPOINTS.has(requestedEndpoint)) {
      return res.status(400).json({ error: 'Invalid MiniMax H3 queue endpoint' });
    }
    if (!await requireProviderTask(req, res, 'fal', requestId)) return;
    const terminalFailure = async (providerState: string, message: string) => {
      const actualCostUsd = await getActualRequestCost(requestId, apiKey);
      await persistFalFailure(prepareTaskRegistry, user.id, requestId, providerState, message, actualCostUsd, !requestedEndpoint.startsWith(OMNI_QUEUE_APP));
      return res.status(200).json({ status: providerState === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        error: message, progress: 0, actualCostUsd,
      });
    };


    // Backward compatibility for tasks accepted before queueEndpoint was
    // persisted: try the submitted model route and its parent queue app. This
    // also recovers already-completed H3 Max cards that were polling the wrong
    // lifecycle route.
    const fallbackQueueEndpoint = requestedEndpoint.split('/').slice(0, 2).join('/');
    const queueCandidates = fallbackQueueEndpoint && fallbackQueueEndpoint !== requestedEndpoint
      ? [requestedEndpoint, fallbackQueueEndpoint]
      : [requestedEndpoint];

    let selectedStatus: { endpoint: string; response: Response; data: any } | undefined;
    let lastStatusFailure: { response?: Response; data?: any; error?: Error } | undefined;
    for (const endpoint of queueCandidates) {
      const response = await fetch(
        `${FAL_QUEUE_BASE}/${endpoint}/requests/${encodeURIComponent(requestId)}/status`,
        {
          headers: { Authorization: `Key ${apiKey}` },
          redirect: 'error', signal: AbortSignal.timeout(45_000),
          cache: 'no-store',
        },
      );
      let data: any;
      try {
        data = await readJson(response);
      } catch (error: any) {
        lastStatusFailure = { response, error };
        continue;
      }
      if (!response.ok) {
        lastStatusFailure = { response, data };
        continue;
      }

      selectedStatus = { endpoint, response, data };
      if (data?.status === 'COMPLETED' || data?.status === 'ERROR' || data?.status === 'CANCELLED') {
        break;
      }
    }

    if (!selectedStatus) {
      if (lastStatusFailure?.error) throw lastStatusFailure.error;
      const statusResponse = lastStatusFailure?.response;
      const statusData = lastStatusFailure?.data;
      const message = extractFalErrorMessage(statusData?.detail ?? statusData?.error ?? statusData?.message ?? statusData);
      const after = statusResponse?.headers?.get('retry-after');
      if (statusResponse?.status === 429 && after && /^\d+$/.test(after)) res.setHeader('Retry-After', after);
      // A failed lookup is not a terminal provider task state.
      return res.status(statusResponse?.status || 502).json({ error: message, retryable: true });
    }

    const { endpoint: selectedQueueEndpoint, data: statusData } = selectedStatus;
    if (statusData?.status === 'COMPLETED') {
      // fal reports a failed request as COMPLETED with `error`; its result
      // route repeats the model's error status instead of returning a video.
      if (statusData?.error || statusData?.error_type) return terminalFailure(statusData.error_type === 'client_cancelled' ? 'CANCELLED' : 'ERROR', extractFalErrorMessage(statusData.error || statusData.error_type));
      const resultResponse = await fetch(
        // Match @fal-ai/client's queue.result() lifecycle route. The REST
        // submit payload may expose a convenience response_url ending in
        // /response, while the current JS client resolves results here.
        `${FAL_QUEUE_BASE}/${selectedQueueEndpoint}/requests/${encodeURIComponent(requestId)}`,
        {
          headers: { Authorization: `Key ${apiKey}` },
          cache: 'no-store',
        },
      );
      const resultData = await readJson(resultResponse);
      if (!resultResponse.ok) {
        const message = extractFalErrorMessage(resultData?.detail ?? resultData?.error ?? resultData?.message ?? resultData);
        if (RETRYABLE_LOOKUP_STATUSES.has(resultResponse.status)) {
          return res.status(resultResponse.status).json({ error: message, retryable: true });
        }
        if ([400, 422].includes(resultResponse.status)) return terminalFailure('RESULT_ERROR', message);
        return res.status(resultResponse.status).json({ error: message, retryable: true });
      }

      if (resultData?.error || resultData?.error_type) return terminalFailure('RESULT_ERROR', extractFalErrorMessage(resultData.error || resultData.error_type));
      const videoUrl = resultData?.video?.url || resultData?.data?.video?.url;
      if (typeof videoUrl !== 'string' || !/^https?:\/\//i.test(videoUrl)) {
        return res.status(502).json({ error: 'fal.ai completed the task without a video URL', retryable: true });
      }
      const actualCostUsd = await getActualRequestCost(requestId, apiKey);
      return res.status(200).json({
        status: 'SUCCEEDED',
        output: [videoUrl],
        progress: 1,
        expandedPrompt: resultData?.expanded_prompt || resultData?.data?.expanded_prompt || null,
        actualCostUsd,
        duration: resultData?.duration ?? resultData?.data?.duration ?? null,
      });
    }

    if (statusData?.status === 'ERROR' || statusData?.status === 'CANCELLED') {
      return terminalFailure(statusData.status, extractFalErrorMessage(
        statusData?.error_message ?? statusData?.detail ?? statusData?.error ?? statusData?.message,
      ));
    }

    return res.status(200).json({
      status: 'RUNNING',
      stage: statusData?.status || 'IN_QUEUE',
      progress: statusData?.status === 'IN_PROGRESS' ? 0.5 : 0.1,
    });
  } catch (error: any) {
    await guard?.finish('failed');
    console.error('fal MiniMax H3 video error:', error.message);
    return res.status(500).json({ error: error.message || 'MiniMax H3 generation failed' });
  }
}
