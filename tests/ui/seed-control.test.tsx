import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SeedControl } from '../../src/components/SeedControl';
import type { GenerationConfig } from '../../src/types';

const baseConfig = {
  prompt: '',
  count: 1,
  aspectRatio: '1:1',
  resolution: '1K',
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

describe('SeedControl', () => {
  it('locks a reproducible seed and exposes it as a number input', () => {
    let config = baseConfig;
    const onChange = (next: GenerationConfig | ((current: GenerationConfig) => GenerationConfig)) => {
      config = typeof next === 'function' ? next(config) : next;
    };
    const { rerender } = render(<SeedControl config={config} onChange={onChange} />);

    expect(screen.getByLabelText('Seed value')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /seed/i }));
    rerender(<SeedControl config={config} onChange={onChange} />);

    expect(config.seed).toEqual(expect.any(Number));
    expect(screen.getByLabelText('Seed value')).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Seed value'), { target: { value: '42' } });
    rerender(<SeedControl config={config} onChange={onChange} />);
    expect(config.seed).toBe(42);

    fireEvent.click(screen.getByRole('button', { name: /seed/i }));
    rerender(<SeedControl config={config} onChange={onChange} />);
    expect(config.seed).toBeUndefined();
  });

  it('does not silently store 0 when the field is cleared', () => {
    let config = { ...baseConfig, seed: 42 };
    const onChange = (next: GenerationConfig | ((current: GenerationConfig) => GenerationConfig)) => {
      config = typeof next === 'function' ? next(config) : next;
    };
    render(<SeedControl config={config} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Seed value'), { target: { value: '' } });
    expect(config.seed).toBe(42);
  });
});
