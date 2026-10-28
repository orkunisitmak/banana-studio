import { describe, expect, it } from 'vitest';
import { buildModelComparison } from '../../src/lib/images/modelComparison';
import type { GeneratedMedia } from '../../src/types';

const sample = (id: string, model: GeneratedMedia['imageModel'], generationTime: number): GeneratedMedia => ({
  id,
  url: `https://example.test/${id}.png`,
  prompt: 'A city',
  createdAt: Date.now(),
  aspectRatio: '16:9',
  resolution: '2K',
  imageModel: model,
  mediaType: 'image',
  referenceImages: [],
  referenceVideos: [],
  referenceAudios: [],
  generationTime,
});

describe('buildModelComparison', () => {
  it('reports the model label, provider, cost and average observed latency', () => {
    const comparison = buildModelComparison('gemini-3-pro-image-preview', {
      aspectRatio: '16:9',
      resolution: '2K',
      images: [
        sample('one', 'gemini-3-pro-image-preview', 4),
        sample('two', 'gemini-3-pro-image-preview', 6),
        sample('other', 'gemini-nano-banana-2.1', 99),
      ],
    });

    expect(comparison.label).toBe('Nano Banana Pro');
    expect(comparison.provider).toContain('fal');
    expect(comparison.costLabel).toContain('$');
    expect(comparison.averageSeconds).toBe(5);
    expect(comparison.samples).toBe(2);
  });

  it('returns no latency when there are no matching completed samples', () => {
    const comparison = buildModelComparison('gemini-nano-banana-2.1', {
      aspectRatio: '1:1',
      resolution: '1K',
      images: [],
    });
    expect(comparison.averageSeconds).toBeNull();
    expect(comparison.samples).toBe(0);
    expect(comparison.provider).toContain('fal');
  });
});
