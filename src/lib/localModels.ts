// Server-safe definitions for self-hosted model servers (no credentials, no credits).
import type { AspectRatio, Resolution } from '../types.js';

export const LOCAL_IMAGE_MODEL = 'local-image' as const;
export const LOCAL_VIDEO_MODEL = 'local-video' as const;
export type LocalServer = 'ollama' | 'openaicompat' | 'sdwebui' | 'comfyui';

/** Desktop uses these defaults without setup; hosted installs opt in with the env variable. */
export const LOCAL_SERVERS: Record<LocalServer, { env: string; defaultUrl: string; label: string }> = {
  ollama: { env: 'OLLAMA_BASE_URL', defaultUrl: 'http://127.0.0.1:11434', label: 'Ollama' },
  openaicompat: { env: 'LOCAL_OPENAI_BASE_URL', defaultUrl: 'http://127.0.0.1:1234/v1', label: 'LM Studio / OpenAI-compatible' },
  sdwebui: { env: 'SDWEBUI_BASE_URL', defaultUrl: 'http://127.0.0.1:7860', label: 'Stable Diffusion WebUI' },
  comfyui: { env: 'COMFYUI_BASE_URL', defaultUrl: 'http://127.0.0.1:8188', label: 'ComfyUI' },
};

export const localServerUrl = (server: LocalServer, env: Record<string, string | undefined>): string | null => {
  if (env[`${server.toUpperCase()}_ENABLED`] === 'false') return null;
  const { env: name, defaultUrl } = LOCAL_SERVERS[server];
  const value = env[name]?.trim() || (env.BANANA_RUNTIME === 'local' ? defaultUrl : '');
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
};

/** Checkpoint / model names are forwarded only to the configured server, never used as paths here. */
export const isLocalAssetName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
/** Workflow files are opened from one server-owned folder: plain file names only. */
export const isWorkflowName = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,80}\.json$/.test(value) && !value.includes('..');

/** The model and workflow are device choices: the server runs next to this workspace. */
export const LOCAL_CHOICE_KEYS = {
  imageModel: 'banana-local-image-model', imageWorkflow: 'banana-local-image-workflow',
  videoModel: 'banana-local-video-model', videoWorkflow: 'banana-local-video-workflow',
} as const;
export type LocalChoice = keyof typeof LOCAL_CHOICE_KEYS;

const AREA: Record<Resolution, number> = { '1K': 1024, '2K': 1536, '4K': 2048 };
const round = (value: number, step: number) => Math.max(step, Math.round(value / step) * step);
/** Diffusion models need multiples of 8; keep the requested area and ratio. */
export const localImageSize = (aspectRatio: AspectRatio | string, resolution: Resolution | string, source?: { width: number; height: number }) => {
  const side = AREA[resolution as Resolution] || 1024;
  const [w, h] = source ? [source.width, source.height] : String(aspectRatio).split(':').map(Number);
  const ratio = w > 0 && h > 0 ? w / h : 1;
  if (source && w % 8 === 0 && h % 8 === 0 && w <= 2048 && h <= 2048) return { width: w, height: h };
  return { width: round(side * Math.sqrt(ratio), 8), height: round(side / Math.sqrt(ratio), 8) };
};

/** Video models want multiples of 16; quality sets the short side. */
export const localVideoSize = (aspectRatio: string, quality: string) => {
  const short = ({ '480p': 480, '720p': 720, '768p': 768, '1080p': 1080 } as Record<string, number>)[quality] || 480;
  const [w, h] = (aspectRatio === 'adaptive' ? '16:9' : aspectRatio).split(':').map(Number);
  const ratio = w > 0 && h > 0 ? w / h : 16 / 9;
  const long = Math.round(short * Math.max(ratio, 1 / ratio) / 16) * 16;
  return ratio >= 1 ? { width: long, height: short } : { width: short, height: long };
};

/** Shared validation for the browser-chosen local image options; null when valid. */
export const localImageOptionsError = (body: any): string | null => {
  if (body.localModel != null && !isLocalAssetName(body.localModel)) return 'Invalid local model.';
  if (body.localWorkflow != null && !isWorkflowName(body.localWorkflow)) return 'Invalid local workflow.';
  if (body.localSeed != null && !(Number.isSafeInteger(body.localSeed) && body.localSeed >= 0 && body.localSeed < 2 ** 32)) return 'The seed must be a whole number from 0 to 4294967295.';
  if (body.localNegativePrompt != null && (typeof body.localNegativePrompt !== 'string' || body.localNegativePrompt.length > 2000)) return 'The negative prompt can have up to 2,000 characters.';
  if (body.localUpscale != null && ![2, 4].includes(body.localUpscale)) return 'Upscale supports 2x or 4x.';
  if ((body.localSeed != null || body.localNegativePrompt != null || body.localUpscale != null) && body.model !== LOCAL_IMAGE_MODEL) return 'These options need the local image model.';
  return null;
};
