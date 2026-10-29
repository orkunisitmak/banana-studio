import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser } from './_lib/auth.js';
import { prepareTaskRegistry, registerProviderTask, requireProviderTask } from './_lib/providerTasks.js';
import { buildH3MaxInput, H3_MAX_ENDPOINTS } from '../src/lib/video/h3Max.js';
import { fetchFalRequestCosts } from './_lib/falBillingCosts.js';
import { recordH3Usage } from './_lib/h3Usage.js';
import { estimateH3MaxCost } from '../src/lib/video/h3MaxPricing.js';
import type { GenerationConfig } from '../src/types.js';

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
  // Polling-only compatibility for generations submitted before Max-only routing.
  LEGACY_H3_QUEUE_APP, LEGACY_H3_REFERENCE_ENDPOINT,
]);

const queueEndpointFromFalUrl = (
  rawUrl: unknown,
  requestId: string,
  lifecycle: 'status' | 'response',
): string | undefined => {
  if (typeof rawUrl !== 'string') return undefined;
  try {
    const url = new URL(rawUrl);
    if (url.origin !== FAL_QUEUE_BASE) return undefined;
    const suffix = `/requests/${encodeURIComponent(requestId)}/${lifecycle}`;
    if (!url.pathname.endsWith(suffix)) return undefined;
    const endpoint = url.pathname.slice(1, -suffix.length);
    return ALLOWED_QUEUE_ENDPOINTS.has(endpoint) ? endpoint : undefined;
  } catch {
    return undefined;
  }
};

const extractFalErrorMessage = (raw: unknown): string => {
  if (!raw) return 'MiniMax H3 generation failed';
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
  return 'MiniMax H3 generation failed';
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

/** Persist only a provider-confirmed terminal state. Optional bookkeeping cannot
 * hide its error, erase a completed result, or overwrite concurrent metadata. */
const persistH3Terminal = async (
  userId: string, requestId: string, providerState: string, message: string, actualCostUsd?: number,
): Promise<void> => {
  try {
    // The provider result remains authoritative if the bookkeeping DB is down.
    const silent = { status: () => silent, json: () => silent } as unknown as VercelResponse;
    const db = await prepareTaskRegistry(silent);
    if (!db) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error } = await db.from('generations').select('id,user_id,type,status,task_id,metadata')
        .eq('task_id', requestId).eq('user_id', userId).eq('type', 'video').maybeSingle();
      if (error || !row || row.status === 'completed') return;
      const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {};
      const patch = { ...metadata, error: message, h3TerminalState: providerState, h3TerminalDetectedAt: new Date().toISOString(),
        ...(actualCostUsd !== undefined ? { generationCost: { usd: actualCostUsd, source: 'provider_actual' } } : {}),
      };
      let update = db.from('generations').update({ status: 'failed', metadata: patch })
        .eq('id', row.id).eq('user_id', userId).eq('task_id', requestId).eq('type', 'video').eq('status', row.status);
      update = row.metadata == null ? update.is('metadata', null) : update.eq('metadata', JSON.stringify(row.metadata));
      const saved = await update.select('id').maybeSingle();
      if (saved.error) return;
      if (saved.data) return;
    }
  } catch {
    console.warn('Confirmed H3 terminal state could not be saved', requestId);
  }
};

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  const apiKey = process.env.FAL_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FAL_KEY not configured on server' });

  try {
    if (req.method === 'POST') {
      let prepared: ReturnType<typeof buildH3MaxInput>;
      let body: any;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        prepared = buildH3MaxInput(body);
        if (body.generationId !== undefined && (typeof body.generationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(body.generationId))) throw new Error('A valid generation ID is required');
      } catch (error: any) {
        return res.status(400).json({ error: error?.message || 'Invalid MiniMax H3 Max request' });
      }
      const { endpoint, input, mode } = prepared;
      const estimatedCostUsd = estimateH3MaxCost({
        h3MaxMode: mode, h3MaxOptions: body.options,
        videoQuality: String(input.resolution || body.resolution || '768P'),
        videoDuration: Number(input.duration || body.duration) || 5,
        referenceImages: (body.imageUrls || []).map((_: unknown, index: number) => ({ id: `request-image-${index}`, ...body.mediaMetadata?.images?.[index] })),
        referenceVideos: (body.videoUrls || []).map((_: unknown, index: number) => ({ ...body.mediaMetadata?.videos?.[index] })),
        referenceAudios: (body.audioUrls || []).map((_: unknown, index: number) => ({ ...body.mediaMetadata?.audios?.[index] })),
      } as GenerationConfig).usd;

      const registry = await prepareTaskRegistry(res);
      if (!registry) return;
      let galleryClaim: { id: string; metadata: Record<string, unknown> } | undefined;
      if (body.generationId) {
        const { data: saved, error: readError } = await registry.from('generations')
          .select('id,user_id,type,status,task_id,metadata').eq('id', body.generationId).eq('user_id', user.id).maybeSingle();
        if (readError) return res.status(503).json({ error: 'Saved generation access could not be verified. No provider request was sent.' });
        if (!saved || saved.user_id !== user.id || saved.type !== 'video') return res.status(404).json({ error: 'Saved video generation not found' });
        const metadata = saved.metadata && typeof saved.metadata === 'object' && !Array.isArray(saved.metadata) ? saved.metadata : {};
        if (saved.task_id) {
          if (!await requireProviderTask(req, res, 'fal', saved.task_id)) return;
          const savedEndpoint = typeof metadata.falEndpoint === 'string' && ALLOWED_QUEUE_ENDPOINTS.has(metadata.falEndpoint) ? metadata.falEndpoint : H3_MAX_QUEUE_APP;
          const savedQueueEndpoint = typeof metadata.falQueueEndpoint === 'string' && ALLOWED_QUEUE_ENDPOINTS.has(metadata.falQueueEndpoint) ? metadata.falQueueEndpoint : savedEndpoint;
          return res.status(200).json({ taskId: saved.task_id, endpoint: savedEndpoint, queueEndpoint: savedQueueEndpoint });
        }
        if (saved.status !== 'pending' || metadata.h3SubmissionStartedAt) return res.status(409).json({
          code: 'GENERATION_SUBMITTING', error: 'This saved video was already submitted or its acceptance is uncertain. Do not submit again; check its saved task history and usage.',
        });
        const claimedMetadata = { ...metadata, h3SubmissionStartedAt: Date.now(), h3MaxMode: mode, falEndpoint: endpoint };
        const { data: claimed, error: claimError } = await registry.from('generations')
          .update({ status: 'processing', metadata: claimedMetadata }).eq('id', body.generationId).eq('user_id', user.id).eq('status', 'pending').select('id').maybeSingle();
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
        body: JSON.stringify(input),
      });
      const data = await readJson(response);
      if (!response.ok) {
        const error = extractFalErrorMessage(data?.detail ?? data?.error ?? data?.message ?? data);
        // A definitive provider rejection may finish the card. Keep the admission
        // marker: reusing this ID must never issue another billable submission.
        if (galleryClaim && response.status >= 400 && response.status < 500) {
          await registry.from('generations').update({ status: 'failed', metadata: { ...galleryClaim.metadata, error } })
            .eq('id', galleryClaim.id).eq('user_id', user.id);
        }
        return res.status(response.status).json({ error });
      }
      if (!data?.request_id) return res.status(502).json({ error: 'fal.ai response missing request_id' });
      await registerProviderTask(registry, 'fal', data.request_id, user.id);
      // The REST submit response is authoritative for lifecycle routing. Some
      // model IDs submit at a sub-route while fal serves status/result from the
      // parent queue app, so do not reconstruct this path from the model ID.
      const queueEndpoint = queueEndpointFromFalUrl(data.status_url, data.request_id, 'status')
        || queueEndpointFromFalUrl(data.response_url, data.request_id, 'response')
        || endpoint;
      if (galleryClaim) {
        const { data: saved, error: saveError } = await registry.from('generations')
          .update({ task_id: data.request_id, status: 'processing', metadata: { ...galleryClaim.metadata, falEndpoint: endpoint, falQueueEndpoint: queueEndpoint, h3MaxMode: mode } })
          .eq('id', galleryClaim.id).eq('user_id', user.id).select('id').maybeSingle();
        if (saveError || !saved) {
          await recordH3Usage(registry, { taskId: data.request_id, userId: user.id, mode,
            prompt: typeof body.prompt === 'string' ? body.prompt : '', generationId: galleryClaim.id, estimatedCostUsd });
          return res.status(503).json({
            error: `fal.ai accepted this video, but its saved task could not be updated (Task: ${data.request_id}). Do not submit again; check task history or contact an administrator.`,
            taskId: data.request_id, endpoint, queueEndpoint,
          });
        }
      }
      // Accepted provider requests are logged on the server, independently of
      // the browser receiving this acknowledgement or remaining open.
      await recordH3Usage(registry, { taskId: data.request_id, userId: user.id, mode,
        prompt: typeof body.prompt === 'string' ? body.prompt : '', generationId: galleryClaim?.id, estimatedCostUsd });
      return res.status(200).json({
        taskId: data.request_id,
        endpoint,
        queueEndpoint,
      });
    }

    const requestId = req.query.requestId as string;
    if (!requestId) return res.status(400).json({ error: 'requestId is required' });
    const requestedEndpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint : H3_MAX_QUEUE_APP;
    if (!ALLOWED_QUEUE_ENDPOINTS.has(requestedEndpoint)) {
      return res.status(400).json({ error: 'Invalid MiniMax H3 queue endpoint' });
    }
    if (!await requireProviderTask(req, res, 'fal', requestId)) return;
    const terminalFailure = async (providerState: string, message: string) => {
      const actualCostUsd = await getActualRequestCost(requestId, apiKey);
      await persistH3Terminal(user.id, requestId, providerState, message, actualCostUsd);
      return res.status(200).json({ status: providerState === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        error: message, progress: 0, actualCostUsd,
      });
    };


    // Backward compatibility for tasks accepted before queueEndpoint was
    // persisted: try the submitted model route and its parent queue app. This
    // also recovers already-completed H3 Max cards that were polling the wrong
    // lifecycle route.
    const fallbackQueueEndpoint = requestedEndpoint.startsWith(`${H3_MAX_QUEUE_APP}/`)
      ? H3_MAX_QUEUE_APP
      : requestedEndpoint.startsWith(`${LEGACY_H3_QUEUE_APP}/`)
        ? LEGACY_H3_QUEUE_APP
        : undefined;
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
      if (statusResponse && RETRYABLE_LOOKUP_STATUSES.has(statusResponse.status)) {
        return res.status(statusResponse.status).json({ error: message, retryable: true });
      }
      if (statusResponse && statusResponse.status >= 400 && statusResponse.status < 500) {
        return res.status(200).json({ status: 'FAILED', error: message, progress: 0 });
      }
      return res.status(statusResponse?.status || 502).json({ error: message });
    }

    const { endpoint: selectedQueueEndpoint, data: statusData } = selectedStatus;
    if (statusData?.status === 'COMPLETED') {
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
        if (resultResponse.status === 422) return terminalFailure('RESULT_ERROR', message);
        if (resultResponse.status >= 400 && resultResponse.status < 500) {
          return res.status(200).json({ status: 'FAILED', error: message, progress: 0 });
        }
        return res.status(resultResponse.status).json({ error: message });
      }

      const videoUrl = resultData?.video?.url || resultData?.data?.video?.url;
      if (typeof videoUrl !== 'string' || !/^https?:\/\//i.test(videoUrl)) {
        return res.status(502).json({ error: 'fal.ai completed MiniMax H3 generation without a video URL' });
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
    console.error('fal MiniMax H3 video error:', error.message);
    return res.status(500).json({ error: error.message || 'MiniMax H3 generation failed' });
  }
}
