import { AspectRatio, GenerationConfig, ImageModelId, ReferenceImage, Resolution } from '../types';
import { uploadBase64ToPublicUrl, refreshMediaAccessUrl } from './storageService';
import { supabase } from './authService';
import { NANO_BANANA_21_ENDPOINT, NANO_BANANA_21_MODEL, NANO_BANANA_2_LEGACY_MODEL } from '../lib/images/nanoBanana21';

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch { /* unauthenticated; the proxy will reject */ }
  return headers;
};

const POLL_INTERVAL = 1500;

// Map (aspectRatio, resolution) -> fal.ai image_size value. GPT Image 2 caps
// each edge at 3840 and total pixels at 8,294,400. The previous uniform scale
// treated the 1920x1080 canonical sample as a 1K baseline, causing 2K 16:9 to
// submit 3840x2160 and 4K to submit an invalid 7680x4320 request. These explicit
// targets preserve the app's 1K/2K/4K meaning while staying within fal limits.
type FalImageSize = string | { width: number; height: number };
const GPT_IMAGE_TARGET_DIMS: Record<Exclude<Resolution, '1K'>, Record<AspectRatio, { width: number; height: number }>> = {
  '2K': {
    '1:1': { width: 2048, height: 2048 },
    '4:3': { width: 2048, height: 1536 },
    '3:4': { width: 1536, height: 2048 },
    '16:9': { width: 2560, height: 1440 },
    '9:16': { width: 1440, height: 2560 },
  },
  '4K': {
    '1:1': { width: 2880, height: 2880 },
    '4:3': { width: 3312, height: 2480 },
    '3:4': { width: 2480, height: 3312 },
    '16:9': { width: 3840, height: 2160 },
    '9:16': { width: 2160, height: 3840 },
  },
};

const namedPresetFor = (aspectRatio: AspectRatio): string => {
  switch (aspectRatio) {
    case '1:1': return 'square_hd';
    case '4:3': return 'landscape_4_3';
    case '16:9': return 'landscape_16_9';
    case '3:4': return 'portrait_4_3';
    case '9:16': return 'portrait_16_9';
  }
};

export const mapAspectRatioToFalSize = (
  aspectRatio: AspectRatio,
  resolution: Resolution = '1K',
): FalImageSize => {
  if (resolution === '1K') return namedPresetFor(aspectRatio);
  return GPT_IMAGE_TARGET_DIMS[resolution][aspectRatio];
};

const resolveImageUrl = async (img: ReferenceImage): Promise<string | null> => {
  if (img.data.startsWith('http')) return refreshMediaAccessUrl(img.data);
  return uploadBase64ToPublicUrl(img.data, img.mimeType || '', 'iref', { throwOnError: true });
};

export const buildReferenceImageUrls = async (refs: ReferenceImage[]): Promise<string[]> => {
  const urls: string[] = [];
  for (const ref of refs) {
    const u = await resolveImageUrl(ref);
    if (!u) throw new Error('A reference image could not be loaded. Restore it before generating so person identities stay correctly matched.');
    urls.push(u);
  }
  return urls;
};

interface CreateTaskResponse {
  requestId: string;
  endpoint: string;
}

/**
 * Legacy shape used by the GPT Image 2 flow (backward compatible).
 * New callers should use `submitFalTask` below.
 */
export const createImageTask = async (params: {
  mode: 'text' | 'edit';
  prompt: string;
  imageSize?: string | { width: number; height: number };
  imageUrls?: string[];
  quality?: 'low' | 'medium' | 'high' | 'auto';
  numImages?: number;
  outputFormat?: 'png' | 'jpeg' | 'webp';
}): Promise<CreateTaskResponse> => {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/fal-image-generate', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  let data: any;
  // Read the body once: after json() fails, text() is always empty.
  const text = await res.text().catch(() => '');
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }

  if (!res.ok) throw new Error(data.error || 'Failed to start image generation');
  if (!data.requestId) throw new Error('No request ID returned');
  return { requestId: data.requestId, endpoint: data.endpoint };
};

/**
 * Generic fal task submission. Used by the nano banana flows; accepts a
 * fully-formed fal `input` object that the proxy forwards (after key
 * filtering) to the chosen endpoint.
 */
export const submitFalTask = async (
  endpoint: string,
  input: Record<string, unknown>,
): Promise<CreateTaskResponse> => {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/fal-image-generate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ endpoint, input }),
  });

  let data: any;
  // Read the body once: after json() fails, text() is always empty.
  const text = await res.text().catch(() => '');
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }

  if (!res.ok) throw new Error(data.error || 'Failed to start image generation');
  if (!data.requestId) throw new Error('No request ID returned');
  return { requestId: data.requestId, endpoint: data.endpoint || endpoint };
};

export const pollImageTask = async (
  requestId: string,
  endpoint: string,
  onProgress?: (progress: number) => void,
): Promise<string[]> => {
  let consecutiveErrors = 0;
  const MAX_ERRORS = 5;
  const startedAt = Date.now();
  // Track when we first observed each stage so progress doesn't jump backwards.
  let firstQueueAt: number | null = null;
  let firstProgressAt: number | null = null;
  // GPT Image 2 typically takes 15-40s end to end at high quality. We ramp
  // toward 0.95 over ~45 seconds while in progress, and dedicate roughly the
  // first 10% of the bar to queue waiting.
  const QUEUE_PROGRESS_CAP = 0.10;
  const RUN_PROGRESS_CAP = 0.95;
  const RUN_RAMP_MS = 45_000;

  while (true) {
    // Phase 1: fetch the status. Network / JSON / 5xx errors here ARE
    // transient (Vercel cold start, fal hiccup, …) — retry up to MAX_ERRORS.
    let data: any | null = null;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `/api/fal-status?requestId=${encodeURIComponent(requestId)}&endpoint=${encodeURIComponent(endpoint)}`,
        { headers }
      );

      // Read the body once: after json() fails, text() is always empty.
      const text = await res.text().catch(() => '');
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 100)}`);
      }

      if (!res.ok) throw new Error(data?.error || `Status check failed (${res.status})`);

      consecutiveErrors = 0;
    } catch (err: any) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_ERRORS) throw err;
      console.warn(`Image poll error (${consecutiveErrors}/${MAX_ERRORS}), retrying:`, err.message);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      continue;
    }

    // Phase 2: interpret the status. A FAILED / CANCELLED status is a
    // *permanent* outcome reported by fal (typically a content-policy
    // refusal from Nano Banana — same prompt + same images will keep
    // failing, retrying just wastes 5×POLL_INTERVAL on a guaranteed loss).
    // Throw straight out of the loop so the caller can mark the placeholder
    // as failed immediately and surface the reason in the gallery.
    if (data.status === 'SUCCEEDED') {
      onProgress?.(1);
      return Array.isArray(data.output) ? data.output : [];
    }
    if (data.status === 'FAILED') {
      throw new Error(data.error || 'Image generation failed');
    }
    if (data.status === 'CANCELLED') {
      throw new Error('Image generation was cancelled');
    }

    // RUNNING: derive a smooth progress estimate
    const stage: string | undefined = data.stage;
    if (stage === 'IN_QUEUE') {
      if (firstQueueAt == null) firstQueueAt = Date.now();
      const qp = typeof data.queuePosition === 'number' ? data.queuePosition : null;
      // Progress in queue: position 0 -> just below cap; falling off as N grows.
      const queued = qp != null ? Math.max(0.02, QUEUE_PROGRESS_CAP - Math.min(qp * 0.01, QUEUE_PROGRESS_CAP - 0.02)) : 0.04;
      onProgress?.(queued);
    } else if (stage === 'IN_PROGRESS') {
      if (firstProgressAt == null) firstProgressAt = Date.now();
      const elapsed = Date.now() - (firstProgressAt || startedAt);
      const t = Math.min(1, elapsed / RUN_RAMP_MS);
      // Ease-out so the bar moves quickly at first, then slows as it approaches the cap.
      const eased = 1 - Math.pow(1 - t, 2);
      const ramp = QUEUE_PROGRESS_CAP + eased * (RUN_PROGRESS_CAP - QUEUE_PROGRESS_CAP);
      onProgress?.(ramp);
    } else {
      // Unknown stage: emit a small heartbeat
      onProgress?.(0.04);
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
};

/**
 * Downloads a result URL into a base64 data URL so it flows through the
 * existing saveImage -> Supabase storage pipeline. fal.ai result URLs are
 * time-limited so we MUST cache locally.
 */
export const fetchImageAsDataUrl = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download generated image (${res.status})`);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read downloaded image'));
    reader.readAsDataURL(blob);
  });
};

/**
 * High-level helper for GPT Image 2 via fal.ai.
 *
 * Edit workflow (image-to-image): pass all refs as `image_urls`.
 *
 * Text-to-image: when no refs at all, hit the plain endpoint.
 */
/**
 * Submit a GPT Image 2 task to fal.ai and return the request_id + endpoint
 * WITHOUT polling. Used so the caller can persist the requestId to the DB
 * before polling, allowing the generation to be resumed across page refreshes.
 */
export const submitGptImage2Task = async (
  config: GenerationConfig,
  cleanedPrompt: string,
): Promise<{ requestId: string; endpoint: string }> => {
  const refs = config.referenceImages || [];
  const imageSize = mapAspectRatioToFalSize(config.aspectRatio, config.resolution);

  let createParams: Parameters<typeof createImageTask>[0];

  if (refs.length > 0) {
    const imageUrls = await buildReferenceImageUrls(refs);
    if (imageUrls.length === 0) throw new Error('No reference image URLs resolved');
    createParams = {
      mode: 'edit',
      prompt: cleanedPrompt,
      imageSize,
      imageUrls,
      quality: 'high',
    };
  } else {
    createParams = {
      mode: 'text',
      prompt: cleanedPrompt,
      imageSize,
      quality: 'high',
    };
  }

  return createImageTask(createParams);
};

export const generateGptImage2 = async (
  config: GenerationConfig,
  cleanedPrompt: string,
  onProgress?: (progress: number) => void,
  onTaskCreated?: (requestId: string, endpoint: string) => void | Promise<void>,
): Promise<string> => {
  const { requestId, endpoint } = await submitGptImage2Task(config, cleanedPrompt);
  if (onTaskCreated) await onTaskCreated(requestId, endpoint);
  const urls = await pollImageTask(requestId, endpoint, onProgress);
  if (urls.length === 0) throw new Error('No image returned');
  return fetchImageAsDataUrl(urls[0]);
};

/**
 * Resume polling for a previously-submitted fal.ai task. Used at app boot
 * to recover image generations whose tab was closed/refreshed mid-flight.
 *
 * Despite the name, this polls ANY fal-backed task (gpt-image-2 +
 * nano-banana-pro + nano-banana-2/2.1) since the polling protocol is identical.
 */
export const resumeGptImage2Task = async (
  requestId: string,
  endpoint: string,
  onProgress?: (progress: number) => void,
): Promise<string> => {
  const urls = await pollImageTask(requestId, endpoint, onProgress);
  if (urls.length === 0) throw new Error('No image returned');
  return fetchImageAsDataUrl(urls[0]);
};

// --- Nano Banana (fal.ai) ----------------------------------------------------

const nanoBananaEndpointFor = (
  imageModel: ImageModelId,
  hasReferences: boolean,
): string => {
  const isPro = imageModel === 'gemini-3-pro-image-preview';
  if (!isPro && imageModel !== NANO_BANANA_21_MODEL && imageModel !== NANO_BANANA_2_LEGACY_MODEL) throw new Error('Choose a supported Nano Banana model.');
  const base = isPro ? 'fal-ai/nano-banana-pro' : NANO_BANANA_21_ENDPOINT;
  return hasReferences ? `${base}/edit` : base;
};

/**
 * Build the fal `input` object for a Nano Banana request. Aspect ratio +
 * resolution are passed through directly because fal accepts the same enum
 * values our app already uses (see types.ts AspectRatio / Resolution).
 *
 * Defaults that match the rest of the app:
 *  - num_images: 1   (count is handled by the caller looping)
 *  - safety_tolerance: '6'  (least restrictive — the existing Gemini-direct
 *    flow used `responseModalities: [Modality.IMAGE]` with no safety filter,
 *    so this preserves the same permissiveness)
 *  - thinking_level: 'high' for Nano Banana 2.1 (per the user's request — Pro
 *    doesn't expose this knob)
 *  - output_format: 'png'  (matches storageService's PNG pipeline)
 */
const buildNanoBananaInput = (
  imageModel: ImageModelId,
  prompt: string,
  config: GenerationConfig,
  imageUrls: string[],
): Record<string, unknown> => {
  const input: Record<string, unknown> = {
    prompt,
    num_images: 1,
    aspect_ratio: config.aspectRatio,
    resolution: config.resolution,
    output_format: 'png',
    safety_tolerance: '6',
  };
  if (imageUrls.length > 0) input.image_urls = imageUrls;
  if (imageModel === NANO_BANANA_21_MODEL || imageModel === NANO_BANANA_2_LEGACY_MODEL) {
    input.thinking_level = 'high';
  }
  return input;
};

/**
 * Submit a Nano Banana (Pro or 2.1) task to fal.ai and return the request_id +
 * endpoint WITHOUT polling. Mirrors `submitGptImage2Task` so the higher-level
 * `runImageGeneration` flow in App.tsx (with createPendingImage + resume
 * support) works identically across all fal-backed models.
 */
export const submitNanoBananaTask = async (
  imageModel: ImageModelId,
  config: GenerationConfig,
  cleanedPrompt: string,
): Promise<{ requestId: string; endpoint: string }> => {
  const refs = config.referenceImages || [];
  const imageUrls = refs.length > 0 ? await buildReferenceImageUrls(refs) : [];
  if (refs.length > 0 && imageUrls.length === 0) {
    throw new Error('No reference image URLs resolved');
  }
  const endpoint = nanoBananaEndpointFor(imageModel, imageUrls.length > 0);
  const input = buildNanoBananaInput(imageModel, cleanedPrompt, config, imageUrls);
  return submitFalTask(endpoint, input);
};

export const generateNanoBanana = async (
  imageModel: ImageModelId,
  config: GenerationConfig,
  cleanedPrompt: string,
  onProgress?: (progress: number) => void,
  onTaskCreated?: (requestId: string, endpoint: string) => void | Promise<void>,
): Promise<string> => {
  const { requestId, endpoint } = await submitNanoBananaTask(imageModel, config, cleanedPrompt);
  if (onTaskCreated) await onTaskCreated(requestId, endpoint);
  const urls = await pollImageTask(requestId, endpoint, onProgress);
  if (urls.length === 0) throw new Error('No image returned');
  return fetchImageAsDataUrl(urls[0]);
};
