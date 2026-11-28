import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createUserScopedClient, requireUser } from './_lib/auth.js';
import { startPaidRequest, type PaidRequest } from './_lib/openaiGuard.js';
import { prepareTaskRegistry, registerProviderTask } from './_lib/providerTasks.js';
import { getNanoBananaInputError, NANO_BANANA_21_ENDPOINT, NANO_BANANA_21_MODEL, NANO_BANANA_PRO_ENDPOINT, NANO_BANANA_PRO_MODEL } from '../src/lib/images/nanoBanana21.js';
import { admitProvider } from './_lib/providerConfiguration.js';
import { providerImageUrl } from './_lib/providerMedia.js';
import { isSeedreamEndpoint, SEEDREAM_ENDPOINTS, SEEDREAM_MODEL, validateSeedreamInput } from '../src/lib/images/seedream55.js';

const FAL_QUEUE_BASE = 'https://queue.fal.run';

// Only active models can be submitted. fal-status.ts additionally permits
// retired GPT Image 2 endpoints so existing paid tasks can still be recovered.
const ENDPOINT_MODELS = new Map<string, string>([
  [NANO_BANANA_PRO_ENDPOINT, NANO_BANANA_PRO_MODEL], [`${NANO_BANANA_PRO_ENDPOINT}/edit`, NANO_BANANA_PRO_MODEL],
  [NANO_BANANA_21_ENDPOINT, NANO_BANANA_21_MODEL], [`${NANO_BANANA_21_ENDPOINT}/edit`, NANO_BANANA_21_MODEL],
  ...Object.values(SEEDREAM_ENDPOINTS).map(endpoint => [endpoint, SEEDREAM_MODEL] as const),
]);

// Fields we are willing to forward to fal. Anything not in this list is
// dropped before the upstream call so a malicious client can't smuggle
// arbitrary `webhookUrl`-style options to fal under our key.
const FORWARDABLE_INPUT_KEYS = new Set([
  'prompt',
  'image_urls',
  'aspect_ratio',
  'resolution',
  'output_format',
  'safety_tolerance',
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
  const isSeedream = isSeedreamEndpoint(endpoint);
  if (isSeedream && body.input !== undefined && (!body.input || typeof body.input !== 'object' || Array.isArray(body.input))) {
    return res.status(400).json({ error: 'Seedream input must be an object.' });
  }
  // Seedream has disjoint per-mode schemas. Validate the original keys rather
  // than silently stripping an edit reference or permitting Nano-only options.
  const input = isSeedream ? { ...body.input } : sanitizeInput(body.input);
  if (body.prompt && (isSeedream ? input.prompt === undefined : !input.prompt)) input.prompt = body.prompt;

  const model = ENDPOINT_MODELS.get(endpoint);
  if (!model) {
    return res.status(400).json({ error: `Unsupported fal endpoint: ${endpoint}` });
  }

  if (isSeedream) {
    const error = validateSeedreamInput(endpoint, input);
    if (error) return res.status(400).json({ error });
  } else {
    if (['video_url','pdf_url','context','history'].some(key => body.input?.[key] != null)) {
      return res.status(400).json({ error: 'Banana supports still-image references, not video, PDF or conversation inputs on this route.' });
    }
    const error = getNanoBananaInputError(input, endpoint);
    if (error) return res.status(400).json({ error });
  }

  let acceptedTaskId: string | undefined;
  let guard: PaidRequest = null;
  try {
    const registry = await prepareTaskRegistry(res);
    if (!registry) return;
    if (!await admitProvider(req, res, model, 'fal')) return;
    if (input.image_url || input.image_urls) {
      const db = createUserScopedClient(req);
      if (typeof input.image_url === 'string') input.image_url = await providerImageUrl(db, input.image_url);
      if (Array.isArray(input.image_urls)) input.image_urls = await Promise.all(input.image_urls.map(url => providerImageUrl(db,url)));
    }
    guard = await startPaidRequest(req, res, user, 'image', 'fal.ai');
    if (!guard) return;
    const response = await fetch(`${FAL_QUEUE_BASE}/${endpoint}`, {
      redirect: 'error', signal: AbortSignal.timeout(45_000),
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'X-Fal-No-Retry': '1',
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
      await guard.finish('failed', null, response.status);
      return res
        .status(502)
        .json({ error: `fal.ai returned non-JSON response (${response.status}): ${text.slice(0, 160)}` });
    }

    if (!response.ok) {
      await guard.finish('failed', null, response.status);
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

    if (typeof data?.request_id !== 'string' || !data.request_id || data.request_id.length > 200) {
      await guard.finish('failed', null, response.status);
      return res.status(502).json({ error: 'fal.ai response missing request_id' });
    }

    acceptedTaskId = data.request_id;
    await guard.finish('completed', acceptedTaskId, response.status);
    await registerProviderTask(registry, 'fal', data.request_id, user.id);
    // Low-level API callers also own a gallery manifest. Never persist wire
    // references here: they can contain data URIs or temporary access tokens.
    let generationId: string | undefined;
    if (isSeedream) {
      generationId = randomUUID();
      const mode = endpoint === SEEDREAM_ENDPOINTS.layerize ? 'layerize' : endpoint === SEEDREAM_ENDPOINTS.edit ? 'edit' : 'text-to-image';
      const { error } = await registry.from('generations').insert({ id:generationId, user_id:user.id, type:'image', status:'processing', image_model:SEEDREAM_MODEL, task_id:acceptedTaskId, url:'', prompt:input.prompt || '', aspect_ratio:'1:1', resolution:'2K', created_at:Date.now(), is_favorite:false,
        metadata:{ generationProvider:'fal', providerModel:endpoint, falEndpoint:endpoint, falRequestId:acceptedTaskId, generationStartedAt:Date.now(), seedreamInputCount: Array.isArray(input.image_urls) ? input.image_urls.length : input.image_url ? 1 : 0,
          seedreamOptions:{mode,...(mode === 'layerize' ? {layerSize:input.image_size, maxImages:input.max_images, enableTextRecognition:input.enable_text_recognition} : {imageSize:input.image_size, numImages:input.num_images, background:input.background}), outputFormat:input.output_format, watermark:input.watermark, enableSafetyChecker:input.enable_safety_checker, syncMode:input.sync_mode} } });
      if (error) throw new Error('Could not save the accepted Seedream generation. Check the task before generating again.');
    }

    console.log(
      `[fal-submit] endpoint=${endpoint} request_id=${data.request_id}`,
    );

    return res.status(200).json({ requestId: data.request_id, endpoint, ...(generationId ? {generationId} : {}) });
  } catch (error: any) {
    if (!acceptedTaskId) await guard?.finish('failed').catch(()=>{});
    console.error('fal image generate error:', error.message);
    return res.status(500).json({ error: error.message || 'Image generation failed', ...(acceptedTaskId ? { taskId: acceptedTaskId } : {}) });
  }
}
