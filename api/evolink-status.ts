import type { VercelRequest, VercelResponse } from '@vercel/node';
import { describeEvoLinkFailure } from './_lib/evolink-errors.js';
import { applyCors, requireUser } from './_lib/auth.js';
import { requireProviderTask } from './_lib/providerTasks.js';

const EVOLINK_BASE = 'https://api.evolink.ai';

const normalizeProgress = (progress: unknown): number => {
  const numeric = typeof progress === 'number' ? progress : Number(progress ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric / 100));
};

const extractResultUrls = (data: any): string[] => {
  const candidates = [
    ...(Array.isArray(data?.results) ? data.results : []),
    ...(Array.isArray(data?.result_data) ? data.result_data : []),
    ...(Array.isArray(data?.outputs) ? data.outputs : []),
  ];

  return [...new Set(candidates
    .map(item => typeof item === 'string' ? item : item?.url || item?.video_url || item?.output_url)
    .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)))];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const apiKey = process.env.EVOLINK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'EvoLink API key not configured' });

  const taskId = req.query.taskId as string;
  if (typeof taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(taskId)) return res.status(400).json({ error: 'Invalid EvoLink task ID.' });
  if (!await requireProviderTask(req, res, 'evolink', taskId)) return;

  try {
    const response = await fetch(`${EVOLINK_BASE}/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      redirect: 'error', signal: AbortSignal.timeout(45_000),
      cache: 'no-store',
    });
    if (response.status === 429) {
      const retryAfter = response.headers?.get('retry-after');
      if (retryAfter && /^\d+$/.test(retryAfter)) res.setHeader('Retry-After', retryAfter);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      return response.status === 429
        ? res.status(429).json({ error: 'EvoLink status checks are rate limited.', retryable: true })
        : res.status(502).json({ error: `EvoLink returned non-JSON response (${response.status})` });
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(502).json({ error: 'EvoLink returned an invalid task status response.', retryable: true });
    }

    const status = String(data.status || '').toLowerCase();
    const progress = normalizeProgress(data.progress);
    if (!response.ok) {
      return res.status(response.status).json({
        error: describeEvoLinkFailure(data, 'EvoLink status check', taskId),
        retryable: response.status === 402 || response.status === 429 || response.status >= 500,
      });
    }
    const output = extractResultUrls(data);

    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      if (output.length === 0) {
        return res.status(503).json({
          error: 'EvoLink reports the task as completed, but the result URL is not available yet.',
          retryable: true,
        });
      }
      return res.status(200).json({
        status: 'SUCCEEDED',
        output,
        progress: 1,
        usage: data.usage || null,
        actualCostUsd: data.usage?.cost?.usd,
        // `duration` measures task runtime; only `video_duration` measures footage.
        duration: data.video_duration,
      });
    }


    if (status === 'failed' || status === 'failure' || status === 'error') {
      return res.status(200).json({
        status: 'FAILED',
        error: describeEvoLinkFailure(data, `EvoLink ${data?.model || 'video generation'}`, taskId),
        progress: 0,
      });
    }

    if (status === 'cancelled' || status === 'canceled') {
      return res.status(200).json({
        status: 'CANCELLED',
        error: describeEvoLinkFailure(data, 'EvoLink cancelled the video task', taskId),
        progress: 0,
      });
    }

    if (status !== 'processing' && status !== 'pending') {
      return res.status(502).json({ error: 'EvoLink returned an unrecognized task status.', retryable: true });
    }
    return res.status(200).json({
      status: 'RUNNING',
      progress,
    });
  } catch (error: any) {
    console.error('EvoLink status error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to check task status' });
  }
}
