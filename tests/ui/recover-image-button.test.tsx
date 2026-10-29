import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecoverImageButton } from '../../src/components/gallery/RecoverImageButton';
import { SUNBURST_MODEL } from '../../src/lib/images/openaiImage';
import type { GeneratedMedia } from '../../src/types';

const media = {
  id: 'media-1',
  imageModel: SUNBURST_MODEL,
  mediaType: 'image',
} as GeneratedMedia;

describe('RecoverImageButton', () => {
  it('checks a saved Image 2.5 result without starting a new generation', async () => {
    let resolveRecovery: (() => void) | undefined;
    const onRecover = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveRecovery = resolve;
        }),
    );
    render(<RecoverImageButton media={media} onRecover={onRecover} />);

    fireEvent.click(screen.getByRole('button', { name: /recover saved image/i }));

    expect(onRecover).toHaveBeenCalledWith(media);
    expect(screen.getByRole('button', { name: /checking saved image/i })).toBeDisabled();

    resolveRecovery?.();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /recover saved image/i })).toBeEnabled(),
    );
  });

  it('stays hidden for other models and without a recovery handler', () => {
    const { container, rerender } = render(
      <RecoverImageButton media={{ ...media, imageModel: 'gemini-3-pro-image-preview' } as GeneratedMedia} onRecover={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<RecoverImageButton media={media} />);
    expect(container).toBeEmptyDOMElement();
  });
});
