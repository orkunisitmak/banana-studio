import { describe, expect, it } from 'vitest';
import { buildGallerySearchIndex, EMPTY_SEARCH_FILTERS, searchGallery } from '../../src/components/gallerySearch';
import type { GeneratedMedia } from '../../src/types';

const media = {
  id: 'media-1',
  url: 'https://example.test/one.png',
  prompt: 'A quiet street',
  createdAt: Date.now(),
  aspectRatio: '1:1',
  resolution: '1K',
  imageModel: 'gemini-3-pro-image-preview',
  mediaType: 'image',
  referenceImages: [],
  referenceVideos: [],
  referenceAudios: [],
  tags: ['night', 'neon'],
} as GeneratedMedia;

describe('gallery search tags', () => {
  it('matches a generation through its tags', () => {
    const index = buildGallerySearchIndex([], [media]);
    expect(searchGallery(index, 'neon', EMPTY_SEARCH_FILTERS)).toHaveLength(1);
    expect(searchGallery(index, 'missing', EMPTY_SEARCH_FILTERS)).toHaveLength(0);
  });
});
