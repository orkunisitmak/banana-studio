import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createUserScopedClient, requireUser } from './_lib/auth.js';
import { requireProviderTask } from './_lib/providerTasks.js';

import { SEEDREAM_ENDPOINTS, isSeedreamEndpoint } from '../src/lib/images/seedream55.js';
import { readFalImageStatus } from './_lib/falImageStatus.js';

export const config = { maxDuration: 300 };

const ALLOWED_ENDPOINTS = new Set([
  'openai/gpt-image-2',
  'openai/gpt-image-2/edit',
  'fal-ai/nano-banana-pro',
  'fal-ai/nano-banana-pro/edit',
  'google/nano-banana-2.1',
  'google/nano-banana-2.1/edit',
  ...Object.values(SEEDREAM_ENDPOINTS),
  ...['2.5/sunburst','2.6/sunburst','2.6/flare'].flatMap(model => ['text-to-image','edit'].map(action => 'openai/gpt-image-' + model + '/' + action)),
  // Historical Nano Banana 2 jobs/billing remain available.
  'fal-ai/nano-banana-2',
  'fal-ai/nano-banana-2/edit',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const requestId = req.query.requestId as string;
  const endpoint = req.query.endpoint as string;
  if (!requestId) return res.status(400).json({ error: 'requestId is required' });
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return res.status(400).json({ error: 'invalid endpoint' });
  }
  if (!await requireProviderTask(req, res, 'fal', requestId)) return;

  try {
    const {http, body} = await readFalImageStatus(endpoint, requestId, process.env.FAL_KEY, user.id, isSeedreamEndpoint(endpoint) ? createUserScopedClient(req) : null);
    return res.status(http).json(body);
  } catch (error: any) {
    console.error('fal status error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to check fal task status' });
  }
}
