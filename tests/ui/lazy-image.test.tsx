import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LazyImage } from '../../src/components/gallery/LazyImage';
import { resetIntersections, triggerIntersection } from './setup';

describe('LazyImage', () => {
  beforeEach(() => resetIntersections());

  it('waits for visibility before mounting the image and reports its dimensions', () => {
    const onLoadedDimensions = vi.fn();
    render(
      <LazyImage
        src="https://example.test/image.png"
        alt="Generated image"
        onLoadedDimensions={onLoadedDimensions}
      />,
    );

    expect(screen.queryByAltText('Generated image')).not.toBeInTheDocument();
    act(() => triggerIntersection());

    const image = screen.getByAltText('Generated image');
    Object.defineProperty(image, 'naturalWidth', { value: 1024 });
    Object.defineProperty(image, 'naturalHeight', { value: 768 });
    fireEvent.load(image);

    expect(onLoadedDimensions).toHaveBeenCalledWith(1024, 768);
    expect(image).toHaveClass('opacity-100');
  });

  it('falls back from a broken thumbnail to the original source', () => {
    const onError = vi.fn();
    render(
      <LazyImage
        src="https://example.test/original.png"
        thumbSrc="https://example.test/thumb.png"
        alt="Generated image"
        onError={onError}
      />,
    );
    act(() => triggerIntersection());

    const image = screen.getByAltText('Generated image');
    expect(image).toHaveAttribute('src', 'https://example.test/thumb.png');
    fireEvent.error(image);

    expect(screen.getByAltText('Generated image')).toHaveAttribute(
      'src',
      'https://example.test/original.png',
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it('shows the error state when the original source also fails', () => {
    const onError = vi.fn();
    render(
      <LazyImage
        src="https://example.test/original.png"
        thumbSrc="https://example.test/thumb.png"
        alt="Generated image"
        onError={onError}
      />,
    );
    act(() => triggerIntersection());

    fireEvent.error(screen.getByAltText('Generated image'));
    fireEvent.error(screen.getByAltText('Generated image'));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText('Generated image')).not.toBeInTheDocument();
  });
});
