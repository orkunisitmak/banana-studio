import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser } from './_lib/auth.js';
import { requireProviderTask } from './_lib/providerTasks.js';

const FAL_QUEUE_BASE = 'https://queue.fal.run';

const ALLOWED_ENDPOINTS = new Set([
  'openai/gpt-image-2',
  'openai/gpt-image-2/edit',
  'fal-ai/nano-banana-pro',
  'fal-ai/nano-banana-pro/edit',
  'google/nano-banana-2.1',
  'google/nano-banana-2.1/edit',
  // Historical Nano Banana 2 jobs/billing remain available.
  'fal-ai/nano-banana-2',
  'fal-ai/nano-banana-2/edit',
]);

// fal.ai's queue status/result endpoints live at the APP path, not the
// sub-action path. So a submit to `openai/gpt-image-2/edit` is polled at
// `openai/gpt-image-2/requests/{id}/status`. Stripping the trailing
// `/edit` (and any other action suffix) gives the correct queue base.
const queueBaseFor = (endpoint: string): string => {
  const idx = endpoint.indexOf('/edit');
  if (idx > 0) return endpoint.slice(0, idx);
  return endpoint;
};

/**
 * fal.ai returns 4xx errors as either a flat object or as a list of
 * pydantic-style {loc, msg, type, input} entries. The `input` field
 * echoes the entire request (prompt + every image_url) which is huge
 * and useless to surface in the UI — extract just the human-readable
 * message so the gallery's failure tile shows something compact.
 */
const extractFalErrorMessage = (raw: unknown): string => {
  if (!raw) return 'Image generation failed';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const msgs = raw
      .map((entry: any) => entry?.msg)
      .filter((m: unknown): m is string => typeof m === 'string' && m.length > 0);
    if (msgs.length > 0) return msgs.join(' • ');
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, any>;
    if (typeof obj.msg === 'string') return obj.msg;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    if (Array.isArray(obj.detail)) return extractFalErrorMessage(obj.detail);
  }
  return 'Image generation failed';
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const apiKey = process.env.FAL_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FAL_KEY not configured on server' });

  const requestId = req.query.requestId as string;
  const endpoint = req.query.endpoint as string;
  if (!requestId) return res.status(400).json({ error: 'requestId is required' });
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return res.status(400).json({ error: 'invalid endpoint' });
  }
  if (!await requireProviderTask(req, res, 'fal', requestId)) return;

  const queueBase = queueBaseFor(endpoint);

  try {
    // Fetch status (light) first to know whether to grab the result
    const statusRes = await fetch(
      `${FAL_QUEUE_BASE}/${queueBase}/requests/${encodeURIComponent(requestId)}/status`,
      { headers: { Authorization: `Key ${apiKey}` } }
    );

    let statusData: any;
    // Read the body once: after json() fails, text() is always empty.
    const text = await statusRes.text().catch(() => '');
    try {
      statusData = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: `fal.ai non-JSON status response (${statusRes.status}): ${text.slice(0, 120)}` });
    }

    if (!statusRes.ok) {
      const msg = extractFalErrorMessage(
        statusData?.detail ?? statusData?.error ?? statusData?.message ?? statusData,
      );
      // 422 / 4xx from fal on the *status* endpoint means the original
      // generation was rejected outright (content policy, invalid prompt,
      // unsupported reference image, …) — it will never succeed, so report
      // it as a permanent FAILED rather than letting the client retry the
      // same dead request five times.
      if (statusRes.status >= 400 && statusRes.status < 500) {
        return res.status(200).json({
          status: 'FAILED',
          error: msg,
          progress: 0,
        });
      }
      return res.status(statusRes.status).json({ error: msg });
    }

    const falStatus = statusData?.status;
    // fal status values observed: IN_QUEUE | IN_PROGRESS | COMPLETED | ERROR
    if (falStatus === 'COMPLETED') {
      const resultRes = await fetch(
        `${FAL_QUEUE_BASE}/${queueBase}/requests/${encodeURIComponent(requestId)}`,
        { headers: { Authorization: `Key ${apiKey}` } }
      );
      let resultData: any;
      try {
        resultData = await resultRes.json();
      } catch {
        return res.status(502).json({ error: 'fal.ai returned non-JSON result' });
      }
      if (!resultRes.ok) {
        const msg = extractFalErrorMessage(
          resultData?.detail ?? resultData?.error ?? resultData?.message ?? resultData,
        );
        // Same reasoning as above: a 4xx on the result endpoint means the
        // generation actually failed (typical case: Nano Banana refused to
        // produce an image because the prompt tripped its content filter).
        // Surface it as a permanent FAILED so the client stops retrying.
        if (resultRes.status >= 400 && resultRes.status < 500) {
          return res.status(200).json({
            status: 'FAILED',
            error: msg,
            progress: 0,
          });
        }
        return res.status(resultRes.status).json({ error: msg });
      }

      const images: string[] = Array.isArray(resultData?.images)
        ? resultData.images.map((img: any) => img?.url).filter((u: any): u is string => typeof u === 'string')
        : [];
      return res.status(200).json({ status: 'SUCCEEDED', output: images, progress: 1 });
    }

    if (falStatus === 'ERROR' || falStatus === 'CANCELLED') {
      const errMsg = extractFalErrorMessage(
        statusData?.error_message ?? statusData?.detail ?? statusData?.message ?? statusData,
      ) || (falStatus === 'CANCELLED' ? 'Generation was cancelled' : 'Generation failed');
      return res.status(200).json({
        status: falStatus === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        error: errMsg,
        progress: 0,
      });
    }

    // IN_QUEUE / IN_PROGRESS / unknown -> still running. fal doesn't expose a
    // real progress %, but we forward queue_position and stage so the client
    // can derive a smooth bar.
    return res.status(200).json({
      status: 'RUNNING',
      stage: falStatus, // 'IN_QUEUE' | 'IN_PROGRESS' | other
      queuePosition: typeof statusData?.queue_position === 'number' ? statusData.queue_position : null,
    });
  } catch (error: any) {
    console.error('fal status error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to check fal task status' });
  }
}
