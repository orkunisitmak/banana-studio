import { DEFAULT_SEEDREAM_OPTIONS, SEEDREAM_MAX_IMAGES, SEEDREAM_MAX_LAYER_IMAGES, type SeedreamOptions } from './seedream55.ts';

type Dimensions = { width: number; height: number };

/** fal.ai/models/bytedance/seedream/v5.5/{text-to-image,edit,layerize}.
 * Bounds are for ONE request: the edit input fee repeats per output, whereas
 * the layerize input fee is charged once for the entire stack. */
export function getSeedreamCostBounds(options: Partial<SeedreamOptions> | undefined, inputCount: number,
  minOutputs: number, maxOutputs: number, actualSize?: Dimensions): { min: number; max: number } | null {
  const { mode, imageSize, layerSize } = { ...DEFAULT_SEEDREAM_OPTIONS, ...options };
  if (!Number.isSafeInteger(inputCount) || inputCount < 0 || !Number.isSafeInteger(minOutputs) || minOutputs < 1
    || !Number.isSafeInteger(maxOutputs) || maxOutputs < minOutputs) return null;
  const layerize = mode === 'layerize';
  if (maxOutputs > (layerize ? SEEDREAM_MAX_LAYER_IMAGES : SEEDREAM_MAX_IMAGES)) return null;
  const size = layerize ? layerSize : imageSize;
  const dimensions = typeof size === 'object' ? size : actualSize;
  const area = dimensions && dimensions.width > 0 && dimensions.height > 0 ? dimensions.width * dimensions.height : undefined;
  // The fal page specifies the two tier rates but not how a named aspect
  // preset maps to a billing tier. Use the actual output area when known.
  const rate = size === 'auto_2K' ? 405 : size === 'auto_1K' || size === 'auto_1.5K' ? 300
    : area !== undefined ? area > 2_610_000 ? 405 : 300 : null;
  const editFee = mode === 'edit' ? 120 * inputCount : 0;
  const sourceFee = layerize ? 120 : 0;
  return { min: (sourceFee + minOutputs * ((rate ?? 300) + editFee)) / 10_000,
    max: (sourceFee + maxOutputs * ((rate ?? 405) + editFee)) / 10_000 };
}

export function estimateSeedreamCost(options: Partial<SeedreamOptions> | undefined, inputCount: number,
  outputCount: number, actualSize?: Dimensions): number | null {
  const range = getSeedreamCostBounds(options, inputCount, outputCount, outputCount, actualSize);
  return range && range.min === range.max ? range.min : null;
}
