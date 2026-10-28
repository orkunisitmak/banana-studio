import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildContactSheetHtml,
  findRecipeDuplicateGroups,
  findVisualDuplicateGroups,
  parseImageDimensions,
  runGalleryQa,
} from '../../src/lib/gallery/intelligence';
import type { GeneratedMedia } from '../../src/types';

const media = (overrides: Partial<GeneratedMedia> = {}): GeneratedMedia => ({
  id: 'media-1',
  url: 'https://example.test/one.png',
  prompt: 'A hero on a rooftop',
  createdAt: Date.now(),
  aspectRatio: '16:9',
  resolution: '2K',
  imageModel: 'gemini-3-pro-image-preview',
  mediaType: 'image',
  referenceImages: [],
  referenceVideos: [],
  referenceAudios: [],
  ...overrides,
});

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

describe('gallery intelligence', () => {
  it('parses dimensions and groups repeated recipes', () => {
    expect(parseImageDimensions('1024x768')).toEqual({ width: 1024, height: 768 });
    expect(parseImageDimensions('1024 × 768')).toEqual({ width: 1024, height: 768 });
    expect(parseImageDimensions('auto')).toBeNull();

    const groups = findRecipeDuplicateGroups([
      media({ id: 'a' }),
      media({ id: 'b' }),
      media({ id: 'c', prompt: 'Different' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map(item => item.id)).toEqual(['a', 'b']);
  });

  it('flags failed, missing and tiny media plus duplicate recipes', () => {
    const issues = runGalleryQa([
      media({ id: 'failed', status: 'failed', error: 'Provider rejected it' }),
      media({ id: 'missing', url: '' }),
      media({ id: 'tiny', imageOutputSize: '128x128' }),
      media({ id: 'dup-1' }),
      media({ id: 'dup-2' }),
    ]);
    expect(issues.map(issue => issue.id)).toEqual(expect.arrayContaining([
      'failed:failed', 'missing:missing-url', 'tiny:tiny', 'dup-2:duplicate',
    ]));
  });

  it('finds identical bytes and escapes the contact sheet', async () => {
    expect(globalThis.crypto?.subtle).toBeDefined();
    const fetchImpl = (async (url: string | URL | Request) => ({
      ok: true,
      arrayBuffer: async () => (String(url).includes('same')
        ? Buffer.from([1, 2, 3])
        : Buffer.from([4, 5, 6])) as unknown as ArrayBuffer,
    })) as unknown as typeof fetch;
    const result = await findVisualDuplicateGroups([
      media({ id: 'a', url: 'https://example.test/same-1.png' }),
      media({ id: 'b', url: 'https://example.test/same-2.png' }),
      media({ id: 'c', url: 'https://example.test/other.png' }),
    ], 10, fetchImpl);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].map(item => item.id)).toEqual(['a', 'b']);
    expect(result.scanned).toBe(3);
    expect(result.skipped).toBe(0);

    const html = buildContactSheetHtml([media({ id: 'x', prompt: '<script>alert(1)</script>' })]);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
