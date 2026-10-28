import { getImageCostPreview } from './imageCostPreview';
import { MODEL_ROUTES } from '../providers';
import {
  IMAGE_MODEL_OPTIONS,
  type AspectRatio,
  type GeneratedMedia,
  type ImageModelId,
  type Resolution,
} from '../../types';

export interface ModelComparison {
  model: ImageModelId;
  label: string;
  provider: string;
  costLabel: string;
  costMin: number | null;
  costMax: number | null;
  averageSeconds: number | null;
  samples: number;
}

export const buildModelComparison = (
  model: ImageModelId,
  options: {
    aspectRatio: AspectRatio;
    resolution: Resolution;
    images: GeneratedMedia[];
  },
): ModelComparison => {
  const cost = getImageCostPreview({
    imageModel: model,
    aspectRatio: options.aspectRatio,
    resolution: options.resolution,
    referenceImages: [],
    count: 1,
  });
  const samples = options.images
    .filter(item =>
      item.imageModel === model &&
      item.mediaType === 'image' &&
      (!item.status || item.status === 'completed') &&
      !item.isLoading &&
      item.aspectRatio === options.aspectRatio &&
      item.resolution === options.resolution &&
      typeof item.generationTime === 'number' &&
      Number.isFinite(item.generationTime) &&
      item.generationTime > 0,
    )
    .slice(0, 20);
  const averageSeconds = samples.length
    ? Math.round((samples.reduce((sum, item) => sum + (item.generationTime || 0), 0) / samples.length) * 10) / 10
    : null;

  return {
    model,
    label: IMAGE_MODEL_OPTIONS.find(option => option.value === model)?.label || model,
    provider: (MODEL_ROUTES[model] || []).join(' / ') || 'auto',
    costLabel: cost.label,
    costMin: cost.min,
    costMax: cost.max,
    averageSeconds,
    samples: samples.length,
  };
};
