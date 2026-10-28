import { describe, expect, it } from 'vitest';
import { buildExportMetadata } from '../../src/lib/gallery/exportMetadata';
import type { GeneratedMedia } from '../../src/types';

const media = {
  id: 'media-1',
  url: 'https://example.test/one.png',
  prompt: 'A hero on a rooftop',
  createdAt: Date.UTC(2026, 9, 28),
  aspectRatio: '16:9',
  resolution: '2K',
  imageModel: 'gemini-3-pro-image-preview',
  mediaType: 'image',
  referenceImages: [],
  referenceVideos: [],
  referenceAudios: [],
  tags: ['hero', 'night'],
  isFavorite: true,
} as GeneratedMedia;

describe('buildExportMetadata', () => {
  it('keeps prompts, model, tags and timestamps with exported files', () => {
    expect(buildExportMetadata(media)).toMatchObject({
      id: 'media-1',
      prompt: 'A hero on a rooftop',
      imageModel: 'gemini-3-pro-image-preview',
      tags: ['hero', 'night'],
      isFavorite: true,
      createdAt: '2026-10-28T00:00:00.000Z',
    });
  });

  it('uses the video ratio and omits unrelated image fields', () => {
    const video = {
      ...media,
      mediaType: 'video',
      imageModel: undefined,
      videoModel: 'minimax-h3',
      videoAspectRatio: '9:16',
      videoQuality: '1080p',
      videoDuration: 8,
    } as GeneratedMedia;
    const result = buildExportMetadata(video);
    expect(result.aspectRatio).toBe('9:16');
    expect(result.videoQuality).toBe('1080p');
    expect(result.videoDuration).toBe(8);
  });
});
