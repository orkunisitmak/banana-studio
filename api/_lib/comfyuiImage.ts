import { setTimeout as sleep } from 'node:timers/promises';

// ComfyUI's own template for FLUX.2 [klein] 4B distilled: 4 steps, CFG 1 and
// a zeroed negative. References are VAE-encoded into ReferenceLatent chains;
// a protected edit area is inpainted through a latent noise mask.
const MODEL_FILES = { unet: 'flux-2-klein-4b-fp8.safetensors', clip: 'qwen_3_4b.safetensors', vae: 'flux2-vae.safetensors' };
const RATIOS: Record<string, [number, number]> = { '1:1': [1, 1], '4:3': [4, 3], '3:4': [3, 4], '16:9': [16, 9], '9:16': [9, 16] };
const MEGAPIXELS: Record<string, number> = { '1K': 1, '2K': 2, '4K': 4 };
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
/** Two desktop worker slots share one GPU: room for a 4K, multi-reference image plus the one ahead of it. */
export const COMFY_LOCAL_TIMEOUT_MS = 15 * 60_000;

/** The owner configures this address on the server; browsers never choose it. */
export const comfyBaseUrl = (value: string): string => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('ComfyUI address (COMFYUI_URL) must be a plain http(s) address.');
  return url.href.replace(/\/+$/, '');
};

/** Section labels the shared prompt compiler emits (src/lib/images, src/lib/references,
 * src/lib/youtube). Only these start a section, so a brief line in capitals such as
 * "SUMMER SALE" stays part of the brief. tests/comfyui-image.test.mjs keeps this
 * list in step with the compiler's sources. */
export const COMPILER_SECTIONS: ReadonlySet<string> = new Set([
  'ASSEMBLY CONTRACT', 'CREATIVE BRIEF', 'EDIT AREAS', 'EPISODE EDITORIAL FOCUS', 'EPISODE SUMMARY', 'IDENTITY SEPARATION',
  'LOCAL IMAGE EDIT', 'MEDIUM AND IDENTITY', 'OUTPUT SETTINGS', 'REFERENCE ROLES', 'REFERENCE USE', 'REFERENCE-BASED GENERATION',
  'REQUESTED EDIT', 'REQUIRED YOUTUBE CAMERA GAZE', 'REQUIRED YOUTUBE PERSON WARDROBE', 'SOURCE PRESERVATION', 'THUMBNAIL SCOPE',
  'THUMBNAIL STYLE EXAMPLES', 'USER EDIT SCOPE', 'YOUTUBE THUMBNAIL DIRECTION', 'YOUTUBE THUMBNAILS',
]);
const sectionName = (line: string): string | undefined => {
  const name = line.trim().replace(/ \([^\n)]*\)$/, '');
  return COMPILER_SECTIONS.has(name) ? name : undefined;
};
/** The shared prompt compiler wraps the user's brief in ~3,000 characters of
 * instructions written for hosted models (reference rules, YouTube direction,
 * wardrobe and preservation policy). A local text encoder conditions on all of
 * it and paints its words into the image, so ComfyUI receives only the brief
 * (or requested edit) and who the reference people are. A selected edit area
 * is enforced by the mask, not by prose. */
export const comfyPrompt = (prompt: string): string => {
  const sections = new Map<string, string[]>();
  let current = '', previous = '';
  for (const line of prompt.split('\n')) {
    const name = sectionName(line);
    // A Brainstorm concept carries the camera-gaze block inside its brief; its
    // END line returns to the brief so the source brief after it is kept.
    if (current && line.trim() === `END ${current}`) current = previous;
    else if (name) { previous = current; current = name; sections.set(current, sections.get(current) || []); }
    else sections.set(current, [...sections.get(current) || [], line]);
  }
  const brief = (sections.get('CREATIVE BRIEF') || sections.get('REQUESTED EDIT'))?.join('\n').trim();
  if (!brief) return prompt.trim();
  const tags = new Map<string, string>(), people = new Map<string, string[]>();
  for (const line of sections.get('REFERENCE ROLES') || []) {
    const group = line.match(/^(@[A-Z0-9_]+) \("([^"]+)"\): (.+?) show the SAME SINGLE person/);
    const single = line.match(/^IMAGE (\d+): .*identity \(label "([^"]+)"\)/);
    if (group) { tags.set(group[1], group[2]); people.set(group[2], [...people.get(group[2]) || [], group[3]]); }
    else if (single) people.set(single[2], [...people.get(single[2]) || [], `image ${single[1]}`]);
  }
  const text = brief.replace(/@[A-Z0-9_]+\b/g, tag => tags.get(tag) || tag).replace(/@([\p{L}\p{N}_]+)/gu, '$1');
  if (!people.size) return text;
  const who = [...people].map(([name, images]) => `${images.join(', ')} ${images.length > 1 || /,/.test(images[0]) ? 'show' : 'shows'} ${name}`).join('; ');
  return `Reference photos: ${who}. Keep each person's exact face, hair and identity.\n\n${text}`;
};

/** A local run is never billed, so failures explain how to fix ComfyUI instead of pointing at usage. */
export const comfyFailureMessage = (error: any): string => error?.name === 'TimeoutError' || error?.name === 'AbortError'
  ? 'ComfyUI did not finish within the time limit. Check the ComfyUI window; nothing was charged.'
  : typeof error?.message === 'string' && error.message.startsWith('ComfyUI') ? error.message
    : error?.name === 'TypeError' ? 'Banana Studio could not reach ComfyUI. Start ComfyUI and check COMFYUI_URL; nothing was charged.'
      : 'ComfyUI could not finish the image. Check the ComfyUI window for details; nothing was charged.';

/** Keep the requested shape at the resolution's pixel budget; FLUX latents use multiples of 16. */
export const comfyCanvas = (size: unknown, aspectRatio: unknown, resolution: unknown): [number, number] => {
  const match = typeof size === 'string' && size.match(/^([1-9]\d*)x([1-9]\d*)$/);
  const [width, height] = match ? [Number(match[1]), Number(match[2])] : RATIOS[aspectRatio as string] || [1, 1];
  const scale = Math.sqrt((MEGAPIXELS[resolution as string] || 1) * 1024 * 1024 / (width * height));
  return [width, height].map(n => Math.max(256, Math.round(n * scale / 16) * 16)) as [number, number];
};

type Box = { left: number; top: number; width: number; height: number };
/** A selected area of reference `source`: `mask` is a full-canvas PNG, white where the edit applies. */
export type ComfyEditArea = { source: number; mask: Buffer; bounds: Box; size: [number, number] };
/** Inpainting inputs once uploaded. `crop` is in source pixels; `grow` widens the mask so the edit blends past its border. */
export type ComfyInpaint = { source: number; mask: string; crop: Box; grow: number };

/** The model has no reliable sense of written coordinates, so a selection is
 * edited as its own canvas: the selection plus surrounding context, which
 * receives the whole pixel budget and is pasted back over the source. */
export const comfyEditCrop = ({ left, top, width, height }: Box, [sourceWidth, sourceHeight]: [number, number]): Box => {
  const pad = Math.round(Math.max(width, height, Math.min(sourceWidth, sourceHeight) / 4) / 2);
  const x = Math.max(0, left - pad), y = Math.max(0, top - pad);
  return { left: x, top: y, width: Math.min(sourceWidth, left + width + pad) - x, height: Math.min(sourceHeight, top + height + pad) - y };
};

export const comfyGraph = (prompt: string, [width, height]: [number, number], references: string[], seed: number, inpaint?: ComfyInpaint) => {
  const graph: Graph = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: MODEL_FILES.unet, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: MODEL_FILES.clip, type: 'flux2', device: 'default' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: MODEL_FILES.vae } },
    text: { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: prompt } },
    empty: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['text', 0] } },
  };
  let positive: [string, number] = ['text', 0], negative: [string, number] = ['empty', 0];
  references.forEach((image, i) => {
    graph[`load${i}`] = { class_type: 'LoadImage', inputs: { image } };
    graph[`scale${i}`] = i === inpaint?.source
      ? { class_type: 'ImageScale', inputs: { image: ['crop', 0], upscale_method: 'lanczos', width, height, crop: 'disabled' } }
      : { class_type: 'ImageScaleToTotalPixels', inputs: { image: [`load${i}`, 0], upscale_method: 'nearest-exact', megapixels: 1, resolution_steps: 1 } };
    graph[`encode${i}`] = { class_type: 'VAEEncode', inputs: { pixels: [`scale${i}`, 0], vae: ['vae', 0] } };
    graph[`positive${i}`] = { class_type: 'ReferenceLatent', inputs: { conditioning: positive, latent: [`encode${i}`, 0] } };
    graph[`negative${i}`] = { class_type: 'ReferenceLatent', inputs: { conditioning: negative, latent: [`encode${i}`, 0] } };
    positive = [`positive${i}`, 0]; negative = [`negative${i}`, 0];
  });
  Object.assign(graph, {
    guider: { class_type: 'CFGGuider', inputs: { model: ['unet', 0], positive, negative, cfg: 1 } },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    sigmas: { class_type: 'Flux2Scheduler', inputs: { steps: 4, width, height } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    sample: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sigmas', 0], latent_image: ['latent', 0] } },
  });
  return finishGraph(graph, [width, height], inpaint && [`encode${inpaint.source}`, 0], inpaint);
};

// ComfyUI's own template for FLUX 3 Image Klein distilled (int8): 16 euler
// steps at CFG 1, references through one ReferenceMultiLatent node.
const FLUX3_FILES = { unet: 'flux3-image-klein-int8-convrot.safetensors', clip: 'qwen3vl_4b_int8_convrot.safetensors', vae: 'flux2-vae.safetensors' };
export const comfyFlux3Graph = (prompt: string, [width, height]: [number, number], references: string[], seed: number, inpaint?: ComfyInpaint) => {
  const graph: Graph = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: FLUX3_FILES.unet, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: FLUX3_FILES.clip, type: 'flux3', device: 'default' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: FLUX3_FILES.vae } },
    text: { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: prompt } },
    empty: { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: '' } },
  };
  let positive: [string, number] = ['text', 0], negative: [string, number] = ['empty', 0];
  if (inpaint) Object.assign(graph, {
    source: { class_type: 'ImageScale', inputs: { image: ['crop', 0], upscale_method: 'lanczos', width, height, crop: 'disabled' } },
    encode: { class_type: 'VAEEncode', inputs: { pixels: ['source', 0], vae: ['vae', 0] } },
  });
  if (references.length) {
    const refs: Graph[string] = { class_type: 'ReferenceMultiLatent', inputs: { positive, negative, vae: ['vae', 0], resolution: 'resize', 'resolution.megapixels': 1 } };
    references.forEach((image, i) => {
      graph[`load${i}`] = { class_type: 'LoadImage', inputs: { image } };
      refs.inputs[`images.image${i}`] = i === inpaint?.source ? ['source', 0] : [`load${i}`, 0];
    });
    graph.refs = refs;
    positive = ['refs', 0]; negative = ['refs', 1];
  }
  graph.sample = { class_type: 'KSampler', inputs: { model: ['unet', 0], positive, negative, latent_image: ['latent', 0],
    seed, steps: 16, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } };
  return finishGraph(graph, [width, height], inpaint && ['encode', 0], inpaint);
};

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
/** Decoding, output, and either an empty latent or the masked source crop pasted back at source size. */
function finishGraph(graph: Graph, [width, height]: [number, number], encoded: [string, number] | undefined, inpaint?: ComfyInpaint): Graph {
  Object.assign(graph, {
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['vae', 0] } },
    // Preview output lives in ComfyUI's temp folder; Banana Studio keeps the saved copy.
    output: { class_type: 'PreviewImage', inputs: { images: [inpaint ? 'paste' : 'decode', 0] } },
  });
  if (!inpaint || !encoded) return Object.assign(graph, { latent: { class_type: 'EmptyFlux2LatentImage', inputs: { width, height, batch_size: 1 } } });
  // The crop is both the source reference and the starting latent. Sampling
  // redraws only the masked latent; the result returns at source size.
  const { left: x, top: y, width: cropWidth, height: cropHeight } = inpaint.crop, source = `load${inpaint.source}`;
  return Object.assign(graph, {
    crop: { class_type: 'ImageCrop', inputs: { image: [source, 0], width: cropWidth, height: cropHeight, x, y } },
    mask: { class_type: 'LoadImageMask', inputs: { image: inpaint.mask, channel: 'red' } },
    cropMask: { class_type: 'CropMask', inputs: { mask: ['mask', 0], x, y, width: cropWidth, height: cropHeight } },
    area: { class_type: 'GrowMask', inputs: { mask: ['cropMask', 0], expand: inpaint.grow, tapered_corners: true } },
    latent: { class_type: 'SetLatentNoiseMask', inputs: { samples: encoded, mask: ['area', 0] } },
    restore: { class_type: 'ImageScale', inputs: { image: ['decode', 0], upscale_method: 'lanczos', width: cropWidth, height: cropHeight, crop: 'disabled' } },
    paste: { class_type: 'ImageCompositeMasked', inputs: { destination: [source, 0], source: ['restore', 0], x, y, resize_source: false, mask: ['area', 0] } },
  });
}

/** Returns the same `{ data: [{ b64_json }] }` shape as the hosted image routes. */
export async function requestComfyImage(address: string, model: string, input: Record<string, any>, readImage: (url: string) => Promise<string>, auditId: string, signal: AbortSignal, edit?: ComfyEditArea): Promise<Response> {
  const base = comfyBaseUrl(address);
  const call = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { redirect: 'error', signal, ...init });
  const upload = async (bytes: Buffer, type: string, filename: string) => {
    const form = new FormData();
    form.append('image', new Blob([bytes], { type }), filename);
    form.append('subfolder', 'banana-studio');
    form.append('overwrite', 'true');
    return call('/upload/image', { method: 'POST', body: form });
  };
  const uploadedName = async (uploaded: Response) => {
    const { name, subfolder } = await uploaded.json();
    return subfolder ? `${subfolder}/${name}` : name;
  };
  if (edit && !(edit.source >= 0 && edit.source < (input.images || []).length)) throw new Error('The edit source is missing from the ComfyUI references.');
  const references: string[] = [];
  for (const [index, image] of (input.images || []).entries()) {
    const match = (await readImage(image.image_url)).match(/^data:image\/(png|jpeg|webp);base64,(.+)$/s);
    if (!match) throw new Error('This reference could not be prepared for ComfyUI.');
    const uploaded = await upload(Buffer.from(match[2], 'base64'), `image/${match[1]}`, `${auditId}-${index}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`);
    if (!uploaded.ok) return uploaded;
    references.push(await uploadedName(uploaded));
  }
  let inpaint: ComfyInpaint | undefined;
  if (edit) {
    const uploaded = await upload(edit.mask, 'image/png', `${auditId}-mask.png`);
    if (!uploaded.ok) return uploaded;
    const crop = comfyEditCrop(edit.bounds, edit.size);
    inpaint = { source: edit.source, mask: await uploadedName(uploaded), crop, grow: Math.max(8, Math.round(Math.max(crop.width, crop.height) / 64)) };
  }
  const canvas = inpaint ? comfyCanvas(`${inpaint.crop.width}x${inpaint.crop.height}`, undefined, input.resolution) : comfyCanvas(input.size, input.aspect_ratio, input.resolution);
  const graph = (model === 'flux3-klein-local' ? comfyFlux3Graph : comfyGraph)(comfyPrompt(input.prompt), canvas, references, Math.floor(Math.random() * 2 ** 31), inpaint);
  const queued = await call('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: auditId }) });
  if (!queued.ok) return queued;
  const { prompt_id: id } = await queued.json();
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('ComfyUI did not accept the workflow.');
  try {
    for (;;) {
      await sleep(1_000, undefined, { signal });
      const entry = (await (await call(`/history/${id}`)).json())?.[id];
      if (!entry) continue;
      if (entry.status?.status_str === 'error') {
        const failure = entry.status.messages?.find((message: any) => message?.[0] === 'execution_error')?.[1];
        console.warn('[comfyui-image] execution failed', { id, node: failure?.node_type ?? null, message: String(failure?.exception_message ?? '').slice(0, 300) });
        throw new Error('ComfyUI could not run the local model. Check that its model files are installed.');
      }
      const image = entry.outputs?.output?.images?.[0];
      if (!image) {
        if (entry.status?.completed) throw new Error('ComfyUI returned no image.');
        continue;
      }
      const file = await call(`/view?${new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'temp' })}`);
      if (!file.ok || Number(file.headers.get('content-length')) > MAX_OUTPUT_BYTES) throw new Error('Generated image download failed.');
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.length > MAX_OUTPUT_BYTES) throw new Error('Generated image exceeds the output limit.');
      return Response.json({ data: [{ b64_json: bytes.toString('base64'), media_type: 'image/png' }], output_format: 'png', usage: { cost: 0 } },
        { headers: { 'x-request-id': id } });
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    // Stop our own prompt: interrupt it if it is running, otherwise drop it from the queue.
    const control = (path: string, body?: unknown) => fetch(`${base}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).catch(() => {});
    const queue = await fetch(`${base}/queue`, { redirect: 'error', signal: AbortSignal.timeout(5_000) }).then(r => r.json()).catch(() => null);
    if (queue?.queue_running?.some((item: unknown[]) => item?.[1] === id)) await control('/interrupt', { prompt_id: id });
    else await control('/queue', { delete: [id] });
    throw signal.reason;
  }
}
