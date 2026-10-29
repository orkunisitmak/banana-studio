import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isLocalAssetName, isWorkflowName, localServerUrl, type LocalServer } from '../../src/lib/localModels.js';

/** Self-hosted image/video servers. Destinations come only from server configuration;
 * the browser chooses a model or workflow name, never a URL or file path. */
export type LocalJob = { prompt: string; width: number; height: number; checkpoint?: string; workflow?: string; image?: Buffer; imageMime?: string;
  /** White = repaint. Sent as a real inpaint mask; the compositor still protects outside pixels. */ mask?: Buffer;
  seed?: number; negative?: string; frames?: number; fps?: number; duration?: number };

const env = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};
export const randomSeed = () => Math.floor(Math.random() * 2 ** 32);
export const isSeed = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < 2 ** 32;
export const localTuning = () => ({ steps: env('LOCAL_IMAGE_STEPS', 25, 1, 150), cfg: env('LOCAL_IMAGE_CFG', 6, 0, 30),
  denoise: env('LOCAL_IMAGE_DENOISE', 0.6, 0.05, 1), inpaintDenoise: env('LOCAL_INPAINT_DENOISE', 0.75, 0.05, 1), negative: (process.env.LOCAL_NEGATIVE_PROMPT || '').slice(0, 2000), fps: env('LOCAL_VIDEO_FPS', 16, 1, 60) });

/** Only the status reaches users: a server's raw error body can expose paths or internal details. */
const json = async (response: Response, label: string) => {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(`${label} rejected the request (${response.status}). Check the server console for details.`), { status: response.status });
  return data;
};

// ---- Stable Diffusion WebUI (AUTOMATIC1111, Forge, SD.Next) ----
export async function sdwebuiImage(job: LocalJob, signal: AbortSignal): Promise<Buffer> {
  const base = localServerUrl('sdwebui', process.env);
  if (!base) throw new Error('Stable Diffusion WebUI is not configured. Set SDWEBUI_BASE_URL.');
  const tune = localTuning();
  const body = { prompt: job.prompt, negative_prompt: job.negative ?? tune.negative, width: job.width, height: job.height, steps: tune.steps, cfg_scale: tune.cfg,
    seed: job.seed ?? -1, batch_size: 1, n_iter: 1, ...(job.checkpoint ? { override_settings: { sd_model_checkpoint: job.checkpoint }, override_settings_restore_afterwards: true } : {}),
    ...(job.image ? { init_images: [job.image.toString('base64')], denoising_strength: job.mask ? tune.inpaintDenoise : tune.denoise, resize_mode: 1 } : {}),
    // inpainting_fill 1 = start from the original pixels, so regular checkpoints inpaint well.
    ...(job.image && job.mask ? { mask: job.mask.toString('base64'), mask_blur: 4, inpainting_fill: 1, inpaint_full_res: false, inpainting_mask_invert: 0 } : {}) };
  const data = await json(await fetch(`${base}/sdapi/v1/${job.image ? 'img2img' : 'txt2img'}`, {
    method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Stable Diffusion WebUI');
  const image = data?.images?.[0];
  if (typeof image !== 'string' || !image) throw new Error('Stable Diffusion WebUI returned no image.');
  return Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
}

// ---- ComfyUI ----
/** Core-node SD/SDXL graph; custom workflows cover Flux, Wan, LTX and any other model. */
export const defaultComfyImageWorkflow = (img2img: boolean, masked = false) => ({
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '{{checkpoint}}' } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['4', 1] } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['4', 1] } },
  ...(img2img ? {
    10: { class_type: 'LoadImage', inputs: { image: '{{image}}' } },
    12: { class_type: 'ImageScale', inputs: { image: ['10', 0], upscale_method: 'lanczos', width: '{{width}}', height: '{{height}}', crop: 'center' } },
    ...(masked ? {
      13: { class_type: 'VAEEncode', inputs: { pixels: ['12', 0], vae: ['4', 2] } },
      14: { class_type: 'LoadImageMask', inputs: { image: '{{mask}}', channel: 'red' } },
      15: { class_type: 'MaskToImage', inputs: { mask: ['14', 0] } },
      16: { class_type: 'ImageScale', inputs: { image: ['15', 0], upscale_method: 'bilinear', width: '{{width}}', height: '{{height}}', crop: 'center' } },
      17: { class_type: 'ImageToMask', inputs: { image: ['16', 0], channel: 'red' } },
      // A noise mask works with regular checkpoints, not only inpainting models.
      5: { class_type: 'SetLatentNoiseMask', inputs: { samples: ['13', 0], mask: ['17', 0] } },
    } : { 5: { class_type: 'VAEEncode', inputs: { pixels: ['12', 0], vae: ['4', 2] } } }),
  } : { 5: { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } } }),
  3: { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: '{{steps}}', cfg: '{{cfg}}', sampler_name: 'euler', scheduler: 'normal', denoise: '{{denoise}}',
    model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
  8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  9: { class_type: 'SaveImage', inputs: { filename_prefix: 'banana-studio', images: ['8', 0] } },
});

/** `"{{width}}"` becomes the typed value; `{{prompt}}` inside longer text is replaced as text. No JSON is built from strings. */
export const fillWorkflow = (workflow: unknown, values: Record<string, string | number>): any => {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value)]));
    if (typeof node !== 'string') return node;
    const exact = node.match(/^\{\{(\w+)\}\}$/);
    if (exact && Object.hasOwn(values, exact[1])) return values[exact[1]];
    return node.replace(/\{\{(\w+)\}\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
  };
  return walk(workflow);
};
export const workflowUses = (workflow: unknown, key: string) => JSON.stringify(workflow).includes(`{{${key}}}`);

export const workflowsDir = () => process.env.COMFYUI_WORKFLOWS_DIR?.trim() || '';
export const listWorkflows = (): string[] => {
  const dir = workflowsDir();
  if (!dir) return [];
  try { return fs.readdirSync(dir).filter(isWorkflowName).sort().slice(0, 200); } catch { return []; }
};
export const readWorkflow = (name: string): unknown => {
  const dir = workflowsDir();
  if (!dir || !isWorkflowName(name) || !listWorkflows().includes(name)) throw new Error('Choose a workflow from the ComfyUI workflows folder.');
  const file = path.join(dir, name);
  if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('The workflow file is too large.');
  const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));
  // UI exports have "nodes"/"links"; the API needs the "Save (API Format)" export.
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || Array.isArray((workflow as any).nodes)) {
    throw new Error('Export the workflow from ComfyUI with "Save (API Format)".');
  }
  return workflow;
};

const comfyBase = () => {
  const base = localServerUrl('comfyui', process.env);
  if (!base) throw new Error('ComfyUI is not configured. Set COMFYUI_BASE_URL.');
  return base;
};
export async function comfyCheckpoints(signal?: AbortSignal): Promise<string[]> {
  const data = await json(await fetch(`${comfyBase()}/object_info/CheckpointLoaderSimple`, { redirect: 'error', signal }), 'ComfyUI');
  const names = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  return Array.isArray(names) ? names.filter(isLocalAssetName).slice(0, 500) : [];
}
async function comfyUpload(image: Buffer, mime: string, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  form.append('image', new Blob([new Uint8Array(image)], { type: mime }), `banana-${randomUUID()}.${ext}`);
  form.append('overwrite', 'true');
  const data = await json(await fetch(`${comfyBase()}/upload/image`, { method: 'POST', redirect: 'error', signal, body: form }), 'ComfyUI');
  if (typeof data?.name !== 'string') throw new Error('ComfyUI did not accept the reference image.');
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

/** Queue a graph and return its prompt id. Missing checkpoint falls back to the first installed one. */
export async function comfySubmit(job: LocalJob, kind: 'image' | 'video', signal: AbortSignal): Promise<string> {
  const tune = localTuning();
  const workflow = job.workflow ? readWorkflow(job.workflow) : kind === 'image' ? defaultComfyImageWorkflow(!!job.image, !!(job.image && job.mask)) : null;
  if (!workflow) throw new Error('Local video needs a ComfyUI workflow. Add one to the workflows folder and choose it in Local models.');
  if (workflowUses(workflow, 'image') && !job.image) throw new Error('This workflow needs a reference image. Attach one and try again.');
  let checkpoint = job.checkpoint;
  if (!checkpoint && workflowUses(workflow, 'checkpoint')) {
    checkpoint = (await comfyCheckpoints(signal))[0];
    if (!checkpoint) throw new Error('ComfyUI has no checkpoint installed. Add a model to ComfyUI/models/checkpoints.');
  }
  const image = job.image && workflowUses(workflow, 'image') ? await comfyUpload(job.image, job.imageMime || 'image/png', signal) : '';
  const mask = job.mask && workflowUses(workflow, 'mask') ? await comfyUpload(job.mask, 'image/png', signal) : '';
  const fps = job.fps || tune.fps;
  const prompt = fillWorkflow(workflow, { prompt: job.prompt, negative_prompt: job.negative ?? tune.negative, width: job.width, height: job.height,
    seed: job.seed ?? randomSeed(), steps: tune.steps, cfg: tune.cfg, denoise: job.image && !job.workflow ? job.mask ? tune.inpaintDenoise : tune.denoise : 1,
    checkpoint: checkpoint || '', image, mask, fps, duration: job.duration || 0, frames: job.frames || Math.max(1, Math.round((job.duration || 5) * fps) + 1) });
  return comfyQueue(prompt, signal);
}
async function comfyQueue(prompt: unknown, signal: AbortSignal): Promise<string> {
  const data = await json(await fetch(`${comfyBase()}/prompt`, { method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, client_id: 'banana-studio' }) }), 'ComfyUI');
  if (typeof data?.prompt_id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(data.prompt_id)) throw new Error('ComfyUI did not confirm the job.');
  return data.prompt_id;
}

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|gif|webp)$/i;
export type ComfyResult = { status: 'running' | 'failed' | 'done'; error?: string; file?: { filename: string; subfolder: string; type: string } };
/** One status read. Prefers saved outputs over previews, and real video containers over animated images. */
export async function comfyStatus(id: string, kind: 'image' | 'video', signal?: AbortSignal): Promise<ComfyResult> {
  const data = await json(await fetch(`${comfyBase()}/history/${encodeURIComponent(id)}`, { redirect: 'error', signal, cache: 'no-store' }), 'ComfyUI');
  const entry = data?.[id];
  if (!entry) return { status: 'running' };
  if (entry.status?.status_str === 'error') return { status: 'failed', error: 'ComfyUI could not run this workflow. Check the ComfyUI console for the failing node.' };
  if (entry.status && !entry.status.completed) return { status: 'running' };
  const files = Object.values(entry.outputs || {}).flatMap((output: any) => ['videos', 'gifs', 'images', 'animated']
    .flatMap(key => Array.isArray(output?.[key]) ? output[key] : []))
    .filter((file: any) => typeof file?.filename === 'string' && (kind === 'image' ? IMAGE_EXT : VIDEO_EXT).test(file.filename));
  const rank = (file: any) => (file.type === 'output' ? 0 : 2) + (kind === 'video' && /\.(gif|webp)$/i.test(file.filename) ? 1 : 0);
  const file = files.sort((a: any, b: any) => rank(a) - rank(b))[0] as any;
  if (!file) return { status: 'failed', error: `The workflow finished without a saved ${kind}. Add a Save ${kind === 'image' ? 'Image' : 'Video'} node.` };
  return { status: 'done', file: { filename: file.filename, subfolder: String(file.subfolder || ''), type: String(file.type || 'output') } };
}
export async function comfyDownload(file: NonNullable<ComfyResult['file']>, maxBytes: number, signal?: AbortSignal): Promise<{ bytes: Buffer; mime: string; ext: string }> {
  const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
  const response = await fetch(`${comfyBase()}/view?${query}`, { redirect: 'error', signal });
  if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) throw new Error('The ComfyUI output could not be downloaded.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error('The ComfyUI output exceeds the size limit.');
  const ext = (file.filename.match(/\.(\w+)$/)?.[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
  const mime = ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' } as Record<string, string>)[ext] || 'application/octet-stream';
  return { bytes, mime, ext };
}
export async function comfyImage(job: LocalJob, signal: AbortSignal): Promise<Buffer> {
  return comfyWaitImage(await comfySubmit(job, 'image', signal), signal);
}
async function comfyWaitImage(id: string, signal: AbortSignal): Promise<Buffer> {
  while (true) {
    signal.throwIfAborted();
    const result = await comfyStatus(id, 'image', signal);
    if (result.status === 'failed') throw new Error(result.error);
    if (result.status === 'done') return (await comfyDownload(result.file!, 50 * 1024 * 1024, signal)).bytes;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// ---- Discovery for the settings screen ----
const probe = async (url: string) => { try { return (await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };
// Provider availability is read before every generation; a short cache keeps that cheap.
let statusCache: { at: number; key: string; value: Record<string, boolean | null> } | null = null;
export async function localServerStatus(): Promise<Record<string, boolean | null>> {
  const urls: Record<string, string> = { ollama: '/api/version', openaicompat: '/models', sdwebui: '/sdapi/v1/options', comfyui: '/system_stats' };
  const bases = Object.keys(urls).map(server => localServerUrl(server as LocalServer, process.env));
  const key = JSON.stringify(bases);
  if (statusCache && statusCache.key === key && Date.now() - statusCache.at < 3000) return statusCache.value;
  const value = Object.fromEntries(await Promise.all(Object.entries(urls).map(async ([server, suffix], index) =>
    [server, bases[index] ? await probe(bases[index] + suffix) : null])));
  statusCache = { at: Date.now(), key, value };
  return value;
}
export async function listLocalModels(server: string): Promise<{ models: string[]; workflows?: string[]; workflowsDir?: string }> {
  const signal = AbortSignal.timeout(5000);
  const base = localServerUrl(server as any, process.env);
  if (!base || !['sdwebui', 'comfyui', 'openaicompat'].includes(server)) throw new Error('This local server is not configured.');
  if (server === 'comfyui') return { models: await comfyCheckpoints(signal), workflows: listWorkflows(),
    ...(process.env.BANANA_RUNTIME === 'local' && workflowsDir() ? { workflowsDir: workflowsDir() } : {}) };
  const data = await json(await fetch(server === 'sdwebui' ? `${base}/sdapi/v1/sd-models` : `${base}/models`, { redirect: 'error', signal }), server);
  const names = server === 'sdwebui' ? (Array.isArray(data) ? data.map((m: any) => m?.title) : []) : (Array.isArray(data?.data) ? data.data.map((m: any) => m?.id) : []);
  return { models: names.filter(isLocalAssetName).slice(0, 500) };
}

// ---- Upscaling ----
/** The output still has to fit the raster decoder and storage limits. */
export const MAX_UPSCALE_PIXELS = 33_554_432;
export async function sdwebuiUpscale(image: Buffer, scale: number, signal: AbortSignal): Promise<Buffer> {
  const base = localServerUrl('sdwebui', process.env);
  if (!base) throw new Error('Stable Diffusion WebUI is not configured. Set SDWEBUI_BASE_URL.');
  const data = await json(await fetch(`${base}/sdapi/v1/extra-single-image`, { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: image.toString('base64'), resize_mode: 0, upscaling_resize: scale, upscaler_1: process.env.LOCAL_UPSCALER || 'R-ESRGAN 4x+' }) }), 'Stable Diffusion WebUI');
  if (typeof data?.image !== 'string' || !data.image) throw new Error('Stable Diffusion WebUI returned no upscaled image.');
  return Buffer.from(data.image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
}
export async function comfyUpscaleModels(signal?: AbortSignal): Promise<string[]> {
  const data = await json(await fetch(`${comfyBase()}/object_info/UpscaleModelLoader`, { redirect: 'error', signal }), 'ComfyUI');
  const names = data?.UpscaleModelLoader?.input?.required?.model_name?.[0];
  return Array.isArray(names) ? names.filter(isLocalAssetName) : [];
}
/** ESRGAN-style model when installed (then resized to the exact factor); plain lanczos otherwise. */
export async function comfyUpscale(image: Buffer, mime: string, size: { width: number; height: number }, scale: number, signal: AbortSignal): Promise<Buffer> {
  const models = await comfyUpscaleModels(signal);
  const model = models.find(name => name === process.env.LOCAL_UPSCALER) || models[0];
  const name = await comfyUpload(image, mime, signal);
  const graph = {
    1: { class_type: 'LoadImage', inputs: { image: name } },
    ...(model ? {
      2: { class_type: 'UpscaleModelLoader', inputs: { model_name: model } },
      3: { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['2', 0], image: ['1', 0] } },
    } : {}),
    4: { class_type: 'ImageScale', inputs: { image: [model ? '3' : '1', 0], upscale_method: 'lanczos', width: size.width * scale, height: size.height * scale, crop: 'disabled' } },
    5: { class_type: 'SaveImage', inputs: { filename_prefix: 'banana-studio-upscale', images: ['4', 0] } },
  };
  return comfyWaitImage(await comfyQueue(graph, signal), signal);
}
