import type { ReferenceImage } from '../../types.js';

// Schemas: https://fal.ai/models/bytedance/seedream/v5.5/{text-to-image,edit,layerize}/api
export { SEEDREAM_MODEL } from './seedreamModel.js';
export const SEEDREAM_ENDPOINTS = {
  'text-to-image': 'bytedance/seedream/v5.5/text-to-image',
  edit: 'bytedance/seedream/v5.5/edit',
  layerize: 'bytedance/seedream/v5.5/layerize',
} as const;
export type SeedreamMode = keyof typeof SEEDREAM_ENDPOINTS;
const ENDPOINT_MODES = new Map<string, SeedreamMode>(
  (Object.keys(SEEDREAM_ENDPOINTS) as SeedreamMode[]).map(mode => [SEEDREAM_ENDPOINTS[mode], mode]),
);
export const isSeedreamEndpoint = (endpoint: unknown): endpoint is typeof SEEDREAM_ENDPOINTS[SeedreamMode] =>
  typeof endpoint === 'string' && ENDPOINT_MODES.has(endpoint);
export const SEEDREAM_IMAGE_SIZES = ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9', 'auto_1K', 'auto_1.5K', 'auto_2K'] as const;
export const SEEDREAM_LAYER_SIZES = ['auto', 'auto_1K', 'auto_1.5K', 'auto_2K'] as const;
// Per request, including the base image for Layerize.
export const SEEDREAM_MAX_IMAGES = 6;
export const SEEDREAM_MAX_LAYER_IMAGES = 100;
export const SEEDREAM_MAX_INLINE_LAYER_IMAGES = 30;
export interface SeedreamOptions {
  mode: SeedreamMode;
  imageSize: typeof SEEDREAM_IMAGE_SIZES[number] | { width: number; height: number };
  layerSize: typeof SEEDREAM_LAYER_SIZES[number];
  outputFormat: 'png' | 'jpeg';
  background: 'auto' | 'opaque' | 'transparent';
  numImages: number;
  maxImages: number;
  enableTextRecognition: boolean;
  watermark: boolean;
  syncMode: boolean;
  enableSafetyChecker: boolean;
}
export const DEFAULT_SEEDREAM_OPTIONS: SeedreamOptions = {
  mode: 'text-to-image', imageSize: 'auto_2K', layerSize: 'auto', outputFormat: 'png',
  background: 'auto', numImages: 1, maxImages: 30, enableTextRecognition: false,
  watermark: false, syncMode: false, enableSafetyChecker: true,
};

export interface SeedreamImage {
  url: string;
  content_type?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  width?: number | null;
  height?: number | null;
}
type Bounds = [number, number, number, number];
interface SeedreamBoundingBox { absolute: Bounds; normalized: Bounds }
interface SeedreamTextStyle {
  similar_font_family?: string;
  foreground_color?: string | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  shadow?: boolean;
  translucent?: boolean;
}
export interface SeedreamLayer {
  image: SeedreamImage;
  z_index: number;
  bounding_box?: SeedreamBoundingBox | null;
  name?: string | null;
  description?: string | null;
  text_recognition?: {
    text: string;
    lines: { bounding_box: SeedreamBoundingBox; runs: { text: string; style: SeedreamTextStyle }[] }[];
  } | null;
}
export interface SeedreamResult { images: SeedreamImage[]; layers?: SeedreamLayer[] }

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const oneOf = (value: unknown, allowed: readonly string[]) => typeof value === 'string' && allowed.includes(value);
const withinAspectRange = (w: number, h: number) => w <= 16 * h && h <= 16 * w;
const COMMON_KEYS = ['prompt', 'image_size', 'output_format', 'watermark', 'sync_mode', 'enable_safety_checker'];
const GENERATION_KEYS = [...COMMON_KEYS, 'num_images', 'background'];
const INPUT_KEYS = {
  'text-to-image': new Set(GENERATION_KEYS), edit: new Set([...GENERATION_KEYS, 'image_urls']),
  layerize: new Set([...COMMON_KEYS, 'image_url', 'max_images', 'enable_text_recognition']),
};

function validateParameters(mode: SeedreamMode, input: Record<string, unknown>, awaitingBrainstormPrompt = false): string | null {
  if (!Object.hasOwn(SEEDREAM_ENDPOINTS, mode)) return 'Choose a valid Seedream 5.5 mode.';
  for (const key of Object.keys(input)) if (!INPUT_KEYS[mode].has(key)) return `Seedream ${mode} does not accept ${key}.`;
  if (input.prompt !== undefined || mode !== 'layerize') {
    if (typeof input.prompt !== 'string' || (mode !== 'layerize' && !awaitingBrainstormPrompt && !input.prompt.trim())) return 'Seedream needs a prompt for generation or editing.';
  }
  for (const key of ['watermark', 'sync_mode', 'enable_safety_checker', 'enable_text_recognition']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') return `${key} must be a boolean.`;
  }
  if (input.output_format !== undefined && !oneOf(input.output_format, ['png', 'jpeg'])) return 'Choose PNG or JPEG output.';
  const size = input.image_size;
  if (mode === 'layerize') {
    if (size !== undefined && !oneOf(size, SEEDREAM_LAYER_SIZES)) return 'Choose a supported layer size tier.';
    if (input.max_images !== undefined && !inRange(input.max_images, 2, SEEDREAM_MAX_LAYER_IMAGES)) return `Max images must be an integer from 2 to ${SEEDREAM_MAX_LAYER_IMAGES}, including the base.`;
  } else {
    if (input.num_images !== undefined && !inRange(input.num_images, 1, SEEDREAM_MAX_IMAGES)) return `Number of images must be an integer from 1 to ${SEEDREAM_MAX_IMAGES}.`;
    if (input.background !== undefined && !oneOf(input.background, ['auto', 'opaque', 'transparent'])) return 'Choose a supported background.';
    if (input.background === 'transparent' && input.output_format === 'jpeg') return 'Transparent backgrounds require PNG output.';
    if (size !== undefined && !oneOf(size, SEEDREAM_IMAGE_SIZES)) {
      if (typeof size !== 'object' || size === null || Array.isArray(size) || Object.keys(size).some(key => key !== 'width' && key !== 'height')) return 'Choose a supported image size or custom dimensions.';
      const width = 'width' in size ? size.width : 512, height = 'height' in size ? size.height : 512;
      if (!inRange(width, 1, 14142) || !inRange(height, 1, 14142)) return 'Custom dimensions must be whole pixels from 1 to 14142.';
      if (width * height < 921600 || width * height > 4624220 || !withinAspectRange(width, height)) return 'Custom size requires 921600–4624220 pixels and an aspect ratio between 1:16 and 16:1.';
    }
  }
  return null;
}

function referenceCountError(mode: SeedreamMode, count: number): string | null {
  if (mode === 'text-to-image' && count !== 0) return 'Text-to-image does not use reference images. Remove them or choose Edit.';
  if (mode === 'edit' && (count < 1 || count > 10)) return 'Seedream Edit needs 1–10 reference images.';
  if (mode === 'layerize' && count !== 1) return 'Seedream Layerize needs exactly one source image.';
  return null;
}

const inlineImageHeader = /^data:image\/[a-z0-9.+-]+;base64,/i;
const MAX_LAYER_SOURCE_BYTES = 30 * 1024 * 1024;
function base64ByteLength(value: string, start: number) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length - start) * 3 / 4) - padding;
}
function validateImageUrl(value: unknown, layerize: boolean): string | null {
  if (typeof value === 'string') {
    const header = inlineImageHeader.exec(value);
    if (header && value.length > header[0].length) {
      const payload = value.slice(header[0].length);
      if (payload.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || (payload.endsWith('=') && payload.length % 4 !== 0)) return 'Provide valid base64 image data.';
      return layerize && base64ByteLength(value, header[0].length) > MAX_LAYER_SOURCE_BYTES ? 'Layerize source must be no larger than 30 MB.' : null;
    }
    if (/^https?:\/\//i.test(value)) {
      try { if (new URL(value).hostname) return null; } catch { /* Invalid URL. */ }
    }
  }
  return 'Provide an image URL or base64 image data URI.';
}

/** Validate untrusted wire JSON without fetching remote media. Unknown remote dimensions/bytes are checked by fal. */
export function validateSeedreamInput(endpoint: string, input: Record<string, unknown>): string | null {
  const mode = ENDPOINT_MODES.get(endpoint);
  if (!mode || !input || typeof input !== 'object' || Array.isArray(input)) return 'Invalid Seedream endpoint or input.';
  const error = validateParameters(mode, input);
  if (error) return error;
  if (mode === 'layerize') return validateImageUrl(input.image_url, true);
  if (mode === 'edit') {
    if (!Array.isArray(input.image_urls)) return 'Seedream Edit requires image_urls.';
    const countError = referenceCountError(mode, input.image_urls.length);
    if (countError) return countError;
    for (const url of input.image_urls) { const urlError = validateImageUrl(url, false); if (urlError) return urlError; }
  }
  return null;
}

function parameters(options: SeedreamOptions, prompt: string): Record<string, unknown> {
  return {
    prompt, output_format: options.outputFormat, watermark: options.watermark, sync_mode: options.syncMode, enable_safety_checker: options.enableSafetyChecker,
    ...(options.mode === 'layerize'
      ? { image_size: options.layerSize, max_images: options.maxImages, enable_text_recognition: options.enableTextRecognition }
      : { image_size: options.imageSize, num_images: options.numImages, background: options.background }),
  };
}

export function buildSeedreamRequest(options: Partial<SeedreamOptions> | undefined, prompt: string, imageUrls: string[]): { endpoint: string; input: Record<string, unknown> } {
  const settings = { ...DEFAULT_SEEDREAM_OPTIONS, ...options };
  const { mode } = settings;
  const countError = referenceCountError(mode, imageUrls.length);
  if (countError) throw new Error(countError);
  const endpoint = SEEDREAM_ENDPOINTS[mode];
  const input = parameters(settings, prompt);
  if (mode === 'layerize') input.image_url = imageUrls[0];
  if (mode === 'edit') input.image_urls = imageUrls;
  const error = validateSeedreamInput(endpoint, input);
  if (error) throw new Error(error);
  // Restored drafts may have inline output enabled from a different mode.
  if (mode === 'layerize' && settings.maxImages > SEEDREAM_MAX_INLINE_LAYER_IMAGES) input.sync_mode = false;
  return { endpoint, input };
}

/** Draft references may still be local base64; don't require uploaded URLs or assume unmeasured dimensions. */
export function getSeedreamDraftError(options: Partial<SeedreamOptions> | undefined, prompt: string, refs: ReferenceImage[], awaitingBrainstormPrompt = false): string | null {
  const settings = { ...DEFAULT_SEEDREAM_OPTIONS, ...options };
  const error = validateParameters(settings.mode, parameters(settings, prompt), awaitingBrainstormPrompt) || referenceCountError(settings.mode, refs.length);
  if (error) return error;
  if (refs.some(ref => ref.editRegion != null)) return 'Seedream does not support protected Edit areas. Clear the selection before continuing.';
  if (settings.mode === 'layerize') {
    const { width, height, data } = refs[0];
    if (width != null && height != null && (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || width * height < 512 * 512 || width * height > 6000 * 6000 || !withinAspectRange(width, height))) {
      return 'Layerize source requires 262144–36000000 pixels and an aspect ratio between 1:16 and 16:1.';
    }
    const header = inlineImageHeader.exec(data);
    if ((header || !/^https?:\/\//i.test(data)) && base64ByteLength(data, header ? header[0].length : 0) > MAX_LAYER_SOURCE_BYTES) return 'Layerize source must be no larger than 30 MB.';
  }
  return null;
}
