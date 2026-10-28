import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExportPresetMenu } from '../../src/components/ExportPresetMenu';
import { DEFAULT_BRAND_KIT } from '../../src/lib/brand/kit';
import type { GeneratedMedia } from '../../src/types';

const image = {
  id: 'media-1',
  url: 'https://example.test/one.png',
  prompt: 'A hero',
  createdAt: Date.now(),
  aspectRatio: '16:9',
  resolution: '2K',
  imageModel: 'gemini-3-pro-image-preview',
  mediaType: 'image',
  referenceImages: [],
  referenceVideos: [],
  referenceAudios: [],
} as GeneratedMedia;

describe('ExportPresetMenu', () => {
  it('lists the supported presets for image selections', () => {
    render(<ExportPresetMenu images={[image]} brandKit={DEFAULT_BRAND_KIT} />);
    const select = screen.getByLabelText('Export preset');
    expect(select).toBeEnabled();
    expect(screen.getByRole('option', { name: /YouTube 16:9/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Shorts/i })).toBeInTheDocument();
  });

  it('stays disabled when only videos are selected', () => {
    render(<ExportPresetMenu images={[{ ...image, mediaType: 'video' }]} brandKit={DEFAULT_BRAND_KIT} />);
    expect(screen.getByLabelText('Export preset')).toBeDisabled();
  });
});
