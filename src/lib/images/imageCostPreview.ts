import { estimateImageCost, type GeneratedMedia, type GenerationConfig, type OpenAIImageOptions } from '../../types';
import { calculateOpenAIImageCost, getOpenAIImageOptions, getOpenAIImageSize, getSunburstReferences, GPT_IMAGE_26_SUNBURST_MODEL, isOpenAIImageModel, SUNBURST_MODEL, validateOpenAIImageOptions, validateOpenAIImageSize } from './openaiImage';
import { estimateNanoBanana21OutputCost, NANO_BANANA_21_MODEL } from './nanoBanana21';
import { DEFAULT_SEEDREAM_OPTIONS, SEEDREAM_MODEL } from './seedream55';
import { getSeedreamCostBounds } from './seedreamPricing';

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

export type ImageCostSample = Pick<GeneratedMedia, 'id' | 'generationProvider' | 'imageModel' | 'openaiImageOptions' | 'imageRequestedSize' | 'imageOutputSize' | 'referenceImages' | 'openaiUsage' | 'generationCost'> & { createdAt?: number };

// Similar input workloads, without requiring the same reference photo IDs.
const referenceBucket = (count: number) => count <= 1 ? count : count <= 4 ? 2 : count <= 8 ? 3 : 4;

const getGpt26CostPreview = (config: CostConfig, options: OpenAIImageOptions, size: string, count: number, history: ImageCostSample[]): ImageCostPreview => {
  const records = [...history].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).flatMap(sample => {
    if (!sample.id || sample.imageModel !== GPT_IMAGE_26_SUNBURST_MODEL) return [];
    const recorded = sample.generationCost;
    const usd = (sample.generationProvider === 'fal' ? null : calculateOpenAIImageCost(sample.openaiUsage))
      ?? (recorded && ['provider_usage', 'provider_actual'].includes(recorded.source) && Number.isFinite(recorded.usd) && recorded.usd >= 0 ? recorded.usd : null);
    if (usd == null) return [];
    // Lite gallery rows can omit references even though image tokens were billed.
    const imageTokens = (sample.openaiUsage?.input_tokens_details as { image_tokens?: number } | undefined)?.image_tokens;
    const refs = Array.isArray(sample.referenceImages) && (sample.referenceImages.length || (imageTokens ?? 0) === 0)
      ? referenceBucket(sample.referenceImages.length) : null;
    return [{ sample, usd, refs, options: getOpenAIImageOptions(sample.openaiImageOptions, sample.imageModel) }];
  });
  const bucket = referenceBucket(config.referenceImages.length);
  const sameSizeQuality = (record: typeof records[number]) => record.sample.imageRequestedSize === size && record.options.quality === options.quality;
  const exact = records.filter(record => sameSizeQuality(record) && record.options.complexity === options.complexity
    && record.options.outputFormat === options.outputFormat && record.refs === bucket
    && (options.outputFormat !== 'gif' || record.options.gifFrameCount === options.gifFrameCount));
  // Prefer the same size and quality; if neither exists, use the closest known
  // workload and explicitly label it as similar instead of inventing a table.
  const distance = (record: typeof records[number]) =>
    Number(record.sample.imageRequestedSize !== size) * 100 + Number(record.options.quality !== options.quality) * 50
    + Number(record.options.outputFormat !== options.outputFormat) * 10 + Number(record.options.complexity !== options.complexity) * 5
    + Math.abs((record.refs ?? 5) - bucket) + (options.outputFormat === 'gif' ? Math.abs((record.options.gifFrameCount || 0) - options.gifFrameCount!) : 0);
  const same = records.filter(sameSizeQuality);
  const candidates = same.length ? same : records;
  const nearest = candidates.length ? Math.min(...candidates.map(distance)) : Infinity;
  const seen = new Set<string>();
  const matching = (exact.length ? exact : candidates.filter(record => distance(record) === nearest)).filter(record => {
    if (seen.has(record.sample.id)) return false;
    seen.add(record.sample.id);
    return true;
  }).slice(0, 10);
  if (!matching.length) return {
    min: null, max: null, label: '$30 / 1M output tokens', basis: 'unknown', note: 'Prompt and references extra',
    description: 'GPT Image 2.6 Sunburst bills $5 / 1M text input tokens, $8 / 1M image input tokens and $30 / 1M image output tokens. No usable Sunburst 2.6 cost history is available. Actual cost is saved from provider usage after generation.',
  };
  const costs = matching.map(record => record.usd).sort((a, b) => a - b);
  const middle = Math.floor(costs.length / 2);
  const unit = costs.length % 2 ? costs[middle] : (costs[middle - 1] + costs[middle]) / 2;
  const total = unit * count;
  const similar = exact.length ? '' : ' (similar settings)';
  return {
    min: total, max: total, basis: 'history',
    label: `${count === 1 ? '' : `~${dollars(total)} total · `}~${dollars(unit)} / image${similar}`,
    note: `${matching.length} ${exact.length ? 'matching' : 'similar'} generation${matching.length === 1 ? '' : 's'} · Median actual cost`,
    description: `Estimated total for ${count} image${count === 1 ? '' : 's'}: ${dollars(total)}, including prompt, reference and output costs. Median of the last ${matching.length} recorded Sunburst 2.6 costs with ${exact.length ? 'matching model, size, quality, complexity, format and reference-count bucket (0, 1, 2–4, 5–8, 9–16)' : 'the nearest available settings, preferring the same size and quality'}. Prompt changes and caching can change the final cost; this is not a spending limit.`,
  };
};

const referenceKey = (references: GenerationConfig['referenceImages']): string | null => {
  // Do not identify unrelated photos merely by their count. Reference IDs survive upload.
  if (references.some(ref => !ref || typeof ref.id !== 'string' || !ref.id)) return null;
  return JSON.stringify(references.map(ref => [ref.id, ref.mimeType]));
};

// The per-size output table is documented for GPT Image 2.5 PNG output only.
const isSunburstOutputEstimate = (model: GenerationConfig['imageModel'], options: { outputFormat: string }) =>
  model === SUNBURST_MODEL && options.outputFormat === 'png';

type CostConfig = Pick<GenerationConfig, 'imageProvider' | 'imageModel' | 'resolution' | 'aspectRatio' | 'openaiImageOptions' | 'seedreamOptions' | 'referenceImages' | 'count'>;
export const getImageCostPreview = (config: CostConfig, count = config.count, history: ImageCostSample[] = []): ImageCostPreview => {
  // Reject invalid draft counts before selecting a model-specific estimator.
  // Otherwise zero, fractional, negative or non-finite counts can display a
  // misleading $0 or negative price for a potentially billable operation.
  if (!Number.isSafeInteger(count) || count < 1) {
    return { min: null, max: null, label: 'Choose valid image count',
      description: 'Choose a positive whole number of images before estimating generation cost.',
      note: '', basis: 'unknown' };
  }
  if (config.imageProvider === 'codex') return { min: null, max: null, label: 'ChatGPT plan', description: 'Runs through your Codex sign-in. No API charge; each image uses your ChatGPT plan’s Codex usage limits.', note: '', basis: 'unknown' };
  if (config.imageProvider && config.imageProvider !== 'fal' && !(isOpenAIImageModel(config.imageModel) && config.imageProvider === 'openai')) return { min: null, max: null, label: 'Provider usage-based', description: 'This route uses the selected provider’s billing. Actual cost is shown when returned; another provider’s estimate is not used.', note: '', basis: 'unknown' };
  if (config.imageModel === SEEDREAM_MODEL) {
    const options = { ...DEFAULT_SEEDREAM_OPTIONS, ...config.seedreamOptions };
    const layerize = options.mode === 'layerize';
    // Here count means requests (one per idea), not images in a native batch.
    const range = getSeedreamCostBounds(options, config.referenceImages.length, layerize ? 1 : options.numImages, layerize ? options.maxImages : options.numImages);
    if (!range) return { min: null, max: null, label: 'Choose valid image count', description: 'Choose a valid number of outputs.', note: '', basis: 'unknown' };
    const min = Number((range.min * count).toFixed(4));
    const max = Number((range.max * count).toFixed(4));
    return { min, max, basis: 'fixed', label: min === max ? `~$${min}` : `~$${min}–$${max}`, note: 'Billed by fal.ai',
      description: layerize ? 'Estimated range for the base and separated layers, including one source-image fee per request. Final cost depends on the returned images.'
        : 'Estimated fal.ai charge for all outputs, including each reference image fee for each edited output.' };
  }
  if (config.imageModel === NANO_BANANA_21_MODEL) {
    const cost = estimateNanoBanana21OutputCost(config.resolution, count);
    return { min: cost, max: cost, label: cost == null ? 'Usage-based' : `~${dollars(cost)} output`,
      description: `Representative output-image estimate for ${count} image${count === 1 ? '' : 's'}. Nano Banana 2.1 bills tokens: prompt, reference images and High thinking cost extra for every image. This is not a total price or spending limit; the queue does not return final token usage.`,
      note: 'Input and thinking extra', basis: cost == null ? 'unknown' : 'output' };
  }
  if (!isOpenAIImageModel(config.imageModel)) {
    const cost = estimateImageCost(config.imageModel, config.resolution, count, config.aspectRatio, config.referenceImages.length > 0);
    return { min: cost, max: cost, label: cost == null ? 'Usage-based' : `~$${cost.toFixed(2)}`, description: 'Estimated generation cost.', note: '', basis: cost == null ? 'unknown' : 'fixed' };
  }
  const options = getOpenAIImageOptions(config.openaiImageOptions, config.imageModel);
  const size = getOpenAIImageSize(config);
  if (!Number.isInteger(count) || count < 0 || validateOpenAIImageOptions(options, config.imageModel) || validateOpenAIImageSize(size, options.outputFormat)) {
    return { min: null, max: null, label: 'Choose valid size', description: 'Choose valid image settings to preview cost.', note: '', basis: 'unknown' };
  }
  const fal = config.imageProvider === 'fal';
  const providerHistory = history.filter(sample => fal ? sample.generationProvider === 'fal' : !sample.generationProvider || sample.generationProvider === 'openai');
  if (config.imageModel === GPT_IMAGE_26_SUNBURST_MODEL) {
    const preview = getGpt26CostPreview(config, options, size, count, providerHistory);
    if (!fal || preview.basis === 'history') return preview;
  }
  if (fal) return { min: null, max: null, label: 'Usage-based', basis: 'unknown', note: 'Billed by fal.ai',
    description: 'fal.ai determines the charge from the image settings and usage.' };
  const refs = getSunburstReferences(config.referenceImages);
  const key = referenceKey(refs);
  const seen = new Set<string>();
  const totals = providerHistory.flatMap(sample => {
    // Each GPT Image model, complexity and GIF frame count bills differently.
    if (!sample.id || seen.has(sample.id) || key == null || sample.imageModel !== config.imageModel
      || sample.imageRequestedSize !== size || (size !== 'auto' && sample.imageOutputSize !== size)
      || sample.openaiImageOptions?.quality !== options.quality
      || sample.openaiImageOptions?.outputFormat !== options.outputFormat
      || (options.complexity != null && sample.openaiImageOptions?.complexity !== options.complexity)
      || (options.outputFormat === 'gif' && sample.openaiImageOptions?.gifFrameCount !== options.gifFrameCount)
      || !Array.isArray(sample.referenceImages) || referenceKey(sample.referenceImages) !== key) return [];
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
  if (!isSunburstOutputEstimate(config.imageModel, options)) {
    return { min: null, max: null, label: 'Usage-based', basis: 'unknown', note: '',
      description: 'Provider usage determines the final cost. No verified output estimate is available for these settings.' };
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
