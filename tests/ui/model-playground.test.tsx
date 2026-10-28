import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelPlayground } from '../../src/components/ModelPlayground';
import type { GenerationConfig } from '../../src/types';

const config = {
  prompt: 'A hero on a rooftop',
  count: 1,
  aspectRatio: '16:9',
  resolution: '2K',
  imageModel: 'gemini-3-pro-image-preview',
  referenceImages: [],
  referenceVideos: [],
  referenceAudios: [],
  mode: 'image',
  videoModel: 'seedance-2.5',
  videoOperation: 'generate',
  videoAspectRatio: '16:9',
  videoQuality: '720p',
  videoDuration: 5,
  audioEnabled: true,
  videoPromptExpansionMode: 'balanced',
} as GenerationConfig;

describe('ModelPlayground', () => {
  it('renders both model cards and applies the first model to the composer', () => {
    const onApply = vi.fn();
    render(
      <ModelPlayground
        open
        config={config}
        images={[]}
        onClose={vi.fn()}
        onApply={onApply}
      />,
    );

    expect(screen.getByText('Model playground')).toBeInTheDocument();
    expect(screen.getAllByText(/Provider/)).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: /Use .* in composer/i })[0]);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'image',
      imageModel: 'gemini-3-pro-image-preview',
      prompt: 'A hero on a rooftop',
      aspectRatio: '16:9',
      resolution: '2K',
    }));
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <ModelPlayground open={false} config={config} images={[]} onClose={vi.fn()} onApply={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
