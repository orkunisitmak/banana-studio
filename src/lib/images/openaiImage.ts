import type { AspectRatio, GeneratedMedia, GenerationConfig, OpenAIImageOptions, ReferenceImage, Resolution } from '../../types.js';

export const SUNBURST_MODEL = 'gpt-image-2.5-sunburst' as const;
/** Models executeOpenAIImage saves under openai/<user>/<id>; their stored files can be recovered. */
export const RECOVERABLE_IMAGE_MODELS: readonly string[] = [SUNBURST_MODEL, 'gemini-3-pro-image-preview', 'gemini-nano-banana-2.1'];
/** Keep draft/analysis inputs in attachment order. Final filtering is compiled
 * together with the provider prompt by prepareSunburstGeneration. */
export const getSunburstReferences = (refs: ReferenceImage[]): ReferenceImage[] => refs;

type ImagePromptContext = Pick<GenerationConfig, 'imageModel' | 'referenceImages' | 'imagePromptCategory'>;

export const getImagePromptContextKey = (config: ImagePromptContext): string => {
  const sunburst = config.imageModel === SUNBURST_MODEL;
  const refs = sunburst ? getSunburstReferences(config.referenceImages || []) : config.referenceImages || [];
  return JSON.stringify({
    model: config.imageModel,
    references: refs.map(ref => [ref.id, !!ref.isSubjectImage, !!ref.isSecondPerson, ref.personId, ref.personName, !!ref.isDraftImage, !!ref.isVideoContext, !!ref.editRegion, !!ref.isThumbnailStyle]),
    ...(sunburst ? { promptPolicyVersion: 10, category: config.imagePromptCategory } : {}),
  });
};

export const isImagePromptContextCurrent = (savedKey: string, config: ImagePromptContext): boolean => {
  try {
    const saved = JSON.parse(savedKey);
    // Older enhancements included output size/background in their context.
    // Those are request settings, not reasons to rewrite a creative prompt.
    return JSON.stringify({
      model: saved.model,
      references: saved.references,
      promptPolicyVersion: saved.promptPolicyVersion,
      category: saved.category,
    }) === getImagePromptContextKey(config);
  } catch {
    return false;
  }
};
export const DEFAULT_OPENAI_IMAGE_OPTIONS: OpenAIImageOptions = {
  quality: 'auto', size: 'preset', width: 1536, height: 1024,
  background: 'auto', outputFormat: 'png', outputCompression: 100, moderation: 'low',
};
export const SUNBURST_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const SUNBURST_QUALITY_OPTIONS = SUNBURST_QUALITIES.map(value => ({ value,
  label: ({ auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' })[value] }));
// https://developers.openai.com/api/docs/guides/image-generation
// Each edge <=3840, multiples of 16, 655360..8294400 pixels, ratio <=3:1.
const SIZES: Record<Resolution, Record<AspectRatio, string>> = {
  '1K': { '1:1': '1024x1024', '4:3': '1024x768', '3:4': '768x1024', '16:9': '1536x864', '9:16': '864x1536' },
  '2K': { '1:1': '2048x2048', '4:3': '2048x1536', '3:4': '1536x2048', '16:9': '2560x1440', '9:16': '1440x2560' },
  '4K': { '1:1': '2880x2880', '4:3': '3312x2480', '3:4': '2480x3312', '16:9': '3840x2160', '9:16': '2160x3840' },
};

export const getOpenAIImageOptions = (options?: Partial<OpenAIImageOptions>): OpenAIImageOptions => ({
  quality: options?.quality ?? DEFAULT_OPENAI_IMAGE_OPTIONS.quality,
  size: options?.size ?? DEFAULT_OPENAI_IMAGE_OPTIONS.size,
  width: options?.width ?? DEFAULT_OPENAI_IMAGE_OPTIONS.width,
  height: options?.height ?? DEFAULT_OPENAI_IMAGE_OPTIONS.height,
  // These settings are intentionally fixed, including when loading old templates.
  background: DEFAULT_OPENAI_IMAGE_OPTIONS.background,
  outputFormat: DEFAULT_OPENAI_IMAGE_OPTIONS.outputFormat,
  outputCompression: DEFAULT_OPENAI_IMAGE_OPTIONS.outputCompression,
  moderation: DEFAULT_OPENAI_IMAGE_OPTIONS.moderation,
});

export const getOpenAIImageSize = (config: Pick<GenerationConfig, 'openaiImageOptions' | 'resolution' | 'aspectRatio'>): string => {
  const options = getOpenAIImageOptions(config.openaiImageOptions);
  if (options.size === 'auto') return 'auto';
  if (options.size === 'custom') return `${options.width}x${options.height}`;
  return SIZES[config.resolution]?.[config.aspectRatio] || '';
};

export const validateOpenAIImageSize = (size: unknown): string | null => {
  if (size === 'auto') return null;
  if (typeof size !== 'string' || !/^\d+x\d+$/.test(size)) return 'Choose a valid image size.';
  const [w, h] = size.split('x').map(Number);
  if (w <= 0 || h <= 0 || w % 16 || h % 16 || Math.max(w, h) > 3840) {
    return 'Width and height must be multiples of 16, up to 3840 px.';
  }
  if (Math.max(w / h, h / w) > 3 || w * h < 655360 || w * h > 8294400) {
    return 'Use 655,360–8,294,400 pixels and an aspect ratio between 1:3 and 3:1.';
  }
  return null;
};

/** UI-only correction. Keep strict validation for incoming API requests. */
export const correctOpenAIImageDimensions = (width: number, height: number,
  fallback = DEFAULT_OPENAI_IMAGE_OPTIONS): { width: number; height: number } => {
  const snap = (value: number, previous: number) => Math.max(16, Math.min(3840,
    Math.round((Number.isFinite(value) && value > 0 ? value : Number.isFinite(previous) && previous > 0 ? previous : 1024) / 16) * 16));
  let w = snap(width, fallback.width);
  let h = snap(height, fallback.height);
  // Widen the short edge for unsupported panoramic/portrait ratios.
  if (w > h * 3) h = Math.ceil(w / 3 / 16) * 16;
  if (h > w * 3) w = Math.ceil(h / 3 / 16) * 16;
  const pixels = w * h;
  if (pixels < 655360) {
    const scale = Math.sqrt(655360 / pixels);
    w = Math.ceil(w * scale / 16) * 16;
    h = Math.ceil(h * scale / 16) * 16;
  } else if (pixels > 8294400) {
    const scale = Math.sqrt(8294400 / pixels);
    w = Math.floor(w * scale / 16) * 16;
    h = Math.floor(h * scale / 16) * 16;
  }
  return { width: w, height: h };
};

export const validateOpenAIImageOptions = (options: OpenAIImageOptions): string | null => {
  if (!SUNBURST_QUALITIES.includes(options.quality)) return 'Unsupported quality.';
  if (!['preset', 'auto', 'custom'].includes(options.size)) return 'Unsupported size mode.';
  if (!['auto', 'opaque', 'transparent'].includes(options.background)) return 'Unsupported background.';
  if (!['png', 'jpeg', 'webp'].includes(options.outputFormat)) return 'Unsupported output format.';
  if (options.inputFidelity != null && !['high', 'low'].includes(options.inputFidelity)) return 'Unsupported input fidelity.';
  if (!['auto', 'low'].includes(options.moderation)) return 'Unsupported moderation setting.';
  if (!Number.isInteger(options.outputCompression) || options.outputCompression < 0 || options.outputCompression > 100) return 'Compression must be an integer from 0 to 100.';
  if (options.background === 'transparent' && options.outputFormat === 'jpeg') return 'Transparent backgrounds require PNG or WebP.';
  return null;
};

// Rates verified 2026-09-08 on the Sunburst model page. Return unknown when
// usage is missing/incomplete, rather than silently reporting a free image.
export const calculateOpenAIImageCost = (usage: any): number | null => {
  const details = usage?.input_tokens_details;
  const text = details?.text_tokens;
  const images = details?.image_tokens;
  const output = usage?.output_tokens_details?.image_tokens ?? usage?.output_tokens;
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (![text, images, output].every(valid)) return null;
  const cached = details?.cached_tokens_details;
  if (details?.cached_tokens > 0 && (!cached || !valid(cached.text_tokens) || !valid(cached.image_tokens))) return null;
  const cachedText = cached?.text_tokens ?? 0;
  const cachedImages = cached?.image_tokens ?? 0;
  if (!valid(cachedText) || !valid(cachedImages) || cachedText > text || cachedImages > images) return null;
  return ((text - cachedText) * 5 + cachedText * 1.25 + (images - cachedImages) * 8 + cachedImages * 2 + output * 30) / 1_000_000;
};

export const getImageOutputRatio = (size?: string): string | undefined => {
  if (!size || !/^\d+x\d+$/.test(size)) return undefined;
  const [width, height] = size.split('x').map(Number);
  if (width <= 0 || height <= 0) return undefined;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
};

/** A preset label is not the actual size of a Sunburst result. */
export const getImageResolutionLabel = (media: Pick<GeneratedMedia, 'imageModel' | 'resolution' | 'imageOutputSize' | 'imageRequestedSize'>): string => {
  if (media.imageModel !== SUNBURST_MODEL) return media.resolution;
  if (media.imageOutputSize) return media.imageOutputSize;
  if (media.imageRequestedSize === 'auto') return 'Auto size requested';
  if (media.imageRequestedSize) return `${media.imageRequestedSize} requested`;
  return 'Size unavailable';
};

export const isImagePresetLabel = (size?: string): boolean => Boolean(size?.includes('·'));

export const hasImageSizeMismatch = (media: Pick<GeneratedMedia, 'imageRequestedSize' | 'imageOutputSize'>): boolean =>
  Boolean(media.imageOutputSize && media.imageRequestedSize && media.imageRequestedSize !== 'auto' && !isImagePresetLabel(media.imageRequestedSize) && media.imageRequestedSize !== media.imageOutputSize);
