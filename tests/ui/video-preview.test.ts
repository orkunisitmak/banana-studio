import { describe, expect, it } from 'vitest';
import {
  formatPlaybackTime,
  getVideoPreviewSrc,
} from '../../src/components/gallery/videoPreview';

describe('gallery video helpers', () => {
  it('adds a media fragment so mobile Safari paints a poster frame', () => {
    expect(getVideoPreviewSrc('https://example.test/clip.mp4')).toBe(
      'https://example.test/clip.mp4#t=0.1',
    );
    expect(getVideoPreviewSrc('https://example.test/clip.mp4#t=3')).toBe(
      'https://example.test/clip.mp4#t=3',
    );
  });

  it('formats playback time safely for invalid and long inputs', () => {
    expect(formatPlaybackTime(Number.NaN)).toBe('00:00');
    expect(formatPlaybackTime(-4)).toBe('00:00');
    expect(formatPlaybackTime(65)).toBe('01:05');
    expect(formatPlaybackTime(3725)).toBe('62:05');
  });
});
