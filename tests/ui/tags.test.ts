import { describe, expect, it } from 'vitest';
import { addTag, MAX_TAGS, normalizeTags, removeTag } from '../../src/lib/gallery/tags';

describe('gallery tags', () => {
  it('trims, collapses whitespace and removes duplicates case-insensitively', () => {
    expect(normalizeTags(['  Hero  ', 'hero', 'Red  carpet', '', 42 as unknown as string])).toEqual([
      'Hero',
      'Red carpet',
    ]);
  });

  it('caps the number of tags and their length', () => {
    const tags = Array.from({ length: MAX_TAGS + 5 }, (_, index) => `tag-${index}`);
    expect(normalizeTags(tags)).toHaveLength(MAX_TAGS);
    expect(normalizeTags(['x'.repeat(100)])[0]).toHaveLength(40);
  });

  it('adds and removes tags without mutating the input', () => {
    const original = ['hero', 'night'];
    expect(addTag(original, 'Hero')).toEqual(['hero', 'night']);
    expect(addTag(original, 'rain')).toEqual(['hero', 'night', 'rain']);
    expect(removeTag(original, 'HERO')).toEqual(['night']);
    expect(original).toEqual(['hero', 'night']);
  });
});
