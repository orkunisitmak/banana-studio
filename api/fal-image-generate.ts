import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser } from './_lib/auth.js';
import { prepareTaskRegistry, registerProviderTask } from './_lib/providerTasks.js';
import { getNanoBanana21InputError, NANO_BANANA_21_ENDPOINT } from '../src/lib/images/nanoBanana21.js';

const FAL_QUEUE_BASE = 'https://queue.fal.run';

// Only active models can be submitted. fal-status.ts additionally permits
// retired GPT Image 2 endpoints so existing paid tasks can still be recovered.
const ALLOWED_ENDPOINTS = new Set([
  'fal-ai/nano-banana-pro',
  'fal-ai/nano-banana-pro/edit',
  'google/nano-banana-2.1',
  'google/nano-banana-2.1/edit',
]);

// Fields we are willing to forward to fal. Anything not in this list is
// dropped before the upstream call so a malicious client can't smuggle
// arbitrary `webhookUrl`-style options to fal under our key.
const FORWARDABLE_INPUT_KEYS = new Set([
  'prompt',
  'image_urls',
  'image_size',
  'aspect_ratio',
  'resolution',
  'output_format',
  'safety_tolerance',
  'quality',
  'num_images',
  'seed',
  'system_prompt',
  'limit_generations',
  'enable_web_search',
  'thinking_level',
  'sync_mode',
]);

interface FalGenerateRequest {
  endpoint?: string;
  prompt?: string;
  input?: Record<string, unknown>;
}

const sanitizeInput = (raw: Record<string, unknown> | undefined): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (FORWARDABLE_INPUT_KEYS.has(k) && v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out;
};

export const config = {
  api: {
    bodyParser: { sizeLimit: '4mb' },
  },
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const apiKey = process.env.FAL_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FAL_KEY not configured on server' });

  let body: FalGenerateRequest;
  try {
    body =
      typeof req.body === 'string'
        ? (JSON.parse(req.body) as FalGenerateRequest)
        : (req.body as FalGenerateRequest);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  if (!body?.endpoint || body.endpoint === 'openai/gpt-image-2' || body.endpoint === 'openai/gpt-image-2/edit') {
    return res.status(410).json({ error: 'GPT Image 2 has been removed. Select GPT Image 2.5 Sunburst.' });
  }

  if (body.endpoint === 'fal-ai/nano-banana-2' || body.endpoint === 'fal-ai/nano-banana-2/edit') {
    return res.status(410).json({ error: 'Nano Banana 2 has been replaced by Nano Banana 2.1. Refresh the app before generating.' });
  }

  const endpoint = body.endpoint;
  if (body.input?.mask_url != null || body.input?.mask != null) {
    return res.status(400).json({ error: 'Inpaint has been removed. Refresh the app and submit a regular image edit.' });
  }
  const input = sanitizeInput(body.input);
  if (!input.prompt && body.prompt) input.prompt = body.prompt;

  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return res.status(400).json({ error: `Unsupported fal endpoint: ${endpoint}` });
  }

  if (!input.prompt || typeof input.prompt !== 'string' || !input.prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  if (endpoint === NANO_BANANA_21_ENDPOINT || endpoint === `${NANO_BANANA_21_ENDPOINT}/edit`) {
    const error = getNanoBanana21InputError(input, endpoint.endsWith('/edit'));
    if (error) return res.status(400).json({ error });
    // These are GPT Image fields, not part of Nano Banana 2.1's contract.
    delete input.image_size;
    delete input.quality;
  }

  if (endpoint.endsWith('/edit')) {
    const urls = input.image_urls;
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'image_urls is required for edit endpoints' });
    }
  }

  try {
    const registry = await prepareTaskRegistry(res);
    if (!registry) return;
    const response = await fetch(`${FAL_QUEUE_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    let data: any;
    // Read the body once: after json() fails, text() is always empty.
    const text = await response.text().catch(() => '');
    try {
      data = JSON.parse(text);
    } catch {
      return res
        .status(502)
        .json({ error: `fal.ai returned non-JSON response (${response.status}): ${text.slice(0, 160)}` });
    }

    if (!response.ok) {
      const errMsg =
        data?.detail?.[0]?.msg ||
        data?.detail ||
        data?.error?.message ||
        data?.message ||
        JSON.stringify(data);
      return res
        .status(response.status)
        .json({ error: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg) });
    }

    if (!data.request_id) {
      return res.status(502).json({ error: 'fal.ai response missing request_id', raw: data });
    }

    await registerProviderTask(registry, 'fal', data.request_id, user.id);

    console.log(
      `[fal-submit] endpoint=${endpoint} request_id=${data.request_id}`,
    );

    return res.status(200).json({ requestId: data.request_id, endpoint });
  } catch (error: any) {
    console.error('fal image generate error:', error.message);
    return res.status(500).json({ error: error.message || 'Image generation failed' });
  }
}
