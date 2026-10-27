import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser } from './_lib/auth.js';
import { startProviderRequest } from './_lib/openaiGuard.js';
import { prepareTaskRegistry, registerProviderTask, requireProviderTask } from './_lib/providerTasks.js';

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const SCALE_ENDPOINT = 'fal-ai/workflow-utilities/scale-video';
// fal treats `scale-video` as an endpoint path. Queue lifecycle routes attach
// to the owning app, so polling it as part of the app ID returns HTTP 405.
const SCALE_QUEUE_APP = 'fal-ai/workflow-utilities';

const extractFalErrorMessage = (raw: unknown): string => {
  if (!raw) return 'Video preprocessing failed';
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
  return 'Video preprocessing failed';
};

const readJson = async (response: Response): Promise<any> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`fal.ai returned a non-JSON response (${response.status}): ${text.slice(0, 120)}`);
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
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const videoUrl = body?.videoUrl;
      const width = Number(body?.width);
      const height = Number(body?.height);

      if (typeof videoUrl !== 'string' || !/^https?:\/\//i.test(videoUrl)) {
        return res.status(400).json({ error: 'A public HTTP(S) videoUrl is required' });
      }
      if (!Number.isInteger(width) || !Number.isInteger(height)
        || width < 300 || height < 300 || width > 6000 || height > 6000
        || width % 2 !== 0 || height % 2 !== 0) {
        return res.status(400).json({ error: 'Video dimensions must be even integers from 300 to 6000 pixels' });
      }

      const registry = await prepareTaskRegistry(res);
      if (!registry) return;
      const ticket = await startProviderRequest(req, res, user, 'video', 'fal');
      if (!ticket) return;
      const response = await ticket.track(fetch(`${FAL_QUEUE_BASE}/${SCALE_ENDPOINT}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_url: videoUrl,
          width,
          height,
          mode: 'stretch',
          codec: 'libx264',
          preset: 'fast',
          crf: 20,
        }),
      }));
      const data = await readJson(response);
      if (!response.ok) {
        return res.status(response.status).json({
          error: extractFalErrorMessage(data?.detail ?? data?.error ?? data?.message ?? data),
        });
      }
      if (!data?.request_id) {
        return res.status(502).json({ error: 'fal.ai response missing request_id' });
      }
      await registerProviderTask(registry, 'fal', data.request_id, user.id);
      return res.status(200).json({ requestId: data.request_id });
    }

    const requestId = req.query.requestId as string;
    if (!requestId) return res.status(400).json({ error: 'requestId is required' });
    if (!await requireProviderTask(req, res, 'fal', requestId)) return;

    const statusResponse = await fetch(
      `${FAL_QUEUE_BASE}/${SCALE_QUEUE_APP}/requests/${encodeURIComponent(requestId)}/status`,
      { headers: { Authorization: `Key ${apiKey}` } },
    );
    const statusData = await readJson(statusResponse);
    if (!statusResponse.ok) {
      return res.status(statusResponse.status).json({
        error: extractFalErrorMessage(statusData?.detail ?? statusData?.error ?? statusData?.message ?? statusData),
      });
    }

    if (statusData?.status === 'COMPLETED') {
      const resultResponse = await fetch(
        `${FAL_QUEUE_BASE}/${SCALE_QUEUE_APP}/requests/${encodeURIComponent(requestId)}`,
        { headers: { Authorization: `Key ${apiKey}` } },
      );
      const resultData = await readJson(resultResponse);
      if (!resultResponse.ok) {
        return res.status(resultResponse.status).json({
          error: extractFalErrorMessage(resultData?.detail ?? resultData?.error ?? resultData?.message ?? resultData),
        });
      }
      const videoUrl = resultData?.video?.url || resultData?.data?.video?.url;
      if (typeof videoUrl !== 'string' || !/^https?:\/\//i.test(videoUrl)) {
        return res.status(502).json({ error: 'fal.ai completed preprocessing without a video URL' });
      }
      return res.status(200).json({ status: 'SUCCEEDED', videoUrl });
    }

    if (statusData?.status === 'ERROR' || statusData?.status === 'CANCELLED') {
      return res.status(200).json({
        status: statusData.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        error: extractFalErrorMessage(
          statusData?.error_message ?? statusData?.detail ?? statusData?.error ?? statusData?.message,
        ),
      });
    }

    return res.status(200).json({ status: 'RUNNING', stage: statusData?.status || 'IN_QUEUE' });
  } catch (error: any) {
    console.error('fal video scale error:', error.message);
    return res.status(500).json({ error: error.message || 'Video preprocessing failed' });
  }
}
