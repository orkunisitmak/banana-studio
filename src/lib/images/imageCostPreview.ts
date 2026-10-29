import { estimateImageCost, type GeneratedMedia, type GenerationConfig, type OpenAIImageOptions } from '../../types';
import { calculateOpenAIImageCost, getOpenAIImageOptions, getOpenAIImageSize, getSunburstReferences, SUNBURST_MODEL, validateOpenAIImageOptions, validateOpenAIImageSize } from './openaiImage';
import { estimateNanoBanana21OutputCost, NANO_BANANA_21_MODEL } from './nanoBanana21';

type ExplicitQuality = Exclude<OpenAIImageOptions['quality'], 'auto'>;
const dollars = (value: number) => `$${value.toFixed(value > 0 && value < 1 ? 3 : 2)}`;
const QUALITY_GRID: Record<ExplicitQuality, number> = { low: 16, medium: 24, high: 48, xhigh: 64, max: 96 };

// OpenAI's GPT Image 2.5 calculator, verified 2026-09-08:
// https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency
// Its aspect-ratio scaling rounds half ties to even; Math.round alone differs.
export const estimateSunburstOutputTokens = (width: number, height: number, quality: ExplicitQuality): number => {
  const longGrid = QUALITY_GRID[quality];
  const scaled = longGrid * Math.min(width, height) / Math.max(width, height);
  const floor = Math.floor(scaled);
  const shortGrid = scaled - floor === 0.5 ? floor + floor % 2 : Math.round(scaled);
  return Math.ceil(longGrid * shortGrid * (2_000_000 + width * height) / 4_000_000);
};

// Auto size can choose any supported dimensions. Cache the complete valid-size
// bounds instead of pretending it uses the ratio/resolution hidden in the UI.
const autoBounds = new Map<ExplicitQuality, [number, number]>();
const getAutoBounds = (quality: ExplicitQuality): [number, number] => {
  const saved = autoBounds.get(quality);
  if (saved) return saved;
  let min = Infinity, max = 0;
  for (let width = 16; width <= 3840; width += 16) {
    for (let height = 16; height <= width; height += 16) {
      const pixels = width * height;
      if (pixels < 655360 || pixels > 8294400 || width / height > 3) continue;
      const tokens = estimateSunburstOutputTokens(width, height, quality);
      min = Math.min(min, tokens); max = Math.max(max, tokens);
    }
  }
  const bounds: [number, number] = [min, max];
  autoBounds.set(quality, bounds);
  return bounds;
};

export interface ImageCostPreview {
  min: number | null;
  max: number | null;
  label: string;
  description: string;
  note: string;
  basis: 'output' | 'history' | 'fixed' | 'unknown';
}

export type ImageCostSample = Pick<GeneratedMedia, 'generationProvider' | 'id' | 'imageModel' | 'openaiImageOptions' | 'imageRequestedSize' | 'imageOutputSize' | 'referenceImages' | 'openaiUsage'>;

const referenceKey = (references: GenerationConfig['referenceImages']): string | null => {
  // Do not identify unrelated photos merely by their count. Reference IDs survive upload.
  if (references.some(ref => !ref || typeof ref.id !== 'string' || !ref.id)) return null;
  return JSON.stringify(references.map(ref => [ref.id, ref.mimeType]));
};

type CostConfig = Pick<GenerationConfig, 'imageProvider' | 'imageModel' | 'resolution' | 'aspectRatio' | 'openaiImageOptions' | 'referenceImages' | 'count'>;
export const getImageCostPreview = (config: CostConfig, count = config.count, history: ImageCostSample[] = []): ImageCostPreview => {
  // Reject invalid draft counts before selecting a provider-specific estimator.
  // Otherwise zero, fractional, negative or non-finite counts can display a
  // misleading $0 or negative price for a potentially billable operation.
  if (!Number.isSafeInteger(count) || count < 1) {
    return { min: null, max: null, label: 'Choose valid image count',
      description: 'Choose a positive whole number of images before estimating generation cost.',
      note: '', basis: 'unknown' };
  }
  if (config.imageProvider === 'codex') return { min: null, max: null, label: 'ChatGPT plan', description: 'Runs through your Codex sign-in. No API charge; each image uses your ChatGPT plan’s Codex usage limits.', note: '', basis: 'unknown' };
  if (config.imageProvider && config.imageProvider !== (config.imageModel === SUNBURST_MODEL ? 'openai' : 'fal')) return { min: null, max: null, label: 'Provider usage-based', description: 'This route uses the selected provider’s billing. Actual cost is shown when returned; another provider’s estimate is not used.', note: '', basis: 'unknown' };
  if (config.imageModel === NANO_BANANA_21_MODEL) {
    const cost = estimateNanoBanana21OutputCost(config.resolution, count);
    return { min: cost, max: cost, label: cost == null ? 'Usage-based' : `~${dollars(cost)} output`,
      description: `Representative output-image estimate for ${count} image${count === 1 ? '' : 's'}. Nano Banana 2.1 bills tokens: prompt, reference images and High thinking cost extra for every image. This is not a total price or spending limit; the queue does not return final token usage.`,
      note: 'Input and thinking extra', basis: cost == null ? 'unknown' : 'output' };
  }
  if (config.imageModel !== SUNBURST_MODEL) {
    const cost = estimateImageCost(config.imageModel, config.resolution, count, config.aspectRatio, config.referenceImages.length > 0);
    return { min: cost, max: cost, label: cost == null ? 'Usage-based' : `~$${cost.toFixed(2)}`, description: 'Estimated generation cost.', note: '', basis: cost == null ? 'unknown' : 'fixed' };
  }
  const options = getOpenAIImageOptions(config.openaiImageOptions);
  const size = getOpenAIImageSize(config);
  if (!Number.isInteger(count) || count < 0 || validateOpenAIImageOptions(options) || validateOpenAIImageSize(size)) {
    return { min: null, max: null, label: 'Choose valid size', description: 'Choose valid image settings to preview cost.', note: '', basis: 'unknown' };
  }
  const refs = getSunburstReferences(config.referenceImages);
  const key = referenceKey(refs);
  const seen = new Set<string>();
  const totals = history.flatMap(sample => {
    if (!sample.id || seen.has(sample.id) || key == null || sample.imageModel !== SUNBURST_MODEL
      || sample.imageRequestedSize !== size || (size !== 'auto' && sample.imageOutputSize !== size)
      || sample.openaiImageOptions?.quality !== options.quality
      || sample.openaiImageOptions?.outputFormat !== options.outputFormat
      || !Array.isArray(sample.referenceImages) || referenceKey(sample.referenceImages) !== key) return [];
    if (sample.generationProvider && sample.generationProvider !== 'openai') return [];
    const usage: any = sample.openaiUsage;
    // Lite gallery rows omit references. Nonzero image input usage must not
    // accidentally become a matching text-only generation after a reload.
    if (!refs.length && usage?.input_tokens_details?.image_tokens !== 0) return [];
    const total = calculateOpenAIImageCost(usage);
    if (total == null || total <= 0) return [];
    seen.add(sample.id);
    return [total];
  });
  if (totals.length >= 3) {
    const min = Math.min(...totals) * count, max = Math.max(...totals) * count;
    return {
      min, max, basis: 'history',
      label: dollars(min) === dollars(max) ? `~${dollars(max)}` : `~${dollars(min)}–${dollars(max)}`,
      note: `Total estimate · ${totals.length} matching generations`,
      description: `Estimated total for ${count} image${count === 1 ? '' : 's'}, including prompt, reference and output costs. Based on ${totals.length} past generations with the same model, quality, size, format and reference photos. This is the observed cost range, not a spending limit; prompt changes and caching can change the final cost.`,
    };
  }
  const qualities: ExplicitQuality[] = options.quality === 'auto' ? ['low', 'max'] : [options.quality];
  const tokens = qualities.flatMap(quality => {
    if (size === 'auto') return getAutoBounds(quality);
    const [width, height] = size.split('x').map(Number);
    return [estimateSunburstOutputTokens(width, height, quality)];
  });
  const min = Math.min(...tokens) * 30 / 1_000_000 * count;
  const max = Math.max(...tokens) * 30 / 1_000_000 * count;
  return {
    min, max,
    label: min === max ? `~${dollars(min)} output` : `~${dollars(min)}–${dollars(max)} output`,
    basis: 'output', note: [options.quality === 'auto' ? 'Auto quality · Low–Max' : '', size === 'auto' ? 'Auto size' : ''].filter(Boolean).join(' · '),
    description: `Output-only estimate for ${count} image${count === 1 ? '' : 's'}, not the total price. Prompt and reference costs are extra for every image, including repeated references in a batch. A total estimate needs at least 3 past generations with matching settings and reference photos.${options.quality === 'auto' ? ' Auto quality shows the estimated Low–Max output range, not a price limit.' : ''}${size === 'auto' ? ' Auto size includes all supported dimensions.' : ''} Final cost is saved from provider usage after generation.`,
  };
};
