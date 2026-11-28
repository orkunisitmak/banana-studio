import { isGptImage26Model } from '../../src/lib/images/openaiImage.js';
import type { OpenAIImageOptions } from '../../src/types.js';

export function falGptImageEndpoint(model: string, hasReferences: boolean) {
  return 'openai/gpt-image-' + (isGptImage26Model(model) ? '2.6' : '2.5') + '/sunburst/' + (hasReferences ? 'edit' : 'text-to-image');
}

export function falGptImageInput(model: string, prompt: string, size: string, options: OpenAIImageOptions,
  images: { image_url: string }[], markup?: string) {
  const [width, height] = size.split('x').map(Number);
  return {
    prompt, num_images: 1, image_size: size === 'auto' ? 'auto' : { width, height },
    quality: options.quality, background: options.background, output_format: options.outputFormat, sync_mode: true,
    ...(isGptImage26Model(model) ? { reasoning_effort: options.complexity || 'high' } : {}),
    ...(options.outputFormat === 'gif' ? { frame_count: options.gifFrameCount, frame_duration_ms: options.gifFrameDurationMs } : {}),
    ...(images.length ? { image_urls: images.map(image => image.image_url) } : {}),
    ...(markup ? { markup_image_url: markup } : {}),
  };
}
