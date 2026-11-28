/** fal queue contracts (text and /edit), checked 2026-11-27:
 * https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/nano-banana-2.1
 * https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/nano-banana-pro
 * Queue results expose images, not token usage or a final billed amount.
 */
export const NANO_BANANA_21_MODEL = 'gemini-nano-banana-2.1';
export const NANO_BANANA_21_ENDPOINT = 'google/nano-banana-2.1';
export const NANO_BANANA_2_LEGACY_MODEL = 'gemini-3.1-flash-image-preview';
export const NANO_BANANA_PRO_ENDPOINT = 'fal-ai/nano-banana-pro';
export const NANO_BANANA_PRO_MODEL = 'gemini-3-pro-image-preview';
// Banana's composer supports a single turn with up to fourteen still references.
export const NANO_REFERENCE_LIMIT = 14;
export const NANO_BANANA_21_TOKEN_PRICING = { input: 1.764, textOutput: 8.823, imageOutput: 35.294 };
const ASPECT_RATIOS = ['auto','21:9','16:9','3:2','4:3','5:4','1:1','4:5','3:4','2:3','9:16','4:1','1:4','8:1','1:8'];

/** One provider request per gallery item, including app-orchestrated batches.
 * Pro keeps its provider-default thinking; only 2.1 explicitly asks for high. */
export function buildNanoBananaRequest(model: string, prompt: string, settings: { aspectRatio: string; resolution: string }, imageUrls: string[]) {
  const pro = model === NANO_BANANA_PRO_MODEL;
  if (!pro && model !== NANO_BANANA_21_MODEL && model !== NANO_BANANA_2_LEGACY_MODEL) throw new Error('Choose a supported Nano Banana model.');
  return {
    endpoint: (pro ? NANO_BANANA_PRO_ENDPOINT : NANO_BANANA_21_ENDPOINT) + (imageUrls.length ? '/edit' : ''),
    input: { prompt, num_images: 1, aspect_ratio: settings.aspectRatio, resolution: settings.resolution,
      output_format: 'png', safety_tolerance: '6', ...(pro ? {} : { thinking_level: 'high' }),
      ...(imageUrls.length ? { image_urls: imageUrls } : {}) },
  };
}

// JSON Schema string lengths count Unicode code points, not UTF-16 code units.
const fitsText = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') return false;
  let count = 0;
  for (const _ of value) if (++count > max) return false;
  return count >= min;
};

export const getNanoBananaInputError = (input: Record<string, unknown>, endpoint: string): string | null => {
  const pro = endpoint === NANO_BANANA_PRO_ENDPOINT || endpoint === `${NANO_BANANA_PRO_ENDPOINT}/edit`;
  const name = pro ? 'Nano Banana Pro' : 'Nano Banana 2.1';
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || !fitsText(input.prompt, 3, 50_000)) return `${name} requires a prompt of 3–50,000 characters.`;
  for (const [key, allowed] of [['resolution',['1K','2K','4K']], ['thinking_level',pro ? ['high'] : ['minimal','medium','high']], ['aspect_ratio',ASPECT_RATIOS], ['output_format',['jpeg','png','webp']], ['safety_tolerance',['1','2','3','4','5','6']]] as const) {
    if (input[key] !== undefined && !(allowed as readonly string[]).includes(input[key] as string)) return `Invalid ${name} ${key}.`;
  }
  if (input.num_images !== undefined && (!Number.isInteger(input.num_images) || Number(input.num_images) < 1 || Number(input.num_images) > 4)) return `${name} supports 1–4 images per request.`;
  if (input.seed !== undefined && !Number.isSafeInteger(input.seed)) return `Invalid ${name} seed.`;
  if (input.system_prompt !== undefined && !fitsText(input.system_prompt, 0, 50_000)) return `Invalid ${name} system_prompt.`;
  for (const key of ['enable_web_search','limit_generations']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') return `Invalid ${name} ${key}.`;
  }
  // Inline sync results aren't retained in fal history; the gallery must be able to resume.
  if (input.sync_mode !== undefined && input.sync_mode !== false) return 'Queued image jobs require sync_mode=false.';
  const images = input.image_urls;
  if (!endpoint.endsWith('/edit') && images !== undefined) return 'image_urls requires the edit endpoint.';
  if (endpoint.endsWith('/edit') && (!Array.isArray(images) || !images.length)) return 'image_urls is required for image-reference generation or editing.';
  if (images !== undefined && (!Array.isArray(images) || images.length > NANO_REFERENCE_LIMIT || images.some(url => {
    if (typeof url !== 'string') return true;
    try { return !['https:','http:','data:'].includes(new URL(url).protocol); } catch { return true; }
  }))) return `${name} accepts up to ${NANO_REFERENCE_LIMIT} valid image URLs in Banana.`;
  return null;
};
const OUTPUT_TOKENS = { '1K': 1120, '2K': 1680, '4K': 3780 };
/** Representative output-image tokens only; prompt, references and High
 * thinking are additional usage, never a flat $0.002 surcharge in 2.1. */
export const estimateNanoBanana21OutputCost = (resolution: keyof typeof OUTPUT_TOKENS, count: number): number | null => {
  if (!Object.hasOwn(OUTPUT_TOKENS, resolution) || !Number.isInteger(count) || count < 0) return null;
  return OUTPUT_TOKENS[resolution] * NANO_BANANA_21_TOKEN_PRICING.imageOutput / 1_000_000 * count;
};
